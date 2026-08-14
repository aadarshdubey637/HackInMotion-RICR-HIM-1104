/**
 * Nutrient requirements and yield baselines.
 *
 * Kept alongside `crops.ts` rather than inside it so the agronomy reference
 * data stays readable: `crops.ts` answers "how much water and what can go
 * wrong", this file answers "what to feed it and what to expect".
 *
 * Sources: ICAR package-of-practices recommendations and state agricultural
 * university fertiliser schedules for irrigated conditions in the
 * Indo-Gangetic plain. Values are per hectare and deliberately mid-range —
 * a farmer with a real soil test should always prefer their own figures, and
 * the engine adjusts toward those when `soilAnalysis` is present.
 */

export interface NutrientPlan {
  /** Nitrogen, kg/ha of elemental N. */
  nitrogenKgHa: number;
  /** Phosphorus, kg/ha as P₂O₅. */
  phosphorusKgHa: number;
  /** Potassium, kg/ha as K₂O. */
  potassiumKgHa: number;
  /**
   * How nitrogen is split across the season. Phosphorus and potassium are
   * almost always applied fully at sowing, so only N is scheduled.
   */
  nitrogenSplits: Array<{
    /** When to apply, in plain language. */
    timing: string;
    /** Share of total N, 0-1. */
    fraction: number;
    /** Growth stage this corresponds to. */
    stage: string;
  }>;
  /** Anything crop-specific worth telling the farmer. */
  notes: string[];
}

export interface YieldBaseline {
  /**
   * Attainable yield under good management, kg/ha. This is a realistic
   * on-farm figure, not a research-station maximum.
   */
  attainableKgHa: number;
  /** Typical range so the UI can show uncertainty honestly. */
  rangeKgHa: { low: number; high: number };
  /** Marketable unit, for converting to income. */
  unit: string;
}

/**
 * Fertiliser products commonly available in Indian markets, with their
 * nutrient content. Used to convert elemental N-P-K into bags a farmer can
 * actually buy.
 */
export const FERTILISER_PRODUCTS = {
  urea: { label: 'Urea', n: 0.46, p: 0, k: 0, bagKg: 45 },
  dap: { label: 'DAP', n: 0.18, p: 0.46, k: 0, bagKg: 50 },
  mop: { label: 'MOP (Muriate of Potash)', n: 0, p: 0, k: 0.6, bagKg: 50 },
  ssp: { label: 'SSP (Single Super Phosphate)', n: 0, p: 0.16, k: 0, bagKg: 50 },
} as const;

const STANDARD_SPLITS = [
  { timing: 'At sowing (basal)', fraction: 0.33, stage: 'SEED' },
  { timing: 'First top-dress, 3-4 weeks after sowing', fraction: 0.34, stage: 'VEGETATIVE' },
  { timing: 'Second top-dress, at flowering', fraction: 0.33, stage: 'FLOWERING' },
] as const;

