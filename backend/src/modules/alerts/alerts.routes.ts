import { Router } from 'express';
import { z } from 'zod';
import { handler, userId, ok, objectId, boolParam } from '../../common/http';
import { validateParams, validateQuery, params, query } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import * as service from './alerts.service';

export const alertsRouter = Router();

alertsRouter.use(authenticate);

const farmIdParams = z.object({ farmId: objectId });
const alertIdParams = z.object({ alertId: objectId });
const listQuery = z.object({
  unreadOnly: boolParam(false),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** GET /api/alerts/:farmId */
alertsRouter.get(
  '/:farmId',
  validateParams(farmIdParams),
  validateQuery(listQuery),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const options = query(req, listQuery);
    ok(res, await service.listAlerts(farmId, userId(req), options));
  }),
);

/** POST /api/alerts/:farmId/read-all */
alertsRouter.post(
  '/:farmId/read-all',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const count = await service.markAllRead(farmId, userId(req));
    ok(res, { message: `${count} alert${count === 1 ? '' : 's'} marked as read` });
  }),
);

/** PATCH /api/alerts/item/:alertId/read */
alertsRouter.patch(
  '/item/:alertId/read',
  validateParams(alertIdParams),
  handler(async (req, res) => {
    const { alertId } = params(req, alertIdParams);
    await service.markRead(alertId, userId(req));
    ok(res, { message: 'Marked as read' });
  }),
);

/** PATCH /api/alerts/item/:alertId/dismiss */
alertsRouter.patch(
  '/item/:alertId/dismiss',
  validateParams(alertIdParams),
  handler(async (req, res) => {
    const { alertId } = params(req, alertIdParams);
    await service.dismiss(alertId, userId(req));
    ok(res, { message: 'Dismissed' });
  }),
);
