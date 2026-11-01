'use strict';

const database = require('./database');
const { createJwt, hashToken, SESSION_COOKIE, SESSION_DAYS, verifyJwt } = require('./auth');

const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

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

/**
 * Creates a signed session JWT for a user.
 * @param {{id: string, name: string, email: string}} user User record.
 * @returns {string} Signed JWT.
 */
function issueJwtForUser(user) {
  return createJwt(
    { sub: user.id, name: user.name, email: user.email },
    SESSION_DAYS * 24 * 60 * 60,
  );
}

/**
 * Sets the HTTP-only session cookie.
 * @param {import('express').Response} res Express response.
 * @param {string} token Session token.
 * @returns {void}
 */
function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MS,
  });
}

/**
 * Removes private fields from an account record.
 * @param {object} user User record.
 * @returns {{id: string, name: string, email: string}} Public account.
 */
function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email };
}

/**
 * Resolves the current API user from a bearer token or session cookie.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} _res Express response.
 * @param {import('express').NextFunction} next Next middleware callback.
 * @returns {void}
 */
function resolveApiUser(req, _res, next) {
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
      user = database.statements.getSessionUser.get(tokenHash, Date.now());
      if (user) {
        req.sessionTokenHash = tokenHash;
      } else {
        database.statements.deleteSession.run(tokenHash);
      }
    }
  }
  req.user = user;
  next();
}

/**
 * Rejects requests without an authenticated user.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Next middleware callback.
 * @returns {void}
 */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please log in to access your account.' });
  next();
}

/**
 * Forwards rejected async route handlers to Express error middleware.
 * @param {Function} handler Async route handler.
 * @returns {Function} Express middleware wrapper.
 */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = {
  SESSION_MS,
  asyncHandler,
  issueJwtForUser,
  publicUser,
  requireAuth,
  resolveApiUser,
  setSessionCookie,
};
