/**
 * Crop recommendation scoring.
 *
 * Answers: "given where this farm is, what its soil is, and what time of year
 * it is — what should I plant?"
 *
 * Five independent dimensions, each scored 0-100 and then weighted:
 *
 *   climate  (30%)  will the temperature suit this crop over the whole season?
 *   season   (25%)  is this actually the right time of year to sow it?
 *   soil     (20%)  does the crop perform on this soil texture?
 *   water    (15%)  can expected rainfall meet demand, or is irrigation needed?
 *   market   (10%)  what is the crop currently worth?
 *
 * Weighting reflects agronomic reality: a crop sown out of season fails
 * regardless of price, so season and climate dominate. Market is included
 * because profitability matters, but deliberately last — chasing a high price
 * into an unsuitable season is exactly the wrong decision this app exists to
 * prevent.
 *
 * Every score carries a plain-language reason, so the farmer can disagree with
 * the reasoning rather than being handed an unexplained number.
 */

import type { SoilType } from '@prisma/client';
import type { CropProfile } from '../../domain/crops';
import { CROPS, currentSeason } from '../../domain/crops';
import { nutritionFor } from '../../domain/nutrition';
import type { ClimateWindow } from './climate';

export interface DimensionScore {
  score: number;
  reason: string;
}

export interface CropRecommendation {
  cropKey: string;
  label: string;
  commodity: string;

  /** Weighted overall suitability, 0-100. */
  suitabilityScore: number;
  /** Bucketed for the UI so colour is consistent. */
  rating: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';

  climate: DimensionScore;
  season: DimensionScore;
  soil: DimensionScore;
  water: DimensionScore;
  market: DimensionScore;

  /** One-line summary of why this crop is or is not recommended. */
  summary: string;
  /** Things the farmer should know before committing. */
  cautions: string[];

  agronomy: {
    growingDays: number;
    waterRequirementMm: number;
    /** Rain expected in the window, mm. Null when climate data is unavailable. */
    expectedRainfallMm: number | null;
    /** Shortfall the farmer would need to irrigate, mm. */
    irrigationNeedMm: number | null;
    seasons: string[];
  };

  economics: {
    currentPrice: number | null;
    unit: string;
    /** Estimated gross income per hectare at attainable yield. */
    estimatedIncomePerHa: number | null;
    attainableYieldKgHa: number;
  };
}

export interface ScoringInputs {
  soilType: SoilType | null;
  climate: ClimateWindow | null;
  /** Current modal price per commodity, from the market module. */
  prices: Map<string, number>;
  /** Crops already growing on this farm — surfaced but not excluded. */
  existingCrops: Set<string>;
  /** True if the farmer has irrigation; changes how rainfall shortfall is judged. */
  hasIrrigation: boolean;
}

const WEIGHTS = { climate: 0.3, season: 0.25, soil: 0.2, water: 0.15, market: 0.1 };

// ─────────────────────────── Dimensions ───────────────────────────

/**
 * Climate fit — how well the crop's temperature tolerance matches what this
 * location actually experiences in the coming season.
 */
function scoreClimate(crop: CropProfile, climate: ClimateWindow | null): DimensionScore {
  if (!climate) {
    return {
      score: 60,
      reason: 'Historical climate data was unavailable, so this is a neutral estimate.',
    };
  }

  const { min, max } = crop.tempRangeC;
  const mid = (min + max) / 2;
  const halfRange = (max - min) / 2;

  // How far the season's mean sits from the crop's comfort centre, as a
  // fraction of its tolerance. 0 = perfect, 1 = at the edge, >1 = outside.
  const deviation = Math.abs(climate.meanTempC - mid) / halfRange;
  let score = Math.round(clamp(100 - deviation * 55, 0, 100));

  const reasons: string[] = [];
  if (deviation < 0.4) {
    reasons.push(`average ${climate.meanTempC}°C sits comfortably in this crop's ${min}-${max}°C range`);
  } else if (deviation <= 1) {
    reasons.push(`average ${climate.meanTempC}°C is workable but near the edge of the ${min}-${max}°C range`);
  } else {
    reasons.push(`average ${climate.meanTempC}°C is outside the ${min}-${max}°C this crop prefers`);
  }

  // Heat and frost extremes are penalised separately — the mean can look fine
  // while a single 45°C week destroys a flowering crop.
  if (climate.meanMaxTempC > max + 5) {
    score -= 15;
    reasons.push(`peaks near ${climate.meanMaxTempC}°C risk heat stress`);
  }
  if (climate.meanMinTempC < crop.frostSensitiveBelowC) {
    score -= 20;
    reasons.push(`lows near ${climate.meanMinTempC}°C risk frost damage`);
  } else if (climate.frostDays > 0 && crop.frostSensitiveBelowC >= 0) {
    score -= 10;
    reasons.push(`${climate.frostDays} frost days expected`);
  }

  return {
    score: Math.round(clamp(score, 0, 100)),
    reason: capitalise(reasons.join('; ')) + '.',
  };
}

