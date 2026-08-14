/**
 * Email verification by one-time code.
 *
 * Registration signs the farmer in immediately and leaves `isVerified` false;
 * this is what turns it true. Both entry points are authenticated, which is a
 * deliberate design choice with two consequences worth stating:
 *
 *  - There is no way to ask "does this address have an account here?" by poking
 *    these endpoints, because the caller must already hold a token for the
 *    account. An unauthenticated `POST /send-otp {email}` would be exactly that
 *    oracle, and would also let anyone send mail from our mailbox to any Gmail
 *    address on demand.
 *  - The address is read from the account, never from the request body. A farmer
 *    cannot direct their verification code to an inbox they do not own.
 *
 * Verification is not currently a gate on signing in — an unverified farmer
 * still reaches the dashboard. This module only establishes the fact; whether
 * any feature requires it is a policy decision that belongs elsewhere.
 */

import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { config, features, isDevelopment } from '../../config';
import { logger } from '../../common/logger';
import { sendMail } from '../../common/mailer';
import {
  ExternalServiceError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../common/errors';

/** How long a code stays usable. */
const CODE_TTL_MS = 10 * 60 * 1000;

/** Wrong guesses allowed against one code before it is dead. */
const MAX_ATTEMPTS = 5;

/** Minimum gap between two sends, so "Resend" cannot be held down. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/** Ceiling per rolling hour, so the cooldown cannot just be waited out all day. */
const MAX_SENDS_PER_HOUR = 5;

/**
 * "Not yet spent" — and it has to be spelled this way on MongoDB.
 *
 * Prisma does not write an optional field it was not given: a document created
 * without `consumedAt` has no `consumed_at` key at all, rather than one holding
 * null. And `where: { consumedAt: null }` does **not** match a missing field —
 * verified by experiment, not assumed, because MongoDB's own `$eq: null` does
 * match missing keys and the difference is invisible in the schema.
 *
 * The consequence of getting this wrong is not a crash but silence: every code
 * this module emailed would be unfindable, so `verifyOtp` would reject correct
 * codes as expired, and `sendVerificationOtp` would fail to retire the previous
 * code and leave several live at once.
 *
 * Creates below therefore pass `consumedAt: null` explicitly so new rows are
 * uniform, and this clause still accepts either shape so a row written by
 * anything else — an older build, a hand-inserted document — behaves correctly.
 */
const NOT_CONSUMED: Prisma.EmailOtpWhereInput = {
  OR: [{ consumedAt: null }, { consumedAt: { isSet: false } }],
};

/**
 * A uniformly random six-digit code, leading zeros included.
 *
 * `randomInt` is the CSPRNG, not `Math.random`: a predictable code is the same
 * as no code. The range is the full `000000`-`999999`, and the result is padded
 * rather than shifted into `100000`-`999999` — dropping the leading-zero codes
 * would throw away a tenth of the space for a cosmetic reason.
 */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export interface SendOtpResult {
  /** Redacted for display, e.g. `ra***@gmail.com`. */
  email: string;
  /** When the code stops working. */
  expiresAt: Date;
  /** Seconds until "Resend" becomes available again. */
  resendAfter: number;
}

/**
 * Issue a code and email it.
 *
 * Any previous unspent code for this farmer is invalidated first, so exactly one
 * code is ever live. Without that, the older mail in the inbox would keep
 * working and the attempt counter could be reset at will by requesting a new one.
 */
export async function sendVerificationOtp(userId: string): Promise<SendOtpResult> {
  if (!features.email && !isDevelopment) {
    // 502 rather than 500: nothing is wrong with the request, the server is
    // missing configuration. The message names the fix without echoing values.
    //
    // Development is exempt because a contributor who has cloned the repo has no
    // Gmail App Password, and refusing here would make registration — the first
    // screen of the app — impossible to get past locally. `deliverCode` below is
    // what makes that exemption safe.
    throw new ExternalServiceError(
      'email',
      'Email delivery is not configured on this server (EMAIL_USER / EMAIL_APP_PASSWORD)',
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError('User', userId);
  }

  if (user.isVerified) {
    throw new ValidationError('This email address is already verified.');
  }

  const now = Date.now();

  // One query answers both limits: the newest send gives the cooldown, the count
  // gives the hourly ceiling.
  const recent = await prisma.emailOtp.findMany({
    where: { userId, createdAt: { gte: new Date(now - 60 * 60 * 1000) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  const lastSentAt = recent[0]?.createdAt;

  if (lastSentAt) {
    const elapsed = now - lastSentAt.getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
      throw new RateLimitError(
        `Please wait ${retryAfter} seconds before requesting another code.`,
        retryAfter,
      );
    }
  }

  if (recent.length >= MAX_SENDS_PER_HOUR) {
    throw new RateLimitError(
      'Too many codes requested. Please try again in an hour.',
      60 * 60,
    );
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, config.BCRYPT_ROUNDS);
  const expiresAt = new Date(now + CODE_TTL_MS);

  // Retire the previous code before the new one exists, so there is never a
  // moment with two live codes.
  await prisma.emailOtp.updateMany({
    where: { userId, ...NOT_CONSUMED },
    data: { consumedAt: new Date() },
  });

  const record = await prisma.emailOtp.create({
    // `consumedAt: null` is written deliberately rather than left out — see
    // NOT_CONSUMED above for what omitting it costs.
    data: { userId, codeHash, expiresAt, consumedAt: null },
  });

  const sent = await deliverCode(user.email, user.name, code);

  if (!sent) {
    // The code was never delivered, so it must not sit in the table occupying
    // this farmer's cooldown and one of their five hourly sends.
    await prisma.emailOtp.delete({ where: { id: record.id } });

    throw new ExternalServiceError(
      'email',
      'Could not send the verification code. Please try again in a moment.',
    );
  }

  logger.info({ userId, expiresAt }, 'Email verification code sent');

  return {
    email: redactEmail(user.email),
    expiresAt,
    resendAfter: Math.ceil(RESEND_COOLDOWN_MS / 1000),
  };
}

/**
 * Get the code to the farmer, or report that it could not be done.
 *
 * Normally this is Gmail. When Gmail is unconfigured *and* we are in
 * development, the code is written to the server log instead and the send is
 * reported as successful — the developer reads it out of their own terminal.
 *
 * Three properties keep that from being a way in:
 *
 *  - It is unreachable unless `NODE_ENV === 'development'`. A production server
 *    with no mailbox has already thrown 502 in `sendVerificationOtp` and never
 *    arrives here.
 *  - The code goes to the log, never to the HTTP response. Reaching it requires
 *    access to the process's own output, which on a development machine is the
 *    same person who started the process. An attacker who could read that could
 *    read `backend/.env` too.
 *  - Configuring Gmail switches this off with no code change, because the branch
 *    is on `features.email` rather than on a separate flag someone has to
 *    remember to unset.
 */
async function deliverCode(email: string, name: string, code: string): Promise<boolean> {
  if (features.email) {
    return sendMail({
      to: email,
      subject: `${code} is your Smart Farm verification code`,
      text: verificationText(name, code),
      html: verificationHtml(name, code),
    });
  }

  // Deliberately `warn`, not `info`: this line means the account is being
  // verified without anyone proving they can read the mailbox, and that should
  // be visible in the log rather than blending into normal traffic.
  logger.warn(
    { to: redactEmail(email), code },
    'DEVELOPMENT ONLY — Gmail is not configured, so no email was sent. Enter the code printed here to verify. Set EMAIL_USER and EMAIL_APP_PASSWORD in backend/.env to send real mail.',
  );

  return true;
}

/**
 * Check a code and, if it matches, mark the account verified.
 *
 * A wrong code costs an attempt. An expired, spent or exhausted code is not
 * distinguished from a merely wrong one in any way that helps an attacker — all
 * four tell the farmer to request a new code, which is the only useful
 * instruction in every case.
 */
export async function verifyOtp(userId: string, code: string): Promise<{ isVerified: true }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user) {
    throw new NotFoundError('User', userId);
  }

  // Idempotent on purpose: a double-submitted form, or a farmer who verified on
  // their phone and then tapped the link on a laptop, is a success and not an
  // error to explain.
  if (user.isVerified) {
    return { isVerified: true };
  }

  const record = await prisma.emailOtp.findFirst({
    where: { userId, ...NOT_CONSUMED },
    orderBy: { createdAt: 'desc' },
  });

  if (!record || record.expiresAt < new Date()) {
    throw new ValidationError('That code has expired. Please request a new one.', {
      code: 'This code has expired. Tap "Resend code".',
    });
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    throw new ValidationError('Too many incorrect attempts. Please request a new code.', {
      code: 'Too many incorrect attempts. Tap "Resend code".',
    });
  }

  const matches = await bcrypt.compare(code, record.codeHash);

  if (!matches) {
    const attempts = record.attempts + 1;
    await prisma.emailOtp.update({ where: { id: record.id }, data: { attempts } });

    const remaining = MAX_ATTEMPTS - attempts;

    logger.warn({ userId, attempts }, 'Incorrect email verification code');

    if (remaining <= 0) {
      throw new ValidationError('Too many incorrect attempts. Please request a new code.', {
        code: 'Too many incorrect attempts. Tap "Resend code".',
      });
    }

    throw new ValidationError('That code is not correct.', {
      code: `Incorrect code. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} left.`,
    });
  }

  // Spend the code and verify the account together: a crash between the two
  // would otherwise leave a used code that still verifies, or a verified
  // account whose code is still live.
  await prisma.$transaction([
    prisma.emailOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({ where: { id: userId }, data: { isVerified: true } }),
  ]);

  logger.info({ userId }, 'Email verified');

  return { isVerified: true };
}

/** Housekeeping, alongside `cleanupExpiredSessions`. */
export async function cleanupExpiredOtps(): Promise<number> {
  const result = await prisma.emailOtp.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 60 * 60 * 1000) } },
  });

  logger.info({ deleted: result.count }, 'Cleaned up expired email OTPs');
  return result.count;
}

