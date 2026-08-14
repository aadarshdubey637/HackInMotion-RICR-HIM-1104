/**
 * Market price service.
 *
 * Data source: AGMARKNET, the Government of India's agricultural marketing
 * portal, accessed through the data.gov.in Open Government Data API
 * (resource 9ef84268-d588-465a-a308-a864a43d0070 — "Current Daily Price of
 * Various Commodities from Various Markets"). It is the authoritative
 * mandi-level price source for India, it is free, and an API key is issued
 * instantly. See README for the full evaluation against alternatives.
 *
 * Important limitation, handled deliberately: that endpoint serves only the
 * CURRENT day's prices. It has no history endpoint. So:
 *
 *   - We ingest daily snapshots and accumulate our own history in MongoDB.
 *     Over time this becomes a genuine local time series.
 *   - For a system with no accumulated history yet, a seeded baseline series
 *     is generated so trend analysis and charts work from day one. Seeded rows
 *     are tagged `source: 'seed'` and the API reports `isSeeded` so the UI can
 *     be honest about which numbers are real observations.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { logger } from '../../common/logger';
import { config, features } from '../../config';
import { NotFoundError } from '../../common/errors';
import { upsertWithoutTransaction } from '../../common/upsert';
import { findCrop, CROPS } from '../../domain/crops';

const DATA_GOV_RESOURCE = '9ef84268-d588-465a-a308-a864a43d0070';
const DATA_GOV_BASE = `https://api.data.gov.in/resource/${DATA_GOV_RESOURCE}`;
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Below this many rows a series cannot support a chart or a percent change, so
 * a scoped query falls back to a wider geography instead of rendering nothing.
 */
const MIN_SERIES_POINTS = 5;

// ─────────────────────────── Ingestion ───────────────────────────

interface AgmarknetRecord {
  state?: string;
  district?: string;
  market?: string;
  commodity?: string;
  variety?: string;
  grade?: string;
  arrival_date?: string;
  min_price?: string;
  max_price?: string;
  modal_price?: string;
}

/**
 * Pull today's mandi prices for a commodity and store them.
 * Returns the number of rows ingested; 0 means no key, no data, or a failure —
 * all non-fatal.
 */
