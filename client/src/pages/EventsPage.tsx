import { Link, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useCalendarChoice, useSession } from '../session';
import { useToast } from '../components/Layout';
import { CalendarPicker, CalendarTag, Loading, TypeTag, nameOf } from '../components/ui';
import { EVENT_TYPES, EVENT_TYPE_KEYS } from '../../../shared/eventTypes';
import { displayName, originalDate } from '../../../shared/occurrences';
import { canEditEvent } from '../../../shared/permissions';
import { formatDateTime } from '../../../shared/format';
import type { EventDTO, NameMap, UserDTO } from '../../../shared/api';

const BASIS_SHORT = { hebrew: 'Hebrew date', gregorian: 'English date', both: 'Both' } as const;

export function EventsPage() {
  const { user, can, calendarsWhere, isAppAdmin } = useSession();
  const [calendar, setCalendar] = useCalendarChoice(user);
  const viewable = calendarsWhere('view');
  const manager = can('manage', calendar ?? undefined); // manages this calendar (or, with "All", any)
  const manages = (calendarId: number) => can('manage', calendarId);
  const calendarName = (id: number) => viewable.find(c => c.id === id)?.name;
  const [params, setParams] = useSearchParams();
  const filters = { q: params.get('q') ?? '', type: params.get('type') ?? '', by: params.get('by') ?? '', deleted: params.get('deleted') ?? '' };
  const qc = useQueryClient();
  const toast = useToast();

  const events = useQuery({
    queryKey: ['events', filters, calendar],
    queryFn: () => api.get<{ events: EventDTO[]; names: NameMap }>(`/api/events${qs({ ...filters, calendar })}`),
  });
  const people = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: UserDTO[] }>('/api/users'),
    enabled: isAppAdmin,
  });
  const restore = useMutation({
    mutationFn: (id: number) => api.post<{ event: EventDTO }>(`/api/events/${id}/restore`),
    onSuccess: ({ event }) => {
      toast({ type: 'ok', msg: `Restored “${displayName(event)}”.` });
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const set = (k: keyof typeof filters, v: string) => setParams({ ...filters, [k]: v });
  const names = events.data?.names ?? {};
  const list = events.data?.events ?? [];

  return (
    <>
      <div className="pagehead">
        <h1>All events <span className="count">{list.length}</span></h1>
        {can('add') && <Link className="btn primary" to="/events/new">+ Add event</Link>}
      </div>
      <div className="filters card">
        <CalendarPicker calendars={viewable} value={calendar} onChange={setCalendar} />
        <input type="search" placeholder="Search names, notes…" aria-label="Search" defaultValue={filters.q}
          onChange={e => set('q', e.target.value)} />
        <select aria-label="Type" value={filters.type} onChange={e => set('type', e.target.value)}>
          <option value="">All types</option>
          {EVENT_TYPE_KEYS.map(k => <option key={k} value={k}>{EVENT_TYPES[k].emoji} {EVENT_TYPES[k].label}</option>)}
        </select>
        {isAppAdmin && (
          <select aria-label="Added by" value={filters.by} onChange={e => set('by', e.target.value)}>
            <option value="">Added by anyone</option>
            {people.data?.users.map(u => <option key={u.id} value={u.id}>Added by {u.displayName}</option>)}
          </select>
        )}
        {manager && <label className="check"><input type="checkbox" checked={filters.deleted === '1'} onChange={e => set('deleted', e.target.checked ? '1' : '')} /> Show deleted</label>}
      </div>
      {events.isPending ? <Loading /> : (
        <div className="table-wrap card">
          <table className="events">
            <thead>
              <tr><th>Event</th><th>Original date</th><th>Repeats on</th>{manager && <><th>Added by</th><th>Last edited</th></>}<th></th></tr>
            </thead>
            <tbody>
              {list.length === 0 && <tr><td colSpan={6} className="muted">No events found.</td></tr>}
              {list.map(ev => {
                const o = originalDate(ev);
                const edited = ev.updatedBy && ev.updatedAt !== ev.createdAt;
                return (
                  <tr key={ev.id} className={ev.deletedAt ? 'deleted' : ''}>
                    <td data-label="Event">
                      <TypeTag type={ev.type} /> <strong>{displayName(ev)}</strong>
                      {!calendar && viewable.length > 1 && <CalendarTag name={calendarName(ev.calendarId)} />}
                      {ev.hebrewName && <div className="heb small" lang="he" dir="rtl">{ev.hebrewName}</div>}
                      {ev.deletedAt && <div className="small danger">Deleted {formatDateTime(ev.deletedAt)} by {nameOf(names, ev.deletedBy)}</div>}
                    </td>
                    <td data-label="Original date">{o.gregorian}
                      <div className="small"><span className="hdate">{o.hebrewEn}</span> · <span className="heb hdate" lang="he" dir="rtl">{o.hebrewHe}</span></div>
                    </td>
                    <td data-label="Repeats on">{BASIS_SHORT[ev.basis]}</td>
                    {manager && (manages(ev.calendarId) ? (
                      <>
                        <td data-label="Added by"><strong>{nameOf(names, ev.createdBy)}</strong><div className="small muted">{formatDateTime(ev.createdAt)}</div></td>
                        <td data-label="Last edited">{edited ? <>{nameOf(names, ev.updatedBy)}<div className="small muted">{formatDateTime(ev.updatedAt)}</div></> : <span className="muted">—</span>}</td>
                      </>
                    ) : <><td className="muted">—</td><td className="muted">—</td></>)}
                    <td className="actions">
                      {canEditEvent(user, ev) && <Link className="btn small" to={`/events/${ev.id}/edit`}>Edit</Link>}
                      {manages(ev.calendarId) && <Link className="btn small ghost" to={`/events/${ev.id}/history`}>History</Link>}
                      {ev.deletedAt && manages(ev.calendarId) && <button className="btn small" onClick={() => restore.mutate(ev.id)} disabled={restore.isPending}>Restore</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
