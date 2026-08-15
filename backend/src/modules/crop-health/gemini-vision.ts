/**
 * Hosted vision analysis of a crop photo, via Google Gemini.
 *
 * This is the primary engine that actually looks at the photograph. It exists
 * because the two previous providers both failed silently in practice: Ollama
 * needs a multimodal model pulled onto the server (and the shipped default tag
 * did not exist), and Plant.id needs a paid key. With neither configured,
 * `analyseCropImage` returned null and every diagnosis came from the farmer's
 * typed description alone — the photo was stored and never read.
 *
 * Gemini needs only a free API key from https://aistudio.google.com/apikey.
 *
 * The contract asked of the model is deliberately the same as the Ollama
 * provider's, because the distinction is what makes the result trustworthy:
 *
 *   1. `observed_symptoms` — what is literally visible, as short English
 *      plant-pathology phrases. These are scored against the curated symptom
 *      vocabulary exactly like the farmer's own words, so the photograph becomes
 *      *evidence the rule engine can corroborate* rather than a verdict that has
 *      to be taken on trust.
 *   2. `findings` — ranked guesses at the cause, discounted (CONFIDENCE_SCALE)
 *      and cross-checked against crop, season and weather downstream.
 *
 * Contract notes for generateContent, as of the v1beta REST API:
 *
 *   - The image goes in the same `parts` array as the text, as `inline_data`
 *     with a bare base64 payload — no data-URL prefix.
 *   - `responseSchema` constrains decoding, which is what makes the output safe
 *     to parse. It is an OpenAPI 3.0 subset, *not* full JSON Schema: type names
 *     are upper-case, and `additionalProperties` is rejected outright.
 *   - `responseMimeType: 'application/json'` is required alongside the schema;
 *     the schema is ignored without it.
 *   - A 429 is a free-tier rate limit, not a broken key. It is logged as such
 *     and falls through to the next provider rather than looking like an outage.
 */

import type { HealthSeverity } from '@prisma/client';
import { logger } from '../../common/logger';
import { config } from '../../config';
import type { ImageAssessment, ImageFinding, VisionOptions } from './vision';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Language names for the prompt, keyed by the app's language codes.
 *
 * Gemini writes its farmer-facing prose directly rather than looking it up in a
 * fixed content library, so every language the UI offers can be asked for.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  pa: 'Punjabi',
  te: 'Telugu',
  mr: 'Marathi',
  bn: 'Bengali',
};

/**
 * Even a strong multimodal model states confidence like a chatbot — 0.9 for
 * anything it recognises. Scaling keeps one photograph from outvoting the
 * farmer's description and the weather record combined. Less aggressive than
 * the local model's discount, because this one is materially more reliable.
 */
const CONFIDENCE_SCALE = 0.9;

/**
 * Output token ceiling.
 *
 * Generous on purpose. Three findings, each carrying a description, a cause and
 * three treatment lists — written in Hindi or Telugu, where a single character
 * costs several tokens — is a substantial object, and a ceiling that clips it
 * yields truncated JSON rather than fewer findings. 2048 was not enough for a
 * plant with a real problem, which is the only case that matters.
 */
const MAX_OUTPUT_TOKENS = 8192;

/** MIME types Gemini accepts for inline image data. */
const SUPPORTED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const SEVERITY_BY_HINT: Record<string, HealthSeverity> = {
  mild: 'MILD',
  moderate: 'MODERATE',
  severe: 'SEVERE',
  critical: 'CRITICAL',
};

/** Insects and mites are pests; everything else is handled as a disease. */
const PEST_CATEGORIES = new Set(['insect pest', 'mite']);

const CATEGORY_LABELS: Record<string, string> = {
  fungal: 'Fungal disease',
  bacterial: 'Bacterial disease',
  viral: 'Viral disease',
  'insect pest': 'Insect pest',
  mite: 'Mite',
  'nutrient deficiency': 'Nutrient deficiency',
  'abiotic stress': 'Weather or soil damage',
  unknown: 'Unidentified',
};

