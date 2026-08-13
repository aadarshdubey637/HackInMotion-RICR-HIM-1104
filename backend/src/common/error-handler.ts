import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { logger } from './logger';
import { config } from '../config';
import { isAppError } from './errors';

/** Uniform error envelope. The frontend relies on this shape for every failure. */
interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // Must stay in the signature — Express identifies error middleware by arity.
  _next: NextFunction,
): void {
  const context = { path: req.path, method: req.method, ip: req.ip };

  // Operational errors are expected; log them at a level that does not
  // drown out genuine faults.
  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error({ ...context, err }, err.message);
    } else {
      logger.warn({ ...context, code: err.code }, err.message);
    }

    const body: ErrorBody = {
      success: false,
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  logger.error({ ...context, err, stack: err.stack }, 'Unhandled request error');

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'A record with this value already exists',
          details: err.meta?.target,
        },
      } satisfies ErrorBody);
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Record not found' },
      } satisfies ErrorBody);
      return;
    }
  }

  // A malformed ObjectId reaches us as a validation error from the driver.
  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' },
    } satisfies ErrorBody);
    return;
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Cannot reach the database right now. Please try again shortly.',
      },
    } satisfies ErrorBody);
    return;
  }

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      // Never leak internals in production.
      message: config.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
    },
  } satisfies ErrorBody);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
    },
  } satisfies ErrorBody);
}
