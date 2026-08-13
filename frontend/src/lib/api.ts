/**
 * Typed API client.
 *
 * Every call funnels through `request()`, which gives us one place to attach
 * the auth token, unwrap the `{ success, data }` envelope, and turn failures
 * into a consistent `ApiError` carrying a message that is safe to show a farmer.
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
} from './types';

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

  /** True when the user should be sent back to sign in. */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  /** True for problems that a retry might fix. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

// ─────────────────────────── Core request ───────────────────────────

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Multipart payload; when set, `body` is ignored. */
  formData?: FormData;
  signal?: AbortSignal;
  /** Skip the Authorization header (used by login/register). */
  anonymous?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, formData, signal, anonymous } = options;

  const headers: Record<string, string> = {};
  if (!anonymous) {
    const token = tokenStore.get();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  // Let the browser set the multipart boundary itself.
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

  // 204 and friends have no body.
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

    me: () => request<{ user: User }>('/auth/me'),

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
    list: () => request<{ farms: Farm[] }>('/farms'),

    get: (farmId: string) => request<{ farm: Farm }>(`/farms/${farmId}`),

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
      request<{ crops: Array<{ key: string; label: string }> }>('/farms/supported-crops'),

    crops: (farmId: string) => request<{ crops: Crop[] }>(`/farms/${farmId}/crops`),

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
      request<Dashboard>(`/dashboard/${farmId}`, { signal }),
  },

  weather: {
    forecast: (farmId: string, days = 7) =>
      request<Forecast>(`/weather/${farmId}/forecast?days=${days}`),

    irrigation: (farmId: string, cropId?: string) =>
      request<IrrigationGuidance>(
        `/weather/${farmId}/irrigation${cropId ? `?cropId=${cropId}` : ''}`,
      ),

    logIrrigation: (
      farmId: string,
      input: { cropId: string; waterAmountMm: number; irrigationMethod: string },
    ) =>
      request<{ log: unknown }>(`/weather/${farmId}/irrigation-log`, {
        method: 'POST',
        body: { ...input, wasRecommended: true, guidanceSource: 'app' },
      }),
  },

  health: {
    list: (farmId: string) =>
      request<{ observations: HealthLog[] }>(`/crop-health/${farmId}/observations`),

    get: (farmId: string, logId: string) =>
      request<{ observation: HealthLog }>(`/crop-health/${farmId}/observations/${logId}`),

    create: (
      farmId: string,
      input: {
        cropId: string;
        description: string;
        observationType: string;
        image?: File | null;
        /**
         * The language the farmer is reading right now. Sent per-observation
         * because the picker changes instantly while the saved profile may lag.
         */
        language?: string;
      },
    ) => {
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
      request<{
        reports: Array<{ name: string; crop: string; count: number; latest: string }>;
        farmsInArea: number;
        radiusKm: number;
      }>(`/crop-health/${farmId}/nearby`),
  },

  market: {
    farmTrends: (farmId: string) =>
      request<{ trends: PriceTrend[]; message: string | null }>(`/market/farm/${farmId}`),

    commodity: (commodity: string, days = 60) =>
      request<PriceTrend>(`/market/commodity/${encodeURIComponent(commodity)}?days=${days}`),
  },

  recommendations: {
    get: (farmId: string) => request<RecommendationResult>(`/recommendations/${farmId}`),
  },

  planning: {
    farm: (farmId: string) =>
      request<{ crops: CropPlan[]; message: string | null }>(`/planning/${farmId}`),

    fertilizer: (farmId: string, cropId: string) =>
      request<FertilizerPlan>(`/planning/${farmId}/crops/${cropId}/fertilizer`),

    yieldPrediction: (farmId: string, cropId: string) =>
      request<YieldPrediction>(`/planning/${farmId}/crops/${cropId}/yield`),
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

      return request<AlertFeed>(`/alerts/${farmId}${qs ? `?${qs}` : ''}`, { signal });
    },

    markRead: (alertId: string) =>
      request<{ message: string }>(`/alerts/item/${alertId}/read`, { method: 'PATCH' }),

    dismiss: (alertId: string) =>
      request<{ message: string }>(`/alerts/item/${alertId}/dismiss`, { method: 'PATCH' }),

    readAll: (farmId: string) =>
      request<{ message: string }>(`/alerts/${farmId}/read-all`, { method: 'POST' }),
  },
};
