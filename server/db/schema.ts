/**
 * Database table types for Kysely. Column names are camelCase here and
 * snake_case in SQLite — Kysely's CamelCasePlugin converts between them.
 */
import type { Generated } from 'kysely';

export interface UsersTable {
  id: Generated<number>;
  username: string;
  displayName: string;
  passwordHash: string | null;
  sessionVersion: number;
  active: number;               // 0 / 1
  feedToken: string;            // HMAC of the token (lookup key) — see lib/tokens.ts
  feedTokenEnc: string | null;  // encrypted token
  feedTypes: string;            // JSON array
  feedAlarm: string;
  inviteToken: string | null;   // HMAC of the token (lookup key)
  inviteTokenEnc: string | null;
  inviteExpires: string | null;
  tokenFormat: number;          // 0 = legacy plain text, 1 = protected
  createdAt: string;
  lastLogin: string | null;
  lastFeedFetch: string | null;
  lastFeedAgent: string | null;
}

export interface UserPermissionsTable {
  userId: number;
  permission: string;
}

export interface EventsTable {
  id: Generated<number>;
  type: string;
  name: string;
  title: string;
  hebrewName: string;
  notes: string;
  basis: string;
  dateEntry: string;
  afterSunset: number;          // 0 / 1
  gDate: string;
  hYear: number;
  hMonth: number;
  hDay: number;
  revision: number;
  createdBy: number | null;
  createdAt: string;
  updatedBy: number | null;
  updatedAt: string;
  deletedBy: number | null;
  deletedAt: string | null;
}

export interface AuditLogTable {
  id: Generated<number>;
  at: string;
  actorId: number | null;
  action: string;
  eventId: number | null;
  targetUserId: number | null;
  label: string | null;
  changes: string | null;       // JSON
  snapshot: string | null;      // JSON
}

export interface SettingsTable {
  key: string;
  value: string;                // JSON
}

export interface HebcalCacheTable {
  key: string;
  fetchedAt: string;
  body: string;                 // JSON
}

export interface DB {
  users: UsersTable;
  userPermissions: UserPermissionsTable;
  events: EventsTable;
  auditLog: AuditLogTable;
  settings: SettingsTable;
  hebcalCache: HebcalCacheTable;
}
