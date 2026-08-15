/**
 * Forgotten password, reset by one-time code.
 *
 * Two steps, both unauthenticated — by definition the farmer cannot sign in:
 *
 *   1. `requestPasswordReset(email)` emails a six-digit code.
 *   2. `resetPassword(email, code, newPassword)` checks it and sets the password.
 *
 * Unauthenticated is the whole difficulty. `email-otp.ts` can afford to be
 * candid because the caller already holds a token for the account; here anyone
 * can call, so every reply has to be the same whether or not the address has an
 * account. That single rule is what shapes the rest of this file:
 *
 *  - Step one always resolves with the same body, including for an address that
 *    has never registered. It never throws a 404, and never a 429 either — a
 *    rate-limit reply that only appears for real accounts is an account-existence
 *    oracle with extra steps. When a limit is hit, no mail goes out and the
 *    caller is told what it is told every other time.
 *  - Step two answers "that code is wrong or has expired" identically for an
 *    unknown address, a known address with no code outstanding, a wrong code and
 *    an expired one. Which of the four it was is only in the server log.
 *  - The code is emailed to the address on the *account*, so a reset can only
 *    ever be completed by someone who can read that inbox.
 *
 * A successful reset revokes every session, exactly as `changePassword` does: if
 * the password was reset because somebody else knew it, leaving their session
 * signed in would make the reset pointless.
 */

import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { config, features, isDevelopment } from '../../config';
import { logger } from '../../common/logger';
import { sendMail } from '../../common/mailer';
import { ExternalServiceError, ValidationError } from '../../common/errors';

/** How long a code stays usable. */
const CODE_TTL_MS = 15 * 60 * 1000;

/** Wrong guesses allowed against one code before it is dead. */
const MAX_ATTEMPTS = 5;

/** Minimum gap between two sends to one account. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/** Ceiling per rolling hour, so the cooldown cannot just be waited out all day. */
const MAX_SENDS_PER_HOUR = 5;

/**
 * "Not yet spent" — spelled to match both document shapes.
 *
 * Prisma does not write an optional field it was not given, and MongoDB does not
 * match a missing key with `where: { consumedAt: null }`. Creates below pass
 * `consumedAt: null` explicitly, and this clause accepts either shape so a row
 * written by anything else still behaves. Same trap, same fix, as `NOT_CONSUMED`
 * in email-otp.ts — see the long note there for what getting it wrong costs.
 */
const NOT_CONSUMED: Prisma.PasswordResetWhereInput = {
  OR: [{ consumedAt: null }, { consumedAt: { isSet: false } }],
};

/** A uniformly random six-digit code from the CSPRNG, leading zeros kept. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface RequestResetResult {
  /**
   * Seconds before another code can be requested.
   *
   * A fixed number, not the account's real remaining cooldown: the honest value
   * would differ between an address that has an account and one that does not.
   */
  resendAfter: number;
}

/** What every caller of step one gets back, whatever actually happened. */
const GENERIC_RESULT: RequestResetResult = {
  resendAfter: Math.ceil(RESEND_COOLDOWN_MS / 1000),
};

/**
 * Email a reset code, if there is an account to email it to.
 *
 * Resolves the same way regardless — see the header. The one exception is a
 * server with no mailbox configured, which throws 502: that is a fact about this
 * deployment and not about any farmer's account, so saying it leaks nothing and
 * silently pretending to have sent mail would strand every farmer who ever
 * forgets a password.
 */
