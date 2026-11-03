import type { Selectable } from 'kysely';
import type { Executor } from '../../db/database.js';
import type { UsersTable } from '../../db/schema.js';
import type { FeedPrefs } from '../../../shared/schemas.js';
import type { MembershipDTO } from '../../../shared/api.js';
import type { CalendarAccess } from '../../../shared/permissions.js';
import type { TokenVault } from '../../lib/tokens.js';
import { CalendarRepository } from '../calendars/calendarRepository.js';

export interface User {
  id: number;
  username: string;
  displayName: string;
  passwordHash: string | null;
  sessionVersion: number;
  active: boolean;
  /** Runs the site: accounts, calendars, settings. */
  appAdmin: boolean;
  /** Read-only here; changed through CalendarRepository. */
  memberships: MembershipDTO[];
  feedToken: string;
  feedPrefs: FeedPrefs;
  inviteToken: string | null;
  inviteExpires: string | null;
  createdAt: string;
  lastLogin: string | null;
  lastFeedFetch: string | null;
  lastFeedAgent: string | null;
}
export type NewUser = Omit<User, 'id' | 'memberships'> & { id?: number };

/** A signed-in user plus what they may do in each calendar (see resolveAccess). */
export type Actor = User & { calendars: CalendarAccess[] };

/**
 * Feed and invite tokens are never stored in plain text: the database holds a keyed
 * hash (for lookups) and an encrypted copy (for showing the link again). Outside this
 * repository, User objects carry the plain token as usual.
 */
export class UserRepository {
  private calendars: CalendarRepository;

  constructor(private db: Executor, private vault: TokenVault) {
    this.calendars = new CalendarRepository(db);
  }

  private async toUser(row: Selectable<UsersTable> | undefined, memberships?: MembershipDTO[]): Promise<User | null> {
    if (!row) return null;
    const { feedTypes, feedAlarm, active, appAdmin, feedToken: _hash, feedTokenEnc, inviteToken: _ihash, inviteTokenEnc, tokenFormat: _f, ...rest } = row;
    return {
      ...rest,
      feedToken: feedTokenEnc ? this.vault.open(feedTokenEnc) : '',
      inviteToken: inviteTokenEnc ? this.vault.open(inviteTokenEnc) : null,
      active: !!active,
      appAdmin: !!appAdmin,
      memberships: memberships ?? await this.calendars.membershipsOf(row.id),
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
    const memberships = await this.calendars.allMemberships();
    const rows = await this.db.selectFrom('users').selectAll().orderBy('active', 'desc').orderBy('displayName').execute();
    return Promise.all(rows.map(r => this.toUser(r, memberships.get(r.id) ?? []))) as Promise<User[]>;
  }

  /** Everyone, names only — for picking people to add to a calendar. */
  async directory(): Promise<{ id: number; displayName: string; username: string }[]> {
    return this.db.selectFrom('users').select(['id', 'displayName', 'username']).where('active', '=', 1).orderBy('displayName').execute();
  }

  async count(): Promise<number> {
    const r = await this.db.selectFrom('users').select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  async countActiveAppAdmins(excludingId = 0): Promise<number> {
    const r = await this.db.selectFrom('users').select(eb => eb.fn.countAll<number>().as('n'))
      .where('appAdmin', '=', 1).where('active', '=', 1).where('id', '!=', excludingId)
      .executeTakeFirstOrThrow();
    return Number(r.n);
  }

  /** id → display name; only for the given ids when they're passed. */
  async names(ids?: (number | null | undefined)[]): Promise<Record<number, string>> {
    const wanted = ids && [...new Set(ids.filter((i): i is number => !!i))];
    if (wanted && !wanted.length) return {};
    let q = this.db.selectFrom('users').select(['id', 'displayName']);
    if (wanted) q = q.where('id', 'in', wanted);
    return Object.fromEntries((await q.execute()).map(r => [r.id, r.displayName]));
  }

  private columns(u: NewUser) {
    return {
      username: u.username,
      displayName: u.displayName,
      passwordHash: u.passwordHash,
      sessionVersion: u.sessionVersion,
      active: u.active ? 1 : 0,
      appAdmin: u.appAdmin ? 1 : 0,
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

  async create(u: NewUser): Promise<User> {
    const { id } = await this.db.insertInto('users')
      .values({ ...(u.id ? { id: u.id } : {}), ...this.columns(u) })
      .returning('id').executeTakeFirstOrThrow();
    return (await this.findById(id))!;
  }

  /** Saves the account itself; calendar memberships are changed through CalendarRepository. */
  async update(u: User): Promise<User> {
    await this.db.updateTable('users').set(this.columns(u)).where('id', '=', u.id).execute();
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

}
