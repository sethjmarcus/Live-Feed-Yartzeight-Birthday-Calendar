/**
 * Admin command line, for when you can't get into the website (run on the server):
 *
 *   node dist/server/cli.js users                 list accounts
 *   node dist/server/cli.js reset-link <username>  print a one-time link to set a new password
 *
 * Uses the same data folder and .env as the app; safe to run while the app is running.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { UnitOfWork } from './db/unitOfWork.js';
import { loadSecret } from './http/security.js';
import { TokenVault } from './lib/tokens.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, here.includes(`${path.sep}dist${path.sep}`) ? '../..' : '..');
const config = loadConfig(rootDir);
const { db } = await openDatabase(config.dataDir);
const uow = new UnitOfWork(db, new TokenVault(loadSecret(config.dataDir)));
const [command, arg] = process.argv.slice(2);

try {
  if (command === 'users') {
    const list = await uow.repos.users.list();
    if (!list.length) console.log('No accounts yet — open the site to run first-time setup.');
    for (const u of list) {
      const flags = [u.appAdmin && 'app admin', !u.active && 'disabled', !u.passwordHash && 'never set a password'].filter(Boolean).join(', ');
      console.log(`${u.username.padEnd(20)} ${u.displayName}${flags ? `  (${flags})` : ''}`);
    }
  } else if (command === 'reset-link' && arg) {
    const user = await uow.repos.users.findByUsername(arg.trim().toLowerCase());
    if (!user) throw new Error(`No account called "${arg}". Run: node dist/server/cli.js users`);
    const days = user.passwordHash ? 1 : 14;
    Object.assign(user, {
      inviteToken: crypto.randomBytes(24).toString('base64url'),
      inviteExpires: new Date(Date.now() + days * 86_400_000).toISOString(),
      active: true,
    });
    await uow.transaction(async r => {
      await r.users.update(user);
      await r.audit.add({ at: new Date().toISOString(), actorId: null, action: 'user.invite', targetUserId: user.id, label: 'from the server command line' });
    });
    const base = config.publicUrl || `http://localhost:${config.port}`;
    console.log(`Open this link to choose a new password for ${user.username} (works once, for ${days === 1 ? '24 hours' : '14 days'}):\n\n  ${base}/invite/${user.inviteToken}\n`);
  } else {
    console.log('Usage:\n  node dist/server/cli.js users\n  node dist/server/cli.js reset-link <username>');
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await db.destroy();
}
