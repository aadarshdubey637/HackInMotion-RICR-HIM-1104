'use client';

import { useEffect, useState } from 'react';

/**
 * Offline support.
 *
 * Rural connectivity is intermittent, so the app must stay useful when the
 * network drops. The approach here is deliberately simple and dependency-free:
 * successful API reads are cached in localStorage, and when a request fails
 * the cached copy is served with a visible note about how old it is.
 *
 * We avoid a service worker on purpose. `next-pwa` is unreliable with the
 * Next.js 14 App Router, and a half-working service worker that serves stale
 * JavaScript is far worse for a farmer than no service worker at all. This
 * covers the case that actually matters — "I opened the app in a field with no
 * signal and still need to know whether to irrigate."
 */

const PREFIX = 'sf_cache:';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

/** Store a successful response. Quota failures are non-fatal. */
export function writeCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
  } catch {
    // Storage full or disabled — caching is an optimisation, never required.
  }
}

/** Read a cached response, with the age so the UI can be honest about it. */
export function readCache<T>(key: string): { data: T; ageMs: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (!entry || typeof entry.cachedAt !== 'number') return null;
    return { data: entry.data, ageMs: Date.now() - entry.cachedAt };
  } catch {
    return null;
  }
}

/** Drop every cached entry — used on sign-out so accounts do not leak data. */
export function clearCache(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/** Human-readable cache age, for the offline banner. */
export function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'moments ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * Track connectivity.
 *
 * `navigator.onLine` only reports whether the device has a network interface,
 * not whether the internet is actually reachable — so callers should treat a
 * failed request as authoritative and use this as a hint.
 */
export function useOnlineStatus(): boolean {
  // Assume online during SSR and first paint; correcting to offline is cheap,
  // whereas flashing an offline banner on a working connection is jarring.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
