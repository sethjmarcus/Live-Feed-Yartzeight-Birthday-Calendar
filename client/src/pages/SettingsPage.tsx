import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api } from '../api';
import { useToast } from '../components/Layout';
import { applyServerErrors } from '../forms';
import { Field, FormError, Loading } from '../components/ui';
import { HOLIDAY_GROUP_KEYS, settingsSchema } from '../../../shared/schemas';
import { formatDateTime } from '../../../shared/format';
import type { SettingsDTO } from '../../../shared/api';

const HOLIDAY_GROUP_LABELS: Record<(typeof HOLIDAY_GROUP_KEYS)[number], string> = {
  major: 'Major holidays',
  minor: 'Minor holidays (Tu BiShvat, Lag BaOmer…)',
  modern: 'Modern holidays (Yom HaAtzma’ut, Yom HaShoah…)',
  roshchodesh: 'Rosh Chodesh',
  fast: 'Minor fasts',
  specialShabbat: 'Special Shabbatot (Shekalim, Zachor…)',
};

/** GeoNames ids, each checked against the Hebcal API. */
const LOCATIONS: [string, string][] = [
  ['', 'Off — no candle-lighting times'],
  ['281184', 'Jerusalem'], ['293397', 'Tel Aviv'], ['294801', 'Haifa'], ['295530', "Be'er Sheva"],
  ['5128581', 'New York'], ['5368361', 'Los Angeles'], ['4887398', 'Chicago'], ['4164138', 'Miami'],
  ['2643743', 'London'], ['6167865', 'Toronto'], ['2147714', 'Sydney'], ['3369157', 'Cape Town'],
];

export function SettingsPage() {
  const { data, isPending } = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsDTO>('/api/settings') });
  if (isPending || !data) return <Loading />;
  return <SettingsForm data={data} />;
}

type FormValues = z.input<typeof settingsSchema> & { locationChoice: string };

function SettingsForm({ data }: { data: SettingsDTO }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState('');
  const s = data.settings;
  const known = LOCATIONS.some(([id]) => id === s.hebcalGeonameId);
  const form = useForm<FormValues>({
    resolver: zodResolver(settingsSchema) as never,
    defaultValues: { ...s, locationChoice: known ? s.hebcalGeonameId : 'custom' },
  });
  const { register, handleSubmit, setValue, control, formState: { errors, isSubmitting } } = form;
  const locationChoice = useWatch({ control, name: 'locationChoice' });

  const onSubmit = handleSubmit(async values => {
    try {
      const { locationChoice: _, ...settings } = values as FormValues;
      const res = await api.put<{ changed: boolean }>('/api/settings', settings);
      await qc.invalidateQueries();
      setError('');
      toast({ type: 'ok', msg: res.changed ? 'Settings saved.' : 'No changes.' });
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  const h = data.hebcal;
  return (
    <div className="narrow-page">
      <form onSubmit={onSubmit} className="stack" noValidate>
        <section className="card">
          <h1>Settings</h1>
          <FormError message={error} />
          <div className="stack">
            <Field label="Calendar name" hint="(shown on phones)" error={errors.calendarName?.message}><input {...register('calendarName')} /></Field>
            <div className="row">
              <Field label="Years ahead in feed" error={errors.yearsAhead?.message}><input type="number" min={1} max={30} {...register('yearsAhead')} /></Field>
              <Field label="Years of history" error={errors.yearsBehind?.message}><input type="number" min={0} max={10} {...register('yearsBehind')} /></Field>
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Holidays &amp; candle-lighting (from Hebcal)</h2>
          <p className="small muted">Subscribers can opt in to these on their Subscribe page. Data: Hebcal.com (CC BY 4.0).</p>
          <div className="stack">
            <label className="check"><input type="checkbox" {...register('hebcalIsrael')} /> Use the Israel holiday schedule (one day of Yom Tov)</label>
            <fieldset>
              <legend>Holidays to include</legend>
              <div className="perm-grid">
                {HOLIDAY_GROUP_KEYS.map(k => <label key={k} className="check"><input type="checkbox" value={k} {...register('hebcalHolidays')} /> {HOLIDAY_GROUP_LABELS[k]}</label>)}
              </div>
            </fieldset>
            <Field label="Location for candle-lighting times">
              <select {...register('locationChoice', { onChange: e => { if (e.target.value !== 'custom') setValue('hebcalGeonameId', e.target.value); } })}>
                {LOCATIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                <option value="custom">Other (GeoNames ID)…</option>
              </select>
            </Field>
            {locationChoice === 'custom' && (
              <Field label="GeoNames ID" hint={<>— find your city on <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">geonames.org</a>; the number is in its URL</>} error={errors.hebcalGeonameId?.message}>
                <input inputMode="numeric" {...register('hebcalGeonameId')} />
              </Field>
            )}
            <Field label="Candle-lighting minutes before sunset" error={errors.hebcalCandleMinutes?.message}>
              <input type="number" min={0} max={90} {...register('hebcalCandleMinutes')} />
              <span className="small muted">Hebcal uses 40 for Jerusalem and 30 for Haifa automatically.</span>
            </Field>
            <p className="small muted">
              Status: {h.cachedYears} of {h.totalYears} years downloaded{h.lastFetched && `, last updated ${formatDateTime(h.lastFetched)}`}{h.location && ` · ${h.location}`}.
              {h.lastError && <><br /><span className="danger">Last error: {h.lastError}</span></>}
            </p>
          </div>
        </section>
        <button className="btn primary" disabled={isSubmitting}>Save settings</button>
      </form>

      <section className="card" style={{ marginTop: '1rem' }}>
        <h2>Server address</h2>
        <p className="small">Links are built from <code>{data.baseUrl}</code>{data.publicUrlSet ? ' (set by PUBLIC_URL).' : ' (detected from your browser — set PUBLIC_URL in .env to fix it).'}</p>
      </section>
      <section className="card">
        <h2>Backup</h2>
        <p className="small">A copy of the database is saved daily in <code>data/backups/</code> (last 30 kept). You can also download one now.</p>
        <a className="btn" href="/api/backup">Download backup</a>
      </section>
    </div>
  );
}
