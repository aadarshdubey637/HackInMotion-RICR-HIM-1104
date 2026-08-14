'use client';

import { useEffect, useState } from 'react';

/**
 * Offline-first support.
 *
 * Rural connectivity is intermittent. The strategy:
 *
 * READS  — every successful GET is written to localStorage. On network failure,
 *          the cached copy is returned with an age so the UI can be honest.
 *
 * WRITES — mutations that fail while offline are queued in localStorage.
 *          When the connection comes back, the queue replays automatically.
 *          The UI shows a "N actions pending sync" badge so the farmer knows
 *          their input was not lost.
 *
 * We deliberately avoid a service worker. next-pwa is unreliable with the
 * Next.js 14 App Router, and a broken service worker serving stale JS is far
 * worse than no service worker. This approach covers the real case: "I opened
 * the app in a field with no signal and need to know whether to irrigate."
 */

// ─────────────────────────── Read cache ───────────────────────────

const CACHE_PREFIX = 'sf_cache:';

interface CacheEntry<T> {
  data: T;
  cachedAt: number;
}

/** Store a successful GET response. Quota failures are non-fatal. */
export function writeCache<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;
  try {
    const entry: CacheEntry<T> = { data, cachedAt: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // Storage full or disabled — caching is an optimisation, not a requirement.
  }
}

/** Read a cached response, with the age so the UI can be honest about it. */
export function readCache<T>(key: string): { data: T; ageMs: number } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
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
      if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

/** Human-readable cache age for the offline banner. */
export function describeAge(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'moments ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ─────────────────────────── Write queue ───────────────────────────

const QUEUE_KEY = 'sf_offline_queue';

export interface QueuedMutation {
  id: string;
  path: string;
  method: string;
  /** JSON-serialisable body. FormData mutations (photo uploads) are not queued. */
  body?: unknown;
  queuedAt: number;
  /** Human-readable description for the pending-sync badge. */
  label: string;
}

function readQueue(): QueuedMutation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QueuedMutation[];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedMutation[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }
}

/** Push a mutation onto the offline queue. */
export function enqueue(mutation: Omit<QueuedMutation, 'id' | 'queuedAt'>): void {
  const queue = readQueue();
  queue.push({ ...mutation, id: `${Date.now()}-${Math.random()}`, queuedAt: Date.now() });
  writeQueue(queue);
  // Notify any listeners (e.g. the sync badge).
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sf:queue-change'));
  }
}

/** How many mutations are waiting to sync. */
export function pendingCount(): number {
  return readQueue().length;
}

/** Remove one mutation from the queue after it replays successfully. */
function dequeue(id: string): void {
  const queue = readQueue().filter((m) => m.id !== id);
  writeQueue(queue);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sf:queue-change'));
  }
}

/**
 * Replay all queued mutations against the API.
 * Called automatically when the device comes back online.
 */
export async function flushQueue(
  replay: (path: string, method: string, body?: unknown) => Promise<unknown>,
): Promise<{ succeeded: number; failed: number }> {
  const queue = readQueue();
  if (queue.length === 0) return { succeeded: 0, failed: 0 };

  let succeeded = 0;
  let failed = 0;

  for (const mutation of queue) {
    try {
      await replay(mutation.path, mutation.method, mutation.body);
      dequeue(mutation.id);
      succeeded++;
    } catch {
      // Leave in queue — will retry on the next flush.
      failed++;
    }
  }

  return { succeeded, failed };
}

/** Clear the entire write queue (e.g. on sign-out). */
export function clearQueue(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    /* ignore */
  }
}

// ─────────────────────────── Connectivity hook ───────────────────────────

export interface OfflineState {
  online: boolean;
  /** How many writes are waiting to sync. */
  pending: number;
  /** The age of the oldest cached read (across all keys), or null if nothing is cached. */
  oldestCacheMs: number | null;
}

/**
 * Track connectivity and queue depth.
 *
 * `navigator.onLine` only tells you whether there is a network interface —
 * not whether the internet is reachable. Treat a failed fetch as authoritative
 * and use this as a hint to show the offline banner proactively.
 */
export function useOfflineState(): OfflineState {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    setOnline(navigator.onLine);
    setPending(pendingCount());

    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    const onQueueChange = () => setPending(pendingCount());

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    window.addEventListener('sf:queue-change', onQueueChange);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('sf:queue-change', onQueueChange);
    };
  }, []);

  // Find the oldest cache entry to show in the banner.
  const oldestCacheMs: number | null = (() => {
    if (typeof window === 'undefined') return null;
    try {
      let oldest: number | null = null;
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(CACHE_PREFIX)) continue;
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const entry = JSON.parse(raw) as CacheEntry<unknown>;
        if (typeof entry.cachedAt === 'number') {
          const age = Date.now() - entry.cachedAt;
          if (oldest === null || age > oldest) oldest = age;
        }
      }
      return oldest;
    } catch {
      return null;
    }
  })();

  return { online, pending, oldestCacheMs };
}

/** Legacy single-value hook kept for any code that already uses it. */
export function useOnlineStatus(): boolean {
  const { online } = useOfflineState();
  return online;
}
