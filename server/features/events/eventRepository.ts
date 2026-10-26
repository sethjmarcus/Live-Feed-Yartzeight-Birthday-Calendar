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
  /** Only these calendars. */
  calendarIds: number[];
  text?: string;
  type?: EventType | '';
  createdBy?: number | null;
  /** Also return deleted events of these calendars. */
  deletedIn?: number[];
}

export class EventRepository {
  constructor(private db: Executor) {}

  async findById(id: number) {
    return toEvent(await this.db.selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst());
  }

  /** Events that are not deleted — what goes into feeds. Every calendar unless `calendarIds` is given. */
  async listActive(calendarIds?: number[]): Promise<CalendarEvent[]> {
    if (calendarIds && !calendarIds.length) return [];
    let q = this.db.selectFrom('events').selectAll().where('deletedAt', 'is', null);
    if (calendarIds) q = q.where('calendarId', 'in', calendarIds);
    return (await q.execute()).map(r => toEvent(r)!);
  }

  async search({ calendarIds, text, type, createdBy, deletedIn = [] }: EventSearch): Promise<CalendarEvent[]> {
    if (!calendarIds.length) return [];
    let q = this.db.selectFrom('events').selectAll().where('calendarId', 'in', calendarIds);
    q = q.where(eb => eb.or([
      eb('deletedAt', 'is', null),
      ...(deletedIn.length ? [eb('calendarId', 'in', deletedIn)] : []),
    ]));
    if (type) q = q.where('type', '=', type);
    if (createdBy) q = q.where('createdBy', '=', createdBy);
    if (text) {
      const like = `%${text}%`;
      q = q.where(eb => eb.or([eb('name', 'like', like), eb('title', 'like', like), eb('hebrewName', 'like', like), eb('notes', 'like', like)]));
    }
    const rows = await q.execute();
    return rows.map(r => toEvent(r)!).sort((a, b) => sortName(a).localeCompare(sortName(b)));
  }

  async countByCreator(calendarIds?: number[]): Promise<Record<number, number>> {
    if (calendarIds && !calendarIds.length) return {};
    let q = this.db.selectFrom('events').select(['createdBy', eb => eb.fn.countAll<number>().as('n')]).where('deletedAt', 'is', null);
    if (calendarIds) q = q.where('calendarId', 'in', calendarIds);
    const rows = await q.groupBy('createdBy').execute();
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
