'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Sprout } from 'lucide-react';
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
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-soil-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-3 flex justify-end">
          <LanguageSwitcher variant="inline" />
        </div>

        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 shadow-lg shadow-brand-600/25">
            <Sprout className="h-8 w-8 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{t('auth.createAccount')}</h1>
          <p className="mt-1 text-sm text-slate-600">{t('auth.takesAMinute')}</p>
        </div>

        <form onSubmit={handleSubmit} className="card space-y-4 p-6">
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

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? <Spinner className="h-5 w-5" /> : null}
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-600">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-brand-700 underline underline-offset-2">
            Sign in
          </Link>
        </p>
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
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={`field ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : ''}`}
        {...rest}
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
