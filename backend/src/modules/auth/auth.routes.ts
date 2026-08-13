import { Router } from 'express';
import { handler, userId, ok } from '../../common/http';
import { validateBody } from '../../common/validate';
import { authenticate } from './auth.middleware';
import {
  registerSchema,
  loginSchema,
  refreshTokenSchema,
  changePasswordSchema,
  updateProfileSchema,
} from './auth.schema';
import * as service from './auth.service';

export const authRouter = Router();

/** POST /api/auth/register — create a farmer account. */
authRouter.post(
  '/register',
  validateBody(registerSchema),
  handler(async (req, res) => {
    const result = await service.register(req.body);
    ok(res, result, 201);
  }),
);

/** POST /api/auth/login */
authRouter.post(
  '/login',
  validateBody(loginSchema),
  handler(async (req, res) => {
    const result = await service.login(req.body);
    ok(res, result);
  }),
);

/** POST /api/auth/refresh — exchange a refresh token for a new pair. */
authRouter.post(
  '/refresh',
  validateBody(refreshTokenSchema),
  handler(async (req, res) => {
    const tokens = await service.refreshTokens(req.body.refreshToken);
    ok(res, { tokens });
  }),
);

/** POST /api/auth/logout — invalidate one session. */
authRouter.post(
  '/logout',
  validateBody(refreshTokenSchema),
  handler(async (req, res) => {
    await service.logout(req.body.refreshToken);
    ok(res, { message: 'Logged out' });
  }),
);

/** GET /api/auth/me — current user profile. */
authRouter.get(
  '/me',
  authenticate,
  handler(async (req, res) => {
    const user = await service.getProfile(userId(req));
    ok(res, { user });
  }),
);

/** PATCH /api/auth/me */
authRouter.patch(
  '/me',
  authenticate,
  validateBody(updateProfileSchema),
  handler(async (req, res) => {
    const user = await service.updateProfile(userId(req), req.body);
    ok(res, { user });
  }),
);

/** POST /api/auth/change-password — also revokes every other session. */
authRouter.post(
  '/change-password',
  authenticate,
  validateBody(changePasswordSchema),
  handler(async (req, res) => {
    await service.changePassword(userId(req), req.body);
    ok(res, { message: 'Password changed. Please sign in again.' });
  }),
);
