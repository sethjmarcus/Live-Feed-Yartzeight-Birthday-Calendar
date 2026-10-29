import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useSession, subscribable } from '../session';
import { useToast } from '../components/Layout';
import { applyServerErrors } from '../forms';
import { ActivityLine, CopyField, Field, FormError, Loading, PermissionsEditor } from '../components/ui';
import { InvitePersonForm } from './CalendarPages';
import { userUpdateSchema } from '../../../shared/schemas';
import { ROLES, roleName, type Permission } from '../../../shared/permissions';
import { formatDateTime } from '../../../shared/format';
import type { MembershipDTO, UserDTO, UserDetailDTO } from '../../../shared/api';

// ---------------------------------------------------------------- list
export function UsersPage() {
  const { data, isPending } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<{ users: UserDTO[]; eventCounts: Record<number, number> }>('/api/users'),
  });
  if (isPending || !data) return <Loading />;
  return (
    <>
      <div className="pagehead">
        <h1>People <span className="count">{data.users.length}</span></h1>
        <Link className="btn primary" to="/admin/users/new">+ Invite someone</Link>
      </div>
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Name</th><th>Calendars</th><th>Status</th><th>Events added</th><th>Phone synced</th><th></th></tr></thead>
          <tbody>
            {data.users.map(u => (
              <tr key={u.id} className={u.active ? '' : 'deleted'}>
                <td data-label="Name">
                  <strong>{u.displayName}</strong> {u.appAdmin && <span className="badge" title="Runs the site">App admin</span>}
                  <div className="small muted">{u.username}</div>
                </td>
                <td data-label="Calendars"><Memberships list={u.memberships} /></td>
                <td data-label="Status"><StatusPill user={u} /></td>
                <td data-label="Events added"><Link to={`/events?by=${u.id}`}>{data.eventCounts[u.id] ?? 0}</Link></td>
                <td data-label="Phone synced">{u.lastFeedFetch ? formatDateTime(u.lastFeedFetch) : <span className="muted">never</span>}</td>
                <td className="actions"><Link className="btn small" to={`/admin/users/${u.id}`}>Manage</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Memberships({ list }: { list: MembershipDTO[] }) {
  if (!list.length) return <span className="muted">none</span>;
  return <ul className="cal-list small">{list.map(m => <li key={m.calendarId}>{m.calendarName} <span className="muted">· {roleName(m.permissions)}</span></li>)}</ul>;
}

function StatusPill({ user }: { user: UserDTO }) {
  if (!user.active) return <span className="pill off">Disabled</span>;
  if (!user.hasPassword) return <span className="pill warn">Invite pending</span>;
  return <span className="pill ok">Active</span>;
}

// ---------------------------------------------------------------- invite
export function NewUserPage() {
  const { calendarsWhere } = useSession();
  const qc = useQueryClient();
  const calendars = calendarsWhere('manage');
  return (
    <section className="card narrow-page">
      <h1>Invite someone</h1>
      <p className="muted">You'll get a setup link to send them (WhatsApp, text, email). They open it on their phone, choose a password, and add the calendar in one tap.
        You can add them to more calendars afterwards.</p>
      <InvitePersonForm calendars={calendars} onCreated={() => qc.invalidateQueries({ queryKey: ['users'] })} />
    </section>
  );
}

// ---------------------------------------------------------------- manage one person
export function UserDetailPage() {
  const { id } = useParams();
  const { data, isPending } = useQuery({ queryKey: ['user', id], queryFn: () => api.get<UserDetailDTO>(`/api/users/${id}`) });
  if (isPending || !data) return <Loading />;
  return <UserDetail key={data.user.id + data.user.username} data={data} />;
}

type AccountValues = z.input<typeof userUpdateSchema>;

function UserDetail({ data }: { data: UserDetailDTO }) {
  const { user: me, calendarsWhere } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState('');
  const u = data.user;
  const isSelf = u.id === me?.id;
  const form = useForm<AccountValues, unknown, z.output<typeof userUpdateSchema>>({
    resolver: zodResolver(userUpdateSchema),
    defaultValues: { displayName: u.displayName, username: u.username, active: u.active, appAdmin: u.appAdmin },
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;
  const reload = () => qc.invalidateQueries(); // includes the session (roles may have changed)

  const onSubmit = handleSubmit(async values => {
    try {
      const res = await api.put<{ changed: boolean }>(`/api/users/${u.id}`, values);
      await reload();
      setError('');
      toast({ type: 'ok', msg: res.changed ? 'Saved.' : 'No changes.' });
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  const run = async (fn: () => Promise<unknown>, msg: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    try {
      await fn();
      await reload();
      setError('');
      toast({ type: 'ok', msg });
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Something went wrong.'); }
  };

  const share = `Hi ${u.displayName}, here's your link to set up the family calendar: ${data.inviteUrl}`;
  const manageable = calendarsWhere('manage');
  const joinable = manageable.filter(c => !u.memberships.some(m => m.calendarId === c.id));

  return (
    <>
      <div className="pagehead"><h1>{u.displayName}</h1><Link className="btn ghost" to="/admin/users">All people</Link></div>
      <FormError message={error} />
      <div className="cols">
        <div>
          <section className="card">
            <h2>Account</h2>
            <form onSubmit={onSubmit} className="stack" noValidate>
              <Field label="Name" error={errors.displayName?.message}><input {...register('displayName')} /></Field>
              <Field label="Username" error={errors.username?.message}><input {...register('username')} autoCapitalize="none" /></Field>
              <label className="check">
                <input type="checkbox" {...register('appAdmin')} disabled={isSelf} /> App admin{' '}
                <span className="muted small">— runs the site: people, calendars, settings, backups{isSelf && " (you can't remove your own)"}</span>
              </label>
              <label className="check">
                <input type="checkbox" {...register('active')} disabled={isSelf} /> Account enabled{' '}
                <span className="muted small">{isSelf ? "(you can't disable yourself)" : '(disabling also stops their phone feed)'}</span>
              </label>
              <button className="btn primary" disabled={isSubmitting}>Save</button>
            </form>
          </section>
          <section className="card">
            <h2>Calendars</h2>
            {u.memberships.length === 0 && <p className="small muted">Not in any calendar yet.</p>}
            <div className="stack">
              {u.memberships.map(m => {
                const canManage = manageable.some(c => c.id === m.calendarId);
                return (
                  <MembershipEditor key={m.calendarId} membership={m} disabled={!canManage}
                    onSave={perms => run(() => api.put(`/api/calendars/${m.calendarId}/members/${u.id}`, { permissions: perms }), `Saved ${m.calendarName}.`)}
                    onRemove={() => run(() => api.del(`/api/calendars/${m.calendarId}/members/${u.id}`), `Removed from ${m.calendarName}.`,
                      `Remove ${u.displayName} from “${m.calendarName}”?`)} />
                );
              })}
              {joinable.length > 0 && <AddToCalendar calendars={joinable} onAdd={(cid, perms) => run(() => api.put(`/api/calendars/${cid}/members/${u.id}`, { permissions: perms }), 'Added. It appears on their phone at the next sync.')} />}
            </div>
          </section>
        </div>
        <div>
          {!data.links && (
            <section className="card">
              <h2>Links hidden</h2>
              <p className="small muted">{u.displayName} is in a calendar you don't manage, so only that calendar's owners can see their setup and feed links.</p>
            </section>
          )}
          {data.links && <section className="card">
            <h2>Setup / password link</h2>
            {data.inviteUrl ? (
              <>
                <p className="small">Send this link to {u.displayName}. It works once and expires {formatDateTime(data.inviteExpires)}.</p>
                <CopyField value={data.inviteUrl} />
                <p><a className="btn small ghost" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">Share via WhatsApp</a></p>
              </>
            ) : <p className="small muted">{u.hasPassword ? 'They have a password. If they forgot it, generate a reset link — it lasts 24 hours.' : 'No valid link — generate one.'}</p>}
            <button className="btn small" onClick={() => run(() => api.post(`/api/users/${u.id}/invite`), 'New link created. It replaces any earlier link.')}>
              {data.inviteUrl ? 'Generate new link' : u.hasPassword ? 'Generate reset link' : 'Generate setup link'}
            </button>
          </section>}
          {data.links && <section className="card">
            <h2>Phone feed</h2>
            {subscribable(u).length ? (
              <>
                <p className="small">No account needed (e.g. for a grandparent): send this page link — it has one-tap subscribe buttons.</p>
                <CopyField value={data.links.pageUrl} />
                <p><Link className="btn small ghost" to={`/admin/users/${u.id}/subscribe`}>QR code &amp; feed options</Link></p>
                <p className="small muted">Last synced: {u.lastFeedFetch ? formatDateTime(u.lastFeedFetch) : 'never'}</p>
                <button className="btn small danger" onClick={() => run(() => api.post(`/api/users/${u.id}/feed-reset`), 'Feed link reset. The old link no longer works.',
                  'Their phone will stop updating until they subscribe again with the new link. Continue?')}>Reset feed link</button>
              </>
            ) : <p className="small muted">They can't subscribe to any calendar yet.</p>}
          </section>}
          <section className="card">
            <h2>Recent activity</h2>
            <ul className="timeline small">
              {data.activity.length ? data.activity.map(a => <ActivityLine key={a.id} entry={a} names={data.names} calendarNames={data.calendarNames} />) : <li className="muted">Nothing yet.</li>}
            </ul>
            <Link className="small" to={`/admin/activity?user=${u.id}`}>See all</Link>
          </section>
        </div>
      </div>
    </>
  );
}

function MembershipEditor({ membership: m, disabled, onSave, onRemove }: { membership: MembershipDTO; disabled: boolean; onSave: (p: Permission[]) => void; onRemove: () => void }) {
  const [perms, setPerms] = useState<Permission[]>(m.permissions);
  const dirty = perms.join() !== m.permissions.join();
  return (
    <fieldset>
      <legend>{m.calendarName}</legend>
      <PermissionsEditor value={perms} onChange={setPerms} disabled={disabled} />
      {disabled ? <p className="small muted">Only this calendar's owners can change this.</p> : (
        <div className="row">
          {dirty && <button type="button" className="btn small primary" onClick={() => onSave(perms)}>Save role</button>}
          <button type="button" className="btn small danger" onClick={onRemove}>Remove from calendar</button>
        </div>
      )}
    </fieldset>
  );
}

function AddToCalendar({ calendars, onAdd }: { calendars: { id: number; name: string }[]; onAdd: (calendarId: number, perms: Permission[]) => void }) {
  const [calendarId, setCalendarId] = useState('');
  const [perms, setPerms] = useState<Permission[]>([...ROLES.viewer.perms]);
  return (
    <fieldset>
      <legend>Add to another calendar</legend>
      <select aria-label="Calendar" value={calendarId} onChange={e => setCalendarId(e.target.value)}>
        <option value="">Choose a calendar…</option>
        {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <PermissionsEditor value={perms} onChange={setPerms} />
      <button type="button" className="btn small primary" disabled={!calendarId} onClick={() => { onAdd(Number(calendarId), perms); setCalendarId(''); }}>Add</button>
    </fieldset>
  );
}
