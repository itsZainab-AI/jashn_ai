'use strict';

const rateLimit = require('express-rate-limit');
const { randomUUID } = require('node:crypto');
const { validate, buildBudget, buildTimeline, buildChecklist } = require('../planner');
const { getIdeas } = require('../gemini');
const { getVenueRecommendations } = require('../venues');
const rsvp = require('../rsvp');
const database = require('../database');
const { statements } = database;
const { asyncHandler } = require('../session');

/**
 * Registers event-planning endpoints.
 * @param {import('express').Application} app Express application.
 * @returns {void}
 */
function registerPlannerRoutes(app) {
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  app.post(
    '/api/plan',
    rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false }),
    asyncHandler(async (req, res) => {
      const check = validate(req.body);
      if (!check.ok) return res.status(400).json({ errors: check.errors });
      const v = check.value;
      const [ai, venues] = await Promise.all([
        getIdeas(v),
        getVenueRecommendations(v).catch((err) => {
          console.error('Venue recommendations unavailable:', err.message);
          return { available: false, items: [], reason: 'search_unavailable' };
        }),
      ]);
      const createPlan = database.db.transaction(() => {
        const invite = rsvp.create(
          {
            title: `${v.type[0].toUpperCase()}${v.type.slice(1)} celebration`,
            date: v.date.toISOString().slice(0, 10),
            city: v.city,
          },
          req.user?.id || null,
        );
        const plan = {
          event: {
            type: v.type,
            guests: v.guests,
            date: v.date.toISOString().slice(0, 10),
            city: v.city,
            tone: v.tone,
          },
          invite,
          budget: buildBudget(v.type, v.budget, v.guests),
          timeline: buildTimeline(v.type, v.date),
          checklist: buildChecklist(v.type),
          ai,
          venues,
        };
        if (req.user) {
          const planId = randomUUID();
          statements.createPlan.run(
            planId,
            req.user.id,
            plan.event.type,
            plan.event.date,
            plan.event.city,
            JSON.stringify({ ...plan, invite: { id: invite.id } }),
            new Date().toISOString(),
          );
          plan.planId = planId;
        }
        return plan;
      });
      const plan = createPlan();
      res.json(plan);
    }),
  );
}

module.exports = registerPlannerRoutes;
