'use strict';

const { promisify } = require('node:util');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash, createHmac } = require('node:crypto');

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_COOKIE = 'jashn_session';
const SESSION_DAYS = 7;
const JWT_SECRET = process.env.JWT_SECRET || 'demo-jashn-secret-change-me';

function base64UrlEncode(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return Buffer.from(text).toString('base64url');
}

function base64UrlDecode(value) {
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}=${'='.repeat((4 - (value.length % 4)) % 4)}`;
  return Buffer.from(padded, 'base64').toString('utf8');
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, n, r, p, saltHex, keyHex] = String(stored).split('$');
  if (algorithm !== 'scrypt' || n !== String(SCRYPT_OPTIONS.N) || r !== String(SCRYPT_OPTIONS.r) || p !== String(SCRYPT_OPTIONS.p)
    || !/^[a-f0-9]{32}$/i.test(saltHex || '') || !/^[a-f0-9]{128}$/i.test(keyHex || '')) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function createSessionToken() {
  return randomBytes(32).toString('base64url');
}

function createJwt(payload, expiresInSeconds = 60 * 60 * 24 * 7) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const claims = { ...payload, iat: now, exp: now + expiresInSeconds };
  const headerPart = base64UrlEncode(header);
  const payloadPart = base64UrlEncode(claims);
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function verifyJwt(token) {
  if (typeof token !== 'string' || !token) throw new Error('Missing JWT token.');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT token.');
  const [headerPart, payloadPart, signature] = parts;
  const signingInput = `${headerPart}.${payloadPart}`;
  const expectedSignature = createHmac('sha256', JWT_SECRET).update(signingInput).digest('base64url');
  if (!timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signature))) {
    throw new Error('JWT signature mismatch.');
  }
  const payload = JSON.parse(base64UrlDecode(payloadPart));
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error('JWT token has expired.');
  }
  return payload;
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  createJwt,
  verifyJwt,
  hashToken,
  SESSION_COOKIE,
  SESSION_DAYS,
  JWT_SECRET,
};
