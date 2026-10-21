'use strict';

const { promisify } = require('node:util');
const { randomBytes, scrypt: scryptCallback, timingSafeEqual, createHash } = require('node:crypto');

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const SESSION_COOKIE = 'jashn_session';
const SESSION_DAYS = 7;

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

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

module.exports = { hashPassword, verifyPassword, createSessionToken, hashToken, SESSION_COOKIE, SESSION_DAYS };