const CATEGORY_ENUM = [
  'fungal',
  'bacterial',
  'viral',
  'insect pest',
  'mite',
  'nutrient deficiency',
  'abiotic stress',
  'unknown',
];

/**
 * Response schema, enforced by the decoder rather than requested in prose.
 *
 * Upper-case type names and no `additionalProperties`: this is OpenAPI 3.0 as
 * Gemini implements it, and a stray JSON Schema keyword here is a 400, not a
 * warning. Everything is required — an optional field is a field the model
 * omits, and a missing `probability` becomes a zero-confidence finding that the
 * engine then silently discards.
 */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_plant: { type: 'BOOLEAN' },
    is_plant_confidence: { type: 'NUMBER' },
    is_healthy: { type: 'BOOLEAN' },
    is_healthy_confidence: { type: 'NUMBER' },
    image_quality: { type: 'STRING', enum: ['good', 'acceptable', 'poor'] },
    affected_parts: {
      type: 'ARRAY',
      items: {
        type: 'STRING',
        enum: ['leaf', 'stem', 'fruit', 'flower', 'root', 'whole plant'],
      },
    },
    observed_symptoms: { type: 'ARRAY', items: { type: 'STRING' } },
    findings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          scientific_name: { type: 'STRING' },
          category: { type: 'STRING', enum: CATEGORY_ENUM },
          probability: { type: 'NUMBER' },
          severity: { type: 'STRING', enum: ['mild', 'moderate', 'severe', 'critical'] },
          description: { type: 'STRING' },
          cause: { type: 'STRING' },
          treatment: {
            type: 'OBJECT',
            properties: {
              biological: { type: 'ARRAY', items: { type: 'STRING' } },
              chemical: { type: 'ARRAY', items: { type: 'STRING' } },
              prevention: { type: 'ARRAY', items: { type: 'STRING' } },
            },
            required: ['biological', 'chemical', 'prevention'],
          },
        },
        required: [
          'name',
          'scientific_name',
          'category',
          'probability',
          'severity',
          'description',
          'cause',
          'treatment',
        ],
      },
    },
  },
  required: [
    'is_plant',
    'is_plant_confidence',
    'is_healthy',
    'is_healthy_confidence',
    'image_quality',
    'affected_parts',
    'observed_symptoms',
    'findings',
  ],
} as const;

const SYSTEM_PROMPT = `You are an experienced plant pathologist advising smallholder farmers in India. You examine one photograph of a crop and report only what that photograph shows.

Rules:
- Judge from the image alone. Never report a symptom you cannot actually see in it.
- If the image does not show a plant or crop, set is_plant to false and return no findings.
- If the plant looks healthy, set is_healthy to true and return no findings.
- Give at most three findings, most likely first. A probability above 0.8 means the visible evidence is unmistakable; use 0.3-0.5 when the photograph is merely consistent with the problem. Do not inflate: a confident wrong answer costs a farmer a spray they did not need.
- observed_symptoms are short English plant-pathology phrases for what is visible: "concentric brown rings", "white powdery coating", "water soaked lesion", "yellowing between veins", "chewed holes", "webbing on underside", "leaf curling". Never a diagnosis, never a sentence, never more than five words. Give three to eight of them.
- image_quality is "poor" when the photo is blurred, dark, or too far away to judge — say so rather than guessing.
- Treatment must be practical for a smallholder in India: name active ingredients, not brand names, and put cultural and biological measures before chemicals.`;

interface RawFinding {
  name?: string;
  scientific_name?: string;
  category?: string;
  probability?: number;
  severity?: string;
  description?: string;
  cause?: string;
  treatment?: {
    biological?: string[];
    chemical?: string[];
    prevention?: string[];
  };
}

