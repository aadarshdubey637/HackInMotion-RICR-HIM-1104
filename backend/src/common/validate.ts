import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ValidationError } from './errors';

/**
 * Zod validation middleware.
 *
 * Errors are passed to `next()` rather than thrown. Express 4 does not catch
 * exceptions from async handlers, so throwing here would produce an
 * unhandled rejection and take the process down instead of returning a 400.
 */

/** Flatten Zod issues into a `field -> message` map the frontend can render inline. */
function toDetails(error: ZodError): Record<string, string> {
  const details: Record<string, string> = {};
  for (const issue of error.errors) {
    const path = issue.path.join('.') || '_';
    // Keep the first message per field — that is the one worth showing.
    if (!(path in details)) details[path] = issue.message;
  }
  return details;
}

function handle(error: unknown, next: NextFunction): void {
  if (error instanceof ZodError) {
    next(new ValidationError('Please check the highlighted fields', toDetails(error)));
    return;
  }
  next(error);
}

/** Validate and replace `req.body` with the parsed (and coerced) result. */
export function validateBody<T extends ZodTypeAny>(schema: T): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.body = await schema.parseAsync(req.body);
      next();
    } catch (error) {
      handle(error, next);
    }
  };
}

/**
 * Validate `req.query`.
 *
 * The parsed result is stashed on `req.validatedQuery` instead of reassigning
 * `req.query`, which is a getter-only property in Express 5 and silently
 * fails there. Handlers should read from the helper below.
 */
export function validateQuery<T extends ZodTypeAny>(schema: T): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync(req.query);
      (req as Request & { validatedQuery?: unknown }).validatedQuery = parsed;
      next();
    } catch (error) {
      handle(error, next);
    }
  };
}

export function validateParams<T extends ZodTypeAny>(schema: T): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync(req.params);
      (req as Request & { validatedParams?: unknown }).validatedParams = parsed;
      next();
    } catch (error) {
      handle(error, next);
    }
  };
}

/** Typed accessor for whatever `validateQuery` parsed. */
export function query<T extends ZodTypeAny>(req: Request, _schema?: T): z.infer<T> {
  return (
    (req as Request & { validatedQuery?: z.infer<T> }).validatedQuery ?? (req.query as z.infer<T>)
  );
}

/** Typed accessor for whatever `validateParams` parsed. */
export function params<T extends ZodTypeAny>(req: Request, _schema?: T): z.infer<T> {
  return (
    (req as Request & { validatedParams?: z.infer<T> }).validatedParams ??
    (req.params as z.infer<T>)
  );
}
