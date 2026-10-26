/**
 * Several calendars: per-calendar roles, feeds that combine calendars, calendar managers,
 * what app admins can see ('full' and 'metadata'), and upgrading a single-calendar database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect, CamelCasePlugin, sql } from 'kysely';
import { Migrator } from 'kysely/migration';
import { migrations } from '../server/db/migrations.js';
import { startTestApp } from './helpers.js';
import { ROLES } from '../shared/permissions.js';

type App = Awaited<ReturnType<typeof startTestApp>>;
type Client = Awaited<ReturnType<App['client']>>;

const birthday = (calendarId: number, name: string) =>
  ({ calendarId, type: 'birthday', name, dateEntry: 'gregorian', gDate: '1990-05-05', basis: 'gregorian' });

/** Invite someone and finish their setup; returns a signed-in client and their id. */
async function join(env: App, by: Client, username: string, calendarId: number, permissions: string[]) {
  const r = await by.post('/api/users', { displayName: username, username, calendarId, permissions });
  expect(r.status).toBe(201);
  const token = r.body.inviteUrl.split('/invite/')[1];
  const c = await env.client();
  expect((await c.post(`/api/invites/${token}`, { password: 'password123', confirm: 'password123' })).status).toBe(200);
  return { client: c, id: r.body.user.id as number };
}

const feedOf = async (c: Client) => {
  const token = (await c.get('/api/me/subscription')).body.links.https.split('/feed/')[1];
  return (await c.agent.get(`/feed/${token}`)).text;
};

