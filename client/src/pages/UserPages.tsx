import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type UseFormRegister, type UseFormSetValue } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../api';
import { useRefreshSession, useSession } from '../session';
import { useToast } from '../components/Layout';
import { applyServerErrors } from '../forms';
import { ActivityLine, CopyField, Field, FormError, Loading } from '../components/ui';
import { userInviteSchema, userUpdateSchema } from '../../../shared/schemas';
import { PERMISSIONS, PRESETS, presetName, can as canDo } from '../../../shared/permissions';
import { formatDateTime } from '../../../shared/format';
import type { UserDTO, UserDetailDTO } from '../../../shared/api';

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
        <h1>Users <span className="count">{data.users.length}</span></h1>
        <Link className="btn primary" to="/admin/users/new">+ Invite someone</Link>
      </div>
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Name</th><th>Access</th><th>Status</th><th>Events added</th><th>Calendar synced</th><th></th></tr></thead>
          <tbody>
            {data.users.map(u => (
              <tr key={u.id} className={u.active ? '' : 'deleted'}>
                <td data-label="Name"><strong>{u.displayName}</strong><div className="small muted">{u.username}</div></td>
                <td data-label="Access">{presetName(u.permissions)}</td>
                <td data-label="Status"><StatusPill user={u} /></td>
                <td data-label="Events added"><Link to={`/events?by=${u.id}`}>{data.eventCounts[u.id] ?? 0}</Link></td>
                <td data-label="Calendar synced">{u.lastFeedFetch ? formatDateTime(u.lastFeedFetch) : <span className="muted">never</span>}</td>
                <td className="actions"><Link className="btn small" to={`/admin/users/${u.id}`}>Manage</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function StatusPill({ user }: { user: UserDTO }) {
  if (!user.active) return <span className="pill off">Disabled</span>;
  if (!user.hasPassword) return <span className="pill warn">Invite pending</span>;
  return <span className="pill ok">Active</span>;
}

type PermForm = { permissions: string[] };
function PermissionCheckboxes<T extends PermForm>({ register, setValue }: { register: UseFormRegister<T>; setValue: UseFormSetValue<T> }) {
  const reg = register as unknown as UseFormRegister<PermForm>;
  const set = setValue as unknown as UseFormSetValue<PermForm>;
  return (
    <>
      <div className="presets">Quick set:{' '}
        {Object.values(PRESETS).map(p => (
          <button key={p.label} type="button" className="btn small ghost" onClick={() => set('permissions', [...p.perms], { shouldDirty: true })}>{p.label}</button>
        ))}
      </div>
      <div className="perm-grid">
        {PERMISSIONS.map(p => (
          <label key={p.key} className="check perm">
            <input type="checkbox" value={p.key} {...reg('permissions')} />
            <span><strong>{p.label}</strong><br /><span className="small muted">{p.help}</span></span>
          </label>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- invite
export function NewUserPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState('');
  const form = useForm<z.input<typeof userInviteSchema>, unknown, z.output<typeof userInviteSchema>>({
    resolver: zodResolver(userInviteSchema),
    defaultValues: { displayName: '', username: '', permissions: [...PRESETS.viewer.perms] },
  });
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = form;

  const onSubmit = handleSubmit(async values => {
    try {
      const { user } = await api.post<{ user: UserDTO }>('/api/users', values);
      await qc.invalidateQueries({ queryKey: ['users'] });
      toast({ type: 'ok', msg: `Created ${user.displayName}. Copy the setup link and send it to them.` });
      navigate(`/admin/users/${user.id}`);
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  return (
    <section className="card narrow-page">
      <h1>Invite someone</h1>
      <p className="muted">You'll get a setup link to send them (WhatsApp, text, email). They open it on their phone, choose a password, and add the calendar in one tap.</p>
      <FormError message={error} />
      <form onSubmit={onSubmit} className="stack" noValidate>
        <Field label="Name" error={errors.displayName?.message}><input {...register('displayName')} placeholder="e.g. Aunt Miriam" /></Field>
        <Field label="Username" error={errors.username?.message}><input {...register('username')} autoCapitalize="none" placeholder="e.g. miriam" /></Field>
        <fieldset><legend>Permissions</legend><PermissionCheckboxes register={register} setValue={setValue} /></fieldset>
        <button className="btn primary" disabled={isSubmitting}>Create &amp; get setup link</button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- manage one user
export function UserDetailPage() {
  const { id } = useParams();
  const { data, isPending } = useQuery({ queryKey: ['user', id], queryFn: () => api.get<UserDetailDTO>(`/api/users/${id}`) });
  if (isPending || !data) return <Loading />;
  return <UserDetail key={data.user.id + data.user.username} data={data} />;
}

function UserDetail({ data }: { data: UserDetailDTO }) {
  const { user: me } = useSession();
  const refresh = useRefreshSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState('');
  const u = data.user;
  const isSelf = u.id === me?.id;
  const form = useForm<z.input<typeof userUpdateSchema>, unknown, z.output<typeof userUpdateSchema>>({
    resolver: zodResolver(userUpdateSchema),
    defaultValues: { displayName: u.displayName, username: u.username, permissions: [...u.permissions], active: u.active },
  });
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = form;
  const reload = () => qc.invalidateQueries();

  const onSubmit = handleSubmit(async values => {
    try {
      const res = await api.put<{ changed: boolean }>(`/api/users/${u.id}`, values);
      if (isSelf) await refresh();
      await reload();
      setError('');
      toast({ type: 'ok', msg: res.changed ? 'Saved.' : 'No changes.' });
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  const action = async (path: string, msg: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    await api.post(`/api/users/${u.id}/${path}`);
    await reload();
    toast({ type: 'ok', msg });
  };

  const share = `Hi ${u.displayName}, here's your link to set up the family calendar: ${data.inviteUrl}`;

  return (
    <>
      <div className="pagehead"><h1>{u.displayName}</h1><Link className="btn ghost" to="/admin/users">All users</Link></div>
      <div className="cols">
        <section className="card">
          <h2>Details &amp; permissions</h2>
          <FormError message={error} />
          <form onSubmit={onSubmit} className="stack" noValidate>
            <Field label="Name" error={errors.displayName?.message}><input {...register('displayName')} /></Field>
            <Field label="Username" error={errors.username?.message}><input {...register('username')} autoCapitalize="none" /></Field>
            <fieldset><legend>Permissions</legend><PermissionCheckboxes register={register} setValue={setValue} /></fieldset>
            <label className="check">
              <input type="checkbox" {...register('active')} disabled={isSelf} /> Account enabled{' '}
              <span className="muted small">{isSelf ? "(you can't disable yourself)" : '(disabling also stops their calendar feed)'}</span>
            </label>
            <button className="btn primary" disabled={isSubmitting}>Save</button>
          </form>
        </section>
        <div>
          <section className="card">
            <h2>Setup / password link</h2>
            {data.inviteUrl ? (
              <>
                <p className="small">Send this link to {u.displayName}. It works once and expires {formatDateTime(data.inviteExpires)}.</p>
                <CopyField value={data.inviteUrl} />
                <p><a className="btn small ghost" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">Share via WhatsApp</a></p>
              </>
            ) : <p className="small muted">{u.hasPassword ? 'They have a password. Generate a link if they forgot it.' : 'No valid link — generate one.'}</p>}
            <button className="btn small" onClick={() => action('invite', 'New setup link created. It replaces any earlier link.')}>
              {data.inviteUrl ? 'Generate new link' : 'Generate setup link'}
            </button>
          </section>
          <section className="card">
            <h2>Calendar feed</h2>
            {canDo(u, 'subscribe') ? (
              <>
                <p className="small">No account needed (e.g. for a grandparent): send this page link — it has one-tap subscribe buttons.</p>
                <CopyField value={data.links.pageUrl} />
                <p><Link className="btn small ghost" to={`/admin/users/${u.id}/subscribe`}>QR code &amp; feed options</Link></p>
                <p className="small muted">Last synced: {u.lastFeedFetch ? formatDateTime(u.lastFeedFetch) : 'never'}</p>
                <button className="btn small danger" onClick={() => action('feed-reset', 'Feed link reset. The old link no longer works.',
                  'Their phone will stop updating until they subscribe again with the new link. Continue?')}>Reset feed link</button>
              </>
            ) : <p className="small muted">This user doesn't have the Subscribe permission.</p>}
          </section>
          <section className="card">
            <h2>Recent activity</h2>
            <ul className="timeline small">
              {data.activity.length ? data.activity.map(a => <ActivityLine key={a.id} entry={a} names={data.names} />) : <li className="muted">Nothing yet.</li>}
            </ul>
            <Link className="small" to={`/admin/activity?user=${u.id}`}>See all</Link>
          </section>
        </div>
      </div>
    </>
  );
}
