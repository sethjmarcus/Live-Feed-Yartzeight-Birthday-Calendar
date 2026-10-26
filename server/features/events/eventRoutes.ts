/**
 * Events API: upcoming list, CRUD, restore, history.
 */
import { Router } from 'express';
import type { EventService } from './eventService.js';
import type { FeedService } from '../feed/feedService.js';
import type { UserService } from '../users/userService.js';
import { currentUser, parse, requireUser } from '../../http/middleware.js';
import { eventInputSchema } from '../../../shared/schemas.js';
import { can } from '../../../shared/permissions.js';

const UPCOMING_RANGES = [30, 90, 365];

export function eventRoutes(deps: { events: EventService; feed: FeedService; users: UserService }): Router {
  const { events, feed, users } = deps;
  const r = Router();
  const id = (v: unknown) => Number(v);

  r.get('/upcoming', requireUser('view'), async (req, res) => {
    const days = UPCOMING_RANGES.includes(Number(req.query.days)) ? Number(req.query.days) : 90;
    res.json({ days, items: await feed.upcoming(currentUser(req), days) });
  });

  r.get('/events', requireUser('view'), async (req, res) => {
    const user = currentUser(req);
    const list = await events.search(user, req.query as Record<string, string>);
    res.json({ events: list, names: can(user, 'admin') ? await users.names() : {} });
  });

  r.get('/events/:id', requireUser(), async (req, res) => {
    const user = currentUser(req);
    const event = await events.getForEdit(user, id(req.params.id));
    res.json({ event, names: can(user, 'admin') ? await users.names() : {} });
  });

  r.post('/events', requireUser('add'), async (req, res) => {
    const event = await events.create(currentUser(req), parse(eventInputSchema, req.body));
    res.status(201).json({ event });
  });

  r.put('/events/:id', requireUser(), async (req, res) => {
    res.json(await events.update(currentUser(req), id(req.params.id), parse(eventInputSchema, req.body)));
  });

  r.delete('/events/:id', requireUser(), async (req, res) => {
    res.json({ event: await events.remove(currentUser(req), id(req.params.id)) });
  });

  r.post('/events/:id/restore', requireUser('admin'), async (req, res) => {
    res.json({ event: await events.restore(currentUser(req), id(req.params.id)) });
  });

  r.get('/events/:id/history', requireUser('admin'), async (req, res) => {
    const { event, entries } = await events.history(currentUser(req), id(req.params.id));
    res.json({ event, entries, names: await users.names() });
  });

  return r;
}
