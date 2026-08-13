/**
 * Crop recommendation service.
 *
 * Assembles the inputs the scoring engine needs — climate normals, current
 * prices, the farm's soil and existing crops — then persists the result so the
 * farmer can see how advice has changed across seasons.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { logger } from '../../common/logger';
import { NotFoundError } from '../../common/errors';
import { CROPS, currentSeason } from '../../domain/crops';
import { getClimateWindow, type ClimateWindow } from './climate';
import { recommendCrops, type CropRecommendation } from './scoring';

/** Season length used for the climate lookup — the median crop duration. */
const CLIMATE_WINDOW_DAYS = 120;

export interface RecommendationResult {
  farm: {
    id: string;
    name: string;
    latitude: number;
    longitude: number;
    soilType: string | null;
    areaHectares: number;
  };
  season: string;
  climate: ClimateWindow | null;
  recommendations: CropRecommendation[];
  /** Set when climate data could not be fetched — scores are then less reliable. */
  warning?: string;
  generatedAt: string;
}

export async function getRecommendations(
  farmId: string,
  userId: string,
): Promise<RecommendationResult> {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    include: { crops: { select: { cropName: true, status: true } } },
  });
  if (!farm) throw new NotFoundError('Farm', farmId);

  // Climate and prices are independent — fetch together.
  const [climate, prices] = await Promise.all([
    getClimateWindow(farm.latitude, farm.longitude, CLIMATE_WINDOW_DAYS).catch(() => null),
    latestPrices(),
  ]);

  // A farm with any irrigation history is treated as having irrigation
  // available, which changes how a rainfall shortfall is judged.
  const irrigationCount = await prisma.irrigationLog.count({
    where: { crop: { farmId } },
  });

  const existingCrops = new Set(
    farm.crops
      .filter((c) => c.status !== 'HARVESTED' && c.status !== 'FAILED')
      .map((c) => c.cropName.toLowerCase()),
  );

  const recommendations = recommendCrops({
    soilType: farm.soilTypePrimary,
    climate,
    prices,
    existingCrops,
    hasIrrigation: irrigationCount > 0,
  });

  // Persist the top results. Best-effort — a write failure must not deny the
  // farmer the advice they just asked for.
  void persist(farmId, recommendations).catch((err) =>
    logger.warn({ farmId, err }, 'Failed to persist recommendations'),
  );

  return {
    farm: {
      id: farm.id,
      name: farm.name,
      latitude: farm.latitude,
      longitude: farm.longitude,
      soilType: farm.soilTypePrimary,
      areaHectares: farm.totalAreaHectares,
    },
    season: currentSeason(),
    climate,
    recommendations,
    warning: climate
      ? undefined
      : 'Historical climate data is unavailable for your location right now, so these scores rely on season and soil only.',
    generatedAt: new Date().toISOString(),
  };
}

/** Most recent modal price per commodity, keyed for the scoring engine. */
async function latestPrices(): Promise<Map<string, number>> {
  const commodities = [...new Set(CROPS.map((c) => c.commodity))].filter(Boolean);

  const rows = await prisma.priceHistory.findMany({
    where: { commodity: { in: commodities } },
    orderBy: { priceDate: 'desc' },
    select: { commodity: true, modalPrice: true, priceDate: true },
    // Enough rows to cover every commodity's latest day across both markets.
    take: commodities.length * 8,
  });

  const prices = new Map<string, number>();
  for (const row of rows) {
    // findMany is ordered by date desc, so the first hit per commodity wins.
    if (!prices.has(row.commodity)) prices.set(row.commodity, row.modalPrice);
  }
  return prices;
}

async function persist(farmId: string, recommendations: CropRecommendation[]): Promise<void> {
  const season = currentSeason();

  // Replace this season's previous run rather than accumulating duplicates.
  await prisma.recommendation.deleteMany({ where: { farmId, season } });

  await prisma.recommendation.createMany({
    data: recommendations.map((r) => ({
      farmId,
      cropName: r.cropKey,
      varietyName: 'Standard',
      suitabilityScore: r.suitabilityScore,
      climateScore: r.climate.score,
      soilScore: r.soil.score,
      marketScore: r.market.score,
      waterScore: r.water.score,
      season,
      reasoning: {
        summary: r.summary,
        climate: r.climate.reason,
        soil: r.soil.reason,
        water: r.water.reason,
        market: r.market.reason,
        cautions: r.cautions,
      } as Prisma.InputJsonValue,
      expectedOutcomes: {
        attainableYieldKgHa: r.economics.attainableYieldKgHa,
        estimatedIncomePerHa: r.economics.estimatedIncomePerHa,
        growingDays: r.agronomy.growingDays,
        irrigationNeedMm: r.agronomy.irrigationNeedMm,
      } as Prisma.InputJsonValue,
    })),
  });
}

/** Previously generated recommendations, for showing how advice has changed. */
export async function getRecommendationHistory(farmId: string, userId: string) {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    select: { id: true },
  });
  if (!farm) throw new NotFoundError('Farm', farmId);

  return prisma.recommendation.findMany({
    where: { farmId },
    orderBy: [{ createdAt: 'desc' }, { suitabilityScore: 'desc' }],
    take: 30,
  });
}
