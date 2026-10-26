/**
 * Small shared UI pieces.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import * as cal from '../../../shared/hebrewCalendar';
import { formatDateTime } from '../../../shared/format';
import { EVENT_TYPES, type EventType } from '../../../shared/eventTypes';
import type { AuditEntryDTO, NameMap } from '../../../shared/api';

export function HebrewDate({ date }: { date: cal.HebrewDate }) {
  const f = cal.formatHebrew(date);
  return <><span className="hdate">{f.en}</span> <span className="heb hdate" lang="he" dir="rtl">{f.he}</span></>;
}

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={className}>
      <span>{label}{hint && <> <span className="muted">{hint}</span></>}</span>
      {children}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  return message ? <div className="flash error" role="alert">{message}</div> : null;
}

export function Loading() { return <div className="loading">Loading…</div>; }

export function TypeTag({ type }: { type: EventType }) {
  const t = EVENT_TYPES[type];
  return <span className={`tag t-${type}`}>{t.emoji} {t.label}</span>;
}

export function CopyField({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); } catch { /* clipboard unavailable (http) — field is selectable */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="sub-url">
      <label>{label}<input value={value} readOnly onFocus={e => e.currentTarget.select()} /></label>
      <button type="button" className="btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy'}</button>
    </div>
  );
}

export const nameOf = (names: NameMap, id: number | null) => (id ? names[id] ?? `user #${id}` : '—');

const ACTIONS: Record<string, string> = {
  'event.create': 'added', 'event.update': 'edited', 'event.delete': 'deleted', 'event.restore': 'restored',
  'user.create': 'created user', 'user.update': 'updated user', 'user.invite': 'issued a setup link for',
  'user.feedReset': 'reset the feed link of', 'user.activate': 'completed account setup',
  'user.password': 'changed their password', 'settings.update': 'changed settings', setup: 'set up the calendar',
};
export const actionLabel = (a: string) => ACTIONS[a] ?? a;

export function ActivityLine({ entry, names }: { entry: AuditEntryDTO; names: NameMap }) {
  return (
    <li>
      <strong>{nameOf(names, entry.actorId)}</strong> {actionLabel(entry.action)}{' '}
      {entry.eventId && <Link to={`/events/${entry.eventId}/history`}>{entry.label || 'event'}</Link>}
      {entry.targetUserId && <strong>{nameOf(names, entry.targetUserId)}</strong>}
      {!entry.eventId && entry.label && <span className="muted"> ({entry.label})</span>}
      <span className="muted"> · {formatDateTime(entry.at)}</span>
      {entry.changes.length > 0 && <div className="small muted">changed {entry.changes.map(c => c.field.replace('permission:', '')).join(', ')}</div>}
    </li>
  );
}
