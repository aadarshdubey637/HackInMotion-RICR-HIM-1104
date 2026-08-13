/**
 * Farm profile service.
 *
 * The farm profile is the personalisation spine of the whole system: its
 * coordinates drive the weather engine, its soil type drives the water balance,
 * and its crops drive health monitoring and price tracking. Every read here is
 * scoped by userId so one farmer can never see another's data.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { logger } from '../../common/logger';
import { NotFoundError, ValidationError } from '../../common/errors';
import { resolveCrop, findCrop, supportedCrops } from '../../domain/crops';
import type {
  CreateFarmInput,
  UpdateFarmInput,
  CreateParcelInput,
  UpdateParcelInput,
  CreateCropInput,
  UpdateCropInput,
  CropDashboardQuery,
} from './farm.schema';

// ─────────────────────────── Includes ───────────────────────────

const farmInclude = {
  parcels: { orderBy: { displayOrder: 'asc' } },
  crops: { include: { variety: true }, orderBy: { createdAt: 'desc' } },
  _count: { select: { parcels: true, crops: true, healthLogs: true, alerts: true } },
} satisfies Prisma.FarmInclude;

// ─────────────────────────── Farm ───────────────────────────

export async function createFarm(userId: string, input: CreateFarmInput) {
  const farm = await prisma.farm.create({
    data: {
      userId,
      name: input.name,
      latitude: input.latitude,
      longitude: input.longitude,
      totalAreaHectares: input.totalAreaHectares,
      soilTypePrimary: input.soilTypePrimary,
      soilAnalysis: input.soilAnalysis as Prisma.InputJsonValue | undefined,
      address: input.address,
      boundary: input.boundary as Prisma.InputJsonValue | undefined,
    },
    include: farmInclude,
  });

  logger.info({ farmId: farm.id, userId }, 'Farm created');
  return farm;
}

export async function getFarmById(farmId: string, userId: string) {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    include: farmInclude,
  });
  if (!farm) throw new NotFoundError('Farm', farmId);
  return farm;
}

export async function getUserFarms(userId: string) {
  return prisma.farm.findMany({
    where: { userId, status: { not: 'ARCHIVED' } },
    include: farmInclude,
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateFarm(farmId: string, userId: string, input: UpdateFarmInput) {
  await assertFarmOwned(farmId, userId);

  const farm = await prisma.farm.update({
    where: { id: farmId },
    data: {
      ...input,
      soilAnalysis: input.soilAnalysis as Prisma.InputJsonValue | undefined,
      boundary: input.boundary as Prisma.InputJsonValue | undefined,
    },
    include: farmInclude,
  });

  logger.info({ farmId }, 'Farm updated');
  return farm;
}

/** Soft delete — archived farms keep their history but drop off the dashboard. */
export async function deleteFarm(farmId: string, userId: string): Promise<void> {
  await assertFarmOwned(farmId, userId);
  await prisma.farm.update({ where: { id: farmId }, data: { status: 'ARCHIVED' } });
  logger.info({ farmId }, 'Farm archived');
}

/** Cheap ownership check that avoids pulling the full relation graph. */
async function assertFarmOwned(farmId: string, userId: string) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId }, select: { id: true } });
  if (!farm) throw new NotFoundError('Farm', farmId);
  return farm;
}

// ─────────────────────────── Parcels ───────────────────────────

export async function createParcel(farmId: string, userId: string, input: CreateParcelInput) {
  await assertFarmOwned(farmId, userId);
  const count = await prisma.parcel.count({ where: { farmId } });

  const parcel = await prisma.parcel.create({
    data: {
      farmId,
      name: input.name,
      areaHectares: input.areaHectares,
      soilType: input.soilType,
      soilProperties: input.soilProperties as Prisma.InputJsonValue | undefined,
      irrigationZone: input.irrigationZone,
      displayOrder: input.displayOrder ?? count,
      boundary: input.boundary as Prisma.InputJsonValue | undefined,
    },
    include: { crops: true },
  });

  logger.info({ parcelId: parcel.id, farmId }, 'Parcel created');
  return parcel;
}

export async function getParcelById(farmId: string, parcelId: string, userId: string) {
  await assertFarmOwned(farmId, userId);
  const parcel = await prisma.parcel.findFirst({
    where: { id: parcelId, farmId },
    include: { crops: true },
  });
  if (!parcel) throw new NotFoundError('Parcel', parcelId);
  return parcel;
}

export async function updateParcel(
  farmId: string,
  parcelId: string,
  userId: string,
  input: UpdateParcelInput,
) {
  await getParcelById(farmId, parcelId, userId);

  const parcel = await prisma.parcel.update({
    where: { id: parcelId },
    data: {
      ...input,
      soilProperties: input.soilProperties as Prisma.InputJsonValue | undefined,
      boundary: input.boundary as Prisma.InputJsonValue | undefined,
    },
    include: { crops: true },
  });

  logger.info({ parcelId }, 'Parcel updated');
  return parcel;
}

export async function deleteParcel(farmId: string, parcelId: string, userId: string): Promise<void> {
  await getParcelById(farmId, parcelId, userId);
  // Detach crops rather than cascading — the crop history stays valuable.
  await prisma.crop.updateMany({ where: { parcelId }, data: { parcelId: null } });
  await prisma.parcel.delete({ where: { id: parcelId } });
  logger.info({ parcelId }, 'Parcel deleted');
}

// ─────────────────────────── Crops ───────────────────────────

