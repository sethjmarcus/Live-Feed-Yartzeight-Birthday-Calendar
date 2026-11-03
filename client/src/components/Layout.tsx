/**
 * App shell (header, navigation, toast) and route guards.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { api } from '../api';
import { useRefreshSession, useSession } from '../session';
import type { Permission } from '../../../shared/permissions';
import { Loading } from './ui';

// ---------------------------------------------------------------- toast
type Toast = { type: 'ok' | 'error'; msg: string } | null;
const ToastContext = createContext<(t: Toast) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastContext.Provider value={setToast}>
      {children}
      {toast && <div className={`flash toast ${toast.type}`} role="status" onClick={() => setToast(null)}>{toast.msg}</div>}
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------- layout
export function Layout({ bare = false }: { bare?: boolean }) {
  const { user, session, can, isAppAdmin } = useSession();
  const refresh = useRefreshSession();
  const navigate = useNavigate();
  const siteName = session?.siteName ?? 'Calendar';
  useEffect(() => { document.title = siteName; }, [siteName]);

  const signOut = useCallback(async () => {
    await api.post('/api/logout');
    await refresh();
    navigate('/login');
  }, [refresh, navigate]);

  const nav: [string, string, boolean][] = [
    ['/', 'Upcoming', can('view')],
    ['/events', 'All events', can('view')],
    ['/events/new', '+ Add', can('add')],
    ['/subscribe', 'Subscribe', !!user?.memberships.length],
    ['/calendars', 'Calendars', isAppAdmin || can('manage') || (user?.calendars.length ?? 0) > 1],
    ['/admin/users', 'People', isAppAdmin],
    ['/admin/activity', 'Activity', isAppAdmin || can('manage')],
    ['/admin/settings', 'Settings', isAppAdmin],
  ];

  return (
    <>
      <header className="top">
        <Link className="brand" to="/"><img src="/icon.svg" alt="" width={28} height={28} /><span>{siteName}</span></Link>
        {user && !bare && (
          <>
            <nav className="nav">
              {nav.filter(n => n[2]).map(([to, label]) => (
                <NavLink key={to} to={to} end={to === '/' || to === '/events'} className={({ isActive }) => (isActive ? 'on' : '')}>{label}</NavLink>
              ))}
            </nav>
            <div className="me">
              <NavLink to="/account" className={({ isActive }) => (isActive ? 'on' : '')}>{user.displayName}</NavLink>
              <button type="button" className="linklike" onClick={signOut}>Sign out</button>
            </div>
          </>
        )}
      </header>
      <main><Outlet /></main>
      <footer className="foot">Hebrew dates by <a href="https://www.hebcal.com/" target="_blank" rel="noopener noreferrer">Hebcal</a></footer>
    </>
  );
}

// ---------------------------------------------------------------- guards
/**
 * Renders children only for a signed-in user — optionally one holding a permission in at
 * least one calendar, or an app admin. (The server checks the specific calendar.)
 */
export function RequireUser({ perm, children }: { perm?: Permission | 'appAdmin'; children: ReactNode }) {
  const { user, session, isPending, can, isAppAdmin } = useSession();
  const location = useLocation();
  if (isPending) return <Loading />;
  if (session?.needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (perm && !(perm === 'appAdmin' ? isAppAdmin : can(perm))) {
    return (
      <section className="card narrow-card">
        <h1>Not allowed</h1>
        <p>You don't have permission for that. Ask the admin if you need access.</p>
        <Link className="btn" to="/">Home</Link>
      </section>
    );
  }
  return <>{children}</>;
}

export function NotFound() {
  return (
    <section className="card">
      <h1>Not found</h1>
      <p>That page doesn't exist.</p>
      <Link className="btn" to="/">Home</Link>
    </section>
  );
}