interface RawResponse {
  is_plant?: boolean;
  is_plant_confidence?: number;
  is_healthy?: boolean;
  is_healthy_confidence?: number;
  image_quality?: string;
  affected_parts?: string[];
  observed_symptoms?: string[];
  findings?: RawFinding[];
}

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

// ─────────────────────── Prompt ───────────────────────

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function resolveLanguage(requested: string | undefined): {
  code: string;
  name: string;
  fellBack: boolean;
} {
  const base = (requested ?? 'en').toLowerCase().split(/[-_]/)[0];
  const name = LANGUAGE_NAMES[base];
  if (name) return { code: base, name, fellBack: false };
  return { code: 'en', name: 'English', fellBack: base !== 'en' };
}

function buildPrompt(options: VisionOptions, languageName: string): string {
  const lines: string[] = [];

  lines.push(
    options.cropLabel
      ? `The farmer records this crop as: ${options.cropLabel}.`
      : 'The crop is not recorded.',
  );

  if (typeof options.latitude === 'number' && typeof options.longitude === 'number') {
    const month = MONTHS[(options.observedAt ?? new Date()).getMonth()];
    lines.push(
      `Taken in India near ${options.latitude.toFixed(2)}, ${options.longitude.toFixed(2)} in ${month} — weigh what is plausible for that place and season.`,
    );
  }

  // Naming the curated problems is what lets an image finding corroborate a
  // rule-engine candidate instead of landing beside it as a separate,
  // uncorroborated row the farmer has to reconcile.
  if (options.knownProblems?.length) {
    lines.push(
      `Problems commonly seen on this crop in India: ${options.knownProblems.join(', ')}.`,
      'If what you see is one of those, use that exact name. If it is not, name what you actually see instead — do not force a match.',
    );
  }

  const description = options.description?.trim();
  if (description) {
    lines.push(
      `The farmer describes it as: "${description.slice(0, 500)}". Treat that as a clue only — contradict it if the photograph shows something else.`,
    );
  }

  lines.push(
    `Write name, scientific_name and observed_symptoms in English. Write description, cause and every treatment line in ${languageName}.`,
  );

  return lines.join('\n');
}

// ─────────────────────── Mapping ───────────────────────

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function cleanList(values: unknown, limit: number, maxLength = 300): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim().slice(0, maxLength);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function toFinding(raw: RawFinding): ImageFinding | null {
  const displayName = raw.name?.trim();
  if (!displayName || typeof raw.probability !== 'number' || !Number.isFinite(raw.probability)) {
    return null;
  }

  const category = (raw.category ?? 'unknown').toLowerCase();
  const scientific = raw.scientific_name?.trim();
  const treatment = {
    biological: cleanList(raw.treatment?.biological, 4),
    chemical: cleanList(raw.treatment?.chemical, 4),
    prevention: cleanList(raw.treatment?.prevention, 4),
  };
  const hasTreatment =
    treatment.biological.length + treatment.chemical.length + treatment.prevention.length > 0;

  return {
    // `name` carries the taxonomy so the synonym table in diagnosis.ts can map
    // "Alternaria solani" onto our "Early blight"; `localName` carries the name
    // to show the farmer, already in their language.
    name:
      scientific && scientific.toLowerCase() !== displayName.toLowerCase()
        ? scientific
        : displayName,
    localName: displayName,
    // The English display name doubles as a common-name alias. Without it a
    // finding named "Early blight" with scientific name "Alternaria solani"
    // offers the matcher only the taxonomy, and the curated profile it plainly
    // refers to is reached through the synonym table or not at all.
    commonNames:
      scientific && scientific.toLowerCase() !== displayName.toLowerCase() ? [displayName] : [],
    probability: clamp(raw.probability * CONFIDENCE_SCALE, 0, 0.95),
    description: raw.description?.trim() || null,
    cause: raw.cause?.trim() || null,
    treatment: hasTreatment ? treatment : null,
    classification: [CATEGORY_LABELS[category] ?? CATEGORY_LABELS.unknown],
    // A generative model has no image library to link the farmer to.
    similarImages: [],
    kind: PEST_CATEGORIES.has(category) ? 'pest' : 'disease',
    severityHint: SEVERITY_BY_HINT[(raw.severity ?? '').toLowerCase()],
  };
}

