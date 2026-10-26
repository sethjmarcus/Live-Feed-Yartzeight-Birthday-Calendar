/**
 * Admin settings, activity log and backups.
 */
import fs from 'node:fs';
import path from 'node:path';
import type SQLite from 'better-sqlite3';
import type { UnitOfWork } from '../../db/unitOfWork.js';
import type { User } from '../users/userRepository.js';
import type { HebcalGateway } from '../hebcal/hebcalGateway.js';
import { backupTo } from '../../db/database.js';
import { can } from '../../../shared/permissions.js';
import type { Settings } from '../../../shared/schemas.js';
import { ForbiddenError } from '../../http/errors.js';
import { diff, nowIso } from '../../lib/util.js';

const KEEP_DAILY_BACKUPS = 30;
const PER_PAGE = 100;

export class SettingsService {
  private backupDir: string;

  constructor(
    private uow: UnitOfWork,
    private hebcal: HebcalGateway,
    private sqlite: SQLite.Database,
    dataDir: string,
    private log: { error: (o: unknown, msg?: string) => void },
  ) {
    this.backupDir = path.join(dataDir, 'backups');
  }

  get() { return this.uow.repos.settings.get(); }

  async update(actor: User, next: Settings) {
    requireAdmin(actor);
    const current = await this.get();
    const changes = diff(current, next, Object.keys(next) as (keyof Settings)[]);
    if (!changes.length) return false;
    await this.uow.transaction(async r => {
      await r.settings.save(next);
      await r.audit.add({ at: nowIso(), actorId: actor.id, action: 'settings.update', changes });
    });
    if (changes.some(c => c.field.startsWith('hebcal'))) void this.hebcal.refresh({ force: true }).catch(() => {});
    return true;
  }

  async activity(actor: User, q: { user?: string; kind?: string; page?: string }) {
    requireAdmin(actor);
    const page = Math.max(1, Number(q.page) || 1);
    const { entries, total } = await this.uow.repos.audit.page({
      userId: q.user ? Number(q.user) : null, kind: q.kind, limit: PER_PAGE, offset: (page - 1) * PER_PAGE,
    });
    return { entries, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)) };
  }

  /** A fresh backup file for download; caller deletes it after sending. */
  async backupNow(actor: User): Promise<string> {
    requireAdmin(actor);
    const file = path.join(this.backupDir, `manual-${nowIso().replace(/[:.]/g, '-')}.sqlite`);
    await backupTo(this.sqlite, file);
    return file;
  }

  /** One backup per day; keeps the last 30. */
  async dailyBackup() {
    try {
      const file = path.join(this.backupDir, `calendar-${nowIso().slice(0, 10)}.sqlite`);
      if (!fs.existsSync(file)) await backupTo(this.sqlite, file);
      const daily = fs.readdirSync(this.backupDir).filter(f => /^calendar-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)).sort();
      for (const old of daily.slice(0, -KEEP_DAILY_BACKUPS)) fs.unlinkSync(path.join(this.backupDir, old));
    } catch (err) {
      this.log.error(err, 'Daily backup failed');
    }
  }
}

function requireAdmin(actor: User) {
  if (!can(actor, 'admin')) throw new ForbiddenError();
}
