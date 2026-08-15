/**
 * Fertiliser and resource planning.
 *
 * Turns a crop's nutrient requirement into something a farmer can act on:
 * how many bags of urea, DAP and MOP to buy, and when to apply each.
 *
 * Four adjustments make this specific to one field rather than generic:
 *
 *   1. **Soil nutrient status.** If the farm profile records N-P-K bands, the
 *      requirement is scaled — high phosphorus soil needs less DAP, low
 *      potassium needs more MOP. Applying a textbook dose to soil that already
 *      has the nutrient wastes money and pollutes groundwater.
 *
 *   2. **Soil pH.** Does not change what the crop needs; changes how much of
 *      what you spread it can actually reach. Phosphorus is locked up by iron
 *      and aluminium below pH 5.5 and by calcium above 8.5, so the dose is
 *      raised at both ends — and the farmer is told that lime, or banding
 *      instead of broadcasting, is the cheaper answer than more DAP.
 *
 *   3. **Organic carbon.** Humus-rich soil mineralises nitrogen through the
 *      season and supplies part of the crop's need without a bag.
 *
 *   4. **Growth stage.** Splits already applied are marked as passed, so the
 *      farmer sees what is still owed rather than the whole season's plan.
 *
 * Where the soil figures come from: `soilAnalysis` is a farmer-entered soil
 * health card when there is one, and otherwise bands derived from the SoilGrids
 * lookup done at farm creation (see `farm/location.service.ts`). Which of the
 * two is behind a given plan is reported in `adjustments` and `basis`, because a
 * laboratory test and a modelled raster do not warrant the same confidence.
 *
 * Note that phosphorus and potassium bands are only ever present from a real
 * soil test — SoilGrids does not model plant-available P or K, and the
 * derivation deliberately leaves them unset rather than guessing.
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
    else if (factor < 1)
      adjustments.push(`${name} is ${level} in your soil — dose reduced by 25%, saving cost.`);
    else adjustments.push(`${name} is medium in your soil — standard dose.`);
  }

  // Where the numbers above came from. A laboratory soil health card and a
  // modelled global raster deserve very different confidence, and the farmer is
  // told which one is behind the dose rather than left to assume the stronger.
  const source = typeof input.soilAnalysis?.source === 'string' ? input.soilAnalysis.source : null;

  if (adjustments.length > 0 && source === 'soilgrids') {
    adjustments.push(
      'Soil nitrogen is estimated from a soil map for your location, not a laboratory test. A soil health card would make this more exact — and often shows you need less than this.',
    );
  }

  if (adjustments.length === 0) {
    adjustments.push(
      'No soil test on file — these are standard recommendations. A soil health card would let us tune them and often reduce what you need to buy.',
    );
  }

  // ── pH ──
  //
  // pH does not change the elemental requirement, it changes how much of what
  // you apply the crop can actually take up. Applying the textbook phosphorus
  // dose to soil at pH 8.5 wastes most of it to calcium fixation, and the farmer
  // has no way of knowing that from a bag count alone.
  const ph = typeof input.soilAnalysis?.ph === 'number' ? input.soilAnalysis.ph : null;
  let phFactorP = 1;
  if (ph !== null) {
    if (ph < 5.5) {
      phFactorP = 1.2;
      adjustments.push(
        `Your soil is acidic (pH ${ph}). Phosphorus gets locked up by iron and aluminium, so the dose is raised 20% — but liming with 2-3 quintals of agricultural lime per acre before sowing is the cheaper fix.`,
      );
    } else if (ph < 6.5) {
      phFactorP = 1.1;
      adjustments.push(
        `Your soil is slightly acidic (pH ${ph}) — phosphorus uptake is a little reduced, so the dose is raised 10%.`,
      );
    } else if (ph > 8.5) {
      phFactorP = 1.15;
      adjustments.push(
        `Your soil is strongly alkaline (pH ${ph}). Phosphorus is fixed by calcium and zinc deficiency is common — the dose is raised 15%, place fertiliser in bands near the root rather than broadcasting, and consider 10 kg/acre zinc sulphate.`,
      );
    } else if (ph > 7.8) {
      adjustments.push(
        `Your soil is mildly alkaline (pH ${ph}). Broadcast urea loses nitrogen to the air here — apply it just before irrigation, or mix it into the soil.`,
      );
    } else {
      adjustments.push(
        `Your soil pH (${ph}) is in the ideal range — nutrients are fully available.`,
      );
    }
  }

  // ── Organic carbon ──
  //
  // Well-humified soil mineralises nitrogen through the season, so part of the
  // crop's need is met without a bag. Ignoring this over-applies urea on the
  // farms that need it least.
  const organicCarbon =
    typeof input.soilAnalysis?.organicCarbonGKg === 'number'
      ? input.soilAnalysis.organicCarbonGKg
      : null;
  let carbonFactorN = 1;
  if (organicCarbon !== null) {
    if (organicCarbon >= 15) {
      carbonFactorN = 0.9;
      adjustments.push(
        'Your soil is rich in organic matter, which releases nitrogen as the crop grows — nitrogen reduced 10%.',
      );
    } else if (organicCarbon < 5) {
      carbonFactorN = 1.1;
      adjustments.push(
        'Your soil is low in organic matter, so it holds and releases little nitrogen of its own — nitrogen raised 10%. Farmyard manure or compost at 5 tonnes per acre would improve this lastingly.',
      );
    }
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
  //
  // Nitrogen carries the soil-test band, the sandy-soil leaching allowance and
  // the organic-matter credit; phosphorus carries the pH availability
  // correction. Potassium has no availability term here — pH affects K uptake
  // far less, and inventing one would be noise dressed as precision.
  const nKg = round1(nutrients.nitrogenKgHa * nFactor * sandyFactor * carbonFactorN * areaHectares);
  const pKg = round1(nutrients.phosphorusKgHa * pFactor * phFactorP * areaHectares);
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
  if (ureaKg > 0.5)
    products.push(toProduct('urea', ureaKg, `${Math.round(nitrogenFromUrea)} kg nitrogen`));
  if (dapKg > 0.5)
    products.push(
      toProduct(
        'dap',
        dapKg,
        `${Math.round(pKg)} kg phosphorus + ${Math.round(nitrogenFromDap)} kg nitrogen`,
      ),
    );
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
        ? `Based on ICAR package-of-practices recommendations for irrigated conditions, adjusted for your ${
            source === 'soil-health-card'
              ? 'soil test'
              : source === 'soilgrids'
                ? 'mapped soil chemistry'
                : 'soil type'
          }, area${input.growthStage ? ' and growth stage' : ''}.`
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
