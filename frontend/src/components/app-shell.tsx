'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  CloudSun,
  Stethoscope,
  TrendingUp,
  Sprout,
  FlaskConical,
  LogOut,
  MapPin,
  ChevronDown,
  MoreHorizontal,
  X,
  WifiOff,
  AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useOfflineState, describeAge } from '@/lib/offline';
import { ensureFlushListener } from '@/lib/api';
import { useTranslation } from '@/lib/language-context';
import { cn } from '@/lib/utils';
import { Spinner } from './ui';
import { LanguageSwitcher } from './language-switcher';
import { VoiceAssistant } from './voice-assistant';

/** Primary destinations — these get bottom-bar slots on mobile. */
const PRIMARY = [
  { href: '/dashboard', labelKey: 'nav.today', icon: LayoutDashboard },
  { href: '/weather', labelKey: 'nav.water', icon: CloudSun },
  { href: '/health', labelKey: 'nav.health', icon: Stethoscope },
  { href: '/market', labelKey: 'nav.prices', icon: TrendingUp },
] as const;

/** Secondary destinations — behind "More" on mobile, inline on desktop. */
const SECONDARY = [
  { href: '/recommendations', labelKey: 'nav.recommendations', icon: Sprout, hintKey: 'nav.recommendationsHint' },
  { href: '/planning', labelKey: 'nav.planning', icon: FlaskConical, hintKey: 'nav.planningHint' },
  { href: '/community', labelKey: 'nav.community', icon: AlertTriangle, hintKey: 'nav.communityHint' },
  { href: '/crops', labelKey: 'nav.farm', icon: MapPin, hintKey: 'nav.farmHint' },
] as const;

/**
 * Authenticated app shell.
 *
 * Four primary destinations plus a "More" sheet on mobile — a five-slot bottom
 * bar stays thumb-reachable, and cramming seven icons in would make each one
 * too small to hit reliably outdoors. Desktop shows all seven in the sidebar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading, farms, currentFarm, selectFarm, logout } = useAuth();
  const { online, pending, oldestCacheMs } = useOfflineState();
  const { t, syncFromProfile } = useTranslation();

  // Register the queue-flush listener once the shell mounts.
  useEffect(() => {
    ensureFlushListener();
  }, []);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (farms.length === 0) router.replace('/onboarding');
  }, [user, farms, loading, router]);

  // Adopt the language saved on the account when this device has no choice of
  // its own — a farmer signing in on a new phone should not land in English.
  useEffect(() => {
    syncFromProfile(user?.language);
  }, [user?.language, syncFromProfile]);

  // Close the sheet on navigation, otherwise it lingers over the new page.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-8 w-8 text-brand-600" />
      </div>
    );
  }

  const secondaryActive = SECONDARY.some((item) => item.href === pathname);

  return (
    <div className="min-h-dvh lg:flex">
      {/* ── Desktop sidebar ── */}
      <aside className="hidden w-64 shrink-0 border-r border-soil-200 bg-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2 border-b border-soil-200 px-5 py-4">
          <Sprout className="h-6 w-6 text-brand-600" aria-hidden />
          <span className="text-lg font-bold text-slate-800">Smart Farm</span>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {[...PRIMARY, ...SECONDARY].map(({ href, labelKey, icon: Icon }) => {
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
                {t(labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-soil-200 p-3">
          <p className="px-3 text-sm font-semibold text-slate-700">{user.name}</p>
          <p className="mb-2 px-3 text-xs text-slate-500">{user.email}</p>
          <button type="button" onClick={logout} className="btn-ghost w-full justify-start text-sm">
            <LogOut className="h-4 w-4" aria-hidden />
            {t('nav.signOut')}
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
                      aria-label={t('common.chooseFarm')}
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
                    {currentFarm?.name ?? t('common.myFarm')}
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

            {/* Language is reachable from every screen, not buried in a
                settings page — a farmer handed a phone in the wrong language
                cannot navigate to a settings page to fix it. */}
            <div className="flex shrink-0 items-center gap-1">
              <LanguageSwitcher />
              <button
                type="button"
                onClick={logout}
                aria-label={t('nav.signOut')}
                className="btn-ghost shrink-0 px-2 lg:hidden"
              >
                <LogOut className="h-5 w-5" aria-hidden />
              </button>
            </div>
          </div>

          {/* Connectivity banner — the app keeps working from cache. */}
          {!online ? (
            <div className="flex flex-col gap-0.5 bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-900">
              <div className="flex items-center gap-2">
                <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  {t('common.offlineBanner')}
                  {oldestCacheMs !== null
                    ? ` Data from ${describeAge(oldestCacheMs)}.`
                    : ' No cached data available.'}
                </span>
              </div>
              {pending > 0 ? (
                <div className="ml-5 text-amber-800">
                  {pending} action{pending === 1 ? '' : 's'} waiting to sync when you reconnect.
                </div>
              ) : null}
            </div>
          ) : pending > 0 ? (
            <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 text-xs font-semibold text-blue-800">
              <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden />
              Syncing {pending} offline action{pending === 1 ? '' : 's'}…
            </div>
          ) : null}
        </header>

        <main className="mx-auto w-full max-w-4xl flex-1 px-4 pb-24 pt-4 lg:pb-8">{children}</main>

        {/* Voice is available on every screen, not just the dashboard — the
            farmer who wants prices should be able to ask from anywhere. */}
        <VoiceAssistant />

        {/* ── Mobile "More" sheet ── */}
        {moreOpen ? (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
            />
            <div
              className="fixed inset-x-0 bottom-0 z-50 rounded-t-3xl border-t border-soil-200 bg-white p-4 pb-8 lg:hidden"
              style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800">{t('nav.more')}</h2>
                <button
                  type="button"
                  onClick={() => setMoreOpen(false)}
                  aria-label={t('voice.close')}
                  className="btn-ghost px-2"
                >
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>

              <div className="space-y-2">
                {SECONDARY.map(({ href, labelKey, icon: Icon, hintKey }) => (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border p-3 transition',
                      pathname === href
                        ? 'border-brand-600 bg-brand-50'
                        : 'border-soil-200 bg-white active:bg-soil-50',
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0 text-brand-700" aria-hidden />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800">{t(labelKey)}</p>
                      <p className="text-xs text-slate-500">{t(hintKey)}</p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {/* ── Mobile bottom navigation ── */}
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-soil-200 bg-white/98 backdrop-blur lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="mx-auto grid max-w-lg grid-cols-5">
            {PRIMARY.map(({ href, labelKey, icon: Icon }) => {
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
                  {t(labelKey)}
                </Link>
              );
            })}

            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              className={cn(
                'flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition',
                moreOpen || secondaryActive ? 'text-brand-700' : 'text-slate-500',
              )}
            >
              <MoreHorizontal
                className={cn('h-5 w-5', (moreOpen || secondaryActive) && 'stroke-[2.5]')}
                aria-hidden
              />
              {t('nav.more')}
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