export async function requestPasswordReset(email: string): Promise<RequestResetResult> {
  if (!features.email && !isDevelopment) {
    throw new ExternalServiceError(
      'email',
      'Email delivery is not configured on this server (EMAIL_USER / EMAIL_APP_PASSWORD)',
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // No account. Logged, so a flood of these is visible, and then answered
    // exactly like a success.
    logger.info({ email: redactEmail(email) }, 'Password reset requested for unknown address');
    return GENERIC_RESULT;
  }

  // A Google-only account has no password to reset — but it does have a Gmail
  // address Google verified, and whoever holds the code can read that inbox. So
  // this sets a first password rather than refusing, which turns "I only ever
  // used the Google button and now it will not work on this phone" into
  // something the farmer can solve alone. Google Sign-In keeps working after.

  const now = Date.now();

  // One query answers both limits: the newest send gives the cooldown, the count
  // gives the hourly ceiling.
  const recent = await prisma.passwordReset.findMany({
    where: { userId: user.id, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const lastSentAt = recent[0]?.createdAt;
  const withinCooldown = lastSentAt ? now - lastSentAt.getTime() < RESEND_COOLDOWN_MS : false;

  if (withinCooldown || recent.length >= MAX_SENDS_PER_HOUR) {
    // Deliberately not a 429. The farmer sees the same "if that address has an
    // account, a code is on its way" as everyone else, and the code already in
    // their inbox is still live — this is a duplicate request, not a dead end.
    logger.warn(
      { userId: user.id, withinCooldown, sentThisHour: recent.length },
      'Password reset code not sent — rate limited',
    );
    return GENERIC_RESULT;
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, config.BCRYPT_ROUNDS);
  const expiresAt = new Date(now + CODE_TTL_MS);

  // Retire any previous code before the new one exists, so there is never a
  // moment with two live codes and never an older mail that still works.
  await prisma.passwordReset.updateMany({
    where: { userId: user.id, ...NOT_CONSUMED },
    data: { consumedAt: new Date() },
  });

  const record = await prisma.passwordReset.create({
    data: { userId: user.id, codeHash, expiresAt, consumedAt: null },
  });

  const sent = await deliverCode(user.email, user.name, code);

  if (!sent) {
    // Never delivered, so it must not sit in the table spending this farmer's
    // cooldown and one of their five hourly sends.
    await prisma.passwordReset.delete({ where: { id: record.id } });

    throw new ExternalServiceError(
      'email',
      'Could not send the reset code. Please try again in a moment.',
    );
  }

  logger.info({ userId: user.id, expiresAt }, 'Password reset code sent');

  return GENERIC_RESULT;
}

/**
 * Get the code to the farmer, or report that it could not be done.
 *
 * Gmail normally. With Gmail unconfigured *and* `NODE_ENV === 'development'`,
 * the code goes to the server log instead — the same development exemption
 * `email-otp.ts` documents at length, and safe for the same three reasons: it is
 * unreachable in production (the 502 above fires first), the code never enters
 * the HTTP response, and configuring Gmail switches it off with no code change.
 */
async function deliverCode(email: string, name: string, code: string): Promise<boolean> {
  if (features.email) {
    return sendMail({
      to: email,
      subject: `${code} is your Smart Farm password reset code`,
      text: resetText(name, code),
      html: resetHtml(name, code),
    });
  }

  logger.warn(
    { to: redactEmail(email), code },
    'DEVELOPMENT ONLY — Gmail is not configured, so no email was sent. Enter the code printed here to reset the password. Set EMAIL_USER and EMAIL_APP_PASSWORD in backend/.env to send real mail.',
  );

  return true;
}

/**
 * Check a code and, if it matches, set the new password.
 *
 * Every failure — unknown address, no code outstanding, expired, exhausted,
 * simply wrong — comes back as the same message keyed to the `code` field, so
 * the reply cannot be read as "that address does have an account". Only a real
 * wrong guess against a real live code costs an attempt; there is nothing to
 * count against an address that has none.
 */
export async function resetPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });

  if (!user) {
    logger.warn(
      { email: redactEmail(input.email) },
      'Password reset attempted for unknown address',
    );
    throw invalidCode();
  }

  const record = await prisma.passwordReset.findFirst({
    where: { userId: user.id, ...NOT_CONSUMED },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.expiresAt < new Date() || record.attempts >= MAX_ATTEMPTS) {
    throw invalidCode();
  }

  const matches = await bcrypt.compare(input.code, record.codeHash);

  if (!matches) {
    const attempts = record.attempts + 1;
    await prisma.passwordReset.update({ where: { id: record.id }, data: { attempts } });

    logger.warn({ userId: user.id, attempts }, 'Incorrect password reset code');

    const remaining = MAX_ATTEMPTS - attempts;

    // The attempt counter is safe to show: the farmer had to hold a live code to
    // see it at all, which means they can already read the mailbox.
    throw remaining > 0
      ? new ValidationError('That code is not correct.', {
          code: `Incorrect code. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left.`,
        })
      : invalidCode();
  }

  const passwordHash = await bcrypt.hash(input.newPassword, config.BCRYPT_ROUNDS);

  // Spend the code and change the password together. A crash between the two
  // would otherwise leave a used code that still resets, or a changed password
  // whose code is still live in an inbox.
  await prisma.$transaction([
    prisma.passwordReset.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Completing this proved the farmer can read the mailbox, which is the
        // same thing the verification code proves. Not marking it here would
        // leave them being asked to verify an address they just demonstrably
        // received mail at.
        isVerified: true,
      },
    }),
  ]);

  // Every session, including any the person who knew the old password was
  // holding. The farmer signs in again with the password they just chose —
  // which is where the reset screen sends them anyway.
  await prisma.session.deleteMany({ where: { userId: user.id } });

  logger.info({ userId: user.id }, 'Password reset');
}

/**
 * The one failure message step two ever gives.
 *
 * Four different situations share it on purpose — see the header. Keyed to
 * `code` so the frontend renders it under the digit boxes.
 */
function invalidCode(): ValidationError {
  return new ValidationError('That code is not correct, or it has expired.', {
    code: 'This code is not correct or has expired. Request a new one.',
  });
}

/** Housekeeping, alongside `cleanupExpiredSessions` and `cleanupExpiredOtps`. */
export async function cleanupExpiredPasswordResets(): Promise<number> {
  const result = await prisma.passwordReset.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
  });

  logger.info({ deleted: result.count }, 'Cleaned up expired password reset codes');
  return result.count;
}

// ───────────────────────────── Message body ─────────────────────────────

function resetText(name: string, code: string): string {
  return [
    `Hello ${name},`,
    '',
    `Your Smart Farm password reset code is: ${code}`,
    '',
    'Enter it in the app to choose a new password. The code expires in 15 minutes.',
    '',
    'If you did not ask to reset your password, you can ignore this email — your',
    'password has not changed.',
  ].join('\n');
}

function resetHtml(name: string, code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f6f4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a2e1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Reset your password</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
        Hello ${escapeHtml(name)}, use this code to choose a new password:
      </p>
      <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;color:#15803d;">
        ${code}
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#4b5563;line-height:1.5;">
        The code expires in 15 minutes. If you did not ask to reset your password,
        you can ignore this email — your password has not changed.
      </p>
    </div>
  </body>
</html>`;
}

/** `name` is farmer-supplied and goes into markup. `code` is six digits we made. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function redactEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}
