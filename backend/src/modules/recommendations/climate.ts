/**
 * Historical climate normals for a growing window.
 *
 * Why this exists: a *planting* decision spans the next 3-5 months, but a
 * weather forecast is only skilful for about a week. Scoring crop suitability
 * against a 7-day forecast would be close to meaningless.
 *
 * Instead we ask Open-Meteo's archive API what the same calendar window
 * actually did over the previous few years at this exact coordinate, and use
 * that as the climate expectation. It is real measured data for the farm's
 * location, not a global average or a short-range forecast.
 *
 * Endpoint: https://archive-api.open-meteo.com/v1/archive (ERA5 reanalysis)
 */

import { logger } from '../../common/logger';

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const REQUEST_TIMEOUT_MS = 15_000;

/** How many past years to average. Three balances signal against staleness. */
const YEARS_OF_HISTORY = 3;

export interface ClimateWindow {
  /** Mean daily temperature across the window, °C. */
  meanTempC: number;
  /** Mean of each year's coldest day — frost exposure. */
  meanMinTempC: number;
  /** Mean of each year's hottest day — heat exposure. */
  meanMaxTempC: number;
  /** Total rainfall across the window, mm (averaged over the years sampled). */
  totalRainfallMm: number;
  /** Days at or below 2°C — frost risk indicator. */
  frostDays: number;
  /** How many past years contributed. 0 means the lookup failed. */
  yearsSampled: number;
  windowDays: number;
  startDate: string;
  endDate: string;
}

interface ArchiveResponse {
  daily?: {
    time?: string[];
    temperature_2m_mean?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    precipitation_sum?: Array<number | null>;
  };
  error?: boolean;
  reason?: string;
}

/**
 * Fetch climate normals for the `windowDays` starting today, averaged across
 * the previous `YEARS_OF_HISTORY` years.
 *
 * Returns `null` on failure — callers must degrade to season/soil scoring only
 * rather than blocking a recommendation.
 */
export async function getClimateWindow(
  latitude: number,
  longitude: number,
  windowDays: number,
): Promise<ClimateWindow | null> {
  const today = new Date();
  const years: Array<{ start: string; end: string }> = [];

  for (let back = 1; back <= YEARS_OF_HISTORY; back++) {
    const start = new Date(today);
    start.setFullYear(start.getFullYear() - back);
    const end = new Date(start);
    end.setDate(end.getDate() + windowDays);
    years.push({ start: iso(start), end: iso(end) });
  }

  const results = await Promise.all(
    years.map((y) => fetchYear(latitude, longitude, y.start, y.end)),
  );

  const usable = results.filter((r): r is YearStats => r !== null);
  if (usable.length === 0) {
    logger.warn({ latitude, longitude }, 'Climate lookup failed for every sampled year');
    return null;
  }

  const avg = (fn: (s: YearStats) => number) =>
    usable.reduce((sum, s) => sum + fn(s), 0) / usable.length;

  return {
    meanTempC: round1(avg((s) => s.meanTemp)),
    meanMinTempC: round1(avg((s) => s.minTemp)),
    meanMaxTempC: round1(avg((s) => s.maxTemp)),
    totalRainfallMm: Math.round(avg((s) => s.totalRain)),
    frostDays: Math.round(avg((s) => s.frostDays)),
    yearsSampled: usable.length,
    windowDays,
    startDate: years[0].start,
    endDate: years[0].end,
  };
}

interface YearStats {
  meanTemp: number;
  minTemp: number;
  maxTemp: number;
  totalRain: number;
  frostDays: number;
}

async function fetchYear(
  latitude: number,
  longitude: number,
  startDate: string,
  endDate: string,
): Promise<YearStats | null> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    start_date: startDate,
    end_date: endDate,
    daily: 'temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum',
    timezone: 'auto',
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ARCHIVE_URL}?${params}`, { signal: controller.signal });
    if (!response.ok) return null;

    const body = (await response.json()) as ArchiveResponse;
    if (body.error || !body.daily?.time?.length) return null;

    const means = clean(body.daily.temperature_2m_mean);
    const mins = clean(body.daily.temperature_2m_min);
    const maxes = clean(body.daily.temperature_2m_max);
    const rain = clean(body.daily.precipitation_sum);

    if (means.length === 0) return null;

    return {
      meanTemp: means.reduce((a, b) => a + b, 0) / means.length,
      // The coldest and hottest days matter more than the averages for stress.
      minTemp: mins.length ? Math.min(...mins) : means[0],
      maxTemp: maxes.length ? Math.max(...maxes) : means[0],
      totalRain: rain.reduce((a, b) => a + b, 0),
      frostDays: mins.filter((t) => t <= 2).length,
    };
  } catch (err) {
    logger.debug({ startDate, err }, 'Archive year fetch failed');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function clean(values: Array<number | null> | undefined): number[] {
  return (values ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
