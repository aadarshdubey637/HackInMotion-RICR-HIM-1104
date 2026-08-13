/**
 * Irrigation guidance engine — FAO-56 soil water balance.
 *
 * This is the core technical component of the system. Rather than reacting to
 * "did it rain today", it maintains a running water budget for the root zone:
 *
 *     depletion(t) = depletion(t-1) + ETc(t) - Pe(t) - irrigation(t)
 *
 * where
 *     ETc = ET0 x Kc          crop water use (provider ET0, crop coefficient)
 *     Pe                      effective rainfall (what actually reaches the roots)
 *
 * Irrigation is advised when depletion reaches the crop's Readily Available
 * Water (RAW) — the point at which the plant starts working to extract water
 * and yield begins to suffer. This is the standard agronomic trigger, and it
 * is why the engine can say "don't irrigate, rain on Thursday will cover you"
 * instead of just reporting a forecast.
 *
 * Reference: Allen, Pereira, Raes & Smith (1998), FAO Irrigation & Drainage
 * Paper 56, chapters 6-8.
 */

import type { GrowthStage, SoilType } from '@prisma/client';
import type { CropProfile } from '../../domain/crops';
import { SOIL_AVAILABLE_WATER_MM_PER_M } from '../../domain/crops';
import type { DailyWeather, WeatherBundle } from './openmeteo';

// ─────────────────────────── Types ───────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type Urgency = 'NONE' | 'PLAN' | 'SOON' | 'TODAY' | 'OVERDUE';

export interface RiskAlert {
  type:
    | 'HEAT_STRESS'
    | 'FROST_WARNING'
    | 'FLOOD_RISK'
    | 'DROUGHT_RISK'
    | 'WEATHER_RISK'
    | 'IRRIGATION_NEEDED';
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  /** Plain-language explanation aimed at a farmer, not an agronomist. */
  message: string;
  /** What to actually do about it. */
  action: string;
  /** ISO date the risk applies to, if it is a specific day. */
  date?: string;
}

export interface DayProjection {
  date: string;
  isPast: boolean;
  /** Crop water use, mm. */
  etcMm: number;
  /** Rainfall that reaches the root zone, mm. */
  effectiveRainMm: number;
  rawRainMm: number;
  rainProbability: number | null;
  /** Root-zone depletion at end of day, mm. 0 = field capacity. */
  depletionMm: number;
  /** Depletion as a share of readily available water. >1 means stressed. */
  stressRatio: number;
  tempMaxC: number;
  tempMinC: number;
  description: string;
}

export interface IrrigationGuidance {
  /** The headline answer: should the farmer irrigate today? */
  shouldIrrigate: boolean;
  urgency: Urgency;
  /** One sentence a farmer can act on without reading anything else. */
  headline: string;
  /** The reasoning, in plain language. */
  reason: string;
  /** How much to apply, if irrigating. */
  recommendation: {
    depthMm: number;
    /** Total water for the whole planted area, in litres. */
    totalLitres: number;
    /** Same volume in m³, which is how pump capacity is usually quoted. */
    totalCubicMetres: number;
  } | null;
  /** When irrigation will next be needed, if not today. */
  nextIrrigationDate: string | null;
  daysUntilIrrigation: number | null;
  /** Confidence 0-1, reduced when inputs are assumed rather than measured. */
  confidence: number;
  riskLevel: RiskLevel;

  waterBalance: {
    /** Total available water in the root zone, mm. */
    totalAvailableWaterMm: number;
    /** Readily available water — the irrigation trigger point, mm. */
    readilyAvailableWaterMm: number;
    /** Current root-zone depletion, mm. */
    currentDepletionMm: number;
    /** Fraction of RAW used up. */
    depletionPercent: number;
    rootDepthM: number;
    /** Crop coefficient in use for the current growth stage. */
    cropCoefficient: number;
    soilType: SoilType;
    /** Whether the starting point came from modelled soil moisture or an assumption. */
    initialisedFrom: 'soil-moisture-model' | 'assumed-midpoint';
  };

  forecast: DayProjection[];
  alerts: RiskAlert[];

  /** Surfaced so the UI can be honest about data quality. */
  assumptions: string[];
}

