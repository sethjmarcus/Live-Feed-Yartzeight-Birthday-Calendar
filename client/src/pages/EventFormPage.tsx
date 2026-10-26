import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useSession } from '../session';
import { useToast } from '../components/Layout';
import { applyServerErrors } from '../forms';
import { Field, FormError, Loading, nameOf } from '../components/ui';
import { eventInputSchema, type EventInput, type ValidEventInput } from '../../../shared/schemas';
import { BASIS_KEYS, BASIS_LABELS, EVENT_TYPES, EVENT_TYPE_KEYS } from '../../../shared/eventTypes';
import { displayName } from '../../../shared/occurrences';
import { canDeleteEvent } from '../../../shared/permissions';
import { formatDateTime } from '../../../shared/format';
import * as cal from '../../../shared/hebrewCalendar';
import type { EventDTO, NameMap } from '../../../shared/api';

const EMPTY: EventInput = {
  type: 'birthday', name: '', title: '', hebrewName: '', notes: '', basis: 'gregorian',
  dateEntry: 'gregorian', gDate: '', afterSunset: false, hDay: undefined, hMonth: 7, hYear: undefined,
};

function toFormValues(ev: EventDTO): EventInput {
  const hebrew = ev.dateEntry === 'hebrew';
  return {
    type: ev.type, name: ev.name, title: ev.title, hebrewName: ev.hebrewName, notes: ev.notes, basis: ev.basis,
    dateEntry: ev.dateEntry, afterSunset: ev.afterSunset,
    gDate: hebrew ? '' : ev.gDate,
    hDay: hebrew ? ev.hDay : undefined, hMonth: hebrew ? ev.hMonth : 7, hYear: hebrew ? ev.hYear : undefined,
  };
}

export function EventFormPage() {
  const { id } = useParams();
  const isNew = !id;
  const existing = useQuery({
    queryKey: ['event', id],
    queryFn: () => api.get<{ event: EventDTO; names: NameMap }>(`/api/events/${id}`),
    enabled: !isNew,
    retry: false,
  });
  if (!isNew && existing.isPending) return <Loading />;
  if (!isNew && existing.isError) {
    return <section className="card narrow-page"><h1>Can't edit</h1><p>{existing.error.message}</p><Link className="btn" to="/events">Back</Link></section>;
  }
  return <EventForm event={existing.data?.event} names={existing.data?.names ?? {}} />;
}

