import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';
import { AuthenticationError } from './errors';
import type { TokenPayload } from '../modules/auth/auth.service';

/** Request carrying an authenticated user, populated by the auth middleware. */
export interface AuthedRequest extends Request {
  user?: TokenPayload;
}

/**
 * Wrap an async handler so rejected promises reach Express's error middleware.
 * Without this, an async throw becomes an unhandled rejection.
 */
export function handler(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

/** Read the authenticated user id, or fail loudly if the route was left unguarded. */
export function userId(req: AuthedRequest): string {
  if (!req.user?.userId) {
    throw new AuthenticationError('Authentication required');
  }
  return req.user.userId;
}

/** Standard success envelope. Mirrors the error envelope in error-handler.ts. */
export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

/**
 * MongoDB ObjectId validator — 24 hex characters.
 * Using this instead of z.string().uuid() matters: an invalid id would
 * otherwise reach Prisma and surface as an opaque 500 instead of a clean 400.
 */
export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

/** Coerce common truthy/falsy query-string spellings into a boolean. */
export const boolParam = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? defaultValue : v === 'true' || v === '1'));
