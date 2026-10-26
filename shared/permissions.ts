/**
 * Permissions and the authorization policy — pure functions shared by the server
 * (enforcement) and the browser (showing/hiding buttons).
 *
 * Two levels:
 *  - Per calendar: each person holds a set of permissions in each calendar they belong
 *    to (usually one of the ROLES below). "manage" implies everything in that calendar.
 *  - App admin: runs the site — accounts, calendars, settings, backups. How much an app
 *    admin sees of calendars they don't belong to is set by APP_ADMIN_ACCESS:
 *      'full'     — manages every calendar (one family, several calendars)
 *      'metadata' — sees only names and counts (unrelated families sharing one server)
 */
export const PERMISSIONS = [
  { key: 'subscribe', label: 'Subscribe', help: "Gets this calendar's events on their phone" },
  { key: 'view', label: 'View', help: 'Can browse events in this web app' },
  { key: 'add', label: 'Add', help: 'Can add new events' },
  { key: 'editOwn', label: 'Edit own', help: 'Can edit events they added' },
  { key: 'editAny', label: 'Edit any', help: "Can edit anyone's events" },
  { key: 'deleteOwn', label: 'Delete own', help: 'Can delete events they added' },
  { key: 'deleteAny', label: 'Delete any', help: "Can delete anyone's events" },
  { key: 'manage', label: 'Manage', help: 'Members, roles, activity log, restoring deleted events' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key) as [Permission, ...Permission[]];

export type RoleKey = 'subscriber' | 'viewer' | 'contributor' | 'editor' | 'owner';
export const ROLES: Record<RoleKey, { label: string; perms: Permission[] }> = {
  subscriber: { label: 'Subscriber', perms: ['subscribe'] },
  viewer: { label: 'Viewer', perms: ['subscribe', 'view'] },
  contributor: { label: 'Contributor', perms: ['subscribe', 'view', 'add', 'editOwn', 'deleteOwn'] },
  editor: { label: 'Editor', perms: ['subscribe', 'view', 'add', 'editOwn', 'editAny', 'deleteOwn', 'deleteAny'] },
  owner: { label: 'Owner', perms: PERMISSION_KEYS },
};
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];

export type AppAdminAccess = 'full' | 'metadata';

/** What one person may do in one calendar (already resolved for app admins). */
export interface CalendarAccess {
  id: number;
  name: string;
  permissions: Permission[];
  /** False when the access comes only from being app admin. */
  member: boolean;
  /** Whether this calendar's events go into their phone feed. */
  inFeed: boolean;
}

export interface Actor {
  id: number;
  active: boolean;
  appAdmin: boolean;
  calendars: CalendarAccess[];
}

type MaybeActor = Actor | null | undefined;

export function permissionsIn(user: MaybeActor, calendarId: number): Permission[] {
  if (!user || !user.active) return [];
  return user.calendars.find(c => c.id === calendarId)?.permissions ?? [];
}

/** May the user do `perm` in this calendar? */
export function can(user: MaybeActor, perm: Permission, calendarId: number): boolean {
  const perms = permissionsIn(user, calendarId);
  return perms.includes('manage') || perms.includes(perm);
}

/** Calendars in which the user may do `perm`. */
export function calendarsWhere(user: MaybeActor, perm: Permission): CalendarAccess[] {
  if (!user || !user.active) return [];
  return user.calendars.filter(c => can(user, perm, c.id));
}

/** May the user do `perm` in at least one calendar? */
export function canSomewhere(user: MaybeActor, perm: Permission): boolean {
  return calendarsWhere(user, perm).length > 0;
}

export function isAppAdmin(user: MaybeActor): boolean {
  return !!user && user.active && user.appAdmin;
}

type EventRef = { calendarId: number; createdBy: number | null; deletedAt?: string | null };

export function canEditEvent(user: MaybeActor, ev: EventRef): boolean {
  if (!user || ev.deletedAt) return false;
  return can(user, 'editAny', ev.calendarId) || (can(user, 'editOwn', ev.calendarId) && ev.createdBy === user.id);
}
export function canDeleteEvent(user: MaybeActor, ev: EventRef): boolean {
  if (!user || ev.deletedAt) return false;
  return can(user, 'deleteAny', ev.calendarId) || (can(user, 'deleteOwn', ev.calendarId) && ev.createdBy === user.id);
}

/** The role matching a permission set, or null for a custom set. */
export function roleOf(perms: readonly Permission[]): RoleKey | null {
  const set = new Set(perms);
  for (const key of ROLE_KEYS) {
    const p = ROLES[key].perms;
    if (p.length === set.size && p.every(k => set.has(k))) return key;
  }
  return null;
}

export function roleName(perms: readonly Permission[]): string {
  const key = roleOf(perms);
  return key ? ROLES[key].label : 'Custom';
}

/**
 * Turn a person's memberships into what they may do in each calendar. App admins in
 * 'full' mode get "manage" on every calendar; in 'metadata' mode only their memberships count.
 */
export function resolveAccess(
  user: { appAdmin: boolean; memberships: { calendarId: number; calendarName: string; permissions: Permission[]; inFeed: boolean }[] },
  allCalendars: { id: number; name: string }[],
  mode: AppAdminAccess,
): CalendarAccess[] {
  const out: CalendarAccess[] = user.memberships.map(m => ({
    id: m.calendarId, name: m.calendarName, permissions: m.permissions, member: true, inFeed: m.inFeed,
  }));
  if (user.appAdmin && mode === 'full') {
    for (const c of allCalendars) {
      const mine = out.find(a => a.id === c.id);
      if (mine) { if (!mine.permissions.includes('manage')) mine.permissions = [...mine.permissions, 'manage']; }
      else out.push({ id: c.id, name: c.name, permissions: ['manage'], member: false, inFeed: false });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
