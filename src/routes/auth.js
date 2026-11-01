'use strict';

const { randomBytes, randomUUID } = require('node:crypto');
const database = require('../database');
const { statements } = database;
const {
  hashPassword,
  verifyPassword,
  createSessionToken,
  hashToken,
  SESSION_COOKIE,
} = require('../auth');
const emailService = require('../email');
const {
  SESSION_MS,
  asyncHandler,
  issueJwtForUser,
  publicUser,
  setSessionCookie,
} = require('../session');
const { sendAccountLink } = require('../account-email');
const authLimiter = require('./auth-limiter');

/**
 * Registers account lifecycle endpoints on the Express application.
 * @param {import('express').Application} app Express application.
 * @returns {void}
 */
function registerAuthRoutes(app) {
  const VERIFICATION_MS = 24 * 60 * 60 * 1000;
  const dummyPasswordHash = hashPassword('not-a-real-user-password');
  app.get('/api/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

  app.post(
    '/api/auth/register',
    authLimiter,
    asyncHandler(async (req, res) => {
      const name =
        typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
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
        return res.status(503).json({
          error:
            'Email is not configured yet. Add SMTP settings and APP_URL before creating an account.',
        });
      }

      const id = randomUUID();
      const token = randomBytes(32).toString('hex');
      try {
        const passwordHash = await hashPassword(password);
        database.db.transaction(() => {
          statements.createUser.run(id, name, email, passwordHash, new Date().toISOString());
          statements.deleteExpiredAccountTokens.run(Date.now());
          if (!demoMode) {
            statements.createAccountToken.run(
              hashToken(token),
              id,
              'email_verification',
              Date.now() + VERIFICATION_MS,
              new Date().toISOString(),
            );
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
        return res.status(503).json({
          error:
            'We could not send your verification email. Check the email settings and try again.',
        });
      }
      res.status(202).json({
        message: 'Check your inbox for a verification link to finish creating your account.',
      });
    }),
  );

  app.post(
    '/api/auth/login',
    authLimiter,
    asyncHandler(async (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const demoMode = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';
      const user = email.length <= 254 ? statements.getUserByEmail.get(email) : null;
      const passwordHash = user ? user.password_hash : await dummyPasswordHash;
      const valid = password.length <= 128 && (await verifyPassword(password, passwordHash));
      if (!user || !valid)
        return res.status(401).json({ error: 'Email or password is incorrect.' });
      if (!user.emailVerifiedAt && !demoMode)
        return res.status(403).json({
          code: 'EMAIL_NOT_VERIFIED',
          error: 'Verify your email address before logging in.',
        });

      const token = createSessionToken();
      const expiresAt = Date.now() + SESSION_MS;
      statements.deleteExpiredSessions.run(Date.now());
      statements.createSession.run(hashToken(token), user.id, expiresAt, new Date().toISOString());
      setSessionCookie(res, token);
      res.json({ user: publicUser(user), token: issueJwtForUser(user) });
    }),
  );

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
}

module.exports = registerAuthRoutes;
