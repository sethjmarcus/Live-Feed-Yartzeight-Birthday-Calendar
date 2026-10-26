/**
 * The heart of the app: when does each event fall, and what does its calendar entry say.
 * Pure functions — no I/O — so they run identically on the server and in the browser.
 */
import * as cal from './hebrewCalendar.js';
import { EVENT_TYPES, type Basis, type EventType } from './eventTypes.js';

/** The date-related fields of a stored event. */
export interface EventCore {
  type: EventType;
  name: string;
  title: string;
  hebrewName: string;
  notes: string;
  basis: Basis;
  afterSunset: boolean;
  gDate: cal.IsoDate;
  hYear: number;
  hMonth: number;
  hDay: number;
}

export interface Occurrence {
  abs: number;
  iso: cal.IsoDate;
  basis: 'hebrew' | 'gregorian';
  count: number;
  hebrew: cal.HebrewDate;
}

export function displayName(ev: Pick<EventCore, 'type' | 'name' | 'title'>): string {
  return ev.type === 'other' ? ev.title : ev.name;
}

/** Every observance of `ev` between absolute days [fromAbs, toAbs], sorted. */
export function occurrencesBetween(ev: EventCore, fromAbs: number, toAbs: number): Occurrence[] {
  const out: Omit<Occurrence, 'iso' | 'hebrew'>[] = [];
  if (ev.basis !== 'gregorian') {
    const original = { year: ev.hYear, month: ev.hMonth, day: ev.hDay };
    const strategy = EVENT_TYPES[ev.type];
    for (let hy = cal.hebrewFromAbs(fromAbs).year; hy <= cal.hebrewFromAbs(toAbs).year; hy++) {
      const abs = strategy.observeHebrew(original, hy);
      if (abs !== null && abs >= fromAbs && abs <= toAbs) out.push({ abs, basis: 'hebrew', count: hy - original.year });
    }
  }
  if (ev.basis !== 'hebrew') {
    const [oy, om, od] = ev.gDate.split('-').map(Number);
    const lastYear = Number(cal.isoFromAbs(toAbs).slice(0, 4));
    for (let gy = Math.max(Number(cal.isoFromAbs(fromAbs).slice(0, 4)), oy + 1); gy <= lastYear; gy++) {
      const day = om === 2 && od === 29 && !isGregorianLeap(gy) ? 28 : od;
      const abs = cal.absFromIso(`${gy}-${pad(om)}-${pad(day)}`);
      if (abs >= fromAbs && abs <= toAbs) out.push({ abs, basis: 'gregorian', count: gy - oy });
    }
  }
  return out
    .map(o => ({ ...o, iso: cal.isoFromAbs(o.abs), hebrew: cal.hebrewFromAbs(o.abs) }))
    .sort((a, b) => a.abs - b.abs);
}

export function occurrenceTitle(ev: EventCore, occ: Occurrence): string {
  return EVENT_TYPES[ev.type].title({
    name: displayName(ev),
    count: occ.count,
    hebrewTwin: ev.basis === 'both' && occ.basis === 'hebrew',
  });
}

/** The day before, if the observance begins at sundown (yahrzeit). */
export function eveningBefore(ev: EventCore, occ: Occurrence): cal.IsoDate | null {
  return EVENT_TYPES[ev.type].beginsEveningBefore ? cal.isoFromAbs(occ.abs - 1) : null;
}

export function originalDate(ev: EventCore) {
  const h = cal.formatHebrew({ year: ev.hYear, month: ev.hMonth, day: ev.hDay });
  return {
    gregorian: cal.formatGregorian(ev.gDate) + (ev.afterSunset ? ' (after sunset)' : ''),
    hebrewEn: h.en,
    hebrewHe: h.he,
  };
}

/** Multi-line description for a calendar entry. */
export function occurrenceDetails(ev: EventCore, occ: Occurrence): string {
  const h = cal.formatHebrew(occ.hebrew);
  const o = originalDate(ev);
  const eve = eveningBefore(ev, occ);
  return [
    `Hebrew date: ${h.en} · ${h.he}`,
    eve && `Begins at sundown on ${cal.weekday(eve)} ${cal.formatGregorian(eve)}; the candle is lit that evening.`,
    ev.hebrewName && `Hebrew name: ${ev.hebrewName}`,
    `${EVENT_TYPES[ev.type].originLabel}: ${o.gregorian} · ${o.hebrewEn} · ${o.hebrewHe}`,
    ev.notes && `\n${ev.notes}`,
  ].filter(Boolean).join('\n');
}

const pad = (n: number) => String(n).padStart(2, '0');
const isGregorianLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
