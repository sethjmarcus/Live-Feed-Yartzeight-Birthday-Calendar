import { describe, it, expect } from 'vitest';
import * as cal from '../shared/hebrewCalendar.js';
import { occurrencesBetween, occurrenceTitle, occurrenceDetails, type EventCore } from '../shared/occurrences.js';
import { eventInputSchema, normalizeEvent } from '../shared/schemas.js';
import { can, canEditEvent, presetName, PRESETS } from '../shared/permissions.js';

const yearRange = (y: number): [number, number] => [cal.absFromIso(`${y}-01-01`), cal.absFromIso(`${y}-12-31`)];
const ev = (e: Partial<EventCore>): EventCore => ({ type: 'birthday', name: 'X', title: '', hebrewName: '', notes: '', basis: 'hebrew', afterSunset: false, gDate: '2000-01-01', hYear: 5760, hMonth: 10, hDay: 23, ...e });

describe('Hebrew calendar (Hebcal adapter)', () => {
  it.each([
    ['2026-09-12', '1 Tishrei 5787'],
    ['2026-04-02', '15 Nisan 5786'],
    ['2025-12-15', '25 Kislev 5786'],
    ['2026-03-03', '14 Adar 5786'],
    ['2024-03-24', '14 Adar II 5784'],
  ])('%s is %s', (iso, expected) => {
    expect(cal.formatHebrew(cal.hebrewFromIso(iso)).en).toBe(expected);
  });

  it('after sunset moves to the next Hebrew day', () => {
    expect(cal.formatHebrew(cal.hebrewFromIso('1990-03-10', true)).en).toBe('14 Adar 5750');
  });

  it('renders Hebrew with gematriya', () => {
    expect(cal.formatHebrew({ year: 5786, month: 1, day: 15 }).he).toBe('ט״ו ניסן תשפ״ו');
  });

  it('applies Hebcal yahrzeit and birthday rules', () => {
    expect(cal.isoFromAbs(cal.yahrzeitAbs({ year: 5740, month: 8, day: 30 }, 5787)!)).toBe('2026-11-10');
    expect(cal.formatHebrew(cal.hebrewFromAbs(cal.yahrzeitAbs({ year: 5784, month: 13, day: 14 }, 5786)!)).en).toBe('14 Adar 5786');
    expect(cal.isoFromAbs(cal.anniversaryAbs({ year: 5750, month: 12, day: 14 }, 5787)!)).toBe('2027-03-23');
    expect(cal.anniversaryAbs({ year: 5786, month: 1, day: 1 }, 5786)).toBeNull();
  });

  it('explains invalid Hebrew dates', () => {
    expect(cal.hebrewDateProblem({ year: 5785, month: 13, day: 1 })).toMatch(/not a leap year/);
    expect(cal.hebrewDateProblem({ year: 5784, month: 13, day: 1 })).toBeNull();
  });
});

describe('occurrences', () => {
  it('Feb 29 falls on Feb 28 in common years', () => {
    const [occ] = occurrencesBetween(ev({ basis: 'gregorian', gDate: '2000-02-29' }), ...yearRange(2027));
    expect(occ.iso).toBe('2027-02-28');
    expect(occ.count).toBe(27);
  });

  it('"both" yields English and Hebrew entries with distinct titles', () => {
    const e = ev({ name: 'Sarah', basis: 'both', gDate: '1990-03-10', afterSunset: true, hYear: 5750, hMonth: 12, hDay: 14 });
    const occ = occurrencesBetween(e, ...yearRange(2027));
    expect(occ.map(o => [o.iso, o.basis])).toEqual([['2027-03-10', 'gregorian'], ['2027-03-23', 'hebrew']]);
    expect(occ.map(o => occurrenceTitle(e, o))).toEqual(['🎂 Sarah — 37th birthday', '🎂 Sarah — 37th Hebrew birthday']);
  });

  it('describes a yahrzeit with its evening start', () => {
    const e = ev({ type: 'yahrzeit', name: 'Avraham', hebrewName: 'אברהם בן יצחק', gDate: '1979-11-20', hYear: 5740, hMonth: 8, hDay: 30 });
    const [occ] = occurrencesBetween(e, ...yearRange(2026));
    expect(occurrenceTitle(e, occ)).toBe('🕯️ Yahrzeit: Avraham (47th)');
    expect(occurrenceDetails(e, occ)).toMatch(/Begins at sundown on Mon 9 November 2026/);
  });
});

describe('shared validation + normalisation', () => {
  it('fills in the Gregorian date for a Hebrew entry', () => {
    const v = eventInputSchema.parse({ type: 'yahrzeit', name: 'A', dateEntry: 'hebrew', hDay: '15', hMonth: '1', hYear: '5786', basis: 'hebrew' });
    expect(normalizeEvent(v)).toMatchObject({ gDate: '2026-04-02', hYear: 5786, hMonth: 1, hDay: 15 });
  });
  it('requires a title for "other"', () => {
    const r = eventInputSchema.safeParse({ type: 'other', dateEntry: 'gregorian', gDate: '2020-01-01', basis: 'gregorian' });
    expect(r.success).toBe(false);
  });
});

describe('permissions policy', () => {
  const contributor = { id: 2, active: true, permissions: PRESETS.contributor.perms };
  it('lets contributors edit only their own events', () => {
    expect(canEditEvent(contributor, { createdBy: 2 })).toBe(true);
    expect(canEditEvent(contributor, { createdBy: 1 })).toBe(false);
    expect(canEditEvent(contributor, { createdBy: 2, deletedAt: '2026-01-01' })).toBe(false);
  });
  it('admin implies everything; disabled users get nothing', () => {
    expect(can({ id: 1, active: true, permissions: ['admin'] }, 'deleteAny')).toBe(true);
    expect(can({ id: 1, active: false, permissions: ['admin'] }, 'view')).toBe(false);
    expect(presetName(PRESETS.editor.perms)).toBe('Editor');
  });
});
