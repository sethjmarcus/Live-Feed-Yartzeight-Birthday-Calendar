/**
 * People: first-run setup, sign-in, invitations, accounts, own account, feed preferences.
 * (Membership of calendars is in CalendarService.)
 */
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { Actor, User, NewUser } from './userRepository.js';
import type { SessionUserDTO, UserDTO } from '../../../shared/api.js';
import { ROLES, can, canAdministerAccount, isAppAdmin, roleName, type Permission } from '../../../shared/permissions.js';
import { EVENT_TYPE_KEYS } from '../../../shared/eventTypes.js';
import type { FeedSettings } from '../../../shared/schemas.js';
import { ForbiddenError, GoneError, NotFoundError, ValidationError } from '../../http/errors.js';
import { dummyPasswordHash, hashPassword, needsRehash, verifyPassword } from '../../lib/passwords.js';
import crypto from 'node:crypto';
import { diff, nowIso, randomToken } from '../../lib/util.js';

/** First-time setup links. */
const INVITE_DAYS = 14;
/** Password-reset links (for people who already have a password) — short, since they grant the account. */
const RESET_DAYS = 1;

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id, username: u.username, displayName: u.displayName, active: u.active,
    appAdmin: u.appAdmin, memberships: u.memberships, hasPassword: !!u.passwordHash, feedPrefs: u.feedPrefs,
    createdAt: u.createdAt, lastLogin: u.lastLogin, lastFeedFetch: u.lastFeedFetch, lastFeedAgent: u.lastFeedAgent,
  };
}

export function toSessionUserDTO(a: Actor): SessionUserDTO {
  return { ...toUserDTO(a), calendars: a.calendars };
}

/** Calendars whose events go into this person's phone feed. */
export function feedCalendars(u: User) {
  return u.memberships.filter(m => m.inFeed && (m.permissions.includes('subscribe') || m.permissions.includes('manage')));
}

export class UserService {
  /**
   * @param setupCode one-time code required for first-run setup (null once an admin exists).
   */
  constructor(private uow: UnitOfWork, private setupCode: () => string | null) {}

  private get users() { return this.uow.repos.users; }

  async needsSetup() { return (await this.users.count()) === 0; }

  // ---------------------------------------------------------------- setup & sign-in
  /** Creates the first account (app admin) and the first calendar, which they own. */
  async setupFirstAdmin(input: { setupCode: string; calendarName: string; displayName: string; username: string; password: string }) {
    if (!(await this.needsSetup())) throw new ForbiddenError('Setup has already been completed.');
    const expected = this.setupCode();
    if (!expected || !sameText(input.setupCode.replace(/[^A-Z0-9]/g, ''), expected.replace(/[^A-Z0-9]/g, ''))) {
      throw new ValidationError('That setup code is not right.', { setupCode: 'That setup code is not right — copy it from the server log.' });
    }
    const passwordHash = await hashPassword(input.password);
    return this.uow.transaction(async r => {
      const now = nowIso();
      await r.settings.save({ siteName: input.calendarName });
      const user = await r.users.create(newUser({
        username: input.username, displayName: input.displayName, appAdmin: true, passwordHash, lastLogin: now,
      }));
      const calendar = await r.calendars.create({ name: input.calendarName, createdAt: now, createdBy: user.id });
      await r.calendars.addMember({ calendarId: calendar.id, userId: user.id, permissions: ROLES.owner.perms, inFeed: true, addedAt: now, addedBy: user.id });
      await r.audit.add({ at: now, actorId: user.id, action: 'setup' });
      return (await r.users.findById(user.id))!;
    });
  }