export interface IrrigationInputs {
  weather: WeatherBundle;
  crop: CropProfile;
  /** Whether the crop was found in the knowledge base or is the generic fallback. */
  cropIsKnown: boolean;
  soilType: SoilType | null;
  growthStage: GrowthStage | null;
  plantingDate: Date | null;
  /** Area under this crop, hectares. Drives the volume calculation. */
  areaHectares: number;
  /** Most recent irrigation, used to sanity-check the balance. */
  lastIrrigatedAt: Date | null;
  lastIrrigationMm: number | null;
}

// ─────────────────────── Water balance helpers ───────────────────────

/**
 * Effective rainfall: the share of rain that actually enters the root zone.
 * Light showers evaporate off the canopy; heavy downpours run off or drain
 * below the roots. Based on the USDA-SCS approach, simplified to a daily step.
 */
export function effectiveRainfall(rainMm: number): number {
  if (rainMm < 2.5) return 0; // intercepted by canopy and evaporated
  if (rainMm <= 25) return round1(rainMm * 0.85);
  // Beyond ~25 mm/day, infiltration cannot keep up on most soils.
  return round1(25 * 0.85 + (rainMm - 25) * 0.45);
}

/**
 * Crop coefficient for the current stage. Falls back to estimating the stage
 * from days-since-planting when the farmer has not recorded one.
 */
export function cropCoefficient(
  crop: CropProfile,
  stage: GrowthStage | null,
  plantingDate: Date | null,
): { kc: number; stage: GrowthStage; inferred: boolean } {
  if (stage) return { kc: crop.kc[stage], stage, inferred: false };

  const inferredStage = inferGrowthStage(crop, plantingDate);
  return { kc: crop.kc[inferredStage], stage: inferredStage, inferred: true };
}

/** Estimate growth stage from elapsed fraction of the growing season. */
export function inferGrowthStage(crop: CropProfile, plantingDate: Date | null): GrowthStage {
  if (!plantingDate) return 'VEGETATIVE'; // safest mid-range assumption

  const days = Math.max(0, (Date.now() - plantingDate.getTime()) / 86_400_000);
  const f = days / crop.growingDays;

  if (f < 0.08) return 'GERMINATION';
  if (f < 0.35) return 'VEGETATIVE';
  if (f < 0.55) return 'FLOWERING';
  if (f < 0.75) return 'FRUIT_SET';
  if (f < 0.92) return 'RIPENING';
  return 'HARVEST_READY';
}

/**
 * Effective rooting depth grows with the crop. Using the full mature depth for
 * a seedling would badly overestimate how much water the soil can supply it.
 */
function effectiveRootDepth(crop: CropProfile, stage: GrowthStage): number {
  const fraction: Record<GrowthStage, number> = {
    SEED: 0.2,
    GERMINATION: 0.25,
    VEGETATIVE: 0.6,
    FLOWERING: 0.9,
    FRUIT_SET: 1.0,
    RIPENING: 1.0,
    HARVEST_READY: 1.0,
  };
  return round2(crop.rootDepthM * fraction[stage]);
}

/**
 * Convert modelled volumetric soil moisture (m³/m³) into a starting depletion.
 * Open-Meteo reports absolute volumetric water content; we position it between
 * assumed wilting point and field capacity for the soil type.
 */
function depletionFromSoilMoisture(
  volumetric: number,
  soilType: SoilType,
  totalAvailableWaterMm: number,
): number {
  // Approximate wilting point / field capacity by texture, m³/m³.
  const bands: Record<SoilType, { wp: number; fc: number }> = {
    SANDY: { wp: 0.06, fc: 0.16 },
    LOAMY: { wp: 0.12, fc: 0.28 },
    CLAY: { wp: 0.2, fc: 0.4 },
    SILTY: { wp: 0.13, fc: 0.31 },
    PEATY: { wp: 0.2, fc: 0.45 },
    CHALKY: { wp: 0.08, fc: 0.2 },
    MIXED: { wp: 0.12, fc: 0.28 },
  };
  const { wp, fc } = bands[soilType];

  // Fraction of available water currently present, clamped to [0,1].
  const available = clamp((volumetric - wp) / (fc - wp), 0, 1);
  return round1(totalAvailableWaterMm * (1 - available));
}

// ─────────────────────────── Engine ───────────────────────────

