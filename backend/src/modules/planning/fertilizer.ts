/**
 * Fertiliser and resource planning.
 *
 * Turns a crop's nutrient requirement into something a farmer can act on:
 * how many bags of urea, DAP and MOP to buy, and when to apply each.
 *
 * Two adjustments make this specific rather than generic:
 *
 *   1. **Soil test values.** If the farm profile records N-P-K status, the
 *      requirement is scaled — high phosphorus soil needs less DAP, low
 *      potassium needs more MOP. Applying a textbook dose to soil that already
 *      has the nutrient wastes money and pollutes groundwater.
 *
 *   2. **Growth stage.** Splits already applied are marked as passed, so the
 *      farmer sees what is still owed rather than the whole season's plan.
 *
 * Order of operations matters: phosphorus is supplied by DAP, which also
 * carries 18% nitrogen. That nitrogen is subtracted from the urea requirement —
 * skipping this step over-applies nitrogen by a meaningful margin.
 */

import type { GrowthStage, SoilType } from '@prisma/client';
import type { CropProfile } from '../../domain/crops';
import { nutritionFor, FERTILISER_PRODUCTS } from '../../domain/nutrition';

export interface ProductRequirement {
  product: string;
  /** Total kilograms needed for the area. */
  totalKg: number;
  /** Whole bags, rounded up — how it is actually bought. */
  bags: number;
  bagSizeKg: number;
  /** What this product supplies. */
  supplies: string;
}

export interface ApplicationStep {
  timing: string;
  stage: string;
  /** Urea for this split, kg for the whole area. */
  ureaKg: number;
  /** Basal dressing also carries all the phosphorus and potassium. */
  dapKg: number;
  mopKg: number;
  /** True when the crop has already passed this stage. */
  passed: boolean;
}

export interface FertilizerPlan {
  crop: { key: string; label: string; isKnown: boolean };
  areaHectares: number;

  /** Elemental requirement after soil adjustment, kg for the whole area. */
  requirement: {
    nitrogenKg: number;
    phosphorusKg: number;
    potassiumKg: number;
  };

  /** What to buy. */
  products: ProductRequirement[];

  /** When to apply it. */
  schedule: ApplicationStep[];

  /** How the soil test changed the textbook dose. */
  adjustments: string[];

  /** Crop-specific advice. */
  notes: string[];

  /** Honest statement of what this is based on. */
  basis: string;
}

/** Soil test bands, as reported by most Indian soil health cards. */
type NutrientLevel = 'low' | 'medium' | 'high';

/**
 * Multipliers applied to the textbook dose based on soil test status.
 * Low soil → apply more; high soil → apply less. These follow the standard
 * extension-service adjustment convention.
 */
const SOIL_ADJUSTMENT: Record<NutrientLevel, number> = {
  low: 1.25,
  medium: 1.0,
  high: 0.75,
};

function readLevel(value: unknown): NutrientLevel | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  if (v === 'low' || v === 'medium' || v === 'high') return v;
  return null;
}

export interface FertilizerInputs {
  crop: CropProfile;
  cropIsKnown: boolean;
  areaHectares: number;
  growthStage: GrowthStage | null;
  soilType: SoilType | null;
  /** Farm's recorded soil analysis, if any. Expects { nitrogen, phosphorus, potassium } as low/medium/high. */
  soilAnalysis: Record<string, unknown> | null;
}

const STAGE_ORDER: GrowthStage[] = [
  'SEED',
  'GERMINATION',
  'VEGETATIVE',
  'FLOWERING',
  'FRUIT_SET',
  'RIPENING',
  'HARVEST_READY',
];

