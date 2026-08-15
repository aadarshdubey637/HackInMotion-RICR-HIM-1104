'use client';

import { useCallback, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Sprout, CheckCircle2, TrendingUp, Droplet, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spinner, Notice } from '@/components/ui';
import { LanguageSwitcher } from '@/components/language-switcher';
import { GoogleSignIn } from '@/components/google-sign-in';
import { useTranslation } from '@/lib/language-context';

/**
 * Registration — one form, one submit.
 *
 * Everything the account needs is collected here: full name, Gmail address,
 * mobile number and a password typed twice. The server validates the same rules
 * again, checks the identifiers are free, hashes the password with bcrypt and
 * signs the farmer in with the tokens it returns.
 *
 * No username. The Gmail address is what signs the farmer in, what the
 * verification and reset codes go to, and what "Continue with Google" matches
 * on — a separate name to invent, have rejected as taken, and then remember was
 * a box that earned nothing.
 */

/** Field-level messages from the API, keyed the way `validate.ts` sends them. */
type FieldErrors = Record<string, string>;

export default function RegisterPage() {
  const { register } = useAuth();
  const { t, language } = useTranslation();

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);

  /** Clear one field's error as soon as the farmer edits it. */
  function clearFieldError(key: string) {
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    clearFieldError(key);
  }

  /**
   * Turn a failure into either inline field errors or one banner — never both,
   * so a farmer is not told the same thing twice in two places.
   */
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});

    // Checked here for an instant answer; the server checks it too and is the
    // one that decides. Saves a round trip on the most common typo.
    if (form.password !== form.confirmPassword) {
      setFieldErrors({ confirmPassword: 'Both passwords must match' });
      return;
    }

    setSubmitting(true);

    try {
      // Save the language picked on this screen, so the account opens in it
      // on any other device.
      await register({ ...form, language });
      // On success the auth context stores the tokens and navigates to email
      // verification, which is where the farmer enters the code we just sent.
      // Leave `submitting` set so a double-tap cannot fire again.
    } catch (err) {
      setSubmitting(false);
      showError(err, 'Could not create your account. Please try again.');
    }
  }

  return (
    <div className="relative min-h-dvh bg-slate-900 lg:grid lg:grid-cols-2">
      {/* Mobile background blurred image */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-10 blur-sm lg:hidden"
        style={{ backgroundImage: 'url("/images/smart_farm_hero.png")' }}
      />

      {/* Left panel: Desktop only hero illustration with glassmorphism overlays */}
      <div
        className="relative hidden flex-col justify-between p-12 text-white bg-cover bg-center lg:flex"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(15, 23, 42, 0.8), rgba(15, 23, 42, 0.45)), url("/images/smart_farm_hero.png")',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 shadow-md">
            <Sprout className="h-6 w-6 text-white" aria-hidden />
          </div>
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">
            Smart Farm
          </span>
        </div>

        <div className="space-y-6 max-w-md">
          <h2 className="text-4xl font-extrabold leading-tight text-white/90 drop-shadow-sm">
            Empowering growth through smart advisories.
          </h2>
          <p className="text-slate-300 text-base">
            Get weather-based irrigation guides, automatic crop health checks, and local market
            prices directly in your language.
          </p>

          {/* Interactive glassmorphism stats cards */}
          <div className="space-y-3 pt-4">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md shadow-lg transition duration-300 hover:bg-white/10">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <Droplet className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Soil Moisture
                </p>
                <p className="text-sm font-bold text-white">64% — Optimal level for Tomato</p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md shadow-lg transition duration-300 hover:bg-white/10">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Market Price Trend
                </p>
                <p className="text-sm font-bold text-white">Wheat prices rising by 5% in Lucknow</p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md shadow-lg transition duration-300 hover:bg-white/10">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Today&rsquo;s Advisory
                </p>
                <p className="text-sm font-bold text-white">
                  Irrigate early morning to prevent evaporation
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-slate-400 text-xs">
          © {new Date().getFullYear()} Smart Farm Decision Support System.
        </div>
      </div>

      {/* Right panel: Registration Form */}
      <div className="relative flex min-h-dvh flex-col justify-center px-4 py-12 sm:px-6 lg:px-8 bg-slate-900/90 lg:bg-slate-950">
        <div className="absolute right-4 top-4 z-10">
          <LanguageSwitcher variant="inline" />
        </div>

        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/25 lg:hidden">
            <Sprout className="h-6 w-6 text-white" aria-hidden />
          </div>
          <h2 className="text-center text-3xl font-extrabold tracking-tight text-white">
            {t('auth.createAccount')}
          </h2>
          <p className="mt-2 text-center text-sm text-slate-400">{t('auth.takesAMinute')}</p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-900 border border-slate-800 py-8 px-4 shadow sm:rounded-3xl sm:px-10 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error ? <Notice tone="warn">{error}</Notice> : null}

              <Field
                id="name"
                label={t('auth.name')}
                value={form.name}
                onChange={(v) => update('name', v)}
                error={fieldErrors.name}
                autoComplete="name"
                placeholder="Ramesh Kumar"
                required
              />

              <Field
                id="email"
                label="Gmail address"
                type="email"
                inputMode="email"
                value={form.email}
                onChange={(v) => update('email', v)}
                error={fieldErrors.email}
                // `username`, not `email`: this is the field the farmer will
                // sign in with, and telling the password manager so is what
                // makes it offer the pair back on the login screen.
                autoComplete="username"
                placeholder="you@gmail.com"
                hint="You will sign in with this. Must end in @gmail.com, so “Continue with Google” works on this account too."
                autoCapitalize="none"
                autoCorrect="off"
                required
              />

              <Field
                id="phone"
                label="Mobile number"
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(v) => update('phone', v)}
                error={fieldErrors.phone}
                autoComplete="tel"
                placeholder="98765 43210"
                hint="10-digit Indian mobile number."
                required
              />

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-slate-300 mb-1"
                >
                  {t('auth.password')}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    value={form.password}
                    onChange={(e) => update('password', e.target.value)}
                    aria-invalid={fieldErrors.password ? true : undefined}
                    aria-describedby={fieldErrors.password ? 'password-error' : 'password-hint'}
                    className={`w-full rounded-xl border bg-slate-800/80 px-4 py-3 pr-12 text-white placeholder-slate-500 transition duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
                      fieldErrors.password
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
                {fieldErrors.password ? (
                  <p id="password-error" className="mt-1.5 text-xs font-semibold text-red-400">
                    {fieldErrors.password}
                  </p>
                ) : (
                  <p id="password-hint" className="mt-1 text-xs text-slate-400">
                    At least 8 characters.
                  </p>
                )}
              </div>

              <Field
                id="confirmPassword"
                label="Confirm password"
                // Both boxes follow the eye toggle together: they are meant to hold
                // the same text, and revealing only one makes them harder to compare.
                type={showPassword ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={(v) => update('confirmPassword', v)}
                error={fieldErrors.confirmPassword}
                autoComplete="new-password"
                placeholder="Type it again"
                required
              />

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex justify-center items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 py-3 text-sm font-bold text-white shadow-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Spinner className="h-5 w-5" /> : null}
                {submitting ? 'Creating account…' : 'Create account'}
              </button>

              {/* "Sign up with Google" wording here — same flow, but this is the
                  screen where the farmer expects to be creating something. A Google
                  account needs no password and no mobile number. */}
              <GoogleSignIn text="signup_with" />
            </form>

            <div className="pt-4 border-t border-slate-800 text-center">
              <p className="text-sm text-slate-400">
                {t('auth.alreadyAccount')}{' '}
                <Link
                  href="/login"
                  className="font-bold text-brand-400 hover:text-brand-300 underline underline-offset-4"
                >
                  {t('auth.signIn')}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'id'>) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-slate-300 mb-1">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`w-full rounded-xl border bg-slate-800/80 px-4 py-3 text-white placeholder-slate-500 transition duration-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
            : 'border-slate-700 focus:border-brand-500'
        }`}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-semibold text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
