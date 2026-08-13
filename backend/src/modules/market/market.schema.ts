import { z } from 'zod';
import { objectId } from '../../common/http';

export const farmIdParams = z.object({ farmId: objectId });

export const commodityParams = z.object({
  commodity: z.string().trim().min(1).max(80),
});

export const trendQuery = z.object({
  days: z.coerce.number().int().min(7).max(180).default(60),
});

export const farmTrendsQuery = z.object({
  market: z.string().trim().max(100).optional(),
});

export type TrendQuery = z.infer<typeof trendQuery>;
export type FarmTrendsQuery = z.infer<typeof farmTrendsQuery>;

