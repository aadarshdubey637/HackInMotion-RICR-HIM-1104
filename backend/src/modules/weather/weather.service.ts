/**
 * Weather & irrigation service.
 *
 * Orchestrates: fetch weather (Open-Meteo) → run the FAO-56 water balance
 * (irrigation.ts) → persist observations and alerts → return farmer-facing
 * guidance.
 *
 * Caching: weather rows are written per farm/day and reused for an hour, so a
 * farmer refreshing the dashboard does not re-hit the provider. On a provider
 * failure the service degrades to the most recent stored data rather than
 * erroring — a farmer must never see a blank dashboard.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../common/prisma';
import { logger } from '../../common/logger';
import { NotFoundError, ExternalServiceError } from '../../common/errors';
import { upsertWithoutTransaction } from '../../common/upsert';
import { resolveCrop } from '../../domain/crops';
import { fetchWeather, type WeatherBundle } from './openmeteo';
import {
  generateIrrigationGuidance,
  type IrrigationGuidance,
  type RiskAlert,
} from './irrigation';
import type { LogIrrigationInput } from './weather.schema';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─────────────────────────── Farm access ───────────────────────────

/** Load a farm, enforcing that it belongs to the requesting user. */
async function requireFarm(farmId: string, userId: string) {
  const farm = await prisma.farm.findFirst({ where: { id: farmId, userId } });
  if (!farm) throw new NotFoundError('Farm', farmId);
  return farm;
}

// ─────────────────────────── Weather fetch ───────────────────────────

/**
 * Get weather for a farm, preferring a recent cached fetch.
 * Falls back to stored history if the provider is unreachable.
 */
