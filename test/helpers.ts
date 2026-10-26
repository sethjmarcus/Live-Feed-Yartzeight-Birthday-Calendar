/**
 * Test helpers: an app with a temp data folder and a fake Hebcal API, plus a
 * supertest agent that keeps cookies and sends the CSRF header like the React app does.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';

export const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'legacy-db.json');

/** Fake Hebcal API: one holiday a year, plus candle-lighting when a location is requested. */
export function fakeHebcal(calls: Record<string, string>[] = []): typeof fetch {
  return (async (url: string | URL) => {
    const q = new URL(String(url)).searchParams;
    calls.push(Object.fromEntries(q));
    const y = q.get('year');
    const items: object[] = [{ title: 'Chanukah: 1 Candle', date: `${y}-12-04`, category: 'holiday', subcat: 'major', hebrew: 'חנוכה: א׳ נר', memo: 'Festival of Lights' }];
    if (q.get('c') === 'on') items.push({ title: 'Candle lighting: 15:54', date: `${y}-12-04T15:54:00+02:00`, category: 'candles', hebrew: 'הדלקת נרות' });
    return new Response(JSON.stringify({ location: { title: 'Jerusalem, Israel' }, items }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

export async function startTestApp({ legacyFixture, fetch = fakeHebcal(), env = {}, logStream }: {
  legacyFixture?: string; fetch?: typeof globalThis.fetch; env?: Record<string, string>; logStream?: import('pino').DestinationStream;
} = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedcal-'));
  if (legacyFixture) fs.copyFileSync(legacyFixture, path.join(dataDir, 'db.json'));
  const config = loadConfig(path.resolve(import.meta.dirname, '..'), {
    DATA_DIR: dataDir, CLIENT_MODE: 'none', LOG_LEVEL: 'silent', HEBCAL_API_BASE: 'https://hebcal.test', ...env,
  });
  const instance = await createApp(config, { fetch, logStream });
  return {
    ...instance,
    get setupCode() { return instance.setupCode; },
    dataDir,
    /** A browser-like client: cookies + CSRF header. */
    async client() {
      const agent = request.agent(instance.app);
      let token = (await agent.get('/api/session')).body.csrfToken as string;
      const withToken = <T extends request.Test>(t: T) => t.set('x-csrf-token', token);
      return {
        agent,
        get: (url: string) => agent.get(url),
        post: (url: string, body: object = {}) => withToken(agent.post(url)).send(body),
        put: (url: string, body: object = {}) => withToken(agent.put(url)).send(body),
        patch: (url: string, body: object = {}) => withToken(agent.patch(url)).send(body),
        del: (url: string) => withToken(agent.delete(url)),
        async refreshToken() { token = (await agent.get('/api/session')).body.csrfToken; },
        setToken(t: string) { token = t; },
      };
    },
    async close() {
      await instance.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
