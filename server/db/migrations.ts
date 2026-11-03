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
  '003_calendars': {
    // Several calendars, each with its own members and per-member permissions.
    // Everything that existed before becomes the first calendar; people keep exactly the
    // permissions they had (global "admin" becomes "manage" in that calendar, plus app admin).
    async up(db) {
      await run(db, `
        CREATE TABLE calendars (
          id          INTEGER PRIMARY KEY,
          name        TEXT NOT NULL,
          created_at  TEXT NOT NULL,
          created_by  INTEGER REFERENCES users(id)
        );
        CREATE TABLE calendar_members (
          calendar_id INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
          user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          permissions TEXT NOT NULL DEFAULT '[]',
          in_feed     INTEGER NOT NULL DEFAULT 1,
          added_at    TEXT NOT NULL,
          added_by    INTEGER REFERENCES users(id),
          PRIMARY KEY (calendar_id, user_id)
        );
        CREATE INDEX calendar_members_user ON calendar_members(user_id);
        ALTER TABLE users ADD COLUMN app_admin INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE events ADD COLUMN calendar_id INTEGER REFERENCES calendars(id);
        ALTER TABLE audit_log ADD COLUMN calendar_id INTEGER REFERENCES calendars(id);
        CREATE INDEX events_calendar ON events(calendar_id);
        CREATE INDEX audit_calendar ON audit_log(calendar_id)
      `);

      const count = async (table: string) =>
        Number((await sql<{ n: number }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(db)).rows[0].n);
      if ((await count('users')) + (await count('events')) > 0) {
        const stored = (await sql<{ value: string }>`SELECT value FROM settings WHERE key = 'calendarName'`.execute(db)).rows[0];
        const name = (stored && JSON.parse(stored.value)) || 'Family Calendar';
        const owner = (await sql<{ id: number | null }>`SELECT min(user_id) AS id FROM user_permissions WHERE permission = 'admin'`.execute(db)).rows[0]?.id ?? null;
        await sql`INSERT INTO calendars (id, name, created_at, created_by) VALUES (1, ${name}, ${new Date().toISOString()}, ${owner})`.execute(db);
        await run(db, `
          INSERT INTO calendar_members (calendar_id, user_id, permissions, in_feed, added_at)
            SELECT 1, u.id,
                   (SELECT json_group_array(CASE p.permission WHEN 'admin' THEN 'manage' ELSE p.permission END)
                      FROM user_permissions p WHERE p.user_id = u.id),
                   1, u.created_at
              FROM users u
             WHERE EXISTS (SELECT 1 FROM user_permissions p WHERE p.user_id = u.id);
          UPDATE users SET app_admin = 1 WHERE id IN (SELECT user_id FROM user_permissions WHERE permission = 'admin');
          UPDATE events SET calendar_id = 1;
          UPDATE audit_log SET calendar_id = 1 WHERE event_id IS NOT NULL
        `);
      }
      // The old calendar name now names the site (header, combined feeds).
      await run(db, `
        UPDATE settings SET key = 'siteName' WHERE key = 'calendarName';
        DROP TABLE user_permissions
      `);
    },
  },
  '004_sessions': {
    // Sign-ins are kept on the server, so signing out (or "sign out everywhere", or
    // disabling an account) ends them for real. The cookie only holds a random token;
    // this table holds its keyed hash, never the token itself.
    async up(db) {
      await run(db, `
        CREATE TABLE sessions (
          id              TEXT PRIMARY KEY,
          user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          session_version INTEGER NOT NULL,
          created_at      TEXT NOT NULL,
          last_seen_at    TEXT NOT NULL,
          user_agent      TEXT
        );
        CREATE INDEX sessions_user ON sessions(user_id)
      `);
    },
  },
};
