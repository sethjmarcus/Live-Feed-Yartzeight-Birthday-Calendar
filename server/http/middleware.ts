/**
 * Request pipeline helpers: load the signed-in user, guard routes, validate bodies,
 * and turn errors into JSON.
 */
import type { ErrorRequestHandler, Request, RequestHandler } from 'express';
import type { ZodType } from 'zod';
import { can, type Permission } from '../../shared/permissions.js';
import { fieldErrors } from '../../shared/schemas.js';
import type { User } from '../features/users/userRepository.js';
import type { UserRepository } from '../features/users/userRepository.js';
import { ForbiddenError, HttpError, UnauthorizedError, ValidationError } from './errors.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: User | null;
  }
}

/** Attach req.user from the session (if the session is still valid for that user). */
export function loadUser(users: UserRepository): RequestHandler {
  return async (req, _res, next) => {
    req.user = null;
    const { uid, sv } = req.session ?? {};
    if (uid) {
      const user = await users.findById(uid);
      if (user && user.active && user.sessionVersion === sv) req.user = user;
    }
    next();
  };
}

export function signIn(req: Request, user: User) {
  req.session!.uid = user.id;
  req.session!.sv = user.sessionVersion;
}
export function signOut(req: Request) {
  req.session = null;
}

/** The signed-in user, or a 401. */
export function currentUser(req: Request): User {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

/** Route guard: signed in, and optionally holding a permission. */
export function requireUser(perm?: Permission): RequestHandler {
  return (req, _res, next) => {
    const user = currentUser(req);
    if (perm && !can(user, perm)) throw new ForbiddenError();
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