// ───────────────────────────── Message body ─────────────────────────────
//
// Plain text is the one that must always read correctly: it is what a screen
// reader gets and what any client that refuses HTML falls back to. The code
// appears in the subject line as well, so it is visible in a notification
// without opening the mail.

function verificationText(name: string, code: string): string {
  return [
    `Hello ${name},`,
    '',
    `Your Smart Farm verification code is: ${code}`,
    '',
    'Enter it in the app to confirm your email address. The code expires in 10 minutes.',
    '',
    'If you did not create a Smart Farm account, you can ignore this email.',
  ].join('\n');
}

function verificationHtml(name: string, code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f6f4;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a2e1a;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;">Verify your email</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
        Hello ${escapeHtml(name)}, use this code to confirm your email address:
      </p>
      <p style="margin:0 0 24px;font-size:34px;font-weight:700;letter-spacing:8px;text-align:center;color:#15803d;">
        ${code}
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#4b5563;line-height:1.5;">
        The code expires in 10 minutes. If you did not create a Smart Farm
        account, you can ignore this email.
      </p>
    </div>
  </body>
</html>`;
}

/**
 * `name` is farmer-supplied and goes into markup, so it is escaped.
 *
 * `code` is not escaped and does not need to be: it is six digits this module
 * generated itself.
 */
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
