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
  permissions.ts             Permission list, presets, can()/canEditEvent() policy
  schemas.ts                 Zod schemas for every form/request (validated on both sides)
  api.ts                     JSON shapes exchanged with the browser

server/
  index.ts                   Entry point
  app.ts                     Composition root: builds and wires everything
  config.ts                  Environment settings
  db/                        better-sqlite3 + Kysely, migrations, Unit of Work, v1 import
  http/                      Security (helmet, sessions, CSRF, rate limits), guards, errors
  features/                  One folder per feature:
    auth/                      session, setup, sign-in, invites
    events/                    repository · service · routes
    users/                     repository · service · routes (own account + admin)
    feed/                      .ics builder (ical-generator) · upcoming list · public routes
    hebcal/                    Hebcal REST API gateway + cache (+ offline fallback)
    settings/                  settings, activity log, backups
    audit/                     activity-log repository

client/src/
  main.tsx, routes.tsx       App bootstrap and the page table
  api.ts, session.ts         Fetch wrapper (CSRF header), current-user hook
  components/                Layout, guards, toast, small UI pieces
  pages/                     One file per page (or page group)

test/                        Vitest: shared core + API end-to-end (fake Hebcal, v1 import)
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
| **Audit log** | `audit_log` table | Every change records who did it, when, and a field-by-field diff. This powers "Added by", history and the activity page. |

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
2. **Request:** `POST /api/events` goes through helmet, the session, a CSRF check and loading the user, then `requireUser('add')`.
3. **Validation:** the route parses the body with the same Zod schema.
4. **Save:** `EventService.create` fills in the other calendar's date (`normalizeEvent`), then writes the event and its audit entry in one Unit-of-Work transaction.
5. **Feed:** at its next sync, each phone fetches `/feed/<token>.ics`. `FeedService` asks the yahrzeit strategy, which uses Hebcal's yahrzeit rules, for each year's date, and renders the feed with ical-generator.
