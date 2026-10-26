import type { Executor } from '../../db/database.js';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/schemas.js';

export class SettingsRepository {
  constructor(private db: Executor) {}

  async get(): Promise<Settings> {
    const rows = await this.db.selectFrom('settings').selectAll().execute();
    const stored = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
    return { ...DEFAULT_SETTINGS, ...pickKnown(stored) };
  }

  async save(values: Partial<Settings>) {
    for (const [key, value] of Object.entries(pickKnown(values))) {
      await this.db.insertInto('settings').values({ key, value: JSON.stringify(value) })
        .onConflict(oc => oc.column('key').doUpdateSet({ value: JSON.stringify(value) })).execute();
    }
  }
}

function pickKnown(obj: Record<string, unknown>): Partial<Settings> {
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => k in DEFAULT_SETTINGS && v !== undefined)) as Partial<Settings>;
}
