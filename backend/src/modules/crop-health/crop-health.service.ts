/**
 * Crop health monitoring service.
 *
 * Pipeline for a new observation:
 *   1. Store the farmer's description and photo (never lose the record).
 *   2. Pull recent weather for the farm — epidemiological context.
 *   3. Optionally run Plant.id image analysis, if a key is configured.
 *   4. Run the rule-based differential engine over all available signals.
 *   5. Persist the diagnosis and raise an alert if it is serious.
 *
 * Every step after (1) is best-effort. A failure in weather lookup or image
 * analysis degrades the confidence of the result; it never loses the farmer's
 * observation or returns an error to them.
 */

import type { Prisma, HealthSeverity } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { logger } from '../../common/logger';
import { NotFoundError } from '../../common/errors';
import { upsertWithoutTransaction } from '../../common/upsert';
import { resolveCrop } from '../../domain/crops';
import { getWeatherForFarm } from '../weather/weather.service';
import { assessPlantHealth } from './plant-id';
import { diagnose, buildWeatherContext, type Diagnosis, type WeatherContext } from './diagnosis';
import type {
  CreateObservationInput,
  UpdateObservationInput,
  ListObservationsQuery,
} from './crop-health.schema';

// ─────────────────────── Weather context ───────────────────────

/** Recent weather for the farm, or neutral defaults if unavailable. */
async function weatherContextForFarm(
  farmId: string,
  latitude: number,
  longitude: number,
): Promise<WeatherContext> {
  try {
    const { weather } = await getWeatherForFarm(farmId, latitude, longitude);
    const recent = weather.daily.filter((d) => d.isPast).slice(-7);
    return buildWeatherContext(recent);
  } catch (err) {
    logger.warn({ farmId, err }, 'Weather unavailable for health analysis; using neutral context');
    return buildWeatherContext([]);
  }
}

// ─────────────────────── Create observation ───────────────────────

export interface ObservationResult {
  log: Awaited<ReturnType<typeof prisma.healthLog.create>>;
  diagnosis: Diagnosis;
}

export async function createObservation(
  farmId: string,
  userId: string,
  input: CreateObservationInput,
  image: { url: string; base64: string } | null,
): Promise<ObservationResult> {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new NotFoundError('Farm', farmId);

  const cropRecord = await prisma.crop.findFirst({ where: { id: input.cropId, farmId } });
  if (!cropRecord) throw new NotFoundError('Crop', input.cropId);

  const { crop, isKnown } = resolveCrop(cropRecord.cropName);

  // The language the farmer is using, so image-analysis descriptions come back
  // in it where Plant.id has them. Falls back to the stored profile language.
  const user = await prisma.user
    .findUnique({ where: { id: userId }, select: { language: true } })
    .catch(() => null);
  const language = input.language ?? user?.language ?? 'en';

  // Weather context and image analysis are independent — run them together.
  const [weather, external] = await Promise.all([
    weatherContextForFarm(farmId, farm.latitude, farm.longitude),
    image
      ? assessPlantHealth(image.base64, {
          language,
          // Regional priors: the same symptoms mean different things in
          // Punjab in January and in Kerala in July.
          latitude: farm.latitude,
          longitude: farm.longitude,
        })
      : Promise.resolve(null),
  ]);

  const diagnosis = diagnose({
    crop,
    cropIsKnown: isKnown,
    description: input.description,
    weather,
    hasImage: Boolean(image),
    external,
  });

  const top = diagnosis.candidates[0];

  const log = await prisma.healthLog.create({
    data: {
      farmId,
      cropId: input.cropId,
      parcelId: cropRecord.parcelId,
      observedAt: input.observedAt ? new Date(input.observedAt) : new Date(),
      observationType: input.observationType,
      description: input.description,
      imageUrl: image?.url ?? null,
      severity: diagnosis.severity,
      diseaseDetected: top?.kind === 'disease' ? top.name : null,
      pestDetected: top?.kind === 'pest' ? top.name : null,
      analysisResult: {
        summary: diagnosis.summary,
        confidence: diagnosis.confidence,
        method: diagnosis.method,
        limitations: diagnosis.limitations,
        weatherContext: weather,
        image: diagnosis.image,
        candidates: diagnosis.candidates.map((c) => ({
          kind: c.kind,
          name: c.name,
          confidence: c.confidence,
          severity: c.severity,
          evidence: c.evidence,
          explanation: c.explanation,
          source: c.source,
          details: c.details,
          signals: c.signals,
        })),
      } as unknown as Prisma.InputJsonValue,
      recommendedActions: diagnosis.nextSteps as unknown as Prisma.InputJsonValue,
    },
  });

  await raiseAlertIfSerious(farmId, input.cropId, diagnosis, log.id);

  logger.info(
    { logId: log.id, farmId, severity: diagnosis.severity, method: diagnosis.method },
    'Health observation analysed',
  );

  return { log, diagnosis };
}

