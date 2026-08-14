/**
 * Yield prediction.
 *
 * Deliberately a **transparent stress-factor model**, not a black box. We start
 * from an attainable yield for the crop and multiply it down by the stresses
 * this particular farm has actually experienced:
 *
 *     predicted = attainable × water × heat × health × management
 *
 * Each factor is in [0,1] and derived from data we genuinely hold — logged
 * weather, recorded health observations, irrigation history. Every factor is
 * returned with the reason it was applied, so a farmer can see exactly why the
 * estimate moved and disagree with any single input.
 *
 * This is the honest approach for a system with no historical yield data to
 * train on. A regression fitted on invented data would look more sophisticated
 * and mean less.
 */

import type { GrowthStage } from '@prisma/client';
import type { CropProfile } from '../../domain/crops';
import { nutritionFor } from '../../domain/nutrition';

export interface StressFactor {
  name: string;
  /** Multiplier in [0,1]. 1 means no yield loss from this cause. */
  factor: number;
  /** Percentage yield lost to this factor. */
  lossPercent: number;
  reason: string;
  severity: 'none' | 'mild' | 'moderate' | 'severe';
}

export interface YieldPrediction {
  crop: { key: string; label: string; isKnown: boolean };
  areaHectares: number;

  /** Yield under good management with no stress, kg/ha. */
  attainableKgHa: number;
  /** Our estimate after stress, kg/ha. */
  predictedKgHa: number;
  /** Total for the farm's area, kg. */
  predictedTotalKg: number;
  /** Honest uncertainty band for the total. */
  rangeTotalKg: { low: number; high: number };

  unit: string;
  factors: StressFactor[];

  /** 0-1. Falls as the estimate rests on more assumptions. */
  confidence: number;
  /** How far through the season the crop is, 0-1. Early estimates are weak. */
  seasonProgress: number;

  /** Estimated gross income at the current market price. */
  estimatedIncome: number | null;

  /** What would most improve the outcome from here. */
  improvements: string[];
  limitations: string[];
}

export interface YieldInputs {
  crop: CropProfile;
  cropIsKnown: boolean;
  areaHectares: number;
  plantingDate: Date | null;
  growthStage: GrowthStage | null;

  /** Recent daily weather for the crop's location. */
  weather: Array<{ tempMaxC: number; tempMinC: number; rainfallMm: number; et0Mm: number }>;

  /** Health observations logged for this crop. */
  healthLogs: Array<{ severity: string; status: string; observedAt: Date }>;

  /** How many times irrigation was recorded. */
  irrigationCount: number;
  /** Whether the water balance says the crop has been kept adequately watered. */
  currentDepletionPercent: number | null;

  /** Current commodity price, Rs/quintal. */
  currentPrice: number | null;
}

export function predictYield(input: YieldInputs): YieldPrediction {
  const { crop, areaHectares } = input;
  const { yield: baseline, isKnown } = nutritionFor(crop.key);

  const progress = seasonProgress(crop, input.plantingDate, input.growthStage);
  const factors: StressFactor[] = [
    waterFactor(input),
    heatFactor(input, crop),
    healthFactor(input),
    managementFactor(input),
  ];

  const combined = factors.reduce((acc, f) => acc * f.factor, 1);
  const predictedKgHa = Math.round(baseline.attainableKgHa * combined);
  const predictedTotalKg = Math.round(predictedKgHa * areaHectares);

  // Uncertainty narrows as the season progresses — an estimate at sowing is
  // little more than the crop average; at harvest it is nearly known.
  const spread = 0.35 - progress * 0.2;
  const rangeTotalKg = {
    low: Math.round(predictedTotalKg * (1 - spread)),
    high: Math.round(predictedTotalKg * (1 + spread * 0.7)),
  };

  let confidence = 0.5 + progress * 0.3;
  if (!isKnown || !input.cropIsKnown) confidence -= 0.2;
  if (input.weather.length < 7) confidence -= 0.1;
  if (!input.plantingDate) confidence -= 0.15;

  return {
    crop: { key: crop.key, label: crop.label, isKnown: isKnown && input.cropIsKnown },
    areaHectares,
    attainableKgHa: baseline.attainableKgHa,
    predictedKgHa,
    predictedTotalKg,
    rangeTotalKg,
    unit: baseline.unit,
    factors,
    confidence: round2(clamp(confidence, 0.2, 0.9)),
    seasonProgress: round2(progress),
    // Prices are Rs/quintal (100 kg).
    estimatedIncome:
      input.currentPrice === null
        ? null
        : Math.round((predictedTotalKg / 100) * input.currentPrice),
    improvements: buildImprovements(factors, input),
    limitations: buildLimitations(input, isKnown, progress),
  };
}

