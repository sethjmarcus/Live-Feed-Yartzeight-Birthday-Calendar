/**
 * The current session (who's signed in, and what they may do in each calendar),
 * shared through TanStack Query's cache.
 */
import { useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from './api';
import type { SessionDTO, SessionUserDTO, UserDTO } from '../../shared/api';
import { calendarsWhere, can as canIn, canSomewhere, isAppAdmin, type Permission } from '../../shared/permissions';

export const SESSION_KEY = ['session'];

export function useSession() {
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: async () => {
      const s = await api.get<SessionDTO>('/api/session');
      setCsrfToken(s.csrfToken);
      return s;
    },
    staleTime: 60_000,
  });
  const user = query.data?.user ?? null;
  return {
    ...query,
    session: query.data,
    user,
    /** In one calendar, or (without an id) in at least one. */
    can: (perm: Permission, calendarId?: number) => (calendarId ? canIn(user, perm, calendarId) : canSomewhere(user, perm)),
    calendarsWhere: (perm: Permission) => calendarsWhere(user, perm),
    isAppAdmin: isAppAdmin(user),
  };
}

/** After sign-in / sign-out: forget all cached data and reload the session. */
export function useRefreshSession() {
  const qc = useQueryClient();
  return async () => {
    qc.removeQueries({ predicate: q => q.queryKey[0] !== 'session' });
    await qc.refetchQueries({ queryKey: SESSION_KEY });
  };
}

// ---------------------------------------------------------------- chosen calendar
// Which calendar the Upcoming and Events pages show (null = all). Remembered in this
// browser only; shared between pages so switching on one page switches everywhere.
const KEY = 'feedcal.calendar';
const listeners = new Set<() => void>();
let chosen: number | null = (() => {
  try { return Number(localStorage.getItem(KEY)) || null; } catch { return null; }
})();

function setChosen(id: number | null) {
  chosen = id;
  try { if (id) localStorage.setItem(KEY, String(id)); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  listeners.forEach(l => l());
}

/** The chosen calendar, if the user can still view it. */
export function useCalendarChoice(user: SessionUserDTO | null): [number | null, (id: number | null) => void] {
  const value = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => chosen);
  const valid = value && calendarsWhere(user, 'view').some(c => c.id === value) ? value : null;
  return [valid, setChosen];
}

/** Calendars whose events are in this person's phone feed. */
export const subscribable = (u: UserDTO) => u.memberships.filter(m => m.permissions.includes('subscribe') || m.permissions.includes('manage'));

export type { UserDTO };
