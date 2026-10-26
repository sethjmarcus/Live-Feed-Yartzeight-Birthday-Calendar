/**
 * The current session (who's signed in), shared through TanStack Query's cache.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from './api';
import type { SessionDTO, UserDTO } from '../../shared/api';
import { can as canDo, type Permission } from '../../shared/permissions';

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
    can: (perm: Permission) => canDo(user, perm),
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

export type { UserDTO };
