'use strict';
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { validate, buildBudget, buildTimeline, buildChecklist, clean } = require('./src/planner');
const { getIdeas } = require('./src/gemini');
const { getVenueRecommendations } = require('./src/venues');
const rsvp = require('./src/rsvp');
const database = require('./src/database');
const { statements } = database;
const { hashPassword, verifyPassword, createSessionToken, createJwt, verifyJwt, hashToken, SESSION_COOKIE, SESSION_DAYS } = require('./src/auth');
const emailService = require('./src/email');

const app = express();
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
const VERIFICATION_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_MS = 60 * 60 * 1000;
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

function readBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return '';
  return auth.slice(7).trim();
}

function issueJwtForUser(user) {
  return createJwt({ sub: user.id, name: user.name, email: user.email }, 60 * 60 * 24 * 7);
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

function emailMessage({ name, link, purpose }) {
  const verification = purpose === 'email_verification';
  const heading = verification ? 'Verify your Jashn email' : 'Reset your Jashn password';
  const action = verification ? 'Verify email address' : 'Reset password';
  const text = `Hi ${name},\n\n${verification ? 'Please verify your email address to finish creating your Jashn account.' : 'We received a request to reset your Jashn password.'}\n\n${action}: ${link}\n\nThis link expires in ${verification ? '24 hours' : '1 hour'}. If you did not request this, you can ignore this email.\n`;
  const safeName = name.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  const safeLink = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = `<p>Hi ${safeName},</p><p>${verification ? 'Please verify your email address to finish creating your Jashn account.' : 'We received a request to reset your Jashn password.'}</p><p><a href="${safeLink}">${action}</a></p><p>This link expires in ${verification ? '24 hours' : '1 hour'}. If you did not request this, you can ignore this email.</p>`;
  return { subject: heading, text, html };
}

function savedPlanEvent(saved) {
  return JSON.parse(saved.plan_json).invite.id;
}

async function sendAccountLink(user, purpose, token) {
  const flow = purpose === 'email_verification' ? 'verify' : 'reset';
  const link = emailService.accountLink(flow, token);
  await emailService.sendAccountEmail({ to: user.email, ...emailMessage({ name: user.name, link, purpose }) });
}

app.use('/api', (req, _res, next) => {
  let user = null;
  const bearerToken = readBearerToken(req);
  if (bearerToken) {
    try {
      const payload = verifyJwt(bearerToken);
      user = { id: payload.sub, name: payload.name, email: payload.email };
      req.jwtToken = bearerToken;
    } catch {
      req.jwtToken = null;
    }
  }
  if (!user) {
    const token = readCookie(req, SESSION_COOKIE);
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
      const tokenHash = hashToken(token);
      user = statements.getSessionUser.get(tokenHash, Date.now());
      if (user) {
        req.sessionTokenHash = tokenHash;
      } else statements.deleteSession.run(tokenHash);
    }
  }
  req.user = user;
  next();
});

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'Too many account attempts. Please wait a little and try again.' }),
});

app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

app.post('/api/auth/register', authLimiter, asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const demoMode = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';
  if (!name || /[\u0000-\u001f\u007f<>]/.test(name) || name.length > 80) {
    return res.status(400).json({ error: 'Enter a name up to 80 characters.' });
  }
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }
  if (!emailService.isConfigured() && !demoMode) {
    return res.status(503).json({ error: 'Email is not configured yet. Add SMTP settings and APP_URL before creating an account.' });
  }

  const id = randomUUID();
  const token = randomBytes(32).toString('hex');
  try {
    const passwordHash = await hashPassword(password);
    database.db.transaction(() => {
      statements.createUser.run(id, name, email, passwordHash, new Date().toISOString());
      statements.deleteExpiredAccountTokens.run(Date.now());
      if (!demoMode) {
        statements.createAccountToken.run(hashToken(token), id, 'email_verification', Date.now() + VERIFICATION_MS, new Date().toISOString());
      }
    })();
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    throw error;
  }

  const userRecord = { id, name, email };
  if (demoMode) {
    database.db.transaction(() => {
      statements.verifyUser.run(new Date().toISOString(), id);
    })();
    const jwt = issueJwtForUser(userRecord);
    setSessionCookie(res, createSessionToken());
    return res.status(201).json({
      message: 'Demo mode is active — your account is ready to use immediately.',
      user: publicUser(userRecord),
      token: jwt,
    });
  }

  try {
    await sendAccountLink({ id, name, email }, 'email_verification', token);
  } catch (error) {
    statements.deleteUser.run(id);
    console.error('Verification email delivery failed:', error.name || 'Error');
    return res.status(503).json({ error: 'We could not send your verification email. Check the email settings and try again.' });
  }
  res.status(202).json({ message: 'Check your inbox for a verification link to finish creating your account.' });
}));

