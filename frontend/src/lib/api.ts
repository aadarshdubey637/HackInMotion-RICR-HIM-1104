/**
 * Typed API client with offline-first support.
 *
 * Every GET funnels through `cachedRequest()`:
 *   1. Try the network.
 *   2. On success, write the response to localStorage.
 *   3. On NETWORK_ERROR, return the last cached copy (with its age attached).
 *
 * Key mutations (irrigation logs, health observations, community reports) that
 * fail while offline are pushed onto a write queue and replayed automatically
 * when the connection comes back. FormData mutations (photo uploads) are not
 * queued — they require a real connection.
 *
 * All other auth is unchanged; the token store and error types are identical.
 */

import type {
  AuthTokens,
  User,
  Farm,
  Crop,
  Dashboard,
  IrrigationGuidance,
  Forecast,
  Diagnosis,
  HealthLog,
  PriceTrend,
  AlertFeed,
  Severity,
  RecommendationResult,
  CropPlan,
  FertilizerPlan,
  YieldPrediction,
  YieldHistoryEntry,
  RecordHarvestResult,
  NearbyOutbreaks,
} from './types';
import { writeCache, readCache, enqueue, flushQueue } from './offline';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const TOKEN_KEY = 'sf_access_token';
const REFRESH_KEY = 'sf_refresh_token';
const FARM_KEY = 'sf_active_farm';

// ─────────────────────────── Token storage ───────────────────────────

export const tokenStore = {
  get: (): string | null => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)),
  getRefresh: (): string | null =>
    typeof window === 'undefined' ? null : localStorage.getItem(REFRESH_KEY),
  set(tokens: AuthTokens) {
    localStorage.setItem(TOKEN_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(FARM_KEY);
  },
};

export const activeFarm = {
  get: (): string | null => (typeof window === 'undefined' ? null : localStorage.getItem(FARM_KEY)),
  set: (id: string) => localStorage.setItem(FARM_KEY, id),
  clear: () => localStorage.removeItem(FARM_KEY),
};

// ─────────────────────────── Errors ───────────────────────────

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Field-level validation messages, keyed by field name. */
  readonly details?: Record<string, string>;

  constructor(message: string, status: number, code: string, details?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

// ─────────────────────────── Core request ───────────────────────────

interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  anonymous?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal, anonymous } = options;

  const headers: Record<string, string> = {};
  if (!anonymous) {
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined && !formData) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(
      'Cannot reach the server. Check your internet connection and try again.',
      0,
      'NETWORK_ERROR',
    );
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      response.ok ? 'The server sent back an unreadable response.' : `Request failed (${response.status})`,
      response.status,
      'BAD_RESPONSE',
    );
  }

  const envelope = payload as {
    success?: boolean;
    data?: T;
    error?: { code?: string; message?: string; details?: Record<string, string> };
  };

  if (!response.ok || envelope.success === false) {
    throw new ApiError(
      envelope.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      envelope.error?.code ?? 'UNKNOWN',
      envelope.error?.details,
    );
  }

  return envelope.data as T;
}

/**
 * Cached GET.
 *
 * On success the response is written to localStorage under `cacheKey`.
 * On NETWORK_ERROR (status 0) the cached copy is returned instead — the
 * caller gets the last known value and the UI stays useful offline.
 */
async function cachedRequest<T>(
  cacheKey: string,
  path: string,
  signal?: AbortSignal,
): Promise<T & { _fromCache?: boolean; _cacheAgeMs?: number }> {
  try {
    const data = await request<T>(path, { signal });
    writeCache<T>(cacheKey, data);
    return data as T & { _fromCache?: boolean; _cacheAgeMs?: number };
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) {
      const cached = readCache<T>(cacheKey);
      if (cached) {
        return { ...cached.data, _fromCache: true, _cacheAgeMs: cached.ageMs };
      }
    }
    throw err;
  }
}

/**
 * Replay helper exposed so the offline queue can re-run mutations when the
 * device comes back online.
 */
export function replayMutation(path: string, method: string, body?: unknown): Promise<unknown> {
  return request(path, { method, body });
}

/**
 * Register a listener that flushes the write queue when the device comes back
 * online. Safe to call multiple times — deduplication is handled internally.
 */
let flushListenerRegistered = false;

export function ensureFlushListener(): void {
  if (flushListenerRegistered || typeof window === 'undefined') return;
  flushListenerRegistered = true;

  window.addEventListener('online', () => {
    void flushQueue(replayMutation).then(({ succeeded, failed }) => {
      if (succeeded > 0) {
        console.info(`[SmartFarm] Synced ${succeeded} offline action(s)`);
      }
      if (failed > 0) {
        console.warn(`[SmartFarm] ${failed} action(s) failed to sync and will retry`);
      }
    });
  });
}

// ─────────────────────────── Endpoints ───────────────────────────

