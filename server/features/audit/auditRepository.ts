/**
 * Append-only activity log: who did what, when, and what changed.
 */
import type { Executor } from '../../db/database.js';
import type { AuditEntryDTO, ChangeDTO } from '../../../shared/api.js';

export interface NewAuditEntry {
  at: string;
  actorId: number | null;
  action: string;
  calendarId?: number | null;
  eventId?: number | null;
  targetUserId?: number | null;
  label?: string | null;
  changes?: ChangeDTO[] | null;
  snapshot?: unknown;
}

export class AuditRepository {
  constructor(private db: Executor) {}

  async add(e: NewAuditEntry) {
    await this.db.insertInto('auditLog').values({
      at: e.at,
      actorId: e.actorId,
      action: e.action,
      calendarId: e.calendarId ?? null,
      eventId: e.eventId ?? null,
      targetUserId: e.targetUserId ?? null,
      label: e.label ?? null,
      changes: e.changes?.length ? JSON.stringify(e.changes) : null,
      snapshot: e.snapshot ? JSON.stringify(e.snapshot) : null,
    }).execute();
  }

  async forEvent(eventId: number): Promise<AuditEntryDTO[]> {
    const rows = await this.db.selectFrom('auditLog').selectAll().where('eventId', '=', eventId).orderBy('id', 'desc').execute();
    return rows.map(toDTO);
  }

  /**
   * Newest first. kind: '' | 'event' | 'user' (accounts and calendar membership).
   * Scope: entries of `calendarIds`, plus site-wide entries (no calendar) when `siteWide`.
   */
  async page({ userId, kind, calendarIds, siteWide, limit, offset }: {
    userId?: number | null; kind?: string; calendarIds: number[]; siteWide: boolean; limit: number; offset: number;
  }) {
    if (!calendarIds.length && !siteWide) return { entries: [], total: 0 };
    let q = this.db.selectFrom('auditLog');
    q = q.where(eb => eb.or([
      ...(calendarIds.length ? [eb('calendarId', 'in', calendarIds)] : []),
      ...(siteWide ? [eb('calendarId', 'is', null)] : []),
    ]));
    if (userId) q = q.where(eb => eb.or([eb('actorId', '=', userId), eb('targetUserId', '=', userId)]));
    if (kind === 'event') q = q.where('action', 'like', 'event.%');
    if (kind === 'user') q = q.where(eb => eb.or([eb('action', 'like', 'user.%'), eb('action', 'like', 'member.%')]));
    const { n } = await q.select(eb => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow();
    const rows = await q.selectAll().orderBy('id', 'desc').limit(limit).offset(offset).execute();
    return { entries: rows.map(toDTO), total: Number(n) };
  }
}

function toDTO(r: { id: number; at: string; actorId: number | null; action: string; calendarId: number | null; eventId: number | null; targetUserId: number | null; label: string | null; changes: string | null }): AuditEntryDTO {
  return {
    id: r.id, at: r.at, actorId: r.actorId, action: r.action, calendarId: r.calendarId, eventId: r.eventId,
    targetUserId: r.targetUserId, label: r.label, changes: r.changes ? JSON.parse(r.changes) : [],
  };
}
