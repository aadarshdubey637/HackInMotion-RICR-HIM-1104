/**
 * Unified farmer dashboard.
 *
 * Answers one question: "what do I need to act on today?"
 *
 * Every section is resolved independently and failure-isolated. If the weather
 * provider is down, the farmer still sees their crops, health flags and prices,
 * with an honest note about what is missing. A partially-populated dashboard is
 * always better than an error page.
 */

import { prisma } from '../../common/prisma';
import { logger } from '../../common/logger';
import { NotFoundError } from '../../common/errors';
import { findCrop, currentSeason } from '../../domain/crops';
import { getIrrigationGuidance, getWeatherForFarm } from '../weather/weather.service';
import { getPriceTrend } from '../market/market.service';

export type ActionPriority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

/** A single thing the farmer might need to do, ranked against everything else. */
export interface ActionItem {
  id: string;
  priority: ActionPriority;
  category: 'IRRIGATION' | 'WEATHER' | 'HEALTH' | 'MARKET' | 'SETUP';
  title: string;
  detail: string;
  /** The concrete next step. */
  action: string;
  /** Where in the app to go to deal with it. */
  link?: string;
  cropName?: string;
}

const PRIORITY_ORDER: Record<ActionPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFO: 4,
};

export interface DashboardResult {
  farm: {
    id: string;
    name: string;
    address: string | null;
    latitude: number;
    longitude: number;
    totalAreaHectares: number;
    soilTypePrimary: string | null;
    season: string;
  };
  /** The ranked to-do list. This is the heart of the dashboard. */
  actions: ActionItem[];
  crops: Array<{
    id: string;
    cropName: string;
    status: string;
    growthStage: string | null;
    plantingDate: Date | null;
    expectedHarvestDate: Date | null;
    isRecognised: boolean;
    daysToHarvest: number | null;
  }>;
  weather: {
    available: boolean;
    current?: {
      temperatureC: number;
      humidityPct: number;
      /**
       * Forwarded from Open-Meteo's `wind_speed_10m`. The dashboard used to
       * derive a wind figure from the farm's latitude, which produced a number
       * that looked plausible, never changed, and meant nothing.
       */
      windSpeedKmh: number;
      description: string;
      /** When the provider observed this reading — not when we rendered it. */
      observedAt: string;
    };
    today?: { tempMaxC: number; tempMinC: number; rainMm: number; rainProbability: number | null };
    upcoming?: Array<{
      date: string;
      tempMaxC: number;
      tempMinC: number;
      rainMm: number;
      description: string;
    }>;
    warning?: string;
  };
  irrigation: {
    available: boolean;
    shouldIrrigate?: boolean;
    urgency?: string;
    headline?: string;
    reason?: string;
    depthMm?: number | null;
    depletionPercent?: number;
    /**
     * Root-zone water remaining, as a percentage. The inverse of
     * `depletionPercent`, clamped: depletion is measured against *readily*
     * available water and legitimately exceeds 100% once the crop is stressed,
     * which would otherwise render as a negative moisture reading.
     */
    moisturePercent?: number;
    /**
     * Day-by-day moisture across the modelled window — past days rolled forward
     * through observed weather, future days projected. This is what the trend
     * line on the dashboard plots; before, that line was a fixed SVG path.
     */
    trend?: Array<{ date: string; isPast: boolean; moisturePercent: number }>;
    cropName?: string;
    warning?: string;
  };
  health: {
    activeIssues: number;
    /**
     * 0–100, derived from the severity of the farm's open issues rather than a
     * count of them. The dashboard previously mapped 0/1/many issues onto the
     * fixed scores 95/82/65, so one critical outbreak and one mild leaf spot
     * scored identically.
     */
    score: number;
    recent: Array<{
      id: string;
      cropName: string;
      severity: string;
      summary: string;
      observedAt: Date;
      status: string;
    }>;
  };
  market: {
    available: boolean;
    trends: Array<{
      commodity: string;
      cropName: string;
      currentPrice: number | null;
      unit: string;
      direction: string;
      change7DayPercent: number | null;
      signal: string;
      headline: string;
      isSeeded: boolean;
    }>;
    message?: string;
  };
  alerts: {
    unread: number;
    items: Array<{
      id: string;
      alertType: string;
      severity: string;
      message: string;
      title: string | null;
      action: string | null;
      createdAt: Date;
      isRead: boolean;
    }>;
  };
  generatedAt: string;
}

