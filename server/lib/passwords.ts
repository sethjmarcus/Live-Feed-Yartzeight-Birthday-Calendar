/** Password hashing with scrypt (built into Node; compatible with earlier versions of this app). */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/**
 * A hash to check against when the username doesn't exist, so a wrong username takes as
 * long to reject as a wrong password (otherwise response time reveals which usernames exist).
 */
let dummy: Promise<string> | undefined;
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  return dummy;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, PARAMS);
  return crypto.timingSafeEqual(expected, actual);
}
