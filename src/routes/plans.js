'use strict';

const database = require('../database');
const { statements } = database;
const rsvp = require('../rsvp');
const { clean } = require('../planner');
const { savedPlanEvent } = require('../plan-utils');
const { requireAuth } = require('../session');

/**
 * Registers saved-plan and progress endpoints.
 * @param {import('express').Application} app Express application.
 * @returns {void}
 */
function registerPlanRoutes(app) {
  app.get('/api/plans', requireAuth, (req, res) => {
    res.json({ plans: statements.listPlans.all(req.user.id) });
  });

  app.get('/api/plans/:id', requireAuth, (req, res) => {
    const saved = statements.getPlan.get(req.params.id, req.user.id);
    if (!saved) return res.status(404).json({ error: 'Saved celebration not found.' });
    res.json({ ...JSON.parse(saved.plan_json), planId: saved.id });
  });

  app.get('/api/plans/:id/guests', requireAuth, (req, res) => {
    const saved = statements.getPlan.get(req.params.id, req.user.id);
    if (!saved) return res.status(404).json({ error: 'Saved celebration not found.' });
    const eventId = savedPlanEvent(saved);
    const guests = rsvp.getGuestsForOwner(eventId);
    if (!guests) return res.status(404).json({ error: 'RSVP event not found.' });
    res.json({ guests });
  });

  app.put('/api/plans/:id/guests/:guestId', requireAuth, (req, res) => {
    const saved = statements.getPlan.get(req.params.id, req.user.id);
    if (!saved) return res.status(404).json({ error: 'Saved celebration not found.' });
    const result = rsvp.updateResponse(savedPlanEvent(saved), Number(req.params.guestId), req.body);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  });

  app.delete('/api/plans/:id/guests/:guestId', requireAuth, (req, res) => {
    const saved = statements.getPlan.get(req.params.id, req.user.id);
    if (!saved) return res.status(404).json({ error: 'Saved celebration not found.' });
    const result = rsvp.deleteResponse(savedPlanEvent(saved), Number(req.params.guestId));
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json({ ok: true });
  });

  app.get('/api/plans/:id/progress', requireAuth, (req, res) => {
    const saved = statements.getPlan.get(req.params.id, req.user.id);
    if (!saved) return res.status(404).json({ error: 'Saved celebration not found.' });
    const row = statements.getPlanProgress.get(req.params.id);
    res.json({
      progress: row
        ? { checkedChecklist: JSON.parse(row.checkedChecklist), guests: JSON.parse(row.guests) }
        : { checkedChecklist: [], guests: [] },
    });
  });

  app.put('/api/plans/:id/progress', requireAuth, (req, res) => {
    const saved = statements.getPlan.get(req.params.id, req.user.id);
    if (!saved) return res.status(404).json({ error: 'Saved celebration not found.' });
    const checklist = JSON.parse(saved.plan_json).checklist;
    const checkedChecklist = req.body?.checkedChecklist;
    const guests = req.body?.guests;
    const allowedIds = new Set(checklist.map((item) => item.id));
    if (
      !Array.isArray(checkedChecklist) ||
      checkedChecklist.some((id) => !Number.isInteger(id) || !allowedIds.has(id)) ||
      new Set(checkedChecklist).size !== checkedChecklist.length
    ) {
      return res
        .status(400)
        .json({ error: 'Checklist progress is invalid. Reload this plan and try again.' });
    }
    if (
      !Array.isArray(guests) ||
      guests.length > 40 ||
      guests.some(
        (guest) =>
          !guest ||
          typeof guest !== 'object' ||
          typeof guest.name !== 'string' ||
          !clean(guest.name, 80) ||
          (guest.email !== undefined &&
            (typeof guest.email !== 'string' ||
              guest.email.length > 254 ||
              (guest.email !== '' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(guest.email)))) ||
          !['pending', 'attending', 'declined'].includes(guest.status),
      )
    ) {
      return res.status(400).json({
        error:
          'Guest list is invalid or too large. Keep up to 40 named guests with valid email addresses.',
      });
    }
    const hostGuests = guests.map((guest) => ({
      name: clean(guest.name, 80),
      ...(typeof guest.email === 'string' && guest.email.trim()
        ? { email: guest.email.trim().toLowerCase() }
        : {}),
      status: guest.status,
    }));
    statements.savePlanProgress.run(
      req.params.id,
      JSON.stringify(checkedChecklist),
      JSON.stringify(hostGuests),
      new Date().toISOString(),
    );
    res.json({ progress: { checkedChecklist, guests: hostGuests } });
  });
}

module.exports = registerPlanRoutes;
