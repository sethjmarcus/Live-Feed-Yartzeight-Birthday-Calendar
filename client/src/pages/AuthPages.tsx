import { useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useRefreshSession, useSession } from '../session';
import { applyServerErrors } from '../forms';
import { Field, FormError, Loading } from '../components/ui';
import { acceptInviteSchema, loginSchema, setupSchema } from '../../../shared/schemas';
import { can } from '../../../shared/permissions';
import type { UserDTO } from '../../../shared/api';

// ---------------------------------------------------------------- first-run setup
export function SetupPage() {
  const { session, isPending } = useSession();
  const refresh = useRefreshSession();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const form = useForm<z.input<typeof setupSchema>, unknown, z.output<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: { setupCode: '', calendarName: 'Family Calendar', displayName: '', username: '', password: '' },
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;

  if (isPending) return <Loading />;
  if (!session?.needsSetup) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async values => {
    try {
      await api.post('/api/setup', values);
      await refresh();
      navigate('/', { replace: true });
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  return (
    <section className="card narrow-page">
      <h1>Welcome — create the admin account</h1>
      <p className="muted">This runs once. The admin manages who can subscribe, add and edit events. The setup code proves you're the one running the server.</p>
      <FormError message={error} />
      <form onSubmit={onSubmit} className="stack" noValidate>
        <Field label="Setup code" hint="— printed in the server's log when it started (e.g. A1B2C3-D4E5F6)" error={errors.setupCode?.message}>
          <input {...register('setupCode')} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
        </Field>
        <Field label="Calendar name" error={errors.calendarName?.message}><input {...register('calendarName')} /></Field>
        <Field label="Your name" error={errors.displayName?.message}><input {...register('displayName')} autoComplete="name" /></Field>
        <Field label="Username" error={errors.username?.message}><input {...register('username')} autoCapitalize="none" autoComplete="username" /></Field>
        <Field label="Password" error={errors.password?.message}><input type="password" {...register('password')} autoComplete="new-password" /></Field>
        <button className="btn primary" disabled={isSubmitting}>Create admin account</button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- sign in
export function LoginPage() {
  const { user, session, isPending } = useSession();
  const refresh = useRefreshSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<z.input<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  });

  if (isPending) return <Loading />;
  if (session?.needsSetup) return <Navigate to="/setup" replace />;
  if (user) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async values => {
    try {
      await api.post('/api/login', values);
      await refresh();
      const next = params.get('next') || '/';
      navigate(next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in.'); }
  });

  return (
    <section className="card narrow-page">
      <h1>Sign in</h1>
      <FormError message={error} />
      <form onSubmit={onSubmit} className="stack">
        <Field label="Username"><input {...register('username')} autoCapitalize="none" autoComplete="username" autoFocus /></Field>
        <Field label="Password"><input type="password" {...register('password')} autoComplete="current-password" /></Field>
        <button className="btn primary" disabled={isSubmitting}>Sign in</button>
      </form>
      <p className="muted small">No account? Ask the calendar admin for an invite link.</p>
    </section>
  );
}

// ---------------------------------------------------------------- accept invitation
export function InvitePage() {
  const { token = '' } = useParams();
  const refresh = useRefreshSession();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ displayName: string; username: string }>(`/api/invites/${token}`),
    retry: false,
  });
  const form = useForm<z.input<typeof acceptInviteSchema>>({ resolver: zodResolver(acceptInviteSchema), defaultValues: { password: '', confirm: '' } });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = form;

  if (invite.isPending) return <Loading />;
  if (invite.isError) {
    return <section className="card narrow-page"><h1>Link expired</h1><p>{invite.error.message}</p></section>;
  }

  const onSubmit = handleSubmit(async values => {
    try {
      const { user } = await api.post<{ user: UserDTO }>(`/api/invites/${token}`, values);
      await refresh();
      navigate(can(user, 'subscribe') ? '/subscribe' : '/', { replace: true });
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  return (
    <section className="card narrow-page">
      <h1>Hi {invite.data.displayName} 👋</h1>
      <p>Choose a password to finish setting up. Next you'll get a one-tap button to add the calendar to your phone — after that, every new event shows up automatically.</p>
      <FormError message={error} />
      <form onSubmit={onSubmit} className="stack" noValidate>
        <Field label="Username"><input value={invite.data.username} disabled /></Field>
        <Field label="New password" error={errors.password?.message}><input type="password" {...register('password')} autoComplete="new-password" autoFocus /></Field>
        <Field label="Repeat password" error={errors.confirm?.message}><input type="password" {...register('confirm')} autoComplete="new-password" /></Field>
        <button className="btn primary" disabled={isSubmitting}>Continue</button>
      </form>
    </section>
  );
}