export function planFertilizer(input: FertilizerInputs): FertilizerPlan {
  const { crop, areaHectares } = input;
  const { nutrients, isKnown } = nutritionFor(crop.key);

  const adjustments: string[] = [];

  // ── Soil-test adjustment ──
  const nLevel = readLevel(input.soilAnalysis?.nitrogen);
  const pLevel = readLevel(input.soilAnalysis?.phosphorus);
  const kLevel = readLevel(input.soilAnalysis?.potassium);

  const nFactor = nLevel ? SOIL_ADJUSTMENT[nLevel] : 1;
  const pFactor = pLevel ? SOIL_ADJUSTMENT[pLevel] : 1;
  const kFactor = kLevel ? SOIL_ADJUSTMENT[kLevel] : 1;

  for (const [name, level, factor] of [
    ['Nitrogen', nLevel, nFactor],
    ['Phosphorus', pLevel, pFactor],
    ['Potassium', kLevel, kFactor],
  ] as const) {
    if (!level) continue;
    if (factor > 1) adjustments.push(`${name} is ${level} in your soil — dose increased by 25%.`);
    else if (factor < 1) adjustments.push(`${name} is ${level} in your soil — dose reduced by 25%, saving cost.`);
    else adjustments.push(`${name} is medium in your soil — standard dose.`);
  }

  if (adjustments.length === 0) {
    adjustments.push(
      'No soil test on file — these are standard recommendations. A soil health card would let us tune them and often reduce what you need to buy.',
    );
  }

  // Sandy soils leach nitrogen; splitting more finely matters, and total need rises.
  let leachingNote: string | null = null;
  let sandyFactor = 1;
  if (input.soilType === 'SANDY') {
    sandyFactor = 1.1;
    leachingNote =
      'Sandy soil loses nitrogen quickly to leaching — the dose is raised 10% and splitting it is especially important.';
    adjustments.push(leachingNote);
  }

  // ── Elemental requirement for the whole area ──
  const nKg = round1(nutrients.nitrogenKgHa * nFactor * sandyFactor * areaHectares);
  const pKg = round1(nutrients.phosphorusKgHa * pFactor * areaHectares);
  const kKg = round1(nutrients.potassiumKgHa * kFactor * areaHectares);

  // ── Convert to products ──
  // DAP first, since it supplies phosphorus AND some nitrogen.
  const dapKg = pKg > 0 ? pKg / FERTILISER_PRODUCTS.dap.p : 0;
  const nitrogenFromDap = dapKg * FERTILISER_PRODUCTS.dap.n;

  // Remaining nitrogen comes from urea. Never negative — DAP alone can
  // occasionally over-supply nitrogen on low-N crops like legumes.
  const nitrogenFromUrea = Math.max(0, nKg - nitrogenFromDap);
  const ureaKg = nitrogenFromUrea / FERTILISER_PRODUCTS.urea.n;

  const mopKg = kKg > 0 ? kKg / FERTILISER_PRODUCTS.mop.k : 0;

  if (nitrogenFromDap >= nKg && pKg > 0) {
    adjustments.push(
      'DAP alone supplies all the nitrogen this crop needs, so no urea is required — a legume trait worth knowing.',
    );
  }

  const products: ProductRequirement[] = [];
  if (ureaKg > 0.5) products.push(toProduct('urea', ureaKg, `${Math.round(nitrogenFromUrea)} kg nitrogen`));
  if (dapKg > 0.5) products.push(toProduct('dap', dapKg, `${Math.round(pKg)} kg phosphorus + ${Math.round(nitrogenFromDap)} kg nitrogen`));
  if (mopKg > 0.5) products.push(toProduct('mop', mopKg, `${Math.round(kKg)} kg potassium`));

  // ── Schedule ──
  const currentIndex = input.growthStage ? STAGE_ORDER.indexOf(input.growthStage) : -1;

  const schedule: ApplicationStep[] = nutrients.nitrogenSplits.map((split, i) => {
    const splitIndex = STAGE_ORDER.indexOf(split.stage as GrowthStage);
    const passed = currentIndex >= 0 && splitIndex >= 0 && splitIndex < currentIndex;

    return {
      timing: split.timing,
      stage: split.stage,
      ureaKg: Math.round(ureaKg * split.fraction),
      // All phosphorus and potassium go in at the first (basal) application.
      dapKg: i === 0 ? Math.round(dapKg) : 0,
      mopKg: i === 0 ? Math.round(mopKg) : 0,
      passed,
    };
  });

  return {
    crop: { key: crop.key, label: crop.label, isKnown: isKnown && input.cropIsKnown },
    areaHectares,
    requirement: { nitrogenKg: nKg, phosphorusKg: pKg, potassiumKg: kKg },
    products,
    schedule,
    adjustments,
    notes: nutrients.notes,
    basis:
      isKnown && input.cropIsKnown
        ? 'Based on ICAR package-of-practices recommendations for irrigated conditions, adjusted for your soil and area.'
        : 'This crop is not in our detailed database — these are general-purpose figures. Please confirm with your local extension officer.',
  };
}

function toProduct(
  key: keyof typeof FERTILISER_PRODUCTS,
  totalKg: number,
  supplies: string,
): ProductRequirement {
  const product = FERTILISER_PRODUCTS[key];
  return {
    product: product.label,
    totalKg: Math.round(totalKg),
    // Fertiliser is sold by the bag; rounding up is what the farmer actually buys.
    bags: Math.ceil(totalKg / product.bagKg),
    bagSizeKg: product.bagKg,
    supplies,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
