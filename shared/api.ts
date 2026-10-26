/**
 * Shapes of the JSON exchanged between server and browser.
 */
import type { EventCore } from './occurrences.js';
import type { AppAdminAccess, CalendarAccess, Permission } from './permissions.js';
import type { FeedPrefs, Settings } from './schemas.js';
import type { HebrewDate, IsoDate } from './hebrewCalendar.js';
import type { EventType } from './eventTypes.js';

/** One person's membership of one calendar. */
export interface MembershipDTO {
  calendarId: number;
  calendarName: string;
  permissions: Permission[];
  inFeed: boolean;
}

export interface UserDTO {
  id: number;
  username: string;
  displayName: string;
  active: boolean;
  appAdmin: boolean;
  memberships: MembershipDTO[];
  hasPassword: boolean;
  feedPrefs: FeedPrefs;
  createdAt: string;
  lastLogin: string | null;
  lastFeedFetch: string | null;
  lastFeedAgent: string | null;
}

/** The signed-in user, plus what they may do in each calendar. */
export interface SessionUserDTO extends UserDTO {
  calendars: CalendarAccess[];
}

export interface SessionDTO {
  user: SessionUserDTO | null;
  needsSetup: boolean;
  csrfToken: string;
  siteName: string;
  appAdminAccess: AppAdminAccess;
}

export interface CalendarDTO {
  id: number;
  name: string;
  createdAt: string;
  createdBy: number | null;
}

/** What an app admin sees of every calendar, even ones they can't open. */
export interface CalendarOverviewDTO extends CalendarDTO {
  memberCount: number;
  eventCount: number;
}

export interface MemberDTO {
  userId: number;
  displayName: string;
  username: string;
  active: boolean;
  hasPassword: boolean;
  permissions: Permission[];
  inFeed: boolean;
  addedAt: string;
}

export interface CalendarDetailDTO {
  calendar: CalendarOverviewDTO;
  members: MemberDTO[];
  /** People who can be added (null when the directory is hidden from this user). */
  directory: { id: number; displayName: string; username: string }[] | null;
}

/** Calendar id → name, for labels. */
export type CalendarNameMap = Record<number, string>;

export interface EventDTO extends EventCore {
  id: number;
  calendarId: number;
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
  calendarId: number | null;
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
  calendarId?: number;
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
  calendarNames: CalendarNameMap;
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
