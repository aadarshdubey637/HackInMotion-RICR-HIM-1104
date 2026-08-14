'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Sprout, CheckCircle2, TrendingUp, Droplet } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { Spinner, Notice } from '@/components/ui';
import { LanguageSwitcher } from '@/components/language-switcher';
import { useTranslation } from '@/lib/language-context';

export default function RegisterPage() {
  const { register } = useAuth();
  const { t, language } = useTranslation();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function update(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // Clear a field's error as soon as the user edits it.
    setFieldErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);

    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        // Save the language picked on this screen, so the account opens in it
        // on any other device.
        language,
      });
    } catch (err) {
      setSubmitting(false);
      if (err instanceof ApiError) {
        // Surface per-field messages inline where the backend gave them.
        if (err.details) setFieldErrors(err.details);
        setError(err.details ? null : err.message);
      } else {
        setError('Could not create your account. Please try again.');
      }
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
        style={{ backgroundImage: 'linear-gradient(to right, rgba(15, 23, 42, 0.8), rgba(15, 23, 42, 0.45)), url("/images/smart_farm_hero.png")' }}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 shadow-md">
            <Sprout className="h-6 w-6 text-white" aria-hidden />
          </div>
          <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-emerald-400 to-green-500 bg-clip-text text-transparent">Smart Farm</span>
        </div>

        <div className="space-y-6 max-w-md">
          <h2 className="text-4xl font-extrabold leading-tight text-white/90 drop-shadow-sm">
            Empowering growth through smart advisories.
          </h2>
          <p className="text-slate-300 text-base">
            Get weather-based irrigation guides, automatic crop health checks, and local market prices directly in your language.
          </p>

          {/* Interactive glassmorphism stats cards */}
          <div className="space-y-3 pt-4">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md shadow-lg transition duration-300 hover:bg-white/10">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
                <Droplet className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Soil Moisture</p>
                <p className="text-sm font-bold text-white">64% — Optimal level for Tomato</p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md shadow-lg transition duration-300 hover:bg-white/10">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Market Price Trend</p>
                <p className="text-sm font-bold text-white">Wheat prices rising by 5% in Lucknow</p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-md shadow-lg transition duration-300 hover:bg-white/10">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/20 text-blue-400">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Today's Advisory</p>
                <p className="text-sm font-bold text-white">Irrigate early morning to prevent evaporation</p>
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
          <p className="mt-2 text-center text-sm text-slate-400">
            {t('auth.takesAMinute')}
          </p>
        </div>

        <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
          <div className="bg-slate-900 border border-slate-800 py-8 px-4 shadow sm:rounded-3xl sm:px-10 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-5">
              {error ? <Notice tone="warn">{error}</Notice> : null}

              <Field
                id="name"
                label="Your name"
                value={form.name}
                onChange={(v) => update('name', v)}
                error={fieldErrors.name}
                autoComplete="name"
                placeholder="Ramesh Kumar"
                required
              />

              <Field
                id="email"
                label="Email"
                type="email"
                inputMode="email"
                value={form.email}
                onChange={(v) => update('email', v)}
                error={fieldErrors.email}
                autoComplete="email"
                placeholder="you@example.com"
                required
              />

              <Field
                id="phone"
                label="Phone (optional)"
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(v) => update('phone', v)}
                error={fieldErrors.phone}
                autoComplete="tel"
                placeholder="+91 98765 43210"
              />

              <Field
                id="password"
                label="Password"
                type="password"
                value={form.password}
                onChange={(v) => update('password', v)}
                error={fieldErrors.password}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                hint="At least 8 characters."
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
            </form>

            <div className="pt-4 border-t border-slate-800 text-center">
              <p className="text-sm text-slate-400">
                Already have an account?{' '}
                <Link href="/login" className="font-bold text-brand-400 hover:text-brand-300 underline underline-offset-4">
                  Sign in
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
          error ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-slate-700 focus:border-brand-500'
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