/** Season fit — is this the right time of year to sow? */
function scoreSeason(crop: CropProfile, season: 'kharif' | 'rabi' | 'zaid'): DimensionScore {
  if (crop.seasons.includes(season)) {
    return {
      score: 100,
      reason: `${capitalise(season)} is a normal sowing season for this crop.`,
    };
  }

  // Adjacent seasons are a partial miss; the fully wrong one is worse.
  const adjacency: Record<string, string[]> = {
    kharif: ['zaid'],
    rabi: ['zaid'],
    zaid: ['kharif', 'rabi'],
  };
  const nearMiss = crop.seasons.some((s) => adjacency[season]?.includes(s));

  return {
    score: nearMiss ? 40 : 15,
    reason: `Normally sown in ${crop.seasons.join(' or ')}, not ${season}. Sowing out of season usually cuts yield sharply.`,
  };
}

/** Soil fit — does this crop perform on this texture? */
function scoreSoil(crop: CropProfile, soilType: SoilType | null): DimensionScore {
  if (!soilType) {
    return {
      score: 65,
      reason: 'Soil type not recorded — add it to your farm profile for a more accurate match.',
    };
  }

  if (crop.preferredSoils.includes(soilType)) {
    return {
      score: 100,
      reason: `Grows well on ${soilType.toLowerCase()} soil.`,
    };
  }

  // Textures that behave similarly get partial credit rather than a hard zero.
  const similar: Record<SoilType, SoilType[]> = {
    LOAMY: ['SILTY', 'MIXED'],
    SILTY: ['LOAMY', 'MIXED'],
    MIXED: ['LOAMY', 'SILTY'],
    CLAY: ['SILTY'],
    SANDY: ['CHALKY'],
    CHALKY: ['SANDY'],
    PEATY: ['LOAMY'],
  };
  const workable = similar[soilType]?.some((s) => crop.preferredSoils.includes(s));

  return {
    score: workable ? 55 : 30,
    reason: workable
      ? `${capitalise(soilType.toLowerCase())} soil is workable but not ideal — this crop prefers ${crop.preferredSoils.slice(0, 2).map((s) => s.toLowerCase()).join(' or ')}.`
      : `This crop prefers ${crop.preferredSoils.slice(0, 2).map((s) => s.toLowerCase()).join(' or ')} soil, not ${soilType.toLowerCase()}.`,
  };
}

/**
 * Water fit — can expected rainfall cover the crop's need?
 *
 * A shortfall is not automatically bad: it is bad only if the farmer cannot
 * irrigate. Excess rain is penalised too, since waterlogging is a real risk
 * for most non-paddy crops.
 */
