/**
 * Resource planning service — fertiliser schedules and yield estimates.
 *
 * Both features read the same farm/crop context, so they share a loader.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { logger } from '../../common/logger';
import { NotFoundError } from '../../common/errors';
import { resolveCrop, findCrop } from '../../domain/crops';
import { getWeatherForFarm } from '../weather/weather.service';
import { getIrrigationGuidance } from '../weather/weather.service';
import { planFertilizer, type FertilizerPlan } from './fertilizer';
import { predictYield, type YieldPrediction } from './yield';

/** Load a crop plus its owning farm, enforcing ownership. */
async function loadContext(farmId: string, cropId: string, userId: string) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new NotFoundError('Farm', farmId);

  const cropRecord = await prisma.crop.findFirst({ where: { id: cropId, farmId } });
  if (!cropRecord) throw new NotFoundError('Crop', cropId);

  const { crop, isKnown } = resolveCrop(cropRecord.cropName);
  return { farm, cropRecord, crop, isKnown };
}

// ─────────────────────────── Fertiliser ───────────────────────────

export async function getFertilizerPlan(
  farmId: string,
  cropId: string,
  userId: string,
): Promise<FertilizerPlan> {
  const { farm, cropRecord, crop, isKnown } = await loadContext(farmId, cropId, userId);

  // A crop assigned to a plot is planned for that plot's area, not the whole farm.
  let areaHectares = farm.totalAreaHectares;
  if (cropRecord.parcelId) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: cropRecord.parcelId },
      select: { areaHectares: true },
    });
    if (parcel) areaHectares = parcel.areaHectares;
  }

  return planFertilizer({
    crop,
    cropIsKnown: isKnown,
    areaHectares,
    growthStage: cropRecord.growthStage,
    soilType: farm.soilTypePrimary,
    soilAnalysis: (farm.soilAnalysis as Record<string, unknown> | null) ?? null,
  });
}

// ─────────────────────────── Yield ───────────────────────────

export async function getYieldPrediction(
  farmId: string,
  cropId: string,
  userId: string,
): Promise<YieldPrediction> {
  const { farm, cropRecord, crop, isKnown } = await loadContext(farmId, cropId, userId);

  let areaHectares = farm.totalAreaHectares;
  if (cropRecord.parcelId) {
    const parcel = await prisma.parcel.findUnique({
      where: { id: cropRecord.parcelId },
      select: { areaHectares: true },
    });
    if (parcel) areaHectares = parcel.areaHectares;
  }

  const [healthLogs, irrigationCount, price, depletion, weather] = await Promise.all([
    prisma.healthLog.findMany({
      where: { cropId },
      select: { severity: true, status: true, observedAt: true },
      orderBy: { observedAt: 'desc' },
      take: 20,
    }),
    prisma.irrigationLog.count({ where: { cropId } }),
    latestPrice(cropRecord.cropName),
    currentDepletion(farmId, cropId, userId),
    recentWeather(farmId, farm.latitude, farm.longitude),
  ]);

  const prediction = predictYield({
    crop,
    cropIsKnown: isKnown,
    areaHectares,
    plantingDate: cropRecord.plantingDate,
    growthStage: cropRecord.growthStage,
    weather,
    healthLogs,
    irrigationCount,
    currentDepletionPercent: depletion,
    currentPrice: price,
  });

  await storePrediction(farmId, cropId, prediction);

  return prediction;
}

/**
 * Keep a copy of the run, and mirror the headline figure onto
 * `Crop.expectedYieldKg` so the dashboard and crop list can show it without
 * going through this module.
 *
 * Rate-limited to one row per crop per 6 hours: a farmer opening the planning
 * page five times should not produce five identical rows and make the history
 * unreadable. The underlying weather is cached for hours anyway, so a rerun
 * inside that window would produce the same number.
 */
const PREDICTION_DEDUPE_MS = 6 * 3_600_000;