export async function syncCommodityPrices(
  commodity: string,
  options: { state?: string; limit?: number } = {},
): Promise<number> {
  if (!config.DATA_GOV_IN_API_KEY) {
    logger.debug({ commodity }, 'No data.gov.in key configured; skipping live price sync');
    return 0;
  }

  const params = new URLSearchParams({
    'api-key': config.DATA_GOV_IN_API_KEY,
    format: 'json',
    limit: String(options.limit ?? 200),
    'filters[commodity]': commodity,
  });
  if (options.state) params.set('filters[state]', options.state);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${DATA_GOV_BASE}?${params}`, { signal: controller.signal });
    if (!response.ok) {
      logger.warn({ commodity, status: response.status }, 'data.gov.in request failed');
      return 0;
    }

    const body = (await response.json()) as { records?: AgmarknetRecord[] };
    const records = body.records ?? [];
    if (records.length === 0) return 0;

    const parsedRows = records
      .map((record) => parseRecord(record, commodity))
      .filter((row): row is NonNullable<typeof row> => row !== null);

    let ingested = 0;
    for (const parsed of rejectOutliers(parsedRows, commodity)) {
      try {
        await upsertWithoutTransaction(prisma.priceHistory, {
          where: {
            commodity: parsed.commodity,
            priceDate: parsed.priceDate,
            marketName: parsed.marketName,
            unit: parsed.unit,
          },
          create: parsed,
          update: {
            minPrice: parsed.minPrice,
            maxPrice: parsed.maxPrice,
            modalPrice: parsed.modalPrice,
            source: 'agmarknet',
          },
        });
        ingested += 1;
      } catch (err) {
        logger.debug({ err, market: parsed.marketName }, 'Skipped a price row');
      }
    }

    logger.info({ commodity, ingested, returned: records.length }, 'Ingested mandi prices');
    return ingested;
  } catch (err) {
    logger.warn({ commodity, err }, 'Price sync failed; serving stored history');
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * How long a stored AGMARKNET snapshot counts as current.
 *
 * The upstream resource publishes once a day, so anything more frequent spends
 * a request to be told the same thing. Twelve hours means a mandi that updates
 * in the morning is picked up the same day without polling all afternoon.
 */
const PRICE_TTL_MS = 12 * 60 * 60 * 1000;

/** Syncs currently running, keyed by commodity. See `syncOnce`. */
const inFlightSyncs = new Map<string, Promise<number>>();

/**
 * Run one sync per commodity at a time.
 *
 * `getFarmPriceTrends` fans out across every crop on the farm, and a farm with
 * both wheat and rice reloading twice (React re-invokes effects in development)
 * would otherwise issue four upstream calls for two answers.
 */
function syncOnce(commodity: string): Promise<number> {
  const running = inFlightSyncs.get(commodity);
  if (running) return running;

  const work = syncCommodityPrices(commodity)
    // `syncCommodityPrices` already handles its own failures and resolves 0,
    // but a rejection here would become an unhandled rejection in the
    // background case below, so it is caught unconditionally.
    .catch(() => 0)
    .finally(() => inFlightSyncs.delete(commodity));

  inFlightSyncs.set(commodity, work);
  return work;
}

/**
 * Make sure a commodity's stored prices are worth reading, before reading them.
 *
 * Three outcomes, and which one applies is the whole point:
 *
 *  - No API key: returns immediately. Seeded history stands, and the response
 *    already reports `isSeeded` so the UI says so.
 *  - Real observations exist but are stale: refresh in the background and serve
 *    what we have. A farmer checking prices should not wait on an upstream call
 *    to redraw a chart that is a few hours old.
 *  - No real observations at all: await the sync. This is the case that used to
 *    make a configured key look broken — the first view showed a seeded
 *    baseline, and only a second visit showed live prices.
 */
async function ensureFreshPrices(commodity: string): Promise<void> {
  if (!features.dataGovIn) return;

  const newest = await prisma.priceHistory.findFirst({
    where: { commodity, source: 'agmarknet' },
    orderBy: { priceDate: 'desc' },
    select: { priceDate: true },
  });

  if (newest && Date.now() - newest.priceDate.getTime() < PRICE_TTL_MS) return;

  if (!newest) {
    await syncOnce(commodity);
    return;
  }

  void syncOnce(commodity);
}

/**
 * How far above the day's own median a price may sit before we treat it as a
 * data-entry error rather than a premium grade.
 *
 * Chosen from the real feed: on one day rice ranged from a 3,500 median up to
 * a legitimate 11,357 for a premium variety (3.2x), alongside a single row
 * reporting a 35,000 maximum (10x) that is not a real price for any grade of
 * rice. Five leaves genuine premium produce alone and catches the errors.
 */
const OUTLIER_MULTIPLE = 5;

/**
 * Drop rows whose prices are implausible next to the rest of the same batch.
 *
 * A single bad row matters more than it sounds: the chart's upper band is
 * `Math.max` across the day's markets, so one mistyped figure redraws the
 * whole scale and makes every real movement invisible.
 *
 * Compared against the batch's own median, not a hardcoded ceiling, so this
 * keeps working as prices move and needs no maintenance per commodity.
 */
function rejectOutliers<T extends { modalPrice: number; maxPrice: number }>(
  rows: T[],
  commodity: string,
): T[] {
  // Too few rows to say what is normal; a "median" of three points would
  // reject legitimate spread rather than errors.
  if (rows.length < 5) return rows;

  const modals = rows.map((row) => row.modalPrice).sort((a, b) => a - b);
  const median = modals[Math.floor(modals.length / 2)];
  if (!median) return rows;

  const ceiling = median * OUTLIER_MULTIPLE;
  const kept = rows.filter((row) => row.modalPrice <= ceiling && row.maxPrice <= ceiling);

  if (kept.length !== rows.length) {
    logger.warn(
      { commodity, dropped: rows.length - kept.length, median, ceiling },
      'Dropped implausible mandi price rows',
    );
  }

  return kept;
}

function parseRecord(record: AgmarknetRecord, fallbackCommodity: string) {
  const modal = Number(record.modal_price);
  const min = Number(record.min_price);
  const max = Number(record.max_price);

  // Rows with unusable prices are common in the feed; drop them rather than
  // letting a zero distort the trend.
  if (!Number.isFinite(modal) || modal <= 0) return null;

  const priceDate = parseArrivalDate(record.arrival_date);
  if (!priceDate) return null;

  return {
    commodity: record.commodity?.trim() || fallbackCommodity,
    priceDate,
    minPrice: Number.isFinite(min) && min > 0 ? min : modal,
    maxPrice: Number.isFinite(max) && max > 0 ? max : modal,
    modalPrice: modal,
    marketName: record.market?.trim() || 'Unknown',
    state: record.state?.trim() || 'Unknown',
    district: record.district?.trim() || 'Unknown',
    unit: 'Rs/quintal',
    qualityGrade: record.grade?.trim() || null,
    source: 'agmarknet',
  };
}

/** AGMARKNET reports dates as DD/MM/YYYY. */
function parseArrivalDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) {
    const [, dd, mm, yyyy] = match;
    return new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed)
    ? null
    : new Date(new Date(parsed).toISOString().slice(0, 10) + 'T00:00:00.000Z');
}

// ─────────────────────────── Trend analysis ───────────────────────────

export type TrendDirection = 'RISING' | 'FALLING' | 'STABLE';
export type SellSignal = 'SELL' | 'HOLD' | 'WATCH';

export interface PricePoint {
  date: string;
  modalPrice: number;
  minPrice: number;
  maxPrice: number;
}

export interface PriceTrend {
  commodity: string;
  unit: string;
  /** Chronological series for charting. */
  series: PricePoint[];
  current: {
    price: number;
    date: string;
    marketName: string | null;
  } | null;
  statistics: {
    average7Day: number | null;
    average30Day: number | null;
    /** Percent change over the last 7 days. */
    change7DayPercent: number | null;
    change30DayPercent: number | null;
    high30Day: number | null;
    low30Day: number | null;
    /** Coefficient of variation, %. High means an unpredictable market. */
    volatilityPercent: number | null;
  };
  direction: TrendDirection;
  /** Actionable selling guidance. */
  advice: {
    signal: SellSignal;
    headline: string;
    reasoning: string;
  };
  /** True when the series includes generated baseline data. */
  isSeeded: boolean;
  dataPoints: number;
  markets: string[];
  lastUpdated: string | null;
  /** The geographic level the returned series actually covers. */
  scope: {
    level: ScopeLevel;
    /** Human-readable description of that level, e.g. "Indore mandi". */
    label: string;
    /** True when the requested scope had too little history and we widened. */
    widened: boolean;
  };
}

export type ScopeLevel = 'market' | 'district' | 'state' | 'all';

function scopeLevelOf(scope: PriceScope): ScopeLevel {
  if (scope.market) return 'market';
  if (scope.district) return 'district';
  if (scope.state) return 'state';
  return 'all';
}

function scopeLabel(level: ScopeLevel, scope: PriceScope): string {
  if (level === 'market' && scope.market) return `${scope.market} mandi`;
  if (level === 'district' && scope.district) return `${scope.district} district`;
  if (level === 'state' && scope.state) return scope.state;
  return 'All mandis';
}

/**
 * Optional geographic narrowing for a trend query. Any subset may be given —
 * state alone aggregates every mandi in that state, market alone pins a single
 * mandi. Omitting all three gives the all-India aggregate.
 */
export interface PriceScope {
  state?: string;
  district?: string;
  market?: string;
}

/**
 * Price trend for a commodity, with selling guidance.
 * Aggregates across markets by day (mean modal price) to smooth mandi-level noise.
 */
export async function getPriceTrend(
  commodity: string,
  days = 60,
  scope: PriceScope = {},
): Promise<PriceTrend> {
  // Pull today's mandi snapshot if we do not already have a current one. Both
  // the single-commodity and per-farm endpoints reach the database through
  // here, so doing it at this level covers both without either duplicating it.
  await ensureFreshPrices(commodity);

  const since = new Date(Date.now() - days * 86_400_000);

  const whereClause: Prisma.PriceHistoryWhereInput = {
    commodity,
    priceDate: { gte: since },
  };

  // Narrowest given filter wins implicitly — all three are ANDed, and the
  // frontend only ever sends a consistent state → district → mandi chain.
  if (scope.state) whereClause.state = scope.state;
  if (scope.district) whereClause.district = scope.district;
  if (scope.market) whereClause.marketName = scope.market;

  // A newly-listed mandi can hold a single day's row, which is not enough to
  // draw a chart or compute a change. Try the requested scope first, then widen
  // step by step rather than showing an empty card — and report which level we
  // ended up using so the UI can say so.
  const levels: Array<{ level: ScopeLevel; where: Prisma.PriceHistoryWhereInput }> = [
    { level: scopeLevelOf(scope), where: whereClause },
  ];
  const base = { commodity, priceDate: { gte: since } };
  if (scope.market && (scope.district || scope.state)) {
    levels.push({
      level: scope.district ? 'district' : 'state',
      where: {
        ...base,
        ...(scope.district ? { district: scope.district } : {}),
        ...(scope.state ? { state: scope.state } : {}),
      },
    });
  }
  if (scope.district && scope.state) {
    levels.push({ level: 'state', where: { ...base, state: scope.state } });
  }
  if (scope.state || scope.district || scope.market) {
    levels.push({ level: 'all', where: base });
  }

  let rows: Awaited<ReturnType<typeof prisma.priceHistory.findMany>> = [];
  let appliedLevel: ScopeLevel = levels[0].level;
  for (const candidate of levels) {
    rows = await prisma.priceHistory.findMany({
      where: candidate.where,
      orderBy: { priceDate: 'asc' },
    });
    appliedLevel = candidate.level;
    if (rows.length >= MIN_SERIES_POINTS) break;
  }

  const unit = rows[0]?.unit ?? 'Rs/quintal';
  const isSeeded = rows.some((r) => r.source === 'seed');

  // Collapse multiple markets on the same date into one point.
  const byDate = new Map<string, { modal: number[]; min: number[]; max: number[] }>();
  for (const row of rows) {
    const key = row.priceDate.toISOString().slice(0, 10);
    const bucket = byDate.get(key) ?? { modal: [], min: [], max: [] };
    bucket.modal.push(row.modalPrice);
    bucket.min.push(row.minPrice);
    bucket.max.push(row.maxPrice);
    byDate.set(key, bucket);
  }

  const series: PricePoint[] = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, b]) => ({
      date,
      // Median across the day's mandis, not mean. A handful of markets quoting
      // a premium grade pulls a mean well above what most farmers can actually
      // get, and the point of this number is "what is my crop worth today".
      // It also matches the statistic the seed anchors to, so a synthetic
      // baseline and real observations meet at the same level.
      modalPrice: Math.round(median(b.modal)),
      minPrice: Math.round(Math.min(...b.min)),
      maxPrice: Math.round(Math.max(...b.max)),
    }));

  const latestRow = rows.length ? rows[rows.length - 1] : null;
  const current = series.length
    ? {
        price: series[series.length - 1].modalPrice,
        date: series[series.length - 1].date,
        marketName: latestRow?.marketName ?? null,
      }
    : null;

  const statistics = computeStatistics(series);
  const direction = classifyDirection(statistics.change7DayPercent, statistics.volatilityPercent);
  const advice = buildAdvice(commodity, series, statistics, direction);

  return {
    commodity,
    unit,
    series,
    current,
    statistics,
    direction,
    advice,
    isSeeded,
    dataPoints: series.length,
    markets: [...new Set(rows.map((r) => r.marketName))].slice(0, 10),
    lastUpdated: latestRow?.priceDate.toISOString() ?? null,
    scope: {
      level: appliedLevel,
      label: scopeLabel(appliedLevel, scope),
      widened: appliedLevel !== scopeLevelOf(scope),
    },
  };
}

function computeStatistics(series: PricePoint[]): PriceTrend['statistics'] {
  if (series.length === 0) {
    return {
      average7Day: null,
      average30Day: null,
      change7DayPercent: null,
      change30DayPercent: null,
      high30Day: null,
      low30Day: null,
      volatilityPercent: null,
    };
  }

  const prices = series.map((p) => p.modalPrice);
  const last7 = prices.slice(-7);
  const last30 = prices.slice(-30);
  const latest = prices[prices.length - 1];

  const avg30 = mean(last30);
  const sd = standardDeviation(last30);

  return {
    average7Day: last7.length ? Math.round(mean(last7)) : null,
    average30Day: last30.length ? Math.round(avg30) : null,
    change7DayPercent: percentChange(prices, 7, latest),
    change30DayPercent: percentChange(prices, 30, latest),
    high30Day: last30.length ? Math.max(...last30) : null,
    low30Day: last30.length ? Math.min(...last30) : null,
    volatilityPercent: last30.length > 2 && avg30 > 0 ? round1((sd / avg30) * 100) : null,
  };
}

function percentChange(prices: number[], lookback: number, latest: number): number | null {
  if (prices.length < 2) return null;
  const idx = Math.max(0, prices.length - 1 - lookback);
  const past = prices[idx];
  if (!past) return null;
  return round1(((latest - past) / past) * 100);
}

function classifyDirection(change7: number | null, volatility: number | null): TrendDirection {
  if (change7 === null) return 'STABLE';
  // A volatile market needs a bigger move before we call it a trend.
  const threshold = volatility !== null && volatility > 10 ? 5 : 2.5;
  if (change7 > threshold) return 'RISING';
  if (change7 < -threshold) return 'FALLING';
  return 'STABLE';
}

/**
 * Selling guidance.
 *
 * This is intentionally cautious. We are not predicting prices — we are
 * telling the farmer where today's price sits relative to the recent range
 * and which way it has been moving, then letting them decide.
 */
function buildAdvice(
  commodity: string,
  series: PricePoint[],
  stats: PriceTrend['statistics'],
  direction: TrendDirection,
): PriceTrend['advice'] {
  if (series.length < 3 || stats.average30Day === null) {
    return {
      signal: 'WATCH',
      headline: 'Not enough price history yet',
      reasoning:
        `We are still building up price history for ${commodity.toLowerCase()}. ` +
        `Check back in a few days, or ask at your local mandi for today's rate.`,
    };
  }

  const latest = series[series.length - 1].modalPrice;
  const { high30Day, low30Day, average30Day, change7DayPercent, volatilityPercent } = stats;

  // Where today's price sits within the 30-day range, 0 = low, 1 = high.
  const range = (high30Day ?? latest) - (low30Day ?? latest);
  const position = range > 0 ? (latest - (low30Day ?? latest)) / range : 0.5;
  const vsAverage = round1(((latest - average30Day) / average30Day) * 100);

  if (position >= 0.8 && direction !== 'FALLING') {
    return {
      signal: 'SELL',
      headline: 'Good time to sell',
      reasoning:
        `At ₹${latest}, prices are near the top of the last 30 days (₹${low30Day}-₹${high30Day}) ` +
        `and ${vsAverage > 0 ? `${vsAverage}% above` : 'around'} the monthly average. ` +
        `${direction === 'RISING' ? 'Prices are still climbing, so watch daily if you can hold a little longer.' : 'This is a strong price relative to recent weeks.'}`,
    };
  }

  if (position <= 0.25 && direction === 'RISING') {
    return {
      signal: 'HOLD',
      headline: 'Consider holding',
      reasoning:
        `At ₹${latest}, prices are near the bottom of the 30-day range (₹${low30Day}-₹${high30Day}) ` +
        `but have risen ${change7DayPercent}% this week. If you can store safely, waiting may pay off.`,
    };
  }

  if (position <= 0.25) {
    return {
      signal: 'HOLD',
      headline: 'Prices are low right now',
      reasoning:
        `At ₹${latest}, this is near the 30-day low of ₹${low30Day}. ` +
        `If your crop stores well and you are not under pressure to sell, waiting is worth considering. ` +
        `Factor in storage cost and spoilage risk before deciding.`,
    };
  }

  if (direction === 'FALLING') {
    return {
      signal: 'SELL',
      headline: 'Prices are slipping',
      reasoning:
        `₹${latest} is down ${Math.abs(change7DayPercent ?? 0)}% over the past week. ` +
        `If you were planning to sell soon, doing it sooner may be better than later.`,
    };
  }

  return {
    signal: 'WATCH',
    headline: 'Prices are steady',
    reasoning:
      `At ₹${latest}, prices are mid-range for the last 30 days (₹${low30Day}-₹${high30Day})` +
      `${volatilityPercent !== null && volatilityPercent > 12 ? ' but this market has been swinging a lot, so check daily' : ' and fairly stable'}. ` +
      `No strong reason to rush either way.`,
  };
}