export function generateIrrigationGuidance(input: IrrigationInputs): IrrigationGuidance {
  const { weather, crop, soilType, areaHectares } = input;
  const assumptions: string[] = [];

  // — Soil —
  const soil = soilType ?? 'LOAMY';
  if (!soilType) {
    assumptions.push('Soil type not recorded — assuming loamy soil, the most common case.');
  }

  // — Crop stage and coefficient —
  const { kc, stage, inferred } = cropCoefficient(crop, input.growthStage, input.plantingDate);
  if (inferred) {
    assumptions.push(
      input.plantingDate
        ? `Growth stage estimated as ${humaniseStage(stage)} from the planting date.`
        : 'Neither growth stage nor planting date recorded — assuming mid-season water use.',
    );
  }
  if (!input.cropIsKnown) {
    assumptions.push(
      'This crop is not in our agronomy database — using general-purpose water requirements. Guidance is approximate.',
    );
  }

  // — Soil water capacity —
  const rootDepthM = effectiveRootDepth(crop, stage);
  const taw = round1(SOIL_AVAILABLE_WATER_MM_PER_M[soil] * rootDepthM);
  const raw = round1(taw * crop.depletionFraction);

  // — Starting depletion —
  let depletion: number;
  let initialisedFrom: 'soil-moisture-model' | 'assumed-midpoint';
  if (weather.soilMoistureSurface !== null) {
    depletion = depletionFromSoilMoisture(weather.soilMoistureSurface, soil, taw);
    initialisedFrom = 'soil-moisture-model';
  } else {
    depletion = round1(raw * 0.5);
    initialisedFrom = 'assumed-midpoint';
    assumptions.push('Soil moisture unavailable for this location — starting the balance at half-depleted.');
  }

  // The balance is seeded at the start of the historical window, then rolled
  // forward through observed weather so it converges on reality by today.
  const pastDays = weather.daily.filter((d) => d.isPast);
  const futureDays = weather.daily.filter((d) => !d.isPast);

  const projections: DayProjection[] = [];

  const step = (day: DailyWeather): DayProjection => {
    const etc = round1(day.et0Mm * kc);
    const pe = effectiveRainfall(day.precipitationMm);

    depletion = clamp(depletion + etc - pe, 0, taw);

    return {
      date: day.date,
      isPast: day.isPast,
      etcMm: etc,
      effectiveRainMm: pe,
      rawRainMm: round1(day.precipitationMm),
      rainProbability: day.precipitationProbability,
      depletionMm: round1(depletion),
      stressRatio: round2(depletion / raw),
      tempMaxC: day.tempMaxC,
      tempMinC: day.tempMinC,
      description: day.description,
    };
  };

  // Replay history to settle the balance.
  for (const day of pastDays) {
    const p = step(day);
    // Credit any irrigation the farmer logged on that day.
    if (input.lastIrrigatedAt && input.lastIrrigationMm) {
      const irrigatedOn = toDateString(input.lastIrrigatedAt, weather.timezone);
      if (irrigatedOn === day.date) {
        depletion = clamp(depletion - input.lastIrrigationMm, 0, taw);
        p.depletionMm = round1(depletion);
        p.stressRatio = round2(depletion / raw);
      }
    }
    projections.push(p);
  }

  const depletionToday = depletion;

  // Project forward.
  for (const day of futureDays) {
    projections.push(step(day));
  }

  // ── Decision ──
  const shouldIrrigate = depletionToday >= raw;
  const futureProjections = projections.filter((p) => !p.isPast);

  // First future day the crop crosses the stress threshold.
  const crossingIdx = futureProjections.findIndex((p) => p.depletionMm >= raw);
  const nextIrrigationDate = shouldIrrigate
    ? futureProjections[0]?.date ?? null
    : crossingIdx >= 0
      ? futureProjections[crossingIdx].date
      : null;
  const daysUntilIrrigation = shouldIrrigate ? 0 : crossingIdx >= 0 ? crossingIdx : null;

  // Meaningful rain in the next 3 days can make irrigation unnecessary.
  const imminentRain = futureProjections
    .slice(0, 3)
    .reduce((sum, p) => sum + p.effectiveRainMm, 0);
  const rainWillCover = imminentRain >= depletionToday * 0.8 && imminentRain >= 5;

  const urgency: Urgency = determineUrgency(
    depletionToday,
    raw,
    taw,
    daysUntilIrrigation,
    rainWillCover,
  );

  // Refill the root zone back to field capacity, but never advise more than
  // the soil can hold — over-irrigation leaches nutrients and wastes water.
  const depthMm = shouldIrrigate && !rainWillCover ? Math.round(Math.min(depletionToday, taw)) : 0;
  const areaM2 = areaHectares * 10_000;

  const recommendation =
    depthMm > 0
      ? {
          depthMm,
          // 1 mm over 1 m² = 1 litre.
          totalLitres: Math.round(depthMm * areaM2),
          totalCubicMetres: Math.round((depthMm * areaM2) / 1000),
        }
      : null;

  const riskLevel: RiskLevel =
    depletionToday >= taw * 0.9 ? 'HIGH' : depletionToday >= raw ? 'MEDIUM' : 'LOW';

  const { headline, reason } = buildNarrative({
    shouldIrrigate,
    rainWillCover,
    urgency,
    depletionToday,
    raw,
    depthMm,
    daysUntilIrrigation,
    nextIrrigationDate,
    imminentRain,
    futureProjections,
    crop,
  });

  const alerts = detectRisks(weather, crop, futureProjections, {
    shouldIrrigate,
    rainWillCover,
    depletionToday,
    raw,
    taw,
  });

  // Confidence drops for each assumption we had to make.
  let confidence = 0.9;
  if (initialisedFrom === 'assumed-midpoint') confidence -= 0.15;
  if (!input.cropIsKnown) confidence -= 0.2;
  if (inferred && !input.plantingDate) confidence -= 0.1;
  if (!soilType) confidence -= 0.05;

  return {
    shouldIrrigate: shouldIrrigate && !rainWillCover,
    urgency,
    headline,
    reason,
    recommendation,
    nextIrrigationDate,
    daysUntilIrrigation,
    confidence: round2(clamp(confidence, 0.3, 0.95)),
    riskLevel,
    waterBalance: {
      totalAvailableWaterMm: taw,
      readilyAvailableWaterMm: raw,
      currentDepletionMm: round1(depletionToday),
      depletionPercent: Math.round((depletionToday / raw) * 100),
      rootDepthM,
      cropCoefficient: kc,
      soilType: soil,
      initialisedFrom,
    },
    forecast: projections,
    alerts,
    assumptions,
  };
}