async function storePrediction(
  farmId: string,
  cropId: string,
  prediction: YieldPrediction,
): Promise<void> {
  try {
    const recent = await prisma.yieldPredictionLog.findFirst({
      where: { cropId, predictedAt: { gte: new Date(Date.now() - PREDICTION_DEDUPE_MS) } },
      select: { id: true },
    });

    if (!recent) {
      await prisma.yieldPredictionLog.create({
        data: {
          farmId,
          cropId,
          predictedTotalKg: prediction.predictedTotalKg,
          predictedKgHa: prediction.predictedKgHa,
          rangeLowKg: prediction.rangeTotalKg.low,
          rangeHighKg: prediction.rangeTotalKg.high,
          areaHectares: prediction.areaHectares,
          confidence: prediction.confidence,
          seasonProgress: prediction.seasonProgress,
          estimatedIncome: prediction.estimatedIncome,
          factors: prediction.factors as unknown as Prisma.InputJsonValue,
        },
      });
    }

    await prisma.crop.update({
      where: { id: cropId },
      data: { expectedYieldKg: prediction.predictedTotalKg },
    });
  } catch (err) {
    // Losing the stored copy is a nuisance, not a reason to fail the request —
    // the farmer still gets their estimate.
    logger.warn({ farmId, cropId, err }, 'Failed to store yield prediction');
  }
}

// ─────────────────────── Prediction history ───────────────────────

export interface YieldHistoryEntry {
  id: string;
  cropId: string;
  cropName: string;
  predictedAt: Date;
  predictedTotalKg: number;
  predictedKgHa: number;
  rangeLowKg: number;
  rangeHighKg: number;
  confidence: number;
  seasonProgress: number;
  estimatedIncome: number | null;
  /** Set once the harvest has been recorded, so the estimate can be scored. */
  actualYieldKg: number | null;
}

/**
 * Past estimates, newest first. This is what turns a single number into a story:
 * the farmer sees the estimate climb after irrigating, or drop when a disease
 * was logged.
 */
export async function getYieldHistory(
  farmId: string,
  userId: string,
  options: { cropId?: string; limit: number },
): Promise<YieldHistoryEntry[]> {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    select: { id: true },
  });
  if (!farm) throw new NotFoundError('Farm', farmId);

  const rows = await prisma.yieldPredictionLog.findMany({
    where: { farmId, ...(options.cropId ? { cropId: options.cropId } : {}) },
    include: { crop: { select: { cropName: true, actualYieldKg: true } } },
    orderBy: { predictedAt: 'desc' },
    take: options.limit,
  });

  return rows.map((row) => ({
    id: row.id,
    cropId: row.cropId,
    cropName: row.crop.cropName,
    predictedAt: row.predictedAt,
    predictedTotalKg: row.predictedTotalKg,
    predictedKgHa: row.predictedKgHa,
    rangeLowKg: row.rangeLowKg,
    rangeHighKg: row.rangeHighKg,
    confidence: row.confidence,
    seasonProgress: row.seasonProgress,
    estimatedIncome: row.estimatedIncome,
    actualYieldKg: row.crop.actualYieldKg,
  }));
}

// ─────────────────────── Actual harvest ───────────────────────

export interface RecordHarvestResult {
  crop: {
    id: string;
    cropName: string;
    status: string;
    actualYieldKg: number | null;
    expectedYieldKg: number | null;
  };
  lastPrediction: { predictedTotalKg: number; predictedAt: Date } | null;
  /** Signed percent the estimate was off by. Positive means it over-predicted. */
  errorPercent: number | null;
  /** True when the actual landed inside the estimate's stated range. */
  withinPredictedRange: boolean | null;
}

/**
 * Record what was actually harvested.
 *
 * `Crop.actualYieldKg` existed in the schema but nothing wrote to it, so the
 * yield estimate could never be checked against reality. This closes that loop.
 *
 * The crop also moves to HARVESTED: recording a real weight is the farmer
 * telling us the season is over, and leaving it active would keep it in the
 * planning list being predicted for.
 */
export async function recordActualYield(
  farmId: string,
  cropId: string,
  userId: string,
  actualYieldKg: number,
): Promise<RecordHarvestResult> {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    select: { id: true },
  });
  if (!farm) throw new NotFoundError('Farm', farmId);

  const existing = await prisma.crop.findFirst({ where: { id: cropId, farmId } });
  if (!existing) throw new NotFoundError('Crop', cropId);

  // Read the last prediction before the update, so the comparison is against
  // what we told the farmer rather than anything written afterwards.
  const latest = await prisma.yieldPredictionLog.findFirst({
    where: { cropId },
    orderBy: { predictedAt: 'desc' },
    select: { predictedTotalKg: true, predictedAt: true, rangeLowKg: true, rangeHighKg: true },
  });

  const updated = await prisma.crop.update({
    where: { id: cropId },
    data: { actualYieldKg, status: 'HARVESTED' },
  });

  const errorPercent =
    latest && actualYieldKg > 0
      ? Math.round((latest.predictedTotalKg / actualYieldKg - 1) * 100)
      : null;

  const withinPredictedRange = latest
    ? actualYieldKg >= latest.rangeLowKg && actualYieldKg <= latest.rangeHighKg
    : null;

  logger.info(
    { farmId, cropId, actualYieldKg, errorPercent, withinPredictedRange },
    'Actual yield recorded',
  );

  return {
    crop: {
      id: updated.id,
      cropName: updated.cropName,
      status: updated.status,
      actualYieldKg: updated.actualYieldKg,
      expectedYieldKg: updated.expectedYieldKg,
    },
    lastPrediction: latest
      ? { predictedTotalKg: latest.predictedTotalKg, predictedAt: latest.predictedAt }
      : null,
    errorPercent,
    withinPredictedRange,
  };
}

