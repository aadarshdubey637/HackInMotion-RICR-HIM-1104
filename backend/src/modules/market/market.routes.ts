import { Router } from 'express';
import { handler, userId, ok } from '../../common/http';
import { validateParams, validateQuery, params, query } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import { farmIdParams, commodityParams, trendQuery } from './market.schema';
import * as service from './market.service';

export const marketRouter = Router();

marketRouter.use(authenticate);

/** GET /api/market/farm/:farmId — price trends for every crop on this farm. */
marketRouter.get(
  '/farm/:farmId',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, await service.getFarmPriceTrends(farmId, userId(req)));
  }),
);

/** GET /api/market/commodity/:commodity — trend for a single commodity.  */
marketRouter.get(
  '/commodity/:commodity',
  validateParams(commodityParams),
  validateQuery(trendQuery),
  handler(async (req, res) => {
    const { commodity } = params(req, commodityParams);
    const { days } = query(req, trendQuery);
    ok(res, await service.getPriceTrend(commodity, days));
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