function scoreWater(
  crop: CropProfile,
  climate: ClimateWindow | null,
  hasIrrigation: boolean,
): DimensionScore & { expectedRainfallMm: number | null; irrigationNeedMm: number | null } {
  if (!climate) {
    return {
      score: 60,
      reason: 'Rainfall history unavailable for this location.',
      expectedRainfallMm: null,
      irrigationNeedMm: null,
    };
  }

  const need = crop.waterRequirementMm;
  const rain = climate.totalRainfallMm;
  const ratio = rain / need;
  const shortfall = Math.max(0, Math.round(need - rain));

  let score: number;
  let reason: string;

  if (ratio >= 0.9 && ratio <= 1.4) {
    score = 100;
    reason = `Expected rainfall of about ${rain} mm closely matches the ${need} mm this crop needs.`;
  } else if (ratio > 1.4) {
    // Paddy is grown ponded, so excess water is not a problem for it.
    const tolerant = crop.key === 'rice' || crop.key === 'sugarcane';
    score = tolerant ? 95 : Math.round(clamp(100 - (ratio - 1.4) * 45, 35, 90));
    reason = tolerant
      ? `Heavy rainfall of about ${rain} mm suits this crop.`
      : `About ${rain} mm expected against a ${need} mm need — surplus water means drainage will matter.`;
  } else if (hasIrrigation) {
    // With irrigation available, a shortfall is a cost, not a blocker.
    score = Math.round(clamp(100 - (1 - ratio) * 55, 40, 95));
    reason = `Rainfall of about ${rain} mm leaves roughly ${shortfall} mm to make up by irrigation.`;
  } else {
    score = Math.round(clamp(100 - (1 - ratio) * 110, 5, 90));
    reason = `Only about ${rain} mm expected against a ${need} mm need — a ${shortfall} mm shortfall with no irrigation is a serious risk.`;
  }

  return { score, reason, expectedRainfallMm: rain, irrigationNeedMm: shortfall || null };
}

/**
 * Market score — relative value against the other crops being considered.
 *
 * Scored on estimated income per hectare rather than raw price, since a
 * ₹7,000/quintal crop yielding 2 t/ha earns less than a ₹2,000/quintal crop
 * yielding 30 t/ha. Comparing raw prices would be actively misleading.
 */
function scoreMarket(
  incomePerHa: number | null,
  allIncomes: number[],
): DimensionScore {
  if (incomePerHa === null || allIncomes.length === 0) {
    return { score: 50, reason: 'No current price data for this crop.' };
  }

  const max = Math.max(...allIncomes);
  const min = Math.min(...allIncomes);
  const span = max - min;

  const score = span === 0 ? 70 : Math.round(clamp(30 + ((incomePerHa - min) / span) * 70, 0, 100));

  return {
    score,
    reason: `Estimated gross income of about ₹${Math.round(incomePerHa).toLocaleString('en-IN')} per hectare at typical yield.`,
  };
}

// ─────────────────────────── Engine ───────────────────────────

