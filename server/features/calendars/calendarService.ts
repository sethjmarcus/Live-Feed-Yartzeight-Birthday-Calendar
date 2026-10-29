/**
 * Calendars and membership: who belongs to which calendar, with which permissions.
 * Also resolves a signed-in user into an Actor (what they may do in each calendar).
 */
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { Actor, User } from '../users/userRepository.js';
import type { CalendarDetailDTO, CalendarOverviewDTO } from '../../../shared/api.js';
import { can, canSomewhere, isAppAdmin, resolveAccess, roleName, ROLES, type AppAdminAccess, type Permission } from '../../../shared/permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../http/errors.js';
import { diff, nowIso } from '../../lib/util.js';

export class CalendarService {
  constructor(private uow: UnitOfWork, readonly appAdminAccess: AppAdminAccess) {}

  private get repo() { return this.uow.repos.calendars; }

  /** What this user may do in each calendar. */
  async actorFor(user: User): Promise<Actor> {
    const all = user.appAdmin && this.appAdminAccess === 'full' ? await this.repo.list() : [];
    return { ...user, calendars: resolveAccess(user, all, this.appAdminAccess) };
  }

  /**
   * May this person browse the list of everyone's names (to add them to a calendar)?
   * With unrelated families on one server ('metadata'), only app admins may.
   */
  directoryVisible(actor: Actor): boolean {
    return isAppAdmin(actor) || (this.appAdminAccess === 'full' && canSomewhere(actor, 'manage'));
  }

  /** Calendars with counts: every calendar for app admins (names only), otherwise your own. */
  async overview(actor: Actor): Promise<CalendarOverviewDTO[]> {
    return isAppAdmin(actor) ? this.repo.overview() : this.repo.overview(actor.calendars.map(c => c.id));
  }

  async create(actor: Actor, name: string) {
    if (!isAppAdmin(actor)) throw new ForbiddenError('Only an app admin can create calendars.');
    const now = nowIso();
    return this.uow.transaction(async r => {
      const calendar = await r.calendars.create({ name, createdAt: now, createdBy: actor.id });
      await r.calendars.addMember({ calendarId: calendar.id, userId: actor.id, permissions: ROLES.owner.perms, inFeed: true, addedAt: now, addedBy: actor.id });
      await r.audit.add({ at: now, actorId: actor.id, action: 'calendar.create', calendarId: calendar.id, label: name });
      return calendar;
    });
  }

  private async managed(actor: Actor, id: number) {
    const calendar = await this.repo.findById(id);
    if (!calendar) throw new NotFoundError('No such calendar.');
    if (!can(actor, 'manage', id)) throw new ForbiddenError("You don't manage this calendar.");
    return calendar;
  }

  async detail(actor: Actor, id: number): Promise<CalendarDetailDTO> {
    await this.managed(actor, id);
    const [calendar] = await this.repo.overview([id]);
    const members = await this.repo.members(id);
    const directory = this.directoryVisible(actor)
      ? (await this.uow.repos.users.directory()).filter(p => !members.some(m => m.userId === p.id))
      : null;
    return { calendar, members, directory };
  }

  async rename(actor: Actor, id: number, name: string) {
    const calendar = await this.managed(actor, id);
    if (calendar.name === name) return false;
    await this.uow.transaction(async r => {
      await r.calendars.rename(id, name);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'calendar.rename', calendarId: id, label: name, changes: [{ field: 'name', from: calendar.name, to: name }] });
    });
    return true;
  }

  /** Only calendars that never had events can be deleted (nothing is lost). */
  async remove(actor: Actor, id: number) {
    const calendar = await this.managed(actor, id);
    if (await this.repo.eventRows(id)) {
      throw new ValidationError('This calendar has events (or deleted events), so it can’t be deleted. You can rename it instead.');
    }
    await this.uow.transaction(async r => {
      await r.calendars.delete(id);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'calendar.delete', label: calendar.name });
    });
  }

  /** Add someone to the calendar, or change their permissions in it. */
  async setMember(actor: Actor, calendarId: number, userId: number, permissions: Permission[]) {
    await this.managed(actor, calendarId);
    const person = await this.uow.repos.users.findById(userId);
    if (!person) throw new NotFoundError('No such person.');
    const existing = await this.repo.findMember(calendarId, userId);
    // Adding an existing account needs the people list: otherwise anyone could be pulled
    // in by id — revealing their name, or (with a pending invite) taking over the account.
    if (!existing && !this.directoryVisible(actor)) {
      throw new ForbiddenError('Only an app admin can add existing accounts to a calendar. Invite them as someone new instead.');
    }
    if (existing?.permissions.includes('manage') && !permissions.includes('manage')) await this.keepAManager(calendarId, userId);

    const now = nowIso();
    await this.uow.transaction(async r => {
      if (existing) {
        const changes = diff({ role: roleName(existing.permissions), permissions: existing.permissions.join(', ') },
          { role: roleName(permissions), permissions: permissions.join(', ') }, ['role', 'permissions']);
        if (!changes.length) return;
        await r.calendars.updateMember(calendarId, userId, { permissions });
        await r.audit.add({ at: now, actorId: actor.id, action: 'member.update', calendarId, targetUserId: userId, label: roleName(permissions), changes });
      } else {
        await r.calendars.addMember({ calendarId, userId, permissions, inFeed: true, addedAt: now, addedBy: actor.id });
        await r.audit.add({ at: now, actorId: actor.id, action: 'member.add', calendarId, targetUserId: userId, label: roleName(permissions) });
      }
    });
  }

  async removeMember(actor: Actor, calendarId: number, userId: number) {
    await this.managed(actor, calendarId);
    const existing = await this.repo.findMember(calendarId, userId);
    if (!existing) throw new NotFoundError('They are not a member of this calendar.');
    if (existing.permissions.includes('manage')) await this.keepAManager(calendarId, userId);
    await this.uow.transaction(async r => {
      await r.calendars.removeMember(calendarId, userId);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'member.remove', calendarId, targetUserId: userId });
    });
  }

  private async keepAManager(calendarId: number, losingUserId: number) {
    if ((await this.repo.countManagers(calendarId, losingUserId)) === 0) {
      throw new ValidationError('Every calendar needs at least one active member who can manage it.');
    }
  }
}
