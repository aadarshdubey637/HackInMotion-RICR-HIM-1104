'use client';

import type { ReactNode } from 'react';
import {
  AlertTriangle,
  Info,
  CheckCircle2,
  Loader2,
  WifiOff,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Severity, ActionPriority, HealthSeverity } from '@/lib/types';

// ─────────────────────────── Severity styling ───────────────────────────

/**
 * One source of truth for severity colour. Every alert, badge and card border
 * reads from here, so "red" always means the same thing across the app.
 */
export const severityStyles: Record<
  Severity | ActionPriority,
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  CRITICAL: {
    bg: 'bg-red-50',
    border: 'border-red-300',
    text: 'text-red-800',
    dot: 'bg-red-600',
    label: 'Urgent',
  },
  HIGH: {
    bg: 'bg-orange-50',
    border: 'border-orange-300',
    text: 'text-orange-800',
    dot: 'bg-orange-500',
    label: 'Important',
  },
  MEDIUM: {
    bg: 'bg-amber-50',
    border: 'border-amber-300',
    text: 'text-amber-900',
    dot: 'bg-amber-500',
    label: 'Watch',
  },
  LOW: {
    bg: 'bg-cyan-50',
    border: 'border-cyan-300',
    text: 'text-cyan-900',
    dot: 'bg-cyan-600',
    label: 'Minor',
  },
  INFO: {
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    text: 'text-slate-700',
    dot: 'bg-slate-500',
    label: 'Info',
  },
};

export const healthSeverityStyles: Record<HealthSeverity, { bg: string; text: string; label: string }> = {
  CRITICAL: { bg: 'bg-red-100', text: 'text-red-800', label: 'Critical' },
  SEVERE: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Severe' },
  MODERATE: { bg: 'bg-amber-100', text: 'text-amber-900', label: 'Moderate' },
  MILD: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Mild' },
};

// ─────────────────────────── Primitives ───────────────────────────

export function Card({
  children,
  className,
  ...rest
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('card p-4 sm:p-5', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionHeading({
  icon: Icon,
  title,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
        {Icon ? <Icon className="h-5 w-5 text-brand-700" aria-hidden /> : null}
        {title}
      </h2>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'brand' | 'warn' | 'danger' | 'success';
  className?: string;
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700',
    brand: 'bg-brand-100 text-brand-800',
    warn: 'bg-amber-100 text-amber-900',
    danger: 'bg-red-100 text-red-800',
    success: 'bg-emerald-100 text-emerald-800',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

// ─────────────────────────── Feedback states ───────────────────────────

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin', className)} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500">
      <Spinner className="h-7 w-7 text-brand-600" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card space-y-3 p-5">
      <div className="skeleton h-4 w-1/3" />
      <div className="skeleton h-8 w-2/3" />
      <div className="skeleton h-3 w-full" />
      <div className="skeleton h-3 w-4/5" />
    </div>
  );
}

/**
 * Error state. Never a dead end — always offers a way forward, because a
 * farmer hitting this in a field needs an action, not a stack trace.
 */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  offline,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  offline?: boolean;
}) {
  const Icon = offline ? WifiOff : AlertTriangle;

  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <div className="rounded-full bg-amber-100 p-3">
        <Icon className="h-6 w-6 text-amber-700" aria-hidden />
      </div>
      <div>
        <h3 className="font-bold text-slate-800">{title}</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-600">{message}</p>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn-secondary mt-1">
          <RefreshCw className="h-4 w-4" aria-hidden />
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon = Info,
  title,
  message,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-3 p-8 text-center">
      <div className="rounded-full bg-brand-50 p-3">
        <Icon className="h-6 w-6 text-brand-700" aria-hidden />
      </div>
      <div>
        <h3 className="font-bold text-slate-800">{title}</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-600">{message}</p>
      </div>
      {action}
    </div>
  );
}

/** Inline notice for partial failures and stale-data warnings. */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'success';
  children: ReactNode;
}) {
  const config = {
    info: { cls: 'bg-slate-50 border-slate-200 text-slate-700', Icon: Info },
    warn: { cls: 'bg-amber-50 border-amber-200 text-amber-900', Icon: AlertTriangle },
    success: { cls: 'bg-emerald-50 border-emerald-200 text-emerald-900', Icon: CheckCircle2 },
  }[tone];

  return (
    <div className={cn('flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm', config.cls)}>
      <config.Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A labelled statistic. Used across weather, water balance and market cards. */
export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: string;
  tone?: 'default' | 'danger' | 'success';
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-xl font-bold tabular-nums',
          tone === 'danger' && 'text-red-700',
          tone === 'success' && 'text-emerald-700',
          (!tone || tone === 'default') && 'text-slate-900',
        )}
      >
        {value}
        {unit ? <span className="ml-0.5 text-sm font-semibold text-slate-500">{unit}</span> : null}
      </p>
      {hint ? <p className="text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}
