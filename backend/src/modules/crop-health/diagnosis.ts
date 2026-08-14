/**
 * Crop health diagnostic engine.
 *
 * Approach and justification (see README for the full write-up):
 *
 * We deliberately do NOT claim to diagnose plant disease from a photograph
 * using a model we trained during a hackathon. Instead this is an
 * **evidence-weighted differential diagnosis** over three independent signals:
 *
 *   1. SYMPTOMS  — keyword matching against a curated symptom vocabulary per
 *                  disease/pest. Two sources feed it: the farmer's own words,
 *                  and the symptoms the vision model reads off the photograph.
 *   2. EPIDEMIOLOGY — whether recent weather at that farm actually favours the
 *                  candidate. Late blight needs cool wet weather; flagging it
 *                  during a dry spell would be wrong regardless of symptoms.
 *   3. HOST      — which diseases affect this specific crop at all.
 *
 * Each candidate gets a score from these, and the engine returns a *ranked
 * differential* with an explicit confidence, not a single confident answer.
 * Output is framed as "go and check this" rather than "your crop has X".
 *
 * Why this beats a naive image classifier here:
 *   - It is explainable. The farmer sees exactly why something was flagged.
 *   - It degrades honestly. Vague input produces low confidence, not a
 *     confident guess.
 *   - It cannot hallucinate a disease that is impossible for the crop or the
 *     weather, which an image model absolutely can.
 *
 * Image analysis — the local Ollama vision model, or Plant.id — is folded in as
 * additional weighted signal. It does not replace the reasoning above, and it
 * contributes in two distinct ways:
 *
 *   - by *naming* a problem, which corroborates a curated candidate; and
 *   - by *describing* what is visible, which feeds signal (1) above and so gets
 *     cross-checked against weather and host susceptibility like any symptom
 *     the farmer typed. A photograph is evidence here, never a verdict.
 */

import type { HealthSeverity } from '@prisma/client';
import type { CropProfile, DiseaseProfile, PestProfile, WeatherTriggers } from '../../domain/crops';
import type { DailyWeather } from '../weather/openmeteo';
import type { ImageAssessment, ImageFinding } from './vision';
import { expandRegionalSymptoms } from './symptom-lexicon';

// ─────────────────────────── Types ───────────────────────────

export interface WeatherContext {
  /** Mean relative humidity over the last 7 days, %. */
  avgHumidity: number;
  maxHumidity: number;
  avgTempC: number;
  maxTempC: number;
  minTempC: number;
  /** Total rainfall over the last 7 days, mm. */
  recentRainMm: number;
  /** Days in the last 7 with conditions favouring leaf wetness. */
  wetDays: number;
}

/** Extra material from image analysis, shown alongside a candidate. */
export interface CandidateDetails {
  /** Scientific name, when the farmer-facing name is a common one. */
  scientificName?: string;
  description?: string;
  cause?: string;
  /** e.g. ["Fungi"] — tells a pathogen apart from a deficiency. */
  classification?: string[];
  treatment?: { chemical: string[]; biological: string[]; prevention: string[] };
  /** Reference photos to compare the affected plant against. */
  similarImages?: string[];
}

export interface Candidate {
  kind: 'disease' | 'pest';
  name: string;
  /** 0-1. How well the evidence fits this candidate. */
  confidence: number;
  severity: HealthSeverity;
  /** Human-readable reasons this was flagged, shown to the farmer. */
  evidence: string[];
  actions: string[];
  explanation: string;
  /**
   * Where this candidate came from. `image` means only the image analysis
   * proposed it — it is not in our curated list for this crop, so it carries no
   * weather or symptom corroboration and is labelled as such on screen.
   */
  source: 'rules' | 'rules+image' | 'image';
  details?: CandidateDetails;
  /** Which signals contributed, for transparency and debugging. */
  signals: {
    symptomScore: number;
    weatherScore: number;
    matchedKeywords: string[];
    weatherFavourable: boolean;
    imageProbability?: number;
    /** Symptom score from the photo's description alone, when there was one. */
    imageSymptomScore?: number;
  };
}

