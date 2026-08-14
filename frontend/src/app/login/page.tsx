'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Sprout, Eye, EyeOff, CheckCircle2, TrendingUp, Droplet } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spinner, Notice } from '@/components/ui';
import { LanguageSwitcher } from '@/components/language-switcher';
import { GoogleSignIn } from '@/components/google-sign-in';
import { useTranslation } from '@/lib/language-context';

export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useTranslation();
  /**
   * One field for a username *or* a Gmail address.
   *
   * Two separate fields, or a toggle between them, would make a farmer decide
   * which kind of thing they are about to type before they type it. The server
   * looks up both, so there is nothing for them to decide.
   */
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await login(identifier, password);
      // On success the auth context navigates away; keep the button disabled
      // so a double-tap cannot fire a second request.
    } catch (err) {
      setSubmitting(false);
      setError(err instanceof ApiError ? err.message : t('auth.serverError'));
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

      {/* Right panel: Login Form */}
      <div className="relative flex min-h-dvh flex-col justify-center px-4 py-12 sm:px-6 lg:px-8 bg-slate-900/90 lg:bg-slate-950">
        <div className="absolute right-4 top-4 z-10">
          <LanguageSwitcher variant="inline" />
        </div>

        <div className="sm:mx-auto sm:w-full sm:max-w-md">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/25 lg:hidden">
            <Sprout className="h-6 w-6 text-white" aria-hidden />
          </div>
          <h2 className="text-center text-3xl font-extrabold tracking-tight text-white">
            {t('auth.loginTitle')}
          </h2>
          <p className="mt-2 text-center text-sm text-slate-400">{t('auth.loginSubtitle')}</p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-900 border border-slate-800 py-8 px-4 shadow sm:rounded-3xl sm:px-10 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error ? <Notice tone="warn">{error}</Notice> : null}

              <div>
                <label
                  htmlFor="identifier"
                  className="block text-sm font-semibold text-slate-300 mb-1"
                >
                  Username or Gmail
                </label>
                <input
                  id="identifier"
                  // `type="text"`, not `type="email"`: an email input refuses to
                  // submit a bare username, and the browser's own validation error
                  // would block a farmer typing exactly what they were told to.
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 text-white placeholder-slate-500 transition duration-200 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  placeholder="rameshkumar or you@gmail.com"
                />
              </div>

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
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-3 pr-12 text-white placeholder-slate-500 transition duration-200 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                    placeholder="Your password"
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
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full flex justify-center items-center gap-2 rounded-xl bg-brand-600 hover:bg-brand-500 py-3 text-sm font-bold text-white shadow-lg transition duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? <Spinner className="h-5 w-5" /> : null}
                {submitting ? t('common.loading') : t('auth.signIn')}
              </button>

              {/* <button
                type="button"
                onClick={useDemoAccount}
                className="w-full text-slate-400 hover:text-white py-2 text-sm font-semibold transition duration-200 border border-slate-800 hover:border-slate-700 bg-slate-900/50 rounded-xl"
              >
                Use the demo account
              </button> */}

              {/* Renders nothing when Google is not configured or unreachable. */}
              <GoogleSignIn />
            </form>

            <div className="pt-4 border-t border-slate-800 text-center">
              <p className="text-sm text-slate-400">
                {t('auth.noAccount')}{' '}
                <Link
                  href="/register"
                  className="font-bold text-brand-400 hover:text-brand-300 underline underline-offset-4"
                >
                  {t('auth.register')}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
