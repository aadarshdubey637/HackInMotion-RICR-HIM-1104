'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  CloudSun,
  Stethoscope,
  TrendingUp,
  Sprout,
  LogOut,
  MapPin,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { Spinner } from './ui';

const NAV = [
  { href: '/dashboard', label: 'Today', icon: LayoutDashboard },
  { href: '/weather', label: 'Water', icon: CloudSun },
  { href: '/health', label: 'Health', icon: Stethoscope },
  { href: '/market', label: 'Prices', icon: TrendingUp },
  { href: '/crops', label: 'Crops', icon: Sprout },
] as const;

/**
 * Authenticated app shell.
 *
 * Bottom tab bar on mobile (thumb-reachable, five destinations max), sidebar
 * on desktop. Guards every child page behind a session check.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, farms, currentFarm, selectFarm, logout } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (farms.length === 0) router.replace('/onboarding');
  }, [user, farms, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:flex">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden w-64 shrink-0 border-r border-soil-200 bg-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2 border-b border-soil-200 px-5 py-4">
          <Sprout className="h-6 w-6 text-brand-600" aria-hidden />
          <span className="text-lg font-bold text-slate-800">Smart Farm</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                  active ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-soil-100',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-soil-200 p-3">
          <p className="px-3 text-sm font-semibold text-slate-700">{user.name}</p>
          <p className="mb-2 px-3 text-xs text-slate-500">{user.email}</p>
          <button type="button" onClick={logout} className="btn-ghost w-full justify-start text-sm">
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ── Top bar ── */}
        <header className="sticky top-0 z-20 border-b border-soil-200 bg-white/95 backdrop-blur">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Sprout className="h-6 w-6 shrink-0 text-brand-600 lg:hidden" aria-hidden />
              <div className="min-w-0">
                {farms.length > 1 ? (
                  <div className="relative">
                    <select
                      value={currentFarm?.id ?? ''}
                      onChange={(e) => selectFarm(e.target.value)}
                      aria-label="Choose farm"
                      className="w-full appearance-none truncate bg-transparent pr-6 text-base font-bold text-slate-800"
                    >
                      {farms.map((farm) => (
                        <option key={farm.id} value={farm.id}>
                          {farm.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-0 top-1.5 h-4 w-4 text-slate-500"
                      aria-hidden
                    />
                  </div>
                ) : (
                  <p className="truncate text-base font-bold text-slate-800">
                    {currentFarm?.name ?? 'My farm'}
                  </p>
                )}
                {currentFarm?.address ? (
                  <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                    {currentFarm.address}
                  </p>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              aria-label="Sign out"
              className="btn-ghost shrink-0 px-2 lg:hidden"
            >
              <LogOut className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-4 lg:pb-8">{children}</main>

        {/* ── Mobile bottom navigation ── */}
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-soil-200 bg-white/98 backdrop-blur lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition',
                    active ? 'text-brand-700' : 'text-slate-500',
                  )}
                >
                  <Icon className={cn('h-5 w-5', active && 'stroke-[2.5]')} aria-hidden />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