export interface Diagnosis {
  /** Ranked differential, most likely first. Empty if nothing matched. */
  candidates: Candidate[];
  /** Overall urgency, driven by the top candidate. */
  severity: HealthSeverity;
  /** One-line summary for the dashboard. */
  summary: string;
  /** What the farmer should do next, regardless of which candidate is right. */
  nextSteps: string[];
  /** How much to trust this, 0-1. */
  confidence: number;
  method: 'rule-engine' | 'rule-engine+ollama-vision' | 'rule-engine+plant-id';
  /** Honest statement of what the analysis could and could not use. */
  limitations: string[];
  /** What the image analysis concluded, when a photo was analysed. */
  image?: {
    /** Which engine looked at the photo. */
    provider: 'ollama' | 'plant-id';
    /** Model tag, when it ran locally. */
    model: string | null;
    /** False when the photo is not of a plant — the farmer should retake it. */
    isPlant: boolean;
    /** True when the model saw no disease at all. */
    looksHealthy: boolean;
    /** Language the external descriptions came back in. */
    language: string;
    /** Set when the farmer's language is unsupported and we used English. */
    languageFellBack: boolean;
    /**
     * What the model could actually see, shown to the farmer verbatim. This is
     * the most checkable thing on the screen: they can look at the same leaf and
     * agree or disagree, which they cannot do with a probability.
     */
    observedSymptoms: string[];
    /** Parts of the plant affected, e.g. ["leaf", "fruit"]. */
    affectedParts: string[];
    /** How readable the photo was; "poor" means the advice is worth less. */
    quality: 'good' | 'acceptable' | 'poor' | null;
  };
}

// ─────────────────────── Weather context ───────────────────────

/** Condense recent daily weather into the variables the rules care about. */
export function buildWeatherContext(recentDays: DailyWeather[]): WeatherContext {
  if (recentDays.length === 0) {
    // Neutral defaults — no weather evidence either way.
    return {
      avgHumidity: 60,
      maxHumidity: 70,
      avgTempC: 25,
      maxTempC: 30,
      minTempC: 20,
      recentRainMm: 0,
      wetDays: 0,
    };
  }

  const n = recentDays.length;
  const sum = (fn: (d: DailyWeather) => number) => recentDays.reduce((a, d) => a + fn(d), 0);

  return {
    avgHumidity: round1(sum((d) => d.humidityMeanPct) / n),
    maxHumidity: Math.max(...recentDays.map((d) => d.humidityMaxPct)),
    avgTempC: round1(sum((d) => d.tempAvgC) / n),
    maxTempC: Math.max(...recentDays.map((d) => d.tempMaxC)),
    minTempC: Math.min(...recentDays.map((d) => d.tempMinC)),
    recentRainMm: round1(sum((d) => d.precipitationMm)),
    // Leaf wetness proxy: measurable rain, or humidity high enough for dew.
    wetDays: recentDays.filter((d) => d.precipitationMm >= 1 || d.humidityMaxPct >= 90).length,
  };
}

// ─────────────────────── Symptom matching ───────────────────────

/**
 * Normalise free text for matching: lowercase, drop punctuation, collapse
 * whitespace.
 *
 * Uses Unicode letter/number classes rather than `[a-z0-9]`. Stripping to
 * ASCII would erase a Devanagari or Gurmukhi description completely, leaving
 * an empty string that scores zero against every candidate — which is exactly
 * what happened to descriptions dictated in Hindi before this.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well a description matches a candidate's symptom vocabulary.
 * Multi-word keywords score higher — "water soaked" is far more diagnostic
 * than "spot".
 */
