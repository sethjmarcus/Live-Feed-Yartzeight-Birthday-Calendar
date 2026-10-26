import type { Executor } from '../../db/database.js';

export class HebcalCacheRepository {
  constructor(private db: Executor) {}

  async get<T>(key: string): Promise<{ fetchedAt: string; data: T } | null> {
    const row = await this.db.selectFrom('hebcalCache').selectAll().where('key', '=', key).executeTakeFirst();
    return row ? { fetchedAt: row.fetchedAt, data: JSON.parse(row.body) as T } : null;
  }

  async put(key: string, data: unknown, fetchedAt: string) {
    const body = JSON.stringify(data);
    await this.db.insertInto('hebcalCache').values({ key, fetchedAt, body })
      .onConflict(oc => oc.column('key').doUpdateSet({ fetchedAt, body })).execute();
  }

  /** Drop entries for years/settings no longer in use. */
  async retainOnly(keys: string[]) {
    if (keys.length) await this.db.deleteFrom('hebcalCache').where('key', 'not in', keys).execute();
  }
}
