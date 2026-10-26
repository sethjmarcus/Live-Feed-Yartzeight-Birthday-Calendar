/**
 * Schema migrations, applied in order by Kysely's Migrator.
 * Never edit a migration that has shipped — add a new one.
 *
 * 001 uses IF NOT EXISTS so a database created by version 2 of this app
 * (same tables, created without Kysely) is adopted as-is.
 */
import { sql, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

const statements = (text: string) => text.split(';').map(s => s.trim()).filter(Boolean);

async function run(db: Kysely<unknown>, text: string) {
  for (const stmt of statements(text)) await sql.raw(stmt).execute(db);
}

export const migrations: Record<string, Migration> = {
  '001_initial': {
    async up(db) {
      await run(db, `
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS users (
          id               INTEGER PRIMARY KEY,
          username         TEXT NOT NULL UNIQUE,
          display_name     TEXT NOT NULL,
          password_hash    TEXT,
          session_version  INTEGER NOT NULL DEFAULT 0,
          active           INTEGER NOT NULL DEFAULT 1,
          feed_token       TEXT NOT NULL UNIQUE,
          feed_types       TEXT NOT NULL DEFAULT '[]',
          feed_alarm       TEXT NOT NULL DEFAULT 'none',
          invite_token     TEXT UNIQUE,
          invite_expires   TEXT,
          created_at       TEXT NOT NULL,
          last_login       TEXT,
          last_feed_fetch  TEXT,
          last_feed_agent  TEXT
        );
        CREATE TABLE IF NOT EXISTS user_permissions (
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          permission TEXT NOT NULL,
          PRIMARY KEY (user_id, permission)
        );
        CREATE TABLE IF NOT EXISTS events (
          id           INTEGER PRIMARY KEY,
          type         TEXT NOT NULL CHECK (type IN ('birthday', 'anniversary', 'yahrzeit', 'other')),
          name         TEXT NOT NULL DEFAULT '',
          title        TEXT NOT NULL DEFAULT '',
          hebrew_name  TEXT NOT NULL DEFAULT '',
          notes        TEXT NOT NULL DEFAULT '',
          basis        TEXT NOT NULL CHECK (basis IN ('hebrew', 'gregorian', 'both')),
          date_entry   TEXT NOT NULL CHECK (date_entry IN ('hebrew', 'gregorian')),
          after_sunset INTEGER NOT NULL DEFAULT 0,
          g_date       TEXT NOT NULL,
          h_year       INTEGER NOT NULL,
          h_month      INTEGER NOT NULL,
          h_day        INTEGER NOT NULL,
          revision     INTEGER NOT NULL DEFAULT 0,
          created_by   INTEGER REFERENCES users(id),
          created_at   TEXT NOT NULL,
          updated_by   INTEGER REFERENCES users(id),
          updated_at   TEXT NOT NULL,
          deleted_by   INTEGER REFERENCES users(id),
          deleted_at   TEXT
        );
        CREATE INDEX IF NOT EXISTS events_created_by ON events(created_by);
        CREATE TABLE IF NOT EXISTS audit_log (
          id             INTEGER PRIMARY KEY,
          at             TEXT NOT NULL,
          actor_id       INTEGER REFERENCES users(id),
          action         TEXT NOT NULL,
          event_id       INTEGER REFERENCES events(id),
          target_user_id INTEGER REFERENCES users(id),
          label          TEXT,
          changes        TEXT,
          snapshot       TEXT
        );
        CREATE INDEX IF NOT EXISTS audit_event ON audit_log(event_id);
        CREATE INDEX IF NOT EXISTS audit_actor ON audit_log(actor_id);
        CREATE TABLE IF NOT EXISTS hebcal_cache (
          key        TEXT PRIMARY KEY,
          fetched_at TEXT NOT NULL,
          body       TEXT NOT NULL
        )
      `);
    },
  },
  '002_protect_tokens': {
    // Feed and invite tokens become keyed hashes (lookup) + encrypted copies (display).
    // Existing plain-text rows are converted at startup by UserRepository.protectLegacyTokens(),
    // because that needs the secret key, which migrations don't have.
    async up(db) {
      await run(db, `
        ALTER TABLE users ADD COLUMN feed_token_enc TEXT;
        ALTER TABLE users ADD COLUMN invite_token_enc TEXT;
        ALTER TABLE users ADD COLUMN token_format INTEGER NOT NULL DEFAULT 0
      `);
    },
  },
};