// ─────────────────────────── Narrative ───────────────────────────

function determineUrgency(
  depletion: number,
  raw: number,
  taw: number,
  daysUntil: number | null,
  rainWillCover: boolean,
): Urgency {
  if (depletion >= taw * 0.9) return 'OVERDUE';
  if (depletion >= raw) return rainWillCover ? 'PLAN' : 'TODAY';
  if (daysUntil !== null && daysUntil <= 2) return 'SOON';
  if (daysUntil !== null) return 'PLAN';
  return 'NONE';
}

function buildNarrative(ctx: {
  shouldIrrigate: boolean;
  rainWillCover: boolean;
  urgency: Urgency;
  depletionToday: number;
  raw: number;
  depthMm: number;
  daysUntilIrrigation: number | null;
  nextIrrigationDate: string | null;
  imminentRain: number;
  futureProjections: DayProjection[];
  crop: CropProfile;
}): { headline: string; reason: string } {
  const {
    shouldIrrigate,
    rainWillCover,
    urgency,
    depletionToday,
    raw,
    depthMm,
    daysUntilIrrigation,
    imminentRain,
    futureProjections,
  } = ctx;

  const pct = Math.round((depletionToday / raw) * 100);

  if (urgency === 'OVERDUE') {
    return {
      headline: `Irrigate today — your crop is water stressed`,
      reason:
        `The root zone has lost ${depletionToday.toFixed(0)} mm of water, past the ${raw.toFixed(0)} mm ` +
        `point where this crop starts to suffer. Every day you wait now costs yield. Apply about ${depthMm} mm.`,
    };
  }

  if (shouldIrrigate && rainWillCover) {
    const rainDay = futureProjections.find((p) => p.effectiveRainMm >= 3);
    const when = rainDay ? describeRelativeDay(rainDay.date, futureProjections) : 'in the next few days';
    return {
      headline: `Hold off — rain is coming ${when}`,
      reason:
        `Soil moisture is low (${pct}% of the comfortable range used up), but about ` +
        `${imminentRain.toFixed(0)} mm of usable rain is forecast over the next 3 days. ` +
        `That should refill the root zone. Save the water and the pump cost — but check back ` +
        `if the rain does not arrive.`,
    };
  }

  if (shouldIrrigate) {
    return {
      headline: `Irrigate today — about ${depthMm} mm`,
      reason:
        `The soil has dried to ${depletionToday.toFixed(0)} mm below field capacity, which has reached ` +
        `this crop's ${raw.toFixed(0)} mm trigger point. No useful rain is forecast in the next 3 days.`,
    };
  }

  if (urgency === 'SOON') {
    const when = daysUntilIrrigation === 0 ? 'today' : daysUntilIrrigation === 1 ? 'tomorrow' : `in ${daysUntilIrrigation} days`;
    return {
      headline: `No irrigation today — plan for ${when}`,
      reason:
        `Soil moisture is adequate for now (${pct}% of the comfortable range used). ` +
        `At the current rate of water use, the crop will need irrigating ${when}.`,
    };
  }

  if (daysUntilIrrigation !== null) {
    return {
      headline: `No irrigation needed for ${daysUntilIrrigation} days`,
      reason:
        `Soil moisture is comfortable (${pct}% of the available range used). ` +
        `Based on the forecast, the next irrigation is due in about ${daysUntilIrrigation} days.`,
    };
  }

  const totalRain = futureProjections.reduce((s, p) => s + p.effectiveRainMm, 0);
  return {
    headline: `No irrigation needed this week`,
    reason:
      totalRain >= 10
        ? `Soil moisture is good and roughly ${totalRain.toFixed(0)} mm of rain is expected over the coming week. ` +
          `The crop's water needs are covered.`
        : `Soil moisture is comfortable and water use is low enough that the crop will not need ` +
          `irrigating within the forecast window.`,
  };
}

