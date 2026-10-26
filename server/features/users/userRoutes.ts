/**
 * The signed-in user's own account (/me) and account management (/users).
 */
import { Router, type Request } from 'express';
import type { UserService } from './userService.js';
import { inviteIsValid, toUserDTO } from './userService.js';
import type { User } from './userRepository.js';
import type { EventRepository } from '../events/eventRepository.js';
import type { SettingsService } from '../settings/settingsService.js';
import type { CalendarRepository } from '../calendars/calendarRepository.js';
import { currentUser, parse, requireAppAdmin, requireUser, signIn } from '../../http/middleware.js';
import { baseUrl, feedLinks } from '../../http/links.js';
import { accountSchema, feedSettingsSchema, userInviteSchema, userUpdateSchema } from '../../../shared/schemas.js';
import type { SubscriptionDTO, UserDetailDTO } from '../../../shared/api.js';
import type { Config } from '../../config.js';

export function userRoutes(deps: { users: UserService; settings: SettingsService; events: EventRepository; calendars: CalendarRepository; config: Config }): Router {
  const { users, settings, events, calendars, config } = deps;
  const r = Router();
  const id = (v: unknown) => Number(v);

  const subscription = async (req: Request, user: User): Promise<SubscriptionDTO> => ({
    user: toUserDTO(user),
    links: feedLinks(baseUrl(req, config), user.feedToken),
    candlesAvailable: !!(await settings.get()).hebcalGeonameId,
  });

  const inviteInfo = (req: Request, user: User) => {
    const valid = inviteIsValid(user);
    return { inviteUrl: valid ? `${baseUrl(req, config)}/invite/${user.inviteToken}` : null, inviteExpires: valid ? user.inviteExpires : null };
  };

  // ---------------------------------------------------------------- own account
  r.patch('/me', requireUser(), async (req, res) => {
    const before = currentUser(req).sessionVersion;
    const user = await users.updateOwnAccount(currentUser(req), parse(accountSchema, req.body));
    if (user.sessionVersion !== before) signIn(req, user); // keep this device signed in
    res.json({ user: toUserDTO(user) });
  });

  r.get('/me/subscription', requireUser(), async (req, res) => {
    res.json(await subscription(req, currentUser(req)));
  });

  r.put('/me/feed-prefs', requireUser(), async (req, res) => {
    const me = currentUser(req);
    res.json({ user: toUserDTO(await users.saveFeedPrefs(me, me.id, parse(feedSettingsSchema, req.body))) });
  });

  // ---------------------------------------------------------------- inviting (app admins and calendar managers)
  r.post('/users', requireUser(), async (req, res) => {
    const user = await users.invite(currentUser(req), parse(userInviteSchema, req.body));
    res.status(201).json({ user: toUserDTO(user), ...inviteInfo(req, user) });
  });

  /** A calendar manager gets a fresh setup link for a member who hasn't set up yet. */
  r.post('/calendars/:calendarId/members/:id/invite', requireUser(), async (req, res) => {
    const user = await users.reissueInvite(currentUser(req), id(req.params.id), id(req.params.calendarId));
    res.json({ user: toUserDTO(user), ...inviteInfo(req, user) });
  });

  // ---------------------------------------------------------------- app admin: accounts
  r.get('/users', requireAppAdmin(), async (req, res) => {
    const list = await users.list(currentUser(req));
    res.json({ users: list.map(toUserDTO), eventCounts: await events.countByCreator() });
  });

  r.get('/users/:id', requireAppAdmin(), async (req, res) => {
    const actor = currentUser(req);
    const user = await users.adminGet(actor, id(req.params.id));
    const { entries } = await settings.activity(actor, { user: String(user.id) });
    const activity = entries.slice(0, 10);
    const body: UserDetailDTO = {
      user: toUserDTO(user),
      ...inviteInfo(req, user),
      links: feedLinks(baseUrl(req, config), user.feedToken),
      activity,
      names: await users.names(activity.flatMap(a => [a.actorId, a.targetUserId])),
      calendarNames: await calendars.names(),
    };
    res.json(body);
  });

  r.put('/users/:id', requireAppAdmin(), async (req, res) => {
    const actor = currentUser(req);
    const { user, changed } = await users.updateByAdmin(actor, id(req.params.id), parse(userUpdateSchema, req.body));
    if (user.id === actor.id) signIn(req, user);
    res.json({ user: toUserDTO(user), changed });
  });

  r.post('/users/:id/invite', requireAppAdmin(), async (req, res) => {
    const user = await users.reissueInvite(currentUser(req), id(req.params.id));
    res.json({ user: toUserDTO(user), ...inviteInfo(req, user) });
  });

  r.post('/users/:id/feed-reset', requireAppAdmin(), async (req, res) => {
    res.json({ user: toUserDTO(await users.resetFeedToken(currentUser(req), id(req.params.id))) });
  });

  r.get('/users/:id/subscription', requireAppAdmin(), async (req, res) => {
    res.json(await subscription(req, await users.adminGet(currentUser(req), id(req.params.id))));
  });

  r.put('/users/:id/feed-prefs', requireAppAdmin(), async (req, res) => {
    const user = await users.saveFeedPrefs(currentUser(req), id(req.params.id), parse(feedSettingsSchema, req.body));
    res.json({ user: toUserDTO(user) });
  });

  return r;
}
