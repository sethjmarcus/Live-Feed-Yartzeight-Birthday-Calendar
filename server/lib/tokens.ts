/**
 * Protects secret tokens (calendar-feed links, invite links) at rest.
 *
 * Each token is stored twice, neither in plain text:
 *  - a keyed hash (HMAC-SHA256) — used to look the token up when a phone or browser presents it;
 *  - an encrypted copy (AES-256-GCM) — so the app can still show the link on the Subscribe page.
 *
 * Both keys are derived from data/secret.key, which is NOT part of database backups,
 * so a leaked database or backup file doesn't reveal anyone's links.
 */
import crypto from 'node:crypto';

export class TokenVault {
  private readonly macKey: Buffer;
  private readonly encKey: Buffer;

  constructor(secret: string) {
    const derive = (info: string) => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), info, 32));
    this.macKey = derive('feedcal token lookup v1');
    this.encKey = derive('feedcal token encryption v1');
  }

  /** Deterministic lookup key for a token. */
  lookup(token: string): string {
    return crypto.createHmac('sha256', this.macKey).update(token).digest('base64url');
  }

  /** Encrypt a token for storage. */
  seal(token: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encKey, iv);
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data].map(p => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  /** Decrypt a stored token (throws if it was tampered with or the key changed). */
  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== 'v1') throw new Error('Unknown token format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