export async function getWeatherForFarm(
  farmId: string,
  latitude: number,
  longitude: number,
  { force = false }: { force?: boolean } = {},
): Promise<{ weather: WeatherBundle; stale: boolean; warning?: string }> {
  if (!force) {
    const fresh = await prisma.weatherData.findFirst({
      where: { farmId, createdAt: { gte: new Date(Date.now() - CACHE_TTL_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (fresh?.rawData) {
      const cached = reviveBundle(fresh.rawData);
      if (cached) {
        logger.debug({ farmId }, 'Serving cached weather bundle');
        return { weather: cached, stale: false };
      }
    }
  }

  try {
    const weather = await fetchWeather(latitude, longitude);
    await persistWeather(farmId, weather);
    return { weather, stale: false };
  } catch (err) {
    logger.warn({ farmId, err }, 'Weather provider failed; attempting stored fallback');

    // Only the first row of each fetch carries the full bundle, so scan back
    // through recent rows for one that has it.
    const recent = await prisma.weatherData.findMany({
      where: { farmId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const lastKnown = recent.find((row) => row.rawData != null);
    const revived = lastKnown?.rawData ? reviveBundle(lastKnown.rawData) : null;

    if (revived && lastKnown) {
      const ageHours = Math.round((Date.now() - lastKnown.createdAt.getTime()) / 3_600_000);
      return {
        weather: revived,
        stale: true,
        warning:
          `Live weather is unavailable right now. Showing data from ${ageHours} hour${ageHours === 1 ? '' : 's'} ago — ` +
          `treat the guidance as approximate.`,
      };
    }

    throw err instanceof ExternalServiceError
      ? err
      : new ExternalServiceError('Open-Meteo', 'Weather unavailable and no stored data for this farm');
  }
}

/**
 * Store one row per forecast day plus the full provider payload, so a later
 * request can rebuild the bundle without another API call.
 */
async function persistWeather(farmId: string, weather: WeatherBundle): Promise<void> {
  const serialised = JSON.stringify(weather) as unknown as Prisma.InputJsonValue;

  // MongoDB has no createMany+skipDuplicates, so upsert each day on the
  // (farmId, recordedAt) unique key. 14 days — cheap enough to do serially.
  for (const [i, day] of weather.daily.entries()) {
    const recordedAt = new Date(`${day.date}T00:00:00.000Z`);

    const row = {
      temperatureMin: day.tempMinC,
      temperatureMax: day.tempMaxC,
      temperatureAvg: day.tempAvgC,
      humidity: day.humidityMeanPct,
      rainfall: day.precipitationMm,
      windSpeed: day.windSpeedMaxKmh,
      solarRadiation: day.solarRadiationMjM2,
      soilMoisture: weather.soilMoistureSurface,
      et0: day.et0Mm,
      // Attach the full bundle to the first row only; the rest stay small.
      rawData: i === 0 ? serialised : undefined,
    };

    try {
      await upsertWithoutTransaction(prisma.weatherData, {
        where: { farmId, recordedAt },
        create: { farmId, recordedAt, ...row },
        update: row,
      });
    } catch (err) {
      // A failed cache write must never break the request.
      logger.warn({ farmId, date: day.date, err }, 'Failed to persist weather row');
    }
  }
}

/** Rebuild a WeatherBundle from a stored JSON payload, tolerating bad data. */
function reviveBundle(raw: Prisma.JsonValue): WeatherBundle | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    const bundle = parsed as WeatherBundle;
    if (!Array.isArray(bundle.daily) || bundle.daily.length === 0) return null;
    bundle.fetchedAt = new Date(bundle.fetchedAt);
    return bundle;
  } catch {
    return null;
  }
}

// ─────────────────────────── Public API ───────────────────────────

export interface ForecastResult {
  location: { latitude: number; longitude: number; timezone: string; address: string | null };
  current: WeatherBundle['current'];
  daily: WeatherBundle['daily'];
  stale: boolean;
  warning?: string;
  provider: string;
  fetchedAt: Date;
}

export async function getWeatherForecast(
  farmId: string,
  userId: string,
  options: { days?: number; force?: boolean } = {},
): Promise<ForecastResult> {
  const farm = await requireFarm(farmId, userId);
  const { weather, stale, warning } = await getWeatherForFarm(
    farmId,
    farm.latitude,
    farm.longitude,
    { force: options.force },
  );

  const days = options.days ?? 7;
  const upcoming = weather.daily.filter((d) => !d.isPast).slice(0, days);

  return {
    location: {
      latitude: weather.latitude,
      longitude: weather.longitude,
      timezone: weather.timezone,
      address: farm.address,
    },
    current: weather.current,
    daily: upcoming,
    stale,
    warning,
    provider: weather.provider,
    fetchedAt: weather.fetchedAt,
  };
}

export interface IrrigationResult extends IrrigationGuidance {
  crop: { id: string | null; name: string; label: string; isKnown: boolean };
  stale: boolean;
  warning?: string;
  generatedAt: Date;
}

/**
 * Irrigation guidance for one crop, or for the farm's primary active crop
 * when no crop is specified.
 */
export async function getIrrigationGuidance(
  farmId: string,
  userId: string,
  options: { cropId?: string } = {},
): Promise<IrrigationResult> {
  const farm = await requireFarm(farmId, userId);

  const cropRecord = options.cropId
    ? await prisma.crop.findFirst({ where: { id: options.cropId, farmId } })
    : await prisma.crop.findFirst({
        where: { farmId, status: { in: ['PLANTED', 'GROWING', 'FLOWERING', 'FRUITING'] } },
        orderBy: { plantingDate: 'desc' },
      });

  if (options.cropId && !cropRecord) throw new NotFoundError('Crop', options.cropId);

  const { crop, isKnown } = resolveCrop(cropRecord?.cropName);
  const { weather, stale, warning } = await getWeatherForFarm(farmId, farm.latitude, farm.longitude);

  // Most recent logged irrigation feeds back into the water balance.
  const lastIrrigation = cropRecord
    ? await prisma.irrigationLog.findFirst({
        where: { cropId: cropRecord.id },
        orderBy: { irrigatedAt: 'desc' },
      })
    : null;

  const guidance = generateIrrigationGuidance({
    weather,
    crop,
    cropIsKnown: isKnown,
    soilType: farm.soilTypePrimary,
    growthStage: cropRecord?.growthStage ?? null,
    plantingDate: cropRecord?.plantingDate ?? null,
    areaHectares: farm.totalAreaHectares,
    lastIrrigatedAt: lastIrrigation?.irrigatedAt ?? null,
    lastIrrigationMm: lastIrrigation?.waterAmountMm ?? null,
  });

  // Persist the risks so they show on the dashboard and in the alert feed.
  await persistAlerts(farmId, cropRecord?.id ?? null, guidance.alerts);

  return {
    ...guidance,
    crop: {
      id: cropRecord?.id ?? null,
      name: cropRecord?.cropName ?? crop.label,
      label: crop.label,
      isKnown,
    },
    stale,
    warning,
    generatedAt: new Date(),
  };
}

/**
 * Write generated risks to the alert feed, deduplicated per farm/type/day so
 * repeated dashboard refreshes do not pile up identical alerts.
 */
async function persistAlerts(
  farmId: string,
  cropId: string | null,
  alerts: RiskAlert[],
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  for (const alert of alerts) {
    const dedupeKey = `${farmId}:${alert.type}:${alert.date ?? today}`;
    const payload = {
      farmId,
      cropId,
      alertType: alert.type,
      severity: alert.severity,
      message: alert.message,
      metadata: {
        title: alert.title,
        action: alert.action,
        source: 'irrigation-engine',
      } as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + 3 * 86_400_000),
    };

    try {
      await upsertWithoutTransaction(prisma.alert, {
        where: { dedupeKey },
        create: { ...payload, dedupeKey },
        // Refresh content but preserve the farmer's read/dismissed state.
        update: { severity: payload.severity, message: payload.message, metadata: payload.metadata },
      });
    } catch (err) {
      logger.warn({ farmId, dedupeKey, err }, 'Failed to persist alert');
    }
  }
}

// ─────────────────────────── Alerts ───────────────────────────

export async function getWeatherAlerts(
  farmId: string,
  userId: string,
  options: { severity?: string; unreadOnly?: boolean } = {},
) {
  await requireFarm(farmId, userId);

  const where: Prisma.AlertWhereInput = {
    farmId,
    isDismissed: false,
    OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
  };
  if (options.severity) where.severity = options.severity as Prisma.AlertWhereInput['severity'];
  if (options.unreadOnly) where.isRead = false;

  return prisma.alert.findMany({ where, orderBy: { createdAt: 'desc' } });
}

export async function markAlertRead(alertId: string, userId: string): Promise<void> {
  const alert = await prisma.alert.findFirst({ where: { id: alertId, farm: { userId } } });
  if (!alert) throw new NotFoundError('Alert', alertId);
  await prisma.alert.update({ where: { id: alertId }, data: { isRead: true } });
}

export async function dismissAlert(alertId: string, userId: string): Promise<void> {
  const alert = await prisma.alert.findFirst({ where: { id: alertId, farm: { userId } } });
  if (!alert) throw new NotFoundError('Alert', alertId);
  await prisma.alert.update({ where: { id: alertId }, data: { isDismissed: true, isRead: true } });
}

// ─────────────────────────── Irrigation log ───────────────────────────

export async function logIrrigation(farmId: string, userId: string, input: LogIrrigationInput) {
  await requireFarm(farmId, userId);

  const crop = await prisma.crop.findFirst({ where: { id: input.cropId, farmId } });
  if (!crop) throw new NotFoundError('Crop', input.cropId);

  const log = await prisma.irrigationLog.create({
    data: {
      cropId: input.cropId,
      parcelId: crop.parcelId,
      irrigatedAt: input.irrigatedAt ? new Date(input.irrigatedAt) : new Date(),
      waterAmountMm: input.waterAmountMm,
      irrigationMethod: input.irrigationMethod,
      guidanceSource: input.guidanceSource ?? 'manual',
      wasRecommended: input.wasRecommended ?? false,
    },
  });

  // Recording irrigation resolves any outstanding "irrigate now" alert.
  await prisma.alert
    .updateMany({
      where: { farmId, alertType: 'IRRIGATION_NEEDED', isDismissed: false },
      data: { isDismissed: true },
    })
    .catch(() => undefined);

  logger.info({ logId: log.id, farmId, cropId: input.cropId }, 'Irrigation logged');
  return log;
}

export async function getIrrigationHistory(farmId: string, userId: string, cropId?: string) {
  await requireFarm(farmId, userId);

  const crops = await prisma.crop.findMany({ where: { farmId }, select: { id: true } });
  const cropIds = crops.map((c) => c.id);

  return prisma.irrigationLog.findMany({
    where: { cropId: cropId ? cropId : { in: cropIds } },
    orderBy: { irrigatedAt: 'desc' },
    take: 50,
  });
}