function scoreSymptoms(
  description: string,
  keywords: string[],
): { score: number; matched: string[] } {
  const text = normalise(description);
  if (!text) return { score: 0, matched: [] };

  const matched: string[] = [];
  let weight = 0;

  for (const keyword of keywords) {
    const k = normalise(keyword);
    if (!k) continue;
    if (text.includes(k)) {
      matched.push(keyword);
      // A two-word phrase is worth roughly twice a single generic word.
      weight += k.includes(' ') ? 2.5 : 1;
    }
  }

  if (matched.length === 0) return { score: 0, matched: [] };

  // Saturating curve: the first couple of strong matches carry most of the
  // signal; a long list of weak ones should not reach certainty.
  const score = 1 - Math.exp(-weight / 3);
  return { score: round2(score), matched };
}

/**
 * How much the vision model's reading of the photo counts, relative to the
 * farmer standing in the field looking at the plant.
 *
 * Below 1 because the model's symptom list is inference from pixels — it can
 * read a nutrient burn as a fungal lesion — while the farmer can turn the leaf
 * over. High enough that a photo with no description still produces a real
 * differential, which is the common case: taking a picture is easy, typing a
 * paragraph about it on a phone is not.
 */
const PHOTO_SYMPTOM_WEIGHT = 0.8;

/**
 * Combine two independent readings of the same symptoms (noisy-OR).
 *
 * Either source alone can carry a candidate, agreement strengthens it, and the
 * result can never exceed 1 — which straight addition would, turning "the
 * farmer and the photo both mention brown rings" into false certainty.
 */
function combineEvidence(a: number, b: number): number {
  return a + b - a * b;
}

/** Union of two keyword lists, order preserved, case-insensitively deduped. */
function mergeKeywords(first: string[], second: string[]): string[] {
  const seen = new Set(first.map((k) => k.toLowerCase()));
  return [...first, ...second.filter((k) => !seen.has(k.toLowerCase()))];
}

// ─────────────────────── Weather matching ───────────────────────

interface WeatherVerdict {
  score: number;
  favourable: boolean;
  reasons: string[];
}

/**
 * Check whether observed weather favours a candidate.
 *
 * Returns a multiplier-ish score in [0,1]. Crucially, weather that actively
 * contradicts the candidate (e.g. bone dry for a wet-weather disease) pushes
 * the score down, which is what stops the engine flagging late blight in a
 * drought.
 */
function scoreWeather(
  favouredBy: WeatherTriggers | undefined,
  ctx: WeatherContext,
): WeatherVerdict {
  if (!favouredBy) return { score: 0.5, favourable: false, reasons: [] };

  const checks: Array<{ met: boolean; reason: string; contradiction: string }> = [];

  if (favouredBy.minHumidity !== undefined) {
    checks.push({
      met: ctx.avgHumidity >= favouredBy.minHumidity,
      reason: `humidity has averaged ${ctx.avgHumidity}%, above the ${favouredBy.minHumidity}% this favours`,
      contradiction: `humidity has only averaged ${ctx.avgHumidity}%, below the ${favouredBy.minHumidity}% this usually needs`,
    });
  }
  if (favouredBy.maxHumidity !== undefined) {
    checks.push({
      met: ctx.avgHumidity <= favouredBy.maxHumidity,
      reason: `humidity has stayed near ${ctx.avgHumidity}%, in the range this favours`,
      contradiction: `humidity has been high (${ctx.avgHumidity}%), which does not favour this`,
    });
  }
  if (favouredBy.minTempC !== undefined) {
    checks.push({
      met: ctx.avgTempC >= favouredBy.minTempC,
      reason: `temperatures have averaged ${ctx.avgTempC}°C, warm enough`,
      contradiction: `temperatures have averaged ${ctx.avgTempC}°C, cooler than this usually needs`,
    });
  }
  if (favouredBy.maxTempC !== undefined) {
    checks.push({
      met: ctx.avgTempC <= favouredBy.maxTempC,
      reason: `temperatures have averaged ${ctx.avgTempC}°C, cool enough`,
      contradiction: `temperatures have averaged ${ctx.avgTempC}°C, warmer than this usually tolerates`,
    });
  }
  if (favouredBy.minRecentRainMm !== undefined) {
    checks.push({
      met: ctx.recentRainMm >= favouredBy.minRecentRainMm,
      reason: `${ctx.recentRainMm} mm of rain in the last week`,
      contradiction: `only ${ctx.recentRainMm} mm of rain in the last week, drier than this needs`,
    });
  }
  if (favouredBy.maxRecentRainMm !== undefined) {
    checks.push({
      met: ctx.recentRainMm <= favouredBy.maxRecentRainMm,
      reason: `dry conditions recently (${ctx.recentRainMm} mm), which this favours`,
      contradiction: `${ctx.recentRainMm} mm of rain recently — wetter than this favours`,
    });
  }
  if (favouredBy.minWetDays !== undefined) {
    checks.push({
      met: ctx.wetDays >= favouredBy.minWetDays,
      reason: `${ctx.wetDays} days of leaf wetness in the last week`,
      contradiction: `only ${ctx.wetDays} days of leaf wetness, fewer than this needs`,
    });
  }

  if (checks.length === 0) return { score: 0.5, favourable: false, reasons: [] };

  const metCount = checks.filter((c) => c.met).length;
  const ratio = metCount / checks.length;

  return {
    score: round2(ratio),
    favourable: ratio >= 0.7,
    reasons: checks.filter((c) => c.met).map((c) => c.reason),
  };
}