// ─────────────────────────── Risk detection ───────────────────────────

function detectRisks(
  weather: WeatherBundle,
  crop: CropProfile,
  future: DayProjection[],
  balance: {
    shouldIrrigate: boolean;
    rainWillCover: boolean;
    depletionToday: number;
    raw: number;
    taw: number;
  },
): RiskAlert[] {
  const alerts: RiskAlert[] = [];

  // ── Heat stress ──
  const hotDays = future.filter((d) => d.tempMaxC > crop.tempRangeC.max);
  if (hotDays.length > 0) {
    const worst = hotDays.reduce((a, b) => (b.tempMaxC > a.tempMaxC ? b : a));
    const extreme = worst.tempMaxC > crop.tempRangeC.max + 5;
    alerts.push({
      type: 'HEAT_STRESS',
      severity: extreme ? 'HIGH' : 'MEDIUM',
      title: extreme ? 'Extreme heat expected' : 'High temperatures expected',
      message:
        `${worst.tempMaxC.toFixed(0)}°C forecast ${formatDay(worst.date)}, above the ` +
        `${crop.tempRangeC.max}°C comfort limit for ${crop.label.toLowerCase()}. ` +
        `${hotDays.length > 1 ? `${hotDays.length} hot days are expected in total.` : ''}`,
      action: extreme
        ? 'Irrigate in the early morning or evening to cool the root zone. Avoid spraying in peak heat. If the crop is flowering, expect some flower drop.'
        : 'Keep soil moisture topped up — well-watered crops tolerate heat far better. Irrigate early morning rather than midday.',
      date: worst.date,
    });
  }

  // ── Frost ──
  const frostDays = future.filter((d) => d.tempMinC <= crop.frostSensitiveBelowC);
  if (frostDays.length > 0) {
    const worst = frostDays.reduce((a, b) => (b.tempMinC < a.tempMinC ? b : a));
    alerts.push({
      type: 'FROST_WARNING',
      severity: worst.tempMinC <= crop.frostSensitiveBelowC - 2 ? 'CRITICAL' : 'HIGH',
      title: 'Frost risk',
      message:
        `Temperature is forecast to drop to ${worst.tempMinC.toFixed(0)}°C ${formatDay(worst.date)}. ` +
        `${crop.label} is damaged below ${crop.frostSensitiveBelowC}°C.`,
      action:
        'Irrigate the evening before — wet soil holds heat and raises the canopy temperature by 1-2°C. ' +
        'Cover young or high-value plants. Light smoke in the early hours also helps in still conditions.',
      date: worst.date,
    });
  }

  // ── Heavy rain / waterlogging ──
  const heavyDays = future.filter((d) => d.rawRainMm >= 50);
  const threeDayTotal = future.slice(0, 3).reduce((s, d) => s + d.rawRainMm, 0);
  if (heavyDays.length > 0 || threeDayTotal >= 100) {
    const worst = heavyDays.length
      ? heavyDays.reduce((a, b) => (b.rawRainMm > a.rawRainMm ? b : a))
      : future[0];
    const isPaddy = crop.key === 'rice';
    alerts.push({
      type: 'FLOOD_RISK',
      severity: threeDayTotal >= 150 ? 'CRITICAL' : 'HIGH',
      title: 'Heavy rainfall expected',
      message: heavyDays.length
        ? `${worst.rawRainMm.toFixed(0)} mm of rain forecast ${formatDay(worst.date)}.`
        : `About ${threeDayTotal.toFixed(0)} mm of rain expected over the next 3 days.`,
      action: isPaddy
        ? 'Check bund heights and make sure the outlet is clear — paddy tolerates standing water but not submergence of the growing point.'
        : 'Clear drainage channels now. Standing water for more than 2 days causes root rot. Do not apply fertiliser before the rain — it will wash away.',
      date: worst?.date,
    });
  }

  // ── Prolonged dry spell ──
  const dryRun = longestDryRun(future);
  if (dryRun >= 5 && balance.depletionToday > balance.raw * 0.5) {
    alerts.push({
      type: 'DROUGHT_RISK',
      severity: dryRun >= 7 ? 'HIGH' : 'MEDIUM',
      title: 'Extended dry spell ahead',
      message: `No meaningful rain forecast for the next ${dryRun} days, and soil moisture is already drawing down.`,
      action:
        'Plan your irrigation schedule now rather than reacting later. Mulching between rows cuts evaporation ' +
        'noticeably. If water is limited, prioritise the crop at its flowering or grain-filling stage.',
    });
  }

  // ── Strong wind ──
  const windyDay = weather.daily
    .filter((d) => !d.isPast)
    .find((d) => d.windSpeedMaxKmh >= 40);
  if (windyDay) {
    alerts.push({
      type: 'WEATHER_RISK',
      severity: windyDay.windSpeedMaxKmh >= 55 ? 'HIGH' : 'MEDIUM',
      title: 'Strong winds expected',
      message: `Winds up to ${windyDay.windSpeedMaxKmh.toFixed(0)} km/h forecast ${formatDay(windyDay.date)}.`,
      action:
        'Do not spray — drift will waste chemical and can damage neighbouring crops. ' +
        'Stake tall or top-heavy plants. Tall cereals near harvest are at risk of lodging.',
      date: windyDay.date,
    });
  }

  // ── Irrigation itself, surfaced as an actionable alert ──
  if (balance.shouldIrrigate && !balance.rainWillCover) {
    const overdue = balance.depletionToday >= balance.taw * 0.9;
    alerts.push({
      type: 'IRRIGATION_NEEDED',
      severity: overdue ? 'HIGH' : 'MEDIUM',
      title: overdue ? 'Irrigation overdue' : 'Irrigation due today',
      message:
        `Root-zone depletion is ${balance.depletionToday.toFixed(0)} mm against a ` +
        `${balance.raw.toFixed(0)} mm trigger point.`,
      action: 'Irrigate today. Early morning or evening loses far less water to evaporation than midday.',
    });
  }

  return alerts;
}

function longestDryRun(days: DayProjection[]): number {
  let best = 0;
  let run = 0;
  for (const d of days) {
    if (d.rawRainMm < 2.5) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

// ─────────────────────────── Formatting ───────────────────────────

/**
 * Day reference for use after the preposition "on" — e.g. "forecast {X}".
 * "today" and "tomorrow" read wrong with a preposition ("on today"), so they
 * are returned bare and the caller's "on" is absorbed here.
 */
function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);

  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff > 1 && diff < 7) {
    return `on ${d.toLocaleDateString('en-IN', { weekday: 'long' })}`;
  }
  return `on ${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
}

function describeRelativeDay(iso: string, _all: DayProjection[]): string {
  return formatDay(iso);
}

function humaniseStage(stage: GrowthStage): string {
  return stage.toLowerCase().replace(/_/g, ' ');
}

function toDateString(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
