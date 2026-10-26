import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../api';
import { useRefreshSession, useSession } from '../session';
import { useToast } from '../components/Layout';
import { applyServerErrors } from '../forms';
import { Field, FormError } from '../components/ui';
import { accountSchema } from '../../../shared/schemas';
import { PERMISSIONS, roleName } from '../../../shared/permissions';

export function AccountPage() {
  const { user } = useSession();
  const refresh = useRefreshSession();
  const toast = useToast();
  const [error, setError] = useState('');
  const form = useForm<z.input<typeof accountSchema>, unknown, z.output<typeof accountSchema>>({
    resolver: zodResolver(accountSchema),
    defaultValues: { displayName: user!.displayName, currentPassword: '', newPassword: '' },
  });
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = form;

  const onSubmit = handleSubmit(async values => {
    try {
      await api.patch('/api/me', values);
      await refresh();
      reset({ displayName: values.displayName, currentPassword: '', newPassword: '' });
      setError('');
      toast({ type: 'ok', msg: 'Saved.' });
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  return (
    <section className="card narrow-page">
      <h1>Your account</h1>
      <p>Signed in as <strong>{user!.username}</strong>.{user!.appAdmin && <> You're an <span className="badge">App admin</span>.</>}</p>
      {user!.memberships.length ? (
        <ul className="cal-list small">
          {user!.memberships.map(m => (
            <li key={m.calendarId}><strong>{m.calendarName}</strong>: {roleName(m.permissions)}{' '}
              <span className="muted">({PERMISSIONS.filter(p => m.permissions.includes(p.key)).map(p => p.label).join(', ')})</span></li>
          ))}
        </ul>
      ) : <p className="small muted">You aren't in any calendar yet.</p>}
      <FormError message={error} />
      <form onSubmit={onSubmit} className="stack" noValidate>
        <Field label="Display name" error={errors.displayName?.message}><input {...register('displayName')} /></Field>
        <Field label="Current password" error={errors.currentPassword?.message}><input type="password" {...register('currentPassword')} autoComplete="current-password" /></Field>
        <Field label="New password" hint="(leave blank to keep)" error={errors.newPassword?.message}><input type="password" {...register('newPassword')} autoComplete="new-password" /></Field>
        <button className="btn primary" disabled={isSubmitting}>Save</button>
      </form>
    </section>
  );
}