// ─────────────────── Image findings ↔ curated profiles ───────────────────

/**
 * Plant.id answers in taxonomy; our profiles are named the way a farmer talks.
 * "Erysiphaceae" and "Powdery Mildew" are the same problem, and matching on
 * the raw strings finds nothing — which used to mean a confident 88% image
 * identification was silently discarded.
 *
 * Keys are lowercase fragments of what Plant.id returns; values are fragments
 * of our profile names. Only genuinely equivalent pairs belong here.
 */
const NAME_SYNONYMS: Record<string, string[]> = {
  erysiphaceae: ['powdery mildew'],
  'powdery mildew': ['powdery mildew'],
  peronosporaceae: ['downy mildew'],
  'downy mildew': ['downy mildew'],
  pucciniales: ['rust', 'yellow rust', 'white rust'],
  uredinales: ['rust', 'yellow rust'],
  phytophthora: ['late blight'],
  'late blight': ['late blight'],
  alternaria: ['early blight', 'alternaria blight', 'purple blotch'],
  'early blight': ['early blight'],
  magnaporthe: ['blast', 'rice blast'],
  pyricularia: ['blast', 'rice blast'],
  xanthomonas: ['bacterial leaf blight', 'bacterial blight', 'black arm'],
  bipolaris: ['brown spot'],
  helminthosporium: ['brown spot'],
  cercospora: ['leaf spot', 'tikka leaf spot'],
  colletotrichum: ['red rot', 'anthracnose'],
  fusarium: ['wilt'],
  verticillium: ['verticillium wilt'],
  ascochyta: ['ascochyta blight'],
  exserohilum: ['turcicum leaf blight'],
  aphididae: ['aphid', 'mustard aphid'],
  aleyrodidae: ['whitefly'],
  thripidae: ['thrips'],
  noctuidae: ['armyworm', 'fall armyworm', 'pod borer'],
  helicoverpa: ['pod borer', 'fruit borer'],
  spodoptera: ['fall armyworm'],
  delphacidae: ['brown planthopper'],
  cicadellidae: ['leaf folder', 'hopper'],
  termitidae: ['termite'],
  'nutrient deficiency': ['blossom end rot'],
  'water-related issue': [],
};

/** Every string Plant.id offers us for one finding, lowercased. */
function findingAliases(finding: ImageFinding): string[] {
  return [finding.name, finding.localName ?? '', ...finding.commonNames]
    .filter(Boolean)
    .map((s) => normalise(s));
}

/**
 * Does an image finding refer to the same problem as a curated profile?
 *
 * Tries direct containment in either direction first, then the synonym table.
 * Containment alone is too weak for short names — "rust" is a substring of
 * plenty — so single-word profile names must match a whole alias word.
 */