// ─────────────────────── Farm-scoped queries ───────────────────────

/** Price trends for every crop on a farm — powers the dashboard's market card. */
export async function getFarmPriceTrends(farmId: string, userId: string, scope: PriceScope = {}) {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    include: { crops: { select: { id: true, cropName: true, status: true } } },
  });
  if (!farm) throw new NotFoundError('Farm', farmId);

  // Map each crop to its AGMARKNET commodity name; skip unrecognised crops.
  const commodities = new Map<string, { cropId: string; cropName: string }>();
  for (const crop of farm.crops) {
    const profile = findCrop(crop.cropName);
    if (profile?.commodity && !commodities.has(profile.commodity)) {
      commodities.set(profile.commodity, { cropId: crop.id, cropName: crop.cropName });
    }
  }

  if (commodities.size === 0) {
    return {
      trends: [],
      message:
        farm.crops.length === 0
          ? 'Add a crop to your farm to see market prices.'
          : 'We do not have market price data for your current crops yet.',
    };
  }

  // No refresh fan-out here: `getPriceTrend` calls `ensureFreshPrices` for the
  // commodity it is about to read. This used to sync every commodity on every
  // request, which spent an upstream call per crop per page load — including
  // when the stored snapshot was minutes old.

  const trends = await Promise.all(
    [...commodities.entries()].map(async ([commodity, meta]) => ({
      ...meta,
      ...(await getPriceTrend(commodity, 60, scope)),
    })),
  );

  return { trends, message: null };
}

