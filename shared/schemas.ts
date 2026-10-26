/**
 * Zod schemas for every form / API request. The server validates with them and the
 * React forms use the same schemas, so rules and messages are defined once.
 */
import { z } from 'zod';
import { EVENT_TYPE_KEYS, BASIS_KEYS, FEED_TYPE_KEYS, type EventType } from './eventTypes.js';
import { PERMISSION_KEYS } from './permissions.js';
import { hebrewDateProblem, isValidIso, hebrewFromIso, isoFromHebrew, type HebrewDate } from './hebrewCalendar.js';
import type { EventCore } from './occurrences.js';

const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters.`);
/** Empty inputs ('' / NaN) become undefined, numeric strings become numbers. */
const optionalInt = z.preprocess(
  v => (v === '' || v === null || v === undefined || Number.isNaN(v) ? undefined : Number(v)),
  z.number().int().optional(),
);
const password = z.string().min(8, 'At least 8 characters.').max(200);
const username = z.string().trim().toLowerCase()
  .transform(s => s.replace(/\s+/g, '.'))
  .pipe(z.string().regex(/^[a-z0-9._@-]{2,60}$/, 'Letters, numbers, dots or dashes (2–60 characters).'));

/** An id from a <select>: '' or 0 means "nothing chosen". */
const idField = (message: string) => z.coerce.number({ message }).int().positive(message);

// ---------------------------------------------------------------- events
export const eventInputSchema = z.object({
  calendarId: idField('Choose a calendar.'),
  type: z.enum(EVENT_TYPE_KEYS),
  name: text(200).default(''),
  title: text(200).default(''),
  hebrewName: text(200).default(''),
  notes: text(2000).default(''),
  basis: z.enum(BASIS_KEYS),
  dateEntry: z.enum(['gregorian', 'hebrew']),
  gDate: z.string().optional(),
  afterSunset: z.boolean().default(false),
  hDay: optionalInt,
  hMonth: optionalInt,
  hYear: optionalInt,
}).superRefine((v, ctx) => {
  if (v.type === 'other' && !v.title) ctx.addIssue({ code: 'custom', path: ['title'], message: 'Enter a title.' });
  if (v.type !== 'other' && !v.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Enter a name.' });
  if (v.dateEntry === 'gregorian') {
    if (!isValidIso(v.gDate)) ctx.addIssue({ code: 'custom', path: ['gDate'], message: 'Enter a valid date.' });
  } else {
    const problem = hebrewDateProblem({ year: v.hYear, month: v.hMonth, day: v.hDay });
    if (problem) ctx.addIssue({ code: 'custom', path: ['hDay'], message: problem });
  }
});
export type EventInput = z.input<typeof eventInputSchema>;
export type ValidEventInput = z.output<typeof eventInputSchema>;

/** Fill in the other calendar: the stored event always has both dates. */
export function normalizeEvent(v: ValidEventInput): EventCore & { calendarId: number; dateEntry: 'gregorian' | 'hebrew' } {
  let gDate: string;
  let h: HebrewDate;
  if (v.dateEntry === 'gregorian') {
    gDate = v.gDate!;
    h = hebrewFromIso(gDate, v.afterSunset);
  } else {
    h = { year: v.hYear!, month: v.hMonth!, day: v.hDay! };
    gDate = isoFromHebrew(h);
  }
  return {
    calendarId: v.calendarId,
    type: v.type as EventType,
    name: v.type === 'other' ? '' : v.name,
    title: v.type === 'other' ? v.title : '',
    hebrewName: v.type === 'other' ? '' : v.hebrewName,
    notes: v.notes,
    basis: v.basis,
    dateEntry: v.dateEntry,
    afterSunset: v.dateEntry === 'gregorian' && v.afterSunset,
    gDate, hYear: h.year, hMonth: h.month, hDay: h.day,
  };
}

// ---------------------------------------------------------------- accounts
export const setupSchema = z.object({
  /** One-time code printed in the server log on first start (proves you control the server). */
  setupCode: z.string().trim().toUpperCase().min(1, 'Enter the setup code from the server log.'),
  calendarName: text(100).min(1, 'Enter a name for the calendar.'),
  displayName: text(100).min(1, 'Enter your name.'),
  username,
  password,
});

export const loginSchema = z.object({ username: z.string().trim().toLowerCase(), password: z.string() });

export const acceptInviteSchema = z.object({ password, confirm: z.string() })
  .refine(v => v.password === v.confirm, { path: ['confirm'], message: "The passwords don't match." });

export const accountSchema = z.object({
  displayName: text(100).min(1, 'Enter a display name.'),
  currentPassword: z.string().optional(),
  newPassword: z.union([z.literal(''), password]).optional(),
});

export const feedPrefsSchema = z.object({
  types: z.array(z.enum(FEED_TYPE_KEYS)),
  alarm: z.enum(['none', 'morning', 'daybefore', 'both', 'week']),
});
export type FeedPrefs = z.infer<typeof feedPrefsSchema>;

/** The Subscribe page's form: feed preferences plus which calendars go into the feed. */
export const feedSettingsSchema = feedPrefsSchema.extend({
  calendars: z.array(z.coerce.number().int()).optional(),
});
export type FeedSettings = z.infer<typeof feedSettingsSchema>;

// ---------------------------------------------------------------- calendars & people
const permissionList = z.array(z.enum(PERMISSION_KEYS)).min(1, 'Choose at least one permission.');

export const calendarSchema = z.object({
  name: text(100).min(1, 'Enter a name for the calendar.'),
});

export const memberSchema = z.object({ permissions: permissionList });

/** Create an account and add it to one calendar (more can be added later). */
export const userInviteSchema = z.object({
  displayName: text(100).min(1, 'Enter a name.'),
  username,
  calendarId: idField('Choose a calendar.'),
  permissions: permissionList,
});

export const userUpdateSchema = z.object({
  displayName: text(100).min(1, 'Enter a name.'),
  username,
  active: z.boolean(),
  appAdmin: z.boolean(),
});

export const HOLIDAY_GROUP_KEYS = ['major', 'minor', 'modern', 'roshchodesh', 'fast', 'specialShabbat'] as const;

export const settingsSchema = z.object({
  /** Shown at the top of every page, and as the name of feeds that combine several calendars. */
  siteName: text(100).min(1, 'Enter a name.'),
  yearsAhead: z.coerce.number().int().min(1).max(30),
  yearsBehind: z.coerce.number().int().min(0).max(10),
  hebcalGeonameId: z.string().trim().regex(/^\d*$/, 'A GeoNames ID is a number, e.g. 281184 for Jerusalem.'),
  hebcalIsrael: z.boolean(),
  hebcalCandleMinutes: z.coerce.number().int().min(0).max(90),
  hebcalHolidays: z.array(z.enum(HOLIDAY_GROUP_KEYS)),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  siteName: 'Family Calendar',
  yearsAhead: 10,
  yearsBehind: 1,
  hebcalGeonameId: '',
  hebcalIsrael: false,
  hebcalCandleMinutes: 18,
  hebcalHolidays: ['major', 'minor', 'modern', 'roshchodesh', 'fast'],
};

/** Field → message map for showing validation errors next to inputs. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
