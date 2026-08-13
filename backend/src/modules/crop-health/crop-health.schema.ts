import { z } from 'zod';
import { objectId } from '../../common/http';

const OBSERVATION_TYPES = [
  'DISEASE',
  'PEST',
  'NUTRIENT',
  'GROWTH',
  'WEATHER_DAMAGE',
  'OTHER',
] as const;

export const farmIdParams = z.object({ farmId: objectId });
export const logIdParams = z.object({ farmId: objectId, logId: objectId });

/**
 * A health observation. The image arrives as a multipart file (handled by
 * multer) rather than in the JSON body, so it is not part of this schema.
 */
export const createObservationBody = z.object({
  cropId: objectId,
  description: z
    .string()
    .trim()
    .min(5, 'Please describe what you are seeing — even a few words helps')
    .max(2000),
  observationType: z.enum(OBSERVATION_TYPES).default('OTHER'),
  observedAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Not a valid date')
    .optional(),
  /**
   * The language the farmer is currently using in the app, so image-analysis
   * descriptions can be requested in it. Sent per-observation rather than read
   * from the profile alone, because the language picker changes immediately
   * while the saved profile may lag behind.
   */
  language: z.string().trim().min(2).max(10).optional(),
});

export const updateObservationBody = z.object({
  status: z.enum(['ACTIVE', 'MONITORING', 'TREATED', 'RESOLVED']).optional(),
  description: z.string().trim().min(5).max(2000).optional(),
});

export const listObservationsQuery = z.object({
  cropId: objectId.optional(),
  status: z.enum(['ACTIVE', 'MONITORING', 'TREATED', 'RESOLVED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateObservationInput = z.infer<typeof createObservationBody>;
export type UpdateObservationInput = z.infer<typeof updateObservationBody>;
export type ListObservationsQuery = z.infer<typeof listObservationsQuery>;
