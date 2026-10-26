/**
 * People: first-run setup, sign-in, invitations, permissions, own account, feed preferences.
 */
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { User, NewUser } from './userRepository.js';
import type { UserDTO } from '../../../shared/api.js';
import { PRESETS, PERMISSIONS, can, presetName, type Permission } from '../../../shared/permissions.js';
import { EVENT_TYPE_KEYS } from '../../../shared/eventTypes.js';
import type { FeedPrefs } from '../../../shared/schemas.js';
import { ForbiddenError, GoneError, NotFoundError, ValidationError } from '../../http/errors.js';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../../lib/passwords.js';
import crypto from 'node:crypto';
import { diff, nowIso, randomToken } from '../../lib/util.js';

const INVITE_DAYS = 14;

export function toUserDTO(u: User): UserDTO {
  return {
    id: u.id, username: u.username, displayName: u.displayName, active: u.active,
    permissions: u.permissions, hasPassword: !!u.passwordHash, feedPrefs: u.feedPrefs,
    createdAt: u.createdAt, lastLogin: u.lastLogin, lastFeedFetch: u.lastFeedFetch, lastFeedAgent: u.lastFeedAgent,
  };
}

export class UserService {
  /**
   * @param setupCode one-time code required for first-run setup (null once an admin exists).
   */
  constructor(private uow: UnitOfWork, private setupCode: () => string | null) {}

  private get users() { return this.uow.repos.users; }

  async needsSetup() { return (await this.users.count()) === 0; }

  // ---------------------------------------------------------------- setup & sign-in
  async setupFirstAdmin(input: { setupCode: string; calendarName: string; displayName: string; username: string; password: string }) {
    if (!(await this.needsSetup())) throw new ForbiddenError('Setup has already been completed.');
    const expected = this.setupCode();
    if (!expected || !sameText(input.setupCode.replace(/[^A-Z0-9]/g, ''), expected.replace(/[^A-Z0-9]/g, ''))) {
      throw new ValidationError('That setup code is not right.', { setupCode: 'That setup code is not right — copy it from the server log.' });
    }
    const passwordHash = await hashPassword(input.password);
    return this.uow.transaction(async r => {
      await r.settings.save({ calendarName: input.calendarName });
      const user = await r.users.create(newUser({
        username: input.username, displayName: input.displayName,
        permissions: PRESETS.admin.perms, passwordHash, lastLogin: nowIso(),
      }));
      await r.audit.add({ at: nowIso(), actorId: user.id, action: 'setup' });
      return user;
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

  async saveFeedPrefs(actor: User, targetId: number, prefs: FeedPrefs) {
    const user = targetId === actor.id ? actor : await this.adminGet(actor, targetId);
    user.feedPrefs = prefs;
    await this.uow.transaction(r => r.users.update(user));
    return user;
  }

  /** The subscriber behind a feed token (only if they may subscribe). */
  async bySubscribeToken(token: string): Promise<User | null> {
    const user = await this.users.findByFeedToken(token);
    return user && can(user, 'subscribe') ? user : null;
  }

  async recordFeedFetch(user: User, agent: string | undefined) {
    await this.users.recordFeedFetch(user.id, nowIso(), String(agent || '').slice(0, 120));
  }

  names() { return this.users.names(); }

  // ---------------------------------------------------------------- admin
  async list(actor: User) {
    requireAdmin(actor);
    return this.users.list();
  }

  async adminGet(actor: User, id: number): Promise<User> {
    requireAdmin(actor);
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError('No such user.');
    return user;
  }

  async invite(actor: User, input: { displayName: string; username: string; permissions: Permission[] }) {
    requireAdmin(actor);
    if (await this.users.findByUsername(input.username)) throw new ValidationError('That username is taken.', { username: 'That username is taken.' });
    return this.uow.transaction(async r => {
      const user = await r.users.create({ ...newUser(input), ...inviteFields() });
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'user.create', targetUserId: user.id, label: `${presetName(input.permissions)} access` });
      return user;
    });
  }

  async updateByAdmin(actor: User, id: number, input: { displayName: string; username: string; permissions: Permission[]; active: boolean }) {
    const user = await this.adminGet(actor, id);
    const isSelf = user.id === actor.id;
    const active = isSelf ? true : input.active;
    const wasAdmin = user.permissions.includes('admin');
    const staysAdmin = input.permissions.includes('admin');
    const other = await this.users.findByUsername(input.username);
    if (other && other.id !== user.id) throw new ValidationError('That username is taken.', { username: 'That username is taken.' });
    if (isSelf && wasAdmin && !staysAdmin) throw new ValidationError("You can't remove your own admin access — ask another admin.");
    if (wasAdmin && (!staysAdmin || !active) && (await this.users.countActiveAdmins(user.id)) === 0) {
      throw new ValidationError('There must be at least one active admin.');
    }

    const snapshot = (u: { username: string; displayName: string; active: boolean; permissions: Permission[] }) => ({
      username: u.username, displayName: u.displayName, active: u.active,
      ...Object.fromEntries(PERMISSIONS.map(p => [`permission:${p.key}`, u.permissions.includes(p.key)])),
    });
    const before = snapshot(user);
    const after = snapshot({ ...input, active });
    const changes = diff(before, after, Object.keys(after) as (keyof typeof after & string)[]);
    if (!changes.length) return { user, changed: false };

    Object.assign(user, { username: input.username, displayName: input.displayName, permissions: input.permissions, active });
    if (changes.some(c => c.field === 'active' || c.field === 'username')) user.sessionVersion += 1;
    await this.uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'user.update', targetUserId: user.id, changes });
    });
    return { user, changed: true };
  }

  async reissueInvite(actor: User, id: number) {
    const user = await this.adminGet(actor, id);
    Object.assign(user, inviteFields());
    await this.uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'user.invite', targetUserId: user.id });
    });
    return user;
  }

  async resetFeedToken(actor: User, id: number) {
    const user = await this.adminGet(actor, id);
    Object.assign(user, { feedToken: randomToken(), lastFeedFetch: null, lastFeedAgent: null });
    await this.uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'user.feedReset', targetUserId: user.id });
    });
    return user;
  }
}

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function requireAdmin(actor: User) {
  if (!can(actor, 'admin')) throw new ForbiddenError();
}

function newUser(p: { username: string; displayName: string; permissions: Permission[]; passwordHash?: string | null; lastLogin?: string | null }): NewUser {
  return {
    username: p.username, displayName: p.displayName, permissions: p.permissions,
    passwordHash: p.passwordHash ?? null, lastLogin: p.lastLogin ?? null,
    sessionVersion: 0, active: true, feedToken: randomToken(),
    feedPrefs: { types: [...EVENT_TYPE_KEYS], alarm: 'none' }, // Hebcal extras are opt-in
    inviteToken: null, inviteExpires: null, createdAt: nowIso(),
    lastFeedFetch: null, lastFeedAgent: null,
  };
}

function inviteFields() {
  return { inviteToken: randomToken(), inviteExpires: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString() };
}