app.post('/api/auth/login', authLimiter, asyncHandler(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const demoMode = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';
  const user = email.length <= 254 ? statements.getUserByEmail.get(email) : null;
  const passwordHash = user ? user.password_hash : await dummyPasswordHash;
  const valid = password.length <= 128 && await verifyPassword(password, passwordHash);
  if (!user || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (!user.emailVerifiedAt && !demoMode) return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Verify your email address before logging in.' });

  const token = createSessionToken();
  const expiresAt = Date.now() + SESSION_MS;
  statements.deleteExpiredSessions.run(Date.now());
  statements.createSession.run(hashToken(token), user.id, expiresAt, new Date().toISOString());
  setSessionCookie(res, token);
  res.json({ user: publicUser(user), token: issueJwtForUser(user) });
}));

app.post('/api/auth/verify-email', authLimiter, (req, res) => {
  const token = typeof req.body?.token === 'string' && /^[a-f0-9]{64}$/i.test(req.body.token) ? req.body.token : '';
  const record = token ? statements.getAccountToken.get(hashToken(token), Date.now()) : null;
  if (!record || record.purpose !== 'email_verification') {
    return res.status(400).json({ error: 'This verification link is invalid or expired. Request a fresh link and try again.' });
  }
  const sessionToken = createSessionToken();
  const expiresAt = Date.now() + SESSION_MS;
  database.db.transaction(() => {
    statements.verifyUser.run(new Date().toISOString(), record.id);
    statements.deleteAccountToken.run(hashToken(token));
    statements.deleteExpiredSessions.run(Date.now());
    statements.createSession.run(hashToken(sessionToken), record.id, expiresAt, new Date().toISOString());
  })();
  setSessionCookie(res, sessionToken);
  res.json({ user: publicUser(record) });
});

app.post('/api/auth/verification/resend', authLimiter, asyncHandler(async (req, res) => {
  if (!emailService.isConfigured()) {
    return res.status(503).json({ error: 'Email is not configured yet. Add SMTP settings and APP_URL to send a verification link.' });
  }
  const address = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const user = address.length <= 254 ? statements.getUserByEmail.get(address) : null;
  if (!user || user.emailVerifiedAt) {
    return res.json({ message: 'If that account needs verification, a fresh link will arrive shortly.' });
  }
  const token = randomBytes(32).toString('hex');
  statements.deleteExpiredAccountTokens.run(Date.now());
  statements.deleteAccountTokens.run(user.id, 'email_verification');
  statements.createAccountToken.run(hashToken(token), user.id, 'email_verification', Date.now() + VERIFICATION_MS, new Date().toISOString());
  try {
    await sendAccountLink(user, 'email_verification', token);
  } catch (error) {
    statements.deleteAccountToken.run(hashToken(token));
    console.error('Verification email delivery failed:', error.name || 'Error');
  }
  res.json({ message: 'If that account needs verification, a fresh link will arrive shortly.' });
}));

app.post('/api/auth/password-reset/request', authLimiter, asyncHandler(async (req, res) => {
  if (!emailService.isConfigured()) {
    return res.status(503).json({ error: 'Email is not configured yet. Add SMTP settings and APP_URL to send a reset link.' });
  }
  const address = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const user = address.length <= 254 ? statements.getUserByEmail.get(address) : null;
  if (user?.emailVerifiedAt && emailService.isConfigured()) {
    const token = randomBytes(32).toString('hex');
    statements.deleteExpiredAccountTokens.run(Date.now());
    statements.deleteAccountTokens.run(user.id, 'password_reset');
    statements.createAccountToken.run(hashToken(token), user.id, 'password_reset', Date.now() + PASSWORD_RESET_MS, new Date().toISOString());
    try {
      await sendAccountLink(user, 'password_reset', token);
    } catch (error) {
      statements.deleteAccountToken.run(hashToken(token));
      console.error('Password reset email delivery failed:', error.name || 'Error');
    }
  }
  res.status(202).json({ message: 'If a verified account exists for that address, a password reset link will arrive shortly.' });
}));