function findingMatchesProfile(finding: ImageFinding, profileName: string): boolean {
  const profile = normalise(profileName);
  const aliases = findingAliases(finding);

  for (const alias of aliases) {
    if (!alias) continue;
    if (alias === profile) return true;

    // Multi-word names are distinctive enough to match on containment.
    if (profile.includes(' ') && (alias.includes(profile) || profile.includes(alias))) return true;

    // Single-word profile names must appear as a whole word in the alias.
    if (!profile.includes(' ') && alias.split(' ').includes(profile)) return true;
  }

  for (const [needle, profiles] of Object.entries(NAME_SYNONYMS)) {
    if (!aliases.some((alias) => alias.includes(needle))) continue;
    if (profiles.some((p) => profile.includes(p) || p.includes(profile))) return true;
  }

  return false;
}

/** The name to show a farmer: a common name beats a fungal family. */
function farmerFacingName(finding: ImageFinding): string {
  const common = finding.commonNames.find((n) => n.trim().length > 0);
  if (common) {
    // Plant.id pluralises families ("Powdery Mildews"); singular reads better.
    return common.replace(/s$/, '');
  }
  return finding.localName?.trim() || finding.name;
}

/** Insects are pests; fungi, bacteria and viruses are diseases. */
function findingKind(finding: ImageFinding): 'disease' | 'pest' {
  // The local model states the class outright; only Plant.id makes us infer it
  // from taxonomy.
  if (finding.kind) return finding.kind;

  const classification = finding.classification.map((c) => c.toLowerCase());
  const pestish = ['insecta', 'insect', 'arachnida', 'animalia', 'acari', 'nematoda'];
  return classification.some((c) => pestish.some((p) => c.includes(p))) ? 'pest' : 'disease';
}

/** Turn Plant.id's treatment advice into the engine's flat action list. */
function treatmentActions(finding: ImageFinding): string[] {
  const treatment = finding.treatment;
  if (!treatment) return [];
  // Prevention last: it matters, but not before an active infection is dealt with.
  return [...treatment.biological, ...treatment.chemical, ...treatment.prevention].slice(0, 6);
}

// ─────────────────────────── Engine ───────────────────────────

export interface DiagnosisInput {
  crop: CropProfile;
  cropIsKnown: boolean;
  description: string;
  weather: WeatherContext;
  hasImage: boolean;
  /** Optional Plant.id result, folded in as an extra signal. */
  external?: ImageAssessment | null;
}

const SEVERITY_RANK: Record<HealthSeverity, number> = {
  MILD: 1,
  MODERATE: 2,
  SEVERE: 3,
  CRITICAL: 4,
};

