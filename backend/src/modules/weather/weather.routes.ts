import { Router } from 'express';
import { handler, userId, ok } from '../../common/http';
import { validateBody, validateParams, validateQuery, params, query } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import {
  farmIdParams,
  forecastQuery,
  irrigationQuery,
  alertsQuery,
  logIrrigationBody,
  alertIdParams,
} from './weather.schema';
import * as service from './weather.service';

export const weatherRouter = Router();

weatherRouter.use(authenticate);

/** GET /api/weather/:farmId/forecast — current conditions plus daily outlook. */
weatherRouter.get(
  '/:farmId/forecast',
  validateParams(farmIdParams),
  validateQuery(forecastQuery),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const options = query(req, forecastQuery);
    ok(res, await service.getWeatherForecast(farmId, userId(req), options));
  }),
);

/**
 * GET /api/weather/:farmId/irrigation — the core guidance endpoint.
 * Runs the FAO-56 water balance and returns an actionable recommendation.
 */
weatherRouter.get(
  '/:farmId/irrigation',
  validateParams(farmIdParams),
  validateQuery(irrigationQuery),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const options = query(req, irrigationQuery);
    ok(res, await service.getIrrigationGuidance(farmId, userId(req), options));
  }),
);

/** GET /api/weather/:farmId/alerts */
weatherRouter.get(
  '/:farmId/alerts',
  validateParams(farmIdParams),
  validateQuery(alertsQuery),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const options = query(req, alertsQuery);
    ok(res, { alerts: await service.getWeatherAlerts(farmId, userId(req), options) });
  }),
);

/** POST /api/weather/:farmId/irrigation-log — record that irrigation happened. */
weatherRouter.post(
  '/:farmId/irrigation-log',
  validateParams(farmIdParams),
  validateBody(logIrrigationBody),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, { log: await service.logIrrigation(farmId, userId(req), req.body) }, 201);
  }),
);

/** GET /api/weather/:farmId/irrigation-log */
weatherRouter.get(
  '/:farmId/irrigation-log',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const cropId = typeof req.query.cropId === 'string' ? req.query.cropId : undefined;
    ok(res, { logs: await service.getIrrigationHistory(farmId, userId(req), cropId) });
  }),
);

/** PATCH /api/weather/alerts/:alertId/read */
weatherRouter.patch(
  '/alerts/:alertId/read',
  validateParams(alertIdParams),
  handler(async (req, res) => {
    const { alertId } = params(req, alertIdParams);
    await service.markAlertRead(alertId, userId(req));
    ok(res, { message: 'Alert marked as read' });
  }),
);

/** PATCH /api/weather/alerts/:alertId/dismiss */
weatherRouter.patch(
  '/alerts/:alertId/dismiss',
  validateParams(alertIdParams),
  handler(async (req, res) => {
    const { alertId } = params(req, alertIdParams);
    await service.dismissAlert(alertId, userId(req));
    ok(res, { message: 'Alert dismissed' });
  }),
);