// ─────────────────────────── Factors ───────────────────────────

/**
 * Water stress. Uses the current root-zone depletion from the irrigation
 * engine where available — that is a real measurement of whether the crop has
 * been kept watered — and falls back to a rainfall-vs-requirement ratio.
 */
function waterFactor(input: YieldInputs): StressFactor {
  const depletion = input.currentDepletionPercent;

  if (depletion !== null) {
    if (depletion < 80) {
      return {
        name: 'Water',
        factor: 1,
        lossPercent: 0,
        reason: 'Soil moisture has been kept in the comfortable range.',
        severity: 'none',
      };
    }
    if (depletion < 110) {
      return {
        name: 'Water',
        factor: 0.95,
        lossPercent: 5,
        reason: `Soil moisture is at ${depletion}% of the comfortable range — mild stress.`,
        severity: 'mild',
      };
    }
    if (depletion < 160) {
      return {
        name: 'Water',
        factor: 0.85,
        lossPercent: 15,
        reason: `Soil moisture is at ${depletion}% of the comfortable range — the crop is working to extract water.`,
        severity: 'moderate',
      };
    }
    return {
      name: 'Water',
      factor: 0.68,
      lossPercent: 32,
      reason: `Severe water deficit at ${depletion}% of the comfortable range.`,
      severity: 'severe',
    };
  }

  const totalRain = input.weather.reduce((s, d) => s + d.rainfallMm, 0);
  const totalEt = input.weather.reduce((s, d) => s + d.et0Mm, 0);

  if (input.weather.length === 0 || totalEt === 0) {
    return {
      name: 'Water',
      factor: 0.95,
      lossPercent: 5,
      reason: 'No water data available — assuming near-adequate moisture.',
      severity: 'none',
    };
  }

  const ratio = (totalRain + input.irrigationCount * 40) / totalEt;
  if (ratio >= 0.85) {
    return {
      name: 'Water',
      factor: 1,
      lossPercent: 0,
      reason: 'Rainfall and irrigation have covered the crop’s water use.',
      severity: 'none',
    };
  }
  const factor = clamp(0.6 + ratio * 0.4, 0.6, 0.99);
  return {
    name: 'Water',
    factor: round2(factor),
    lossPercent: Math.round((1 - factor) * 100),
    reason: `Water supplied has met about ${Math.round(ratio * 100)}% of the crop’s use.`,
    severity: ratio > 0.7 ? 'mild' : ratio > 0.5 ? 'moderate' : 'severe',
  };
}

/** Heat stress — days above the crop's tolerance, weighted by how far above. */
function heatFactor(input: YieldInputs, crop: CropProfile): StressFactor {
  if (input.weather.length === 0) {
    return {
      name: 'Heat',
      factor: 1,
      lossPercent: 0,
      reason: 'No temperature data.',
      severity: 'none',
    };
  }

  const limit = crop.tempRangeC.max;
  const hotDays = input.weather.filter((d) => d.tempMaxC > limit);
  const extremeDays = input.weather.filter((d) => d.tempMaxC > limit + 5);

  if (hotDays.length === 0) {
    return {
      name: 'Heat',
      factor: 1,
      lossPercent: 0,
      reason: `Temperatures have stayed within the ${limit}°C tolerance.`,
      severity: 'none',
    };
  }

  // Each hot day costs ~0.8%, extreme days a further ~1.5%, capped at 30%.
  const loss = clamp(hotDays.length * 0.008 + extremeDays.length * 0.015, 0, 0.3);
  const factor = 1 - loss;

  return {
    name: 'Heat',
    factor: round2(factor),
    lossPercent: Math.round(loss * 100),
    reason:
      `${hotDays.length} day${hotDays.length === 1 ? '' : 's'} above ${limit}°C` +
      (extremeDays.length ? `, including ${extremeDays.length} extreme` : '') +
      '.',
    severity: loss > 0.18 ? 'severe' : loss > 0.08 ? 'moderate' : 'mild',
  };
}