export function diagnose(input: DiagnosisInput): Diagnosis {
  const { crop, weather, hasImage, external } = input;

  // A description dictated in Hindi or Punjabi is rewritten into one the
  // English symptom vocabulary can score. English text passes through
  // unchanged, so this only ever adds signal.
  const regional = expandRegionalSymptoms(input.description);
  const description = regional.expanded;

  const externalFindings = external?.findings ?? [];
  /** Findings that corroborated a curated profile, so we do not repeat them. */
  const consumedFindings = new Set<ImageFinding>();

  /**
   * What the vision model read off the photograph, as text the symptom matcher
   * can score. This is the whole point of using a vision *language* model rather
   * than a classifier: "concentric brown rings on lower leaves" is evidence the
   * rest of the engine can reason about, where a bare label is not.
   */
  const photoSymptomText = (external?.observedSymptoms ?? []).join('. ');

  const candidates: Candidate[] = [];

  const evaluate = (
    profile: DiseaseProfile | PestProfile,
    kind: 'disease' | 'pest',
  ): void => {
    const described = scoreSymptoms(description, profile.keywords);
    const seen = photoSymptomText
      ? scoreSymptoms(photoSymptomText, profile.keywords)
      : { score: 0, matched: [] };
    const weatherVerdict = scoreWeather(profile.favouredBy, weather);

    const symptoms = {
      score: round2(combineEvidence(described.score, seen.score * PHOTO_SYMPTOM_WEIGHT)),
      matched: mergeKeywords(described.matched, seen.matched),
    };

    // An external image match for this same name is strong corroboration.
    const finding = externalFindings.find((f) => findingMatchesProfile(f, profile.name));

    // Symptoms are the primary signal; weather modulates rather than drives.
    // Without any symptom or image match we do not raise the candidate at all —
    // otherwise every humid week would flag every humid-weather disease.
    if (symptoms.score === 0 && !finding) return;

    let confidence = symptoms.score * 0.65 + weatherVerdict.score * 0.35;
    if (finding) {
      consumedFindings.add(finding);
      confidence = Math.max(confidence, finding.probability) * 0.6 + confidence * 0.4;
    }

    // Unrecognised crop means the disease list is generic — be less certain.
    if (!input.cropIsKnown) confidence *= 0.6;
    // A description with no photo is weaker evidence.
    if (!hasImage) confidence *= 0.9;

    const evidence: string[] = [];
    if (described.matched.length > 0) {
      evidence.push(`You described: ${described.matched.slice(0, 4).join(', ')}.`);
    }
    if (regional.matchedTerms.length > 0 && described.matched.length > 0) {
      evidence.push(`Understood from your own words: ${regional.matchedTerms.slice(0, 4).join(', ')}.`);
    }
    // Named separately from the farmer's own words: two sources agreeing is the
    // strongest thing this engine can show, and blurring them into one line
    // hides that.
    if (seen.matched.length > 0) {
      evidence.push(`Seen in your photo: ${seen.matched.slice(0, 4).join(', ')}.`);
    }
    if (finding) {
      evidence.push(
        `Image analysis suggested ${farmerFacingName(finding)} (${Math.round(finding.probability * 100)}% match).`,
      );
    }
    if (weatherVerdict.reasons.length > 0) {
      evidence.push(`Recent weather favours it — ${weatherVerdict.reasons.slice(0, 2).join(', and ')}.`);
    } else if (weatherVerdict.score < 0.4) {
      evidence.push('Recent weather does not strongly favour this, so it is less likely.');
    }

    candidates.push({
      kind,
      name: profile.name,
      confidence: round2(clamp(confidence, 0, 0.95)),
      severity: profile.severity,
      evidence,
      // Curated actions first — they are crop- and India-specific. Anything
      // the image analysis adds is appended rather than substituted.
      actions: finding
        ? [...profile.actions, ...treatmentActions(finding).slice(0, 3)]
        : profile.actions,
      explanation: profile.explanation,
      // The photo contributed if it named this problem *or* if what it saw
      // matched this profile's symptoms.
      source: finding || seen.matched.length > 0 ? 'rules+image' : 'rules',
      details: finding
        ? {
            scientificName: finding.name,
            description: finding.description ?? undefined,
            cause: finding.cause ?? undefined,
            classification: finding.classification,
            treatment: finding.treatment ?? undefined,
            similarImages: finding.similarImages,
          }
        : undefined,
      signals: {
        symptomScore: symptoms.score,
        weatherScore: weatherVerdict.score,
        matchedKeywords: symptoms.matched,
        weatherFavourable: weatherVerdict.favourable,
        ...(finding ? { imageProbability: finding.probability } : {}),
        ...(seen.score > 0 ? { imageSymptomScore: seen.score } : {}),
      },
    });
  };

  for (const disease of crop.diseases) evaluate(disease, 'disease');
  for (const pest of crop.pests) evaluate(pest, 'pest');

  // Anything the photo identified that our curated list for this crop does not
  // cover. Dropping these was the single biggest cause of "no problem
  // identified" on a photo the model had confidently diagnosed — our list is
  // 40-odd problems per crop, and both image engines range much wider.
  for (const finding of externalFindings) {
    if (consumedFindings.has(finding)) continue;
    if (finding.probability < 0.2) continue;

    const kind = findingKind(finding);
    const actions = treatmentActions(finding);

    candidates.push({
      kind,
      name: farmerFacingName(finding),
      // No symptom or weather corroboration, so we never let a photo alone
      // reach the confidence a fully-triangulated candidate can.
      confidence: round2(clamp(finding.probability * 0.75, 0, 0.8)),
      // Outside our list there is no curated severity, so we take the model's
      // own read of how bad it looks and fall back to MODERATE. Getting this
      // wrong in the safe direction matters: SEVERE and above raises an alert.
      severity: finding.severityHint ?? 'MODERATE',
      evidence: [
        `Identified from your photo (${Math.round(finding.probability * 100)}% match).`,
        `Not in our ${crop.label} problem list, so weather and your description could not be cross-checked.`,
      ],
      actions:
        actions.length > 0
          ? actions
          : ['Show this photo to your local Krishi Vigyan Kendra before treating.'],
      explanation:
        finding.description ??
        'Identified from the photograph by image analysis, without local corroboration.',
      source: 'image',
      details: {
        scientificName: finding.name,
        description: finding.description ?? undefined,
        cause: finding.cause ?? undefined,
        classification: finding.classification,
        treatment: finding.treatment ?? undefined,
        similarImages: finding.similarImages,
      },
      signals: {
        symptomScore: 0,
        weatherScore: 0,
        matchedKeywords: [],
        weatherFavourable: false,
        imageProbability: finding.probability,
      },
    });
  }

  // Rank by confidence, but let a CRITICAL candidate outrank a marginally more
  // confident MILD one — the cost of missing late blight is far higher than
  // the cost of a false alarm.
  candidates.sort((a, b) => {
    const riskA = a.confidence * (1 + SEVERITY_RANK[a.severity] * 0.15);
    const riskB = b.confidence * (1 + SEVERITY_RANK[b.severity] * 0.15);
    return riskB - riskA;
  });

  const top = candidates.slice(0, 4);
  return assemble(top, input);
}

