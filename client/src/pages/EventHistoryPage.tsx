import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Loading, actionLabel, nameOf } from '../components/ui';
import { displayName } from '../../../shared/occurrences';
import { formatDateTime } from '../../../shared/format';
import type { AuditEntryDTO, EventDTO, NameMap } from '../../../shared/api';

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v));

export function EventHistoryPage() {
  const { id } = useParams();
  const { data, isPending, error } = useQuery({
    queryKey: ['history', id],
    queryFn: () => api.get<{ event: EventDTO; entries: AuditEntryDTO[]; names: NameMap }>(`/api/events/${id}/history`),
  });
  if (isPending) return <Loading />;
  if (error) return <section className="card"><p>{error.message}</p></section>;
  return (
    <>
      <div className="pagehead"><h1>History: {displayName(data.event)}</h1><Link className="btn ghost" to="/events">Back</Link></div>
      <div className="card">
        <ul className="timeline">
          {data.entries.map(a => (
            <li key={a.id}>
              <strong>{nameOf(data.names, a.actorId)}</strong> {actionLabel(a.action)} <span className="muted">{formatDateTime(a.at)}</span>
              {a.changes.length > 0 && (
                <ul className="changes">
                  {a.changes.map(c => <li key={c.field}><code>{c.field}</code>: <del>{show(c.from)}</del> → <ins>{show(c.to)}</ins></li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
