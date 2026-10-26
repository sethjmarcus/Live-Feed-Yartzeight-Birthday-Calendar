/**
 * One-time import of data/db.json from version 1 of this app.
 * Runs only when the database has no users; afterwards db.json is renamed
 * to db.json.imported so it's never imported twice. (Version 2's calendar.sqlite
 * needs no import — it is opened directly.)
 */
import fs from 'node:fs';
import path from 'node:path';
import type { UnitOfWork } from './unitOfWork.js';
import { PERMISSION_KEYS, type Permission } from '../../shared/permissions.js';
import { EVENT_TYPE_KEYS } from '../../shared/eventTypes.js';

interface LegacyDb {
  settings?: { calendarName?: string; yearsAhead?: number; yearsBehind?: number };
  users?: (Record<string, unknown> & { perms?: Record<string, boolean>; feedPrefs?: { types?: string[]; alarm?: string } })[];
  events?: Record<string, unknown>[];
  audit?: Record<string, unknown>[];
}

export async function importLegacyJson(uow: UnitOfWork, dataDir: string, log: { info: (msg: string) => void }) {
  const file = path.join(dataDir, 'db.json');
  if (!fs.existsSync(file) || (await uow.repos.users.count()) > 0) return false;

  const legacy = JSON.parse(fs.readFileSync(file, 'utf8')) as LegacyDb;
  await uow.transaction(async r => {
    const { calendarName, yearsAhead, yearsBehind } = legacy.settings ?? {};
    await r.settings.save({ calendarName, yearsAhead, yearsBehind });

    for (const u of legacy.users ?? []) {
      await r.users.create({
        id: u.id as number,
        username: u.username as string,
        displayName: u.displayName as string,
        passwordHash: (u.passwordHash as string) ?? null,
        sessionVersion: (u.sessionVersion as number) ?? 0,
        active: u.active !== false,
        permissions: PERMISSION_KEYS.filter(k => u.perms?.[k]) as Permission[],
        feedToken: u.feedToken as string,
        feedPrefs: {
          types: (u.feedPrefs?.types?.length ? u.feedPrefs.types : [...EVENT_TYPE_KEYS]) as never,
          alarm: (u.feedPrefs?.alarm ?? 'none') as never,
        },
        inviteToken: (u.inviteToken as string) ?? null,
        inviteExpires: (u.inviteExpires as string) ?? null,
        createdAt: u.createdAt as string,
        lastLogin: (u.lastLogin as string) ?? null,
        lastFeedFetch: (u.lastFeedFetch as string) ?? null,
        lastFeedAgent: (u.lastFeedAgent as string) ?? null,
      });
    }
    for (const e of legacy.events ?? []) {
      await r.events.create({
        id: e.id as number,
        type: e.type as never,
        name: (e.name as string) || '', title: (e.title as string) || '',
        hebrewName: (e.hebrewName as string) || '', notes: (e.notes as string) || '',
        basis: e.basis as never, dateEntry: e.dateEntry as never, afterSunset: !!e.afterSunset,
        gDate: e.gDate as string, hYear: e.hYear as number, hMonth: e.hMonth as number, hDay: e.hDay as number,
        revision: (e.revision as number) || 0,
        createdBy: (e.createdBy as number) ?? null, createdAt: e.createdAt as string,
        updatedBy: (e.updatedBy as number) ?? null, updatedAt: e.updatedAt as string,
        deletedBy: (e.deletedBy as number) ?? null, deletedAt: (e.deletedAt as string) ?? null,
      });
    }
    for (const a of legacy.audit ?? []) {
      await r.audit.add({
        at: a.at as string, actorId: (a.actorId as number) ?? null, action: a.action as string,
        eventId: (a.eventId as number) ?? null, targetUserId: (a.targetUserId as number) ?? null,
        label: (a.label as string) ?? null, changes: (a.changes as never) ?? null, snapshot: a.snapshot ?? null,
      });
    }
  });
  fs.renameSync(file, file + '.imported');
  log.info(`Imported ${legacy.users?.length ?? 0} users and ${legacy.events?.length ?? 0} events from db.json.`);
  return true;
}
