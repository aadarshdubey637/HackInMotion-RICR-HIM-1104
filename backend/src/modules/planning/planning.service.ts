/**
 * Resource planning service — fertiliser schedules and yield estimates.
 *
 * Both features read the same farm/crop context, so they share a loader.
 */

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

  return predictYield({
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