// ─────────────────────────── Seeding ───────────────────────────

/**
 * Realistic baseline price history, so trends and charts work before any live
 * data has accumulated.
 *
 * Base prices are approximate 2024-25 mandi modal rates in Rs/quintal. The
 * generated series applies a seasonal component (harvest gluts depress prices,
 * lean months lift them) plus bounded random walk noise. Rows are tagged
 * `source: 'seed'` and never overwrite real AGMARKNET observations.
 */
const BASE_PRICES: Record<string, number> = {
  Rice: 2300,
  Wheat: 2400,
  Maize: 2100,
  Cotton: 7200,
  Soyabean: 4600,
  Onion: 1800,
  Potato: 1300,
  Tomato: 2000,
  Sugarcane: 350,
  'Bengal Gram(Gram)': 5800,
  Mustard: 5400,
  Groundnut: 6300,
};

/** Month-of-year multipliers capturing harvest-season price dips. */
const SEASONALITY: Record<string, number[]> = {
  // Kharif harvest Oct-Nov depresses rice; lean season Jul-Aug lifts it.
  Rice: [1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.07, 1.03, 0.94, 0.92, 0.97],
  // Rabi harvest Mar-Apr depresses wheat.
  Wheat: [1.05, 1.03, 0.93, 0.91, 0.95, 0.99, 1.02, 1.04, 1.06, 1.07, 1.08, 1.06],
  Onion: [0.9, 0.88, 0.85, 0.9, 1.0, 1.1, 1.25, 1.35, 1.3, 1.15, 1.0, 0.95],
  Potato: [0.85, 0.8, 0.82, 0.9, 1.0, 1.1, 1.2, 1.25, 1.2, 1.1, 1.0, 0.9],
  Tomato: [1.0, 0.95, 0.9, 1.0, 1.15, 1.3, 1.4, 1.35, 1.15, 1.0, 0.95, 1.0],
};

