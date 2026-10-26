/**
 * Permissions and the authorization policy — pure functions shared by the server
 * (enforcement) and the browser (showing/hiding buttons).
 */
export const PERMISSIONS = [
  { key: 'subscribe', label: 'Subscribe', help: 'Gets a personal calendar feed link for their phone' },
  { key: 'view', label: 'View', help: 'Can browse events in this web app' },
  { key: 'add', label: 'Add', help: 'Can add new events' },
  { key: 'editOwn', label: 'Edit own', help: 'Can edit events they added' },
  { key: 'editAny', label: 'Edit any', help: "Can edit anyone's events" },
  { key: 'deleteOwn', label: 'Delete own', help: 'Can delete events they added' },
  { key: 'deleteAny', label: 'Delete any', help: "Can delete anyone's events" },
  { key: 'admin', label: 'Admin', help: 'Full control: users, permissions, activity log, settings' },
] as const;

export type Permission = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS = PERMISSIONS.map(p => p.key) as [Permission, ...Permission[]];

export const PRESETS: Record<string, { label: string; perms: Permission[] }> = {
  subscriber: { label: 'Subscriber', perms: ['subscribe'] },
  viewer: { label: 'Viewer', perms: ['subscribe', 'view'] },
  contributor: { label: 'Contributor', perms: ['subscribe', 'view', 'add', 'editOwn', 'deleteOwn'] },
  editor: { label: 'Editor', perms: ['subscribe', 'view', 'add', 'editOwn', 'editAny', 'deleteOwn', 'deleteAny'] },
  admin: { label: 'Admin', perms: PERMISSION_KEYS },
};

export interface Actor { id: number; active: boolean; permissions: Permission[] }

export function can(user: Actor | null | undefined, perm: Permission): boolean {
  if (!user || !user.active) return false;
  return user.permissions.includes('admin') || user.permissions.includes(perm);
}
export function canEditEvent(user: Actor | null | undefined, ev: { createdBy: number | null; deletedAt?: string | null }): boolean {
  if (!user || ev.deletedAt) return false;
  return can(user, 'editAny') || (can(user, 'editOwn') && ev.createdBy === user.id);
}
export function canDeleteEvent(user: Actor | null | undefined, ev: { createdBy: number | null; deletedAt?: string | null }): boolean {
  if (!user || ev.deletedAt) return false;
  return can(user, 'deleteAny') || (can(user, 'deleteOwn') && ev.createdBy === user.id);
}

export function presetName(perms: readonly Permission[]): string {
  const set = new Set(perms);
  for (const p of Object.values(PRESETS)) {
    if (p.perms.length === set.size && p.perms.every(k => set.has(k))) return p.label;
  }
  return 'Custom';
}
