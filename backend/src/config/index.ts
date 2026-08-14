import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment contract.
 *
 * Only DATABASE_URL and JWT_SECRET are genuinely required — everything else
 * has a working default. This is deliberate: a missing third-party key must
 * degrade one feature, never prevent the server from booting.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().default(10),

  FRONTEND_URL: z.string().default('http://localhost:3000'),

  // Where uploaded crop photos are written. Local disk keeps the demo
  // dependency-free; swap for S3/Cloudinary by changing this one path.
  UPLOAD_DIR: z.string().default('uploads'),
  PUBLIC_URL: z.string().default('http://localhost:3001'),

  // ── Local vision model (Ollama) ──
  // Crop photos are analysed by a multimodal model running on this machine:
  // no key, no per-photo cost, no image leaving the network. Enabled by
  // default and probed before use, so a stopped Ollama simply falls through to
  // the rule engine.
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_VISION_MODEL: z.string().default('gemma4:e4b'),
  // Anything but false/0/no/off leaves it on.
  OLLAMA_VISION_ENABLED: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? true : !/^(false|0|no|off)$/i.test(value.trim()))),
  // Generous: a cold 9 GB model on a CPU-only machine can take a minute for
  // its first photo. Subsequent ones are fast while OLLAMA_KEEP_ALIVE holds.
  OLLAMA_TIMEOUT_MS: z.coerce.number().default(120_000),
  OLLAMA_KEEP_ALIVE: z.string().default('10m'),

  // ── Optional third-party keys ──
  // Weather needs NO key (Open-Meteo). These are upgrade paths only.
  OPENWEATHER_API_KEY: z.string().optional(),
  PLANT_ID_API_KEY: z.string().optional(),
  DATA_GOV_IN_API_KEY: z.string().optional(),
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
  /** Local crop-photo analysis. Availability is re-checked at request time. */
  ollamaVision: config.OLLAMA_VISION_ENABLED,
  plantIdApi: Boolean(config.PLANT_ID_API_KEY),
  dataGovIn: Boolean(config.DATA_GOV_IN_API_KEY),
} as const;
