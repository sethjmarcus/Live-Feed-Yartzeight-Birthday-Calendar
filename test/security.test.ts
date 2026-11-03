/**
 * Security fixes S1–S4, S6 from the review — each test fails on the previous code.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Writable } from 'node:stream';
import SQLite from 'better-sqlite3';
import { startTestApp } from './helpers.js';
import { parseTrustProxy } from '../server/config.js';
import { redactUrl } from '../server/http/redact.js';

const ADMIN = { calendarName: 'Test', displayName: 'Admin', username: 'admin', password: 'password123' };

describe('S1 — first-run setup needs the code from the server log', () => {
  it('rejects a missing or wrong code, accepts the right one (any case, with or without dash)', async () => {
    const env = await startTestApp();
    try {
      expect(env.setupCode).toMatch(/^[0-9A-F]{6}-[0-9A-F]{6}$/);
      const c = await env.client();
      let r = await c.post('/api/setup', ADMIN);
      expect(r.status).toBe(400);
      expect(r.body.fields.setupCode).toBeTruthy();
      r = await c.post('/api/setup', { ...ADMIN, setupCode: 'AAAAAA-BBBBBB' });
      expect(r.status).toBe(400);
      expect(await env.repos.users.count()).toBe(0);
      r = await c.post('/api/setup', { ...ADMIN, setupCode: env.setupCode!.toLowerCase().replace('-', '') });
      expect(r.status).toBe(201);
    } finally {
      await env.close();
    }
  });

  it('no setup code exists once the calendar has an admin', async () => {
    const first = await startTestApp();
    const c = await first.client();
    await c.post('/api/setup', { ...ADMIN, setupCode: first.setupCode! });
    await first.app.listen; // keep the same data folder for a "restart"
    const { createApp } = await import('../server/app.js');
    const { loadConfig } = await import('../server/config.js');
    const restarted = await createApp(loadConfig(path.resolve(import.meta.dirname, '..'), { DATA_DIR: first.dataDir, CLIENT_MODE: 'none', LOG_LEVEL: 'silent' }));
    try {
      expect(restarted.setupCode).toBeNull();
    } finally {
      await restarted.stop();
      await first.close();
    }
  });
});

describe('S2 — only the configured proxy hop is trusted', () => {
  it('parses TRUST_PROXY safely', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('true')).toBe(1); // used to mean "trust everything"
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('loopback')).toBe('loopback');
  });

  it("can't dodge the sign-in rate limit by faking X-Forwarded-For", async () => {
    const env = await startTestApp({ env: { TRUST_PROXY: '1' } });
    try {
      const c = await env.client();
      const token = (await c.get('/api/session')).body.csrfToken as string;
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) {
        // The attacker forges the first entry; the real proxy appends the true client IP.
        const r = await c.agent.post('/api/login').set('x-csrf-token', token).set('X-Forwarded-For', `6.6.6.${i}, 203.0.113.5`).send({ username: 'x', password: 'y' });
        statuses.push(r.status);
      }
      expect(statuses.slice(0, 20).every(s => s === 400)).toBe(true); // wrong password
      expect(statuses.slice(20)).toEqual([429, 429]);                  // then blocked
    } finally {
      await env.close();
    }
  });
});

describe('S3 — secrets never reach the logs', () => {
  it('redacts tokens in URLs', () => {
    expect(redactUrl('/feed/abc123.ics')).toBe('/feed/[redacted]');
    expect(redactUrl('/api/invites/tok?x=1')).toBe('/api/invites/[redacted]?x=1');
    expect(redactUrl('/api/public/subscribe/tok')).toBe('/api/public/subscribe/[redacted]');
    expect(redactUrl('/api/events/5')).toBe('/api/events/5');
  });

  it('feed tokens, cookies and CSRF tokens are absent from request logs', async () => {
    let logs = '';
    const stream = new Writable({ write(chunk, _enc, cb) { logs += chunk.toString(); cb(); } });
    const env = await startTestApp({ env: { LOG_LEVEL: 'info' }, logStream: stream });
    try {
      const c = await env.client();
      await c.post('/api/setup', { ...ADMIN, setupCode: env.setupCode! });
      const admin = (await env.repos.users.findByUsername('admin'))!;
      await c.agent.get(`/feed/${admin.feedToken}.ics`).set('Referer', `http://x/s/${admin.feedToken}`);
      await c.get('/api/me/subscription');
      expect(logs).toContain('/feed/[redacted]');
      expect(logs).not.toContain(admin.feedToken);
      expect(logs).not.toMatch(/feedcal=|feedcal\.sig=|x-csrf-token":"[^[]/);
    } finally {
      await env.close();
    }
  });
});

describe('S4 — feed and invite tokens are not stored in plain text', () => {
  it('the database file never contains a usable token', async () => {
    const env = await startTestApp();
    try {
      const c = await env.client();
      await c.post('/api/setup', { ...ADMIN, setupCode: env.setupCode! });
      const created = await c.post('/api/users', { displayName: 'Guest', username: 'guest', calendarId: 1, permissions: ['subscribe'] });
      const guest = (await env.repos.users.findById(created.body.user.id))!;
      expect(guest.inviteToken).toBeTruthy();

      // Links still work…
      expect((await c.agent.get(`/feed/${guest.feedToken}.ics`)).status).toBe(200);
      expect((await c.get(`/api/invites/${guest.inviteToken}`)).status).toBe(200);
      // …but neither token appears anywhere in the database files.
      const bytes = ['calendar.sqlite', 'calendar.sqlite-wal']
        .map(f => path.join(env.dataDir, f)).filter(f => fs.existsSync(f))
        .map(f => fs.readFileSync(f).toString('latin1')).join('');
      expect(bytes).not.toContain(guest.feedToken);
      expect(bytes).not.toContain(guest.inviteToken!);
      // A backup taken now is equally safe.
      const backup = await c.agent.get('/api/backup').buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d)).on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect((backup.body as Buffer).toString('latin1')).not.toContain(guest.feedToken);
    } finally {
      await env.close();
    }
  });

  it('upgrades plain-text tokens from earlier versions in place; old links keep working', async () => {
    const env = await startTestApp();
    try {
      const c = await env.client();
      await c.post('/api/setup', { ...ADMIN, setupCode: env.setupCode! });
      // Simulate a row written by the previous version.
      const raw = new SQLite(path.join(env.dataDir, 'calendar.sqlite'));
      raw.prepare("UPDATE users SET feed_token = 'OLD-PLAINTEXT-TOKEN', feed_token_enc = NULL, token_format = 0 WHERE username = 'admin'").run();
      raw.close();
      expect(await env.repos.users.protectLegacyTokens()).toBe(1);
      expect((await c.agent.get('/feed/OLD-PLAINTEXT-TOKEN.ics')).status).toBe(200);
      const row = new SQLite(path.join(env.dataDir, 'calendar.sqlite'), { readonly: true })
        .prepare("SELECT feed_token, token_format FROM users WHERE username = 'admin'").get() as { feed_token: string; token_format: number };
      expect(row.feed_token).not.toBe('OLD-PLAINTEXT-TOKEN');
      expect(row.token_format).toBe(1);
    } finally {
      await env.close();
    }
  });
});

describe('S6 — sign-in does not reveal which usernames exist', () => {
  it('an unknown username takes about as long as a wrong password', async () => {
    const env = await startTestApp();
    try {
      const c = await env.client();
      await c.post('/api/setup', { ...ADMIN, setupCode: env.setupCode! });
      await c.post('/api/logout');
      await c.refreshToken();
      const time = async (username: string) => {
        const t = performance.now();
        const r = await c.post('/api/login', { username, password: 'wrong-password' });
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('Wrong username or password.');
        return performance.now() - t;
      };
      await time('nobody'); // warm-up (creates the dummy hash)
      const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      const unknown = median([await time('nobody1'), await time('nobody2'), await time('nobody3')]);
      const wrongPw = median([await time('admin'), await time('admin'), await time('admin')]);
      expect(unknown).toBeGreaterThan(wrongPw * 0.5);
    } finally {
      await env.close();
    }
  });
});

// ---------------------------------------------------------------- second review (findings 1–8)
import request from 'supertest';
import { ROLES } from '../shared/permissions.js';
import { hashPassword, needsRehash, verifyPassword } from '../server/lib/passwords.js';

type Env = Awaited<ReturnType<typeof startTestApp>>;
async function setup(env: Env, extra: Record<string, string> = {}) {
  const admin = await env.client();
  await admin.post('/api/setup', { setupCode: env.setupCode!, calendarName: 'A', displayName: 'Admin', username: 'admin', password: 'password123', ...extra });
  return admin;
}
async function join(env: Env, by: Awaited<ReturnType<Env['client']>>, username: string, calendarId: number, permissions: string[], accept = true) {
  const r = await by.post('/api/users', { displayName: username, username, calendarId, permissions });
  const token = r.body.inviteUrl.split('/invite/')[1] as string;
  const c = await env.client();
  if (accept) await c.post(`/api/invites/${token}`, { password: 'password123', confirm: 'password123' });
  return { client: c, id: r.body.user.id as number, token };
}

describe('R1 — a calendar owner cannot take over accounts outside their calendar', () => {
  it('blocks adding by id and issuing links for people elsewhere', async () => {
    const env = await startTestApp();
    try {
      const admin = await setup(env);
      await admin.post('/api/calendars', { name: 'B' });
      const { client: mallory } = await join(env, admin, 'mallory', 2, ROLES.owner.perms);
      const victim = await join(env, admin, 'victim', 1, ROLES.editor.perms, false); // pending, in calendar A
      // Full mode lets owners add existing people, but not take over their accounts:
      expect((await mallory.put(`/api/calendars/2/members/${victim.id}`, { permissions: ['subscribe'] })).status).toBe(200);
      expect((await mallory.post(`/api/calendars/2/members/${victim.id}/invite`)).status).toBe(403);
      expect((await (await env.client()).get(`/api/invites/${victim.token}`)).status).toBe(200); // original link untouched
      // Someone only in the owner's calendar: allowed.
      const own = await join(env, mallory, 'newbie', 2, ROLES.viewer.perms, false);
      expect((await mallory.post(`/api/calendars/2/members/${own.id}/invite`)).status).toBe(200);
    } finally { await env.close(); }
  });
});

describe('R2 — metadata mode really hides other calendars from the app admin', () => {
  it('no feed links, feed settings or reset links for people in calendars the admin is not in', async () => {
    const env = await startTestApp({ env: { APP_ADMIN_ACCESS: 'metadata' } });
    try {
      const admin = await setup(env);
      await admin.post('/api/calendars', { name: 'Theirs' });
      const { client: bob, id: bobId } = await join(env, admin, 'bob', 2, ROLES.owner.perms);
      await admin.del('/api/calendars/2/members/1');
      expect((await admin.get(`/api/users/${bobId}/subscription`)).status).toBe(403);
      expect((await admin.put(`/api/users/${bobId}/feed-prefs`, { types: ['birthday'], alarm: 'none' })).status).toBe(403);
      expect((await admin.post(`/api/users/${bobId}/invite`)).status).toBe(403);
      expect((await admin.post(`/api/users/${bobId}/feed-reset`)).status).toBe(403);
      const detail = (await admin.get(`/api/users/${bobId}`)).body;
      expect(detail).toMatchObject({ links: null, inviteUrl: null });
      // Owners can't pull strangers in by id here (it would reveal their name).
      expect((await bob.put('/api/calendars/2/members/1', { permissions: ['view'] })).status).toBe(403);
    } finally { await env.close(); }
  });
});

describe('R3 — sign-ins can be ended from the server', () => {
  it('a copied cookie stops working after sign-out, and "sign out everywhere" ends other devices', async () => {
    const env = await startTestApp();
    try {
      await setup(env);
      const c = await env.client();
      const login = await c.post('/api/login', { username: 'admin', password: 'password123' });
      const stolen = login.headers['set-cookie'] as unknown as string[];
      const replay = () => request(env.app).get('/api/session').set('Cookie', stolen.map(s => s.split(';')[0]).join('; '));
      expect((await replay()).body.user?.username).toBe('admin');
      await c.post('/api/logout');
      expect((await replay()).body.user).toBeNull();

      const phone = await env.client();
      await phone.post('/api/login', { username: 'admin', password: 'password123' });
      const laptop = await env.client();
      await laptop.post('/api/login', { username: 'admin', password: 'password123' });
      expect((await laptop.post('/api/me/sign-out-others')).status).toBe(200);
      expect((await phone.get('/api/session')).body.user).toBeNull();
      expect((await laptop.get('/api/session')).body.user?.username).toBe('admin');
      expect(await env.repos.users.count()).toBe(1);
    } finally { await env.close(); }
  });
});

describe('R4 — one client cannot keep the server busy', () => {
  it('limits feed requests per address and reuses built feeds until something changes', async () => {
    const env = await startTestApp();
    try {
      const admin = await setup(env);
      const feed = (await admin.get('/api/me/subscription')).body.links.https.split('/feed/')[1];
      const first = (await admin.agent.get(`/feed/${feed}`)).text;
      expect((await admin.agent.get(`/feed/${feed}`)).text).toBe(first); // cached
      await admin.post('/api/events', { calendarId: 1, type: 'birthday', name: 'New Person', dateEntry: 'gregorian', gDate: '1990-01-01', basis: 'gregorian' });
      expect((await admin.agent.get(`/feed/${feed}`)).text).toContain('New Person'); // cache dropped on change
      const statuses: number[] = [];
      for (let i = 0; i < 60; i++) statuses.push((await admin.agent.get(`/feed/${feed}`)).status);
      expect(statuses.at(-1)).toBe(429);
    } finally { await env.close(); }
  });
});

describe('R5 — password hashing', () => {
  it('uses the stronger settings, and upgrades old hashes at sign-in', async () => {
    const hash = await hashPassword('password123');
    expect(hash).toMatch(/^scrypt\$N=16384,r=8,p=5\$/);
    expect(await verifyPassword('password123', hash)).toBe(true);
    expect(await verifyPassword('nope', hash)).toBe(false);
    expect(await verifyPassword('x', 'scrypt$garbage')).toBe(false);

    const env = await startTestApp();
    try {
      await setup(env);
      // An old-style hash (N=16384, r=8, p=1), as earlier versions wrote.
      const crypto = await import('node:crypto');
      const salt = crypto.randomBytes(16);
      const old = `scrypt$${salt.toString('base64')}$${crypto.scryptSync('password123', salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64')}`;
      const raw = new SQLite(path.join(env.dataDir, 'calendar.sqlite'));
      raw.prepare("UPDATE users SET password_hash = ? WHERE username = 'admin'").run(old);
      raw.close();
      expect(needsRehash(old)).toBe(true);
      const c = await env.client();
      expect((await c.post('/api/login', { username: 'admin', password: 'password123' })).status).toBe(200);
      expect(needsRehash((await env.repos.users.findByUsername('admin'))!.passwordHash)).toBe(false);
    } finally { await env.close(); }
  });
});

describe('R6–R8 — reset links, query strings, failed sign-ins', () => {
  it('reset links last a day, odd query strings get a 400, failed sign-ins are logged', async () => {
    let logs = '';
    const stream = new Writable({ write(chunk, _enc, cb) { logs += chunk.toString(); cb(); } });
    const env = await startTestApp({ env: { LOG_LEVEL: 'warn' }, logStream: stream });
    try {
      const admin = await setup(env);
      const { id } = await join(env, admin, 'carol', 1, ROLES.viewer.perms); // has a password now
      const reset = await admin.post(`/api/users/${id}/invite`);
      const hours = (Date.parse(reset.body.user ? (await env.repos.users.findById(id))!.inviteExpires! : '') - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23);
      expect(hours).toBeLessThanOrEqual(24);
      const fresh = await admin.post('/api/users', { displayName: 'Dan', username: 'dan', calendarId: 1, permissions: ['view'] });
      expect((Date.parse(fresh.body.inviteExpires) - Date.now()) / 86_400_000).toBeGreaterThan(13);

      expect((await admin.get('/api/events?type=a&type=b')).status).toBe(400);
      expect((await admin.get('/api/events?type=nonsense')).status).toBe(400);
      expect((await admin.get('/api/activity?page=1&page=2')).status).toBe(400);
      expect((await admin.get('/api/events?type=birthday&q=x')).status).toBe(200);

      await (await env.client()).post('/api/login', { username: 'carol', password: 'wrong-password' });
      expect(logs).toContain('Failed sign-in');
      expect(logs).toContain('"username":"carol"');
      expect(logs).not.toContain('wrong-password');
    } finally { await env.close(); }
  });
});

describe('Behind Cloudflare — CLIENT_IP_HEADER', () => {
  it('limits by the visitor address Cloudflare reports, not a forged X-Forwarded-For', async () => {
    const env = await startTestApp({ env: { TRUST_PROXY: '1', CLIENT_IP_HEADER: 'cf-connecting-ip' } });
    try {
      const c = await env.client();
      const token = (await c.get('/api/session')).body.csrfToken as string;
      const attempt = (ip: string, i: number) => c.agent.post('/api/login').set('x-csrf-token', token)
        .set('CF-Connecting-IP', ip).set('X-Forwarded-For', `6.6.6.${i}`).send({ username: 'x', password: 'y' });
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) statuses.push((await attempt('203.0.113.5', i)).status);
      expect(statuses.at(-1)).toBe(429);
      expect((await attempt('198.51.100.7', 99)).status).toBe(400); // a different visitor is unaffected
    } finally { await env.close(); }
  });
});
