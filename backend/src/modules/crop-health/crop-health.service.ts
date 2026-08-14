/**
 * Crop health monitoring service.
 *
 * Pipeline for a new observation:
 *   1. Store the farmer's description and photo (never lose the record).
 *   2. Pull recent weather for the farm — epidemiological context.
 *   3. Analyse the photo — the local Ollama vision model, or Plant.id.
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
import { analyseCropImage } from './vision';
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
  // in it. Falls back to the stored profile language.
  const user = await prisma.user
    .findUnique({ where: { id: userId }, select: { language: true } })
    .catch(() => null);
  const language = input.language ?? user?.language ?? 'en';

  const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();

  // Weather context and image analysis are independent — run them together.
  const [weather, external] = await Promise.all([
    weatherContextForFarm(farmId, farm.latitude, farm.longitude),
    image
      ? analyseCropImage(image.base64, {
          language,
          // Regional priors: the same symptoms mean different things in
          // Punjab in January and in Kerala in July.
          latitude: farm.latitude,
          longitude: farm.longitude,
          observedAt,
          cropLabel: isKnown ? crop.label : cropRecord.cropName,
          // Naming the problems we already know for this crop keeps the model's
          // answer in our vocabulary, so an image finding corroborates a
          // curated candidate instead of arriving as a separate unranked row.
          knownProblems: isKnown
            ? [...crop.diseases.map((d) => d.name), ...crop.pests.map((p) => p.name)]
            : [],
          description: input.description,
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
      observedAt,
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

function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getOutbreakGuidance(issueName: string, cropName: string): string[] {
  const issue = issueName.toLowerCase();
  if (issue.includes('blight')) {
    return [
      'Inspect leaves daily for water-soaked spots or dark lesions.',
      'Avoid overhead watering and improve air circulation.',
      'Remove and destroy infected plant debris immediately.',
      'Consider applying preventive bio-fungicides.',
    ];
  }
  if (issue.includes('blast')) {
    return [
      'Monitor plants for spindle-shaped lesions on leaves and neck rot.',
      'Avoid excessive nitrogen fertilization.',
      'Maintain proper water levels in the field.',
      'Use certified disease-free seeds for future seasons.',
    ];
  }
  if (issue.includes('borer') || issue.includes('caterpillar') || issue.includes('worm')) {
    return [
      'Inspect stems and leaves for boring holes or larval feeding signs.',
      'Install pheromone traps to monitor adult moth populations.',
      'Use neem-based sprays or biological control agents.',
      'Remove and burn severely infested shoots.',
    ];
  }
  if (issue.includes('aphid') || issue.includes('whitefly') || issue.includes('thrip')) {
    return [
      'Check the undersides of leaves for clusters of tiny sucking insects.',
      'Use yellow sticky cards to trap flying insect vectors.',
      'Spray with neem oil or insecticidal soap.',
      'Encourage natural predators like ladybugs.',
    ];
  }
  return [
    `Inspect your ${cropName} crop daily for early signs of ${issueName}.`,
    'Isolate or remove affected plants immediately.',
    'Sanitize all farming tools after handling suspect plants.',
    'Consult local agricultural extension services for control measures.',
  ];
}

import { CreateCommunityReportInput } from './crop-health.schema';

/**
 * What we store in `HealthLog.analysisResult` for a farmer-submitted report.
 *
 * The column is Prisma `Json`, so it is `Prisma.JsonValue` on the way out —
 * meaning it could be a string, a number or null as far as the type system
 * knows. Naming the shape we actually write is what lets `readReportMeta`
 * narrow it on read without reaching for `any`.
 */
interface CommunityReportMeta {
  isCommunityReport?: boolean;
  method?: string;
  /** Free-text crop name, when the farmer's crop was not in our list. */
  customCropName?: string | null;
}

/**
 * Read `analysisResult` as our own metadata, tolerating anything else.
 *
 * Rows written by the vision pipeline hold a different shape entirely, and rows
 * from an older build may hold neither — both must read as "no metadata" rather
 * than throwing while grouping outbreaks.
 */
function readReportMeta(value: Prisma.JsonValue | null): CommunityReportMeta {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as CommunityReportMeta;
}

