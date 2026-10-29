/**
 * Request pipeline helpers: load the signed-in user, guard routes, validate bodies,
 * and turn errors into JSON.
 */
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { isAppAdmin } from '../../shared/permissions.js';
import { fieldErrors } from '../../shared/schemas.js';
import type { Actor } from '../features/users/userRepository.js';
import { ForbiddenError, HttpError, UnauthorizedError, ValidationError } from './errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: Actor | null;
  }
}


/** The signed-in user, or a 401. */
export function currentUser(req: Request): Actor {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

/**
 * Route guard: signed in. Permissions that depend on a calendar are checked by the
 * services, which know which calendar a request is about.
 */
export function requireUser(): RequestHandler {
  return (req, _res, next) => {
    currentUser(req);
    next();
  };
}

/** Route guard: signed in as an app admin. */
export function requireAppAdmin(): RequestHandler {
  return (req, _res, next) => {
    if (!isAppAdmin(currentUser(req))) throw new ForbiddenError();
    next();
  };
}

/** Parse a request body (or query) with a shared Zod schema. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = fieldErrors(result.error);
    throw new ValidationError(Object.values(fields)[0] || 'Please check the form.', fields);
  }
  return result.data;
}

export const errorHandler = (log: { error: (o: unknown, msg?: string) => void }): ErrorRequestHandler =>
  (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...(err.fields ? { fields: err.fields } : {}) });
      return;
    }
    if (err?.code === 'EBADCSRFTOKEN' || err?.message === 'invalid csrf token') {
      res.status(403).json({ error: 'Your session expired. Please reload the page.' });
      return;
    }
    log.error(err, 'Unhandled error');
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  };
