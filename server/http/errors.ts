/**
 * Errors thrown by services; the error handler turns them into JSON responses.
 */
export class HttpError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}
export class ValidationError extends HttpError {
  constructor(message: string, fields?: Record<string, string>) { super(400, message, fields); }
}
export class UnauthorizedError extends HttpError {
  constructor(message = 'Please sign in.') { super(401, message); }
}
export class ForbiddenError extends HttpError {
  constructor(message = "You don't have permission for that.") { super(403, message); }
}
export class NotFoundError extends HttpError {
  constructor(message = 'Not found.') { super(404, message); }
}
export class GoneError extends HttpError {
  constructor(message: string) { super(410, message); }
}
