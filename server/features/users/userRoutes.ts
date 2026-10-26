/**
 * The signed-in user's own account (/me) and admin user management (/users).
 */
import { Router, type Request } from 'express';
import type { UserService } from './userService.js';
import { toUserDTO } from './userService.js';
import type { User } from './userRepository.js';
import type { EventRepository } from '../events/eventRepository.js';
import type { SettingsService } from '../settings/settingsService.js';
import { currentUser, parse, requireUser, signIn } from '../../http/middleware.js';
import { baseUrl, feedLinks } from '../../http/links.js';
import { accountSchema, feedPrefsSchema, userInviteSchema, userUpdateSchema } from '../../../shared/schemas.js';
import type { SubscriptionDTO, UserDetailDTO } from '../../../shared/api.js';
import type { Config } from '../../config.js';

export function userRoutes(deps: { users: UserService; settings: SettingsService; events: EventRepository; config: Config }): Router {
  const { users, settings, events, config } = deps;
  const r = Router();
  const id = (v: unknown) => Number(v);

  const subscription = async (req: Request, user: User): Promise<SubscriptionDTO> => ({
    user: toUserDTO(user),
    links: feedLinks(baseUrl(req, config), user.feedToken),
    candlesAvailable: !!(await settings.get()).hebcalGeonameId,
  });

  // ---------------------------------------------------------------- own account
  r.patch('/me', requireUser(), async (req, res) => {
    const before = currentUser(req).sessionVersion;
    const user = await users.updateOwnAccount(currentUser(req), parse(accountSchema, req.body));
    if (user.sessionVersion !== before) signIn(req, user); // keep this device signed in
    res.json({ user: toUserDTO(user) });
  });

  r.get('/me/subscription', requireUser('subscribe'), async (req, res) => {
    res.json(await subscription(req, currentUser(req)));
  });

  r.put('/me/feed-prefs', requireUser('subscribe'), async (req, res) => {
    const me = currentUser(req);
    res.json({ user: toUserDTO(await users.saveFeedPrefs(me, me.id, parse(feedPrefsSchema, req.body))) });
  });

  // ---------------------------------------------------------------- admin
  r.get('/users', requireUser('admin'), async (req, res) => {
    const list = await users.list(currentUser(req));
    res.json({ users: list.map(toUserDTO), eventCounts: await events.countByCreator() });
  });

  r.post('/users', requireUser('admin'), async (req, res) => {
    const user = await users.invite(currentUser(req), parse(userInviteSchema, req.body));
    res.status(201).json({ user: toUserDTO(user) });
  });

  r.get('/users/:id', requireUser('admin'), async (req, res) => {
    const actor = currentUser(req);
    const user = await users.adminGet(actor, id(req.params.id));
    const base = baseUrl(req, config);
    const inviteValid = !!user.inviteToken && !!user.inviteExpires && new Date(user.inviteExpires) > new Date();
    const { entries } = await settings.activity(actor, { user: String(user.id) });
    const body: UserDetailDTO = {
      user: toUserDTO(user),
      inviteUrl: inviteValid ? `${base}/invite/${user.inviteToken}` : null,
      inviteExpires: inviteValid ? user.inviteExpires : null,
      links: feedLinks(base, user.feedToken),
      activity: entries.slice(0, 10),
      names: await users.names(),
    };
    res.json(body);
  });

  r.put('/users/:id', requireUser('admin'), async (req, res) => {
    const actor = currentUser(req);
    const { user, changed } = await users.updateByAdmin(actor, id(req.params.id), parse(userUpdateSchema, req.body));
    if (user.id === actor.id) signIn(req, user);
    res.json({ user: toUserDTO(user), changed });
  });

  r.post('/users/:id/invite', requireUser('admin'), async (req, res) => {
    res.json({ user: toUserDTO(await users.reissueInvite(currentUser(req), id(req.params.id))) });
  });

  r.post('/users/:id/feed-reset', requireUser('admin'), async (req, res) => {
    res.json({ user: toUserDTO(await users.resetFeedToken(currentUser(req), id(req.params.id))) });
  });

  r.get('/users/:id/subscription', requireUser('admin'), async (req, res) => {
    res.json(await subscription(req, await users.adminGet(currentUser(req), id(req.params.id))));
  });

  r.put('/users/:id/feed-prefs', requireUser('admin'), async (req, res) => {
    const user = await users.saveFeedPrefs(currentUser(req), id(req.params.id), parse(feedPrefsSchema, req.body));
    res.json({ user: toUserDTO(user) });
  });

  return r;
}