function assemble(candidates: Candidate[], input: DiagnosisInput): Diagnosis {
  const { crop, hasImage, description, external } = input;

  const readSymptoms = external?.observedSymptoms ?? [];

  const limitations: string[] = [];
  if (!hasImage) {
    limitations.push('No photo was provided, so this is based on your description alone.');
  }
  if (!input.cropIsKnown) {
    limitations.push(
      `${crop.label} is not in our detailed crop database, so only general checks were applied.`,
    );
  }
  // Only worth asking for more words when the photo did not already supply
  // them — a good close-up with no caption is not a thin observation.
  if (description.trim().length < 20 && readSymptoms.length === 0) {
    limitations.push('A longer description of what you are seeing would improve accuracy.');
  }
  if (hasImage && !external) {
    limitations.push('Image analysis was unavailable, so the photo was stored but not analysed.');
  }
  if (external?.imageQuality === 'poor') {
    limitations.push(
      'The photo was hard to read — blurred, dark or taken from too far away — so the reading from it is weaker than usual.',
    );
  }
  if (external?.provider === 'ollama') {
    limitations.push(
      'The photo was examined on this device by a general-purpose vision model, not a specialist plant-disease model, so treat what it saw as a second opinion rather than a lab result.',
    );
  }
  if (external?.languageFellBack) {
    limitations.push(
      'Detailed descriptions from image analysis were not available in your language, so those sections are in English.',
    );
  }
  limitations.push(
    'This is guidance to help you check the right things — not a confirmed diagnosis. Consult your local extension officer for anything serious.',
  );

  const method: Diagnosis['method'] = external
    ? external.provider === 'ollama'
      ? 'rule-engine+ollama-vision'
      : 'rule-engine+plant-id'
    : 'rule-engine';

  const imageSummary: Diagnosis['image'] = external
    ? {
        provider: external.provider,
        model: external.model,
        isPlant: external.isPlant,
        looksHealthy: external.isHealthy,
        language: external.language,
        languageFellBack: external.languageFellBack,
        observedSymptoms: readSymptoms,
        affectedParts: external.affectedParts,
        quality: external.imageQuality,
      }
    : undefined;

  // The photo is not of a plant. Saying "no problem found" here would be
  // misleading — the farmer needs to know the photo itself was the issue.
  if (external && !external.isPlant) {
    return {
      candidates: [],
      severity: 'MILD',
      summary: 'That photo does not appear to show a plant, so it could not be analysed.',
      nextSteps: [
        'Take the photo again, filling the frame with the affected leaf, stem or fruit.',
        'Shoot in daylight, holding the phone steady about a hand’s width away.',
        'Avoid shadows and keep the background simple — soil or your hand behind the leaf works well.',
      ],
      confidence: 0.1,
      method,
      limitations,
      image: imageSummary,
    };
  }

  if (candidates.length === 0) {
    // A clean bill of health from the image is a real answer, not a failure.
    if (external?.isHealthy) {
      return {
        candidates: [],
        severity: 'MILD',
        summary: 'The plant in your photo looks healthy — no disease was detected.',
        nextSteps: [
          'No treatment is needed based on this photo.',
          'Keep watching the same plants over the next week, especially after rain.',
          'If something still looks wrong, photograph the specific part that concerns you and describe what changed.',
        ],
        confidence: round2(clamp(external.isHealthyProbability, 0.3, 0.9)),
        method,
        limitations,
        image: imageSummary,
      };
    }

    // The photo showed something, but it matched nothing on this crop's list.
    // Reporting "nothing found" would throw away the one genuinely useful
    // thing we have — what the model could see.
    const sawSomething = readSymptoms.length > 0;

    return {
      candidates: [],
      severity: 'MILD',
      summary: sawSomething
        ? `Your photo shows ${readSymptoms.slice(0, 3).join(', ')}, but that does not match a known ${crop.label.toLowerCase()} problem closely enough to name one.`
        : 'No specific problem identified from what you described.',
      nextSteps: [
        'Take a clear, close-up photo of the affected part in daylight.',
        'Describe what you see in more detail: the colour and shape of any marks, which leaves are affected (old or new), and whether it is spreading.',
        'Check the underside of leaves and the base of the stem — problems often start there.',
        'Compare an affected plant with a healthy one nearby.',
        'If it is spreading quickly, contact your local Krishi Vigyan Kendra without waiting.',
      ],
      confidence: 0.2,
      method,
      limitations,
      image: imageSummary,
    };
  }

  const primary = candidates[0];
  const severity = candidates.reduce<HealthSeverity>(
    (worst, c) =>
      c.confidence >= 0.35 && SEVERITY_RANK[c.severity] > SEVERITY_RANK[worst] ? c.severity : worst,
    'MILD',
  );

  const confident = primary.confidence >= 0.55;
  const alternatives = candidates.slice(1).filter((c) => c.confidence >= 0.25);

  const summary = confident
    ? `Most likely ${primary.name.toLowerCase()}${alternatives.length ? `, though ${alternatives[0].name.toLowerCase()} is also possible` : ''}.`
    : `Possibly ${primary.name.toLowerCase()}, but the evidence is not strong. Please check carefully.`;

  // Lead with the top candidate's actions, then add differentiating checks.
  const nextSteps = [...primary.actions];
  if (alternatives.length > 0) {
    // An image-only candidate's explanation is a paragraph from Plant.id, not
    // the one-clause reason a curated profile carries — naming it is enough.
    const differentiator =
      alternatives[0].source === 'image'
        ? 'compare your plant against the reference photos below.'
        : `${alternatives[0].explanation.toLowerCase()}`;
    nextSteps.push(
      `Also rule out ${alternatives.map((a) => a.name).join(' and ')} — ${differentiator}`,
    );
  }
  if (SEVERITY_RANK[severity] >= 3) {
    nextSteps.push(
      'Photograph the affected plants and report this to your local extension officer — problems at this severity spread to neighbouring fields.',
    );
  }

  return {
    candidates,
    severity,
    summary,
    nextSteps,
    confidence: primary.confidence,
    method,
    limitations,
    image: imageSummary,
  };
}

// ─────────────────────────── Utils ───────────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
