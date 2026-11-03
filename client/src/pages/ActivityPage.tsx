import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api, qs } from '../api';
import { useSession } from '../session';
import { ActivityLine, Loading } from '../components/ui';
import type { AuditEntryDTO, CalendarNameMap, NameMap, UserDTO } from '../../../shared/api';

export function ActivityPage() {
  const { isAppAdmin, calendarsWhere } = useSession();
  const managed = calendarsWhere('manage');
  const [params, setParams] = useSearchParams();
  const filters = { calendar: params.get('calendar') ?? '', user: params.get('user') ?? '', kind: params.get('kind') ?? '', page: params.get('page') ?? '1' };
  const { data, isPending, error } = useQuery({
    queryKey: ['activity', filters],
    queryFn: () => api.get<{ entries: AuditEntryDTO[]; page: number; pages: number; names: NameMap; calendarNames: CalendarNameMap }>(`/api/activity${qs(filters)}`),
    retry: false,
  });
  const people = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ users: UserDTO[] }>('/api/users'), enabled: isAppAdmin });
  if (error) return <section className="card narrow-page"><h1>Activity log</h1><p>{error.message}</p></section>;
  const set = (changes: Partial<typeof filters>) => setParams({ ...filters, page: '1', ...changes });

  return (
    <>
      <div className="pagehead"><h1>Activity log</h1></div>
      <div className="filters card">
        {managed.length > 1 && (
          <select aria-label="Calendar" value={filters.calendar} onChange={e => set({ calendar: e.target.value })}>
            <option value="">{isAppAdmin ? 'Everything' : 'All my calendars'}</option>
            {managed.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {isAppAdmin && (
          <select aria-label="Person" value={filters.user} onChange={e => set({ user: e.target.value })}>
            <option value="">Everyone</option>
            {people.data?.users.map(u => <option key={u.id} value={u.id}>{u.displayName}</option>)}
          </select>
        )}
        <select aria-label="Kind" value={filters.kind} onChange={e => set({ kind: e.target.value })}>
          <option value="">All actions</option>
          <option value="event">Event changes</option>
          <option value="user">People &amp; role changes</option>
        </select>
      </div>
      {isPending || !data ? <Loading /> : (
        <div className="card">
          <ul className="timeline">
            {data.entries.length ? data.entries.map(a => <ActivityLine key={a.id} entry={a} names={data.names} calendarNames={filters.calendar ? undefined : data.calendarNames} />) : <li className="muted">No activity.</li>}
          </ul>
          {data.pages > 1 && (
            <div className="pager">
              {data.page > 1 && <button className="btn small" onClick={() => set({ page: String(data.page - 1) })}>← Newer</button>}
              <span className="muted small">Page {data.page} of {data.pages}</span>
              {data.page < data.pages && <button className="btn small" onClick={() => set({ page: String(data.page + 1) })}>Older →</button>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