  async authenticate(username: string, password: string): Promise<User> {
    const user = await this.users.findByUsername(username);
    // Always run one password check, even for unknown users, so timing doesn't reveal usernames.
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? await dummyPasswordHash());
    if (!user || !user.active || !user.passwordHash || !passwordOk) {
      throw new ValidationError('Wrong username or password.');
    }
    user.lastLogin = nowIso();
    if (needsRehash(user.passwordHash)) user.passwordHash = await hashPassword(password); // upgrade to current settings
    await this.uow.transaction(r => r.users.update(user));
    return user;
  }

  async findInvite(token: string): Promise<User> {
    const user = await this.users.findByInviteToken(token);
    if (!user || !user.active || !user.inviteExpires || new Date(user.inviteExpires) < new Date()) {
      throw new GoneError('This setup link is no longer valid. Ask the admin for a new one.');
    }
    return user;
  }

  async acceptInvite(token: string, password: string): Promise<User> {
    const user = await this.findInvite(token);
    Object.assign(user, {
      passwordHash: await hashPassword(password), sessionVersion: user.sessionVersion + 1,
      inviteToken: null, inviteExpires: null, lastLogin: nowIso(),
    });
    await this.uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: nowIso(), actorId: user.id, action: 'user.activate' });
    });
    return user;
  }

  // ---------------------------------------------------------------- own account
  async updateOwnAccount(user: User, input: { displayName: string; currentPassword?: string; newPassword?: string }) {
    const changingPassword = !!input.newPassword;
    if (changingPassword && !(await verifyPassword(input.currentPassword || '', user.passwordHash))) {
      throw new ValidationError('Current password is wrong.', { currentPassword: 'Current password is wrong.' });
    }
    user.displayName = input.displayName;
    if (changingPassword) {
      user.passwordHash = await hashPassword(input.newPassword!);
      user.sessionVersion += 1; // signs out other devices
    }
    await this.uow.transaction(async r => {
      await r.users.update(user);
      if (changingPassword) await r.audit.add({ at: nowIso(), actorId: user.id, action: 'user.password' });
    });
    return user;
  }

  /** Invalidates every session of this account (the caller then starts a new one for this device). */
  async signOutEverywhere(user: User) {
    user.sessionVersion += 1;
    await this.uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: nowIso(), actorId: user.id, action: 'user.signOutEverywhere' });
    });
    return user;
  }

  /** What goes into a feed: event types, reminders, and (optionally) which calendars. */
  async saveFeedPrefs(actor: Actor, targetId: number, input: FeedSettings) {
    const user = targetId === actor.id ? actor : await this.administered(actor, targetId);
    const { calendars, ...prefs } = input;
    user.feedPrefs = prefs;
    await this.uow.transaction(async r => {
      await r.users.update(user);
      if (calendars) {
        for (const m of user.memberships) {
          const inFeed = calendars.includes(m.calendarId);
          if (inFeed !== m.inFeed) await r.calendars.updateMember(m.calendarId, user.id, { inFeed });
        }
      }
    });
    return (await this.users.findById(user.id))!;
  }

  /** The subscriber behind a feed token (only if they may subscribe to some calendar). */
  async bySubscribeToken(token: string): Promise<User | null> {
    const user = await this.users.findByFeedToken(token);
    const mayHaveFeed = user?.active && user.memberships.some(m => m.permissions.includes('subscribe') || m.permissions.includes('manage'));
    return mayHaveFeed ? user : null;
  }

  async recordFeedFetch(user: User, agent: string | undefined) {
    await this.users.recordFeedFetch(user.id, nowIso(), String(agent || '').slice(0, 120));
  }

  names(ids?: (number | null | undefined)[]) { return this.users.names(ids); }

  // ---------------------------------------------------------------- app admin: accounts
  async list(actor: Actor) {
    requireAppAdmin(actor);
    return this.users.list();
  }

  async adminGet(actor: Actor, id: number): Promise<User> {
    requireAppAdmin(actor);
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('No such user.');
    return user;
  }

  /** For actions that reveal or take over the account (feed link, reset link). See canAdministerAccount. */
  async administered(actor: Actor, id: number): Promise<User> {
    const user = await this.adminGet(actor, id);
    if (!canAdministerAccount(actor, user)) {
      throw new ForbiddenError("They're in a calendar you don't manage, so only its owners can see their links.");
    }
    return user;
  }

  /**
   * Create an account and add it to one calendar. App admins can do this for any calendar
   * they manage; calendar managers can invite people into their own calendar.
   */
  async invite(actor: Actor, input: { displayName: string; username: string; calendarId: number; permissions: Permission[] }) {
    if (!can(actor, 'manage', input.calendarId)) throw new ForbiddenError("You can only invite people to calendars you manage.");
    if (await this.users.findByUsername(input.username)) throw new ValidationError('That username is taken.', { username: 'That username is taken.' });
    return this.uow.transaction(async r => {
      const now = nowIso();
      const created = await r.users.create({ ...newUser({ ...input, appAdmin: false }), ...inviteFields(INVITE_DAYS) });
      await r.calendars.addMember({ calendarId: input.calendarId, userId: created.id, permissions: input.permissions, inFeed: true, addedAt: now, addedBy: actor.id });
      await r.audit.add({ at: now, actorId: actor.id, action: 'user.create', calendarId: input.calendarId, targetUserId: created.id, label: `${roleName(input.permissions)} access` });
      return (await r.users.findById(created.id))!;
    });
  }

  async updateByAdmin(actor: Actor, id: number, input: { displayName: string; username: string; active: boolean; appAdmin: boolean }) {
    const user = await this.adminGet(actor, id);
    const isSelf = user.id === actor.id;
    const active = isSelf ? true : input.active;
    const other = await this.users.findByUsername(input.username);
    if (other && other.id !== user.id) throw new ValidationError('That username is taken.', { username: 'That username is taken.' });
    if (isSelf && !input.appAdmin) throw new ValidationError("You can't remove your own app admin access — ask another app admin.");
    if (user.appAdmin && (!input.appAdmin || !active) && (await this.users.countActiveAppAdmins(user.id)) === 0) {
      throw new ValidationError('There must be at least one active app admin.');
    }

    const fields = ['username', 'displayName', 'active', 'appAdmin'] as const;
    const after = { ...user, ...input, active };
    const changes = diff(user, after, [...fields]);
    if (!changes.length) return { user, changed: false };

    Object.assign(user, { username: input.username, displayName: input.displayName, appAdmin: input.appAdmin, active });
    if (changes.some(c => c.field === 'active' || c.field === 'username')) user.sessionVersion += 1;
    await this.uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'user.update', targetUserId: user.id, changes });
    });
    return { user, changed: true };
  }

  /**
   * A new setup (or password-reset) link — whoever holds it can take over the account.
   * App admins: for anyone whose calendars they all manage. Calendar owners: only for
   * someone who hasn't set up yet, isn't an app admin, and is in no calendar but theirs.
   */
  async reissueInvite(actor: Actor, id: number, viaCalendarId?: number) {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('No such user.');
    const allowed = canAdministerAccount(actor, user) || (
      viaCalendarId !== undefined && can(actor, 'manage', viaCalendarId) &&
      !user.passwordHash && !user.appAdmin &&
      user.memberships.some(m => m.calendarId === viaCalendarId) &&
      user.memberships.every(m => can(actor, 'manage', m.calendarId))
    );
    if (!allowed) throw new ForbiddenError();
    Object.assign(user, inviteFields(user.passwordHash ? RESET_DAYS : INVITE_DAYS));
    await this.uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'user.invite', calendarId: viaCalendarId ?? null, targetUserId: user.id });
    });
    return user;
  }

  async resetFeedToken(actor: Actor, id: number) {
    const user = await this.administered(actor, id);
    Object.assign(user, { feedToken: randomToken(), lastFeedFetch: null, lastFeedAgent: null });
    await this.uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'user.feedReset', targetUserId: user.id });
    });
    return user;
  }
}

export function inviteIsValid(u: User): boolean {
  return !!u.inviteToken && !!u.inviteExpires && new Date(u.inviteExpires) > new Date();
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function requireAppAdmin(actor: Actor) {
  if (!isAppAdmin(actor)) throw new ForbiddenError();
}

function newUser(p: { username: string; displayName: string; appAdmin: boolean; passwordHash?: string | null; lastLogin?: string | null }): NewUser {
  return {
    username: p.username, displayName: p.displayName, appAdmin: p.appAdmin,
    passwordHash: p.passwordHash ?? null, lastLogin: p.lastLogin ?? null,
    sessionVersion: 0, active: true, feedToken: randomToken(),
    feedPrefs: { types: [...EVENT_TYPE_KEYS], alarm: 'none' }, // Hebcal extras are opt-in
    inviteToken: null, inviteExpires: null, createdAt: nowIso(),
    lastFeedFetch: null, lastFeedAgent: null,
  };
}

function inviteFields(days: number) {
  return { inviteToken: randomToken(), inviteExpires: new Date(Date.now() + days * 86_400_000).toISOString() };
}
