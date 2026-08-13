/**
 * Crop knowledge base.
 *
 * A single curated source of agronomic facts that three separate engines read from:
 *   - the irrigation engine   → crop coefficients (Kc) and rooting depth
 *   - the crop-health engine  → disease/pest profiles and their trigger conditions
 *   - the market engine       → AGMARKNET commodity names and price units
 *
 * Kc values and rooting depths follow FAO Irrigation & Drainage Paper 56
 * ("Crop evapotranspiration", Allen et al., 1998), Tables 12 and 22, adjusted
 * toward Indian sub-tropical conditions where the paper gives a range.
 *
 * Disease trigger thresholds come from standard extension-service advisories
 * (ICAR package-of-practices and state agricultural university bulletins).
 * They are intentionally conservative — the engine's job is to tell a farmer
 * what to go and *check*, not to diagnose with certainty.
 */

import type { GrowthStage, SoilType } from '@prisma/client';

// ─────────────────────────── Types ───────────────────────────

/**
 * Weather conditions that favour a disease or pest.
 *
 * Shared by both profile kinds so the diagnostic engine can evaluate any
 * candidate through one code path. Every field is optional — a profile
 * specifies only the conditions that actually matter for it.
 */
export interface WeatherTriggers {
  minHumidity?: number;
  maxHumidity?: number;
  minTempC?: number;
  maxTempC?: number;
  /** Millimetres of rain over the preceding 7 days. */
  minRecentRainMm?: number;
  /** Upper bound on recent rain — for pests that thrive in dry spells. */
  maxRecentRainMm?: number;
  /** Days in the last 7 with leaf-wetness-favourable conditions. */
  minWetDays?: number;
}

export interface DiseaseProfile {
  name: string;
  /** Symptom keywords matched against the farmer's free-text description. */
  keywords: string[];
  favouredBy?: WeatherTriggers;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'CRITICAL';
  /** What the farmer should do, in plain language, most urgent first. */
  actions: string[];
  /** Why the engine flagged it — shown to the farmer for transparency. */
  explanation: string;
}

export interface PestProfile {
  name: string;
  keywords: string[];
  favouredBy?: WeatherTriggers;
  severity: 'MILD' | 'MODERATE' | 'SEVERE' | 'CRITICAL';
  actions: string[];
  explanation: string;
}

export interface CropProfile {
  /** Canonical lowercase key. */
  key: string;
  label: string;
  /** Name used by AGMARKNET / data.gov.in price datasets. */
  commodity: string;
  /** Unit prices are quoted in. AGMARKNET uses Rs/quintal for most field crops. */
  priceUnit: string;

  /** Total growing season length in days, sowing to harvest. */
  growingDays: number;
  /** Seasonal water requirement, mm. */
  waterRequirementMm: number;
  /** Maximum effective rooting depth, metres. Drives available soil water. */
  rootDepthM: number;
  /**
   * Management Allowed Depletion — the fraction of available soil water the
   * crop can lose before yield is affected. Irrigation is triggered at this point.
   */
  depletionFraction: number;
  /** Crop coefficient by growth stage. Multiplied by ET0 to give crop water use. */
  kc: Record<GrowthStage, number>;

  /** Indian cropping seasons this crop is sown in. */
  seasons: Array<'kharif' | 'rabi' | 'zaid'>;
  /** Soil types this crop performs well on. */
  preferredSoils: SoilType[];
  /** Temperature band for healthy growth, °C. Outside this, stress alerts fire. */
  tempRangeC: { min: number; max: number };
  /** Below this, frost damage is likely. */
  frostSensitiveBelowC: number;

  diseases: DiseaseProfile[];
  pests: PestProfile[];
}

// ───────────────────── Shared stage curves ─────────────────────

