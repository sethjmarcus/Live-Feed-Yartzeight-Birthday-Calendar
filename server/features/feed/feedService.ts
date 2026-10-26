/**
 * Builds each subscriber's .ics feed (with ical-generator) and the "Upcoming" list.
 */
import ical, { ICalAlarmType, ICalCalendarMethod, ICalEventTransparency } from 'ical-generator';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { User } from '../users/userRepository.js';
import type { HebcalGateway } from '../hebcal/hebcalGateway.js';
import { ATTRIBUTION } from '../hebcal/hebcalGateway.js';
import * as cal from '../../../shared/hebrewCalendar.js';
import { EVENT_TYPES, type HebcalFeedType } from '../../../shared/eventTypes.js';
import { eveningBefore, occurrenceDetails, occurrenceTitle, occurrencesBetween } from '../../../shared/occurrences.js';
import type { FeedPrefs } from '../../../shared/schemas.js';
import type { UpcomingItem } from '../../../shared/api.js';

const HOUR = 3600;
/** Reminder offsets in seconds *before* the start of the (all-day) event; negative = after. */
const ALARMS: Record<FeedPrefs['alarm'], number[]> = {
  none: [],
  morning: [-9 * HOUR],          // 09:00 on the day
  daybefore: [15 * HOUR],        // 09:00 the day before
  both: [15 * HOUR, -9 * HOUR],
  week: [(6 * 24 + 15) * HOUR],  // 09:00 a week before
};
/** Yahrzeits begin the evening before: their "day before" reminder fires at 16:00. */
const YAHRZEIT_EVE = 8 * HOUR;

export class FeedService {
  constructor(private uow: UnitOfWork, private hebcal: HebcalGateway) {}

  async buildFeed(user: User, today = cal.todayAbs()): Promise<string> {
    const s = await this.uow.repos.settings.get();
    const from = today - 366 * s.yearsBehind - 1;
    const to = today + 366 * s.yearsAhead;
    const types = new Set(user.feedPrefs.types);
    const extras = (['holidays', 'candles'] as HebcalFeedType[]).filter(k => types.has(k));

    const calendar = ical({
      name: s.calendarName,
      description: 'Birthdays, anniversaries and yahrzeits with Hebrew and English dates' + (extras.length ? `. ${ATTRIBUTION}` : ''),
      prodId: { company: 'yahrzeit-feed-calendar', product: 'feed', language: 'EN' },
      method: ICalCalendarMethod.PUBLISH,
      ttl: HOUR, // ask clients to refresh hourly
    });

    for (const ev of await this.uow.repos.events.listActive()) {
      if (!types.has(ev.type)) continue;
      for (const occ of occurrencesBetween(ev, from, to)) {
        const title = occurrenceTitle(ev, occ);
        calendar.createEvent({
          id: `ev${ev.id}-${occ.basis[0]}-${occ.iso}@feedcal`,
          allDay: true,
          start: utcMidnight(occ.iso),
          summary: title,
          description: occurrenceDetails(ev, occ),
          categories: [{ name: EVENT_TYPES[ev.type].label }],
          stamp: new Date(ev.updatedAt),
          lastModified: new Date(ev.updatedAt),
          sequence: ev.revision,
          transparency: ICalEventTransparency.TRANSPARENT,
          alarms: alarmsFor(ev.type === 'yahrzeit', user.feedPrefs.alarm).map(trigger => ({ type: ICalAlarmType.display, trigger, description: title })),
        });
      }
    }

    for (const item of await this.hebcal.items(cal.isoFromAbs(from), cal.isoFromAbs(to), extras)) {
      calendar.createEvent({
        id: `hebcal-${item.date}-${slug(item.title)}@feedcal`,
        ...(item.dateTime ? { start: new Date(item.dateTime) } : { allDay: true, start: utcMidnight(item.date) }),
        summary: item.title,
        description: [item.hebrew, item.memo, ATTRIBUTION].filter(Boolean).join('\n'),
        categories: [{ name: item.kind === 'candles' ? 'Shabbat' : 'Jewish holiday' }],
        transparency: ICalEventTransparency.TRANSPARENT,
      });
    }
    return calendar.toString();
  }

  async upcoming(user: User, days: number, today = cal.todayAbs()): Promise<UpcomingItem[]> {
    const to = today + days;
    const items: UpcomingItem[] = [];
    for (const ev of await this.uow.repos.events.listActive()) {
      for (const occ of occurrencesBetween(ev, today, to)) {
        items.push({
          kind: 'event', type: ev.type, eventId: ev.id, iso: occ.iso, abs: occ.abs, hebrew: occ.hebrew,
          title: occurrenceTitle(ev, occ),
          eveningBefore: eveningBefore(ev, occ),
        });
      }
    }
    if (user.feedPrefs.types.includes('holidays')) {
      for (const h of await this.hebcal.items(cal.isoFromAbs(today), cal.isoFromAbs(to), ['holidays'])) {
        const abs = cal.absFromIso(h.date);
        items.push({ kind: 'holiday', type: 'holiday', iso: h.date, abs, hebrew: cal.hebrewFromAbs(abs), title: h.title, subtitle: h.hebrew });
      }
    }
    return items.sort((a, b) => a.abs - b.abs || (a.kind === b.kind ? 0 : a.kind === 'holiday' ? -1 : 1) || a.title.localeCompare(b.title));
  }
}

/** ical-generator writes all-day dates in UTC — so pass UTC midnight of the calendar day. */
function utcMidnight(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(2000, 0, 1));
  dt.setUTCFullYear(y, m - 1, d);
  return dt;
}

function alarmsFor(isYahrzeit: boolean, key: FeedPrefs['alarm']): number[] {
  const triggers = [...ALARMS[key]];
  if (isYahrzeit && triggers.length) {
    const i = triggers.indexOf(15 * HOUR);
    if (i >= 0) triggers[i] = YAHRZEIT_EVE; else triggers.unshift(YAHRZEIT_EVE);
  }
  return [...new Set(triggers)];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';
