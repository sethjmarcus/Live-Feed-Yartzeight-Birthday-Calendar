/**
 * Sessions, CSRF protection, security headers and rate limits — all from
 * well-maintained libraries, configured in one place.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Express, RequestHandler } from 'express';
import cookieSession from 'cookie-session';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { doubleCsrf } from 'csrf-csrf';
import { rateLimit } from 'express-rate-limit';
import type { Config } from '../config.js';

export const SESSION_DAYS = 90;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace CookieSessionInterfaces {
    interface CookieSessionObject {
      /** Random per-browser id; the CSRF token is bound to it. */
      sid?: string;
      /** Signed-in user id. */
      uid?: number;
      /** User's sessionVersion when they signed in — bumping it signs out every device. */
      sv?: number;
    }
  }
}

/** A per-install secret, created on first run and kept in the data folder. */
export function loadSecret(dataDir: string): string {
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export function installSecurity(app: Express, config: Config, secret: string) {
  const https = config.publicUrl.startsWith('https://');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    // Vite's dev server injects inline scripts, so CSP is enforced only for the built app.
    contentSecurityPolicy: config.clientMode === 'vite' ? false : {
      directives: {
        'img-src': ["'self'", 'data:'],
        // Over plain http (home network) don't force the browser onto https.
        'upgrade-insecure-requests': https ? [] : null,
      },
    },
    strictTransportSecurity: https,
  }));

  app.use(cookieSession({
    name: 'feedcal',
    keys: [secret],
    maxAge: SESSION_DAYS * 86_400_000,
    sameSite: 'lax',
    httpOnly: true,
    secure: https,
  }));
  app.use(cookieParser());

  // Every browser gets a random session id (signed in or not) for CSRF binding.
  app.use((req, _res, next) => {
    if (req.session && !req.session.sid) req.session.sid = crypto.randomBytes(16).toString('base64url');
    next();
  });
}

/** Double-submit CSRF tokens: the React app sends the token in an x-csrf-token header. */
export function createCsrf(secret: string, config: Config) {
  const https = config.publicUrl.startsWith('https://');
  return doubleCsrf({
    getSecret: () => secret,
    getSessionIdentifier: req => req.session?.sid ?? '',
    cookieName: https ? '__Host-feedcal.csrf' : 'feedcal.csrf',
    cookieOptions: { sameSite: 'lax', secure: https, httpOnly: true, path: '/' },
    getCsrfTokenFromRequest: req => req.headers['x-csrf-token'] as string | undefined,
  });
}

/** Slow down password guessing on setup, sign-in and invite pages (20 tries / 15 min per IP). */
export function createAuthRateLimit(): RequestHandler {
  return rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please wait 15 minutes and try again.' },
  });
}
