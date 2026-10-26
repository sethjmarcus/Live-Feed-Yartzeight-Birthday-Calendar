import crypto from 'node:crypto';
import type { ChangeDTO } from '../../shared/api.js';

export const nowIso = () => new Date().toISOString();
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

/** Field-by-field differences between two objects (for the activity log). */
export function diff<T extends object>(before: T, after: T, fields: (keyof T & string)[]): ChangeDTO[] {
  return fields
    .filter(f => JSON.stringify(before[f] ?? null) !== JSON.stringify(after[f] ?? null))
    .map(f => ({ field: f, from: before[f] ?? null, to: after[f] ?? null }));
}

export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map(k => [k, obj[k]])) as Pick<T, K>;
}
