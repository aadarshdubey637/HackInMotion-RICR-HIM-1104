import { Router } from 'express';
import { handler, userId, ok } from '../../common/http';
import { validateBody, validateParams, validateQuery, params, query } from '../../common/validate';
import { authenticate } from '../auth/auth.middleware';
import {
  createFarmBody,
  updateFarmBody,
  farmIdParams,
  createParcelBody,
  updateParcelBody,
  parcelIdParams,
  createCropBody,
  updateCropBody,
  cropIdParams,
  cropDashboardQuery,
} from './farm.schema';
import * as service from './farm.service';

export const farmRouter = Router();

// Every farm route requires a signed-in user; ownership is enforced per-query
// inside the service so one farmer can never read another's farm.
farmRouter.use(authenticate);

// ─────────────────────────── Reference data ───────────────────────────

/** GET /api/farms/supported-crops — crops with full agronomic backing. */
farmRouter.get(
  '/supported-crops',
  handler(async (_req, res) => {
    ok(res, { crops: service.listSupportedCrops() });
  }),
);

// ─────────────────────────── Farms ───────────────────────────

/** GET /api/farms */
farmRouter.get(
  '/',
  handler(async (req, res) => {
    ok(res, { farms: await service.getUserFarms(userId(req)) });
  }),
);

/** POST /api/farms */
farmRouter.post(
  '/',
  validateBody(createFarmBody),
  handler(async (req, res) => {
    ok(res, { farm: await service.createFarm(userId(req), req.body) }, 201);
  }),
);

/** GET /api/farms/:farmId */
farmRouter.get(
  '/:farmId',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, { farm: await service.getFarmById(farmId, userId(req)) });
  }),
);

/** PATCH /api/farms/:farmId */
farmRouter.patch(
  '/:farmId',
  validateParams(farmIdParams),
  validateBody(updateFarmBody),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, { farm: await service.updateFarm(farmId, userId(req), req.body) });
  }),
);

/** DELETE /api/farms/:farmId — archives rather than destroys. */
farmRouter.delete(
  '/:farmId',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    await service.deleteFarm(farmId, userId(req));
    ok(res, { message: 'Farm archived' });
  }),
);

// ─────────────────────────── Parcels ───────────────────────────

farmRouter.post(
  '/:farmId/parcels',
  validateParams(farmIdParams),
  validateBody(createParcelBody),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, { parcel: await service.createParcel(farmId, userId(req), req.body) }, 201);
  }),
);

farmRouter.get(
  '/:farmId/parcels/:parcelId',
  validateParams(parcelIdParams),
  handler(async (req, res) => {
    const { farmId, parcelId } = params(req, parcelIdParams);
    ok(res, { parcel: await service.getParcelById(farmId, parcelId, userId(req)) });
  }),
);

farmRouter.patch(
  '/:farmId/parcels/:parcelId',
  validateParams(parcelIdParams),
  validateBody(updateParcelBody),
  handler(async (req, res) => {
    const { farmId, parcelId } = params(req, parcelIdParams);
    ok(res, { parcel: await service.updateParcel(farmId, parcelId, userId(req), req.body) });
  }),
);

farmRouter.delete(
  '/:farmId/parcels/:parcelId',
  validateParams(parcelIdParams),
  handler(async (req, res) => {
    const { farmId, parcelId } = params(req, parcelIdParams);
    await service.deleteParcel(farmId, parcelId, userId(req));
    ok(res, { message: 'Plot deleted' });
  }),
);

// ─────────────────────────── Crops ───────────────────────────

farmRouter.get(
  '/:farmId/crops',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, { crops: await service.getFarmCrops(farmId, userId(req)) });
  }),
);

farmRouter.post(
  '/:farmId/crops',
  validateParams(farmIdParams),
  validateBody(createCropBody),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    ok(res, { crop: await service.createCrop(farmId, userId(req), req.body) }, 201);
  }),
);

farmRouter.get(
  '/:farmId/crops/:cropId',
  validateParams(cropIdParams),
  handler(async (req, res) => {
    const { farmId, cropId } = params(req, cropIdParams);
    ok(res, { crop: await service.getCropById(farmId, cropId, userId(req)) });
  }),
);

/** GET /api/farms/:farmId/crops/:cropId/dashboard — everything about one crop. */
farmRouter.get(
  '/:farmId/crops/:cropId/dashboard',
  validateParams(cropIdParams),
  validateQuery(cropDashboardQuery),
  handler(async (req, res) => {
    const { farmId, cropId } = params(req, cropIdParams);
    const options = query(req, cropDashboardQuery);
    ok(res, await service.getCropDashboard(farmId, cropId, userId(req), options));
  }),
);

farmRouter.patch(
  '/:farmId/crops/:cropId',
  validateParams(cropIdParams),
  validateBody(updateCropBody),
  handler(async (req, res) => {
    const { farmId, cropId } = params(req, cropIdParams);
    ok(res, { crop: await service.updateCrop(farmId, cropId, userId(req), req.body) });
  }),
);

farmRouter.delete(
  '/:farmId/crops/:cropId',
  validateParams(cropIdParams),
  handler(async (req, res) => {
    const { farmId, cropId } = params(req, cropIdParams);
    await service.deleteCrop(farmId, cropId, userId(req));
    ok(res, { message: 'Crop removed' });
  }),
);