/** Generic FAO-56 shaped Kc curve, scaled to a crop's mid-season peak. */
function kcCurve(mid: number, initial = 0.4, late = mid * 0.7): Record<GrowthStage, number> {
  return {
    SEED: initial,
    GERMINATION: initial,
    VEGETATIVE: round2((initial + mid) / 2),
    FLOWERING: mid,
    FRUIT_SET: mid,
    RIPENING: round2(late),
    HARVEST_READY: round2(late * 0.75),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ───────────────── Reusable pest/disease fragments ─────────────────

const APHID: PestProfile = {
  name: 'Aphids',
  keywords: ['aphid', 'sticky', 'honeydew', 'curling leaves', 'small green insects', 'sooty mould', 'ants'],
  favouredBy: { minTempC: 15, maxTempC: 30, maxRecentRainMm: 20 },
  severity: 'MODERATE',
  actions: [
    'Check the underside of young leaves and growing tips for clusters of small soft insects.',
    'Spray neem oil (5 ml/litre) in the early morning or evening — avoid midday heat.',
    'Encourage ladybird beetles; avoid broad-spectrum insecticide which kills them too.',
    'If more than 20% of plants are infested, consult your local extension officer before chemical spraying.',
  ],
  explanation: 'Warm dry weather with little rain lets aphid populations build quickly.',
};

const WHITEFLY: PestProfile = {
  name: 'Whitefly',
  keywords: ['whitefly', 'white fly', 'tiny white insects', 'yellowing', 'sticky leaves', 'flying white'],
  favouredBy: { minTempC: 25, maxRecentRainMm: 15 },
  severity: 'MODERATE',
  actions: [
    'Shake a plant — whiteflies fly up in a small cloud if present.',
    'Install yellow sticky traps at canopy height, roughly 10 per acre.',
    'Spray neem-based formulation; repeat after 7 days.',
    'Whitefly transmits leaf-curl virus — remove and destroy any severely curled plants.',
  ],
  explanation: 'Hot, dry conditions strongly favour whitefly build-up.',
};

const STEM_BORER: PestProfile = {
  name: 'Stem Borer',
  keywords: ['borer', 'dead heart', 'deadheart', 'hollow stem', 'white ear', 'holes in stem', 'drying centre'],
  favouredBy: { minTempC: 25, minHumidity: 60 },
  severity: 'SEVERE',
  actions: [
    'Pull gently on a central shoot — if it comes away easily and is hollow, borer is confirmed.',
    'Remove and destroy affected tillers immediately.',
    'Install pheromone traps to monitor moth activity.',
    'Consider Trichogramma parasitoid release — available from most KVK centres.',
  ],
  explanation: 'Warm humid conditions during tillering favour stem borer egg-laying.',
};

// ───────────────────────── Crop profiles ─────────────────────────

export const CROPS: CropProfile[] = [
  {
    key: 'rice',
    label: 'Rice (Paddy)',
    commodity: 'Rice',
    priceUnit: 'Rs/quintal',
    growingDays: 120,
    waterRequirementMm: 1200,
    rootDepthM: 0.5,
    // Paddy is grown ponded — it tolerates almost no depletion.
    depletionFraction: 0.2,
    kc: kcCurve(1.2, 1.05, 0.9),
    seasons: ['kharif'],
    preferredSoils: ['CLAY', 'LOAMY', 'SILTY'],
    tempRangeC: { min: 20, max: 37 },
    frostSensitiveBelowC: 8,
    diseases: [
      {
        name: 'Rice Blast',
        keywords: ['blast', 'diamond', 'spindle', 'grey centre', 'gray center', 'neck rot', 'lesion on leaf', 'brown border'],
        favouredBy: { minHumidity: 85, minTempC: 20, maxTempC: 30, minWetDays: 2 },
        severity: 'SEVERE',
        actions: [
          'Look for diamond/spindle-shaped lesions with grey centres and brown borders.',
          'Check the neck of the panicle — blackening there causes total grain loss.',
          'Stop applying nitrogen immediately; excess N sharply worsens blast.',
          'Drain the field for 2–3 days if the crop is at tillering stage.',
          'Tricyclazole spray is the standard control — confirm dose with your extension officer.',
        ],
        explanation: 'High humidity with moderate temperatures and prolonged leaf wetness is the classic blast trigger.',
      },
      {
        name: 'Bacterial Leaf Blight',
        keywords: ['blight', 'yellowing margin', 'wavy margin', 'drying from tip', 'water soaked', 'ooze', 'wilting seedling'],
        favouredBy: { minHumidity: 80, minTempC: 25, minRecentRainMm: 40 },
        severity: 'SEVERE',
        actions: [
          'Look for yellow wavy lesions starting at leaf tips and moving down the margins.',
          'Cut a lesion and dip it in clear water — a milky ooze confirms bacterial blight.',
          'Drain standing water; the bacteria spread through it.',
          'Stop nitrogen top-dressing.',
          'There is no effective chemical cure — focus on drainage and avoid injuring plants.',
        ],
        explanation: 'Heavy recent rain plus warm humid weather spreads this bacterium through standing water.',
      },
      {
        name: 'Brown Spot',
        keywords: ['brown spot', 'oval spot', 'sesame seed', 'small brown', 'dark spots on leaf'],
        favouredBy: { minHumidity: 80, minTempC: 20 },
        severity: 'MODERATE',
        actions: [
          'Look for small oval brown spots resembling sesame seeds scattered across leaves.',
          'Brown spot usually signals poor soil fertility — check potassium levels.',
          'Apply a balanced fertiliser; the crop is likely nutrient-stressed.',
        ],
        explanation: 'Brown spot appears on nutrient-deficient crops under humid conditions.',
      },
    ],
    pests: [
      STEM_BORER,
      {
        name: 'Brown Planthopper',
        keywords: ['hopper', 'planthopper', 'hopperburn', 'circular drying', 'brown patch in field', 'insects at base'],
        favouredBy: { minTempC: 25, minHumidity: 80 },
        severity: 'CRITICAL',
        actions: [
          'Part the canopy and look at the base of the plants just above water level.',
          'Circular patches of drying, browning plants ("hopperburn") mean the population is already damaging.',
          'Drain the field for 3–4 days — this alone reduces the population sharply.',
          'Widen plant spacing in future sowings to improve airflow.',
          'Avoid pyrethroid sprays; they kill natural predators and cause resurgence.',
        ],
        explanation: 'Dense canopy, standing water and warm humid air create ideal planthopper conditions.',
      },
      {
        name: 'Leaf Folder',
        keywords: ['leaf folder', 'folded leaf', 'rolled leaf', 'white streaks', 'scraped leaf'],
        favouredBy: { minHumidity: 75 },
        severity: 'MODERATE',
        actions: [
          'Look for leaves folded lengthwise and stuck together, with white scraped streaks inside.',
          'Rope a line across the crop to dislodge larvae.',
          'Damage below 10% of leaves rarely justifies spraying.',
        ],
        explanation: 'Humid weather with a dense canopy favours leaf folder.',
      },
    ],
  },

  {
    key: 'wheat',
    label: 'Wheat',
    commodity: 'Wheat',
    priceUnit: 'Rs/quintal',
    growingDays: 140,
    waterRequirementMm: 450,
    rootDepthM: 1.2,
    depletionFraction: 0.55,
    kc: kcCurve(1.15, 0.4, 0.4),
    seasons: ['rabi'],
    preferredSoils: ['LOAMY', 'CLAY', 'SILTY'],
    tempRangeC: { min: 10, max: 32 },
    frostSensitiveBelowC: -1,
    diseases: [
      {
        name: 'Yellow Rust',
        keywords: ['rust', 'yellow stripe', 'orange powder', 'yellow powder', 'stripes on leaf', 'powder on fingers'],
        favouredBy: { minHumidity: 70, minTempC: 8, maxTempC: 20 },
        severity: 'SEVERE',
        actions: [
          'Rub a leaf with your finger — yellow-orange powder that stains confirms rust.',
          'Look for stripes of pustules running parallel to the leaf veins.',
          'Rust spreads extremely fast in cool humid weather — act within days, not weeks.',
          'Propiconazole is the standard spray; confirm dose locally.',
          'Report to your extension office — rust outbreaks are tracked regionally.',
        ],
        explanation: 'Cool temperatures with high humidity are exactly the conditions yellow rust needs.',
      },
      {
        name: 'Powdery Mildew',
        keywords: ['powdery', 'white powder', 'white coating', 'flour on leaf', 'greyish white'],
        favouredBy: { minHumidity: 70, minTempC: 15, maxTempC: 22, maxRecentRainMm: 15 },
        severity: 'MODERATE',
        actions: [
          'Look for a white flour-like coating on the upper leaf surface.',
          'Improve airflow — mildew thrives in dense stands.',
          'Sulphur-based fungicide is effective and inexpensive.',
        ],
        explanation: 'Mild temperatures with humid air but little rain favour powdery mildew.',
      },
      {
        name: 'Karnal Bunt',
        keywords: ['bunt', 'black grain', 'fishy smell', 'rotten grain', 'foul smell'],
        favouredBy: { minHumidity: 70, minTempC: 18, maxTempC: 24 },
        severity: 'MODERATE',
        actions: [
          'Crush a few grains at the milk stage — a fishy smell indicates Karnal bunt.',
          'This affects grain quality and market grade rather than yield.',
          'Note affected areas; use certified clean seed next season.',
        ],
        explanation: 'Humid weather during the flowering window allows bunt infection.',
      },
    ],
    pests: [
      APHID,
      {
        name: 'Termites',
        keywords: ['termite', 'white ant', 'plants dying in patches', 'roots eaten', 'hollow roots'],
        favouredBy: { maxRecentRainMm: 10 },
        severity: 'MODERATE',
        actions: [
          'Pull a wilting plant — if the roots are eaten away and soil is packed around them, termites are likely.',
          'Irrigate; termite damage is much worse in dry soil.',
          'Remove undecomposed crop residue, which attracts them.',
        ],
        explanation: 'Dry soil conditions strongly favour termite attack on wheat.',
      },
    ],
  },

  {
    key: 'tomato',
    label: 'Tomato',
    commodity: 'Tomato',
    priceUnit: 'Rs/quintal',
    growingDays: 110,
    waterRequirementMm: 600,
    rootDepthM: 0.9,
    depletionFraction: 0.4,
    kc: kcCurve(1.15, 0.6, 0.8),
    seasons: ['kharif', 'rabi', 'zaid'],
    preferredSoils: ['LOAMY', 'SANDY', 'SILTY'],
    tempRangeC: { min: 15, max: 32 },
    frostSensitiveBelowC: 2,
    diseases: [
      {
        name: 'Late Blight',
        keywords: ['late blight', 'water soaked', 'dark patch', 'white fuzz', 'rotting fruit', 'black stem', 'rapid wilting', 'greasy spot'],
        favouredBy: { minHumidity: 85, minTempC: 10, maxTempC: 24, minRecentRainMm: 20, minWetDays: 2 },
        severity: 'CRITICAL',
        actions: [
          'Look for dark water-soaked patches on leaves, often with white fuzzy growth on the underside in the morning.',
          'Late blight can destroy an entire crop in under a week — treat this as urgent.',
          'Remove and destroy affected plants immediately. Do not compost them.',
          'Stop overhead irrigation; water at the base only.',
          'Apply mancozeb or a copper-based fungicide without delay.',
        ],
        explanation: 'Cool wet weather with prolonged leaf wetness is the precise trigger for late blight — the same disease that caused the Irish potato famine.',
      },
      {
        name: 'Early Blight',
        keywords: ['early blight', 'target', 'concentric ring', 'bullseye', 'brown spot lower leaves', 'yellowing bottom'],
        favouredBy: { minHumidity: 75, minTempC: 24, minRecentRainMm: 10 },
        severity: 'MODERATE',
        actions: [
          'Look for brown spots with concentric rings, like a target, starting on the oldest lower leaves.',
          'Remove affected lower leaves and destroy them.',
          'Mulch around the base — the fungus splashes up from the soil.',
          'Apply mancozeb if it is spreading upward.',
        ],
        explanation: 'Warm humid weather after rain favours early blight, which starts low and moves up.',
      },
      {
        name: 'Leaf Curl Virus',
        keywords: ['curl', 'curled leaf', 'stunted', 'small leaves', 'crinkled', 'upward curling', 'bushy'],
        favouredBy: { minTempC: 25, maxRecentRainMm: 20 },
        severity: 'SEVERE',
        actions: [
          'Look for upward-curling, crinkled, undersized leaves and stunted bushy growth.',
          'There is no cure — remove and destroy infected plants to protect the rest.',
          'This virus is spread by whitefly. Control whitefly to stop it spreading.',
          'Use yellow sticky traps and consider a barrier crop next season.',
        ],
        explanation: 'Hot dry conditions favour the whitefly that transmits this virus.',
      },
      {
        name: 'Blossom End Rot',
        keywords: ['blossom end', 'black bottom', 'sunken bottom', 'rot at base of fruit', 'leathery patch'],
        favouredBy: { maxRecentRainMm: 15 },
        severity: 'MILD',
        actions: [
          'Look for a dark sunken leathery patch at the blossom (bottom) end of the fruit.',
          'This is a calcium uptake problem caused by irregular watering, not a disease.',
          'Water consistently rather than heavily and infrequently — this is the main fix.',
          'Mulch to keep soil moisture even.',
        ],
        explanation: 'Irregular soil moisture prevents calcium reaching the developing fruit.',
      },
    ],
    pests: [
      WHITEFLY,
      APHID,
      {
        name: 'Fruit Borer',
        keywords: ['fruit borer', 'hole in fruit', 'caterpillar', 'worm in fruit', 'boring', 'helicoverpa'],
        favouredBy: { minTempC: 20 },
        severity: 'SEVERE',
        actions: [
          'Look for round holes in fruit, often with frass (droppings) around the entry point.',
          'Hand-pick and destroy affected fruit — this is highly effective in small plots.',
          'Install pheromone traps, 5 per acre.',
          'Spray Bt (Bacillus thuringiensis) — safe and effective against young larvae.',
        ],
        explanation: 'Warm weather during fruiting allows continuous borer generations.',
      },
    ],
  },

  {
    key: 'cotton',
    label: 'Cotton',
    commodity: 'Cotton',
    priceUnit: 'Rs/quintal',
    growingDays: 180,
    waterRequirementMm: 800,
    rootDepthM: 1.3,
    depletionFraction: 0.65,
    kc: kcCurve(1.15, 0.35, 0.6),
    seasons: ['kharif'],
    preferredSoils: ['CLAY', 'LOAMY', 'MIXED'],
    tempRangeC: { min: 18, max: 40 },
    frostSensitiveBelowC: 5,
    diseases: [
      {
        name: 'Bacterial Blight',
        keywords: ['angular spot', 'black arm', 'water soaked', 'blight', 'angular lesion'],
        favouredBy: { minHumidity: 80, minTempC: 25, minRecentRainMm: 30 },
        severity: 'SEVERE',
        actions: [
          'Look for angular water-soaked spots bounded by leaf veins, turning black.',
          'Black lesions on the stem ("black arm") indicate advanced infection.',
          'Remove crop debris; the bacterium survives on it.',
          'Avoid working in the field when foliage is wet — this spreads it.',
        ],
        explanation: 'Warm wet weather spreads this bacterium rapidly through rain splash.',
      },
      {
        name: 'Verticillium Wilt',
        keywords: ['wilt', 'yellowing between veins', 'one sided wilt', 'brown vascular', 'drying leaves'],
        favouredBy: { maxTempC: 28 },
        severity: 'SEVERE',
        actions: [
          'Cut a wilting stem lengthwise — brown streaking inside confirms vascular wilt.',
          'Often affects one side of the plant first.',
          'No chemical cure. Plan a 2–3 year rotation with a non-host crop.',
        ],
        explanation: 'Soil-borne fungus active in moderate temperatures.',
      },
    ],
    pests: [
      WHITEFLY,
      APHID,
      {
        name: 'Pink Bollworm',
        keywords: ['bollworm', 'pink worm', 'rosette flower', 'damaged boll', 'holes in boll', 'stained lint'],
        favouredBy: { minTempC: 25 },
        severity: 'CRITICAL',
        actions: [
          'Open 20 green bolls at random and check inside for pink larvae.',
          'Look for "rosette" flowers — petals twisted shut — a classic early sign.',
          'Install pheromone traps immediately, 8–10 per acre.',
          'Destroy affected bolls. Do not extend the crop season — this breaks the pest cycle.',
          'Report to your extension office; pink bollworm is regionally monitored.',
        ],
        explanation: 'Warm conditions during boll formation allow rapid pink bollworm build-up.',
      },
    ],
  },

  {
    key: 'maize',
    label: 'Maize',
    commodity: 'Maize',
    priceUnit: 'Rs/quintal',
    growingDays: 110,
    waterRequirementMm: 550,
    rootDepthM: 1.0,
    depletionFraction: 0.55,
    kc: kcCurve(1.2, 0.4, 0.6),
    seasons: ['kharif', 'rabi'],
    preferredSoils: ['LOAMY', 'SANDY', 'SILTY'],
    tempRangeC: { min: 15, max: 35 },
    frostSensitiveBelowC: 2,
    diseases: [
      {
        name: 'Turcicum Leaf Blight',
        keywords: ['blight', 'cigar shaped', 'long lesion', 'grey green lesion', 'boat shaped'],
        favouredBy: { minHumidity: 80, minTempC: 18, maxTempC: 27, minRecentRainMm: 20 },
        severity: 'MODERATE',
        actions: [
          'Look for long cigar or boat-shaped grey-green lesions on the leaves.',
          'Lower leaves are affected first.',
          'Mancozeb spray is effective if applied before the lesions reach the top leaves.',
        ],
        explanation: 'Moderate temperatures with high humidity after rain favour this blight.',
      },
    ],
    pests: [
      STEM_BORER,
      {
        name: 'Fall Armyworm',
        keywords: ['armyworm', 'ragged leaf', 'window pane', 'frass', 'sawdust in whorl', 'holes in whorl', 'inverted y'],
        favouredBy: { minTempC: 20 },
        severity: 'CRITICAL',
        actions: [
          'Look into the whorl for sawdust-like frass and ragged holes.',
          'An inverted Y-shaped mark on the head capsule identifies fall armyworm.',
          'Hand-pick larvae from the whorl in small plots — very effective.',
          'Apply sand or ash into the whorl as a low-cost control.',
          'Fall armyworm can cause total loss on young maize — act immediately.',
        ],
        explanation: 'Warm conditions allow fall armyworm to complete generations quickly.',
      },
    ],
  },

  {
    key: 'potato',
    label: 'Potato',
    commodity: 'Potato',
    priceUnit: 'Rs/quintal',
    growingDays: 100,
    waterRequirementMm: 500,
    rootDepthM: 0.6,
    depletionFraction: 0.3,
    kc: kcCurve(1.15, 0.5, 0.75),
    seasons: ['rabi'],
    preferredSoils: ['LOAMY', 'SANDY'],
    tempRangeC: { min: 10, max: 30 },
    frostSensitiveBelowC: 1,
    diseases: [
      {
        name: 'Late Blight',
        keywords: ['late blight', 'water soaked', 'white fuzz', 'dark patch', 'rotting tuber', 'black stem', 'foul smell'],
        favouredBy: { minHumidity: 85, minTempC: 10, maxTempC: 24, minRecentRainMm: 20, minWetDays: 2 },
        severity: 'CRITICAL',
        actions: [
          'Look for dark water-soaked patches with white fuzzy growth on the leaf underside.',
          'This is the most destructive potato disease — it can flatten a field in a week.',
          'Spray mancozeb or a copper fungicide immediately.',
          'Earth up the ridges well so spores cannot reach the tubers.',
          'Do not irrigate overhead while the disease is active.',
        ],
        explanation: 'Cool humid weather with wet foliage is the exact trigger for late blight.',
      },
      {
        name: 'Early Blight',
        keywords: ['early blight', 'target spot', 'concentric ring', 'brown spot lower leaves'],
        favouredBy: { minTempC: 24, minHumidity: 70 },
        severity: 'MODERATE',
        actions: [
          'Look for target-like concentric rings on older lower leaves.',
          'Usually less damaging than late blight, but reduces tuber size.',
          'Apply mancozeb if spreading.',
        ],
        explanation: 'Warm humid weather favours early blight on ageing foliage.',
      },
    ],
    pests: [
      APHID,
      {
        name: 'Potato Tuber Moth',
        keywords: ['tuber moth', 'mines in leaf', 'tunnels in tuber', 'silken', 'larvae in tuber'],
        favouredBy: { minTempC: 20, maxRecentRainMm: 15 },
        severity: 'SEVERE',
        actions: [
          'Look for winding mines in the leaves and tunnels in exposed tubers.',
          'Earth up thoroughly — exposed tubers are how the moth gets in.',
          'Never leave harvested tubers in the field overnight.',
        ],
        explanation: 'Warm dry conditions with exposed tubers favour this moth.',
      },
    ],
  },

  {
    key: 'sugarcane',
    label: 'Sugarcane',
    commodity: 'Sugarcane',
    priceUnit: 'Rs/quintal',
    growingDays: 330,
    waterRequirementMm: 1800,
    rootDepthM: 1.5,
    depletionFraction: 0.65,
    kc: kcCurve(1.25, 0.4, 0.75),
    seasons: ['kharif', 'rabi'],
    preferredSoils: ['LOAMY', 'CLAY', 'SILTY'],
    tempRangeC: { min: 20, max: 38 },
    frostSensitiveBelowC: 5,
    diseases: [
      {
        name: 'Red Rot',
        keywords: ['red rot', 'red inside', 'white patches', 'alcoholic smell', 'sour smell', 'drying cane'],
        favouredBy: { minHumidity: 75, minTempC: 25, minRecentRainMm: 30 },
        severity: 'CRITICAL',
        actions: [
          'Split an affected cane lengthwise — red discoloration with white cross-patches confirms red rot.',
          'A sour alcoholic smell is a strong indicator.',
          'Remove and burn affected clumps; do not use them as seed cane.',
          'Red rot can wipe out a susceptible variety — plan to switch variety next season.',
        ],
        explanation: 'Warm humid conditions after heavy rain favour red rot spread.',
      },
    ],
    pests: [STEM_BORER],
  },

  {
    key: 'soybean',
    label: 'Soybean',
    commodity: 'Soyabean',
    priceUnit: 'Rs/quintal',
    growingDays: 100,
    waterRequirementMm: 500,
    rootDepthM: 0.9,
    depletionFraction: 0.5,
    kc: kcCurve(1.15, 0.4, 0.5),
    seasons: ['kharif'],
    preferredSoils: ['LOAMY', 'CLAY', 'MIXED'],
    tempRangeC: { min: 18, max: 35 },
    frostSensitiveBelowC: 2,
    diseases: [
      {
        name: 'Yellow Mosaic Virus',
        keywords: ['mosaic', 'yellow patches', 'mottled', 'yellow green mixed', 'stunted'],
        favouredBy: { minTempC: 25 },
        severity: 'SEVERE',
        actions: [
          'Look for bright yellow mottled patches mixed with green on the leaves.',
          'No cure — remove infected plants to reduce the source.',
          'Spread by whitefly; controlling whitefly is the only real defence.',
        ],
        explanation: 'Warm weather favours the whitefly vector of this virus.',
      },
      {
        name: 'Rust',
        keywords: ['rust', 'brown pustule', 'reddish brown', 'powder on leaf underside'],
        favouredBy: { minHumidity: 80, minTempC: 18, maxTempC: 28, minRecentRainMm: 25 },
        severity: 'SEVERE',
        actions: [
          'Look for small reddish-brown pustules on the underside of leaves.',
          'Rust spreads fast in wet weather — check every 2–3 days.',
          'Apply a triazole fungicide at first sign.',
        ],
        explanation: 'Extended humid periods with moderate temperatures favour soybean rust.',
      },
    ],
    pests: [WHITEFLY, APHID],
  },

  {
    key: 'onion',
    label: 'Onion',
    commodity: 'Onion',
    priceUnit: 'Rs/quintal',
    growingDays: 130,
    waterRequirementMm: 450,
    rootDepthM: 0.4,
    depletionFraction: 0.3,
    kc: kcCurve(1.05, 0.7, 0.75),
    seasons: ['rabi', 'kharif'],
    preferredSoils: ['LOAMY', 'SANDY', 'SILTY'],
    tempRangeC: { min: 13, max: 32 },
    frostSensitiveBelowC: 0,
    diseases: [
      {
        name: 'Purple Blotch',
        keywords: ['purple', 'blotch', 'purple lesion', 'concentric', 'drying tips'],
        favouredBy: { minHumidity: 80, minTempC: 21, minRecentRainMm: 15 },
        severity: 'MODERATE',
        actions: [
          'Look for small white sunken spots that enlarge into purple blotches with concentric rings.',
          'Mancozeb spray with a sticker is effective — onion leaves shed water readily.',
          'Avoid overhead irrigation late in the day.',
        ],
        explanation: 'Warm humid conditions with leaf wetness favour purple blotch.',
      },
      {
        name: 'Downy Mildew',
        keywords: ['downy', 'violet growth', 'pale patches', 'fuzzy growth', 'collapsing leaves'],
        favouredBy: { minHumidity: 90, maxTempC: 22 },
        severity: 'SEVERE',
        actions: [
          'Look for pale oval patches with a violet fuzzy growth in humid mornings.',
          'Leaves collapse as the disease advances.',
          'Improve drainage and airflow; apply metalaxyl-based fungicide.',
        ],
        explanation: 'Cool very humid conditions are ideal for downy mildew.',
      },
    ],
    pests: [
      {
        name: 'Thrips',
        keywords: ['thrips', 'silver streaks', 'white streaks', 'curled tips', 'distorted leaves', 'tiny insects'],
        favouredBy: { minTempC: 25, maxRecentRainMm: 10 },
        severity: 'SEVERE',
        actions: [
          'Look for silvery-white streaks on leaves and tiny slender insects in the leaf axils.',
          'Thrips are the main yield-limiting pest of onion in dry weather.',
          'Blue sticky traps help monitor the population.',
          'Spray neem oil or fipronil; add a wetting agent so it sticks to the waxy leaves.',
        ],
        explanation: 'Hot dry weather causes thrips populations to explode on onion.',
      },
    ],
  },

  {
    key: 'chickpea',
    label: 'Chickpea (Gram)',
    commodity: 'Bengal Gram(Gram)',
    priceUnit: 'Rs/quintal',
    growingDays: 110,
    waterRequirementMm: 350,
    rootDepthM: 1.0,
    depletionFraction: 0.5,
    kc: kcCurve(1.0, 0.4, 0.35),
    seasons: ['rabi'],
    preferredSoils: ['LOAMY', 'CLAY', 'SANDY'],
    tempRangeC: { min: 10, max: 30 },
    frostSensitiveBelowC: 0,
    diseases: [
      {
        name: 'Wilt',
        keywords: ['wilt', 'drooping', 'yellowing whole plant', 'sudden death', 'brown roots', 'dying plants'],
        favouredBy: { minTempC: 25, maxRecentRainMm: 15 },
        severity: 'SEVERE',
        actions: [
          'Pull a wilting plant and split the root — internal browning confirms Fusarium wilt.',
          'Plants often die in patches that expand over time.',
          'No cure once infected. Rotate away from chickpea for 3 years in affected areas.',
          'Use a wilt-resistant variety next season.',
        ],
        explanation: 'Warm dry soil conditions favour Fusarium wilt in chickpea.',
      },
      {
        name: 'Ascochyta Blight',
        keywords: ['blight', 'brown lesion', 'concentric', 'dark spots on pods', 'stem lesion', 'breaking stem'],
        favouredBy: { minHumidity: 80, minTempC: 15, maxTempC: 25, minRecentRainMm: 20 },
        severity: 'SEVERE',
        actions: [
          'Look for brown lesions with dark concentric dots on leaves, stems and pods.',
          'Stems may snap where lesions girdle them.',
          'Spreads very fast in cool wet weather — inspect every 2 days.',
          'Apply chlorothalonil or mancozeb.',
        ],
        explanation: 'Cool wet weather is the classic trigger for Ascochyta blight.',
      },
    ],
    pests: [
      {
        name: 'Pod Borer',
        keywords: ['pod borer', 'hole in pod', 'caterpillar', 'helicoverpa', 'eaten seeds', 'worm'],
        favouredBy: { minTempC: 20 },
        severity: 'SEVERE',
        actions: [
          'Look for round holes in pods with the larva often half inside.',
          'Install pheromone traps, 5 per acre, at flowering.',
          'Place bird perches across the field — birds are highly effective against pod borer.',
          'Spray Bt or NPV at the early larval stage.',
        ],
        explanation: 'Warm weather during podding allows continuous pod borer activity.',
      },
    ],
  },

  {
    key: 'mustard',
    label: 'Mustard',
    commodity: 'Mustard',
    priceUnit: 'Rs/quintal',
    growingDays: 120,
    waterRequirementMm: 350,
    rootDepthM: 1.0,
    depletionFraction: 0.55,
    kc: kcCurve(1.1, 0.4, 0.4),
    seasons: ['rabi'],
    preferredSoils: ['LOAMY', 'SANDY', 'MIXED'],
    tempRangeC: { min: 10, max: 30 },
    frostSensitiveBelowC: -2,
    diseases: [
      {
        name: 'White Rust',
        keywords: ['white rust', 'white pustule', 'white blister', 'swollen stem', 'deformed flower'],
        favouredBy: { minHumidity: 85, minTempC: 10, maxTempC: 20 },
        severity: 'MODERATE',
        actions: [
          'Look for raised white blister-like pustules on the leaf underside.',
          'Deformed swollen flower stalks ("stagheads") indicate systemic infection.',
          'Remove stagheads; apply metalaxyl if widespread.',
        ],
        explanation: 'Cool humid weather favours white rust in mustard.',
      },
      {
        name: 'Alternaria Blight',
        keywords: ['blight', 'dark spot', 'concentric ring', 'grey spot', 'spots on pods'],
        favouredBy: { minHumidity: 70, minTempC: 18, maxTempC: 28, minRecentRainMm: 15 },
        severity: 'MODERATE',
        actions: [
          'Look for dark brown spots with concentric rings on leaves and pods.',
          'Pod infection directly reduces seed yield.',
          'Apply mancozeb at first appearance.',
        ],
        explanation: 'Humid conditions with moderate warmth favour Alternaria.',
      },
    ],
    pests: [
      {
        name: 'Mustard Aphid',
        keywords: ['aphid', 'sticky', 'curling', 'grey insects', 'covered stem', 'clusters on pods'],
        favouredBy: { minTempC: 10, maxTempC: 25, maxRecentRainMm: 10 },
        severity: 'SEVERE',
        actions: [
          'Look for dense grey-green clusters covering the flowering shoots and pods.',
          'Mustard aphid is the single biggest yield threat to this crop.',
          'Spray at first appearance — populations double every few days.',
          'Neem oil works on light infestations; heavier ones need dimethoate.',
        ],
        explanation: 'Cool dry weather during flowering causes mustard aphid to build explosively.',
      },
    ],
  },

  {
    key: 'groundnut',
    label: 'Groundnut',
    commodity: 'Groundnut',
    priceUnit: 'Rs/quintal',
    growingDays: 120,
    waterRequirementMm: 550,
    rootDepthM: 0.8,
    depletionFraction: 0.5,
    kc: kcCurve(1.15, 0.4, 0.6),
    seasons: ['kharif', 'zaid'],
    preferredSoils: ['SANDY', 'LOAMY'],
    tempRangeC: { min: 20, max: 35 },
    frostSensitiveBelowC: 4,
    diseases: [
      {
        name: 'Tikka Leaf Spot',
        keywords: ['leaf spot', 'tikka', 'dark spot', 'yellow halo', 'defoliation', 'falling leaves'],
        favouredBy: { minHumidity: 80, minTempC: 22, minRecentRainMm: 20 },
        severity: 'MODERATE',
        actions: [
          'Look for dark circular spots with a yellow halo, causing leaves to drop.',
          'Heavy defoliation directly cuts pod yield.',
          'Apply mancozeb or carbendazim at first sign.',
        ],
        explanation: 'Warm humid weather after rain favours tikka leaf spot.',
      },
    ],
    pests: [APHID],
  },
];

// ─────────────────────────── Lookups ───────────────────────────

const BY_KEY = new Map(CROPS.map((c) => [c.key, c]));

/** Aliases so farmer-entered names resolve to the right profile. */
const ALIASES: Record<string, string> = {
  paddy: 'rice',
  dhan: 'rice',
  paddyrice: 'rice',
  gehu: 'wheat',
  gehun: 'wheat',
  paddyfield: 'rice',
  tamatar: 'tomato',
  tomatoes: 'tomato',
  kapas: 'cotton',
  makka: 'maize',
  corn: 'maize',
  aloo: 'potato',
  potatoes: 'potato',
  ganna: 'sugarcane',
  sugar_cane: 'sugarcane',
  soyabean: 'soybean',
  soya: 'soybean',
  pyaz: 'onion',
  onions: 'onion',
  gram: 'chickpea',
  chana: 'chickpea',
  bengalgram: 'chickpea',
  sarson: 'mustard',
  rapeseed: 'mustard',
  moongphali: 'groundnut',
  peanut: 'groundnut',
  peanuts: 'groundnut',
};

function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Resolve a farmer-entered crop name to a profile.
 * Returns null for unsupported crops — callers must handle this and fall back
 * to generic guidance rather than guessing.
 */
export function findCrop(name: string | null | undefined): CropProfile | null {
  if (!name) return null;
  const n = normalise(name);

  const direct = BY_KEY.get(n);
  if (direct) return direct;

  const aliased = ALIASES[n];
  if (aliased) return BY_KEY.get(aliased) ?? null;

  // Last resort: substring match, so "hybrid tomato" or "bt cotton" still resolve.
  for (const crop of CROPS) {
    if (n.includes(crop.key)) return crop;
  }
  return null;
}

/** Every crop name the system has real agronomic data for. */
export function supportedCrops(): Array<{ key: string; label: string }> {
  return CROPS.map((c) => ({ key: c.key, label: c.label }));
}

/**
 * Generic fallback used when a farmer grows something outside the knowledge base.
 * Deliberately conservative — moderate water use, no disease claims.
 */
export const GENERIC_CROP: CropProfile = {
  key: 'generic',
  label: 'Other crop',
  commodity: '',
  priceUnit: 'Rs/quintal',
  growingDays: 120,
  waterRequirementMm: 500,
  rootDepthM: 0.8,
  depletionFraction: 0.5,
  kc: kcCurve(1.0, 0.4, 0.6),
  seasons: ['kharif', 'rabi', 'zaid'],
  preferredSoils: ['LOAMY', 'SANDY', 'CLAY', 'SILTY', 'MIXED'],
  tempRangeC: { min: 15, max: 35 },
  frostSensitiveBelowC: 2,
  diseases: [],
  pests: [],
};

/** Resolve with a guaranteed result. `isKnown` tells the caller which they got. */
export function resolveCrop(name: string | null | undefined): {
  crop: CropProfile;
  isKnown: boolean;
} {
  const found = findCrop(name);
  return found ? { crop: found, isKnown: true } : { crop: GENERIC_CROP, isKnown: false };
}

/**
 * Plant-available water in millimetres per metre of soil depth, by soil type.
 * Midpoints of the standard FAO-56 Table 19 ranges.
 */
export const SOIL_AVAILABLE_WATER_MM_PER_M: Record<SoilType, number> = {
  SANDY: 70,
  LOAMY: 140,
  CLAY: 180,
  SILTY: 160,
  PEATY: 200,
  CHALKY: 90,
  MIXED: 140,
};

/** Current Indian cropping season for a given date. */
export function currentSeason(date = new Date()): 'kharif' | 'rabi' | 'zaid' {
  const m = date.getMonth() + 1; // 1-12
  if (m >= 6 && m <= 10) return 'kharif'; // monsoon sowing
  if (m >= 11 || m <= 3) return 'rabi'; // winter sowing
  return 'zaid'; // Apr-May summer crops
}
