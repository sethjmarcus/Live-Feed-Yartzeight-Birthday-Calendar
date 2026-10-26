import type { Selectable } from 'kysely';
import type { Executor } from '../../db/database.js';
import type { EventsTable } from '../../db/schema.js';
import type { EventDTO } from '../../../shared/api.js';
import type { EventType, Basis } from '../../../shared/eventTypes.js';

export type CalendarEvent = EventDTO;
export type NewCalendarEvent = Omit<CalendarEvent, 'id'> & { id?: number };

function toEvent(row: Selectable<EventsTable> | undefined): CalendarEvent | null {
  if (!row) return null;
  return {
    ...row,
    type: row.type as EventType,
    basis: row.basis as Basis,
    dateEntry: row.dateEntry as CalendarEvent['dateEntry'],
    afterSunset: !!row.afterSunset,
  };
}
function toRow(ev: NewCalendarEvent) {
  const { id, ...rest } = ev;
  return { ...(id ? { id } : {}), ...rest, afterSunset: ev.afterSunset ? 1 : 0 };
}

export interface EventSearch {
  text?: string;
  type?: EventType | '';
  createdBy?: number | null;
  includeDeleted?: boolean;
}

export class EventRepository {
  constructor(private db: Executor) {}

  async findById(id: number) {
    return toEvent(await this.db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst());
  }

  /** Events that are not deleted — what goes into feeds. */
  async listActive(): Promise<CalendarEvent[]> {
    return (await this.db.selectFrom('events').selectAll().where('deletedAt', 'is', null).execute()).map(r => toEvent(r)!);
  }

  async search({ text, type, createdBy, includeDeleted }: EventSearch = {}): Promise<CalendarEvent[]> {
    let q = this.db.selectFrom('events').selectAll();
    if (!includeDeleted) q = q.where('deletedAt', 'is', null);
    if (type) q = q.where('type', '=', type);
    if (createdBy) q = q.where('createdBy', '=', createdBy);
    if (text) {
      const like = `%${text}%`;
      q = q.where(eb => eb.or([eb('name', 'like', like), eb('title', 'like', like), eb('hebrewName', 'like', like), eb('notes', 'like', like)]));
    }
    const rows = await q.execute();
    return rows.map(r => toEvent(r)!).sort((a, b) => sortName(a).localeCompare(sortName(b)));
  }

  async countByCreator(): Promise<Record<number, number>> {
    const rows = await this.db.selectFrom('events').select(['createdBy', eb => eb.fn.countAll<number>().as('n')])
      .where('deletedAt', 'is', null).groupBy('createdBy').execute();
    return Object.fromEntries(rows.filter(r => r.createdBy !== null).map(r => [r.createdBy, Number(r.n)]));
  }

  async create(ev: NewCalendarEvent): Promise<CalendarEvent> {
    const { id } = await this.db.insertInto('events').values(toRow(ev)).returning('id').executeTakeFirstOrThrow();
    return (await this.findById(id))!;
  }

  async update(ev: CalendarEvent): Promise<CalendarEvent> {
    await this.db.updateTable('events').set(toRow({ ...ev, id: undefined })).where('id', '=', ev.id).execute();
    return ev;
  }
}

const sortName = (e: CalendarEvent) => (e.type === 'other' ? e.title : e.name).toLowerCase();
