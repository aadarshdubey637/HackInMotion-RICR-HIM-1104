/**
 * Open-Meteo weather provider.
 *
 * Why Open-Meteo over OpenWeatherMap / WeatherAPI:
 *  1. No API key and no credit card. OpenWeatherMap's One Call 3.0 — the only
 *     tier exposing the agronomic fields we need — requires a payment method on
 *     file even to stay inside the free allowance. That is an unacceptable
 *     single point of failure for a deployed demo.
 *  2. It publishes `et0_fao_evapotranspiration` directly: reference
 *     evapotranspiration computed by the FAO-56 Penman-Monteith equation from
 *     the full radiation/humidity/wind stack. Deriving that ourselves from a
 *     general-purpose weather API would be markedly less accurate.
 *  3. Modelled soil moisture at multiple depths, which lets the irrigation
 *     engine start from measured conditions instead of assuming a full profile.
 *  4. `past_days` returns recent history in the same call, so the water balance
 *     and the disease-risk rules get their 7-day lookback for free.
 *
 * Licence: free for non-commercial use, CC-BY-4.0 attribution.
 */

import { logger } from '../../common/logger';
import { ExternalServiceError } from '../../common/errors';

const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const REQUEST_TIMEOUT_MS = 12_000;

const DAILY_VARS = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'rain_sum',
  'precipitation_probability_max',
  'precipitation_hours',
  'et0_fao_evapotranspiration',
  'wind_speed_10m_max',
  'shortwave_radiation_sum',
  'uv_index_max',
] as const;

const HOURLY_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'soil_moisture_0_to_1cm',
  'soil_moisture_3_to_9cm',
] as const;

const CURRENT_VARS = [
  'temperature_2m',
  'relative_humidity_2m',
  'apparent_temperature',
  'precipitation',
  'weather_code',
  'wind_speed_10m',
] as const;

// ─────────────────────────── Shapes ───────────────────────────

/** One calendar day of weather, already unit-normalised. */
export interface DailyWeather {
  date: string; // YYYY-MM-DD, in the farm's local timezone
  /** True for days before today — used for the water-balance lookback. */
  isPast: boolean;
  weatherCode: number;
  description: string;
  tempMaxC: number;
  tempMinC: number;
  tempAvgC: number;
  /** Total precipitation, mm. */
  precipitationMm: number;
  rainMm: number;
  /** Chance of precipitation, 0-100. Null for past days. */
  precipitationProbability: number | null;
  precipitationHours: number;
  /** FAO-56 Penman-Monteith reference evapotranspiration, mm/day. */
  et0Mm: number;
  windSpeedMaxKmh: number;
  solarRadiationMjM2: number;
  uvIndexMax: number;
  /** Daily mean relative humidity, %, aggregated from hourly values. */
  humidityMeanPct: number;
  humidityMaxPct: number;
}

export interface CurrentWeather {
  time: string;
  temperatureC: number;
  apparentTemperatureC: number;
  humidityPct: number;
  precipitationMm: number;
  windSpeedKmh: number;
  weatherCode: number;
  description: string;
}

export interface WeatherBundle {
  latitude: number;
  longitude: number;
  timezone: string;
  elevationM: number;
  current: CurrentWeather;
  /** Past days first, then today, then forecast. Chronological. */
  daily: DailyWeather[];
  /** Volumetric soil moisture (m³/m³) in the top 9 cm, latest reading. Null if unmodelled. */
  soilMoistureSurface: number | null;
  fetchedAt: Date;
  provider: 'open-meteo';
}

// ─────────────────────── WMO weather codes ───────────────────────

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export function describeWeatherCode(code: number): string {
  return WMO_DESCRIPTIONS[code] ?? 'Unknown conditions';
}

/** Whether a WMO code represents active precipitation. */
export function isWetCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

// ─────────────────────────── Fetch ───────────────────────────

interface RawResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  elevation: number;
  current?: Record<string, number | string>;
  daily?: Record<string, Array<number | string | null>>;
  hourly?: Record<string, Array<number | string | null>>;
  error?: boolean;
  reason?: string;
}

/**
 * Fetch a full weather bundle for a coordinate.
 *
 * @param pastDays  Days of history to include. The water balance needs a
 *                  lookback to know how depleted the soil already is.
 * @param forecastDays Days ahead. 7 is the useful planning horizon; skill
 *                  degrades sharply past that.
 */
