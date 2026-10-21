'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const { validate, buildBudget, buildTimeline, buildChecklist } = require('./src/planner');
const { getIdeas } = require('./src/gemini');
const { getVenueRecommendations } = require('./src/venues');
const rsvp = require('./src/rsvp');

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    styleSrc: ["'self'", 'https://fonts.googleapis.com'],
    fontSrc: ['https://fonts.gstatic.com'],
    scriptSrc: ["'self'"],
    connectSrc: ["'self'"],
    imgSrc: ["'self'", 'https://*.googleusercontent.com'],
  } },
}));
app.use(express.json({ limit: '5kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/plan', rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
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
  const invite = rsvp.create({
    title: `${v.type[0].toUpperCase()}${v.type.slice(1)} celebration`,
    date: v.date.toISOString().slice(0, 10),
    city: v.city,
  });
  res.json({
    event: { type: v.type, guests: v.guests, date: v.date.toISOString().slice(0, 10), city: v.city, tone: v.tone },
    invite,
    budget: buildBudget(v.type, v.budget, v.guests),
    timeline: buildTimeline(v.type, v.date),
    checklist: buildChecklist(v.type),
    ai,
    venues,
  });
});

app.get('/api/rsvp/:id', (req, res) => {
  const event = rsvp.getPublicEvent(req.params.id);
  if (!event) return res.status(404).json({ error: 'This RSVP link is no longer available.' });
  res.json(event);
});

app.post('/api/rsvp/:id', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), (req, res) => {
  const result = rsvp.respond(req.params.id, req.body);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json({ ok: true });
});

app.get('/api/rsvp/:id/guests', (req, res) => {
  const guests = rsvp.getGuests(req.params.id, req.get('x-manage-token'));
  if (!guests) return res.status(403).json({ error: 'Guest list access denied.' });
  res.json({ guests });
});

app.use((err, _req, res, _next) => res.status(err.status === 400 ? 400 : 500).json({ errors: ['Something went wrong. Try again.'] }));

if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Jashn is live on http://localhost:' + (process.env.PORT || 3000)));
module.exports = app;