const FLAT_SEASONALITY = Array(12).fill(1);

/**
 * Deterministic pseudo-random noise.
 * Seeded from the commodity name and day index so re-running the seeder
 * reproduces the same series — important for a demo you rehearse.
 */
function seededNoise(seed: string, index: number): number {
  let h = 2166136261;
  const input = `${seed}:${index}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Map to [-1, 1].
  return ((h >>> 0) / 0xffffffff) * 2 - 1;
}

/**
 * The observed price level per commodity, from real AGMARKNET rows.
 *
 * Median rather than mean: a single premium-grade mandi reporting basmati at
 * three times the going rate should not lift the whole baseline. Commodities
 * with no live rows are simply absent, and the caller falls back to the table.
 */
async function observedBasePrices(): Promise<Map<string, number>> {
  const rows = await prisma.priceHistory.findMany({
    where: { source: 'agmarknet' },
    select: { commodity: true, modalPrice: true },
  });

  const byCommodity = new Map<string, number[]>();
  for (const row of rows) {
    const prices = byCommodity.get(row.commodity) ?? [];
    prices.push(row.modalPrice);
    byCommodity.set(row.commodity, prices);
  }

  const bases = new Map<string, number>();
  for (const [commodity, prices] of byCommodity) {
    prices.sort((a, b) => a - b);
    bases.set(commodity, Math.round(prices[Math.floor(prices.length / 2)]));
  }

  return bases;
}

export async function seedPriceHistory(days = 90): Promise<number> {
  const markets = [
    // Madhya Pradesh
    { marketName: 'Indore', state: 'Madhya Pradesh', district: 'Indore' },
    { marketName: 'Bhopal', state: 'Madhya Pradesh', district: 'Bhopal' },
    { marketName: 'Ujjain', state: 'Madhya Pradesh', district: 'Ujjain' },
    { marketName: 'Dewas', state: 'Madhya Pradesh', district: 'Dewas' },
    { marketName: 'Jabalpur', state: 'Madhya Pradesh', district: 'Jabalpur' },
    { marketName: 'Sagar', state: 'Madhya Pradesh', district: 'Sagar' },
    { marketName: 'Gwalior', state: 'Madhya Pradesh', district: 'Gwalior' },
    // Uttar Pradesh
    { marketName: 'Lucknow', state: 'Uttar Pradesh', district: 'Lucknow' },
    { marketName: 'Kanpur', state: 'Uttar Pradesh', district: 'Kanpur Nagar' },
    { marketName: 'Agra', state: 'Uttar Pradesh', district: 'Agra' },
    { marketName: 'Varanasi', state: 'Uttar Pradesh', district: 'Varanasi' },
    { marketName: 'Meerut', state: 'Uttar Pradesh', district: 'Meerut' },
    { marketName: 'Mathura', state: 'Uttar Pradesh', district: 'Mathura' },
    // Rajasthan
    { marketName: 'Jaipur', state: 'Rajasthan', district: 'Jaipur' },
    { marketName: 'Jodhpur', state: 'Rajasthan', district: 'Jodhpur' },
    { marketName: 'Kota', state: 'Rajasthan', district: 'Kota' },
    { marketName: 'Ajmer', state: 'Rajasthan', district: 'Ajmer' },
    { marketName: 'Bikaner', state: 'Rajasthan', district: 'Bikaner' },
    // Maharashtra
    { marketName: 'Nashik', state: 'Maharashtra', district: 'Nashik' },
    { marketName: 'Pune', state: 'Maharashtra', district: 'Pune' },
    { marketName: 'Nagpur', state: 'Maharashtra', district: 'Nagpur' },
    { marketName: 'Solapur', state: 'Maharashtra', district: 'Solapur' },
    { marketName: 'Latur', state: 'Maharashtra', district: 'Latur' },
    // Punjab
    { marketName: 'Bathinda', state: 'Punjab', district: 'Bathinda' },
    { marketName: 'Amritsar', state: 'Punjab', district: 'Amritsar' },
    { marketName: 'Ludhiana', state: 'Punjab', district: 'Ludhiana' },
    { marketName: 'Patiala', state: 'Punjab', district: 'Patiala' },
    // Andhra Pradesh
    { marketName: 'Kurnool', state: 'Andhra Pradesh', district: 'Kurnool' },
    { marketName: 'Guntur', state: 'Andhra Pradesh', district: 'Guntur' },
    { marketName: 'Vijayawada', state: 'Andhra Pradesh', district: 'Krishna' },
    // Gujarat
    { marketName: 'Rajkot', state: 'Gujarat', district: 'Rajkot' },
    { marketName: 'Ahmedabad', state: 'Gujarat', district: 'Ahmedabad' },
    { marketName: 'Surat', state: 'Gujarat', district: 'Surat' },
    { marketName: 'Junagadh', state: 'Gujarat', district: 'Junagadh' },
    // West Bengal
    { marketName: 'Burdwan', state: 'West Bengal', district: 'Purba Bardhaman' },
    { marketName: 'Kolkata', state: 'West Bengal', district: 'Kolkata' },
    { marketName: 'Murshidabad', state: 'West Bengal', district: 'Murshidabad' },
  ];

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const rows: Prisma.PriceHistoryCreateManyInput[] = [];

  // Anchor the synthetic series to what each commodity actually costs, where we
  // have observed it. `BASE_PRICES` is a hand-maintained 2024-25 table and
  // drifts: rice was listed at 2300 while live AGMARKNET reported a median of
  // 3500, so the seeded history ended ~40% below reality and the chart showed a
  // 57% "rise" on the day real data began — an artefact of the join, not a
  // market movement. The table remains the fallback for commodities we have
  // never seen a live price for.
  const observed = await observedBasePrices();

  for (const crop of CROPS) {
    const commodity = crop.commodity;
    const base = observed.get(commodity) ?? BASE_PRICES[commodity];
    if (!base) continue;

    const seasonality = SEASONALITY[commodity] ?? FLAT_SEASONALITY;

    // Random-walk drift accumulated across the window, bounded so the series
    // stays plausible rather than wandering off.
    let drift = 0;

    // Build the national-level series first so it can be rescaled as a whole,
    // before per-mandi offsets are applied.
    const generated: Array<{ date: Date; modal: number }> = [];

    for (let i = days; i >= 0; i--) {
      const date = new Date(today.getTime() - i * 86_400_000);
      const month = date.getUTCMonth();

      drift = clamp(drift + seededNoise(commodity, i) * 0.012, -0.15, 0.15);
      const seasonal = seasonality[month];
      const daily = seededNoise(`${commodity}-daily`, i) * 0.02;

      generated.push({ date, modal: base * seasonal * (1 + drift + daily) });
    }

    /**
     * Land the last synthetic day on the price actually observed today.
     *
     * Anchoring the base alone is not enough: the seasonal multiplier is free
     * to carry the series well away from it by the final day. Onion anchored
     * to a 2,980 median still ended at 3,785 against a real 3,125, and that
     * gap showed up on the chart as a 22% one-day crash the moment live data
     * joined — an artefact of the join, not a market event.
     *
     * Scaling the whole series preserves its shape (seasonality, drift,
     * volatility) while making it meet reality at the seam.
     */
    const anchor = observed.get(commodity);
    const generatedLast = generated[generated.length - 1]?.modal;
    const scale = anchor && generatedLast ? anchor / generatedLast : 1;

    for (const point of generated) {
      const date = point.date;
      const modal = Math.round(point.modal * scale);
      const spread = Math.round(modal * 0.06);

      for (const market of markets) {
        // Persistent per-mandi premium/discount, derived from the mandi name so
        // every mandi reads differently (an index-modulo offset made mandis five
        // apart in the list quote identical prices).
        const offsetPct = seededNoise(market.marketName, 0) * 0.03;
        const offset = Math.round(modal * offsetPct);
        const marketModal = modal + offset;

        rows.push({
          commodity,
          priceDate: date,
          minPrice: marketModal - spread,
          maxPrice: marketModal + spread,
          modalPrice: marketModal,
          unit: crop.priceUnit,
          source: 'seed',
          ...market,
        });
      }
    }
  }

  // Replace any previous seed run wholesale. Real AGMARKNET rows are matched
  // on `source` and left untouched, so live data is never clobbered.
  await prisma.priceHistory.deleteMany({ where: { source: 'seed' } });

  // Insert in chunks. A single createMany with ~40k documents exceeds MongoDB's
  // 16 MB command limit, and the whole call fails — which is how this table
  // ended up effectively empty, leaving every chart with one data point.
  // (`skipDuplicates` is unsupported on MongoDB, so a chunk that collides with a
  // live AGMARKNET row is retried one row at a time and the clash is skipped.)
  const CHUNK = 1_000;
  let created = 0;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    try {
      const result = await prisma.priceHistory.createMany({ data: chunk });
      created += result.count;
    } catch {
      for (const row of chunk) {
        try {
          await prisma.priceHistory.create({ data: row });
          created += 1;
        } catch {
          // Already covered by a real observation — leave it alone.
        }
      }
    }
  }

  logger.info({ created, attempted: rows.length }, 'Seeded price history');
  return created;
}

/**
 * State → district → mandi options for the price filter.
 *
 * Uses `groupBy` rather than `findMany({ distinct })`: on MongoDB Prisma applies
 * `distinct` in memory after fetching every matching document, which means
 * pulling the whole price table on each page load. `groupBy` pushes the
 * aggregation into the database and gives us the per-mandi row count for free.
 */
export async function getUniqueLocations() {
  const groups = await prisma.priceHistory.groupBy({
    by: ['state', 'district', 'marketName'],
    _count: { _all: true },
  });

  const locations = groups
    .map((g) => ({
      state: g.state,
      district: g.district,
      marketName: g.marketName,
      dataPoints: g._count._all,
    }))
    // A mandi with a day or two of rows cannot produce a chart, and offering it
    // in the dropdown only leads to an empty card.
    .filter((l) => l.dataPoints >= MIN_SERIES_POINTS && l.state !== 'Unknown')
    .sort(
      (a, b) =>
        a.state.localeCompare(b.state) ||
        a.district.localeCompare(b.district) ||
        a.marketName.localeCompare(b.marketName),
    );

  return { locations };
}

// ─────────────────────────── Utils ───────────────────────────

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Middle value. Even-length inputs take the mean of the two middle values. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
