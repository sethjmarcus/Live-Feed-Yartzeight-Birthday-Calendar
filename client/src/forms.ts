/**
 * Glue between react-hook-form and the API's validation errors.
 */
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/** Show server-side field errors next to their inputs; returns a message for anything else. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>): string {
  if (err instanceof ApiError) {
    const entries = Object.entries(err.fields);
    for (const [field, message] of entries) setError(field as Path<T>, { type: 'server', message });
    return entries.length ? '' : err.message;
  }
  return 'Something went wrong. Please try again.';
}
