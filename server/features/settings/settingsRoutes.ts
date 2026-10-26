/**
 * Admin: settings, activity log, backup download.
 */
import fs from 'node:fs';
import { Router } from 'express';
import type { SettingsService } from './settingsService.js';
import type { UserService } from '../users/userService.js';
import type { HebcalGateway } from '../hebcal/hebcalGateway.js';
import { currentUser, parse, requireUser } from '../../http/middleware.js';
import { baseUrl } from '../../http/links.js';
import { settingsSchema } from '../../../shared/schemas.js';
import type { SettingsDTO } from '../../../shared/api.js';
import type { Config } from '../../config.js';

export function settingsRoutes(deps: { settings: SettingsService; users: UserService; hebcal: HebcalGateway; config: Config }): Router {
  const { settings, users, hebcal, config } = deps;
  const r = Router();

  r.get('/settings', requireUser('admin'), async (req, res) => {
    const body: SettingsDTO = {
      settings: await settings.get(),
      hebcal: await hebcal.status(),
      baseUrl: baseUrl(req, config),
      publicUrlSet: !!config.publicUrl,
    };
    res.json(body);
  });

  r.put('/settings', requireUser('admin'), async (req, res) => {
    const changed = await settings.update(currentUser(req), parse(settingsSchema, req.body));
    res.json({ changed, settings: await settings.get() });
  });

  r.get('/activity', requireUser('admin'), async (req, res) => {
    const result = await settings.activity(currentUser(req), req.query as Record<string, string>);
    res.json({ ...result, names: await users.names() });
  });

  r.get('/backup', requireUser('admin'), async (req, res) => {
    const file = await settings.backupNow(currentUser(req));
    res.download(file, `calendar-backup-${new Date().toISOString().slice(0, 10)}.sqlite`, () => fs.rmSync(file, { force: true }));
  });

  return r;
}
