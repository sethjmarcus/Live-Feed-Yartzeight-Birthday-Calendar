/**
 * Public, token-authenticated routes: the .ics feed phones poll, and the data
 * behind the one-tap subscribe page (/s/:token).
 */
import { Router } from 'express';
import type { FeedService } from './feedService.js';
import type { UserService } from '../users/userService.js';
import type { SettingsService } from '../settings/settingsService.js';
import { baseUrl, feedLinks } from '../../http/links.js';
import { NotFoundError } from '../../http/errors.js';
import type { Config } from '../../config.js';

/** Mounted at the site root: GET /feed/<token>.ics */
export function feedRoutes(deps: { feed: FeedService; users: UserService; settings: SettingsService }): Router {
  const { feed, users, settings } = deps;
  const r = Router();
  r.get('/feed/:file', async (req, res) => {
    const token = String(req.params.file).replace(/\.ics$/, '');
    const user = await users.bySubscribeToken(token);
    if (!user) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const body = await feed.buildFeed(user);
    await users.recordFeedFetch(user, req.get('user-agent'));
    const filename = (await settings.get()).calendarName.replace(/[^\w.-]+/g, '_') || 'calendar';
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${filename}.ics"`,
      'Cache-Control': 'no-cache, max-age=0',
    }).send(body);
  });
  return r;
}

/** Mounted under /api: GET /api/public/subscribe/<token> */
export function publicSubscribeRoutes(deps: { users: UserService; settings: SettingsService; config: Config }): Router {
  const { users, settings, config } = deps;
  const r = Router();
  r.get('/public/subscribe/:token', async (req, res) => {
    const user = await users.bySubscribeToken(String(req.params.token));
    if (!user) throw new NotFoundError('This calendar link is not valid any more. Ask the admin for a new one.');
    res.json({
      displayName: user.displayName,
      calendarName: (await settings.get()).calendarName,
      links: feedLinks(baseUrl(req, config), user.feedToken),
    });
  });
  return r;
}