app.post('/api/auth/password-reset/complete', authLimiter, asyncHandler(async (req, res) => {
  const token = typeof req.body?.token === 'string' && /^[a-f0-9]{64}$/i.test(req.body.token) ? req.body.token : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
  }
  const tokenHash = token ? hashToken(token) : '';
  const record = token ? statements.getAccountToken.get(tokenHash, Date.now()) : null;
  if (!record || record.purpose !== 'password_reset' || !record.emailVerifiedAt) {
    return res.status(400).json({ error: 'This reset link is invalid or expired. Request a fresh link and try again.' });
  }
  const passwordHash = await hashPassword(password);
  database.db.transaction(() => {
    statements.updatePassword.run(passwordHash, record.id);
    statements.deleteAccountToken.run(tokenHash);
    statements.deleteAccountTokens.run(record.id, 'email_verification');
    statements.deleteUserSessions.run(record.id);
  })();
  res.json({ message: 'Password updated. Please log in with your new password.' });
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

app.post('/api/plans/:id/invites', requireAuth, rateLimit({
  windowMs: 10 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
}), asyncHandler(async (req, res) => {
  const saved = statements.getPlan.get(req.params.id, req.user.id);
  if (!saved) return res.status(404).json({ error: 'Saved celebration not found.' });
  if (!emailService.isConfigured()) return res.status(503).json({ error: 'Email invitations are not configured. Copy the RSVP link instead.' });
  const guestName = clean(req.body?.name, 80);
  const guestEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!guestName || guestEmail.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(guestEmail)) {
    return res.status(400).json({ error: 'Enter a valid guest name and email address.' });
  }
  const progressRow = statements.getPlanProgress.get(req.params.id);
  const guestIsListed = progressRow && JSON.parse(progressRow.guests).some((guest) =>
    guest.name === guestName && guest.email === guestEmail);
  if (!guestIsListed) return res.status(400).json({ error: 'Add this guest and email to your host list before sending an invitation.' });
  const event = rsvp.getPublicEvent(savedPlanEvent(saved));
  if (!event) return res.status(404).json({ error: 'RSVP event not found.' });
  const link = emailService.invitationLink(savedPlanEvent(saved));
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
  const safeName = escapeHtml(guestName);
  const safeTitle = escapeHtml(event.title);
  const eventDetails = [event.date && ` on ${event.date}`, event.city && ` in ${event.city}`].filter(Boolean).join('');
  const safeEventDetails = escapeHtml(eventDetails);
  const safeLink = link.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  try {
    await emailService.sendAccountEmail({
      to: guestEmail,
      subject: `You're invited: ${event.title}`,
      text: `Hi ${guestName},\n\nYou're invited to ${event.title}${eventDetails}.\n\nView the invitation and RSVP here: ${link}\n`,
      html: `<p>Hi ${safeName},</p><p>You're invited to <strong>${safeTitle}</strong>${safeEventDetails}.</p><p><a href="${safeLink}">View invitation and RSVP</a></p>`,
    });
  } catch (error) {
    console.error('Invitation email delivery failed:', error.name || 'Error');
    return res.status(503).json({ error: 'Could not send the invitation. Check your email settings and try again.' });
  }
  res.json({ ok: true, message: 'Invitation sent.' });
}));

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
      || (guest.email !== undefined && (typeof guest.email !== 'string' || guest.email.length > 254
        || (guest.email !== '' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(guest.email))))
      || !['pending', 'attending', 'declined'].includes(guest.status))) {
    return res.status(400).json({ error: 'Guest list is invalid or too large. Keep up to 40 named guests with valid email addresses.' });
  }
  const hostGuests = guests.map((guest) => ({
    name: clean(guest.name, 80),
    ...(typeof guest.email === 'string' && guest.email.trim() ? { email: guest.email.trim().toLowerCase() } : {}),
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

app.use((err, _req, res, _next) => {
  console.error('Request failed:', err.name || 'Error');
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  res.status(status).json({ errors: ['Something went wrong. Try again.'] });
});

if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Jashn is live on http://localhost:' + (process.env.PORT || 3000)));
module.exports = app;
