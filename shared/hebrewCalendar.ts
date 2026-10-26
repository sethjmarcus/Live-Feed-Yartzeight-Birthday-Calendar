/**
 * Adapter over the Hebcal library (@hebcal/hdate) — the ONLY module that imports it.
 * Used by both the server (feeds) and the browser (live date preview).
 *
 * Vocabulary used across the app:
 *   IsoDate     'YYYY-MM-DD' (a calendar day, no time zone)
 *   abs         R.D. day number — handy for date arithmetic
 *   HebrewDate  { year, month, day } with Hebcal month numbers:
 *               1 Nisan … 7 Tishrei … 12 Adar / Adar I, 13 Adar II
 */
import {
  HDate, greg2abs, abs2greg, yahrzeit, birthdayOrAnniversary,
  isLeapYear, monthsInYear, daysInMonth, getMonthName,
} from '@hebcal/hdate';

export type IsoDate = string;
export interface HebrewDate { year: number; month: number; day: number }

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------- Gregorian ⇄ abs
export function absFromIso(iso: IsoDate): number {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(2000, 0, 1);
  dt.setFullYear(y, m - 1, d);
  return greg2abs(dt);
}
export function isoFromAbs(abs: number): IsoDate {
  const dt = abs2greg(abs);
  return `${String(dt.getFullYear()).padStart(4, '0')}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
export function isValidIso(iso: unknown): iso is IsoDate {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) && isoFromAbs(absFromIso(iso)) === iso;
}
export function todayAbs(now = new Date()): number { return greg2abs(now); }
export function weekday(iso: IsoDate): string { return WEEKDAYS[absFromIso(iso) % 7]; }
export function formatGregorian(iso: IsoDate): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export function monthYearLabel(iso: IsoDate): string {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// ---------------------------------------------------------------- Gregorian ⇄ Hebrew
const plain = (hd: HDate): HebrewDate => ({ year: hd.getFullYear(), month: hd.getMonth(), day: hd.getDate() });

/** Hebrew date for a Gregorian day; afterSunset → the next Hebrew day had begun. */
export function hebrewFromIso(iso: IsoDate, afterSunset = false): HebrewDate {
  return plain(new HDate(absFromIso(iso) + (afterSunset ? 1 : 0)));
}
export function hebrewFromAbs(abs: number): HebrewDate { return plain(new HDate(abs)); }
export function isoFromHebrew(h: HebrewDate): IsoDate { return isoFromAbs(new HDate(h.day, h.month, h.year).abs()); }

export function isValidHebrew(h: Partial<HebrewDate>): h is HebrewDate {
  const { year, month, day } = h;
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day) &&
    year! > 3000 && year! < 7000 && month! >= 1 && month! <= monthsInYear(year!) && day! >= 1 && day! <= daysInMonth(month!, year!);
}

/** Human explanation of why a Hebrew date is invalid (null if it's fine). */
export function hebrewDateProblem(h: Partial<HebrewDate>): string | null {
  if (isValidHebrew(h)) return null;
  const { year, month, day } = h;
  if (!Number.isInteger(year) || year! <= 3000 || year! >= 7000) return 'Enter the Hebrew year, e.g. 5750.';
  if (!Number.isInteger(month)) return 'Choose a Hebrew month.';
  if (month === 13 && !isLeapYear(year!)) return `${year} is not a leap year, so it has no Adar II — choose “Adar / Adar I”.`;
  if (day === 30 && daysInMonth(month!, year!) === 29) return `${getMonthName(month!, year!)} has only 29 days in ${year}.`;
  return 'Enter a day between 1 and 30.';
}

// ---------------------------------------------------------------- anniversaries (Hebcal rules)
/** Observed day (abs) of a yahrzeit in Hebrew year `hyear`; null in/before the year of death. */
export function yahrzeitAbs(original: HebrewDate, hyear: number): number | null {
  if (hyear <= original.year) return null;
  return yahrzeit(hyear, new HDate(original.day, original.month, original.year))?.abs() ?? null;
}
/** Observed day (abs) of a Hebrew birthday/anniversary in `hyear`; null in/before the original year. */
export function anniversaryAbs(original: HebrewDate, hyear: number): number | null {
  if (hyear <= original.year) return null;
  return birthdayOrAnniversary(hyear, new HDate(original.day, original.month, original.year))?.abs() ?? null;
}

// ---------------------------------------------------------------- display
/** { en: '15 Nisan 5786', he: 'ט״ו ניסן תשפ״ו' } — rendered by Hebcal. */
export function formatHebrew(h: HebrewDate): { en: string; he: string } {
  const hd = new HDate(h.day, h.month, h.year);
  return { en: hd.toString(), he: hd.renderGematriya(true) };
}

/** Month choices for a Hebrew date picker, Tishrei first. */
export const HEBREW_MONTH_CHOICES: { value: number; label: string }[] =
  [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6].map(m => ({
    value: m,
    label: m === 12 ? 'Adar / Adar I' : m === 13 ? 'Adar II' : getMonthName(m, 5785),
  }));

const pad = (n: number) => String(n).padStart(2, '0');
