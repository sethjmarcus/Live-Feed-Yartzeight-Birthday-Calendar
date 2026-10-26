import type { Selectable } from 'kysely';
import type { Executor } from '../../db/database.js';
import type { UsersTable } from '../../db/schema.js';
import { PERMISSION_KEYS, type Permission } from '../../../shared/permissions.js';
import type { FeedPrefs } from '../../../shared/schemas.js';
import type { TokenVault } from '../../lib/tokens.js';

export interface User {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string | null;
  sessionVersion: number;
  active: boolean;
  permissions: Permission[];
  feedToken: string;
  feedPrefs: FeedPrefs;
  inviteToken: string | null;
  inviteExpires: string | null;
  createdAt: string;
  lastLogin: string | null;
  lastFeedFetch: string | null;
  lastFeedAgent: string | null;
}
export type NewUser = Omit<User, 'id'> & { id?: number };

/**
 * Feed and invite tokens are never stored in plain text: the database holds a keyed
 * hash (for lookups) and an encrypted copy (for showing the link again). Outside this
 * repository, User objects carry the plain token as usual.
 */
export class UserRepository {
  constructor(private db: Executor, private vault: TokenVault) {}

  private async toUser(row: Selectable<UsersTable> | undefined, perms?: string[]): Promise<User | null> {
    if (!row) return null;
    const permissions = perms ?? (await this.db.selectFrom('userPermissions').select('permission').where('userId', '=', row.id).execute()).map(r => r.permission);
    const { feedTypes, feedAlarm, active, feedToken: _hash, feedTokenEnc, inviteToken: _ihash, inviteTokenEnc, tokenFormat: _f, ...rest } = row;
    return {
      ...rest,
      feedToken: feedTokenEnc ? this.vault.open(feedTokenEnc) : '',
      inviteToken: inviteTokenEnc ? this.vault.open(inviteTokenEnc) : null,
      active: !!active,
      permissions: PERMISSION_KEYS.filter(k => permissions.includes(k)),
      feedPrefs: { types: JSON.parse(feedTypes), alarm: feedAlarm as FeedPrefs['alarm'] },
    };
  }

  private async findBy(column: 'id' | 'username' | 'feedToken' | 'inviteToken', value: string | number) {
    return this.toUser(await this.db.selectFrom('users').selectAll().where(column, '=', value).executeTakeFirst());
  }
  findById(id: number) { return this.findBy('id', id); }
  findByUsername(username: string) { return this.findBy('username', username); }
  findByFeedToken(token: string) { return this.findBy('feedToken', this.vault.lookup(token)); }
  findByInviteToken(token: string) { return this.findBy('inviteToken', this.vault.lookup(token)); }

  async list(): Promise<User[]> {
    const perms = new Map<number, string[]>();
    for (const r of await this.db.selectFrom('userPermissions').selectAll().execute()) {
      perms.set(r.userId, [...(perms.get(r.userId) || []), r.permission]);
    }
    const rows = await this.db.selectFrom('users').selectAll().orderBy('active', 'desc').orderBy('displayName').execute();
    return Promise.all(rows.map(r => this.toUser(r, perms.get(r.id) || []))) as Promise<User[]>;
  }

  async count(): Promise<number> {
    const r = await this.db.selectFrom('users').select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async countActiveAdmins(excludingId = 0): Promise<number> {
    const r = await this.db.selectFrom('users').innerJoin('userPermissions', 'userPermissions.userId', 'users.id')
      .select(eb => eb.fn.countAll<number>().as('n'))
      .where('userPermissions.permission', '=', 'admin').where('users.active', '=', 1).where('users.id', '!=', excludingId)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async names(): Promise<Record<number, string>> {
    const rows = await this.db.selectFrom('users').select(['id', 'displayName']).execute();
    return Object.fromEntries(rows.map(r => [r.id, r.displayName]));
  }

  private columns(u: NewUser) {
    return {
      username: u.username,
      displayName: u.displayName,
      passwordHash: u.passwordHash,
      sessionVersion: u.sessionVersion,
      active: u.active ? 1 : 0,
      feedToken: this.vault.lookup(u.feedToken),
      feedTokenEnc: this.vault.seal(u.feedToken),
      feedTypes: JSON.stringify(u.feedPrefs.types),
      feedAlarm: u.feedPrefs.alarm,
      inviteToken: u.inviteToken ? this.vault.lookup(u.inviteToken) : null,
      inviteTokenEnc: u.inviteToken ? this.vault.seal(u.inviteToken) : null,
      inviteExpires: u.inviteExpires,
      tokenFormat: 1,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin,
      lastFeedFetch: u.lastFeedFetch,
      lastFeedAgent: u.lastFeedAgent,
    };
  }

  /** Must run inside a transaction (user row + permission rows). */
  async create(u: NewUser): Promise<User> {
    const { id } = await this.db.insertInto('users')
      .values({ ...(u.id ? { id: u.id } : {}), ...this.columns(u) })
      .returning('id').executeTakeFirstOrThrow();
    await this.writePermissions(id, u.permissions);
    return (await this.findById(id))!;
  }

  /** Must run inside a transaction (user row + permission rows). */
  async update(u: User): Promise<User> {
    await this.db.updateTable('users').set(this.columns(u)).where('id', '=', u.id).execute();
    await this.writePermissions(u.id, u.permissions);
    return u;
  }

  async recordFeedFetch(id: number, at: string, agent: string) {
    await this.db.updateTable('users').set({ lastFeedFetch: at, lastFeedAgent: agent }).where('id', '=', id).execute();
  }

  /**
   * One-time upgrade: rows written before tokens were protected still hold plain-text
   * tokens. Convert them in place; existing feed and invite links keep working.
   */
  async protectLegacyTokens(): Promise<number> {
    const rows = await this.db.selectFrom('users').select(['id', 'feedToken', 'inviteToken']).where('tokenFormat', '=', 0).execute();
    for (const r of rows) {
      await this.db.updateTable('users').set({
        feedToken: this.vault.lookup(r.feedToken),
        feedTokenEnc: this.vault.seal(r.feedToken),
        inviteToken: r.inviteToken ? this.vault.lookup(r.inviteToken) : null,
        inviteTokenEnc: r.inviteToken ? this.vault.seal(r.inviteToken) : null,
        tokenFormat: 1,
      }).where('id', '=', r.id).execute();
    }
    return rows.length;
  }

  private async writePermissions(userId: number, permissions: Permission[]) {
    await this.db.deleteFrom('userPermissions').where('userId', '=', userId).execute();
    if (permissions.length) {
      await this.db.insertInto('userPermissions').values(permissions.map(permission => ({ userId, permission }))).execute();
    }
  }
}
