import { Router } from 'express';
import { z } from 'zod';
import { handler, userId, ok, objectId } from '../../common/http';
import { validateParams, params } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import * as service from './recommendations.service';

export const recommendationsRouter = Router();

recommendationsRouter.use(authenticate);

const farmIdParams = z.object({ farmId: objectId });

/**
 * GET /api/recommendations/:farmId
 * Which crops suit this farm, this season — scored on climate, season, soil,
 * water and market.
 */
recommendationsRouter.get(
  '/:farmId',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, await service.getRecommendations(farmId, userId(req)));
  }),
);

/** GET /api/recommendations/:farmId/history — previously generated advice. */
recommendationsRouter.get(
  '/:farmId/history',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, { history: await service.getRecommendationHistory(farmId, userId(req)) });
  }),
);
