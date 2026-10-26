/**
 * Shapes of the JSON exchanged between server and browser.
 */
import type { EventCore } from './occurrences.js';
import type { Permission } from './permissions.js';
import type { FeedPrefs, Settings } from './schemas.js';
import type { HebrewDate, IsoDate } from './hebrewCalendar.js';
import type { EventType } from './eventTypes.js';

export interface UserDTO {
  id: number;
  username: string;
  displayName: string;
  active: boolean;
  permissions: Permission[];
  hasPassword: boolean;
  feedPrefs: FeedPrefs;
  createdAt: string;
  lastLogin: string | null;
  lastFeedFetch: string | null;
  lastFeedAgent: string | null;
}

export interface SessionDTO {
  user: UserDTO | null;
  needsSetup: boolean;
  csrfToken: string;
  calendarName: string;
}

export interface EventDTO extends EventCore {
  id: number;
  dateEntry: 'gregorian' | 'hebrew';
  revision: number;
  createdBy: number | null;
  createdAt: string;
  updatedBy: number | null;
  updatedAt: string;
  deletedBy: number | null;
  deletedAt: string | null;
}

export interface ChangeDTO { field: string; from: unknown; to: unknown }

export interface AuditEntryDTO {
  id: number;
  at: string;
  actorId: number | null;
  action: string;
  eventId: number | null;
  targetUserId: number | null;
  label: string | null;
  changes: ChangeDTO[];
}

/** Names for ids shown in "added by" etc. */
export type NameMap = Record<number, string>;

export interface UpcomingItem {
  kind: 'event' | 'holiday';
  type: EventType | 'holiday';
  eventId?: number;
  iso: IsoDate;
  abs: number;
  hebrew: HebrewDate;
  title: string;
  subtitle?: string;
  eveningBefore?: IsoDate | null;
}

export interface FeedLinks {
  https: string;
  webcal: string;
  google: string;
  pageUrl: string;
  isLocal: boolean;
}

export interface SubscriptionDTO {
  user: UserDTO;
  links: FeedLinks;
  candlesAvailable: boolean;
}

export interface UserDetailDTO {
  user: UserDTO;
  inviteUrl: string | null;
  inviteExpires: string | null;
  links: FeedLinks;
  activity: AuditEntryDTO[];
  names: NameMap;
}

export interface HebcalStatus {
  cachedYears: number;
  totalYears: number;
  lastFetched: string | null;
  location: string | null;
  lastError: string | null;
}

export interface SettingsDTO {
  settings: Settings;
  hebcal: HebcalStatus;
  baseUrl: string;
  publicUrlSet: boolean;
}

export interface ApiError {
  error: string;
  fields?: Record<string, string>;
}
