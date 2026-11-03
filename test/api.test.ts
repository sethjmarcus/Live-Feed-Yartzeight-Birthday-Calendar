/**
 * API end-to-end: setup, permissions, invitations, audit trail, feeds, Hebcal extras, legacy import.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestApp, fakeHebcal, FIXTURE } from './helpers.js';

type App = Awaited<ReturnType<typeof startTestApp>>;
type Client = Awaited<ReturnType<App['client']>>;

describe('full workflow', () => {
  const hebcalCalls: Record<string, string>[] = [];
  let env: App;
  let admin: Client;
  let miriam: Client;
  let miriamId: number;
  let inviteToken: string;
  let adminFeed: string;

  beforeAll(async () => {
    env = await startTestApp({ fetch: fakeHebcal(hebcalCalls) });
    admin = await env.client();
  });
  afterAll(() => env.close());

  it('reports first run, then creates the admin once', async () => {
    expect((await admin.get('/api/session')).body).toMatchObject({ user: null, needsSetup: true });
    const res = await admin.post('/api/setup', { setupCode: env.setupCode!, calendarName: 'Cohen Family', displayName: 'Seth', username: 'Seth', password: 'password123' });
    expect(res.status).toBe(201);
    const s = (await admin.get('/api/session')).body;
    expect(s.user).toMatchObject({ username: 'seth', displayName: 'Seth' });
    expect(s.siteName).toBe('Cohen Family');
    expect(s.user).toMatchObject({ appAdmin: true, calendars: [{ id: 1, name: 'Cohen Family', member: true }] });
    expect((await admin.post('/api/setup', { calendarName: 'x', displayName: 'x', username: 'xx', password: 'password123' })).status).toBe(403);
  });

  it('rejects requests without a CSRF token', async () => {
    const res = await admin.agent.post('/api/events').send({});
    expect(res.status).toBe(403);
  });

  it('adds events in both calendars and validates input', async () => {
    let r = await admin.post('/api/events', { calendarId: 1, type: 'yahrzeit', name: 'Grandpa Avraham', hebrewName: 'אברהם בן יצחק', dateEntry: 'hebrew', hDay: 30, hMonth: 8, hYear: 5740, basis: 'hebrew' });
    expect(r.status).toBe(201);
    expect(r.body.event).toMatchObject({ gDate: '1979-11-20', hYear: 5740 });
    r = await admin.post('/api/events', { calendarId: 1, type: 'birthday', name: 'Sarah', dateEntry: 'gregorian', gDate: '1990-03-10', afterSunset: true, basis: 'both' });
    expect(r.body.event).toMatchObject({ hYear: 5750, hMonth: 12, hDay: 14 });
    await admin.post('/api/events', { calendarId: 1, type: 'other', title: 'Family reunion', dateEntry: 'gregorian', gDate: '2020-12-01', basis: 'gregorian' });
    r = await admin.post('/api/events', { calendarId: 1, type: 'yahrzeit', name: 'X', dateEntry: 'hebrew', hDay: 5, hMonth: 13, hYear: 5785, basis: 'hebrew' });
    expect(r.status).toBe(400);
    expect(r.body.fields.hDay).toMatch(/not a leap year/);
    r = await admin.post('/api/events', { calendarId: 1, type: 'birthday', name: '', dateEntry: 'gregorian', gDate: '2020-02-30', basis: 'gregorian' });
    expect(r.body.fields).toMatchObject({ name: 'Enter a name.', gDate: 'Enter a valid date.' });
  });

  it('invites a contributor; the invite is single-use', async () => {
    let r = await admin.post('/api/users', { displayName: 'Miriam', username: 'Miriam', calendarId: 1, permissions: ['subscribe', 'view', 'add', 'editOwn', 'deleteOwn'] });
    expect(r.status).toBe(201);
    miriamId = r.body.user.id;
    r = await admin.get(`/api/users/${miriamId}`);
    inviteToken = r.body.inviteUrl.split('/invite/')[1];
    expect(r.body.user.hasPassword).toBe(false);

    miriam = await env.client();
    expect((await miriam.get(`/api/invites/${inviteToken}`)).body.displayName).toBe('Miriam');
    expect((await miriam.post(`/api/invites/${inviteToken}`, { password: 'short', confirm: 'short' })).status).toBe(400);
    expect((await miriam.post(`/api/invites/${inviteToken}`, { password: 'miriampass', confirm: 'nope' })).body.fields.confirm).toBeTruthy();
    expect((await miriam.post(`/api/invites/${inviteToken}`, { password: 'miriampass', confirm: 'miriampass' })).status).toBe(200);
    expect((await miriam.get(`/api/invites/${inviteToken}`)).status).toBe(410);
    expect((await miriam.get('/api/session')).body.user.username).toBe('miriam');
  });

  it('enforces permissions', async () => {
    expect((await miriam.get('/api/me/subscription')).body.links.webcal).toMatch(/^webcal:\/\//);
    const r = await miriam.post('/api/events', { calendarId: 1, type: 'birthday', name: 'Noa', dateEntry: 'gregorian', gDate: '2015-02-28', basis: 'hebrew' });
    expect(r.status).toBe(201);
    expect((await miriam.get('/api/events/1')).status).toBe(403);
    expect((await miriam.get('/api/events/4')).status).toBe(200);
    expect((await miriam.get('/api/users')).status).toBe(403);
    expect((await miriam.get('/api/events/1/history')).status).toBe(403);
    expect((await miriam.del('/api/events/1')).status).toBe(403);
    expect((await miriam.get('/api/events')).body.names).toEqual({});
  });

  it('shows the admin who added and edited each event', async () => {
    let r = await admin.get('/api/events');
    const noa = r.body.events.find((e: { name: string }) => e.name === 'Noa');
    expect(r.body.names[noa.createdBy]).toBe('Miriam');
    r = await admin.put('/api/events/4', { calendarId: 1, type: 'birthday', name: 'Noa Levi', dateEntry: 'gregorian', gDate: '2015-02-28', basis: 'hebrew' });
    expect(r.body.changed).toBe(true);
    r = await admin.get('/api/events/4/history');
    const actions = r.body.entries.map((e: { action: string; actorId: number }) => `${r.body.names[e.actorId]}:${e.action}`);
    expect(actions).toEqual(['Seth:event.update', 'Miriam:event.create']);
    expect(r.body.entries[0].changes).toEqual([{ field: 'name', from: 'Noa', to: 'Noa Levi' }]);
  });

  it('soft-deletes and restores', async () => {
    expect((await miriam.del('/api/events/4')).status).toBe(200);
    expect((await admin.get('/api/events')).body.events.some((e: { id: number }) => e.id === 4)).toBe(false);
    expect((await admin.get('/api/events?deleted=1')).body.events.find((e: { id: number }) => e.id === 4).deletedBy).toBe(miriamId);
    expect((await admin.post('/api/events/4/restore')).status).toBe(200);
    const r = await admin.get('/api/activity?kind=event');
    expect(r.body.entries.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['event.create', 'event.update', 'event.delete', 'event.restore']));
  });

  it('protects the last app admin and the last calendar manager', async () => {
    let r = await admin.put('/api/users/1', { displayName: 'Seth', username: 'seth', active: true, appAdmin: false });
    expect(r.status).toBe(400);
    r = await admin.put('/api/calendars/1/members/1', { permissions: ['subscribe', 'view'] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/at least one active member who can manage/);
  });

  it('serves a correct feed (all-day dates right in Israel time)', async () => {
    adminFeed = (await admin.get('/api/me/subscription')).body.links.https.split('/feed/')[1];
    const res = await admin.agent.get(`/feed/${adminFeed}`);
    expect(res.headers['content-type']).toMatch(/^text\/calendar/);
    const ics = res.text;
    expect(process.env.TZ).toBe('Asia/Jerusalem');
    expect(ics).toContain('X-WR-CALNAME:Cohen Family');
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20261110\r\n[\s\S]*?SUMMARY:🕯️ Yahrzeit: Grandpa Avraham \(47th\)/);
    expect(ics).not.toContain('Chanukah'); // Hebcal extras are opt-in
    expect((await admin.agent.get('/feed/nope.ics')).status).toBe(404);
    expect((await env.repos.users.findById(1))!.lastFeedFetch).toBeTruthy();
  });

  it('adds Hebcal holidays and candle-lighting when opted in', async () => {
    let r = await admin.put('/api/settings', {
      siteName: 'Cohen Family', yearsAhead: 10, yearsBehind: 1,
      hebcalGeonameId: '281184', hebcalIsrael: true, hebcalCandleMinutes: 40, hebcalHolidays: ['major', 'roshchodesh'],
    });
    expect(r.body.changed).toBe(true);
    await env.services.hebcal.refresh({ force: true });
    expect(hebcalCalls.at(-1)).toMatchObject({ geonameid: '281184', i: 'on', maj: 'on', nx: 'on', c: 'on', b: '40' });

    await admin.put('/api/me/feed-prefs', { types: ['yahrzeit', 'holidays', 'candles'], alarm: 'daybefore' });
    const ics = (await admin.agent.get(`/feed/${adminFeed}`)).text;
    expect(ics).toContain('SUMMARY:Chanukah: 1 Candle');
    expect(ics).toMatch(/DTSTART:\d{4}1204T135400Z/);
    expect(ics).toContain('Hebcal.com (CC BY 4.0)');
    expect(ics).not.toContain('Sarah');
    expect(ics).toContain('TRIGGER:-PT8H'); // yahrzeit reminder 16:00 the day before

    r = await admin.get('/api/upcoming?days=365');
    expect(r.body.items.some((i: { kind: string }) => i.kind === 'holiday')).toBe(true);
    expect((await admin.get('/api/settings')).body.hebcal.location).toBe('Jerusalem, Israel');
  });

  it('keeps serving holidays when hebcal.com is down', async () => {
    const offline = await startTestApp({ fetch: (async () => { throw new Error('offline'); }) as typeof fetch });
    try {
      const c = await offline.client();
      await c.post('/api/setup', { setupCode: offline.setupCode!, calendarName: 'Off', displayName: 'A', username: 'aa', password: 'password123' });
      await c.put('/api/me/feed-prefs', { types: ['holidays'], alarm: 'none' });
      const token = (await c.get('/api/me/subscription')).body.links.https.split('/feed/')[1];
      const ics = (await c.agent.get(`/feed/${token}`)).text;
      expect(ics).toMatch(/SUMMARY:Rosh Hashana/); // computed locally by @hebcal/core
    } finally {
      await offline.close();
    }
  });

  it('public subscribe page data and backups', async () => {
    const r = await admin.get(`/api/public/subscribe/${adminFeed.replace('.ics', '')}`);
    expect(r.body).toMatchObject({ displayName: 'Seth', calendarName: 'Cohen Family' });
    const backup = await admin.get('/api/backup');
    expect(backup.status).toBe(200);
    expect(backup.headers['content-disposition']).toMatch(/\.sqlite/);
  });

  it('signing out ends the session', async () => {
    await miriam.post('/api/logout');
    expect((await miriam.get('/api/session')).body.user).toBeNull();
    expect((await miriam.get('/api/events')).status).toBe(401);
  });
});

describe('upgrade from version 1', () => {
  it('imports db.json and keeps passwords and feed links working', async () => {
    const env = await startTestApp({ legacyFixture: FIXTURE });
    try {
      expect(await env.repos.users.count()).toBe(2);
      expect((await env.repos.events.listActive()).length).toBe(5);
      const seth = (await env.repos.users.findByUsername('seth'))!;
      expect(seth.appAdmin).toBe(true);
      expect(seth.memberships).toMatchObject([{ calendarId: 1, inFeed: true }]);
      expect(seth.memberships[0].permissions).toContain('manage');
      expect((await env.repos.events.listActive()).every(e => e.calendarId === 1)).toBe(true);
      const c = await env.client();
      expect((await c.post('/api/login', { username: 'seth', password: 'password123' })).status).toBe(200);
      expect((await c.agent.get(`/feed/${seth.feedToken}.ics`)).status).toBe(200);
    } finally {
      await env.close();
    }
  });
});
