import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api';
import { subscribable, useSession } from '../session';
import { useToast } from '../components/Layout';
import { CopyField, Loading } from '../components/ui';
import { EVENT_TYPES, EVENT_TYPE_KEYS, HEBCAL_FEED_TYPES } from '../../../shared/eventTypes';
import { feedSettingsSchema, type FeedPrefs } from '../../../shared/schemas';
import { z } from 'zod';
import { formatDateTime } from '../../../shared/format';
import type { FeedLinks, SubscriptionDTO } from '../../../shared/api';

const ALARM_LABELS: Record<FeedPrefs['alarm'], string> = {
  none: 'No reminders',
  morning: 'Morning of (9:00)',
  daybefore: 'Day before (9:00)',
  both: 'Day before and morning of',
  week: 'One week before (9:00)',
};

/** /subscribe (your own) or /admin/users/:id/subscribe (someone else's). */
export function SubscribePage() {
  const { id } = useParams();
  const { user } = useSession();
  const url = id ? `/api/users/${id}/subscription` : '/api/me/subscription';
  const { data, isPending } = useQuery({ queryKey: ['subscription', id ?? 'me'], queryFn: () => api.get<SubscriptionDTO>(url) });
  if (isPending || !data) return <Loading />;
  const isOwn = data.user.id === user?.id;
  const whose = isOwn ? 'your' : 'their';

  return (
    <>
      <section className="card">
        <h1>{isOwn ? 'Add the calendar to your phone' : `Calendar link for ${data.user.displayName}`}</h1>
        <p>Do this <strong>once</strong>. After that, every event anyone adds or edits shows up automatically on {whose} phone —
          including calendars {isOwn ? 'you join' : 'they join'} later.</p>
        {data.links.isLocal && (
          <div className="flash warn">
            <strong>Heads-up:</strong> this server's address is <code>{new URL(data.links.https).origin}</code>, which only works on your home network.
            iPhones and the ICSx⁵ Android app sync while on that Wi-Fi. Google Calendar needs a public HTTPS address (set <code>PUBLIC_URL</code> once you have a tunnel).
          </div>
        )}
        <PhoneOptions links={data.links} detailed />
        <CopyField label="Calendar address" value={data.links.https} />
        <div className="qr-wrap">
          <QRCodeSVG value={data.links.pageUrl} size={140} level="M" />
          <p className="small muted">Scan with the phone's camera to open the one-tap subscribe page there.<br />
            {isOwn ? 'Keep this address private — anyone with it can see the calendar.' : 'Or send them the page link below. Keep it private.'}</p>
        </div>
        {!isOwn && <CopyField label="Subscribe page link" value={data.links.pageUrl} />}
      </section>
      <FeedPrefsForm data={data} url={id ? `/api/users/${id}/feed-prefs` : '/api/me/feed-prefs'} whose={whose} />
    </>
  );
}

type FeedForm = z.input<typeof feedSettingsSchema>;

