import { Router, type Request, type Response, type NextFunction } from 'express';
import { MulterError } from 'multer';
import { handler, userId, ok } from '../../common/http';
import { validateBody, validateParams, validateQuery, params, query } from '../../common/validate';
import { cropPhotoUpload, storeImage } from '../../common/upload';
import { ValidationError } from '../../common/errors';
import { authenticate } from '../auth/auth.middleware';
import {
  farmIdParams,
  logIdParams,
  createObservationBody,
  updateObservationBody,
  listObservationsQuery,
  createCommunityReportBody,
} from './crop-health.schema';
import * as service from './crop-health.service';

export const cropHealthRouter = Router();

cropHealthRouter.use(authenticate);

/**
 * Multer errors (file too large, wrong type) must become clean 400s rather
 * than 500s — a failed photo upload is a normal thing for a farmer to hit on
 * a poor connection.
 */
function uploadPhoto(req: Request, res: Response, next: NextFunction): void {
  cropPhotoUpload(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'That photo is too large. Please use an image under 8 MB.'
          : 'We could not read that photo. Please try again.';
      next(new ValidationError(message));
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

/**
 * POST /api/crop-health/:farmId/observations
 *
 * Accepts multipart/form-data with an optional `image` file alongside the
 * text fields. Works without a photo — the description alone is enough to
 * run the diagnostic engine.
 */
cropHealthRouter.post(
  '/:farmId/observations',
  validateParams(farmIdParams),
  uploadPhoto,
  validateBody(createObservationBody),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);

    // A disk write failure must not lose the observation — fall back to
    // recording it without the photo.
    let image = null;
    if (req.file) {
      try {
        image = storeImage(req.file);
      } catch {
        image = null;
      }
    }

    const result = await service.createObservation(farmId, userId(req), req.body, image);

    ok(
      res,
      {
        log: result.log,
        diagnosis: result.diagnosis,
        imageStored: Boolean(image),
        ...(req.file && !image
          ? { warning: 'Your observation was saved, but the photo could not be stored.' }
          : {}),
      },
      201,
    );
  }),
);

/** GET /api/crop-health/:farmId/observations */
cropHealthRouter.get(
  '/:farmId/observations',
  validateParams(farmIdParams),
  validateQuery(listObservationsQuery),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const options = query(req, listObservationsQuery);
    ok(res, { observations: await service.listObservations(farmId, userId(req), options) });
  }),
);

/** GET /api/crop-health/:farmId/observations/:logId */
cropHealthRouter.get(
  '/:farmId/observations/:logId',
  validateParams(logIdParams),
  handler(async (req, res) => {
    const { farmId, logId } = params(req, logIdParams);
    ok(res, { observation: await service.getObservation(farmId, logId, userId(req)) });
  }),
);

/** PATCH /api/crop-health/:farmId/observations/:logId — mark treated/resolved. */
cropHealthRouter.patch(
  '/:farmId/observations/:logId',
  validateParams(logIdParams),
  validateBody(updateObservationBody),
  handler(async (req, res) => {
    const { farmId, logId } = params(req, logIdParams);
    ok(res, { observation: await service.updateObservation(farmId, logId, userId(req), req.body) });
  }),
);

/** DELETE /api/crop-health/:farmId/observations/:logId */
cropHealthRouter.delete(
  '/:farmId/observations/:logId',
  validateParams(logIdParams),
  handler(async (req, res) => {
    const { farmId, logId } = params(req, logIdParams);
    await service.deleteObservation(farmId, logId, userId(req));
    ok(res, { message: 'Observation deleted' });
  }),
);

/**
 * GET /api/crop-health/:farmId/nearby
 * Anonymous aggregate of severe problems reported by farms in the same area —
 * early warning for a spreading outbreak.
 */
cropHealthRouter.get(
  '/:farmId/nearby',
  validateParams(farmIdParams),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);
    const radius = Number(req.query.radiusKm) || 5;
    ok(res, await service.nearbyOutbreaks(farmId, userId(req), Math.min(radius, 200)));
  }),
);

/**
 * POST /api/crop-health/:farmId/community-reports
 * Submit a manual crop health report for community alerts.
 */
cropHealthRouter.post(
  '/:farmId/community-reports',
  validateParams(farmIdParams),
  uploadPhoto,
  validateBody(createCommunityReportBody),
  handler(async (req, res) => {
    const { farmId } = params(req, farmIdParams);

    let image = null;
    if (req.file) {
      try {
        image = storeImage(req.file);
      } catch {
        image = null;
      }
    }

    const log = await service.createCommunityReport(farmId, userId(req), req.body, image);

    ok(
      res,
      {
        log,
        imageStored: Boolean(image),
        ...(req.file && !image
          ? { warning: 'Your report was saved, but the photo could not be stored.' }
          : {}),
      },
      201,
    );
  }),
);

