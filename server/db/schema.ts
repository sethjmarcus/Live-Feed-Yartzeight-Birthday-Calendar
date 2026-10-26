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
  appAdmin: number;             // 0 / 1 — runs the site (accounts, calendars, settings)
  createdAt: string;
  lastLogin: string | null;
  lastFeedFetch: string | null;
  lastFeedAgent: string | null;
}

export interface CalendarsTable {
  id: Generated<number>;
  name: string;
  createdAt: string;
  createdBy: number | null;
}

export interface CalendarMembersTable {
  calendarId: number;
  userId: number;
  permissions: string;          // JSON array of Permission
  inFeed: number;               // 0 / 1 — include in this person's phone feed
  addedAt: string;
  addedBy: number | null;
}

export interface EventsTable {
  id: Generated<number>;
  calendarId: number;
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
  calendarId: number | null;
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
  calendars: CalendarsTable;
  calendarMembers: CalendarMembersTable;
  events: EventsTable;
  auditLog: AuditLogTable;
  settings: SettingsTable;
  hebcalCache: HebcalCacheTable;
}
