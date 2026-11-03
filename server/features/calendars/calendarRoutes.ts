/**
 * Calendars API: list, create, rename, delete, and members.
 */
import { Router } from 'express';
import type { CalendarService } from './calendarService.js';
import { currentUser, parse, requireUser } from '../../http/middleware.js';
import { calendarSchema, memberSchema } from '../../../shared/schemas.js';

export function calendarRoutes(deps: { calendars: CalendarService }): Router {
  const { calendars } = deps;
  const r = Router();
  const id = (v: unknown) => Number(v);

  r.get('/calendars', requireUser(), async (req, res) => {
    res.json({ calendars: await calendars.overview(currentUser(req)) });
  });

  r.post('/calendars', requireUser(), async (req, res) => {
    const calendar = await calendars.create(currentUser(req), parse(calendarSchema, req.body).name);
    res.status(201).json({ calendar });
  });

  r.get('/calendars/:id', requireUser(), async (req, res) => {
    res.json(await calendars.detail(currentUser(req), id(req.params.id)));
  });

  r.put('/calendars/:id', requireUser(), async (req, res) => {
    res.json({ changed: await calendars.rename(currentUser(req), id(req.params.id), parse(calendarSchema, req.body).name) });
  });

  r.delete('/calendars/:id', requireUser(), async (req, res) => {
    await calendars.remove(currentUser(req), id(req.params.id));
    res.json({ ok: true });
  });

  r.put('/calendars/:id/members/:userId', requireUser(), async (req, res) => {
    const { permissions } = parse(memberSchema, req.body);
    await calendars.setMember(currentUser(req), id(req.params.id), id(req.params.userId), permissions);
    res.json({ ok: true });
  });

  r.delete('/calendars/:id/members/:userId', requireUser(), async (req, res) => {
    await calendars.removeMember(currentUser(req), id(req.params.id), id(req.params.userId));
    res.json({ ok: true });
  });

  return r;
}
