/**
 * Event types as Strategy objects: everything that differs between a birthday,
 * an anniversary, a yahrzeit and "other" lives in one object per type.
 * Adding a new type means adding one entry here.
 */
import { anniversaryAbs, yahrzeitAbs, type HebrewDate } from './hebrewCalendar.js';
import { ordinal } from './format.js';

export const EVENT_TYPE_KEYS = ['birthday', 'anniversary', 'yahrzeit', 'other'] as const;
export type EventType = (typeof EVENT_TYPE_KEYS)[number];

export const BASIS_KEYS = ['hebrew', 'gregorian', 'both'] as const;
export type Basis = (typeof BASIS_KEYS)[number];
export const BASIS_LABELS: Record<Basis, string> = {
  hebrew: 'Hebrew date each year',
  gregorian: 'English date each year',
  both: 'Both — two entries each year',
};

export interface TitleContext {
  name: string;
  count: number;          // years since the original date
  hebrewTwin: boolean;    // the Hebrew-date entry of a "both" event
}

export interface EventTypeStrategy {
  key: EventType;
  label: string;
  emoji: string;
  /** Which calendar it usually repeats on. */
  defaultBasis: Basis;
  /** Form label for the name field (null = the type uses a free title instead). */
  nameLabel: string | null;
  originLabel: string;
  /** Observed day (abs) in Hebrew year `hyear`, by Hebcal's rules for this kind of date. */
  observeHebrew(original: HebrewDate, hyear: number): number | null;
  title(ctx: TitleContext): string;
  /** Jewish observances that start the evening before (a yahrzeit candle). */
  beginsEveningBefore: boolean;
}

const counted = (ctx: TitleContext) => (ctx.count > 0 ? `${ordinal(ctx.count)} ` : '');

export const EVENT_TYPES: Record<EventType, EventTypeStrategy> = {
  birthday: {
    key: 'birthday', label: 'Birthday', emoji: '🎂', defaultBasis: 'gregorian',
    nameLabel: 'Name', originLabel: 'Born',
    observeHebrew: anniversaryAbs,
    title: c => `🎂 ${c.name} — ${counted(c)}${c.hebrewTwin ? 'Hebrew ' : ''}birthday`,
    beginsEveningBefore: false,
  },
  anniversary: {
    key: 'anniversary', label: 'Anniversary', emoji: '💍', defaultBasis: 'gregorian',
    nameLabel: 'Names (e.g. David & Rachel)', originLabel: 'Original date',
    observeHebrew: anniversaryAbs,
    title: c => `💍 ${c.name} — ${counted(c)}${c.hebrewTwin ? 'Hebrew ' : ''}anniversary`,
    beginsEveningBefore: false,
  },
  yahrzeit: {
    key: 'yahrzeit', label: 'Yahrzeit', emoji: '🕯️', defaultBasis: 'hebrew',
    nameLabel: 'Name of the departed', originLabel: 'Date of passing',
    observeHebrew: yahrzeitAbs,
    title: c => `🕯️ Yahrzeit: ${c.name}${c.count > 0 ? ` (${ordinal(c.count)})` : ''}`,
    beginsEveningBefore: true,
  },
  other: {
    key: 'other', label: 'Other', emoji: '📌', defaultBasis: 'gregorian',
    nameLabel: null, originLabel: 'Original date',
    observeHebrew: anniversaryAbs,
    title: c => `📌 ${c.name}${c.hebrewTwin ? ' (Hebrew date)' : ''}`,
    beginsEveningBefore: false,
  },
};

/** Optional feed categories supplied by the Hebcal REST API. */
export const HEBCAL_FEED_TYPES = {
  holidays: { label: 'Jewish holidays', emoji: '✡️' },
  candles: { label: 'Candle-lighting & Havdalah', emoji: '🕯' },
} as const;
export type HebcalFeedType = keyof typeof HEBCAL_FEED_TYPES;

export const FEED_TYPE_KEYS = [...EVENT_TYPE_KEYS, 'holidays', 'candles'] as const;
export type FeedType = (typeof FEED_TYPE_KEYS)[number];
