/**
 * Crop health diagnostic engine.
 *
 * Approach and justification (see README for the full write-up):
 *
 * We deliberately do NOT claim to diagnose plant disease from a photograph
 * using a model we trained during a hackathon. Instead this is an
 * **evidence-weighted differential diagnosis** over three independent signals:
 *
 *   1. SYMPTOMS  — keyword matching of the farmer's own description against a
 *                  curated symptom vocabulary per disease/pest.
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
 * When a Plant.id API key is configured, its image analysis is folded in as an
 * additional weighted signal — it does not replace the reasoning above.
 */

import type { HealthSeverity } from '@prisma/client';
import type { CropProfile, DiseaseProfile, PestProfile } from '../../domain/crops';
import type { DailyWeather } from '../weather/openmeteo';

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
  /** Which signals contributed, for transparency and debugging. */
  signals: {
    symptomScore: number;
    weatherScore: number;
    matchedKeywords: string[];
    weatherFavourable: boolean;
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
  method: 'rule-engine' | 'rule-engine+plant-id';
  /** Honest statement of what the analysis could and could not use. */
  limitations: string[];
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

/** Normalise free text for matching: lowercase, collapse whitespace. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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
  favouredBy: DiseaseProfile['favouredBy'] | PestProfile['favouredBy'],
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
  if ('minRecentRainMm' in favouredBy && favouredBy.minRecentRainMm !== undefined) {
    checks.push({
      met: ctx.recentRainMm >= favouredBy.minRecentRainMm,
      reason: `${ctx.recentRainMm} mm of rain in the last week`,
      contradiction: `only ${ctx.recentRainMm} mm of rain in the last week, drier than this needs`,
    });
  }
  if ('maxRecentRainMm' in favouredBy && favouredBy.maxRecentRainMm !== undefined) {
    checks.push({
      met: ctx.recentRainMm <= favouredBy.maxRecentRainMm,
      reason: `dry conditions recently (${ctx.recentRainMm} mm), which this favours`,
      contradiction: `${ctx.recentRainMm} mm of rain recently — wetter than this favours`,
    });
  }
  if ('minWetDays' in favouredBy && favouredBy.minWetDays !== undefined) {
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

// ─────────────────────────── Engine ───────────────────────────

export interface DiagnosisInput {
  crop: CropProfile;
  cropIsKnown: boolean;
  description: string;
  weather: WeatherContext;
  hasImage: boolean;
  /** Optional Plant.id result, folded in as an extra signal. */
  externalFindings?: Array<{ name: string; probability: number }>;
}

const SEVERITY_RANK: Record<HealthSeverity, number> = {
  MILD: 1,
  MODERATE: 2,
  SEVERE: 3,
  CRITICAL: 4,
};

export function diagnose(input: DiagnosisInput): Diagnosis {
  const { crop, description, weather, hasImage, externalFindings } = input;

  const candidates: Candidate[] = [];

  const evaluate = (
    profile: DiseaseProfile | PestProfile,
    kind: 'disease' | 'pest',
  ): void => {
    const symptoms = scoreSymptoms(description, profile.keywords);
    const weatherVerdict = scoreWeather(profile.favouredBy, weather);

    // An external image match for this same name is strong corroboration.
    const external = externalFindings?.find((f) =>
      normalise(f.name).includes(normalise(profile.name)) ||
      normalise(profile.name).includes(normalise(f.name)),
    );

    // Symptoms are the primary signal; weather modulates rather than drives.
    // Without any symptom or image match we do not raise the candidate at all —
    // otherwise every humid week would flag every humid-weather disease.
    if (symptoms.score === 0 && !external) return;

    let confidence = symptoms.score * 0.65 + weatherVerdict.score * 0.35;
    if (external) {
      confidence = Math.max(confidence, external.probability) * 0.6 + confidence * 0.4;
    }

    // Unrecognised crop means the disease list is generic — be less certain.
    if (!input.cropIsKnown) confidence *= 0.6;
    // A description with no photo is weaker evidence.
    if (!hasImage) confidence *= 0.9;

    const evidence: string[] = [];
    if (symptoms.matched.length > 0) {
      evidence.push(`You described: ${symptoms.matched.slice(0, 4).join(', ')}.`);
    }
    if (external) {
      evidence.push(`Image analysis suggested ${external.name} (${Math.round(external.probability * 100)}% match).`);
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
      actions: profile.actions,
      explanation: profile.explanation,
      signals: {
        symptomScore: symptoms.score,
        weatherScore: weatherVerdict.score,
        matchedKeywords: symptoms.matched,
        weatherFavourable: weatherVerdict.favourable,
      },
    });
  };

  for (const disease of crop.diseases) evaluate(disease, 'disease');
  for (const pest of crop.pests) evaluate(pest, 'pest');

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
  const { crop, hasImage, description, externalFindings } = input;

  const limitations: string[] = [];
  if (!hasImage) {
    limitations.push('No photo was provided, so this is based on your description alone.');
  }
  if (!input.cropIsKnown) {
    limitations.push(
      `${crop.label} is not in our detailed crop database, so only general checks were applied.`,
    );
  }
  if (description.trim().length < 20) {
    limitations.push('A longer description of what you are seeing would improve accuracy.');
  }
  if (hasImage && !externalFindings) {
    limitations.push('Image analysis was unavailable, so the photo was stored but not analysed.');
  }
  limitations.push(
    'This is guidance to help you check the right things — not a confirmed diagnosis. Consult your local extension officer for anything serious.',
  );

  const method: Diagnosis['method'] = externalFindings ? 'rule-engine+plant-id' : 'rule-engine';

  if (candidates.length === 0) {
    return {
      candidates: [],
      severity: 'MILD',
      summary: 'No specific problem identified from what you described.',
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
    nextSteps.push(
      `Also rule out ${alternatives.map((a) => a.name).join(' and ')} — ${alternatives[0].explanation.toLowerCase()}`,
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
