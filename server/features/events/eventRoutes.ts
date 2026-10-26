/**
 * Events API: upcoming list, CRUD, restore, history.
 */
import { Router } from 'express';
import type { EventService } from './eventService.js';
import type { FeedService } from '../feed/feedService.js';
import type { UserService } from '../users/userService.js';
import type { CalendarEvent } from './eventRepository.js';
import type { Actor } from '../users/userRepository.js';
import { currentUser, parse, requireUser } from '../../http/middleware.js';
import { eventInputSchema } from '../../../shared/schemas.js';
import { can } from '../../../shared/permissions.js';

const UPCOMING_RANGES = [30, 90, 365];

export function eventRoutes(deps: { events: EventService; feed: FeedService; users: UserService }): Router {
  const { events, feed, users } = deps;
  const r = Router();
  const id = (v: unknown) => Number(v);

  /** "Added by" names — only for events in calendars the actor manages. */
  const namesFor = (actor: Actor, list: CalendarEvent[]) =>
    users.names(list.filter(e => can(actor, 'manage', e.calendarId)).flatMap(e => [e.createdBy, e.updatedBy, e.deletedBy]));

  r.get('/upcoming', requireUser(), async (req, res) => {
    const days = UPCOMING_RANGES.includes(Number(req.query.days)) ? Number(req.query.days) : 90;
    const calendar = req.query.calendar ? Number(req.query.calendar) : null;
    res.json({ days, items: await feed.upcoming(currentUser(req), days, calendar) });
  });

  r.get('/events', requireUser(), async (req, res) => {
    const actor = currentUser(req);
    const list = await events.search(actor, req.query as Record<string, string>);
    res.json({ events: list, names: await namesFor(actor, list) });
  });

  r.get('/events/:id', requireUser(), async (req, res) => {
    const actor = currentUser(req);
    const event = await events.getForEdit(actor, id(req.params.id));
    res.json({ event, names: await namesFor(actor, [event]) });
  });

  r.post('/events', requireUser(), async (req, res) => {
    const event = await events.create(currentUser(req), parse(eventInputSchema, req.body));
    res.status(201).json({ event });
  });

  r.put('/events/:id', requireUser(), async (req, res) => {
    res.json(await events.update(currentUser(req), id(req.params.id), parse(eventInputSchema, req.body)));
  });

  r.delete('/events/:id', requireUser(), async (req, res) => {
    res.json({ event: await events.remove(currentUser(req), id(req.params.id)) });
  });

  r.post('/events/:id/restore', requireUser(), async (req, res) => {
    res.json({ event: await events.restore(currentUser(req), id(req.params.id)) });
  });

  r.get('/events/:id/history', requireUser(), async (req, res) => {
    const { event, entries } = await events.history(currentUser(req), id(req.params.id));
    res.json({ event, entries, names: await users.names(entries.map(e => e.actorId)) });
  });

  return r;
}
