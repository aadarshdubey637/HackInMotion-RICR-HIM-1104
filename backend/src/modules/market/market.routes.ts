import { Router } from 'express';
import { handler, userId, ok } from '../../common/http';
import { validateParams, validateQuery, params, query } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import { farmIdParams, commodityParams, trendQuery, farmTrendsQuery } from './market.schema';
import * as service from './market.service';

export const marketRouter = Router();

marketRouter.use(authenticate);

/** GET /api/market/locations — get all unique states, districts, and markets. */
marketRouter.get(
  '/locations',
  handler(async (req, res) => {
    ok(res, await service.getUniqueLocations());
  }),
);

/** GET /api/market/farm/:farmId — price trends for every crop on this farm. */
marketRouter.get(
  '/farm/:farmId',
  validateParams(farmIdParams),
  validateQuery(farmTrendsQuery),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const { state, district, market } = query(req, farmTrendsQuery);
    ok(res, await service.getFarmPriceTrends(farmId, userId(req), { state, district, market }));
  }),
);

/** GET /api/market/commodity/:commodity — trend for a single commodity.  */
marketRouter.get(
  '/commodity/:commodity',
  validateParams(commodityParams),
  validateQuery(trendQuery),
  handler(async (req, res) => {
    const { commodity } = params(req, commodityParams);
    const { days, state, district, market } = query(req, trendQuery);
    ok(res, await service.getPriceTrend(commodity, days, { state, district, market }));
  }),
);

/** POST /api/market/sync/:commodity — pull the latest mandi snapshot on demand. */
marketRouter.post(
  '/sync/:commodity',
  validateParams(commodityParams),
  handler(async (req, res) => {
    const { commodity } = params(req, commodityParams);
    const ingested = await service.syncCommodityPrices(commodity);
    ok(res, {
      ingested,
      message:
        ingested > 0
          ? `Updated ${ingested} price records for ${commodity}.`
          : 'No new prices available right now. Showing stored history.',
    });
  }),
);
