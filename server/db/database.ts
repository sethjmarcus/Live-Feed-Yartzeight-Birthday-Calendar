/**
 * SQLite via better-sqlite3, queried through Kysely.
 */
import fs from 'node:fs';
import path from 'node:path';
import SQLite from 'better-sqlite3';
import { Kysely, SqliteDialect, CamelCasePlugin, type Transaction } from 'kysely';
import { Migrator } from 'kysely/migration';
import type { DB } from './schema.js';
import { migrations } from './migrations.js';

export type Database = Kysely<DB>;
/** Either the database or an open transaction — repositories accept both. */
export type Executor = Kysely<DB> | Transaction<DB>;

export interface OpenedDatabase {
  db: Database;
  sqlite: SQLite.Database;
  file: string;
}

export async function openDatabase(dataDir: string): Promise<OpenedDatabase> {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'calendar.sqlite');
  const sqlite = new SQLite(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = new Kysely<DB>({ dialect: new SqliteDialect({ database: sqlite }), plugins: [new CamelCasePlugin()] });
  const { error } = await new Migrator({ db, provider: { getMigrations: async () => migrations } }).migrateToLatest();
  if (error) throw new Error(`Database migration failed: ${(error as Error).message}`);
  return { db, sqlite, file };
}

/** Consistent snapshot of the database into another file. */
export async function backupTo(sqlite: SQLite.Database, target: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sqlite.backup(target);
}
