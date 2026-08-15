/**
 * Crop photo analysis — provider-neutral contract.
 *
 * Three engines can look at a farmer's photograph:
 *
 *   1. **Google Gemini**, if `GEMINI_API_KEY` is set. A free key from
 *      https://aistudio.google.com/apikey, no billing account, and the strongest
 *      of the three at plant pathology. Tried first for exactly that reason.
 *   2. A **local Ollama vision model** (gemma3:4b by default). Free, private,
 *      works offline, and — because it is a language model — it can also read
 *      the symptoms off the image in words the rule engine can score.
 *   3. **Plant.id**, if an API key is configured. Narrower but trained
 *      specifically on plant disease, and it returns reference photographs.
 *
 * All three return the same `ImageAssessment` so `diagnosis.ts` never has to
 * know which one ran.
 *
 * Order note: Ollama used to be first, on the reasoning that it costs nothing
 * and needs no key. In practice it needs a multimodal model pulled onto the
 * server, and with none pulled — and no Plant.id key — photo analysis silently
 * never ran at all. Gemini leads because a configured key is a deliberate choice
 * by whoever deployed this, and it is the option most likely to actually answer.
 * Set `VISION_PREFER_LOCAL=true` to put the local model back in front when
 * keeping photographs on the premises matters more than accuracy.
 *
 * None is treated as the answer. Whatever comes back is folded into the
 * differential in diagnosis.ts as one weighted signal among symptoms, weather
 * and host susceptibility.
 */

import type { HealthSeverity } from '@prisma/client';
import { logger } from '../../common/logger';
import { config } from '../../config';
import { assessCropImageWithGemini } from './gemini-vision';
import { assessCropImageWithOllama } from './ollama-vision';
import { assessPlantHealth } from './plant-id';

export type VisionProvider = 'gemini' | 'ollama' | 'plant-id';

export interface ImageTreatment {
  chemical: string[];
  biological: string[];
  prevention: string[];
}

/** One problem the image analysis believes it can see. */
export interface ImageFinding {
  /** Scientific or family name, e.g. "Alternaria solani". */
  name: string;
  /** 0-1, already discounted for provider reliability. */
  probability: number;
  /** Farmer-facing names, e.g. ["Powdery Mildews"]. Plant.id populates these. */
  commonNames: string[];
  /** Name to show the farmer when there is no common name. */
  localName: string | null;
  description: string | null;
  treatment: ImageTreatment | null;
  cause: string | null;
  /** Display label for the problem class, e.g. ["Fungal disease"]. */
  classification: string[];
  /** Reference photos of this problem, for the farmer to compare against. */
  similarImages: string[];
  /** Set when the provider states the class outright, rather than by taxonomy. */
  kind?: 'disease' | 'pest';
  /** How serious the provider thinks this looks. Used only for image-only candidates. */
  severityHint?: HealthSeverity;
}

export interface ImageAssessment {
  provider: VisionProvider;
  /** Model tag, for the record. Null for a hosted API. */
  model: string | null;
  findings: ImageFinding[];
  /** False when the photo is not of a plant at all. */
  isPlant: boolean;
  isPlantProbability: number;
  /** True when the model sees no disease. */
  isHealthy: boolean;
  isHealthyProbability: number;
  /** Language the farmer-facing text above actually came back in. */
  language: string;
  /** True when we had to fall back to English. */
  languageFellBack: boolean;
  /** Lets a stored Plant.id assessment be re-read without spending a credit. */
  accessToken: string | null;
  /**
   * Short English symptom phrases read off the photograph — "concentric brown
   * rings", "white powdery coating". These are scored against the curated
   * symptom vocabulary exactly like the farmer's own words, which is what turns
   * a photo into evidence the rule engine can corroborate rather than a verdict
   * it has to take on trust. Empty for providers that do not describe.
   */
  observedSymptoms: string[];
  /** Which parts of the plant are affected, e.g. ["leaf", "fruit"]. */
  affectedParts: string[];
  /** How readable the photo was. Drives the "retake it" advice. */
  imageQuality: 'good' | 'acceptable' | 'poor' | null;
}

export interface VisionOptions {
  /** The farmer's language; farmer-facing text is requested in it. */
  language?: string;
  latitude?: number;
  longitude?: number;
  /** What the farmer says is planted, so the model judges the right host. */
  cropLabel?: string;
  /** Curated problem names for this crop — steers naming onto our vocabulary. */
  knownProblems?: string[];
  /** The farmer's own description, as a clue. Never as a fact. */
  description?: string;
  /** When the photo was taken; season matters for what is plausible. */
  observedAt?: Date;
  /**
   * The uploaded file's MIME type, as recorded by multer.
   *
   * Hosted providers must be told what they are being sent. Guessing from the
   * bytes is possible and is done as a fallback, but the upload already knew.
   */
  mimeType?: string;
}

/**
 * Analyse a crop photo with whichever engine is available.
 *
 * Returns null only when every engine is unavailable or fails. The caller runs
 * the rule engine regardless, so a null here costs detail, never the farmer's
 * observation.
 *
 * @param imageBase64 Raw base64 of the photo, no data-URL prefix.
 */
export async function analyseCropImage(
  imageBase64: string,
  options: VisionOptions = {},
): Promise<ImageAssessment | null> {
  // Each entry is attempted in turn. A truthy result wins immediately — note
  // that includes a "not a plant" or "looks healthy" verdict, which are real
  // answers, not failures: there is nothing to gain from re-asking a second
  // engine about a photo of somebody's shoe.
  const attempts: Array<{ name: VisionProvider; run: () => Promise<ImageAssessment | null> }> = [];

  const gemini = {
    name: 'gemini' as const,
    run: () => assessCropImageWithGemini(imageBase64, options),
  };
  const ollama = {
    name: 'ollama' as const,
    run: () => assessCropImageWithOllama(imageBase64, options),
  };

  if (config.VISION_PREFER_LOCAL) {
    if (config.OLLAMA_VISION_ENABLED) attempts.push(ollama);
    if (config.GEMINI_API_KEY) attempts.push(gemini);
  } else {
    if (config.GEMINI_API_KEY) attempts.push(gemini);
    if (config.OLLAMA_VISION_ENABLED) attempts.push(ollama);
  }

  if (config.PLANT_ID_API_KEY) {
    attempts.push({ name: 'plant-id', run: () => assessPlantHealth(imageBase64, options) });
  }

  for (const attempt of attempts) {
    const assessment = await attempt.run();
    if (assessment) return assessment;
    logger.debug({ provider: attempt.name }, 'Vision provider declined; trying the next');
  }

  // Naming what is missing, rather than "no engine available". This line is the
  // only trace of *why* a farmer's photo went unread, and "set GEMINI_API_KEY"
  // is a fix somebody can act on.
  logger.warn(
    { attempted: attempts.map((a) => a.name) },
    attempts.length === 0
      ? 'No image analysis engine is configured — set GEMINI_API_KEY (free: https://aistudio.google.com/apikey) or pull an Ollama vision model. Diagnosing from description and weather alone.'
      : 'Every configured image analysis engine failed; diagnosing from description and weather alone',
  );
  return null;
}
