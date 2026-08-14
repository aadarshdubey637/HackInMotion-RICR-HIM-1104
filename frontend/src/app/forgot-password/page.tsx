'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sprout, KeyRound, ArrowLeft, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Spinner, Notice } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { LanguageSwitcher } from '@/components/language-switcher';

/**
 * Forgotten password — two steps on one screen.
 *
 *   1. Type the Gmail address. A six-digit code is emailed to it.
 *   2. Type the code and the new password, together.
 *
 * The two halves of step two are deliberately not split across two screens. A
 * farmer who has proved they can read the mailbox should not then be asked to
 * hold a code while another page loads on a patchy connection — and a code that
 * only unlocks a form is a code that can expire between unlocking it and
 * submitting it.
 *
 * The server will not say whether an address has an account, so neither does
 * this screen: step one always moves on to step two. An address with no account
 * simply never receives a code, which is what the farmer would see anyway.
 */

const CODE_LENGTH = 6;

type Step = 'email' | 'reset' | 'done';

/** Field-level messages from the API, keyed the way `validate.ts` sends them. */
type FieldErrors = Record<string, string>;

export default function ForgotPasswordPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  /**
   * In-flight guard, as a ref rather than the `submitting` state.
   *
   * State is not set synchronously, so typing the sixth digit and pressing
   * Enter in the same tick would both read `submitting === false`. Two
   * submissions of one wrong code would spend two of the five attempts.
   */
  const inFlight = useRef(false);

  /** Tick the resend countdown down to zero. */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  /** Inline field errors or one banner — never the same thing said twice. */
  const showError = useCallback((err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      const details = err.details ?? {};
      const hasFieldErrors = Object.keys(details).length > 0;
      setFieldErrors(hasFieldErrors ? details : {});
      setError(hasFieldErrors ? null : err.message);
    } else {
      setError(fallback);
    }
  }, []);

  /**
   * Step one, and also the "Resend code" button on step two.
   *
   * `resend` only changes what is said afterwards: the request is identical, and
   * the server retires the previous code either way, so the newest mail is
   * always the one that works.
   */
  const requestCode = useCallback(
    async (options: { resend?: boolean } = {}) => {
      setSending(true);
      setError(null);
      setFieldErrors({});
      setNotice(null);

      try {
        const result = await api.auth.forgotPassword(email);
        setCooldown(result.resendAfter);
        setStep('reset');
        setNotice(
          options.resend
            ? `A new code is on its way to ${email}. The previous one no longer works.`
            : `If ${email} has an account, a six-digit code is on its way to it.`,
        );
      } catch (err) {
        // 502 means the server has no mailbox configured — no amount of tapping
        // fixes that, and it is the one failure worth naming plainly.
        showError(err, 'Could not send the code. Please check your connection and try again.');
      } finally {
        setSending(false);
      }
    },
    [email, showError],
  );

  function handleEmailSubmit(event: FormEvent) {
    event.preventDefault();
    void requestCode();
  }

  async function handleResetSubmit(event: FormEvent) {
    event.preventDefault();

    if (inFlight.current) return;

    setError(null);
    setFieldErrors({});

    if (code.length !== CODE_LENGTH) {
      setFieldErrors({ code: 'Please enter all six digits.' });
      return;
    }

    // Checked here for an instant answer; the server checks it too and is the
    // one that decides.
    if (newPassword !== confirmPassword) {
      setFieldErrors({ confirmPassword: 'Both passwords must match' });
      return;
    }

    inFlight.current = true;
    setSubmitting(true);
    setNotice(null);

    try {
      await api.auth.resetPassword({ email, code, newPassword, confirmPassword });
      setStep('done');
      // No tokens come back — a reset revokes every session, including any the
      // person who knew the old password was holding. Signing in again with the
      // new password is the point, not an inconvenience.
      setTimeout(() => router.push('/login'), 2500);
    } catch (err) {
      inFlight.current = false;
      setSubmitting(false);
      // Wrong or expired: clear the boxes so the next attempt starts clean
      // rather than needing six backspaces first.
      setCode('');
      showError(err, 'Could not reset your password. Please try again.');
    }
  }

  return (
    <div className="relative flex min-h-dvh flex-col justify-center bg-slate-950 px-4 py-12 sm:px-6">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-10 blur-sm"
        style={{ backgroundImage: 'url("/images/smart_farm_hero.png")' }}
      />

      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher variant="inline" />
      </div>

      <div className="relative sm:mx-auto sm:w-full sm:max-w-md">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/25">
          {step === 'done' ? (
            <CheckCircle2 className="h-6 w-6 text-white" aria-hidden />
          ) : (
            <KeyRound className="h-6 w-6 text-white" aria-hidden />
          )}
        </div>
        <h1 className="text-center text-3xl font-extrabold tracking-tight text-white">
          {step === 'done' ? 'Password changed' : 'Reset your password'}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-center text-sm text-slate-400">
          {step === 'email'
            ? 'Enter the Gmail address on your account and we will email you a six-digit code.'
            : step === 'reset'
              ? 'Enter the code from your email, then choose a new password.'
              : 'Taking you to the sign-in screen…'}
        </p>
      </div>

      <div className="relative mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="space-y-6 border border-slate-800 bg-slate-900 px-4 py-8 shadow sm:rounded-3xl sm:px-10">
          {step === 'done' ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="text-sm text-slate-300">
                Sign in with your new password. Any device that was still signed in to this account
                has been signed out.
              </p>
              <Link
                href="/login"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-lg transition duration-200 hover:bg-brand-500"
              >
                Go to sign in
              </Link>
            </div>
          ) : step === 'email' ? (
            <form onSubmit={handleEmailSubmit} className="space-y-5">
              {error ? <Notice tone="warn">{error}</Notice> : null}

              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-semibold text-slate-300">
                  Gmail address
                </label>
                <input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldErrors({});
                  }}
                  aria-invalid={fieldErrors.email ? true : undefined}
                  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                  className={`w-full rounded-xl border bg-slate-800/80 px-4 py-3 text-white placeholder-slate-500 transition duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
                    fieldErrors.email
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                      : 'border-slate-700 focus:border-brand-500'
                  }`}
                  placeholder="you@gmail.com"
                />
                {fieldErrors.email ? (
                  <p id="email-error" className="mt-1.5 text-xs font-semibold text-red-400">
                    {fieldErrors.email}
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={sending}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-lg transition duration-200 hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Spinner className="h-5 w-5" /> : null}
                {sending ? 'Sending code…' : 'Email me a code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetSubmit} className="space-y-5">
              {error ? <Notice tone="warn">{error}</Notice> : null}
              {!error && notice ? <Notice tone="success">{notice}</Notice> : null}

              <div>
                <p id="code-label" className="mb-2 text-center text-sm font-semibold text-slate-300">
                  6-digit code
                </p>
                <OtpInput
                  value={code}
                  onChange={(next) => {
                    setCode(next);
                    setFieldErrors((prev) => {
                      if (!('code' in prev)) return prev;
                      const rest = { ...prev };
                      delete rest.code;
                      return rest;
                    });
                  }}
                  // No auto-submit here, unlike the verification screen: there is
                  // a password to type below, and firing on the sixth digit would
                  // submit the form before the farmer has filled it in.
                  disabled={submitting}
                  invalid={Boolean(fieldErrors.code)}
                  describedBy={fieldErrors.code ? 'code-error' : 'code-hint'}
                  length={CODE_LENGTH}
                />
                {fieldErrors.code ? (
                  <p id="code-error" role="alert" className="mt-2 text-center text-xs font-semibold text-red-400">
                    {fieldErrors.code}
                  </p>
                ) : (
                  <p id="code-hint" className="mt-2 text-center text-xs text-slate-400">
                    Sent to {email}. The code expires in 15 minutes.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="newPassword" className="mb-1 block text-sm font-semibold text-slate-300">
                  New password
                </label>
                <div className="relative">
                  <input
                    id="newPassword"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    aria-invalid={fieldErrors.newPassword ? true : undefined}
                    aria-describedby={fieldErrors.newPassword ? 'newPassword-error' : 'newPassword-hint'}
                    className={`w-full rounded-xl border bg-slate-800/80 px-4 py-3 pr-12 text-white placeholder-slate-500 transition duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
                      fieldErrors.newPassword
                        ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                        : 'border-slate-700 focus:border-brand-500'
                    }`}
                    placeholder="At least 8 characters"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-1 top-1 flex h-[44px] w-10 items-center justify-center rounded-lg text-slate-400 hover:text-white"
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
                {fieldErrors.newPassword ? (
                  <p id="newPassword-error" className="mt-1.5 text-xs font-semibold text-red-400">
                    {fieldErrors.newPassword}
                  </p>
                ) : (
                  <p id="newPassword-hint" className="mt-1 text-xs text-slate-400">
                    At least 8 characters.
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="confirmPassword" className="mb-1 block text-sm font-semibold text-slate-300">
                  Confirm new password
                </label>
                <input
                  id="confirmPassword"
                  // Follows the same eye toggle as the box above: the two are
                  // meant to hold the same text, and revealing only one makes
                  // them harder to compare.
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  aria-invalid={fieldErrors.confirmPassword ? true : undefined}
                  aria-describedby={fieldErrors.confirmPassword ? 'confirmPassword-error' : undefined}
                  className={`w-full rounded-xl border bg-slate-800/80 px-4 py-3 text-white placeholder-slate-500 transition duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
                    fieldErrors.confirmPassword
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                      : 'border-slate-700 focus:border-brand-500'
                  }`}
                  placeholder="Type it again"
                />
                {fieldErrors.confirmPassword ? (
                  <p id="confirmPassword-error" className="mt-1.5 text-xs font-semibold text-red-400">
                    {fieldErrors.confirmPassword}
                  </p>
                ) : null}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-bold text-white shadow-lg transition duration-200 hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? <Spinner className="h-5 w-5" /> : null}
                {submitting ? 'Changing password…' : 'Change password'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => void requestCode({ resend: true })}
                  disabled={sending || cooldown > 0 || submitting}
                  className="text-sm font-semibold text-brand-400 underline underline-offset-2 disabled:cursor-not-allowed disabled:text-slate-500 disabled:no-underline"
                >
                  {sending
                    ? 'Sending…'
                    : cooldown > 0
                      ? `Resend code in ${cooldown}s`
                      : 'Resend code'}
                </button>
                <p className="mt-1.5 text-xs text-slate-500">
                  No email? Check your spam folder, or{' '}
                  <button
                    type="button"
                    onClick={() => {
                      // Back to step one to fix a mistyped address. The code
                      // already sent stays valid for whoever owns that inbox;
                      // requesting one for the corrected address retires it.
                      setStep('email');
                      setCode('');
                      setError(null);
                      setFieldErrors({});
                      setNotice(null);
                    }}
                    className="font-semibold text-slate-400 underline underline-offset-2 hover:text-slate-200"
                  >
                    use a different address
                  </button>
                  .
                </p>
              </div>
            </form>
          )}

          {step === 'done' ? null : (
            <div className="border-t border-slate-800 pt-4 text-center">
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-400 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Back to sign in
              </Link>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
          <Sprout className="h-4 w-4 text-brand-500" aria-hidden />
          Smart Farm Decision Support System
        </div>
      </div>
    </div>
  );
}
