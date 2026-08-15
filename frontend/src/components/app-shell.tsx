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
  {
    href: '/recommendations',
    labelKey: 'nav.recommendations',
    icon: Sprout,
    hintKey: 'nav.recommendationsHint',
  },
  { href: '/planning', labelKey: 'nav.planning', icon: FlaskConical, hintKey: 'nav.planningHint' },
  {
    href: '/community',
    labelKey: 'nav.community',
    icon: AlertTriangle,
    hintKey: 'nav.communityHint',
  },
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
      <aside className="hidden w-64 shrink-0 border-r border-soil-200 bg-white lg:flex lg:flex-col sticky top-0 h-dvh relative overflow-hidden">
        {/* Animated scrolling leaf pattern in the background */}
        <div className="sidebar-leaves-bg" />

        <div className="flex items-center gap-2 border-b border-soil-200 px-5 py-4 z-10">
          <Sprout className="h-6 w-6 text-brand-600" aria-hidden />
          <span className="text-lg font-bold text-slate-800">Smart Farm</span>
        </div>

        {/* Decorative agriculture watermark in background */}
        <div className="absolute bottom-24 left-0 w-full pointer-events-none opacity-[0.05] text-brand-600 z-0">
          <svg
            viewBox="0 0 200 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="w-full h-auto"
          >
            {/* Rolling hills */}
            <path d="M0,80 Q50,60 100,80 T200,80 L200,100 L0,100 Z" fill="currentColor" />
            <path
              d="M0,90 Q70,75 140,90 T200,90 L200,100 L0,100 Z"
              fill="currentColor"
              opacity="0.7"
            />
            {/* Stylized crop sprouts */}
            <path d="M30,80 C33,65 30,55 25,48 C32,58 32,68 30,80" fill="currentColor" />
            <path d="M30,80 C35,70 42,65 48,60 C40,70 34,75 30,80" fill="currentColor" />
            <path d="M120,83 C123,73 120,65 115,60 C122,68 122,76 120,83" fill="currentColor" />
            <path d="M160,88 C163,78 160,70 155,65 C162,73 162,81 160,88" fill="currentColor" />
            <path d="M160,88 C165,80 172,75 178,70 C170,80 164,85 160,88" fill="currentColor" />
          </svg>
        </div>

        <nav className="flex-1 space-y-1 p-3 z-10">
          {[...PRIMARY, ...SECONDARY].map(({ href, labelKey, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'sidebar-tab flex items-center justify-between gap-3 py-2.5 text-sm font-semibold transition-all duration-300 relative overflow-hidden',
                  active
                    ? 'bg-gradient-to-r from-brand-50 to-emerald-50 text-brand-900 border-l-4 border-brand-600 pl-2 pr-10 rounded-r-xl rounded-l-none shadow-sm'
                    : 'text-slate-600 hover:bg-soil-100 pl-3 pr-3 rounded-xl',
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon className="h-5 w-5" aria-hidden />
                  {t(labelKey)}
                </div>
                {active && (
                  <svg
                    className="w-4 h-4 text-emerald-500/40 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none animate-sprout-grow"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M2,22 C8,22 12,18 12,12 C12,8 9,4 6,2 C8,6 8,10 6,12 C4,14 2,16 2,22 Z" />
                    <path d="M12,12 C12,15 15,18 18,20 C16,16 16,12 18,10 C20,8 22,8 22,8 C22,8 18,8 15,10 C13,11 12,12 12,12 Z" />
                  </svg>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-soil-200 p-3 z-10 bg-white/90 backdrop-blur-sm">
          <p className="px-3 text-sm font-semibold text-slate-700">{user.name}</p>
          <p className="mb-2 px-3 text-xs text-slate-500">{user.email}</p>
          <button type="button" onClick={logout} className="btn-ghost w-full justify-start text-sm">
            <LogOut className="h-4 w-4" aria-hidden />
            {t('nav.signOut')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col relative overflow-hidden bg-soil-50">
        {/* Subtle floating/falling leaves in background of the main content area */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 opacity-[0.14]">
          <div className="absolute top-[10%] left-[5%] animate-float-slow text-brand-600">
            <svg className="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17,8C8,8 4,12 2,22C8,22 12,18 12,12C12,8 9,4 6,2C8,6 8,10 6,12C4,14 2,16 2,22" />
            </svg>
          </div>
          <div
            className="absolute top-[30%] right-[8%] animate-float-medium text-emerald-600"
            style={{ animationDelay: '-2s' }}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17,8C8,8 4,12 2,22C8,22 12,18 12,12C12,8 9,4 6,2C8,6 8,10 6,12C4,14 2,16 2,22" />
            </svg>
          </div>
          <div
            className="absolute bottom-[20%] left-[15%] animate-float-fast text-green-600"
            style={{ animationDelay: '-4s' }}
          >
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17,8C8,8 4,12 2,22C8,22 12,18 12,12C12,8 9,4 6,2C8,6 8,10 6,12C4,14 2,16 2,22" />
            </svg>
          </div>
          <div
            className="absolute bottom-[40%] right-[25%] animate-float-slow text-brand-600"
            style={{ animationDelay: '-6s' }}
          >
            <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17,8C8,8 4,12 2,22C8,22 12,18 12,12C12,8 9,4 6,2C8,6 8,10 6,12C4,14 2,16 2,22" />
            </svg>
          </div>
        </div>
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

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-4 lg:pb-8">{children}</main>

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
