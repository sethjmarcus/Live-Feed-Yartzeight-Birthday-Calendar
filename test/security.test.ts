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
      const created = await c.post('/api/users', { displayName: 'Guest', username: 'guest', permissions: ['subscribe'] });
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
