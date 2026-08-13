import { z } from 'zod';
import { objectId, boolParam } from '../../common/http';

const IRRIGATION_METHODS = [
  'DRIP',
  'SPRINKLER',
  'FLOOD',
  'FURROW',
  'SUBSURFACE',
  'MANUAL',
  'RAINFED',
] as const;

export const farmIdParams = z.object({ farmId: objectId });

export const forecastQuery = z.object({
  days: z.coerce.number().int().min(1).max(14).default(7),
  /** Bypass the 1-hour cache. Used by the dashboard's manual refresh. */
  force: boolParam(false),
});

export const irrigationQuery = z.object({
  cropId: objectId.optional(),
});

export const alertsQuery = z.object({
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  unreadOnly: boolParam(false),
});

export const logIrrigationBody = z.object({
  cropId: objectId,
  waterAmountMm: z
    .number()
    .positive('Water amount must be greater than zero')
    .max(500, 'That looks too high — please check the amount'),
  irrigationMethod: z.enum(IRRIGATION_METHODS),
  irrigatedAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Not a valid date')
    .optional(),
  guidanceSource: z.string().max(50).optional(),
  wasRecommended: z.boolean().optional(),
});

export const alertIdParams = z.object({ alertId: objectId });

export type ForecastQuery = z.infer<typeof forecastQuery>;
export type IrrigationQuery = z.infer<typeof irrigationQuery>;
export type AlertsQuery = z.infer<typeof alertsQuery>;
export type LogIrrigationInput = z.infer<typeof logIrrigationBody>;