export async function getDashboard(farmId: string, userId: string): Promise<DashboardResult> {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    include: { crops: { orderBy: { createdAt: 'desc' } } },
  });
  if (!farm) throw new NotFoundError('Farm', farmId);

  const actions: ActionItem[] = [];

  // Run the independent sections concurrently. `allSettled` so one rejection
  // cannot take down the whole dashboard.
  const [
    irrigationResult,
    healthResult,
    healthTallyResult,
    alertsResult,
    marketResult,
    weatherBundleResult,
  ] = await Promise.allSettled([
      getIrrigationGuidance(farmId, userId).catch((err) => {
        logger.warn({ farmId, err }, 'Dashboard: irrigation unavailable');
        throw err;
      }),
      prisma.healthLog.findMany({
        where: { farmId, status: { in: ['ACTIVE', 'MONITORING'] } },
        include: { crop: { select: { cropName: true } } },
        orderBy: { observedAt: 'desc' },
        take: 5,
      }),
      // Counted separately, across *every* open issue. The query above is
      // capped at 5 because the card only lists five, but deriving the issue
      // count from that capped list made a farm with twelve problems report
      // five — and the health score built on it was wrong in the same way.
      prisma.healthLog.groupBy({
        by: ['severity'],
        where: { farmId, status: { in: ['ACTIVE', 'MONITORING'] } },
        _count: { _all: true },
      }),
      prisma.alert.findMany({
        where: {
          farmId,
          isDismissed: false,
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 10,
      }),
      buildMarketSection(farm.crops),
      getWeatherForFarm(farmId, farm.latitude, farm.longitude).catch((err) => {
        logger.warn({ farmId, err }, 'Dashboard: weather bundle unavailable');
        throw err;
      }),
    ]);

  const weatherBundle =
    weatherBundleResult.status === 'fulfilled' ? weatherBundleResult.value.weather : null;

  // ── Weather + irrigation ──
  const weather: DashboardResult['weather'] = { available: false };
  const irrigation: DashboardResult['irrigation'] = { available: false };

  if (irrigationResult.status === 'fulfilled') {
    const guidance = irrigationResult.value;
    const upcoming = guidance.forecast.filter((d) => !d.isPast);
    const today = upcoming[0];

    irrigation.available = true;
    irrigation.shouldIrrigate = guidance.shouldIrrigate;
    irrigation.urgency = guidance.urgency;
    irrigation.headline = guidance.headline;
    irrigation.reason = guidance.reason;
    irrigation.depthMm = guidance.recommendation?.depthMm ?? null;
    irrigation.depletionPercent = guidance.waterBalance.depletionPercent;
    irrigation.moisturePercent = toMoisturePercent(guidance.waterBalance.depletionPercent);
    irrigation.trend = guidance.forecast.map((day) => ({
      date: day.date,
      isPast: day.isPast,
      // `stressRatio` is depletion over readily-available water on the same
      // basis as `depletionPercent`, so the last past point of this series
      // lines up with the headline figure above rather than drifting from it.
      moisturePercent: toMoisturePercent(day.stressRatio * 100),
    }));
    irrigation.cropName = guidance.crop.name;
    if (guidance.warning) irrigation.warning = guidance.warning;

    weather.available = true;
    weather.warning = guidance.warning;
    if (weatherBundle?.current) {
      weather.current = {
        temperatureC: weatherBundle.current.temperatureC,
        humidityPct: weatherBundle.current.humidityPct,
        windSpeedKmh: weatherBundle.current.windSpeedKmh,
        description: weatherBundle.current.description,
        observedAt: weatherBundle.current.time,
      };
    }
    if (today) {
      weather.today = {
        tempMaxC: today.tempMaxC,
        tempMinC: today.tempMinC,
        rainMm: today.rawRainMm,
        rainProbability: today.rainProbability,
      };
    }
    weather.upcoming = upcoming.slice(0, 7).map((d) => ({
      date: d.date,
      tempMaxC: d.tempMaxC,
      tempMinC: d.tempMinC,
      rainMm: d.rawRainMm,
      description: d.description,
    }));

    // Irrigation → action item.
    if (guidance.shouldIrrigate) {
      actions.push({
        id: 'irrigation',
        priority: guidance.urgency === 'OVERDUE' ? 'CRITICAL' : 'HIGH',
        category: 'IRRIGATION',
        title: guidance.headline,
        detail: guidance.reason,
        action: guidance.recommendation
          ? `Apply about ${guidance.recommendation.depthMm} mm (${guidance.recommendation.totalCubicMetres} m³ across ${farm.totalAreaHectares} ha).`
          : 'Irrigate today.',
        link: `/farms/${farmId}/irrigation`,
        cropName: guidance.crop.name,
      });
    }

    // Weather risks → action items.
    for (const alert of guidance.alerts) {
      if (alert.type === 'IRRIGATION_NEEDED') continue; // already covered above
      actions.push({
        id: `weather-${alert.type}-${alert.date ?? 'now'}`,
        priority:
          alert.severity === 'CRITICAL'
            ? 'CRITICAL'
            : alert.severity === 'HIGH'
              ? 'HIGH'
              : 'MEDIUM',
        category: 'WEATHER',
        title: alert.title,
        detail: alert.message,
        action: alert.action,
        link: `/farms/${farmId}/weather`,
      });
    }
  } else {
    weather.warning =
      'Weather data is unavailable right now. Irrigation guidance will return once it is back.';
    irrigation.warning = weather.warning;
  }

  // ── Crop health ──
  const healthLogs = healthResult.status === 'fulfilled' ? healthResult.value : [];
  const healthTally = healthTallyResult.status === 'fulfilled' ? healthTallyResult.value : [];
  for (const log of healthLogs) {
    if (log.severity !== 'SEVERE' && log.severity !== 'CRITICAL') continue;
    const analysis = log.analysisResult as { summary?: string } | null;
    const steps = (log.recommendedActions as string[] | null) ?? [];
    actions.push({
      id: `health-${log.id}`,
      priority: log.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      category: 'HEALTH',
      title: `${log.diseaseDetected ?? log.pestDetected ?? 'Crop issue'} on ${log.crop.cropName}`,
      detail: analysis?.summary ?? log.description,
      action: steps[0] ?? 'Inspect the affected plants closely.',
      link: `/farms/${farmId}/health/${log.id}`,
      cropName: log.crop.cropName,
    });
  }

  // ── Market ──
  const market =
    marketResult.status === 'fulfilled'
      ? marketResult.value
      : { available: false, trends: [], message: 'Market prices are unavailable right now.' };

  for (const trend of market.trends) {
    if (trend.signal !== 'SELL') continue;
    actions.push({
      id: `market-${trend.commodity}`,
      priority: 'MEDIUM',
      category: 'MARKET',
      title: `${trend.headline} — ${trend.cropName}`,
      detail:
        trend.currentPrice !== null
          ? `${trend.commodity} is at ₹${trend.currentPrice} ${trend.unit}${
              trend.change7DayPercent !== null
                ? `, ${trend.change7DayPercent > 0 ? 'up' : 'down'} ${Math.abs(trend.change7DayPercent)}% this week`
                : ''
            }.`
          : `Price movement detected for ${trend.commodity}.`,
      action: 'Review the price trend before deciding when to sell.',
      link: `/farms/${farmId}/market`,
      cropName: trend.cropName,
    });
  }

  // ── Profile completeness ──
  if (farm.crops.length === 0) {
    actions.push({
      id: 'setup-crop',
      priority: 'HIGH',
      category: 'SETUP',
      title: 'Add your crop',
      detail:
        'Irrigation guidance, health checks and price tracking all depend on knowing what you are growing.',
      action: 'Add the crop you are growing or planning to plant.',
      link: `/farms/${farmId}/crops/new`,
    });
  }
  if (!farm.soilTypePrimary) {
    actions.push({
      id: 'setup-soil',
      priority: 'LOW',
      category: 'SETUP',
      title: 'Add your soil type',
      detail:
        'Soil type decides how much water your land can hold, which makes irrigation advice noticeably more accurate.',
      action: 'Set your soil type in the farm profile.',
      link: `/farms/${farmId}/edit`,
    });
  }

  actions.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  // ── Alerts ──
  const alertRows = alertsResult.status === 'fulfilled' ? alertsResult.value : [];

  return {
    farm: {
      id: farm.id,
      name: farm.name,
      address: farm.address,
      latitude: farm.latitude,
      longitude: farm.longitude,
      totalAreaHectares: farm.totalAreaHectares,
      soilTypePrimary: farm.soilTypePrimary,
      season: currentSeason(),
    },
    actions,
    crops: farm.crops.map((crop) => ({
      id: crop.id,
      cropName: crop.cropName,
      status: crop.status,
      growthStage: crop.growthStage,
      plantingDate: crop.plantingDate,
      expectedHarvestDate: crop.expectedHarvestDate,
      isRecognised: Boolean(findCrop(crop.cropName)),
      daysToHarvest: crop.expectedHarvestDate
        ? Math.ceil((crop.expectedHarvestDate.getTime() - Date.now()) / 86_400_000)
        : null,
    })),
    weather,
    irrigation,
    health: {
      activeIssues: healthTally.reduce((sum, row) => sum + row._count._all, 0),
      score: healthScore(healthTally),
      recent: healthLogs.map((log) => {
        const analysis = log.analysisResult as { summary?: string } | null;
        return {
          id: log.id,
          cropName: log.crop.cropName,
          severity: log.severity,
          summary: analysis?.summary ?? log.description.slice(0, 120),
          observedAt: log.observedAt,
          status: log.status,
        };
      }),
    },
    market,
    alerts: {
      unread: alertRows.filter((a) => !a.isRead).length,
      items: alertRows.map((a) => {
        const meta = a.metadata as { title?: string; action?: string } | null;
        return {
          id: a.id,
          alertType: a.alertType,
          severity: a.severity,
          message: a.message,
          title: meta?.title ?? null,
          action: meta?.action ?? null,
          createdAt: a.createdAt,
          isRead: a.isRead,
        };
      }),
    },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Root-zone water remaining, from a depletion percentage.
 *
 * Depletion is measured against *readily* available water, so it passes 100%
 * as soon as the crop is drawing on reserves it cannot easily reach. Clamping
 * keeps the gauge honest at the bottom instead of rendering a negative width.
 */
function toMoisturePercent(depletionPercent: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - depletionPercent)));
}