export function recommendCrops(input: ScoringInputs, limit = 6): CropRecommendation[] {
  const season = currentSeason();

  // First pass: compute income per hectare for every crop, so the market
  // dimension can be scored relative to the actual field of candidates.
  const incomes = new Map<string, number | null>();
  for (const crop of CROPS) {
    const price = input.prices.get(crop.commodity) ?? null;
    const { yield: y } = nutritionFor(crop.key);
    // Prices are Rs/quintal; a quintal is 100 kg.
    incomes.set(crop.key, price === null ? null : (y.attainableKgHa / 100) * price);
  }
  const knownIncomes = [...incomes.values()].filter((v): v is number => v !== null);

  const recommendations = CROPS.map((crop) => {
    const climate = scoreClimate(crop, input.climate);
    const seasonScore = scoreSeason(crop, season);
    const soil = scoreSoil(crop, input.soilType);
    const water = scoreWater(crop, input.climate, input.hasIrrigation);
    const incomePerHa = incomes.get(crop.key) ?? null;
    const market = scoreMarket(incomePerHa, knownIncomes);

    const suitability = Math.round(
      climate.score * WEIGHTS.climate +
        seasonScore.score * WEIGHTS.season +
        soil.score * WEIGHTS.soil +
        water.score * WEIGHTS.water +
        market.score * WEIGHTS.market,
    );

    const { yield: yieldBaseline } = nutritionFor(crop.key);
    const cautions = buildCautions(crop, { climate, season: seasonScore, soil, water }, input);

    return {
      cropKey: crop.key,
      label: crop.label,
      commodity: crop.commodity,
      suitabilityScore: suitability,
      rating: rate(suitability),
      climate,
      season: seasonScore,
      soil,
      water: { score: water.score, reason: water.reason },
      market,
      summary: buildSummary(crop, suitability, seasonScore, climate, water, input),
      cautions,
      agronomy: {
        growingDays: crop.growingDays,
        waterRequirementMm: crop.waterRequirementMm,
        expectedRainfallMm: water.expectedRainfallMm,
        irrigationNeedMm: water.irrigationNeedMm,
        seasons: [...crop.seasons],
      },
      economics: {
        currentPrice: input.prices.get(crop.commodity) ?? null,
        unit: crop.priceUnit,
        estimatedIncomePerHa: incomePerHa === null ? null : Math.round(incomePerHa),
        attainableYieldKgHa: yieldBaseline.attainableKgHa,
      },
    };
  });

  recommendations.sort((a, b) => b.suitabilityScore - a.suitabilityScore);

  // Always include what the farmer is already growing, even if it falls
  // outside the top N. Being able to compare your current crop against the
  // alternatives is the whole point — hiding it would be the wrong answer.
  const top = recommendations.slice(0, limit);
  const missingExisting = recommendations.filter(
    (r) => input.existingCrops.has(r.cropKey) && !top.some((t) => t.cropKey === r.cropKey),
  );

  return [...top, ...missingExisting].sort((a, b) => b.suitabilityScore - a.suitabilityScore);
}

function rate(score: number): CropRecommendation['rating'] {
  if (score >= 80) return 'EXCELLENT';
  if (score >= 65) return 'GOOD';
  if (score >= 45) return 'FAIR';
  return 'POOR';
}

function buildSummary(
  crop: CropProfile,
  score: number,
  season: DimensionScore,
  climate: DimensionScore,
  water: DimensionScore,
  input: ScoringInputs,
): string {
  if (input.existingCrops.has(crop.key)) {
    return `You are already growing ${crop.label.toLowerCase()}. Suitability this season scores ${score}/100.`;
  }

  if (score >= 80) {
    return `Strong choice for your farm this season — climate, soil and timing all line up.`;
  }
  if (score >= 65) {
    return `A solid option. ${weakestDimension([season, climate, water])}`;
  }
  if (score >= 45) {
    return `Possible, but with real trade-offs. ${weakestDimension([season, climate, water])}`;
  }
  return `Not recommended right now. ${weakestDimension([season, climate, water])}`;
}

function weakestDimension(dims: DimensionScore[]): string {
  const weakest = dims.reduce((a, b) => (b.score < a.score ? b : a));
  return weakest.reason;
}

function buildCautions(
  crop: CropProfile,
  scores: { climate: DimensionScore; season: DimensionScore; soil: DimensionScore; water: DimensionScore & { irrigationNeedMm: number | null } },
  input: ScoringInputs,
): string[] {
  const cautions: string[] = [];

  if (scores.season.score < 60) {
    cautions.push(`Out of season — ${crop.label.toLowerCase()} is normally sown in ${crop.seasons.join(' or ')}.`);
  }
  if (scores.water.irrigationNeedMm && scores.water.irrigationNeedMm > 200) {
    cautions.push(
      `Needs roughly ${scores.water.irrigationNeedMm} mm of irrigation beyond expected rainfall — budget for pumping cost.`,
    );
  }
  if (!input.hasIrrigation && crop.waterRequirementMm > 700) {
    cautions.push('This is a high-water crop and you have no irrigation recorded.');
  }
  if (scores.soil.score < 50) {
    cautions.push(scores.soil.reason);
  }
  if (crop.diseases.some((d) => d.severity === 'CRITICAL')) {
    const worst = crop.diseases.find((d) => d.severity === 'CRITICAL');
    cautions.push(`Watch for ${worst?.name} — it can cause total loss if missed early.`);
  }

  return cautions;
}

// ─────────────────────────── Utils ───────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
