'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { validate, buildBudget, buildTimeline, buildChecklist, clean } = require('./src/planner');
const { getIdeas } = require('./src/gemini');
const { getVenueRecommendations } = require('./src/venues');
const rsvp = require('./src/rsvp');
const database = require('./src/database');
const { statements } = database;
const { hashPassword, verifyPassword, createSessionToken, hashToken, SESSION_COOKIE, SESSION_DAYS } = require('./src/auth');

const app = express();
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const dummyPasswordHash = hashPassword('not-a-real-user-password');
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
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
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readCookie(req, name) {
  const cookies = req.headers.cookie || '';
  for (const part of cookies.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return '';
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MS,
  });
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

app.use('/api', (req, _res, next) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const tokenHash = hashToken(token);
    const user = statements.getSessionUser.get(tokenHash, Date.now());
    if (user) {
      req.user = user;
      req.sessionTokenHash = tokenHash;
    } else statements.deleteSession.run(tokenHash);
  }
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many account attempts. Please wait a little and try again.' }),
});

app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

app.post('/api/auth/register', authLimiter, asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!name || /[\u0000-\u001f\u007f<>]/.test(name) || name.length > 80) {
    return res.status(400).json({ error: 'Enter a name up to 80 characters.' });
  }
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }

  const id = randomUUID();
  const token = createSessionToken();
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + SESSION_MS;
  try {
    const passwordHash = await hashPassword(password);
    database.db.transaction(() => {
      statements.createUser.run(id, name, email, passwordHash, new Date().toISOString());
      statements.deleteExpiredSessions.run(Date.now());
      statements.createSession.run(tokenHash, id, expiresAt, new Date().toISOString());
    })();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    throw error;
  }

  setSessionCookie(res, token);
  res.status(201).json({ user: { id, name, email } });
}));

app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = email.length <= 254 ? statements.getUserByEmail.get(email) : null;
  const passwordHash = user ? user.password_hash : await dummyPasswordHash;
  const valid = password.length <= 128 && await verifyPassword(password, passwordHash);
  if (!user || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' });

  const token = createSessionToken();
  const expiresAt = Date.now() + SESSION_MS;
  statements.deleteExpiredSessions.run(Date.now());
  statements.createSession.run(hashToken(token), user.id, expiresAt, new Date().toISOString());
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  if (req.sessionTokenHash) statements.deleteSession.run(req.sessionTokenHash);
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
  res.status(204).end();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in to access your account.' });
  next();
}

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
  const eventId = JSON.parse(saved.plan_json).invite.id;
  const guests = rsvp.getGuestsForOwner(eventId);
  if (!guests) return res.status(404).json({ error: 'RSVP event not found.' });
  res.json({ guests });
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
  if (!Array.isArray(checkedChecklist)
    || checkedChecklist.some((id) => !Number.isInteger(id) || !allowedIds.has(id))
    || new Set(checkedChecklist).size !== checkedChecklist.length) {
    return res.status(400).json({ error: 'Checklist progress is invalid. Reload this plan and try again.' });
  }
  if (!Array.isArray(guests) || guests.length > 40
    || guests.some((guest) => !guest || typeof guest !== 'object'
      || typeof guest.name !== 'string' || !clean(guest.name, 80)
      || !['pending', 'attending', 'declined'].includes(guest.status))) {
    return res.status(400).json({ error: 'Guest list is invalid or too large. Keep up to 40 named guests.' });
  }
  const hostGuests = guests.map((guest) => ({ name: clean(guest.name, 80), status: guest.status }));
  statements.savePlanProgress.run(
    req.params.id,
    JSON.stringify(checkedChecklist),
    JSON.stringify(hostGuests),
    new Date().toISOString(),
  );
  res.json({ progress: { checkedChecklist, guests: hostGuests } });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/plan', rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false }), asyncHandler(async (req, res) => {
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
    const invite = rsvp.create({
      title: `${v.type[0].toUpperCase()}${v.type.slice(1)} celebration`,
      date: v.date.toISOString().slice(0, 10),
      city: v.city,
    }, req.user?.id || null);
    const plan = {
      event: { type: v.type, guests: v.guests, date: v.date.toISOString().slice(0, 10), city: v.city, tone: v.tone },
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
}));

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

app.use((err, _req, res, _next) => {
  console.error('Request failed:', err.name || 'Error');
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ errors: ['Something went wrong. Try again.'] });
});

if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Jashn is live on http://localhost:' + (process.env.PORT || 3000)));
module.exports = app;
