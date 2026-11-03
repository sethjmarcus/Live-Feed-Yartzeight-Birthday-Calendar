# Architecture

An **Express 5 JSON API** and a **React single-page app**, both in TypeScript, sharing one core of domain code.

```
 Phone calendars ──GET /feed/<token>.ics──┐
                                          ▼
 React app (client/) ──/api JSON──►  Express (server/)
        │                                 │
        └──────── imports ────────► shared/  ◄── imports ───┘
                                     Hebcal adapter, event-type strategies,
                                     occurrence rules, permissions, Zod schemas, API types
```

## Folders

```
shared/                      Used by BOTH server and browser
  hebrewCalendar.ts          Adapter over @hebcal/hdate (the only file importing it)
  eventTypes.ts              Strategy objects: birthday / anniversary / yahrzeit / other
  occurrences.ts             When each event falls, and what its calendar entry says
  permissions.ts             Permissions, roles, per-calendar can()/canEditEvent() policy, resolveAccess()
  schemas.ts                 Zod schemas for every form/request (validated on both sides)
  api.ts                     JSON shapes exchanged with the browser

server/
  index.ts                   Entry point
  app.ts                     Composition root: builds and wires everything
  config.ts                  Environment settings
  db/                        better-sqlite3 + Kysely, migrations, Unit of Work, v1 import
  http/                      Security (helmet, CSRF, rate limits), server-side sessions, guards, errors
  features/                  One folder per feature:
    auth/                      session, setup, sign-in, invites
    calendars/                 repository · service · routes (calendars and their members)
    events/                    repository · service · routes
    users/                     repository · service · routes (own account + accounts)
    feed/                      .ics builder (ical-generator) · upcoming list · public routes
    hebcal/                    Hebcal REST API gateway + cache (+ offline fallback)
    settings/                  settings, activity log, backups
    audit/                     activity-log repository

client/src/
  main.tsx, routes.tsx       App bootstrap and the page table
  api.ts, session.ts         Fetch wrapper (CSRF header), current-user hook
  components/                Layout, guards, toast, small UI pieces
  pages/                     One file per page (or page group)

test/                        Vitest: shared core, API end-to-end, calendars, security, upgrades
```

## Patterns, and why

| Pattern | Where | Why |
|---|---|---|
| **Feature modules** | `server/features/*` | Everything about events (SQL, rules, routes) lives in one folder. |
| **Shared kernel** | `shared/` | Date rules, permissions and validation are written once. The browser's live date preview and the server's feed use the same code, and the forms show the same messages the API enforces. |
| **Strategy** | `shared/eventTypes.ts` | All per-type behaviour (labels, which Hebcal rule applies, title wording, evening start) is one object per type. A new type is one new entry. |
| **Adapter** | `shared/hebrewCalendar.ts` | Hebcal is used in exactly one file, so the rest of the app speaks ISO dates and `{year, month, day}`. |
| **Gateway + cache-aside + fallback** | `features/hebcal/hebcalGateway.ts` | The Hebcal web API is cached in SQLite and refreshed in the background, so feeds never wait on it. If it has never been reached, holidays come from `@hebcal/core` offline. |
| **Repository** | `features/*/…Repository.ts` | All SQL (via Kysely) is in repositories, and services see plain objects. Moving to Postgres for cloud hosting means swapping the dialect. |
| **Unit of Work** | `db/unitOfWork.ts` | A service changes an event and writes its audit entry in one transaction. |
| **Service layer** | `features/*/…Service.ts` | Each use case validates, checks permissions, persists and audits in one place. Routes stay a few lines each. |
| **Composition root / DI** | `server/app.ts` | Objects are created once and passed in. Tests build the same graph with a fake Hebcal API and a temp folder. |
| **Middleware pipeline** | `server/http/` | Security headers, sessions, CSRF, auth guards and error handling are separate steps. |
| **Policy object** | `shared/permissions.ts` | Who may do what is decided in one place, by pure functions. The server enforces them; the browser uses the same functions to show or hide buttons. |
| **Audit log** | `audit_log` table | Every change records who did it, when, and a field-by-field diff. This powers "Added by", history and the activity page. |

## Calendars and who sees what

```
users ──< calendar_members >── calendars ──< events
           (permissions, in_feed)
```

- **Per calendar:** each person has a set of permissions in each calendar they belong to, normally one of the roles Subscriber, Viewer, Contributor, Editor or Owner. "Manage" (Owner) covers members, roles, the calendar's activity log and restoring deleted events.
- **App admin:** a flag on the account. App admins create calendars and accounts, and own settings and backups.
- **Resolving access:** when a request arrives, `CalendarService.actorFor()` turns the person's memberships into a list of calendars with what they may do in each (`resolveAccess()` in `shared/permissions.ts`). Services check that list for the calendar a request is about.
- **`APP_ADMIN_ACCESS`:**
  - `full` (default, one family): app admins manage every calendar.
  - `metadata` (unrelated families on one server): app admins see only each calendar's name and counts, the activity log of calendars they belong to, and site-wide entries. Calendar owners then can't browse the list of everyone's names.
  - Either way, whoever runs the server can read the database. That's inherent to feeds being built on the server.
- **Feeds:** one link per person, built from every calendar they subscribe to (`in_feed`), so a calendar joined later reaches their phone without a new setup.
- **Activity log:** each entry carries the calendar it belongs to, or none for site-wide entries (accounts, settings). Each viewer sees only the entries their access covers.

## Libraries

| Concern | Library |
|---|---|
| HTTP | Express 5 |
| Security | helmet, cookie-session, csrf-csrf, express-rate-limit |
| Database | better-sqlite3 + Kysely (migrations, typed queries) |
| Validation | Zod (shared by client and server) |
| Hebrew calendar | @hebcal/hdate (dates, rules), @hebcal/core (offline holidays) |
| Calendar feed | ical-generator |
| Logging | pino |
| Front end | React 19, React Router, TanStack Query, react-hook-form, qrcode.react |
| Build & tests | Vite, TypeScript, tsx, Vitest, supertest |

## A request, end to end: adding a yahrzeit

1. **Browser preview:** the form validates with `eventInputSchema` (shared). While you type, the Hebrew-to-English preview is computed in the browser by the shared Hebcal adapter.
2. **Request:** `POST /api/events` goes through helmet, the session, a CSRF check, and loading the user with their access to each calendar.
3. **Validation:** the route parses the body with the same Zod schema.
4. **Save:** `EventService.create` checks that the person may add to the chosen calendar, and fills in the date in the other calendar system (`normalizeEvent`). It then writes the event and its audit entry in one Unit-of-Work transaction.
5. **Feed:** at its next sync, each subscriber's phone fetches `/feed/<token>.ics`. `FeedService` collects the events of that person's calendars. It asks the yahrzeit strategy for each year's date, which uses Hebcal's yahrzeit rules, and renders the feed with ical-generator.
