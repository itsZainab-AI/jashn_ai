'use strict';

const { randomBytes } = require('node:crypto');
const database = require('../database');
const { statements } = database;
const { hashPassword, createSessionToken, hashToken } = require('../auth');
const emailService = require('../email');
const { SESSION_MS, asyncHandler, publicUser, setSessionCookie } = require('../session');
const { sendAccountLink } = require('../account-email');
const authLimiter = require('./auth-limiter');

/**
 * Registers email verification and password-recovery endpoints.
 * @param {import('express').Application} app Express application.
 * @returns {void}
 */
function registerAccountLinkRoutes(app) {
  const VERIFICATION_MS = 24 * 60 * 60 * 1000;
  const PASSWORD_RESET_MS = 60 * 60 * 1000;
  app.post('/api/auth/verify-email', authLimiter, (req, res) => {
    const token =
      typeof req.body?.token === 'string' && /^[a-f0-9]{64}$/i.test(req.body.token)
        ? req.body.token
        : '';
    const record = token ? statements.getAccountToken.get(hashToken(token), Date.now()) : null;
    if (!record || record.purpose !== 'email_verification') {
      return res.status(400).json({
        error: 'This verification link is invalid or expired. Request a fresh link and try again.',
      });
    }
    const sessionToken = createSessionToken();
    const expiresAt = Date.now() + SESSION_MS;
    database.db.transaction(() => {
      statements.verifyUser.run(new Date().toISOString(), record.id);
      statements.deleteAccountToken.run(hashToken(token));
      statements.deleteExpiredSessions.run(Date.now());
      statements.createSession.run(
        hashToken(sessionToken),
        record.id,
        expiresAt,
        new Date().toISOString(),
      );
    })();
    setSessionCookie(res, sessionToken);
    res.json({ user: publicUser(record) });
  });

  app.post(
    '/api/auth/verification/resend',
    authLimiter,
    asyncHandler(async (req, res) => {
      if (!emailService.isConfigured()) {
        return res.status(503).json({
          error:
            'Email is not configured yet. Add SMTP settings and APP_URL to send a verification link.',
        });
      }
      const address =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const user = address.length <= 254 ? statements.getUserByEmail.get(address) : null;
      if (!user || user.emailVerifiedAt) {
        return res.json({
          message: 'If that account needs verification, a fresh link will arrive shortly.',
        });
      }
      const token = randomBytes(32).toString('hex');
      statements.deleteExpiredAccountTokens.run(Date.now());
      statements.deleteAccountTokens.run(user.id, 'email_verification');
      statements.createAccountToken.run(
        hashToken(token),
        user.id,
        'email_verification',
        Date.now() + VERIFICATION_MS,
        new Date().toISOString(),
      );
      try {
        await sendAccountLink(user, 'email_verification', token);
      } catch (error) {
        statements.deleteAccountToken.run(hashToken(token));
        console.error('Verification email delivery failed:', error.name || 'Error');
      }
      res.json({
        message: 'If that account needs verification, a fresh link will arrive shortly.',
      });
    }),
  );

  app.post(
    '/api/auth/password-reset/request',
    authLimiter,
    asyncHandler(async (req, res) => {
      if (!emailService.isConfigured()) {
        return res.status(503).json({
          error: 'Email is not configured yet. Add SMTP settings and APP_URL to send a reset link.',
        });
      }
      const address =
        typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const user = address.length <= 254 ? statements.getUserByEmail.get(address) : null;
      if (user?.emailVerifiedAt && emailService.isConfigured()) {
        const token = randomBytes(32).toString('hex');
        statements.deleteExpiredAccountTokens.run(Date.now());
        statements.deleteAccountTokens.run(user.id, 'password_reset');
        statements.createAccountToken.run(
          hashToken(token),
          user.id,
          'password_reset',
          Date.now() + PASSWORD_RESET_MS,
          new Date().toISOString(),
        );
        try {
          await sendAccountLink(user, 'password_reset', token);
        } catch (error) {
          statements.deleteAccountToken.run(hashToken(token));
          console.error('Password reset email delivery failed:', error.name || 'Error');
        }
      }
      res.status(202).json({
        message:
          'If a verified account exists for that address, a password reset link will arrive shortly.',
      });
    }),
  );

  app.post(
    '/api/auth/password-reset/complete',
    authLimiter,
    asyncHandler(async (req, res) => {
      const token =
        typeof req.body?.token === 'string' && /^[a-f0-9]{64}$/i.test(req.body.token)
          ? req.body.token
          : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (password.length < 8 || password.length > 128) {
        return res.status(400).json({ error: 'Password must be between 8 and 128 characters.' });
      }
      const tokenHash = token ? hashToken(token) : '';
      const record = token ? statements.getAccountToken.get(tokenHash, Date.now()) : null;
      if (!record || record.purpose !== 'password_reset' || !record.emailVerifiedAt) {
        return res.status(400).json({
          error: 'This reset link is invalid or expired. Request a fresh link and try again.',
        });
      }
      const passwordHash = await hashPassword(password);
      database.db.transaction(() => {
        statements.updatePassword.run(passwordHash, record.id);
        statements.deleteAccountToken.run(tokenHash);
        statements.deleteAccountTokens.run(record.id, 'email_verification');
        statements.deleteUserSessions.run(record.id);
      })();
      res.json({ message: 'Password updated. Please log in with your new password.' });
    }),
  );
}

module.exports = registerAccountLinkRoutes;
