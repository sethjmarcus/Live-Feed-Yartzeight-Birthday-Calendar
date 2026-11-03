/**
 * Every page of the app, in one table.
 */
import type { RouteObject } from 'react-router';
import { Layout, NotFound, RequireUser } from './components/Layout';
import { SetupPage, LoginPage, InvitePage } from './pages/AuthPages';
import { UpcomingPage } from './pages/UpcomingPage';
import { EventsPage } from './pages/EventsPage';
import { EventFormPage } from './pages/EventFormPage';
import { EventHistoryPage } from './pages/EventHistoryPage';
import { SubscribePage, PublicSubscribePage } from './pages/SubscribePages';
import { AccountPage } from './pages/AccountPage';
import { UsersPage, NewUserPage, UserDetailPage } from './pages/UserPages';
import { CalendarsPage, CalendarDetailPage } from './pages/CalendarPages';
import { ActivityPage } from './pages/ActivityPage';
import { SettingsPage } from './pages/SettingsPage';

export const routes: RouteObject[] = [
  {
    element: <Layout bare />,
    children: [
      { path: '/setup', element: <SetupPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/invite/:token', element: <InvitePage /> },
      { path: '/s/:token', element: <PublicSubscribePage /> },
    ],
  },
  {
    element: <Layout />,
    children: [
      { path: '/', element: <RequireUser><UpcomingPage /></RequireUser> },
      { path: '/events', element: <RequireUser perm="view"><EventsPage /></RequireUser> },
      { path: '/events/new', element: <RequireUser perm="add"><EventFormPage /></RequireUser> },
      { path: '/events/:id/edit', element: <RequireUser><EventFormPage /></RequireUser> },
      { path: '/events/:id/history', element: <RequireUser perm="manage"><EventHistoryPage /></RequireUser> },
      { path: '/subscribe', element: <RequireUser><SubscribePage /></RequireUser> },
      { path: '/account', element: <RequireUser><AccountPage /></RequireUser> },
      { path: '/calendars', element: <RequireUser><CalendarsPage /></RequireUser> },
      { path: '/calendars/:id', element: <RequireUser perm="manage"><CalendarDetailPage /></RequireUser> },
      { path: '/admin/users', element: <RequireUser perm="appAdmin"><UsersPage /></RequireUser> },
      { path: '/admin/users/new', element: <RequireUser perm="appAdmin"><NewUserPage /></RequireUser> },
      { path: '/admin/users/:id', element: <RequireUser perm="appAdmin"><UserDetailPage /></RequireUser> },
      { path: '/admin/users/:id/subscribe', element: <RequireUser perm="appAdmin"><SubscribePage /></RequireUser> },
      { path: '/admin/activity', element: <RequireUser><ActivityPage /></RequireUser> },
      { path: '/admin/settings', element: <RequireUser perm="appAdmin"><SettingsPage /></RequireUser> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
