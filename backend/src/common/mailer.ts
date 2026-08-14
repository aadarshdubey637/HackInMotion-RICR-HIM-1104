/**
 * Gmail SMTP transport.
 *
 * The one place in this codebase that holds mail credentials. Everything that
 * needs to send email goes through `sendMail`, and the credentials come from
 * `config` — which reads them from `backend/.env` — so they are never written
 * into source, a log line, or an error message.
 *
 * Gmail specifics, which are the whole reason this file has comments:
 *
 *   - Plain account passwords have been refused since May 2022. `EMAIL_APP_PASSWORD`
 *     must be a 16-character App Password (2-Step Verification required to make
 *     one). A wrong value fails at authentication with `EAUTH` / 535, not at
 *     send time — which is why `verifyMailer` exists and is called at boot.
 *   - Port 465 with implicit TLS, rather than 587 with STARTTLS. Both work, but
 *     465 fails *closed* if TLS cannot be negotiated, where a mishandled 587
 *     can in principle proceed unencrypted.
 *   - Free Gmail sends roughly 500 messages per day. That is ample for OTP in
 *     this project but is a real ceiling, and hitting it returns a 550 quota
 *     error rather than silently dropping — see the `EENVELOPE` note below.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config, features } from '../config';
import { logger } from './logger';

/** Whether email can be sent at all. False = both env vars are not set. */
export const isEmailEnabled = features.email;

/**
 * Built once, on first use, and reused for every later send.
 *
 * A transporter holds a pooled TCP connection to Gmail. Creating one per
 * message means a fresh TLS handshake and SMTP AUTH round-trip each time,
 * which Gmail rate-limits as connection churn well before the daily message
 * cap is reached.
 */
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!isEmailEnabled) {
    // Callers are expected to check `isEmailEnabled` first. Reaching here is a
    // programming error, not a configuration one, so it throws rather than
    // degrading — a silent no-op would let an OTP flow believe it had sent a
    // code that never existed.
    throw new Error(
      'Email is not configured: set EMAIL_USER and EMAIL_APP_PASSWORD in backend/.env',
    );
  }

  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: config.EMAIL_USER,
      // Already stripped of Google's display spaces by the config schema.
      pass: config.EMAIL_APP_PASSWORD,
    },
    // Keep the connection warm between the two or three messages a single OTP
    // exchange produces, then let it close.
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
  });

  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always send one: some mail clients show only this. */
  text: string;
  /** Optional HTML alternative. */
  html?: string;
}

/**
 * Send one message. Resolves `true` when Gmail accepted it.
 *
 * Never throws and never rejects. A mail failure is not a reason to fail the
 * request that triggered it — the caller decides what to tell the user, and for
 * an OTP flow that is usually "we could not send the code, try again" rather
 * than a 500. The reason is logged; the credentials are not.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  if (!isEmailEnabled) {
    logger.warn(
      { to: redactEmail(message.to), subject: message.subject },
      'Email not configured — message not sent',
    );
    return false;
  }

  try {
    const info = await getTransporter().sendMail({
      // Gmail rewrites `from` to the authenticated mailbox regardless of what
      // is put here, so the address must match EMAIL_USER; only the display
      // name is ours to choose.
      from: `"Smart Farm" <${config.EMAIL_USER}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });

    logger.info({ to: redactEmail(message.to), messageId: info.messageId }, 'Email sent');
    return true;
  } catch (error) {
    // `code` distinguishes the two failures worth telling apart in logs:
    // EAUTH means the App Password is wrong or revoked (a deployment problem),
    // EENVELOPE means Gmail rejected the recipient or the quota is spent (a
    // runtime problem). Both arrive here as an ordinary caught error.
    const { code, message: reason } = error as { code?: string; message?: string };

    logger.error(
      { to: redactEmail(message.to), code, reason },
      code === 'EAUTH'
        ? 'Email authentication failed — check EMAIL_APP_PASSWORD is a current Google App Password'
        : 'Email send failed',
    );
    return false;
  }
}

/**
 * Check the credentials against Gmail without sending anything.
 *
 * Worth calling once at startup: a bad App Password is otherwise invisible
 * until the first farmer requests an OTP and silently does not receive it.
 * Returns false rather than throwing, so a boot sequence can log and continue.
 */
export async function verifyMailer(): Promise<boolean> {
  if (!isEmailEnabled) return false;

  try {
    await getTransporter().verify();
    logger.info({ user: redactEmail(config.EMAIL_USER!) }, 'Gmail SMTP ready');
    return true;
  } catch (error) {
    const { code, message: reason } = error as { code?: string; message?: string };
    logger.error({ code, reason }, 'Gmail SMTP unavailable — OTP email will not send');
    return false;
  }
}

/**
 * Release the pooled SMTP connection.
 *
 * `pool: true` keeps a socket open to Gmail, and an open socket is a live handle
 * that holds the Node event loop open — a process that has sent one message will
 * not exit on its own until the pool is closed or Gmail times it out. So this is
 * not merely tidy: without it `shutdown` waits out its 10-second force-exit
 * timer on every restart, and a one-off script appears to hang after sending.
 */
export function closeMailer(): void {
  transporter?.close();
  transporter = null;
}

/**
 * `ramesh.kumar@gmail.com` -> `ra***@gmail.com`.
 *
 * Addresses are personal data and these logs are kept; the first characters and
 * the domain are enough to trace one delivery through them.
 */
function redactEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}
