import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment contract.
 *
 * Only DATABASE_URL and JWT_SECRET are genuinely required — everything else
 * has a working default. This is deliberate: a missing third-party key must
 * degrade one feature, never prevent the server from booting.
 */
/**
 * Values that have appeared in this repository's example files.
 *
 * Matched case-insensitively and by prefix, so an edited-but-not-really
 * placeholder ("REPLACE_WITH...-v2") is still caught.
 */
const PLACEHOLDER_SECRETS = [
  'replace_with',
  'dev-only-secret',
  'your-super-secret',
  'change-in-production',
  'changeme',
];

function isPlaceholderSecret(value: string): boolean {
  const normalised = value.trim().toLowerCase();
  return PLACEHOLDER_SECRETS.some((placeholder) => normalised.includes(placeholder));
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  /**
   * Signs every access and refresh token, so knowing it means being able to
   * mint one for any account.
   *
   * The length check alone is not enough. `npm run setup` copies
   * `.env.example` to `backend/.env`, and a placeholder long enough to satisfy
   * `min(32)` would sail through — leaving a server signing tokens with a
   * string published in the repository. So known placeholders are rejected by
   * name, and the failure is at boot rather than silent.
   */
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .refine((value) => !isPlaceholderSecret(value), {
      message:
        'JWT_SECRET is still the example placeholder. Generate a real one: openssl rand -base64 48',
    }),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().default(10),

  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Where uploaded crop photos are written. Local disk keeps the demo
  // dependency-free; swap for S3/Cloudinary by changing this one path.
  UPLOAD_DIR: z.string().default('uploads'),
  PUBLIC_URL: z.string().default('http://localhost:3001'),

  // ── Hosted vision model (Google Gemini) ──
  // The primary crop-photo analyser. Gemini accepts an image plus a JSON
  // schema and is markedly better at plant pathology than a small local model,
  // which is why it is tried first when a key is present.
  //
  // The key is free: https://aistudio.google.com/apikey — no billing account,
  // and the free tier's per-minute limits are far above what one farm's photo
  // uploads will reach. Unset simply means this provider is skipped.
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_VISION_MODEL: z.string().default('gemini-2.5-flash'),
  // 90s, not 45s. Measured latency for a real crop photo is 30-40s even with
  // thinking disabled, so a 45s budget aborted analyses that were about to
  // succeed — and an abort costs the farmer the whole photo analysis.
  GEMINI_TIMEOUT_MS: z.coerce.number().default(90_000),

  // ── Local vision model (Ollama) ──
  // Fallback for when there is no Gemini key, or no internet: a multimodal
  // model running on this machine — no key, no per-photo cost, no image
  // leaving the network. Probed before use, so a stopped Ollama simply falls
  // through to the rule engine.
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  // Must be a model that actually exists and can see images. The previous
  // default, `gemma4:e4b`, is not a published Ollama tag at all, so the
  // availability probe failed on every machine and photo analysis silently
  // never ran. `ollama pull gemma3:4b` is a ~3 GB download.
  OLLAMA_VISION_MODEL: z.string().default('gemma3:4b'),
  // Anything but false/0/no/off leaves it on.
  OLLAMA_VISION_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : !/^(false|0|no|off)$/i.test(value.trim()))),
  // Generous: a cold 9 GB model on a CPU-only machine can take a minute for
  // its first photo. Subsequent ones are fast while OLLAMA_KEEP_ALIVE holds.
  OLLAMA_TIMEOUT_MS: z.coerce.number().default(120_000),
  OLLAMA_KEEP_ALIVE: z.string().default('10m'),

  // Put the local model ahead of Gemini in the provider chain. For deployments
  // where crop photographs must not leave the premises, at some cost in
  // accuracy. Off by default.
  VISION_PREFER_LOCAL: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? false : /^(true|1|yes|on)$/i.test(value.trim()))),

  // ── Optional third-party keys ──
  // Weather needs NO key (Open-Meteo). These are upgrade paths only.
  OPENWEATHER_API_KEY: z.string().optional(),
  PLANT_ID_API_KEY: z.string().optional(),
  DATA_GOV_IN_API_KEY: z.string().optional(),

  // Google Sign-In. Only the client id is needed: we verify the ID token the
  // browser obtained, rather than running a server-side code exchange, so
  // there is no client *secret* anywhere in this system. Unset simply means
  // the "Continue with Google" button is not offered.
  GOOGLE_CLIENT_ID: z.string().optional(),

  // ── Email OTP delivery (Gmail SMTP) ──
  // Both must be present for OTP email to send; either one alone is a
  // half-configured mailbox, which `features.email` below treats as off.
  EMAIL_USER: z.string().email('EMAIL_USER must be an email address').optional(),

  // A Google App Password — 16 characters, no spaces. Google displays it in
  // four groups of four, and pasting it that way is the single most common
  // way this ends up failing to authenticate, so the spaces are stripped
  // here rather than rejected: the grouped form is what the user was shown.
  EMAIL_APP_PASSWORD: z
    .string()
    .transform((value) => value.replace(/\s/g, ''))
    .refine((value) => value.length === 16, {
      message: 'EMAIL_APP_PASSWORD must be a 16-character Google App Password',
    })
    .optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.flatten().fieldErrors;
    console.error('\n  Invalid environment configuration:\n');
    for (const [key, messages] of Object.entries(issues)) {
      console.error(`   - ${key}: ${(messages ?? []).join(', ')}`);
    }
    console.error('\n  Copy .env.example to backend/.env and fill in the values.\n');
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export const isDevelopment = config.NODE_ENV === 'development';
export const isProduction = config.NODE_ENV === 'production';

/** Feature availability, derived from which keys are actually present. */
export const features = {
  /** Hosted crop-photo analysis. The primary provider when configured. */
  geminiVision: Boolean(config.GEMINI_API_KEY),
  /** Local crop-photo analysis. Availability is re-checked at request time. */
  ollamaVision: config.OLLAMA_VISION_ENABLED,
  plantIdApi: Boolean(config.PLANT_ID_API_KEY),
  /**
   * Whether *any* engine can look at a photograph.
   *
   * Worth naming separately: with none of the three configured the app still
   * accepts photos and still returns a diagnosis, but that diagnosis is drawn
   * from the description and weather alone. That is a materially weaker answer
   * and the farmer is told so rather than left to assume the photo was read.
   */
  get cropPhotoAnalysis(): boolean {
    return this.geminiVision || this.ollamaVision || this.plantIdApi;
  },
  dataGovIn: Boolean(config.DATA_GOV_IN_API_KEY),
  googleAuth: Boolean(config.GOOGLE_CLIENT_ID),
  // Both halves required: a username with no app password cannot authenticate
  // to Gmail, and an app password with no username has no mailbox to send from.
  email: Boolean(config.EMAIL_USER && config.EMAIL_APP_PASSWORD),
} as const;
