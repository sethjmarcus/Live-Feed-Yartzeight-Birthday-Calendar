/**
 * Small shared UI pieces.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import * as cal from '../../../shared/hebrewCalendar';
import { formatDateTime } from '../../../shared/format';
import { EVENT_TYPES, type EventType } from '../../../shared/eventTypes';
import type { AuditEntryDTO, CalendarNameMap, NameMap } from '../../../shared/api';
import type { CalendarAccess } from '../../../shared/permissions';
import { PERMISSIONS, ROLES, ROLE_KEYS, roleOf, type Permission } from '../../../shared/permissions';

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
  'user.create': 'invited', 'user.update': 'updated the account of', 'user.invite': 'issued a setup link for',
  'user.feedReset': 'reset the feed link of', 'user.activate': 'completed account setup',
  'user.password': 'changed their password', 'settings.update': 'changed settings', setup: 'set up the site',
  'calendar.create': 'created calendar', 'calendar.rename': 'renamed the calendar to', 'calendar.delete': 'deleted calendar',
  'member.add': 'added', 'member.update': 'changed the role of', 'member.remove': 'removed',
};
export const actionLabel = (a: string) => ACTIONS[a] ?? a;

export function ActivityLine({ entry, names, calendarNames }: { entry: AuditEntryDTO; names: NameMap; calendarNames?: CalendarNameMap }) {
  const calendar = entry.calendarId ? calendarNames?.[entry.calendarId] : undefined;
  return (
    <li>
      <strong>{nameOf(names, entry.actorId)}</strong> {actionLabel(entry.action)}{' '}
      {entry.eventId && <Link to={`/events/${entry.eventId}/history`}>{entry.label || 'event'}</Link>}
      {entry.targetUserId && <strong>{nameOf(names, entry.targetUserId)}</strong>}
      {!entry.eventId && entry.label && <span className="muted"> ({entry.label})</span>}
      {calendar && <span className="tag cal">{calendar}</span>}
      <span className="muted"> · {formatDateTime(entry.at)}</span>
      {entry.changes.length > 0 && <div className="small muted">changed {entry.changes.map(c => c.field.replace('permission:', '')).join(', ')}</div>}
    </li>
  );
}

/** "All calendars" or one — shown only when there is more than one to choose from. */
export function CalendarPicker({ calendars, value, onChange }: { calendars: CalendarAccess[]; value: number | null; onChange: (id: number | null) => void }) {
  if (calendars.length < 2) return null;
  return (
    <select aria-label="Calendar" value={value ?? ''} onChange={e => onChange(Number(e.target.value) || null)} style={{ width: 'auto' }}>
      <option value="">All calendars</option>
      {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

export function CalendarTag({ name }: { name?: string }) {
  return name ? <span className="tag cal">{name}</span> : null;
}

/**
 * Pick a role, or "Custom…" to tick individual permissions. Controlled: `value` is the
 * permission list.
 */
export function PermissionsEditor({ value, onChange, disabled, id }: { value: Permission[]; onChange: (perms: Permission[]) => void; disabled?: boolean; id?: string }) {
  const role = roleOf(value);
  const [custom, setCustom] = useState(role === null);
  const toggle = (p: Permission) => onChange(value.includes(p) ? value.filter(x => x !== p) : PERMISSIONS.map(x => x.key).filter(k => k === p || value.includes(k)));
  return (
    <div className="perm-editor">
      <select id={id} aria-label="Role" value={custom ? 'custom' : role ?? 'custom'} disabled={disabled}
        onChange={e => {
          if (e.target.value === 'custom') { setCustom(true); return; }
          setCustom(false);
          onChange([...ROLES[e.target.value as keyof typeof ROLES].perms]);
        }}>
        {ROLE_KEYS.map(k => <option key={k} value={k}>{ROLES[k].label}</option>)}
        <option value="custom">Custom…</option>
      </select>
      {custom && (
        <div className="perm-grid">
          {PERMISSIONS.map(p => (
            <label key={p.key} className="check perm">
              <input type="checkbox" checked={value.includes(p.key)} disabled={disabled} onChange={() => toggle(p.key)} />
              <span><strong>{p.label}</strong><br /><span className="small muted">{p.help}</span></span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export const ROLE_HELP = 'Subscriber: phone feed only · Viewer: + browse · Contributor: + add, edit/delete own · Editor: + edit/delete anyone’s · Owner: + manage members';
