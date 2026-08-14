/**
 * Local vision analysis of a crop photo, via Ollama.
 *
 * This is the part of crop health that actually looks at the photograph. It
 * runs a multimodal model on the farmer's own machine — no key, no per-photo
 * cost, no image leaving the network, and it works when the connection does not.
 *
 * Two things are asked of the model, and the distinction matters:
 *
 *   1. `observed_symptoms` — what is literally visible, in short English
 *      plant-pathology phrases. These are scored against the curated symptom
 *      vocabulary in exactly the same way as the farmer's own description, so a
 *      photograph becomes *evidence the rule engine can corroborate* rather
 *      than a verdict that has to be believed.
 *   2. `findings` — the model's ranked guesses at the cause. Useful, but from an
 *      8B model these are treated as one signal, discounted (see
 *      CONFIDENCE_SCALE) and cross-checked against crop and weather downstream.
 *
 * Contract notes for /api/chat, verified against Ollama 0.32:
 *
 *   - Images go on the message as `images: [<bare base64>]` — no data-URL
 *     prefix, and not in the text content.
 *   - `format` accepts a full JSON Schema, and the runner constrains decoding to
 *     it. This is what makes an 8B model's output safe to parse; asking for
 *     "JSON only" in the prompt is not.
 *   - `think: false` is rejected by models with no thinking capability, so a 400
 *     mentioning it is retried without the field rather than failed.
 *   - `keep_alive` keeps the weights resident between observations. Without it
 *     every photo pays a cold model load, which on a 9 GB model is most of the
 *     wall clock.
 */

import type { HealthSeverity } from '@prisma/client';
import { logger } from '../../common/logger';
import { config } from '../../config';
import type { ImageAssessment, ImageFinding, VisionOptions } from './vision';

/**
 * Language names for the prompt, keyed by the app's language codes.
 *
 * Unlike Plant.id — which publishes localised disease content only in English
 * and Hindi — the model writes its farmer-facing prose directly, so every
 * language the UI offers can be asked for.
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
 * A general-purpose 8B model is a weaker plant pathologist than a model trained
 * on nothing else, and it states its confidence like a chatbot: 0.9 for
 * anything it recognises. Scaling its probabilities keeps a single photograph
 * from outvoting the farmer's description and the weather record combined.
 */
const CONFIDENCE_SCALE = 0.85;

/** Availability is cached so a stopped Ollama costs one probe a minute, not one per photo. */
const AVAILABILITY_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 2_000;

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

