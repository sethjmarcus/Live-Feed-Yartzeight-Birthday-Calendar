/**
 * Password hashing with scrypt (built into Node).
 *
 * Settings follow OWASP's scrypt guidance: N=2^14, r=8, p=5. That's as strong as N=2^17
 * with p=1, but uses 16 MB of memory per hash instead of 128 MB (which matters on a small
 * server). Hashes record their settings, so older ones (N=2^14, p=1) still verify and are
 * upgraded the next time that person signs in.
 *
 *   current:  scrypt$N=16384,r=8,p=5$<salt>$<hash>
 *   legacy:   scrypt$<salt>$<hash>            (N=16384, r=8, p=1)
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const CURRENT = { N: 16384, r: 8, p: 5 };
const LEGACY = { N: 16384, r: 8, p: 1 };
const label = (o: typeof CURRENT) => `N=${o.N},r=${o.r},p=${o.p}`;
const MAXMEM = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, { ...CURRENT, maxmem: MAXMEM });
  return `scrypt$${label(CURRENT)}$${salt.toString('base64')}$${hash.toString('base64')}`;
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

function parseHash(stored: string): { params: typeof CURRENT; salt: Buffer; hash: Buffer } | null {
  const parts = stored.split('$');
  if (parts[0] !== 'scrypt') return null;
  if (parts.length === 3) return { params: LEGACY, salt: Buffer.from(parts[1], 'base64'), hash: Buffer.from(parts[2], 'base64') };
  if (parts.length !== 4) return null;
  const m = parts[1].match(/^N=(\d+),r=(\d+),p=(\d+)$/);
  if (!m) return null;
  const params = { N: Number(m[1]), r: Number(m[2]), p: Number(m[3]) };
  if (params.N > 2 ** 17 || params.r > 16 || params.p > 16) return null; // refuse absurd settings
  return { params, salt: Buffer.from(parts[2], 'base64'), hash: Buffer.from(parts[3], 'base64') };
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const parsed = stored ? parseHash(stored) : null;
  if (!parsed || parsed.hash.length < 32) return false;
  const actual = await scrypt(String(password), parsed.salt, parsed.hash.length, { ...parsed.params, maxmem: 256 * 1024 * 1024 });
  return crypto.timingSafeEqual(parsed.hash, actual);
}

/** True for hashes made with older settings — rehash after a successful sign-in. */
export function needsRehash(stored: string | null): boolean {
  return !!stored && !stored.startsWith(`scrypt$${label(CURRENT)}$`);
}