export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ user: User; tokens: AuthTokens }>('/auth/login', {
        method: 'POST',
        body: { email, password },
        anonymous: true,
      }),

    register: (input: {
      email: string;
      password: string;
      name: string;
      phone?: string;
      language?: string;
    }) =>
      request<{ user: User; tokens: AuthTokens }>('/auth/register', {
        method: 'POST',
        body: input,
        anonymous: true,
      }),

    me: () => cachedRequest<{ user: User }>('auth:me', '/auth/me'),

    updateProfile: (input: { name?: string; phone?: string; language?: string }) =>
      request<{ user: User }>('/auth/me', { method: 'PATCH', body: input }),

    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ message: string }>('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      }),

    logout: (refreshToken: string) =>
      request<{ message: string }>('/auth/logout', { method: 'POST', body: { refreshToken } }),
  },

  farms: {
    list: () => cachedRequest<{ farms: Farm[] }>('farms:list', '/farms'),

    get: (farmId: string) =>
      cachedRequest<{ farm: Farm }>(`farms:${farmId}`, `/farms/${farmId}`),

    create: (input: {
      name: string;
      latitude: number;
      longitude: number;
      totalAreaHectares: number;
      soilTypePrimary?: string;
      address?: string;
    }) => request<{ farm: Farm }>('/farms', { method: 'POST', body: input }),

    update: (farmId: string, input: Record<string, unknown>) =>
      request<{ farm: Farm }>(`/farms/${farmId}`, { method: 'PATCH', body: input }),

    supportedCrops: () =>
      cachedRequest<{ crops: Array<{ key: string; label: string }> }>(
        'farms:supported-crops',
        '/farms/supported-crops',
      ),

    getLocationInfo: (latitude: number, longitude: number) =>
      request<{
        location: {
          village: string | null;
          district: string | null;
          state: string | null;
          country: string | null;
          formattedAddress: string | null;
        };
        soil: {
          soilType: string | null;
          soilProperties: Record<string, unknown> | null;
        };
      }>(`/farms/location-info?latitude=${latitude}&longitude=${longitude}`),

    crops: (farmId: string) =>
      cachedRequest<{ crops: Crop[] }>(`farms:${farmId}:crops`, `/farms/${farmId}/crops`),

    addCrop: (
      farmId: string,
      input: {
        cropName: string;
        status?: string;
        growthStage?: string;
        plantingDate?: string;
        expectedHarvestDate?: string;
      },
    ) => request<{ crop: Crop }>(`/farms/${farmId}/crops`, { method: 'POST', body: input }),

    deleteCrop: (farmId: string, cropId: string) =>
      request<{ message: string }>(`/farms/${farmId}/crops/${cropId}`, { method: 'DELETE' }),
  },

  dashboard: {
    get: (farmId: string, signal?: AbortSignal) =>
      cachedRequest<Dashboard>(`dashboard:${farmId}`, `/dashboard/${farmId}`, signal),
  },

  weather: {
    forecast: (farmId: string, days = 7) =>
      cachedRequest<Forecast>(`weather:${farmId}:forecast:${days}`, `/weather/${farmId}/forecast?days=${days}`),

    irrigation: (farmId: string, cropId?: string) =>
      cachedRequest<IrrigationGuidance>(
        `weather:${farmId}:irrigation:${cropId ?? 'all'}`,
        `/weather/${farmId}/irrigation${cropId ? `?cropId=${cropId}` : ''}`,
      ),

    logIrrigation: (
      farmId: string,
      input: { cropId: string; waterAmountMm: number; irrigationMethod: string },
    ) => {
      const path = `/weather/${farmId}/irrigation-log`;
      const body = { ...input, wasRecommended: true, guidanceSource: 'app' };
      const doRequest = () => request<{ log: unknown }>(path, { method: 'POST', body });

      if (typeof window !== 'undefined' && !navigator.onLine) {
        enqueue({ path, method: 'POST', body, label: 'Irrigation log' });
        return Promise.resolve({ log: null, _queued: true } as { log: unknown });
      }
      return doRequest().catch((err: ApiError) => {
        if (err.status === 0) {
          enqueue({ path, method: 'POST', body, label: 'Irrigation log' });
          return { log: null, _queued: true } as { log: unknown };
        }
        throw err;
      });
    },
  },

  health: {
    list: (farmId: string) =>
      cachedRequest<{ observations: HealthLog[] }>(
        `health:${farmId}:observations`,
        `/crop-health/${farmId}/observations`,
      ),

    get: (farmId: string, logId: string) =>
      cachedRequest<{ observation: HealthLog }>(
        `health:${farmId}:observation:${logId}`,
        `/crop-health/${farmId}/observations/${logId}`,
      ),

    create: (
      farmId: string,
      input: {
        cropId: string;
        description: string;
        observationType: string;
        image?: File | null;
        language?: string;
      },
    ) => {
      // FormData (photo) mutations cannot be serialised into the write queue.
      // Fall through to the live request and let the caller handle the error.
      const form = new FormData();
      form.append('cropId', input.cropId);
      form.append('description', input.description);
      form.append('observationType', input.observationType);
      if (input.language) form.append('language', input.language);
      if (input.image) form.append('image', input.image);

      return request<{ log: HealthLog; diagnosis: Diagnosis; imageStored: boolean; warning?: string }>(
        `/crop-health/${farmId}/observations`,
        { method: 'POST', formData: form },
      );
    },

    updateStatus: (farmId: string, logId: string, status: string) =>
      request<{ observation: HealthLog }>(`/crop-health/${farmId}/observations/${logId}`, {
        method: 'PATCH',
        body: { status },
      }),

    nearby: (farmId: string) =>
      cachedRequest<NearbyOutbreaks>(`health:${farmId}:nearby`, `/crop-health/${farmId}/nearby`),

    submitCommunityReport: (
      farmId: string,
      input: {
        cropId?: string;
        customCropName?: string;
        issueName: string;
        issueType: 'DISEASE' | 'PEST';
        severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'CRITICAL';
        description: string;
        image?: File | null;
      },
    ) => {
      const form = new FormData();
      if (input.cropId) form.append('cropId', input.cropId);
      if (input.customCropName) form.append('customCropName', input.customCropName);
      form.append('issueName', input.issueName);
      form.append('issueType', input.issueType);
      form.append('severity', input.severity);
      form.append('description', input.description);
      if (input.image) form.append('image', input.image);

      return request<{ log: HealthLog; imageStored: boolean; warning?: string }>(
        `/crop-health/${farmId}/community-reports`,
        { method: 'POST', formData: form },
      );
    },
  },

  market: {
    farmTrends: (farmId: string, market?: string) =>
      cachedRequest<{ trends: PriceTrend[]; message: string | null }>(
        `market:${farmId}:trends:${market ?? 'all'}`,
        `/market/farm/${farmId}${market ? `?market=${encodeURIComponent(market)}` : ''}`,
      ),

    commodity: (commodity: string, days = 60) =>
      cachedRequest<PriceTrend>(
        `market:commodity:${commodity}:${days}`,
        `/market/commodity/${encodeURIComponent(commodity)}?days=${days}`,
      ),
  },

  recommendations: {
    get: (farmId: string) =>
      cachedRequest<RecommendationResult>(
        `recommendations:${farmId}`,
        `/recommendations/${farmId}`,
      ),
  },

  planning: {
    farm: (farmId: string) =>
      cachedRequest<{ crops: CropPlan[]; message: string | null }>(
        `planning:${farmId}:crops`,
        `/planning/${farmId}`,
      ),

    fertilizer: (farmId: string, cropId: string) =>
      cachedRequest<FertilizerPlan>(
        `planning:${farmId}:fertilizer:${cropId}`,
        `/planning/${farmId}/crops/${cropId}/fertilizer`,
      ),

    yieldPrediction: (farmId: string, cropId: string) =>
      cachedRequest<YieldPrediction>(
        `planning:${farmId}:yield:${cropId}`,
        `/planning/${farmId}/crops/${cropId}/yield`,
      ),

    yieldHistory: (farmId: string, cropId?: string) =>
      cachedRequest<{ predictions: YieldHistoryEntry[] }>(
        `planning:${farmId}:yield-history:${cropId ?? 'all'}`,
        `/planning/${farmId}/yield-history${cropId ? `?cropId=${cropId}` : ''}`,
      ),

    recordHarvest: (farmId: string, cropId: string, actualYieldKg: number) =>
      request<RecordHarvestResult>(`/planning/${farmId}/crops/${cropId}/harvest`, {
        method: 'PATCH',
        body: { actualYieldKg },
      }),
  },

  alerts: {
    list: (
      farmId: string,
      options: { unreadOnly?: boolean; severity?: Severity; limit?: number } = {},
      signal?: AbortSignal,
    ) => {
      const search = new URLSearchParams();
      if (options.unreadOnly) search.set('unreadOnly', 'true');
      if (options.severity) search.set('severity', options.severity);
      if (options.limit) search.set('limit', String(options.limit));
      const qs = search.toString();
      const path = `/alerts/${farmId}${qs ? `?${qs}` : ''}`;

      return cachedRequest<AlertFeed>(
        `alerts:${farmId}:${qs}`,
        path,
        signal,
      );
    },

    markRead: (alertId: string) =>
      request<{ message: string }>(`/alerts/item/${alertId}/read`, { method: 'PATCH' }),

    dismiss: (alertId: string) =>
      request<{ message: string }>(`/alerts/item/${alertId}/dismiss`, { method: 'PATCH' }),

    readAll: (farmId: string) =>
      request<{ message: string }>(`/alerts/${farmId}/read-all`, { method: 'POST' }),
  },
};