/** Crop health — unresolved disease and pest pressure. */
function healthFactor(input: YieldInputs): StressFactor {
  const unresolved = input.healthLogs.filter(
    (l) => l.status === 'ACTIVE' || l.status === 'MONITORING',
  );

  if (unresolved.length === 0) {
    const treated = input.healthLogs.length;
    return {
      name: 'Crop health',
      factor: treated > 0 ? 0.97 : 1,
      lossPercent: treated > 0 ? 3 : 0,
      reason:
        treated > 0
          ? `${treated} issue${treated === 1 ? '' : 's'} logged but treated or resolved.`
          : 'No health issues reported.',
      severity: 'none',
    };
  }

  // Weight by severity — a critical unresolved disease is far worse than a mild one.
  const weights: Record<string, number> = {
    MILD: 0.02,
    MODERATE: 0.06,
    SEVERE: 0.14,
    CRITICAL: 0.25,
  };
  const loss = clamp(
    unresolved.reduce((sum, l) => sum + (weights[l.severity] ?? 0.05), 0),
    0,
    0.55,
  );

  const worst = unresolved.reduce((a, b) =>
    (weights[b.severity] ?? 0) > (weights[a.severity] ?? 0) ? b : a,
  );

  return {
    name: 'Crop health',
    factor: round2(1 - loss),
    lossPercent: Math.round(loss * 100),
    reason: `${unresolved.length} unresolved issue${unresolved.length === 1 ? '' : 's'}, worst severity ${worst.severity.toLowerCase()}.`,
    severity: loss > 0.2 ? 'severe' : loss > 0.08 ? 'moderate' : 'mild',
  };
}

/**
 * Management proxy. We cannot see fertiliser or weeding, but whether a farmer
 * is actively recording irrigation and scouting for problems correlates with
 * how closely the crop is being managed. Applied gently — this is the softest
 * signal in the model and is never allowed to dominate.
 */
function managementFactor(input: YieldInputs): StressFactor {
  const engaged = input.irrigationCount + input.healthLogs.length;

  if (engaged >= 3) {
    return {
      name: 'Management',
      factor: 1,
      lossPercent: 0,
      reason: 'Irrigation and scouting are being recorded regularly.',
      severity: 'none',
    };
  }
  if (engaged >= 1) {
    return {
      name: 'Management',
      factor: 0.97,
      lossPercent: 3,
      reason: 'Some activity recorded. Logging irrigation and observations improves this estimate.',
      severity: 'mild',
    };
  }
  return {
    name: 'Management',
    factor: 0.94,
    lossPercent: 6,
    reason: 'No irrigation or health records yet, so we assume average management.',
    severity: 'mild',
  };
}

// ─────────────────────────── Helpers ───────────────────────────

function seasonProgress(
  crop: CropProfile,
  plantingDate: Date | null,
  stage: GrowthStage | null,
): number {
  if (plantingDate) {
    const days = (Date.now() - plantingDate.getTime()) / 86_400_000;
    return clamp(days / crop.growingDays, 0, 1);
  }

  const byStage: Record<GrowthStage, number> = {
    SEED: 0.05,
    GERMINATION: 0.12,
    VEGETATIVE: 0.35,
    FLOWERING: 0.55,
    FRUIT_SET: 0.7,
    RIPENING: 0.88,
    HARVEST_READY: 1,
  };
  return stage ? byStage[stage] : 0.3;
}

function buildImprovements(factors: StressFactor[], input: YieldInputs): string[] {
  const out: string[] = [];

  const water = factors.find((f) => f.name === 'Water');
  if (water && water.factor < 0.95) {
    out.push(
      'Keeping soil moisture above the irrigation trigger is the single biggest lever you have right now.',
    );
  }

  const health = factors.find((f) => f.name === 'Crop health');
  if (health && health.factor < 0.95) {
    out.push(
      'Treating the outstanding crop health issues would recover a meaningful share of this loss.',
    );
  }

  const heat = factors.find((f) => f.name === 'Heat');
  if (heat && heat.factor < 0.95) {
    out.push(
      'Irrigate early morning during hot spells — well-watered crops tolerate heat far better.',
    );
  }

  if (input.irrigationCount === 0) {
    out.push('Log your irrigations so this estimate can use real data instead of assumptions.');
  }

  if (out.length === 0) {
    out.push(
      'No major stress detected. Keep following the irrigation guidance and scouting regularly.',
    );
  }

  return out;
}

function buildLimitations(input: YieldInputs, isKnown: boolean, progress: number): string[] {
  const out: string[] = [];

  if (progress < 0.3) {
    out.push(
      'The crop is early in its season, so this estimate will change substantially as it grows.',
    );
  }
  if (!input.plantingDate) {
    out.push('No planting date recorded — season progress is estimated from the growth stage.');
  }
  if (!isKnown || !input.cropIsKnown) {
    out.push('This crop is not in our detailed database, so the baseline yield is generic.');
  }
  out.push(
    'This is a data-driven estimate, not a guarantee. It cannot see soil fertility, seed quality, weed pressure or fertiliser actually applied.',
  );

  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
