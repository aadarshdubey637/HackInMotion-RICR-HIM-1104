'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Sprout, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spinner, Notice } from '@/components/ui';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useTranslation } from '@/lib/language-context';

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(email, password);
      // On success the auth context navigates away; keep the button disabled
      // so a double-tap cannot fire a second request.
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : t('auth.serverError'));
    }
  }

  /** Prefill the judge/demo account — saves typing during a live demo. */
  function useDemoAccount() {
    setEmail('farmer@demo.com');
    setPassword('demo1234');
    setError(null);
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-soil-50 px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Language first: a farmer cannot be asked to read an English screen
            in order to find the control that makes the app readable. */}
        <div className="mb-3 flex justify-end">
          <LanguageSwitcher variant="inline" />
        </div>

        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/25">
            <Sprout className="h-8 w-8 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{t('auth.loginTitle')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('auth.loginSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6">
          <h2 className="text-lg font-bold text-slate-800">{t('auth.signIn')}</h2>

          {error ? <Notice tone="warn">{error}</Notice> : null}

          <div>
            <label htmlFor="email" className="label">
              {t('auth.email')}
            </label>
            <input
              id="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="label">
              {t('auth.password')}
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="field pr-12"
                placeholder="Your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1 flex h-[40px] w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-soil-100"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? <Spinner className="h-5 w-5" /> : null}
            {submitting ? t('common.loading') : t('auth.signIn')}
          </button>

          <button type="button" onClick={useDemoAccount} className="btn-ghost w-full text-sm">
            Use the demo account
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          {t('auth.noAccount')}{' '}
          <Link href="/register" className="font-semibold text-brand-700 underline underline-offset-2">
            {t('auth.register')}
          </Link>
        </p>
      </div>
    </div>
  );
}
