/**
 * Session info, first-run setup, sign in/out, and accepting an invitation.
 */
import { Router, type RequestHandler } from 'express';
import type { UserService } from '../users/userService.js';
import { toUserDTO } from '../users/userService.js';
import type { SettingsService } from '../settings/settingsService.js';
import { parse, signIn, signOut } from '../../http/middleware.js';
import { acceptInviteSchema, loginSchema, setupSchema } from '../../../shared/schemas.js';
import type { SessionDTO } from '../../../shared/api.js';
import { ForbiddenError } from '../../http/errors.js';
import type { Request, Response } from 'express';

export function authRoutes(deps: {
  users: UserService;
  settings: SettingsService;
  csrfToken: (req: Request, res: Response) => string;
  authRateLimit: RequestHandler;
}): Router {
  const { users, settings, csrfToken, authRateLimit } = deps;
  const r = Router();

  const session: RequestHandler = async (req, res) => {
    const body: SessionDTO = {
      user: req.user ? toUserDTO(req.user) : null,
      needsSetup: await users.needsSetup(),
      csrfToken: csrfToken(req, res),
      calendarName: (await settings.get()).calendarName,
    };
    res.json(body);
  };
  r.get('/session', session);

  r.post('/setup', authRateLimit, async (req, res) => {
    if (!(await users.needsSetup())) throw new ForbiddenError('Setup has already been completed.');
    const user = await users.setupFirstAdmin(parse(setupSchema, req.body));
    signIn(req, user);
    res.status(201).json({ user: toUserDTO(user) });
  });

  r.post('/login', authRateLimit, async (req, res) => {
    const { username, password } = parse(loginSchema, req.body);
    const user = await users.authenticate(username, password);
    signIn(req, user);
    res.json({ user: toUserDTO(user) });
  });

  r.post('/logout', (req, res) => {
    signOut(req);
    res.json({ ok: true });
  });

  r.get('/invites/:token', authRateLimit, async (req, res) => {
    const user = await users.findInvite(String(req.params.token));
    res.json({ displayName: user.displayName, username: user.username });
  });

  r.post('/invites/:token', authRateLimit, async (req, res) => {
    const { password } = parse(acceptInviteSchema, req.body);
    const user = await users.acceptInvite(String(req.params.token), password);
    signIn(req, user);
    res.json({ user: toUserDTO(user) });
  });

  return r;
}
