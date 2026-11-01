'use strict';

const rateLimit = require('express-rate-limit');
const rsvp = require('../rsvp');

/**
 * Registers public RSVP endpoints.
 * @param {import('express').Application} app Express application.
 * @returns {void}
 */
function registerRsvpRoutes(app) {
  app.get('/api/rsvp/:id', (req, res) => {
    const event = rsvp.getPublicEvent(req.params.id);
    if (!event) return res.status(404).json({ error: 'This RSVP link is no longer available.' });
    res.json(event);
  });

  app.post(
    '/api/rsvp/:id',
    rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }),
    (req, res) => {
      const result = rsvp.respond(req.params.id, req.body);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      res.status(201).json({ ok: true });
    },
  );

  app.get('/api/rsvp/:id/guests', (req, res) => {
    const guests = rsvp.getGuests(req.params.id, req.get('x-manage-token'));
    if (!guests) return res.status(403).json({ error: 'Guest list access denied.' });
    res.json({ guests });
  });

  app.put('/api/rsvp/:id/guests/:guestId', (req, res) => {
    if (!rsvp.getGuests(req.params.id, req.get('x-manage-token'))) {
      return res.status(403).json({ error: 'Guest list access denied.' });
    }
    const result = rsvp.updateResponse(req.params.id, Number(req.params.guestId), req.body);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  });

  app.delete('/api/rsvp/:id/guests/:guestId', (req, res) => {
    if (!rsvp.getGuests(req.params.id, req.get('x-manage-token'))) {
      return res.status(403).json({ error: 'Guest list access denied.' });
    }
    const result = rsvp.deleteResponse(req.params.id, Number(req.params.guestId));
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  });
}

module.exports = registerRsvpRoutes;