/** Serious findings become dashboard alerts so they are not missed. */
async function raiseAlertIfSerious(
  farmId: string,
  cropId: string,
  diagnosis: Diagnosis,
  logId: string,
): Promise<void> {
  const serious: HealthSeverity[] = ['SEVERE', 'CRITICAL'];
  if (!serious.includes(diagnosis.severity)) return;

  const top = diagnosis.candidates[0];
  if (!top || top.confidence < 0.35) return;

  try {
    await upsertWithoutTransaction(prisma.alert, {
      where: { dedupeKey: `${farmId}:HEALTH:${logId}` },
      create: {
        farmId,
        cropId,
        dedupeKey: `${farmId}:HEALTH:${logId}`,
        alertType: top.kind === 'pest' ? 'PEST_DETECTED' : 'DISEASE_DETECTED',
        severity: diagnosis.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        message: diagnosis.summary,
        metadata: {
          title: `Possible ${top.name}`,
          action: diagnosis.nextSteps[0] ?? 'Inspect the crop closely.',
          source: 'crop-health-engine',
          logId,
        } as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
      update: {},
    });
  } catch (err) {
    logger.warn({ farmId, logId, err }, 'Failed to raise health alert');
  }
}

// ─────────────────────── Read / update ───────────────────────

export async function listObservations(
  farmId: string,
  userId: string,
  options: ListObservationsQuery,
) {
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, userId },
    select: { id: true },
  });
  if (!farm) throw new NotFoundError('Farm', farmId);

  return prisma.healthLog.findMany({
    where: {
      farmId,
      ...(options.cropId ? { cropId: options.cropId } : {}),
      ...(options.status ? { status: options.status } : {}),
    },
    include: { crop: { select: { id: true, cropName: true } } },
    orderBy: { observedAt: 'desc' },
    take: options.limit,
  });
}

export async function getObservation(farmId: string, logId: string, userId: string) {
  const log = await prisma.healthLog.findFirst({
    where: { id: logId, farmId, farm: { userId } },
    include: { crop: { select: { id: true, cropName: true } } },
  });
  if (!log) throw new NotFoundError('Health observation', logId);
  return log;
}

export async function updateObservation(
  farmId: string,
  logId: string,
  userId: string,
  input: UpdateObservationInput,
) {
  await getObservation(farmId, logId, userId);

  const log = await prisma.healthLog.update({ where: { id: logId }, data: input });

  // Resolving an issue clears its alert.
  if (input.status === 'RESOLVED' || input.status === 'TREATED') {
    await prisma.alert
      .updateMany({
        where: { farmId, dedupeKey: `${farmId}:HEALTH:${logId}` },
        data: { isDismissed: true },
      })
      .catch(() => undefined);
  }

  logger.info({ logId, status: input.status }, 'Health observation updated');
  return log;
}

export async function deleteObservation(farmId: string, logId: string, userId: string) {
  await getObservation(farmId, logId, userId);
  await prisma.healthLog.delete({ where: { id: logId } });
  logger.info({ logId }, 'Health observation deleted');
}

// ─────────────────────── Community outbreak signal ───────────────────────

/**
 * Nearby farms reporting the same problem in the last 21 days.
 *
 * Uses a simple bounding box rather than a geospatial query — MongoDB could do
 * a $geoNear, but Prisma does not expose it, and at this scale a box filter
 * over the farmer's own region is accurate enough to be useful.
 */
export async function nearbyOutbreaks(farmId: string, userId: string, radiusKm = 50) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new NotFoundError('Farm', farmId);

  // ~111 km per degree of latitude; longitude degrees shrink toward the poles.
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(0.1, Math.cos((farm.latitude * Math.PI) / 180)));

  const nearbyFarms = await prisma.farm.findMany({
    where: {
      id: { not: farmId },
      latitude: { gte: farm.latitude - latDelta, lte: farm.latitude + latDelta },
      longitude: { gte: farm.longitude - lonDelta, lte: farm.longitude + lonDelta },
    },
    select: { id: true, latitude: true, longitude: true },
  });

  if (nearbyFarms.length === 0) return { reports: [], farmsInArea: 0, radiusKm };

  const logs = await prisma.healthLog.findMany({
    where: {
      farmId: { in: nearbyFarms.map((f) => f.id) },
      observedAt: { gte: new Date(Date.now() - 21 * 86_400_000) },
      severity: { in: ['SEVERE', 'CRITICAL'] },
    },
    select: {
      diseaseDetected: true,
      pestDetected: true,
      severity: true,
      observedAt: true,
      crop: { select: { cropName: true } },
    },
    orderBy: { observedAt: 'desc' },
  });

  // Aggregate by problem name so the farmer sees "5 nearby reports of blast",
  // not five separate rows. Individual farms stay anonymous.
  const counts = new Map<string, { name: string; crop: string; count: number; latest: Date }>();
  for (const log of logs) {
    const name = log.diseaseDetected ?? log.pestDetected;
    if (!name) continue;
    const key = `${name}|${log.crop.cropName}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      if (log.observedAt > existing.latest) existing.latest = log.observedAt;
    } else {
      counts.set(key, { name, crop: log.crop.cropName, count: 1, latest: log.observedAt });
    }
  }

  return {
    reports: [...counts.values()].sort((a, b) => b.count - a.count),
    farmsInArea: nearbyFarms.length,
    radiusKm,
  };
}
