'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MailCheck, CheckCircle2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api, ApiError } from '@/lib/api';
import { Spinner, Notice, LoadingBlock } from '@/components/ui';
import { OtpInput } from '@/components/otp-input';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useTranslation } from '@/lib/language-context';

/**
 * Email verification — the step between registering and the dashboard.
 *
 * The farmer arrives here already signed in: `register` stores the tokens before
 * navigating, because both OTP endpoints are authenticated and the server reads
 * the destination address off the account rather than from the request.
 *
 * A code is requested automatically on arrival, so the common path is "read the
 * mail, type six digits, done" with nothing to tap first.
 */

const CODE_LENGTH = 6;

export default function VerifyEmailPage() {
  const router = useRouter();
  const { user, loading, setUser, continueToApp } = useAuth();
  const { t } = useTranslation();

  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  /** Set when the server has no mailbox configured — see `undeliverable` below. */
  const [undeliverable, setUndeliverable] = useState(false);

  /**
   * The automatic first send must happen exactly once.
   *
   * React runs effects twice in development, and a second send lands inside the
   * server's 60-second cooldown — so without this the very first thing a new
   * farmer would see is "please wait 60 seconds", on a screen they had not yet
   * touched.
   */
  const requestedOnce = useRef(false);

  /**
   * In-flight guard for submission.
   *
   * A ref rather than the `verifying` state, because state is not set
   * synchronously: typing the sixth digit fires `onComplete` and pressing Enter
   * fires the form, and two calls landing in the same tick would both read
   * `verifying === false`. Submitting the same wrong code twice would spend two
   * of the five attempts for one mistake.
   */
  const inFlight = useRef(false);

  /** Tick the resend countdown down to zero. */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const sendCode = useCallback(
    async (options: { automatic?: boolean } = {}) => {
      setSending(true);
      setError(null);
      setFieldError(null);
      if (!options.automatic) setNotice(null);

      try {
        const result = await api.auth.sendOtp();
        setCooldown(result.resendAfter);
        setNotice(t('auth.otpSent', { email: result.email }));
      } catch (err) {
        if (err instanceof ApiError) {
          // A reload lands inside the cooldown from the previous visit. That is
          // not a failure the farmer caused, so it starts the countdown instead
          // of showing a red banner on a screen they just opened.
          const retryAfter = Number(err.details?.retryAfter);
          if (err.status === 429) {
            setCooldown(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60);
            if (!options.automatic) setError(err.message);
            return;
          }

          // The mailbox is unconfigured or Gmail refused the message. No amount
          // of tapping "Resend" fixes that, so offer the way out instead.
          if (err.code === 'EXTERNAL_SERVICE_ERROR') setUndeliverable(true);

          setError(err.message);
          return;
        }

        setError(t('auth.otpSendFailed'));
      } finally {
        setSending(false);
      }
    },
    [t],
  );

  const submitCode = useCallback(
    async (submitted: string) => {
      if (submitted.length !== CODE_LENGTH || inFlight.current) return;

      inFlight.current = true;
      setVerifying(true);
      setError(null);
      setFieldError(null);
      setNotice(null);

      try {
        const { user: updated } = await api.auth.verifyEmail(submitted);
        setUser(updated);
        setVerified(true);
        // Farms load and the router moves on; the success state below is what
        // the farmer sees while that happens.
        await continueToApp();
      } catch (err) {
        // Only released on failure. A success navigates away, and clearing the
        // guard there would let a late second submit fire during the transition.
        inFlight.current = false;
        setVerifying(false);
        setCode('');

        if (err instanceof ApiError) {
          // The server keys its code errors to the `code` field, so they belong
          // under the boxes rather than in the banner at the top.
          const detail = err.details?.code;
          if (detail) setFieldError(detail);
          else setError(err.message);
          return;
        }

        setError(t('auth.otpVerifyFailed'));
      }
    },
    [continueToApp, setUser, t],
  );

  // Arrival: bounce anyone who should not be here, then request the first code.
  useEffect(() => {
    if (loading) return;

    if (!user) {
      router.replace('/login');
      return;
    }

    // Already verified — including a farmer who signed up with Google, who was
    // verified by Google and has no code to enter. Never strand them here.
    if (user.isVerified) {
      void continueToApp();
      return;
    }

    if (requestedOnce.current) return;
    requestedOnce.current = true;
    void sendCode({ automatic: true });
  }, [loading, user, router, continueToApp, sendCode]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submitCode(code);
  }

  /** Leave without verifying. The account works; `isVerified` simply stays false. */
  function skipForNow() {
    void continueToApp();
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-soil-50">
        <LoadingBlock />
      </div>
    );
  }

  if (verified) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-soil-50 px-4">
        <div className="card flex w-full max-w-sm flex-col items-center gap-3 p-8 text-center">
          <div className="rounded-full bg-emerald-100 p-3">
            <CheckCircle2 className="h-7 w-7 text-emerald-700" aria-hidden />
          </div>
          <h1 className="text-xl font-bold text-slate-900">{t('auth.otpVerified')}</h1>
          <p className="text-sm text-slate-600">{t('auth.otpVerifiedGoing')}</p>
          <Spinner className="mt-1 h-5 w-5 text-brand-600" />
        </div>
      </div>
    );
  }

  const complete = code.length === CODE_LENGTH;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-soil-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex justify-end">
          <LanguageSwitcher variant="inline" />
        </div>

        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/25">
            <MailCheck className="h-8 w-8 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{t('auth.otpTitle')}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {t('auth.otpSubtitle')}{' '}
            {/* The address is shown so a farmer who mistyped it can tell at a
                glance, without having to open their inbox to find out. */}
            <span className="font-semibold text-slate-800">{user.email}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-5 p-6">
          {error ? <Notice tone="warn">{error}</Notice> : null}
          {!error && notice ? <Notice tone="success">{notice}</Notice> : null}

          <div>
            <p id="otp-label" className="label text-center">
              {t('auth.otpLabel')}
            </p>
            <OtpInput
              value={code}
              onChange={(next) => {
                setCode(next);
                setFieldError(null);
              }}
              // Typing the sixth digit submits. The farmer has finished the only
              // action this screen asks for; making them reach for a button too
              // is a tap that earns nothing.
              onComplete={(full) => void submitCode(full)}
              disabled={verifying}
              invalid={Boolean(fieldError)}
              describedBy={fieldError ? 'otp-error' : 'otp-hint'}
              length={CODE_LENGTH}
            />

            {fieldError ? (
              <p
                id="otp-error"
                role="alert"
                className="mt-2 text-center text-sm font-medium text-red-700"
              >
                {fieldError}
              </p>
            ) : (
              <p id="otp-hint" className="mt-2 text-center text-xs text-slate-500">
                {t('auth.otpExpires')}
              </p>
            )}
          </div>

          <button type="submit" disabled={!complete || verifying} className="btn-primary w-full">
            {verifying ? (
              <Spinner className="h-5 w-5" />
            ) : (
              <ShieldCheck className="h-5 w-5" aria-hidden />
            )}
            {verifying ? t('auth.otpVerifying') : t('auth.otpVerify')}
          </button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={sending || cooldown > 0 || verifying}
              className="text-sm font-semibold text-brand-700 underline underline-offset-2 disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
            >
              {sending
                ? t('auth.otpSending')
                : cooldown > 0
                  ? t('auth.otpResendIn', { seconds: cooldown })
                  : t('auth.otpResend')}
            </button>
            <p className="mt-1.5 text-xs text-slate-500">{t('auth.otpCheckSpam')}</p>
          </div>
        </form>

        {/* Always offered, not only on failure. Nothing in the app is gated on
            `isVerified`, and a farmer standing in a field with no signal — or
            hitting a mail outage — must not be walled out of the account they
            just created. `undeliverable` only makes it louder. */}
        <div className="mt-5 text-center">
          {undeliverable ? (
            <button type="button" onClick={skipForNow} className="btn-secondary w-full">
              {t('auth.otpContinueAnyway')}
            </button>
          ) : (
            <button
              type="button"
              onClick={skipForNow}
              className="text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-800"
            >
              {t('auth.otpLater')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
