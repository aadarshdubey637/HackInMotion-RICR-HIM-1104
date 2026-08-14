/**
 * Plant.id v3 image analysis client.
 *
 * The hosted fallback for crop photos: the local Ollama model in
 * ollama-vision.ts is tried first, and this runs only when that is unavailable
 * and a key is configured. Trained on plant disease specifically, and it
 * returns reference photographs, which no local model can.
 *
 * Everything it returns is folded into the rule engine as an extra signal —
 * see diagnosis.ts for why it is a signal and not the answer.
 *
 * Contract notes, verified against the live API rather than the docs:
 *
 *   - POST /api/v3/health_assessment returns **201**, not 200.
 *   - `details` must be requested explicitly. Without it you get a bare
 *     scientific name ("Erysiphaceae") and nothing a farmer can act on.
 *   - `language` genuinely localises description and treatment, but only for
 *     languages Plant.id has content for. Asking for an unsupported one
 *     returns *empty* details rather than falling back to English, which would
 *     hand the farmer a blank card — hence SUPPORTED_LANGUAGES below.
 *   - A stored assessment can be re-read for free at
 *     GET /api/v3/identification/{access_token} (note: *identification*, not
 *     health_assessment, which 404s). Only the POST costs a credit.
 */

import { logger } from '../../common/logger';
import { config } from '../../config';
import type { ImageAssessment, ImageFinding, VisionOptions } from './vision';

/**
 * Languages Plant.id returns real localised content for, of the ones this app
 * offers. Verified by request: `hi` comes back fully translated; `pa`, `mr`,
 * `bn` and `te` come back with empty description and treatment.
 *
 * Anything not in this set is requested in English instead — the app's own UI
 * chrome stays in the farmer's language either way, and English text they can
 * have read aloud beats an empty card.
 */
const SUPPORTED_LANGUAGES = new Set(['en', 'hi']);

const DETAIL_FIELDS = [
  'local_name',
  'description',
  'treatment',
  'cause',
  'common_names',
  'classification',
].join(',');

const REQUEST_TIMEOUT_MS = 20_000;

/** Shape of the bits of the v3 response we rely on. */
interface RawResponse {
  access_token?: string;
  result?: {
    is_plant?: { binary?: boolean; probability?: number };
    is_healthy?: { binary?: boolean; probability?: number };
    disease?: {
      suggestions?: Array<{
        name?: string;
        probability?: number;
        similar_images?: Array<{ url?: string; url_small?: string }>;
        details?: {
          local_name?: string | null;
          description?: string | null;
          cause?: string | null;
          common_names?: string[] | null;
          classification?: string[] | null;
          treatment?: {
            chemical?: string[] | null;
            biological?: string[] | null;
            prevention?: string[] | null;
          } | null;
        };
      }>;
    };
  };
}

/** Normalise the requested language to one Plant.id has content for. */
function resolveLanguage(requested: string | undefined): { language: string; fellBack: boolean } {
  const base = (requested ?? 'en').toLowerCase().split(/[-_]/)[0];
  if (SUPPORTED_LANGUAGES.has(base)) return { language: base, fellBack: false };
  return { language: 'en', fellBack: base !== 'en' };
}

function toFinding(
  suggestion: NonNullable<
    NonNullable<NonNullable<RawResponse['result']>['disease']>['suggestions']
  >[number],
): ImageFinding | null {
  if (typeof suggestion.name !== 'string' || typeof suggestion.probability !== 'number') {
    return null;
  }

  const details = suggestion.details ?? {};
  const treatment = details.treatment;

  // An all-empty treatment object is noise on screen — drop it entirely.
  const chemical = treatment?.chemical ?? [];
  const biological = treatment?.biological ?? [];
  const prevention = treatment?.prevention ?? [];
  const hasTreatment = chemical.length + biological.length + prevention.length > 0;

  return {
    name: suggestion.name,
    probability: suggestion.probability,
    commonNames: details.common_names ?? [],
    localName: details.local_name ?? null,
    description: details.description ?? null,
    treatment: hasTreatment ? { chemical, biological, prevention } : null,
    cause: details.cause ?? null,
    classification: details.classification ?? [],
    similarImages: (suggestion.similar_images ?? [])
      .map((img) => img.url_small ?? img.url)
      .filter((url): url is string => typeof url === 'string')
      .slice(0, 3),
  };
}

/**
 * Analyse a crop photo.
 *
 * Returns null on any failure — no key, network trouble, quota exhausted or a
 * malformed response. The caller runs the rule engine regardless, so a null
 * here costs detail, never the farmer's observation.
 *
 * @param imageBase64 Raw base64 of the photo, no data-URL prefix.
 * @param options.language The farmer's language; downgraded if unsupported.
 * @param options.latitude/longitude Improves regional disease priors.
 */
export async function assessPlantHealth(
  imageBase64: string,
  options: VisionOptions = {},
): Promise<ImageAssessment | null> {
  if (!config.PLANT_ID_API_KEY) return null;

  const { language, fellBack } = resolveLanguage(options.language);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const url =
      'https://plant.id/api/v3/health_assessment' +
      `?details=${DETAIL_FIELDS}&language=${language}&full_disease_list=false`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': config.PLANT_ID_API_KEY,
      },
      body: JSON.stringify({
        images: [imageBase64],
        // Reference photos give the farmer something to compare their own
        // plant against, which is often more convincing than a percentage.
        similar_images: true,
        // Skip species identification; we already know what was planted.
        health: 'only',
        ...(typeof options.latitude === 'number' ? { latitude: options.latitude } : {}),
        ...(typeof options.longitude === 'number' ? { longitude: options.longitude } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 429 and 402 mean the trial credits are gone — worth calling out
      // distinctly, since it looks identical to "analysis failed" otherwise.
      const reason =
        response.status === 429 || response.status === 402
          ? 'Plant.id credit limit reached'
          : 'Plant.id request failed';
      logger.warn({ status: response.status }, reason);
      return null;
    }

    const body = (await response.json()) as RawResponse;
    const result = body.result;
    if (!result) return null;

    const findings = (result.disease?.suggestions ?? [])
      .map(toFinding)
      .filter((f): f is ImageFinding => f !== null)
      .slice(0, 5);

    return {
      provider: 'plant-id',
      // A hosted API; the model behind it is not ours to name.
      model: null,
      findings,
      isPlant: result.is_plant?.binary ?? true,
      isPlantProbability: result.is_plant?.probability ?? 1,
      isHealthy: result.is_healthy?.binary ?? false,
      isHealthyProbability: result.is_healthy?.probability ?? 0,
      language,
      languageFellBack: fellBack,
      accessToken: body.access_token ?? null,
      // Plant.id classifies; it does not describe what it saw. Only the local
      // vision model returns symptom text for the rule engine to score.
      observedSymptoms: [],
      affectedParts: [],
      imageQuality: null,
    };
  } catch (err) {
    logger.warn({ err }, 'Plant.id analysis unavailable; using rule engine alone');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