/**
 * Crop health as a 0–100 score, weighted by how bad each open issue is.
 *
 * A count alone cannot separate three mild leaf spots from one critical
 * outbreak, and the farmer's decision differs completely between those. The
 * weights below are deliberately steep so a single CRITICAL drops the score
 * further than several MILD entries combined.
 */
function healthScore(tally: Array<{ severity: string; _count: { _all: number } }>): number {
  const penalties: Record<string, number> = {
    MILD: 5,
    MODERATE: 12,
    SEVERE: 22,
    CRITICAL: 35,
  };
  const total = tally.reduce(
    (sum, row) => sum + (penalties[row.severity] ?? 10) * row._count._all,
    0,
  );
  return Math.max(0, 100 - total);
}

/** Price trends for the farm's crops, shaped for the dashboard card. */
async function buildMarketSection(
  crops: Array<{ cropName: string }>,
): Promise<DashboardResult['market']> {
  const commodities = new Map<string, string>();
  for (const crop of crops) {
    const profile = findCrop(crop.cropName);
    if (profile?.commodity && !commodities.has(profile.commodity)) {
      commodities.set(profile.commodity, crop.cropName);
    }
  }

  if (commodities.size === 0) {
    return {
      available: false,
      trends: [],
      message:
        crops.length === 0
          ? 'Add a crop to see market prices.'
          : 'No market price data available for your current crops.',
    };
  }

  const trends = await Promise.all(
    [...commodities.entries()].map(async ([commodity, cropName]) => {
      const trend = await getPriceTrend(commodity, 60);
      return {
        commodity,
        cropName,
        currentPrice: trend.current?.price ?? null,
        unit: trend.unit,
        direction: trend.direction,
        change7DayPercent: trend.statistics.change7DayPercent,
        signal: trend.advice.signal,
        headline: trend.advice.headline,
        isSeeded: trend.isSeeded,
      };
    }),
  );

  return { available: true, trends };
}
