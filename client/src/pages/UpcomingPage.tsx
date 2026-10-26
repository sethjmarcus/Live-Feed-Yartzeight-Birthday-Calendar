import { Link, Navigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useCalendarChoice, useSession } from '../session';
import { CalendarPicker, CalendarTag, HebrewDate, Loading } from '../components/ui';
import * as cal from '../../../shared/hebrewCalendar';
import type { UpcomingItem } from '../../../shared/api';

const RANGES = [[30, 'Next 30 days'], [90, 'Next 3 months'], [365, 'Next 12 months']] as const;

export function UpcomingPage() {
  const { can, user, calendarsWhere } = useSession();
  const [calendar, setCalendar] = useCalendarChoice(user);
  const viewable = calendarsWhere('view');
  const [params, setParams] = useSearchParams();
  const days = Number(params.get('days')) || 90;
  const { data, isPending } = useQuery({
    queryKey: ['upcoming', days, calendar],
    queryFn: () => api.get<{ items: UpcomingItem[] }>(`/api/upcoming${qs({ days, calendar })}`),
    enabled: can('view'),
  });

  if (!can('view')) return <Navigate to={user?.memberships.length ? '/subscribe' : '/account'} replace />;
  const tagFor = (item: UpcomingItem) => (!calendar && viewable.length > 1 && item.calendarId ? viewable.find(c => c.id === item.calendarId)?.name : undefined);

  const today = cal.todayAbs();
  const todayIso = cal.isoFromAbs(today);
  const groups = groupByMonth(data?.items ?? []);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Upcoming</h1>
          <p className="muted">Today is {cal.weekday(todayIso)} {cal.formatGregorian(todayIso)} · <HebrewDate date={cal.hebrewFromAbs(today)} /></p>
        </div>
        <div className="row">
          <CalendarPicker calendars={viewable} value={calendar} onChange={setCalendar} />
          <select aria-label="Period" value={days} onChange={e => setParams({ days: e.target.value })} style={{ width: 'auto' }}>
            {RANGES.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
          </select>
        </div>
      </div>
      {isPending ? <Loading /> : groups.length === 0 ? (
        <div className="card empty">Nothing coming up in this period. {can('add') && <Link to="/events/new">Add an event</Link>}</div>
      ) : groups.map(g => (
        <div key={g.key}>
          <h2 className="month">{g.label}</h2>
          <ul className="occ-list">
            {g.items.map(item => <OccurrenceCard key={`${item.kind}-${item.eventId ?? item.title}-${item.iso}`} item={item} today={today} calendar={tagFor(item)} />)}
          </ul>
        </div>
      ))}
    </>
  );
}

function OccurrenceCard({ item, today, calendar }: { item: UpcomingItem; today: number; calendar?: string }) {
  const inDays = item.abs - today;
  const relative = inDays === 0 ? 'Today' : inDays === 1 ? 'Tomorrow' : `in ${inDays} days`;
  return (
    <li className={`occ t-${item.type} ${inDays === 0 ? 'today' : ''}`}>
      <div className="occ-date"><span className="dow">{cal.weekday(item.iso)}</span><span className="dnum">{Number(item.iso.slice(8))}</span></div>
      <div className="occ-body">
        <div className="occ-title">{item.title}{item.subtitle && <> <span className="heb muted" lang="he" dir="rtl">{item.subtitle}</span></>}<CalendarTag name={calendar} /></div>
        <div className="occ-sub">{cal.formatGregorian(item.iso)} · <HebrewDate date={item.hebrew} /></div>
        {item.eveningBefore && <div className="occ-sub small">Begins at sundown {cal.weekday(item.eveningBefore)} evening</div>}
      </div>
      <div className="occ-when">{relative}</div>
    </li>
  );
}

function groupByMonth(items: UpcomingItem[]) {
  const groups: { key: string; label: string; items: UpcomingItem[] }[] = [];
  for (const item of items) {
    const key = item.iso.slice(0, 7);
    if (groups.at(-1)?.key !== key) groups.push({ key, label: cal.monthYearLabel(item.iso), items: [] });
    groups.at(-1)!.items.push(item);
  }
  return groups;
}
