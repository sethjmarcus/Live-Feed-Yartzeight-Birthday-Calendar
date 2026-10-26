/**
 * Calendars and their members (who belongs to which calendar, with which permissions).
 */
import type { Executor } from '../../db/database.js';
import { PERMISSION_KEYS, type Permission } from '../../../shared/permissions.js';
import type { CalendarDTO, CalendarNameMap, CalendarOverviewDTO, MemberDTO, MembershipDTO } from '../../../shared/api.js';

export type Calendar = CalendarDTO;

export interface NewMember {
  calendarId: number;
  userId: number;
  permissions: Permission[];
  inFeed: boolean;
  addedAt: string;
  addedBy: number | null;
}

const parsePerms = (json: string): Permission[] => {
  const list = JSON.parse(json) as string[];
  return PERMISSION_KEYS.filter(k => list.includes(k));
};

export class CalendarRepository {
  constructor(private db: Executor) {}

  // ---------------------------------------------------------------- calendars
  list(): Promise<Calendar[]> {
    return this.db.selectFrom('calendars').selectAll().orderBy('name').execute();
  }

  async findById(id: number): Promise<Calendar | null> {
    return (await this.db.selectFrom('calendars').selectAll().where('id', '=', id).executeTakeFirst()) ?? null;
  }

  async names(): Promise<CalendarNameMap> {
    return Object.fromEntries((await this.list()).map(c => [c.id, c.name]));
  }

  async create(c: Omit<Calendar, 'id'>): Promise<Calendar> {
    const { id } = await this.db.insertInto('calendars').values(c).returning('id').executeTakeFirstOrThrow();
    return (await this.findById(id))!;
  }

  async rename(id: number, name: string) {
    await this.db.updateTable('calendars').set({ name }).where('id', '=', id).execute();
  }

  /** Must run in a transaction. Members go with it; old log entries keep their label. */
  async delete(id: number) {
    await this.db.updateTable('auditLog').set({ calendarId: null }).where('calendarId', '=', id).execute();
    await this.db.deleteFrom('calendarMembers').where('calendarId', '=', id).execute();
    await this.db.deleteFrom('calendars').where('id', '=', id).execute();
  }

  /** Every calendar with member and (active) event counts — no contents. */
  async overview(ids?: number[]): Promise<CalendarOverviewDTO[]> {
    if (ids && !ids.length) return [];
    let q = this.db.selectFrom('calendars').selectAll('calendars')
      .select(eb => [
        eb.selectFrom('calendarMembers').whereRef('calendarMembers.calendarId', '=', 'calendars.id')
          .select(e => e.fn.countAll<number>().as('n')).as('memberCount'),
        eb.selectFrom('events').whereRef('events.calendarId', '=', 'calendars.id').where('events.deletedAt', 'is', null)
          .select(e => e.fn.countAll<number>().as('n')).as('eventCount'),
      ]);
    if (ids) q = q.where('calendars.id', 'in', ids);
    const rows = await q.orderBy('calendars.name').execute();
    return rows.map(r => ({ ...r, memberCount: Number(r.memberCount), eventCount: Number(r.eventCount) }));
  }

  /** Events ever stored in the calendar, including deleted ones. */
  async eventRows(id: number): Promise<number> {
    const r = await this.db.selectFrom('events').select(eb => eb.fn.countAll<number>().as('n')).where('calendarId', '=', id).executeTakeFirstOrThrow();
    return Number(r.n);
  }

  // ---------------------------------------------------------------- members
  private membershipQuery() {
    return this.db.selectFrom('calendarMembers')
      .innerJoin('calendars', 'calendars.id', 'calendarMembers.calendarId')
      .select(['calendarMembers.userId', 'calendarMembers.calendarId', 'calendars.name as calendarName', 'calendarMembers.permissions', 'calendarMembers.inFeed'])
      .orderBy('calendars.name');
  }

  private static toMembership(r: { calendarId: number; calendarName: string; permissions: string; inFeed: number }): MembershipDTO {
    return { calendarId: r.calendarId, calendarName: r.calendarName, permissions: parsePerms(r.permissions), inFeed: !!r.inFeed };
  }

  async membershipsOf(userId: number): Promise<MembershipDTO[]> {
    return (await this.membershipQuery().where('calendarMembers.userId', '=', userId).execute()).map(CalendarRepository.toMembership);
  }

  /** userId → memberships, for listing many people at once. */
  async allMemberships(): Promise<Map<number, MembershipDTO[]>> {
    const out = new Map<number, MembershipDTO[]>();
    for (const r of await this.membershipQuery().execute()) {
      out.set(r.userId, [...(out.get(r.userId) ?? []), CalendarRepository.toMembership(r)]);
    }
    return out;
  }

  async members(calendarId: number): Promise<MemberDTO[]> {
    const rows = await this.db.selectFrom('calendarMembers')
      .innerJoin('users', 'users.id', 'calendarMembers.userId')
      .select(['users.id as userId', 'users.displayName', 'users.username', 'users.active', 'users.passwordHash',
        'calendarMembers.permissions', 'calendarMembers.inFeed', 'calendarMembers.addedAt'])
      .where('calendarMembers.calendarId', '=', calendarId)
      .orderBy('users.active', 'desc').orderBy('users.displayName')
      .execute();
    return rows.map(({ passwordHash, ...r }) => ({
      ...r, active: !!r.active, hasPassword: !!passwordHash, permissions: parsePerms(r.permissions), inFeed: !!r.inFeed,
    }));
  }

  async findMember(calendarId: number, userId: number) {
    const r = await this.db.selectFrom('calendarMembers').selectAll()
      .where('calendarId', '=', calendarId).where('userId', '=', userId).executeTakeFirst();
    return r ? { ...r, permissions: parsePerms(r.permissions), inFeed: !!r.inFeed } : null;
  }

  async addMember(m: NewMember) {
    await this.db.insertInto('calendarMembers')
      .values({ ...m, permissions: JSON.stringify(m.permissions), inFeed: m.inFeed ? 1 : 0 }).execute();
  }

  async updateMember(calendarId: number, userId: number, set: { permissions?: Permission[]; inFeed?: boolean }) {
    await this.db.updateTable('calendarMembers').set({
      ...(set.permissions ? { permissions: JSON.stringify(set.permissions) } : {}),
      ...(set.inFeed !== undefined ? { inFeed: set.inFeed ? 1 : 0 } : {}),
    }).where('calendarId', '=', calendarId).where('userId', '=', userId).execute();
  }

  async removeMember(calendarId: number, userId: number) {
    await this.db.deleteFrom('calendarMembers').where('calendarId', '=', calendarId).where('userId', '=', userId).execute();
  }

  /** Active members who can manage the calendar, not counting one person. */
  async countManagers(calendarId: number, excludingUserId = 0): Promise<number> {
    return (await this.members(calendarId))
      .filter(m => m.active && m.userId !== excludingUserId && m.permissions.includes('manage')).length;
  }
}
