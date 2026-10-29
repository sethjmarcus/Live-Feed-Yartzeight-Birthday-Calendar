/**
 * Composition root: creates every object once and wires dependencies together.
 * Nothing else constructs services or repositories; tests build the same graph
 * with a fake Hebcal fetch and a temp data folder.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import express, { Router } from 'express';
import { pino, type DestinationStream } from 'pino';
import { pinoHttp } from 'pino-http';
import type { Config } from './config.js';
import { openDatabase } from './db/database.js';
import { UnitOfWork } from './db/unitOfWork.js';
import { importLegacyJson } from './db/legacyImport.js';
import { HebcalGateway } from './features/hebcal/hebcalGateway.js';
import { UserService } from './features/users/userService.js';
import { EventService } from './features/events/eventService.js';
import { FeedService } from './features/feed/feedService.js';
import { SettingsService } from './features/settings/settingsService.js';
import { CalendarService } from './features/calendars/calendarService.js';
import { calendarRoutes } from './features/calendars/calendarRoutes.js';
import { authRoutes } from './features/auth/authRoutes.js';
import { eventRoutes } from './features/events/eventRoutes.js';
import { userRoutes } from './features/users/userRoutes.js';
import { settingsRoutes } from './features/settings/settingsRoutes.js';
import { feedRoutes, publicSubscribeRoutes } from './features/feed/feedRoutes.js';
import { createAuthRateLimit, createCsrf, createRateLimit, installSecurity, loadSecret } from './http/security.js';
import { errorHandler } from './http/middleware.js';
import { SessionStore } from './http/sessions.js';
import { NotFoundError } from './http/errors.js';
import { TokenVault } from './lib/tokens.js';
import { redactUrl, REDACTED_LOG_PATHS } from './http/redact.js';

export async function createApp(config: Config, opts: { fetch?: typeof globalThis.fetch; logStream?: DestinationStream } = {}) {
  // Logs never contain cookies, CSRF tokens or referrers (which can hold feed/invite links).
  const log = pino({ level: config.logLevel, redact: { paths: REDACTED_LOG_PATHS, censor: '[redacted]' } }, opts.logStream);

  // ---- data
  const secret = loadSecret(config.dataDir);
  const vault = new TokenVault(secret);
  const { db, sqlite } = await openDatabase(config.dataDir);
  const uow = new UnitOfWork(db, vault);
  await importLegacyJson(uow, config.dataDir, { info: msg => log.info(msg) });
  const converted = await uow.transaction(r => r.users.protectLegacyTokens());
  if (converted) log.info(`Protected the feed/invite tokens of ${converted} user(s); existing links keep working.`);

  // ---- first-run setup code: whoever runs the server can read it in the log; strangers can't.
  let setupCode: string | null = null;
  if ((await uow.repos.users.count()) === 0) {
    setupCode = Array.from({ length: 2 }, () => crypto.randomBytes(3).toString('hex').toUpperCase()).join('-');
    log.warn(`First-run setup code: ${setupCode}  (enter it on the setup page to create the admin account)`);
  }

  // ---- services
  const hebcal = new HebcalGateway(uow.repos.hebcalCache, uow.repos.settings, {
    baseUrl: config.hebcalApiBase, refreshHours: config.hebcalRefreshHours, fetch: opts.fetch, log,
  });
  const users = new UserService(uow, () => setupCode);
  const calendars = new CalendarService(uow, config.appAdminAccess);
  const sessions = new SessionStore(db, vault);
  const events = new EventService(uow);
  const feed = new FeedService(uow, hebcal);
  const settings = new SettingsService(uow, hebcal, sqlite, config.dataDir, log);

  // ---- HTTP
  const app = express();
  if (config.logLevel !== 'silent') {
    app.use(pinoHttp({
      logger: log,
      autoLogging: { ignore: req => !req.url?.startsWith('/api') && !req.url?.startsWith('/feed') },
      // Feed / invite / subscribe-page tokens in URLs are replaced with [redacted].
      serializers: { req: (req: { url?: string }) => ({ ...req, url: redactUrl(req.url ?? '') }) },
    }));
  }
  installSecurity(app, config, secret);
  const { doubleCsrfProtection, generateCsrfToken } = createCsrf(secret, config);

  app.get('/healthz', (_req, res) => { res.type('text/plain').send('ok'); });
  app.use('/feed', createRateLimit(60));
  app.use(feedRoutes({ feed, users, settings }));

  const api = Router();
  api.use(createRateLimit(300), express.json({ limit: '200kb' }), doubleCsrfProtection, sessions.loadUser(uow.repos.users, u => calendars.actorFor(u)));
  api.use(authRoutes({ users, settings, calendars, sessions, log, csrfToken: (req, res) => generateCsrfToken(req, res), authRateLimit: createAuthRateLimit() }));
  api.use(eventRoutes({ events, feed, users }));
  api.use(calendarRoutes({ calendars }));
  api.use(userRoutes({ users, settings, events: uow.repos.events, calendars: uow.repos.calendars, sessions, config }));
  api.use(settingsRoutes({ settings, users, calendars: uow.repos.calendars, hebcal, config }));
  api.use(publicSubscribeRoutes({ users, settings, config }));
  api.use(() => { throw new NotFoundError('No such API endpoint.'); });
  app.use('/api', api);

  // ---- React front end
  let closeVite: (() => Promise<void>) | undefined;
  if (config.clientMode === 'vite') {
    const { createServer } = await import('vite');
    const vite = await createServer({ configFile: path.join(config.rootDir, 'vite.config.ts'), server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
    closeVite = () => vite.close();
  } else if (config.clientMode === 'dist') {
    const dist = path.join(config.rootDir, 'dist', 'client');
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use(errorHandler(log));

  // ---- background jobs
  let backupTimer: NodeJS.Timeout | undefined;
  return {
    app,
    log,
    /** The first-run setup code (null once an admin exists). */
    get setupCode() { return setupCode; },
    services: { users, calendars, events, feed, settings, hebcal, sessions },
    repos: uow.repos,
    start() {
      hebcal.start();
      const daily = () => { void settings.dailyBackup(); void sessions.prune().catch(err => log.error(err, 'Session clean-up failed')); };
      daily();
      backupTimer = setInterval(daily, 6 * 3_600_000);
      backupTimer.unref();
    },
    async stop() {
      hebcal.stop();
      clearInterval(backupTimer);
      await closeVite?.();
      await db.destroy();
    },
  };
}
