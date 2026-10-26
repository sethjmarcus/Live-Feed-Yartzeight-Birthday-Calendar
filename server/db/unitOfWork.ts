/**
 * Unit of Work: gives services a set of repositories, either for plain reads or
 * bound to one transaction so several writes (event + audit entry) commit together.
 */
import type { Database, Executor } from './database.js';
import { UserRepository } from '../features/users/userRepository.js';
import { EventRepository } from '../features/events/eventRepository.js';
import { AuditRepository } from '../features/audit/auditRepository.js';
import { SettingsRepository } from '../features/settings/settingsRepository.js';
import { HebcalCacheRepository } from '../features/hebcal/hebcalCacheRepository.js';
import { CalendarRepository } from '../features/calendars/calendarRepository.js';
import type { TokenVault } from '../lib/tokens.js';

export interface Repositories {
  users: UserRepository;
  calendars: CalendarRepository;
  events: EventRepository;
  audit: AuditRepository;
  settings: SettingsRepository;
  hebcalCache: HebcalCacheRepository;
}

function repositories(ex: Executor, vault: TokenVault): Repositories {
  return {
    users: new UserRepository(ex, vault),
    calendars: new CalendarRepository(ex),
    events: new EventRepository(ex),
    audit: new AuditRepository(ex),
    settings: new SettingsRepository(ex),
    hebcalCache: new HebcalCacheRepository(ex),
  };
}

export class UnitOfWork {
  /** Repositories for reads and single-statement writes. */
  readonly repos: Repositories;

  constructor(private db: Database, private vault: TokenVault) {
    this.repos = repositories(db, vault);
  }

  /** Run fn in a transaction; everything commits together or not at all. */
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.db.transaction().execute(trx => fn(repositories(trx, this.vault)));
  }
}
