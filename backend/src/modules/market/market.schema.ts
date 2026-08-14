import { z } from 'zod';
import { objectId } from '../../common/http';

export const farmIdParams = z.object({ farmId: objectId });

export const commodityParams = z.object({
  commodity: z.string().trim().min(1).max(80),
});

/** Optional mandi scope shared by the trend endpoints. */
const scopeShape = {
  state: z.string().trim().max(100).optional(),
  district: z.string().trim().max(100).optional(),
  market: z.string().trim().max(100).optional(),
};

export const trendQuery = z.object({
  days: z.coerce.number().int().min(7).max(180).default(60),
  ...scopeShape,
});

export const farmTrendsQuery = z.object(scopeShape);

export type TrendQuery = z.infer<typeof trendQuery>;
export type FarmTrendsQuery = z.infer<typeof farmTrendsQuery>;

