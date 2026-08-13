import { Router } from 'express';
import { z } from 'zod';
import { handler, userId, ok, objectId } from '../../common/http';
import { validateParams, params } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import { getDashboard } from './dashboard.service';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

const farmIdParams = z.object({ farmId: objectId });

/**
 * GET /api/dashboard/:farmId
 * Everything the farmer needs on one screen, with a ranked action list.
 */
dashboardRouter.get(
  '/:farmId',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, await getDashboard(farmId, userId(req)));
  }),
);
