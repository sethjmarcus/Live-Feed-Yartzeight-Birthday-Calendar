/**
 * Session info, first-run setup, sign in/out, and accepting an invitation.
 */
import { Router, type RequestHandler } from 'express';
import type { UserService } from '../users/userService.js';
import { toSessionUserDTO, toUserDTO } from '../users/userService.js';
import type { CalendarService } from '../calendars/calendarService.js';
import type { SettingsService } from '../settings/settingsService.js';
import { parse } from '../../http/middleware.js';
import type { SessionStore } from '../../http/sessions.js';
import { acceptInviteSchema, loginSchema, setupSchema } from '../../../shared/schemas.js';
import type { SessionDTO } from '../../../shared/api.js';
import { ForbiddenError } from '../../http/errors.js';
import type { Request, Response } from 'express';

export function authRoutes(deps: {
  users: UserService;
  settings: SettingsService;
  calendars: CalendarService;
  sessions: SessionStore;
  log: { warn: (o: object, msg: string) => void };
  csrfToken: (req: Request, res: Response) => string;
  authRateLimit: RequestHandler;
}): Router {
  const { users, settings, calendars, sessions, log, csrfToken, authRateLimit } = deps;
  const r = Router();

  const session: RequestHandler = async (req, res) => {
    const body: SessionDTO = {
      user: req.user ? toSessionUserDTO(req.user) : null,
      needsSetup: await users.needsSetup(),
      csrfToken: csrfToken(req, res),
      siteName: (await settings.get()).siteName,
      appAdminAccess: calendars.appAdminAccess,
    };
    res.json(body);
  };
  r.get('/session', session);

  r.post('/setup', authRateLimit, async (req, res) => {
    if (!(await users.needsSetup())) throw new ForbiddenError('Setup has already been completed.');
    const user = await users.setupFirstAdmin(parse(setupSchema, req.body));
    await sessions.signIn(req, user);
    res.status(201).json({ user: toUserDTO(user) });
  });

  r.post('/login', authRateLimit, async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    let user;
    try {
      user = await users.authenticate(username, password);
    } catch (err) {
      // Repeated failures here are what password guessing looks like.
      log.warn({ username: username.slice(0, 60), ip: req.ip }, 'Failed sign-in');
      throw err;
    }
    await sessions.signIn(req, user);
    res.json({ user: toUserDTO(user) });
  });

  r.post('/logout', async (req, res) => {
    await sessions.signOut(req);
    res.json({ ok: true });
  });

  r.get('/invites/:token', authRateLimit, async (req, res) => {
    const user = await users.findInvite(String(req.params.token));
    res.json({ displayName: user.displayName, username: user.username });
  });

  r.post('/invites/:token', authRateLimit, async (req, res) => {
    const { password } = parse(acceptInviteSchema, req.body);
    const user = await users.acceptInvite(String(req.params.token), password);
    await sessions.signIn(req, user);
    res.json({ user: toUserDTO(user) });
  });

  return r;
}