export async function fetchWeather(
  latitude: number,
  longitude: number,
  { pastDays = 7, forecastDays = 7 }: { pastDays?: number; forecastDays?: number } = {},
): Promise<WeatherBundle> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    timezone: 'auto',
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
    daily: DAILY_VARS.join(','),
    hourly: HOURLY_VARS.join(','),
    current: CURRENT_VARS.join(','),
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
    temperature_unit: 'celsius',
  });

  const url = `${BASE_URL}?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let raw: RawResponse;
  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      // Open-Meteo returns a JSON body with `reason` on 400s.
      let reason = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { reason?: string };
        if (body?.reason) reason = body.reason;
      } catch {
        /* non-JSON error body; keep the status code */
      }
      throw new ExternalServiceError('Open-Meteo', reason);
    }

    raw = (await response.json()) as RawResponse;
  } catch (err) {
    if (err instanceof ExternalServiceError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ExternalServiceError(
        'Open-Meteo',
        `Request timed out after ${REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw new ExternalServiceError(
      'Open-Meteo',
      err instanceof Error ? err.message : 'Network error',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (raw.error) {
    throw new ExternalServiceError('Open-Meteo', raw.reason ?? 'Provider reported an error');
  }
  if (!raw.daily?.time?.length) {
    throw new ExternalServiceError('Open-Meteo', 'Response contained no daily data');
  }

  return normalise(raw, latitude, longitude);
}

// ───────────────────────── Normalisation ─────────────────────────

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNum(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalise(raw: RawResponse, reqLat: number, reqLon: number): WeatherBundle {
  const daily = raw.daily!;
  const dates = daily.time as string[];

  const humidityByDate = aggregateHourlyHumidity(raw.hourly);
  const today = todayInTimezone(raw.timezone);

  const days: DailyWeather[] = dates.map((date, i) => {
    const code = num(daily.weather_code?.[i]);
    const tMax = num(daily.temperature_2m_max?.[i]);
    const tMin = num(daily.temperature_2m_min?.[i]);
    const humidity = humidityByDate.get(date);

    return {
      date,
      isPast: date < today,
      weatherCode: code,
      description: describeWeatherCode(code),
      tempMaxC: tMax,
      tempMinC: tMin,
      tempAvgC: round1((tMax + tMin) / 2),
      precipitationMm: num(daily.precipitation_sum?.[i]),
      rainMm: num(daily.rain_sum?.[i]),
      precipitationProbability: nullableNum(daily.precipitation_probability_max?.[i]),
      precipitationHours: num(daily.precipitation_hours?.[i]),
      et0Mm: num(daily.et0_fao_evapotranspiration?.[i]),
      windSpeedMaxKmh: num(daily.wind_speed_10m_max?.[i]),
      solarRadiationMjM2: num(daily.shortwave_radiation_sum?.[i]),
      uvIndexMax: num(daily.uv_index_max?.[i]),
      humidityMeanPct: humidity?.mean ?? 60,
      humidityMaxPct: humidity?.max ?? 70,
    };
  });

  const currentCode = num(raw.current?.weather_code);

  return {
    latitude: num(raw.latitude, reqLat),
    longitude: num(raw.longitude, reqLon),
    timezone: raw.timezone ?? 'UTC',
    elevationM: num(raw.elevation),
    current: {
      time: String(raw.current?.time ?? new Date().toISOString()),
      temperatureC: num(raw.current?.temperature_2m),
      apparentTemperatureC: num(raw.current?.apparent_temperature),
      humidityPct: num(raw.current?.relative_humidity_2m, 60),
      precipitationMm: num(raw.current?.precipitation),
      windSpeedKmh: num(raw.current?.wind_speed_10m),
      weatherCode: currentCode,
      description: describeWeatherCode(currentCode),
    },
    daily: days,
    soilMoistureSurface: latestSoilMoisture(raw.hourly),
    fetchedAt: new Date(),
    provider: 'open-meteo',
  };
}

/** Collapse hourly relative humidity into per-day mean and max. */
function aggregateHourlyHumidity(
  hourly: RawResponse['hourly'],
): Map<string, { mean: number; max: number }> {
  const out = new Map<string, { mean: number; max: number }>();
  if (!hourly?.time || !hourly.relative_humidity_2m) return out;

  const times = hourly.time as string[];
  const values = hourly.relative_humidity_2m;
  const buckets = new Map<string, number[]>();

  for (let i = 0; i < times.length; i++) {
    const v = nullableNum(values[i]);
    if (v === null) continue;
    const date = times[i].slice(0, 10);
    const bucket = buckets.get(date);
    if (bucket) bucket.push(v);
    else buckets.set(date, [v]);
  }

  for (const [date, vals] of buckets) {
    const sum = vals.reduce((a, b) => a + b, 0);
    out.set(date, {
      mean: round1(sum / vals.length),
      max: Math.max(...vals),
    });
  }
  return out;
}

/**
 * Most recent non-null modelled soil moisture in the top 9 cm.
 * Some Open-Meteo models do not produce soil layers; null is expected and handled.
 */
function latestSoilMoisture(hourly: RawResponse['hourly']): number | null {
  if (!hourly?.time) return null;
  const nowIso = new Date().toISOString().slice(0, 13);
  const times = hourly.time as string[];

  const shallow = hourly.soil_moisture_0_to_1cm;
  const mid = hourly.soil_moisture_3_to_9cm;
  if (!shallow && !mid) return null;

  // Walk backwards from the current hour to the most recent modelled value.
  let idx = times.findIndex((t) => t.slice(0, 13) >= nowIso);
  if (idx === -1) idx = times.length - 1;

  for (let i = idx; i >= 0; i--) {
    const a = nullableNum(mid?.[i]);
    const b = nullableNum(shallow?.[i]);
    if (a !== null || b !== null) {
      const vals = [a, b].filter((v): v is number => v !== null);
      return round3(vals.reduce((x, y) => x + y, 0) / vals.length);
    }
  }
  return null;
}

/** Today's date string in the farm's timezone, for past/future classification. */
function todayInTimezone(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    logger.warn({ timezone }, 'Unknown timezone from provider; falling back to UTC');
    return new Date().toISOString().slice(0, 10);
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