/**
 * Turn the raw JSON into an assessment, reconciling the parts a model gets
 * internally inconsistent.
 */
function toAssessment(
  raw: RawResponse,
  language: { code: string; fellBack: boolean },
): ImageAssessment {
  const isPlant = raw.is_plant !== false;

  const findings = (raw.findings ?? [])
    .map(toFinding)
    .filter((f): f is ImageFinding => f !== null)
    .filter((f) => f.probability >= 0.15)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);

  // "Healthy, and here are two diseases" is a contradiction models produce
  // regularly. The findings are the more specific claim, so they win — but only
  // if one of them is confident enough to be worth showing.
  const claimsProblem = findings.some((f) => f.probability >= 0.3);
  const isHealthy = isPlant && !claimsProblem && (raw.is_healthy === true || findings.length === 0);

  const quality = (raw.image_quality ?? '').toLowerCase();

  return {
    provider: 'gemini',
    model: config.GEMINI_VISION_MODEL,
    findings: isPlant && !isHealthy ? findings : [],
    isPlant,
    isPlantProbability: clamp(raw.is_plant_confidence ?? (isPlant ? 0.9 : 0.1), 0, 1),
    isHealthy,
    isHealthyProbability: clamp(raw.is_healthy_confidence ?? (isHealthy ? 0.7 : 0.2), 0, 1),
    language: language.code,
    languageFellBack: language.fellBack,
    accessToken: null,
    observedSymptoms: isPlant ? cleanList(raw.observed_symptoms, 8, 60) : [],
    affectedParts: isPlant ? cleanList(raw.affected_parts, 6, 40) : [],
    imageQuality:
      quality === 'good' || quality === 'acceptable' || quality === 'poor' ? quality : null,
  };
}

/**
 * Pull the JSON object out of a model response.
 *
 * A schema-constrained response is bare JSON, but truncation at the token limit
 * and the occasional markdown fence both happen. Slicing to the outermost braces
 * costs nothing and turns an occasional total failure into a normal result.
 */