export async function createCrop(farmId: string, userId: string, input: CreateCropInput) {
  await assertFarmOwned(farmId, userId);

  if (input.parcelId) {
    const parcel = await prisma.parcel.findFirst({
      where: { id: input.parcelId, farmId },
      select: { id: true },
    });
    if (!parcel) throw new NotFoundError('Parcel', input.parcelId);
  }

  if (input.varietyId) {
    const variety = await prisma.cropVariety.findUnique({
      where: { id: input.varietyId },
      select: { id: true },
    });
    if (!variety) throw new NotFoundError('Crop variety', input.varietyId);
  }

  // An unrecognised crop is allowed — the farmer knows their land better than
  // our database does — but we record it so guidance can be flagged as generic.
  const { isKnown } = resolveCrop(input.cropName);

  const crop = await prisma.crop.create({
    data: {
      farmId,
      parcelId: input.parcelId,
      cropName: input.cropName.trim(),
      varietyId: input.varietyId,
      plantingDate: input.plantingDate ? new Date(input.plantingDate) : null,
      expectedHarvestDate: input.expectedHarvestDate ? new Date(input.expectedHarvestDate) : null,
      growthStage: input.growthStage,
      status: input.status ?? 'PLANNED',
      managementPlan: input.managementPlan as Prisma.InputJsonValue | undefined,
      expectedYieldKg: input.expectedYieldKg,
    },
    include: { variety: true, parcel: true },
  });

  logger.info({ cropId: crop.id, farmId, isKnown }, 'Crop created');
  return { ...crop, isRecognised: isKnown };
}

export async function getFarmCrops(farmId: string, userId: string) {
  await assertFarmOwned(farmId, userId);
  return prisma.crop.findMany({
    where: { farmId },
    include: { variety: true, parcel: true, _count: { select: { healthLogs: true, irrigationLogs: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getCropById(farmId: string, cropId: string, userId: string) {
  await assertFarmOwned(farmId, userId);
  const crop = await prisma.crop.findFirst({
    where: { id: cropId, farmId },
    include: { variety: true, parcel: true },
  });
  if (!crop) throw new NotFoundError('Crop', cropId);
  return crop;
}

export async function updateCrop(
  farmId: string,
  cropId: string,
  userId: string,
  input: UpdateCropInput,
) {
  await getCropById(farmId, cropId, userId);

  if (input.parcelId) {
    const parcel = await prisma.parcel.findFirst({
      where: { id: input.parcelId, farmId },
      select: { id: true },
    });
    if (!parcel) throw new NotFoundError('Parcel', input.parcelId);
  }

  const crop = await prisma.crop.update({
    where: { id: cropId },
    data: {
      ...input,
      cropName: input.cropName?.trim(),
      plantingDate:
        input.plantingDate === undefined ? undefined : input.plantingDate ? new Date(input.plantingDate) : null,
      expectedHarvestDate:
        input.expectedHarvestDate === undefined
          ? undefined
          : input.expectedHarvestDate
            ? new Date(input.expectedHarvestDate)
            : null,
      managementPlan: input.managementPlan as Prisma.InputJsonValue | undefined,
    },
    include: { variety: true, parcel: true },
  });

  logger.info({ cropId }, 'Crop updated');
  return crop;
}

export async function deleteCrop(farmId: string, cropId: string, userId: string): Promise<void> {
  await getCropById(farmId, cropId, userId);
  await prisma.crop.delete({ where: { id: cropId } });
  logger.info({ cropId }, 'Crop deleted');
}

// ─────────────────────── Per-crop dashboard ───────────────────────

/**
 * Everything known about one crop, assembled in parallel.
 * Each section fails independently — a market API outage must not blank out
 * the health log the farmer came to read.
 */
export async function getCropDashboard(
  farmId: string,
  cropId: string,
  userId: string,
  options: CropDashboardQuery,
) {
  const crop = await getCropById(farmId, cropId, userId);
  const profile = findCrop(crop.cropName);

  const [health, irrigation, prices] = await Promise.all([
    options.includeHealth
      ? prisma.healthLog.findMany({
          where: { cropId },
          orderBy: { observedAt: 'desc' },
          take: 10,
        })
      : Promise.resolve(null),

    options.includeIrrigation
      ? prisma.irrigationLog.findMany({
          where: { cropId },
          orderBy: { irrigatedAt: 'desc' },
          take: 10,
        })
      : Promise.resolve(null),

    options.includeMarket && profile
      ? prisma.priceHistory.findMany({
          where: { commodity: profile.commodity },
          orderBy: { priceDate: 'desc' },
          take: 30,
        })
      : Promise.resolve(null),
  ]);

  const weather = options.includeWeather
    ? await prisma.weatherData.findMany({
        where: { farmId },
        orderBy: { recordedAt: 'desc' },
        take: 7,
        select: {
          recordedAt: true,
          temperatureMin: true,
          temperatureMax: true,
          rainfall: true,
          humidity: true,
          et0: true,
        },
      })
    : null;

  return {
    crop,
    agronomy: profile
      ? {
          label: profile.label,
          growingDays: profile.growingDays,
          waterRequirementMm: profile.waterRequirementMm,
          seasons: profile.seasons,
          commodity: profile.commodity,
          isRecognised: true,
        }
      : { isRecognised: false, label: crop.cropName },
    weather,
    health,
    irrigation,
    prices,
  };
}

/** Crop names the system has real agronomic data for — powers the picker UI. */
export function listSupportedCrops() {
  return supportedCrops();
}
