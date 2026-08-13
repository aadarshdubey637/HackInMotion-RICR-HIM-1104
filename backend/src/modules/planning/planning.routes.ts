import { Router } from 'express';
import { z } from 'zod';
import { handler, userId, ok, objectId } from '../../common/http';
import { validateBody, validateParams, validateQuery, params, query } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import * as service from './planning.service';

export const planningRouter = Router();

planningRouter.use(authenticate);

const farmIdParams = z.object({ farmId: objectId });
const cropParams = z.object({ farmId: objectId, cropId: objectId });

const historyQuery = z.object({
  cropId: objectId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const recordHarvestBody = z.object({
  actualYieldKg: z
    .number()
    .nonnegative('Harvested weight cannot be negative')
    .max(10_000_000, 'That figure looks too large — please check it is in kilograms'),
});

/** GET /api/planning/:farmId — fertiliser and yield for every active crop. */
planningRouter.get(
  '/:farmId',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, await service.getFarmPlan(farmId, userId(req)));
  }),
);

/** GET /api/planning/:farmId/crops/:cropId/fertilizer */
planningRouter.get(
  '/:farmId/crops/:cropId/fertilizer',
  validateParams(cropParams),
  handler(async (req, res) => {
    const { farmId, cropId } = params(req, cropParams);
    ok(res, await service.getFertilizerPlan(farmId, cropId, userId(req)));
  }),
);

/** GET /api/planning/:farmId/crops/:cropId/yield */
planningRouter.get(
  '/:farmId/crops/:cropId/yield',
  validateParams(cropParams),
  handler(async (req, res) => {
    const { farmId, cropId } = params(req, cropParams);
    ok(res, await service.getYieldPrediction(farmId, cropId, userId(req)));
  }),
);

/**
 * GET /api/planning/:farmId/yield-history
 * Past estimates, newest first — shows how the figure moved through the season.
 * Optional ?cropId= narrows it to one crop.
 */
planningRouter.get(
  '/:farmId/yield-history',
  validateParams(farmIdParams),
  validateQuery(historyQuery),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const options = query(req, historyQuery);
    ok(res, { predictions: await service.getYieldHistory(farmId, userId(req), options) });
  }),
);

/**
 * PATCH /api/planning/:farmId/crops/:cropId/harvest
 * Record the real harvested weight, closing the season for this crop and
 * letting the estimate be scored against it.
 */
planningRouter.patch(
  '/:farmId/crops/:cropId/harvest',
  validateParams(cropParams),
  validateBody(recordHarvestBody),
  handler(async (req, res) => {
    const { farmId, cropId } = params(req, cropParams);
    const { actualYieldKg } = req.body as z.infer<typeof recordHarvestBody>;
    ok(res, await service.recordActualYield(farmId, cropId, userId(req), actualYieldKg));
  }),
);
