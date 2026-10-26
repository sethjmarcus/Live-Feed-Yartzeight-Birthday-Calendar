/**
 * Entry point.  Development: npm run dev   ·   Production: npm run build && npm start
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createApp } from './app.js';

// Works both from source (server/index.ts) and compiled (dist/server/index.js).
const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, here.includes(`${path.sep}dist${path.sep}`) ? '../..' : '..');

const config = loadConfig(rootDir);
const { app, start, stop, log } = await createApp(config);

const server = app.listen(config.port, config.host, () => {
  log.info(`Calendar running on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  log.info(`Data folder: ${config.dataDir}`);
  if (!config.publicUrl) log.info('Tip: set PUBLIC_URL in .env so calendar links use the address phones can reach.');
  start();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    void stop().finally(() => process.exit(0));
  });
}