export async function createCommunityReport(
  farmId: string,
  userId: string,
  input: CreateCommunityReportInput,
  image: { url: string; base64: string } | null,
) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new NotFoundError('Farm', farmId);

  let cropRecord: { id: string; cropName: string; parcelId: string | null } | null = null;

  if (input.cropId) {
    // Use the specific crop they selected
    cropRecord = await prisma.crop.findFirst({
      where: { id: input.cropId, farmId },
      select: { id: true, cropName: true, parcelId: true },
    });
    if (!cropRecord) throw new NotFoundError('Crop', input.cropId);
  } else {
    // Custom crop name — anchor to first farm crop for DB integrity
    const firstCrop = await prisma.crop.findFirst({
      where: { farmId },
      select: { id: true, cropName: true, parcelId: true },
    });
    if (!firstCrop) throw new NotFoundError('Crop', 'any crop on farm');
    cropRecord = firstCrop;
  }

  // Prefer explicit custom name, else use registered crop name
  const effectiveCropName = input.customCropName?.trim() || cropRecord.cropName;
  const observedAt = input.observedAt ? new Date(input.observedAt) : new Date();

  const log = await prisma.healthLog.create({
    data: {
      farmId,
      cropId: cropRecord.id,
      parcelId: cropRecord.parcelId,
      observedAt,
      observationType: input.issueType,
      description: input.description,
      imageUrl: image?.url ?? null,
      severity: input.severity,
      diseaseDetected: input.issueType === 'DISEASE' ? input.issueName : null,
      pestDetected: input.issueType === 'PEST' ? input.issueName : null,
      status: 'ACTIVE',
      recommendedActions: getOutbreakGuidance(input.issueName, effectiveCropName),
      analysisResult: {
        isCommunityReport: true,
        method: 'manual_report',
        // Store the actual crop name so outbreak grouping uses the correct name
        customCropName: input.customCropName ?? null,
      } satisfies CommunityReportMeta as Prisma.InputJsonValue,
    },
  });

  return log;
}

export async function nearbyOutbreaks(farmId: string, userId: string, radiusKm = 5) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new NotFoundError('Farm', farmId);

  // 1. Get bounding box to narrow query
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.max(0.1, Math.cos((farm.latitude * Math.PI) / 180)));

  const nearbyFarms = await prisma.farm.findMany({
    where: {
      latitude: { gte: farm.latitude - latDelta, lte: farm.latitude + latDelta },
      longitude: { gte: farm.longitude - lonDelta, lte: farm.longitude + lonDelta },
    },
    select: { id: true, latitude: true, longitude: true },
  });

  // Calculate actual distance and filter to within exact radius
  const filteredFarms = nearbyFarms
    .map((f) => ({
      id: f.id,
      distance: getDistanceKm(farm.latitude, farm.longitude, f.latitude, f.longitude),
    }))
    .filter((f) => f.distance <= radiusKm);

  if (filteredFarms.length === 0) return { outbreaks: [], farmsInArea: 0, radiusKm };

  // 2. Fetch reports in the last 7 days from these farms
  const logs = await prisma.healthLog.findMany({
    where: {
      farmId: { in: filteredFarms.map((f) => f.id) },
      observedAt: { gte: new Date(Date.now() - 7 * 86_400_000) },
    },
    select: {
      farmId: true,
      diseaseDetected: true,
      pestDetected: true,
      severity: true,
      observedAt: true,
      analysisResult: true,
      crop: { select: { cropName: true } },
    },
  });

  // 3. Group by problem + crop, tracking unique farms
  const groups = new Map<
    string,
    {
      name: string;
      crop: string;
      farmIds: Set<string>;
      latest: Date;
      minDistance: number;
      severities: string[];
    }
  >();

  for (const log of logs) {
    const name = log.diseaseDetected ?? log.pestDetected;
    if (!name) continue;
    // Use the stored customCropName if available (community reports with typed crop name)
    const meta = readReportMeta(log.analysisResult);
    const cropName = meta?.customCropName?.trim() || log.crop.cropName;
    const key = `${name.toLowerCase()}|${cropName.toLowerCase()}`;
    const farmDist = filteredFarms.find((f) => f.id === log.farmId)?.distance ?? 0;

    const existing = groups.get(key);
    if (existing) {
      existing.farmIds.add(log.farmId);
      if (log.observedAt > existing.latest) existing.latest = log.observedAt;
      if (farmDist < existing.minDistance) existing.minDistance = farmDist;
      existing.severities.push(log.severity);
    } else {
      groups.set(key, {
        name,
        crop: cropName, // use resolved name (custom or registered)
        farmIds: new Set([log.farmId]),
        latest: log.observedAt,
        minDistance: farmDist,
        severities: [log.severity],
      });
    }
  }

  // 4. Filter only groups with 3+ unique farmers (farms)
  const outbreaks = [...groups.values()]
    .filter((g) => g.farmIds.size >= 3)
    .map((g) => {
      // Determine dominant severity
      const hasCritical = g.severities.includes('CRITICAL');
      const hasSevere = g.severities.includes('SEVERE') || g.severities.includes('HIGH');
      const severity = hasCritical ? 'CRITICAL' : hasSevere ? 'SEVERE' : 'MODERATE';

      // Round distance to nearest 0.5 km for privacy, e.g., "Within 2.5 km"
      const roundedDist = Math.max(0.5, Math.round(g.minDistance * 2) / 2);

      return {
        name: g.name,
        crop: g.crop,
        count: g.farmIds.size,
        latest: g.latest,
        approxDistanceKm: roundedDist,
        severity,
        guidance: getOutbreakGuidance(g.name, g.crop),
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    outbreaks,
    farmsInArea: filteredFarms.length,
    radiusKm,
  };
}
