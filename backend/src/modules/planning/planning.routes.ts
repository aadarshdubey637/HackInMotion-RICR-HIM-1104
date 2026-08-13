import { Router } from 'express';
import { z } from 'zod';
import { handler, userId, ok, objectId } from '../../common/http';
import { validateParams, params } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import * as service from './planning.service';

export const planningRouter = Router();

planningRouter.use(authenticate);

const farmIdParams = z.object({ farmId: objectId });
const cropParams = z.object({ farmId: objectId, cropId: objectId });

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