function parseJson(content: string): RawResponse | null {
  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const candidates = [trimmed];

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object') return parsed as RawResponse;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

/**
 * Best guess at the image's MIME type from its first bytes.
 *
 * The caller normally knows it — multer recorded it on upload — but this keeps
 * the provider usable when it does not, and stops an unlabelled photo being
 * declared JPEG when it is plainly a PNG.
 */
function sniffMimeType(imageBase64: string): string | null {
  const head = imageBase64.slice(0, 16);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBORw0KGgo')) return 'image/png';
  // RIFF....WEBP — the container tag sits at byte 8, base64 offset 11.
  if (head.startsWith('UklGR')) return 'image/webp';
  // ....ftyp — HEIC/HEIF brand box.
  if (imageBase64.slice(0, 24).includes('ZnR5c')) return 'image/heic';
  return null;
}

function resolveMimeType(options: VisionOptions, imageBase64: string): string {
  const declared = options.mimeType?.trim().toLowerCase();
  if (declared && SUPPORTED_MIME.has(declared)) return declared;
  return sniffMimeType(imageBase64) ?? 'image/jpeg';
}

// ─────────────────────── Request ───────────────────────

/**
 * Analyse a crop photo with Gemini.
 *
 * Returns null when no key is configured, the request fails or is rate-limited,
 * or the response cannot be parsed — every one of which is a reason to fall
 * through to the next engine, never to fail the farmer's observation.
 *
 * @param imageBase64 Raw base64 of the photo, no data-URL prefix.
 */
export async function assessCropImageWithGemini(
  imageBase64: string,
  options: VisionOptions = {},
): Promise<ImageAssessment | null> {
  const apiKey = config.GEMINI_API_KEY;
  if (!apiKey) return null;

  const language = resolveLanguage(options.language);
  const model = config.GEMINI_VISION_MODEL;
  const startedAt = Date.now();

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Header rather than a `?key=` query parameter, so the secret cannot
        // end up in a proxy or server access log.
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [
              { text: buildPrompt(options, language.name) },
              {
                inline_data: {
                  mime_type: resolveMimeType(options, imageBase64),
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          // Near-greedy: this is an extraction task, not a creative one, and a
          // re-diagnosis of the same photo should not contradict the first.
          temperature: 0.15,
          topP: 0.9,
          // Required for responseSchema to be honoured at all.
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          // Thinking off. On 2.5 Flash it is on by default, and reasoning tokens
          // are drawn from the *same* budget as the answer: with it enabled, the
          // model spent the budget deliberating and the JSON was cut off
          // mid-object (finishReason MAX_TOKENS), so every photo of an actually
          // diseased plant failed to parse. Reading symptoms off an image against
          // a fixed schema needs no deliberation.
          //
          // It does *not* make the call fast: measured against this API, even a
          // 32-token reply takes ~30s wall clock with thinking off, so the
          // latency is upstream rather than ours. Hence the generous timeout —
          // see GEMINI_TIMEOUT_MS.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal: AbortSignal.timeout(config.GEMINI_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // 429 is the free tier's per-minute quota, not a misconfiguration. 400 on
      // an API key is. Distinguishing them is the difference between "wait" and
      // "your key is wrong", and both used to read as a generic failure.
      logger.warn(
        { status: response.status, model, detail: detail.slice(0, 300) },
        response.status === 429
          ? 'Gemini vision rate-limited (free-tier quota); falling back'
          : response.status === 400 || response.status === 403
            ? 'Gemini vision rejected the request — check GEMINI_API_KEY and that the model supports images'
            : 'Gemini vision request failed',
      );
      return null;
    }

    const body = (await response.json()) as GenerateContentResponse;

    const blockReason = body.promptFeedback?.blockReason;
    if (blockReason) {
      logger.warn({ blockReason }, 'Gemini vision blocked the photo by safety filter');
      return null;
    }

    const candidate = body.candidates?.[0];
    const content = candidate?.content?.parts?.map((part) => part.text ?? '').join('');
    if (!content) {
      logger.warn({ finishReason: candidate?.finishReason }, 'Gemini vision returned no content');
      return null;
    }

    const raw = parseJson(content);
    if (!raw) {
      // Truncation and malformed output look identical downstream but have
      // completely different fixes, and reporting both as "not valid JSON" is
      // what made the MAX_TOKENS bug above hard to see.
      const truncated = candidate?.finishReason === 'MAX_TOKENS';
      logger.warn(
        { preview: content.slice(0, 200), finishReason: candidate?.finishReason },
        truncated
          ? `Gemini vision response was cut off at the ${MAX_OUTPUT_TOKENS}-token limit — raise MAX_OUTPUT_TOKENS, and check thinking is disabled`
          : 'Gemini vision response was not valid JSON',
      );
      return null;
    }

    const assessment = toAssessment(raw, language);

    logger.info(
      {
        model,
        ms: Date.now() - startedAt,
        isPlant: assessment.isPlant,
        isHealthy: assessment.isHealthy,
        findings: assessment.findings.length,
        symptoms: assessment.observedSymptoms.length,
        quality: assessment.imageQuality,
      },
      'Crop photo analysed by Gemini',
    );

    return assessment;
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    logger.warn(
      { err, ms: Date.now() - startedAt, timedOut, model },
      timedOut
        ? 'Gemini vision timed out; raise GEMINI_TIMEOUT_MS if this recurs'
        : 'Gemini vision unavailable',
    );
    return null;
  }
}