function EventForm({ event, names }: { event?: EventDTO; names: NameMap }) {
  const isNew = !event;
  const { user, can } = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState('');
  const [basisTouched, setBasisTouched] = useState(!isNew);

  const form = useForm<EventInput, unknown, ValidEventInput>({
    resolver: zodResolver(eventInputSchema),
    defaultValues: event ? toFormValues(event) : EMPTY,
  });
  const { register, handleSubmit, setValue, control, formState: { errors, isSubmitting } } = form;
  const type = useWatch({ control, name: 'type' });
  const dateEntry = useWatch({ control, name: 'dateEntry' });
  const strategy = EVENT_TYPES[type];

  // New events: follow the type's usual calendar until the user picks one.
  useEffect(() => {
    if (!basisTouched) setValue('basis', strategy.defaultBasis);
  }, [type, basisTouched, setValue, strategy.defaultBasis]);

  const onSubmit = handleSubmit(async values => {
    try {
      const res = isNew
        ? await api.post<{ event: EventDTO }>('/api/events', values)
        : await api.put<{ event: EventDTO; changed: boolean }>(`/api/events/${event.id}`, values);
      await qc.invalidateQueries();
      toast({ type: 'ok', msg: isNew ? `Added “${displayName(res.event)}”. It will appear on everyone's calendar at their next sync.` : `Saved “${displayName(res.event)}”.` });
      navigate('/events');
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  });

  const remove = async () => {
    if (!event || !confirm("Delete this event? It will disappear from everyone's calendar.")) return;
    try {
      await api.del(`/api/events/${event.id}`);
      await qc.invalidateQueries();
      toast({ type: 'ok', msg: `Deleted “${displayName(event)}”.${can('admin') ? ' Admins can restore it from “Show deleted”.' : ''}` });
      navigate('/events');
    } catch (err) { setError(applyServerErrors(err, form.setError)); }
  };

  return (
    <section className="card narrow-page">
      <h1>{isNew ? 'Add an event' : 'Edit event'}</h1>
      {!isNew && can('admin') && (
        <p className="muted small">
          Added by <strong>{nameOf(names, event.createdBy)}</strong> on {formatDateTime(event.createdAt)}
          {event.updatedAt !== event.createdAt && <> · last edited by <strong>{nameOf(names, event.updatedBy)}</strong> on {formatDateTime(event.updatedAt)}</>}
          {' · '}<Link to={`/events/${event.id}/history`}>history</Link>
        </p>
      )}
      <FormError message={error} />
      <form onSubmit={onSubmit} className="stack" noValidate>
        <fieldset className="types">
          <legend>Type</legend>
          {EVENT_TYPE_KEYS.map(k => (
            <label key={k} className={`type-pick t-${k}`}>
              <input type="radio" value={k} {...register('type')} />
              <span>{EVENT_TYPES[k].emoji} {EVENT_TYPES[k].label}</span>
            </label>
          ))}
        </fieldset>

        {strategy.nameLabel === null ? (
          <Field label="Title" error={errors.title?.message}><input {...register('title')} placeholder="e.g. Family reunion" aria-invalid={!!errors.title} /></Field>
        ) : (
          <>
            <Field label={strategy.nameLabel} error={errors.name?.message}><input {...register('name')} placeholder="e.g. Sarah Cohen" aria-invalid={!!errors.name} /></Field>
            <Field label="Hebrew name" hint="(optional)"><input {...register('hebrewName')} dir="auto" placeholder="e.g. שרה בת אברהם" /></Field>
          </>
        )}

        <fieldset>
          <legend>Date — enter it whichever way you know it</legend>
          <div className="seg">
            <label><input type="radio" value="gregorian" {...register('dateEntry')} /><span>English date</span></label>
            <label><input type="radio" value="hebrew" {...register('dateEntry')} /><span>Hebrew date</span></label>
          </div>
          {dateEntry === 'gregorian' ? (
            <div className="d-greg">
              <input type="date" {...register('gDate')} aria-label="English date" aria-invalid={!!errors.gDate} />
              {errors.gDate && <span className="field-error">{errors.gDate.message}</span>}
              <label className="check"><input type="checkbox" {...register('afterSunset')} /> It happened after sunset (Hebrew date is the next day)</label>
            </div>
          ) : (
            <>
              <div className="d-heb row">
                <input type="number" min={1} max={30} placeholder="Day" aria-label="Hebrew day" {...register('hDay')} aria-invalid={!!errors.hDay} />
                <select aria-label="Hebrew month" {...register('hMonth')}>
                  {cal.HEBREW_MONTH_CHOICES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <input type="number" min={3001} max={6999} placeholder={`Year e.g. ${cal.hebrewFromAbs(cal.todayAbs()).year}`} aria-label="Hebrew year" {...register('hYear')} />
              </div>
              {errors.hDay && <span className="field-error">{errors.hDay.message}</span>}
            </>
          )}
          <DatePreview control={control} />
        </fieldset>

        <fieldset>
          <legend>Repeat each year on</legend>
          <div className="seg wrap">
            {BASIS_KEYS.map(k => (
              <label key={k}><input type="radio" value={k} {...register('basis', { onChange: () => setBasisTouched(true) })} /><span>{BASIS_LABELS[k]}</span></label>
            ))}
          </div>
        </fieldset>

        <Field label="Notes" hint="(optional, shown in the calendar entry)"><textarea rows={3} {...register('notes')} /></Field>

        <div className="row">
          <button className="btn primary" disabled={isSubmitting}>{isNew ? 'Add event' : 'Save changes'}</button>
          <Link className="btn ghost" to="/events">Cancel</Link>
        </div>
      </form>
      {!isNew && canDeleteEvent(user, event) && (
        <div className="danger-zone"><button type="button" className="btn danger" onClick={remove}>Delete event</button></div>
      )}
    </section>
  );
}

/** Shows the date in the other calendar as you type — computed in the browser with Hebcal. */
function DatePreview({ control }: { control: Control<EventInput, unknown, ValidEventInput> }) {
  const [dateEntry, gDate, afterSunset, hDay, hMonth, hYear] = useWatch({ control, name: ['dateEntry', 'gDate', 'afterSunset', 'hDay', 'hMonth', 'hYear'] });
  if (dateEntry === 'gregorian') {
    if (!cal.isValidIso(gDate)) return null;
    const h = cal.formatHebrew(cal.hebrewFromIso(gDate!, !!afterSunset));
    return <div className="preview">= {h.en} <span className="heb" lang="he" dir="rtl">{h.he}</span></div>;
  }
  const h = { year: Number(hYear), month: Number(hMonth), day: Number(hDay) };
  if (!hDay || !hYear || String(hYear).length !== 4) return null;
  const problem = cal.hebrewDateProblem(h);
  if (problem) return <div className="preview err">{problem}</div>;
  const iso = cal.isoFromHebrew(h);
  return <div className="preview">= {cal.weekday(iso)} {cal.formatGregorian(iso)}</div>;
}
