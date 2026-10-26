import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import { useToast } from '../components/Layout';
import { applyServerErrors } from '../forms';
import { CopyField, Field, FormError, Loading, PermissionsEditor, ROLE_HELP } from '../components/ui';
import { calendarSchema, userInviteSchema } from '../../../shared/schemas';
import { ROLES, roleName, type CalendarAccess, type Permission } from '../../../shared/permissions';
import { formatDateTime } from '../../../shared/format';
import type { CalendarDetailDTO, CalendarOverviewDTO, MemberDTO, UserDTO } from '../../../shared/api';

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

// ---------------------------------------------------------------- list
export function CalendarsPage() {
  const { user, isAppAdmin, session } = useSession();
  const { data, isPending } = useQuery({
    queryKey: ['calendars'],
    queryFn: () => api.get<{ calendars: CalendarOverviewDTO[] }>('/api/calendars'),
  });
  if (isPending || !data) return <Loading />;
  const access = (id: number) => user?.calendars.find(c => c.id === id);
  const mine = (a?: CalendarAccess) => a?.member ? roleName(user!.memberships.find(m => m.calendarId === a.id)!.permissions) : null;

  return (
    <>
      <div className="pagehead"><h1>Calendars <span className="count">{data.calendars.length}</span></h1></div>
      <p className="muted">Each calendar has its own members. Everyone gets <strong>one</strong> phone feed with all the calendars they subscribe to, so joining another calendar needs no new setup.</p>
      {isAppAdmin && <NewCalendarForm />}
      <div className="table-wrap card">
        <table>
          <thead><tr><th>Calendar</th><th>Your role</th><th>Members</th><th>Events</th><th></th></tr></thead>
          <tbody>
            {data.calendars.map(c => {
              const a = access(c.id);
              return (
                <tr key={c.id}>
                  <td data-label="Calendar"><strong>{c.name}</strong><div className="small muted">created {formatDateTime(c.createdAt)}</div></td>
                  <td data-label="Your role">{mine(a) ?? (a ? <span className="muted">App admin</span> : <span className="muted">Private — no access</span>)}</td>
                  <td data-label="Members">{c.memberCount}</td>
                  <td data-label="Events">{c.eventCount}</td>
                  <td className="actions">{a?.permissions.includes('manage') && <Link className="btn small" to={`/calendars/${c.id}`}>Manage</Link>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {isAppAdmin && session?.appAdminAccess === 'metadata' && (
        <p className="small muted">App admins see only the name and size of calendars they don't belong to (APP_ADMIN_ACCESS=metadata).</p>
      )}
    </>
  );
}

function NewCalendarForm() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const form = useForm<z.input<typeof calendarSchema>>({ resolver: zodResolver(calendarSchema), defaultValues: { name: '' } });
  const onSubmit = form.handleSubmit(async values => {
    try {
      const { calendar } = await api.post<{ calendar: { id: number } }>('/api/calendars', values);
      await qc.invalidateQueries();
      navigate(`/calendars/${calendar.id}`);
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });
  return (
    <section className="card">
      <h2>New calendar</h2>
      <FormError message={error} />
      <form onSubmit={onSubmit} className="inline-form" noValidate>
        <input {...form.register('name')} placeholder="e.g. Levi side, Grandma's friends" aria-label="Calendar name" aria-invalid={!!form.formState.errors.name} />
        <button className="btn primary" disabled={form.formState.isSubmitting}>Create</button>
      </form>
      {form.formState.errors.name && <span className="field-error">{form.formState.errors.name.message}</span>}
      <p className="small muted">You become its owner. Then add people to it, each with their own role.</p>
    </section>
  );
}

// ---------------------------------------------------------------- one calendar
export function CalendarDetailPage() {
  const { id } = useParams();
  const { data, isPending, error } = useQuery({
    queryKey: ['calendar', id],
    queryFn: () => api.get<CalendarDetailDTO>(`/api/calendars/${id}`),
    retry: false,
  });
  if (isPending) return <Loading />;
  if (error) return <section className="card narrow-page"><h1>Can't open this calendar</h1><p>{error.message}</p><Link className="btn" to="/calendars">Calendars</Link></section>;
  return <CalendarDetail key={data.calendar.id} data={data} />;
}

function CalendarDetail({ data }: { data: CalendarDetailDTO }) {
  const { calendar, members, directory } = data;
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [error, setError] = useState('');
  const reload = () => qc.invalidateQueries(); // includes the session (roles may have changed)

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      await reload();
      setError('');
      toast({ type: 'ok', msg });
    } catch (err) { setError(errorText(err)); }
  };

  const remove = () => {
    if (!confirm(`Delete the calendar “${calendar.name}”?`)) return;
    void (async () => {
      try {
        await api.del(`/api/calendars/${calendar.id}`);
        await reload();
        toast({ type: 'ok', msg: `Deleted “${calendar.name}”.` });
        navigate('/calendars');
      } catch (err) { setError(errorText(err)); }
    })();
  };

  return (
    <>
      <div className="pagehead">
        <h1>{calendar.name}</h1>
        <div className="row">
          <Link className="btn ghost" to={`/admin/activity?calendar=${calendar.id}`}>Activity</Link>
          <Link className="btn ghost" to="/calendars">All calendars</Link>
        </div>
      </div>
      <FormError message={error} />
      <RenameForm calendarId={calendar.id} name={calendar.name} onDone={reload} />

      <section className="card">
        <h2>Members <span className="count">{members.length}</span></h2>
        <p className="small muted">{ROLE_HELP}</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Person</th><th>Role in this calendar</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {members.map(m => (
                <MemberRow key={m.userId} calendarId={calendar.id} member={m}
                  onChange={perms => run(() => api.put(`/api/calendars/${calendar.id}/members/${m.userId}`, { permissions: perms }), `${m.displayName} is now ${roleName(perms)}.`)}
                  onRemove={() => confirm(`Remove ${m.displayName} from “${calendar.name}”? Its events leave their phone at the next sync.`) &&
                    run(() => api.del(`/api/calendars/${calendar.id}/members/${m.userId}`), `Removed ${m.displayName}.`)}
                  onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cols">
        {directory && (
          <AddExistingForm people={directory}
            onAdd={(userId, perms) => run(() => api.put(`/api/calendars/${calendar.id}/members/${userId}`, { permissions: perms }), 'Added. It appears on their phone at the next sync.')} />
        )}
        <section className="card">
          <h2>Invite someone new</h2>
          <InvitePersonForm calendars={[{ id: calendar.id, name: calendar.name }]} onCreated={reload} />
        </section>
      </div>

      {calendar.eventCount === 0 && (
        <div className="danger-zone">
          <button type="button" className="btn danger" onClick={remove}>Delete this calendar</button>
          <span className="small muted"> Only calendars that never had events can be deleted.</span>
        </div>
      )}
    </>
  );
}

function RenameForm({ calendarId, name, onDone }: { calendarId: number; name: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [error, setError] = useState('');
  const form = useForm<z.input<typeof calendarSchema>>({ resolver: zodResolver(calendarSchema), defaultValues: { name } });
  const onSubmit = form.handleSubmit(async values => {
    try {
      const { changed } = await api.put<{ changed: boolean }>(`/api/calendars/${calendarId}`, values);
      await onDone();
      setError('');
      toast({ type: 'ok', msg: changed ? 'Renamed.' : 'No changes.' });
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });
  return (
    <section className="card">
      <h2>Name</h2>
      <FormError message={error} />
      <form onSubmit={onSubmit} className="inline-form" noValidate>
        <input {...form.register('name')} aria-label="Calendar name" />
        <button className="btn" disabled={form.formState.isSubmitting}>Rename</button>
      </form>
      {form.formState.errors.name && <span className="field-error">{form.formState.errors.name.message}</span>}
      <p className="small muted">Shown on phones that subscribe only to this calendar, and next to its events elsewhere.</p>
    </section>
  );
}

function MemberRow({ calendarId, member: m, onChange, onRemove, onError }: {
  calendarId: number; member: MemberDTO; onChange: (perms: Permission[]) => void; onRemove: () => void; onError: (msg: string) => void;
}) {
  const [perms, setPerms] = useState<Permission[]>(m.permissions);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const dirty = perms.join() !== m.permissions.join();
  const getLink = async () => {
    try {
      const r = await api.post<{ inviteUrl: string }>(`/api/calendars/${calendarId}/members/${m.userId}/invite`);
      setInviteUrl(r.inviteUrl);
    } catch (err) { onError(errorText(err)); }
  };
  return (
    <tr className={m.active ? '' : 'deleted'}>
      <td data-label="Person"><strong>{m.displayName}</strong><div className="small muted">{m.username}{!m.inFeed && ' · not in their feed'}</div></td>
      <td data-label="Role">
        <PermissionsEditor value={perms} onChange={p => { setPerms(p); }} id={`role-${m.userId}`} />
        {dirty && <button type="button" className="btn small primary" style={{ marginTop: '.4rem' }} onClick={() => onChange(perms)}>Save role</button>}
      </td>
      <td data-label="Status">
        {!m.active ? <span className="pill off">Disabled</span> : m.hasPassword ? <span className="pill ok">Active</span> : <span className="pill warn">Invite pending</span>}
        {!m.hasPassword && m.active && (
          inviteUrl ? <div style={{ marginTop: '.4rem' }}><CopyField value={inviteUrl} /></div>
            : <div><button type="button" className="btn small ghost" onClick={getLink}>Get setup link</button></div>
        )}
      </td>
      <td className="actions"><button type="button" className="btn small danger" onClick={onRemove}>Remove</button></td>
    </tr>
  );
}

function AddExistingForm({ people, onAdd }: { people: { id: number; displayName: string; username: string }[]; onAdd: (userId: number, perms: Permission[]) => void }) {
  const [userId, setUserId] = useState('');
  const [perms, setPerms] = useState<Permission[]>([...ROLES.viewer.perms]);
  return (
    <section className="card">
      <h2>Add someone who already has an account</h2>
      {people.length === 0 ? <p className="small muted">Everyone with an account is already in this calendar.</p> : (
        <div className="stack">
          <select aria-label="Person" value={userId} onChange={e => setUserId(e.target.value)}>
            <option value="">Choose a person…</option>
            {people.map(p => <option key={p.id} value={p.id}>{p.displayName} ({p.username})</option>)}
          </select>
          <PermissionsEditor value={perms} onChange={setPerms} />
          <button type="button" className="btn primary" disabled={!userId} onClick={() => { onAdd(Number(userId), perms); setUserId(''); }}>Add to calendar</button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- invite (used here and on People)
type InviteValues = z.input<typeof userInviteSchema>;

/** Create an account in one calendar; shows the setup link to send them. */
export function InvitePersonForm({ calendars, onCreated }: { calendars: { id: number; name: string }[]; onCreated?: (u: UserDTO) => Promise<void> | void }) {
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ user: UserDTO; inviteUrl: string } | null>(null);
  const form = useForm<InviteValues, unknown, z.output<typeof userInviteSchema>>({
    resolver: zodResolver(userInviteSchema),
    defaultValues: { displayName: '', username: '', calendarId: calendars[0]?.id ?? '', permissions: [...ROLES.viewer.perms] },
  });
  const { register, handleSubmit, setValue, watch, reset, formState: { errors, isSubmitting } } = form;
  const perms = watch('permissions') as Permission[];

  const onSubmit = handleSubmit(async values => {
    try {
      const res = await api.post<{ user: UserDTO; inviteUrl: string }>('/api/users', values);
      setCreated(res);
      setError('');
      reset({ ...values, displayName: '', username: '' });
      await onCreated?.(res.user);
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  if (created) {
    const share = `Hi ${created.user.displayName}, here's your link to set up the family calendar: ${created.inviteUrl}`;
    return (
      <div className="stack">
        <div className="flash ok">Created {created.user.displayName}. Send them this setup link — it works once and lasts 14 days.</div>
        <CopyField value={created.inviteUrl} />
        <div className="row">
          <a className="btn small ghost" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">Share via WhatsApp</a>
          <button type="button" className="btn small" onClick={() => setCreated(null)}>Invite someone else</button>
        </div>
      </div>
    );
  }

  return (
    <>
      <FormError message={error} />
      <form onSubmit={onSubmit} className="stack" noValidate>
        <Field label="Name" error={errors.displayName?.message}><input {...register('displayName')} placeholder="e.g. Aunt Miriam" /></Field>
        <Field label="Username" error={errors.username?.message}><input {...register('username')} autoCapitalize="none" placeholder="e.g. miriam" /></Field>
        {calendars.length > 1 ? (
          <Field label="Calendar" error={errors.calendarId?.message}>
            <select {...register('calendarId')}>{calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
        ) : <input type="hidden" {...register('calendarId')} />}
        <div>
          <span className="label-text">Role</span>
          <PermissionsEditor value={perms} onChange={p => setValue('permissions', p, { shouldDirty: true })} />
          {errors.permissions && <span className="field-error">{errors.permissions.message}</span>}
        </div>
        <button className="btn primary" disabled={isSubmitting}>Create &amp; get setup link</button>
      </form>
    </>
  );
}
