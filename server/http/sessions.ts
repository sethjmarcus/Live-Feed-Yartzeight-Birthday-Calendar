/**
 * Server-side sessions. The (signed) cookie carries only a random token; the database
 * keeps its keyed hash with the user, so a session can be ended from the server:
 *  - signing out deletes it;
 *  - changing your password, "sign out everywhere" or disabling the account bumps the
 *    user's sessionVersion, which invalidates every session made before;
 *  - sessions end after IDLE_DAYS without use, and after MAX_DAYS regardless.
 */
import crypto from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import type { Database } from '../db/database.js';
import type { TokenVault } from '../lib/tokens.js';
import type { Actor, User, UserRepository } from '../features/users/userRepository.js';

export const IDLE_DAYS = 30;
export const MAX_DAYS = 180;
const DAY = 86_400_000;
const TOUCH_EVERY = 3_600_000; // record activity (and refresh the cookie) at most hourly

export class SessionStore {
  constructor(private db: Database, private vault: TokenVault) {}

  /** Start a session for this user on this browser (ending the browser's previous one). */
  async signIn(req: Request, user: User) {
    await this.end(req.session?.tok);
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    await this.db.insertInto('sessions').values({
      id: this.vault.lookup(token), userId: user.id, sessionVersion: user.sessionVersion,
      createdAt: now, lastSeenAt: now, userAgent: String(req.get('user-agent') || '').slice(0, 200),
    }).execute();
    req.session!.tok = token;
    req.session!.seen = Date.now();
  }

  async signOut(req: Request) {
    await this.end(req.session?.tok);
    req.session = null;
  }

  private async end(token: string | undefined) {
    if (token) await this.db.deleteFrom('sessions').where('id', '=', this.vault.lookup(token)).execute();
  }

  /** Middleware: attach req.user if the cookie's session is still valid. */
  loadUser(users: UserRepository, toActor: (u: User) => Promise<Actor>): RequestHandler {
    return async (req, _res, next) => {
      req.user = null;
      const token = req.session?.tok;
      if (!token) return next();
      const id = this.vault.lookup(token);
      const row = await this.db.selectFrom('sessions').selectAll().where('id', '=', id).executeTakeFirst();
      const now = Date.now();
      const valid = row
        && now - Date.parse(row.lastSeenAt) < IDLE_DAYS * DAY
        && now - Date.parse(row.createdAt) < MAX_DAYS * DAY;
      const user = valid ? await users.findById(row.userId) : null;
      if (!row || !user || !user.active || user.sessionVersion !== row.sessionVersion || !valid) {
        if (row) await this.db.deleteFrom('sessions').where('id', '=', id).execute();
        delete req.session!.tok;
        return next();
      }
      if (now - Date.parse(row.lastSeenAt) > TOUCH_EVERY) {
        await this.db.updateTable('sessions').set({ lastSeenAt: new Date(now).toISOString() }).where('id', '=', id).execute();
        req.session!.seen = now; // re-sends the cookie, extending its lifetime
      }
      req.user = await toActor(user);
      next();
    };
  }

  /** Daily clean-up of ended sessions. */
  async prune() {
    const idle = new Date(Date.now() - IDLE_DAYS * DAY).toISOString();
    const old = new Date(Date.now() - MAX_DAYS * DAY).toISOString();
    await this.db.deleteFrom('sessions').where(eb => eb.or([
      eb('lastSeenAt', '<', idle),
      eb('createdAt', '<', old),
      eb('sessionVersion', '!=', eb.selectFrom('users').select('users.sessionVersion').whereRef('users.id', '=', 'sessions.userId')),
    ])).execute();
  }
}