async function latestPrice(cropName: string): Promise<number | null> {
  const profile = findCrop(cropName);
  if (!profile?.commodity) return null;

  const row = await prisma.priceHistory.findFirst({
    where: { commodity: profile.commodity },
    orderBy: { priceDate: 'desc' },
    select: { modalPrice: true },
  });
  return row?.modalPrice ?? null;
}

/**
 * Current root-zone depletion from the irrigation engine — the best available
 * measure of whether the crop has been kept watered. Best-effort: the yield
 * model falls back to a rainfall ratio if this is unavailable.
 */
async function currentDepletion(
  farmId: string,
  cropId: string,
  userId: string,
): Promise<number | null> {
  try {
    const guidance = await getIrrigationGuidance(farmId, userId, { cropId });
    return guidance.waterBalance.depletionPercent;
  } catch (err) {
    logger.debug({ farmId, cropId, err }, 'Depletion unavailable for yield estimate');
    return null;
  }
}

/** Observed weather for the season so far, from what we have stored. */
async function recentWeather(
  farmId: string,
  latitude: number,
  longitude: number,
): Promise<Array<{ tempMaxC: number; tempMinC: number; rainfallMm: number; et0Mm: number }>> {
  const stored = await prisma.weatherData.findMany({
    where: { farmId },
    orderBy: { recordedAt: 'desc' },
    take: 60,
    select: { temperatureMax: true, temperatureMin: true, rainfall: true, et0: true },
  });

  if (stored.length > 0) {
    return stored.map((row) => ({
      tempMaxC: row.temperatureMax ?? 30,
      tempMinC: row.temperatureMin ?? 20,
      rainfallMm: row.rainfall ?? 0,
      et0Mm: row.et0 ?? 4,
    }));
  }

  // Nothing stored yet — pull a bundle so the first estimate is not blind.
  try {
    const { weather } = await getWeatherForFarm(farmId, latitude, longitude);
    return weather.daily.map((d) => ({
      tempMaxC: d.tempMaxC,
      tempMinC: d.tempMinC,
      rainfallMm: d.precipitationMm,
      et0Mm: d.et0Mm,
    }));
  } catch {
    return [];
  }
}

// ─────────────────────── Whole-farm summary ───────────────────────

export interface CropPlan {
  cropId: string;
  cropName: string;
  status: string;
  fertilizer: FertilizerPlan;
  yieldPrediction: YieldPrediction;
}

/** Fertiliser and yield for every active crop — powers the planning page. */
export async function getFarmPlan(
  farmId: string,
  userId: string,
): Promise<{ crops: CropPlan[]; message: string | null }> {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    include: {
      crops: {
        where: { status: { notIn: ['HARVESTED', 'FAILED', 'FALLOW'] } },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!farm) throw new NotFoundError('Farm', farmId);

  if (farm.crops.length === 0) {
    return { crops: [], message: 'Add a crop to see fertiliser and yield planning.' };
  }

  // Each crop's plan is independent; one failing must not lose the others.
  const results = await Promise.allSettled(
    farm.crops.map(
      async (crop): Promise<CropPlan> => ({
        cropId: crop.id,
        cropName: crop.cropName,
        status: crop.status,
        fertilizer: await getFertilizerPlan(farmId, crop.id, userId),
        yieldPrediction: await getYieldPrediction(farmId, crop.id, userId),
      }),
    ),
  );

  const crops = results
    .filter((r): r is PromiseFulfilledResult<CropPlan> => r.status === 'fulfilled')
    .map((r) => r.value);

  const failed = results.length - crops.length;
  if (failed > 0) logger.warn({ farmId, failed }, 'Some crop plans could not be built');

  return {
    crops,
    message:
      failed > 0
        ? `Planning could not be completed for ${failed} crop${failed === 1 ? '' : 's'}.`
        : null,
  };
}