export const NUTRITION: Record<string, { nutrients: NutrientPlan; yield: YieldBaseline }> = {
  rice: {
    nutrients: {
      nitrogenKgHa: 120,
      phosphorusKgHa: 60,
      potassiumKgHa: 40,
      nitrogenSplits: [
        { timing: 'At transplanting (basal)', fraction: 0.5, stage: 'SEED' },
        {
          timing: 'At active tillering, ~3 weeks after transplanting',
          fraction: 0.25,
          stage: 'VEGETATIVE',
        },
        { timing: 'At panicle initiation', fraction: 0.25, stage: 'FLOWERING' },
      ],
      notes: [
        'Apply nitrogen to a drained field, then re-flood after 24 hours — this cuts losses sharply.',
        'Zinc deficiency is common in paddy; 25 kg/ha zinc sulphate every third season helps.',
        'Excess nitrogen dramatically worsens blast and bacterial leaf blight.',
      ],
    },
    yield: { attainableKgHa: 5500, rangeKgHa: { low: 3500, high: 7500 }, unit: 'kg' },
  },

  wheat: {
    nutrients: {
      nitrogenKgHa: 120,
      phosphorusKgHa: 60,
      potassiumKgHa: 40,
      nitrogenSplits: [
        { timing: 'At sowing (basal)', fraction: 0.5, stage: 'SEED' },
        {
          timing: 'At first irrigation, 21 days after sowing (crown root stage)',
          fraction: 0.25,
          stage: 'VEGETATIVE',
        },
        { timing: 'At second irrigation, ~45 days', fraction: 0.25, stage: 'VEGETATIVE' },
      ],
      notes: [
        'The crown-root stage top-dress is the single most yield-critical application.',
        'Always apply nitrogen just before an irrigation, never onto dry soil.',
      ],
    },
    yield: { attainableKgHa: 4500, rangeKgHa: { low: 3000, high: 6000 }, unit: 'kg' },
  },

  maize: {
    nutrients: {
      nitrogenKgHa: 150,
      phosphorusKgHa: 75,
      potassiumKgHa: 60,
      nitrogenSplits: [
        { timing: 'At sowing (basal)', fraction: 0.3, stage: 'SEED' },
        { timing: 'At knee-high stage, ~25 days', fraction: 0.4, stage: 'VEGETATIVE' },
        { timing: 'At tasselling', fraction: 0.3, stage: 'FLOWERING' },
      ],
      notes: [
        'Maize is a heavy nitrogen feeder — under-fertilising costs yield faster than in most crops.',
        'The knee-high application matters most; do not delay it.',
      ],
    },
    yield: { attainableKgHa: 6000, rangeKgHa: { low: 3500, high: 9000 }, unit: 'kg' },
  },

  cotton: {
    nutrients: {
      nitrogenKgHa: 150,
      phosphorusKgHa: 75,
      potassiumKgHa: 75,
      nitrogenSplits: [
        { timing: 'At sowing (basal)', fraction: 0.25, stage: 'SEED' },
        { timing: 'At squaring, ~40 days', fraction: 0.375, stage: 'VEGETATIVE' },
        { timing: 'At peak flowering, ~80 days', fraction: 0.375, stage: 'FLOWERING' },
      ],
      notes: [
        'Excess late nitrogen delays boll opening and encourages sucking pests.',
        'Potassium strongly influences fibre quality — do not skip it.',
      ],
    },
    yield: { attainableKgHa: 2000, rangeKgHa: { low: 1200, high: 3000 }, unit: 'kg seed cotton' },
  },

  tomato: {
    nutrients: {
      nitrogenKgHa: 120,
      phosphorusKgHa: 80,
      potassiumKgHa: 100,
      nitrogenSplits: [
        { timing: 'At transplanting (basal)', fraction: 0.3, stage: 'SEED' },
        { timing: '3 weeks after transplanting', fraction: 0.35, stage: 'VEGETATIVE' },
        { timing: 'At first fruit set', fraction: 0.35, stage: 'FRUIT_SET' },
      ],
      notes: [
        'Potassium demand is high during fruiting and directly affects fruit size and taste.',
        'Calcium matters too — irregular watering causes blossom end rot even when calcium is present.',
      ],
    },
    yield: { attainableKgHa: 30000, rangeKgHa: { low: 18000, high: 50000 }, unit: 'kg' },
  },

  potato: {
    nutrients: {
      nitrogenKgHa: 180,
      phosphorusKgHa: 80,
      potassiumKgHa: 100,
      nitrogenSplits: [
        { timing: 'At planting (basal)', fraction: 0.5, stage: 'SEED' },
        { timing: 'At earthing up, ~30 days', fraction: 0.5, stage: 'VEGETATIVE' },
      ],
      notes: [
        'Complete all nitrogen by earthing up — later application grows haulm at the expense of tubers.',
        'Potato is potassium-hungry; shortage shows as small tubers.',
      ],
    },
    yield: { attainableKgHa: 25000, rangeKgHa: { low: 15000, high: 40000 }, unit: 'kg' },
  },

  sugarcane: {
    nutrients: {
      nitrogenKgHa: 250,
      phosphorusKgHa: 100,
      potassiumKgHa: 120,
      nitrogenSplits: [
        { timing: 'At planting (basal)', fraction: 0.25, stage: 'SEED' },
        { timing: 'At 45 days', fraction: 0.25, stage: 'VEGETATIVE' },
        { timing: 'At 90 days', fraction: 0.25, stage: 'VEGETATIVE' },
        { timing: 'At 120 days, before earthing up', fraction: 0.25, stage: 'VEGETATIVE' },
      ],
      notes: [
        'A long-duration crop — four splits prevent losses and match the growth curve.',
        'Stop nitrogen after earthing up; late N reduces sugar recovery.',
      ],
    },
    yield: { attainableKgHa: 80000, rangeKgHa: { low: 50000, high: 120000 }, unit: 'kg cane' },
  },

  soybean: {
    nutrients: {
      nitrogenKgHa: 30,
      phosphorusKgHa: 75,
      potassiumKgHa: 40,
      nitrogenSplits: [{ timing: 'All at sowing (basal)', fraction: 1, stage: 'SEED' }],
      notes: [
        'Soybean fixes its own nitrogen — only a small starter dose is needed.',
        'Treat seed with Rhizobium culture; it is cheap and worth more than extra nitrogen.',
        'Phosphorus matters far more than nitrogen for this crop.',
      ],
    },
    yield: { attainableKgHa: 2200, rangeKgHa: { low: 1200, high: 3200 }, unit: 'kg' },
  },

  onion: {
    nutrients: {
      nitrogenKgHa: 110,
      phosphorusKgHa: 60,
      potassiumKgHa: 80,
      nitrogenSplits: [
        { timing: 'At transplanting (basal)', fraction: 0.4, stage: 'SEED' },
        { timing: '30 days after transplanting', fraction: 0.3, stage: 'VEGETATIVE' },
        { timing: '45 days after transplanting', fraction: 0.3, stage: 'VEGETATIVE' },
      ],
      notes: [
        'Stop nitrogen 45 days after transplanting — later application delays bulbing and hurts storage life.',
        'Sulphur (30 kg/ha) noticeably improves pungency and keeping quality.',
      ],
    },
    yield: { attainableKgHa: 25000, rangeKgHa: { low: 15000, high: 40000 }, unit: 'kg' },
  },

  chickpea: {
    nutrients: {
      nitrogenKgHa: 20,
      phosphorusKgHa: 60,
      potassiumKgHa: 30,
      nitrogenSplits: [{ timing: 'All at sowing (basal)', fraction: 1, stage: 'SEED' }],
      notes: [
        'A legume — it fixes nitrogen, so only a starter dose is required.',
        'Rhizobium seed treatment gives a better return than extra fertiliser.',
      ],
    },
    yield: { attainableKgHa: 1800, rangeKgHa: { low: 1000, high: 2800 }, unit: 'kg' },
  },

  mustard: {
    nutrients: {
      nitrogenKgHa: 80,
      phosphorusKgHa: 40,
      potassiumKgHa: 40,
      nitrogenSplits: [
        { timing: 'At sowing (basal)', fraction: 0.5, stage: 'SEED' },
        { timing: 'At first irrigation, ~30 days', fraction: 0.5, stage: 'VEGETATIVE' },
      ],
      notes: [
        'Sulphur (40 kg/ha) is essential for oil content — mustard responds to it more than most crops.',
      ],
    },
    yield: { attainableKgHa: 1600, rangeKgHa: { low: 900, high: 2500 }, unit: 'kg' },
  },

  groundnut: {
    nutrients: {
      nitrogenKgHa: 25,
      phosphorusKgHa: 50,
      potassiumKgHa: 75,
      nitrogenSplits: [{ timing: 'All at sowing (basal)', fraction: 1, stage: 'SEED' }],
      notes: [
        'A legume — minimal nitrogen needed.',
        'Gypsum (400 kg/ha) at flowering is critical for pod filling. Skipping it costs real yield.',
      ],
    },
    yield: { attainableKgHa: 2000, rangeKgHa: { low: 1200, high: 3000 }, unit: 'kg pods' },
  },
};

/** Conservative fallback for crops outside the knowledge base. */
export const GENERIC_NUTRITION = {
  nutrients: {
    nitrogenKgHa: 100,
    phosphorusKgHa: 50,
    potassiumKgHa: 50,
    nitrogenSplits: [...STANDARD_SPLITS],
    notes: [
      'These are general-purpose figures — this crop is not in our detailed database.',
      'A local soil test and your extension officer will give better numbers.',
    ],
  } as NutrientPlan,
  yield: {
    attainableKgHa: 3000,
    rangeKgHa: { low: 1500, high: 5000 },
    unit: 'kg',
  } as YieldBaseline,
};

export function nutritionFor(cropKey: string): {
  nutrients: NutrientPlan;
  yield: YieldBaseline;
  isKnown: boolean;
} {
  const found = NUTRITION[cropKey];
  return found ? { ...found, isKnown: true } : { ...GENERIC_NUTRITION, isKnown: false };
}