describe('several calendars in one family', () => {
  let env: App;
  let admin: Client;
  let dina: Client;
  let dinaId: number;
  let cohenEvent: number;

  beforeAll(async () => {
    env = await startTestApp();
    admin = await env.client();
    await admin.post('/api/setup', { setupCode: env.setupCode!, calendarName: 'Cohen side', displayName: 'Seth', username: 'seth', password: 'password123' });
  });
  afterAll(() => env.close());

  it('app admins create calendars and own them', async () => {
    const r = await admin.post('/api/calendars', { name: 'Levi side' });
    expect(r.status).toBe(201);
    expect(r.body.calendar).toMatchObject({ id: 2, name: 'Levi side' });
    const s = (await admin.get('/api/session')).body;
    expect(s.user.calendars.map((c: { name: string }) => c.name)).toEqual(['Cohen side', 'Levi side']);
    expect(s.user.memberships).toHaveLength(2);
    expect((await admin.post('/api/calendars', { name: '' })).status).toBe(400);
  });

  it('a person sees and changes only the calendars they belong to', async () => {
    ({ client: dina, id: dinaId } = await join(env, admin, 'dina', 2, ROLES.contributor.perms));
    expect((await dina.get('/api/session')).body.user.calendars.map((c: { id: number }) => c.id)).toEqual([2]);

    cohenEvent = (await admin.post('/api/events', birthday(1, 'Avi Cohen'))).body.event.id;
    expect((await dina.post('/api/events', birthday(2, 'Dina Levi'))).status).toBe(201);
    expect((await dina.post('/api/events', birthday(1, 'Sneaky'))).status).toBe(403);

    const list = (await dina.get('/api/events')).body.events.map((e: { name: string }) => e.name);
    expect(list).toEqual(['Dina Levi']);
    expect((await dina.get(`/api/events/${cohenEvent}`)).status).toBe(404);
    expect((await dina.del(`/api/events/${cohenEvent}`)).status).toBe(404);
    expect((await dina.get('/api/events?calendar=1')).body.events).toEqual([]);
    const upcoming = (await dina.get('/api/upcoming?days=365')).body.items.map((i: { calendarId: number }) => i.calendarId);
    expect(new Set(upcoming)).toEqual(new Set([2]));

    // The admin sees both, and can filter to one.
    expect((await admin.get('/api/events')).body.events).toHaveLength(2);
    expect((await admin.get('/api/events?calendar=2')).body.events.map((e: { name: string }) => e.name)).toEqual(['Dina Levi']);
  });

  it("one feed per person, combining the calendars they subscribe to", async () => {
    let ics = await feedOf(dina);
    expect(ics).toContain('X-WR-CALNAME:Levi side');
    expect(ics).toContain('Dina Levi');
    expect(ics).not.toContain('Avi Cohen');

    ics = await feedOf(admin);
    expect(ics).toContain('X-WR-CALNAME:Cohen side'); // site name (set at setup)
    expect(ics).toContain('Avi Cohen');
    expect(ics).toContain('Dina Levi');
    expect(ics).toContain('Calendar: Levi side');

    // Leave a calendar out of the feed without leaving the calendar.
    await admin.put('/api/me/feed-prefs', { types: ['birthday'], alarm: 'none', calendars: [1] });
    ics = await feedOf(admin);
    expect(ics).toContain('Avi Cohen');
    expect(ics).not.toContain('Dina Levi');
    expect((await admin.get('/api/session')).body.user.memberships.find((m: { calendarId: number }) => m.calendarId === 2).inFeed).toBe(false);
  });

  it('a calendar manager runs their own calendar, and nothing else', async () => {
    expect((await dina.get('/api/calendars/2')).status).toBe(403);
    expect((await admin.put(`/api/calendars/2/members/${dinaId}`, { permissions: ROLES.owner.perms })).status).toBe(200);

    const detail = (await dina.get('/api/calendars/2')).body;
    expect(detail.members.map((m: { username: string }) => m.username).sort()).toEqual(['dina', 'seth']);
    expect(detail.directory).toEqual([]); // everyone is already in it
    expect((await dina.get('/api/calendars/1')).status).toBe(403);
    expect((await dina.get('/api/users')).status).toBe(403);
    expect((await dina.get('/api/settings')).status).toBe(403);

    // Invites people into their calendar only.
    const eli = await dina.post('/api/users', { displayName: 'Eli', username: 'eli', calendarId: 2, permissions: ROLES.viewer.perms });
    expect(eli.status).toBe(201);
    expect(eli.body.inviteUrl).toMatch(/\/invite\//);
    expect((await dina.post('/api/users', { displayName: 'X', username: 'xx', calendarId: 1, permissions: ['view'] })).status).toBe(403);
    // …and can re-issue the setup link while it is still pending.
    expect((await dina.post(`/api/calendars/2/members/${eli.body.user.id}/invite`)).body.inviteUrl).toMatch(/\/invite\//);
    expect((await dina.post(`/api/calendars/2/members/1/invite`)).status).toBe(403); // seth has a password

    // Activity: only their calendar — no site-wide entries, nothing from the other calendar.
    const activity = (await dina.get('/api/activity')).body;
    expect(activity.entries.length).toBeGreaterThan(0);
    expect(activity.entries.every((e: { calendarId: number | null }) => e.calendarId === 2)).toBe(true);
    expect(activity.entries.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['member.update', 'user.create', 'event.create']));
    expect(Object.values(activity.names)).not.toContain('Avi Cohen');

    // Restores and history only in calendars they manage.
    expect((await dina.get(`/api/events/${cohenEvent}/history`)).status).toBe(404);
  });

  it('every calendar keeps a manager', async () => {
    expect((await admin.del('/api/calendars/2/members/1')).status).toBe(200); // Dina still manages it
    const r = await dina.put(`/api/calendars/2/members/${dinaId}`, { permissions: ROLES.viewer.perms });
    expect(r.status).toBe(400);
    expect((await dina.del(`/api/calendars/2/members/${dinaId}`)).status).toBe(400);
    // The app admin (full mode) still manages it without being a member.
    const s = (await admin.get('/api/session')).body.user.calendars.find((c: { id: number }) => c.id === 2);
    expect(s).toMatchObject({ member: false, permissions: ['manage'] });
    expect((await admin.get('/api/calendars/2')).status).toBe(200);
  });

  it('moves an event between calendars only with add permission in the target', async () => {
    const ev = (await dina.get('/api/events')).body.events[0];
    expect((await dina.put(`/api/events/${ev.id}`, { ...birthday(1, ev.name) })).status).toBe(403);
    const r = await admin.put(`/api/events/${cohenEvent}`, birthday(2, 'Avi Cohen'));
    expect(r.body.changed).toBe(true);
    expect((await dina.get('/api/events')).body.events.map((e: { name: string }) => e.name)).toContain('Avi Cohen');
    const history = (await admin.get(`/api/events/${cohenEvent}/history`)).body;
    expect(history.entries[0].changes).toEqual([{ field: 'calendarId', from: 1, to: 2 }]);
  });

  it('renames calendars, and deletes only ones that never had events', async () => {
    expect((await dina.put('/api/calendars/2', { name: 'Levi family' })).body.changed).toBe(true);
    expect((await dina.get('/api/session')).body.user.calendars[0].name).toBe('Levi family');
    expect((await admin.del('/api/calendars/2')).status).toBe(400);
    const empty = (await admin.post('/api/calendars', { name: 'Spare' })).body.calendar.id;
    expect((await admin.del(`/api/calendars/${empty}`)).status).toBe(200);
    expect((await admin.get('/api/calendars')).body.calendars.map((c: { name: string }) => c.name)).toEqual(['Cohen side', 'Levi family']);
  });
});

describe("APP_ADMIN_ACCESS=metadata — the app admin can't open other people's calendars", () => {
  it('shows names and counts only', async () => {
    const env = await startTestApp({ env: { APP_ADMIN_ACCESS: 'metadata' } });
    try {
      const admin = await env.client();
      await admin.post('/api/setup', { setupCode: env.setupCode!, calendarName: 'Mine', displayName: 'Owner', username: 'owner', password: 'password123' });
      expect((await admin.get('/api/session')).body.appAdminAccess).toBe('metadata');
      await admin.post('/api/calendars', { name: 'Other family' });
      const { client: bob, id: bobId } = await join(env, admin, 'bob', 2, ROLES.owner.perms);
      await admin.del('/api/calendars/2/members/1'); // the admin steps out
      await bob.post('/api/events', birthday(2, 'Private Person'));

      const overview = (await admin.get('/api/calendars')).body.calendars;
      expect(overview.find((c: { id: number }) => c.id === 2)).toMatchObject({ name: 'Other family', memberCount: 1, eventCount: 1 });
      expect((await admin.get('/api/calendars/2')).status).toBe(403);
      expect((await admin.get('/api/events?calendar=2')).body.events).toEqual([]);
      expect(JSON.stringify((await admin.get('/api/upcoming?days=365')).body)).not.toContain('Private Person');
      const activity = (await admin.get('/api/activity')).body.entries;
      expect(activity.some((e: { calendarId: number | null }) => e.calendarId === 2)).toBe(false);

      // Calendar owners don't get the site-wide list of people in this mode.
      expect((await bob.get('/api/calendars/2')).body.directory).toBeNull();
      expect(bobId).toBeGreaterThan(1);
    } finally {
      await env.close();
    }
  });
});

describe('upgrade from a single-calendar database', () => {
  it('puts everything into the first calendar, keeping each person’s permissions', async () => {
    const now = '2025-01-01T00:00:00.000Z';
    const env = await startTestApp({
      async prepare(dataDir) {
        // Build a database as the previous version left it (migrations 001 and 002 only).
        const db = new Kysely<unknown>({ dialect: new SqliteDialect({ database: new SQLite(path.join(dataDir, 'calendar.sqlite')) }), plugins: [new CamelCasePlugin()] });
        await new Migrator({ db, provider: { getMigrations: async () => migrations } }).migrateTo('002_protect_tokens');
        await sql`INSERT INTO settings (key, value) VALUES ('calendarName', '"Old Family"')`.execute(db);
        await sql`INSERT INTO users (id, username, display_name, feed_token, feed_types, created_at) VALUES (1, 'boss', 'Boss', 'tok-boss', '["birthday"]', ${now}), (2, 'viewer', 'Viewer', 'tok-viewer', '["birthday"]', ${now}), (3, 'nobody', 'Nobody', 'tok-nobody', '[]', ${now})`.execute(db);
        await sql`INSERT INTO user_permissions (user_id, permission) VALUES (1, 'admin'), (2, 'subscribe'), (2, 'view')`.execute(db);
        await sql`INSERT INTO events (type, name, basis, date_entry, g_date, h_year, h_month, h_day, created_by, created_at, updated_at) VALUES ('birthday', 'Old Event', 'gregorian', 'gregorian', '1990-05-05', 5750, 2, 10, 1, ${now}, ${now})`.execute(db);
        await sql`INSERT INTO audit_log (at, actor_id, action, event_id) VALUES (${now}, 1, 'event.create', 1), (${now}, 1, 'setup', NULL)`.execute(db);
        await db.destroy();
      },
    });
    try {
      expect(await env.repos.calendars.list()).toMatchObject([{ id: 1, name: 'Old Family', createdBy: 1 }]);
      const boss = (await env.repos.users.findById(1))!;
      expect(boss.appAdmin).toBe(true);
      expect(boss.memberships[0].permissions).toEqual(['manage']);
      expect((await env.repos.users.findById(2))!.memberships[0].permissions).toEqual(['subscribe', 'view']);
      expect((await env.repos.users.findById(3))!.memberships).toEqual([]);
      expect((await env.repos.events.listActive())[0].calendarId).toBe(1);
      expect((await env.services.settings.get()).siteName).toBe('Old Family');

      const c = await env.client();
      const viewerFeed = (await c.agent.get('/feed/tok-viewer.ics')).text; // old link keeps working
      expect(viewerFeed).toContain('X-WR-CALNAME:Old Family');
      expect(viewerFeed).toContain('Old Event');
      expect((await c.agent.get('/feed/tok-nobody.ics')).status).toBe(404); // never had Subscribe
    } finally {
      await env.close();
    }
  });
});