function FeedPrefsForm({ data, url, whose }: { data: SubscriptionDTO; url: string; whose: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const calendars = subscribable(data.user);
  const { register, handleSubmit, formState: { isSubmitting } } = useForm<FeedForm, unknown, z.output<typeof feedSettingsSchema>>({
    resolver: zodResolver(feedSettingsSchema),
    // Checkbox groups hold strings; the schema turns them back into numbers.
    defaultValues: { ...data.user.feedPrefs, calendars: calendars.filter(m => m.inFeed).map(m => String(m.calendarId)) as unknown as number[] },
  });
  const onSubmit = handleSubmit(async prefs => {
    await api.put(url, prefs);
    await qc.invalidateQueries();
    toast({ type: 'ok', msg: 'Saved. The phone picks up the change at its next sync.' });
  });
  return (
    <section className="card">
      <h2>What {whose} feed includes</h2>
      <form onSubmit={onSubmit} className="stack">
        {calendars.length > 1 && (
          <fieldset>
            <legend>Calendars</legend>
            <div className="row wrap">
              {calendars.map(m => <label key={m.calendarId} className="check"><input type="checkbox" value={m.calendarId} {...register('calendars')} /> {m.calendarName}</label>)}
            </div>
          </fieldset>
        )}
        {calendars.length === 0 && <p className="small muted">{whose === 'your' ? "You aren't" : "They aren't"} subscribed to any calendar yet, so the feed is empty.</p>}
        <div className="row wrap">
          {EVENT_TYPE_KEYS.map(k => <label key={k} className="check"><input type="checkbox" value={k} {...register('types')} /> {EVENT_TYPES[k].emoji} {EVENT_TYPES[k].label}</label>)}
        </div>
        <div className="row wrap">
          {(Object.keys(HEBCAL_FEED_TYPES) as (keyof typeof HEBCAL_FEED_TYPES)[]).map(k => (
            <label key={k} className="check"><input type="checkbox" value={k} {...register('types')} /> {HEBCAL_FEED_TYPES[k].emoji} {HEBCAL_FEED_TYPES[k].label}</label>
          ))}
        </div>
        {!data.candlesAvailable && <p className="small muted">Candle-lighting times appear once an admin sets a location under Settings.</p>}
        <label>Reminders
          <select {...register('alarm')}>
            {Object.entries(ALARM_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        <p className="small muted">Reminders work in Apple Calendar and ICSx⁵; Google Calendar ignores them on subscribed calendars. Yahrzeit reminders fire at 4 pm the day before, in time for candle-lighting.</p>
        <button className="btn" disabled={isSubmitting}>Save</button>
      </form>
      <p className="small muted">
        {data.user.lastFeedFetch
          ? <>Last synced by a calendar app: {formatDateTime(data.user.lastFeedFetch)}{data.user.lastFeedAgent && ` (${data.user.lastFeedAgent})`}</>
          : 'No calendar app has synced this feed yet.'}
      </p>
    </section>
  );
}

/** /s/:token — the one-tap page reached by QR code or shared link; no sign-in needed. */
export function PublicSubscribePage() {
  const { token } = useParams();
  const { data, isPending, error } = useQuery({
    queryKey: ['public-subscribe', token],
    queryFn: () => api.get<{ displayName: string; calendarName: string; calendars: string[]; links: FeedLinks }>(`/api/public/subscribe/${token}`),
    retry: false,
  });
  if (isPending) return <Loading />;
  if (error) return <section className="card narrow-page"><h1>Link not valid</h1><p>{error.message}</p></section>;
  return (
    <section className="card narrow-page">
      <h1>Add “{data.calendarName}” to your phone</h1>
      <p>Hi {data.displayName}! Tap the button for your phone. You only do this once.</p>
      {data.calendars.length > 1 && <p className="small muted">Includes: {data.calendars.join(', ')}.</p>}
      <PhoneOptions links={data.links} />
      <CopyField label="Calendar address" value={data.links.https} />
    </section>
  );
}

function PhoneOptions({ links, detailed = false }: { links: FeedLinks; detailed?: boolean }) {
  return (
    <div className="sub-grid">
      <div className="sub-opt">
        <h2>📱 iPhone / iPad</h2>
        <a className="btn primary big" href={links.webcal}>Add to Apple Calendar</a>
        {detailed ? (
          <ol className="small">
            <li>Open this page <strong>on the iPhone</strong> (scan the QR code) and tap the button.</li>
            <li>Tap <em>Subscribe</em>, then <em>Add</em>.</li>
            <li>Optional: Settings → Calendar → Accounts → Subscribed Calendars → Fetch: <em>Every 15 minutes</em>.</li>
          </ol>
        ) : <p className="small">Tap <em>Subscribe</em>, then <em>Add</em>.</p>}
      </div>
      <div className="sub-opt">
        <h2>🤖 Android</h2>
        <a className="btn primary big" href={links.google} target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>
        {detailed && (
          <ol className="small">
            <li>Opens Google Calendar on the web — tap <em>Add</em>. It then appears in the phone's Google Calendar (Google refreshes every few hours).</li>
            <li>Make sure it's ticked in the calendar app's ☰ menu.</li>
          </ol>
        )}
        <p className="small"><strong>Faster updates / home network:</strong> install the free{' '}
          <a href="https://play.google.com/store/apps/details?id=at.bitfire.icsdroid" target="_blank" rel="noopener noreferrer">ICSx⁵ app</a>, then tap{' '}
          <a href={links.webcal}>this link</a> and set sync to hourly.</p>
      </div>
    </div>
  );
}
