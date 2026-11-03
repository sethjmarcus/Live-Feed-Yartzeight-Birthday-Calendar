/**
 * Events: create / update / delete / restore, each enforcing the permissions the person
 * holds in the event's calendar and writing an audit entry in the same transaction.
 */
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { Actor } from '../users/userRepository.js';
import type { CalendarEvent } from './eventRepository.js';
import { can, canDeleteEvent, canEditEvent, calendarsWhere } from '../../../shared/permissions.js';
import { normalizeEvent, type ValidEventInput } from '../../../shared/schemas.js';
import { displayName } from '../../../shared/occurrences.js';
import type { EventType } from '../../../shared/eventTypes.js';
import { ForbiddenError, NotFoundError } from '../../http/errors.js';
import { diff, nowIso, pick } from '../../lib/util.js';

/** The user-editable fields, compared to build the change history. */
const EDITABLE = ['calendarId', 'type', 'name', 'title', 'hebrewName', 'notes', 'basis', 'dateEntry', 'afterSunset', 'gDate', 'hYear', 'hMonth', 'hDay'] as const;

/** Calendar ids where the actor holds `perm`, optionally narrowed to one calendar. */
export function scope(actor: Actor, perm: 'view' | 'manage', calendar?: string | number | null): number[] {
  const ids = calendarsWhere(actor, perm).map(c => c.id);
  return calendar ? ids.filter(id => id === Number(calendar)) : ids;
}

export class EventService {
  constructor(private uow: UnitOfWork) {}

  /** An event the actor can at least see (or a 404 — no hint that it exists elsewhere). */
  async get(actor: Actor, id: number): Promise<CalendarEvent> {
    const ev = await this.uow.repos.events.findById(id);
    if (!ev || !can(actor, 'view', ev.calendarId) && !canEditEvent(actor, ev)) throw new NotFoundError('That event does not exist.');
    return ev;
  }

  async getForEdit(actor: Actor, id: number) {
    const ev = await this.uow.repos.events.findById(id);
    if (!ev || !actor.calendars.some(c => c.id === ev.calendarId)) throw new NotFoundError('That event does not exist.');
    if (!canEditEvent(actor, ev)) throw new ForbiddenError("You can't edit this event.");
    return ev;
  }

  /**
   * Events in the calendars the actor can view. "Added by" filtering and deleted events
   * are only for calendars they manage.
   */
  async search(actor: Actor, q: { calendar?: string; q?: string; type?: string; by?: string; deleted?: string }) {
    const managed = scope(actor, 'manage', q.calendar);
    return this.uow.repos.events.search({
      calendarIds: q.by ? managed : scope(actor, 'view', q.calendar),
      text: (q.q || '').slice(0, 100),
      type: (q.type || '') as EventType | '',
      createdBy: q.by ? Number(q.by) : null,
      deletedIn: q.deleted === '1' ? managed : [],
    });
  }

  async create(actor: Actor, input: ValidEventInput) {
    if (!can(actor, 'add', input.calendarId)) throw new ForbiddenError("You can't add events to that calendar.");
    const now = nowIso();
    return this.uow.transaction(async r => {
      const ev = await r.events.create({
        ...normalizeEvent(input), revision: 0,
        createdBy: actor.id, createdAt: now, updatedBy: actor.id, updatedAt: now, deletedBy: null, deletedAt: null,
      });
      await r.audit.add({ at: now, actorId: actor.id, action: 'event.create', calendarId: ev.calendarId, eventId: ev.id, label: displayName(ev), snapshot: pick(ev, [...EDITABLE]) });
      return ev;
    });
  }

  async update(actor: Actor, id: number, input: ValidEventInput) {
    const existing = await this.getForEdit(actor, id);
    const next = normalizeEvent(input);
    if (next.calendarId !== existing.calendarId && !can(actor, 'add', next.calendarId)) {
      throw new ForbiddenError("You can't move events into that calendar.");
    }
    const changes = diff(existing, { ...existing, ...next }, [...EDITABLE]);
    if (!changes.length) return { event: existing, changed: false };
    const now = nowIso();
    const updated: CalendarEvent = { ...existing, ...next, updatedBy: actor.id, updatedAt: now, revision: existing.revision + 1 };
    await this.uow.transaction(async r => {
      await r.events.update(updated);
      await r.audit.add({ at: now, actorId: actor.id, action: 'event.update', calendarId: updated.calendarId, eventId: id, label: displayName(updated), changes });
    });
    return { event: updated, changed: true };
  }

  async remove(actor: Actor, id: number) {
    const existing = await this.get(actor, id);
    if (!canDeleteEvent(actor, existing)) throw new ForbiddenError("You can't delete this event.");
    const now = nowIso();
    const updated = { ...existing, deletedAt: now, deletedBy: actor.id, revision: existing.revision + 1 };
    await this.uow.transaction(async r => {
      await r.events.update(updated);
      await r.audit.add({ at: now, actorId: actor.id, action: 'event.delete', calendarId: updated.calendarId, eventId: id, label: displayName(updated) });
    });
    return updated;
  }

  private async managedEvent(actor: Actor, id: number) {
    const ev = await this.uow.repos.events.findById(id);
    if (!ev || !actor.calendars.some(c => c.id === ev.calendarId)) throw new NotFoundError('That event does not exist.');
    if (!can(actor, 'manage', ev.calendarId)) throw new ForbiddenError();
    return ev;
  }

  async restore(actor: Actor, id: number) {
    const existing = await this.managedEvent(actor, id);
    const now = nowIso();
    const updated = { ...existing, deletedAt: null, deletedBy: null, updatedAt: now, updatedBy: actor.id, revision: existing.revision + 1 };
    await this.uow.transaction(async r => {
      await r.events.update(updated);
      await r.audit.add({ at: now, actorId: actor.id, action: 'event.restore', calendarId: updated.calendarId, eventId: id, label: displayName(updated) });
    });
    return updated;
  }

  async history(actor: Actor, id: number) {
    const event = await this.managedEvent(actor, id);
    return { event, entries: await this.uow.repos.audit.forEvent(id) };
  }
}