/**
 * Response schema, enforced by the runner rather than requested in prose.
 *
 * Everything is required: an optional field on a small model is a field it
 * omits, and a missing `probability` silently becomes a zero-confidence finding
 * that the engine then discards.
 */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    is_plant: { type: 'boolean' },
    is_plant_confidence: { type: 'number' },
    is_healthy: { type: 'boolean' },
    is_healthy_confidence: { type: 'number' },
    image_quality: { type: 'string', enum: ['good', 'acceptable', 'poor'] },
    affected_parts: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['leaf', 'stem', 'fruit', 'flower', 'root', 'whole plant'],
      },
    },
    observed_symptoms: { type: 'array', items: { type: 'string' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          scientific_name: { type: 'string' },
          category: {
            type: 'string',
            enum: [
              'fungal',
              'bacterial',
              'viral',
              'insect pest',
              'mite',
              'nutrient deficiency',
              'abiotic stress',
              'unknown',
            ],
          },
          probability: { type: 'number' },
          severity: { type: 'string', enum: ['mild', 'moderate', 'severe', 'critical'] },
          description: { type: 'string' },
          cause: { type: 'string' },
          treatment: {
            type: 'object',
            properties: {
              biological: { type: 'array', items: { type: 'string' } },
              chemical: { type: 'array', items: { type: 'string' } },
              prevention: { type: 'array', items: { type: 'string' } },
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
- Give at most three findings, most likely first. A probability above 0.8 means the visible evidence is unmistakable; use 0.3-0.5 when the photograph is merely consistent with the problem.
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

interface ChatResponse {
  message?: { content?: string };
}

// ─────────────────────── Availability ───────────────────────

let cachedAvailability: { ok: boolean; at: number } | null = null;

function baseUrl(): string {
  return config.OLLAMA_BASE_URL.replace(/\/$/, '');
}

/**
 * Is Ollama up, with the configured model pulled?
 *
 * Probing first means a farmer whose Ollama is not running waits two seconds
 * for the fallback, not the full inference timeout. A missing model is called
 * out by name — it is the most likely setup mistake, and it looks identical to
 * "analysis failed" from the outside.
 */
async function isAvailable(): Promise<boolean> {
  const now = Date.now();
  if (cachedAvailability && now - cachedAvailability.at < AVAILABILITY_TTL_MS) {
    return cachedAvailability.ok;
  }

  let ok = false;
  try {
    const response = await fetch(`${baseUrl()}/api/tags`, {
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.ok) {
      const body = (await response.json()) as { models?: Array<{ name?: string }> };
      const installed = (body.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === 'string');

      const wanted = config.OLLAMA_VISION_MODEL;
      // Ollama reports "gemma4:e4b"; a config value of "gemma4" means the same.
      ok = installed.some((n) => n === wanted || n.split(':')[0] === wanted.split(':')[0]);

      if (!ok) {
        logger.warn(
          { wanted, installed },
          'Ollama is running but the configured vision model is not pulled — run `ollama pull ' +
            wanted +
            '`',
        );
      }
    }
  } catch {
    // Not running, or not reachable. Normal in production; expected offline.
    ok = false;
  }

  cachedAvailability = { ok, at: now };
  return ok;
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
    commonNames: [],
    probability: clamp(raw.probability * CONFIDENCE_SCALE, 0, 0.9),
    description: raw.description?.trim() || null,
    cause: raw.cause?.trim() || null,
    treatment: hasTreatment ? treatment : null,
    classification: [CATEGORY_LABELS[category] ?? CATEGORY_LABELS.unknown],
    // A local model has no image library to compare against.
    similarImages: [],
    kind: PEST_CATEGORIES.has(category) ? 'pest' : 'disease',
    severityHint: SEVERITY_BY_HINT[(raw.severity ?? '').toLowerCase()],
  };
}

/**
 * Turn the raw JSON into an assessment, reconciling the parts a small model
 * gets internally inconsistent.
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

  // "Healthy, and here are two diseases" is a contradiction small models produce
  // regularly. The findings are the more specific claim, so they win — but only
  // if one of them is confident enough to be worth showing.
  const claimsProblem = findings.some((f) => f.probability >= 0.3);
  const isHealthy = isPlant && !claimsProblem && (raw.is_healthy === true || findings.length === 0);

  const quality = (raw.image_quality ?? '').toLowerCase();

  return {
    provider: 'ollama',
    model: config.OLLAMA_VISION_MODEL,
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
 * The schema-constrained runner returns bare JSON, but a thinking-capable model
 * that ignores `think: false` can still prefix it, and some builds fence it.
 * Slicing to the outermost braces costs nothing and turns an occasional total
 * failure into a normal result.
 */
function parseJson(content: string): RawResponse | null {
  const trimmed = content.trim();
  const candidates = [trimmed];

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start > 0 || (end !== -1 && end < trimmed.length - 1)) {
    if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));
  }

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

// ─────────────────────── Request ───────────────────────

interface RequestBody {
  model: string;
  stream: false;
  keep_alive: string;
  format: unknown;
  options: Record<string, number>;
  messages: Array<{ role: string; content: string; images?: string[] }>;
  think?: boolean;
}

async function chat(body: RequestBody, timeoutMs: number): Promise<ChatResponse | null> {
  const response = await fetch(`${baseUrl()}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.ok) return (await response.json()) as ChatResponse;

  const detail = await response.text().catch(() => '');

  // Models with no thinking capability reject the flag outright. Retrying
  // without it keeps any vision model swappable through OLLAMA_VISION_MODEL.
  if (response.status === 400 && /think/i.test(detail) && body.think !== undefined) {
    const { think: _think, ...rest } = body;
    logger.debug('Ollama model does not accept `think`; retrying without it');
    return chat(rest as RequestBody, timeoutMs);
  }

  logger.warn(
    { status: response.status, detail: detail.slice(0, 300), model: body.model },
    'Ollama vision request failed',
  );
  return null;
}

/**
 * Analyse a crop photo with the local vision model.
 *
 * Returns null when Ollama is not running, the model is not pulled, inference
 * times out, or the response cannot be parsed — every one of which is a reason
 * to fall through to the next engine, never to fail the farmer's observation.
 *
 * @param imageBase64 Raw base64 of the photo, no data-URL prefix.
 */
export async function assessCropImageWithOllama(
  imageBase64: string,
  options: VisionOptions = {},
): Promise<ImageAssessment | null> {
  if (!(await isAvailable())) return null;

  const language = resolveLanguage(options.language);
  const startedAt = Date.now();

  try {
    const result = await chat(
      {
        model: config.OLLAMA_VISION_MODEL,
        stream: false,
        // Keeps the weights resident, so the farmer's second photo is fast.
        keep_alive: config.OLLAMA_KEEP_ALIVE,
        format: RESPONSE_SCHEMA,
        options: {
          // Near-greedy: this is an extraction task, not a creative one, and a
          // rediagnosis of the same photo should not contradict the first.
          temperature: 0.15,
          top_p: 0.9,
          // A photo plus this schema does not fit the 4k default, and silent
          // truncation there costs the findings at the end of the object.
          num_ctx: 8192,
          num_predict: 1200,
        },
        think: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildPrompt(options, language.name),
            images: [imageBase64],
          },
        ],
      },
      config.OLLAMA_TIMEOUT_MS,
    );

    const content = result?.message?.content;
    if (!content) return null;

    const raw = parseJson(content);
    if (!raw) {
      logger.warn({ preview: content.slice(0, 200) }, 'Ollama vision response was not valid JSON');
      return null;
    }

    const assessment = toAssessment(raw, language);

    logger.info(
      {
        model: assessment.model,
        ms: Date.now() - startedAt,
        isPlant: assessment.isPlant,
        isHealthy: assessment.isHealthy,
        findings: assessment.findings.length,
        symptoms: assessment.observedSymptoms.length,
      },
      'Crop photo analysed locally',
    );

    return assessment;
  } catch (err) {
    // AbortSignal.timeout surfaces as a TimeoutError — worth naming, since a
    // cold 9 GB model on a slow machine can genuinely exceed the budget.
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    logger.warn(
      { err, ms: Date.now() - startedAt, timedOut },
      timedOut
        ? 'Ollama vision timed out; raise OLLAMA_TIMEOUT_MS if this recurs'
        : 'Ollama vision unavailable',
    );
    return null;
  }
}
