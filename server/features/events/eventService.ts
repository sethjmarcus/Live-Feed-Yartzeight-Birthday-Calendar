/**
 * Events: create / update / delete / restore, each enforcing permissions and
 * writing an audit entry in the same transaction.
 */
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { User } from '../users/userRepository.js';
import type { CalendarEvent } from './eventRepository.js';
import { can, canDeleteEvent, canEditEvent } from '../../../shared/permissions.js';
import { normalizeEvent, type ValidEventInput } from '../../../shared/schemas.js';
import { displayName } from '../../../shared/occurrences.js';
import type { EventType } from '../../../shared/eventTypes.js';
import { ForbiddenError, NotFoundError } from '../../http/errors.js';
import { diff, nowIso, pick } from '../../lib/util.js';

/** The user-editable fields, compared to build the change history. */
const EDITABLE = ['type', 'name', 'title', 'hebrewName', 'notes', 'basis', 'dateEntry', 'afterSunset', 'gDate', 'hYear', 'hMonth', 'hDay'] as const;

export class EventService {
  constructor(private uow: UnitOfWork) {}

  async get(id: number): Promise<CalendarEvent> {
    const ev = await this.uow.repos.events.findById(id);
    if (!ev) throw new NotFoundError('That event does not exist.');
    return ev;
  }

  async getForEdit(actor: User, id: number) {
    const ev = await this.get(id);
    if (!canEditEvent(actor, ev)) throw new ForbiddenError("You can't edit this event.");
    return ev;
  }

  async search(actor: User, q: { q?: string; type?: string; by?: string; deleted?: string }) {
    const isAdmin = can(actor, 'admin');
    return this.uow.repos.events.search({
      text: (q.q || '').slice(0, 100),
      type: (q.type || '') as EventType | '',
      createdBy: isAdmin && q.by ? Number(q.by) : null,
      includeDeleted: isAdmin && q.deleted === '1',
    });
  }

  async create(actor: User, input: ValidEventInput) {
    if (!can(actor, 'add')) throw new ForbiddenError();
    const now = nowIso();
    return this.uow.transaction(async r => {
      const ev = await r.events.create({
        ...normalizeEvent(input), revision: 0,
        createdBy: actor.id, createdAt: now, updatedBy: actor.id, updatedAt: now, deletedBy: null, deletedAt: null,
      });
      await r.audit.add({ at: now, actorId: actor.id, action: 'event.create', eventId: ev.id, label: displayName(ev), snapshot: pick(ev, [...EDITABLE]) });
      return ev;
    });
  }

  async update(actor: User, id: number, input: ValidEventInput) {
    const existing = await this.getForEdit(actor, id);
    const next = normalizeEvent(input);
    const changes = diff(existing, { ...existing, ...next }, [...EDITABLE]);
    if (!changes.length) return { event: existing, changed: false };
    const now = nowIso();
    const updated: CalendarEvent = { ...existing, ...next, updatedBy: actor.id, updatedAt: now, revision: existing.revision + 1 };
    await this.uow.transaction(async r => {
      await r.events.update(updated);
      await r.audit.add({ at: now, actorId: actor.id, action: 'event.update', eventId: id, label: displayName(updated), changes });
    });
    return { event: updated, changed: true };
  }

  async remove(actor: User, id: number) {
    const existing = await this.get(id);
    if (!canDeleteEvent(actor, existing)) throw new ForbiddenError("You can't delete this event.");
    const now = nowIso();
    const updated = { ...existing, deletedAt: now, deletedBy: actor.id, revision: existing.revision + 1 };
    await this.uow.transaction(async r => {
      await r.events.update(updated);
      await r.audit.add({ at: now, actorId: actor.id, action: 'event.delete', eventId: id, label: displayName(updated) });
    });
    return updated;
  }

  async restore(actor: User, id: number) {
    if (!can(actor, 'admin')) throw new ForbiddenError();
    const existing = await this.get(id);
    const now = nowIso();
    const updated = { ...existing, deletedAt: null, deletedBy: null, updatedAt: now, updatedBy: actor.id, revision: existing.revision + 1 };
    await this.uow.transaction(async r => {
      await r.events.update(updated);
      await r.audit.add({ at: now, actorId: actor.id, action: 'event.restore', eventId: id, label: displayName(updated) });
    });
    return updated;
  }

  async history(actor: User, id: number) {
    if (!can(actor, 'admin')) throw new ForbiddenError();
    const event = await this.get(id);
    return { event, entries: await this.uow.repos.audit.forEvent(id) };
  }
}
