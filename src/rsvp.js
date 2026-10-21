'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const { clean } = require('./planner');
const { statements } = require('./database');
const { hashToken } = require('./auth');

const MAX_GUESTS = 5000;

function create(event, ownerUserId = null) {
  const id = randomBytes(18).toString('hex');
  const manageToken = randomBytes(32).toString('hex');
  statements.createRsvpEvent.run(
    id,
    ownerUserId,
    event.title,
    event.date,
    event.city || '',
    hashToken(manageToken),
    new Date().toISOString(),
  );
  return { id, manageToken };
}

function getPublicEvent(id) {
  return statements.getRsvpEvent.get(id) || null;
}

function getGuests(id, token) {
  const secret = statements.getRsvpSecret.get(id);
  if (!secret || !isValidToken(secret.manage_token_hash, token)) return null;
  return getGuestRows(id);
}

function getGuestsForOwner(id) {
  if (!statements.getRsvpSecret.get(id)) return null;
  return getGuestRows(id);
}

function getGuestRows(id) {
  return statements.listRsvpGuests.all(id).map((guest) => ({
    ...guest,
    attending: Boolean(guest.attending),
  }));
}

function respond(id, input) {
  if (!statements.getRsvpSecret.get(id)) {
    return { ok: false, status: 404, error: 'This RSVP link is no longer available.' };
  }
  if (statements.countRsvpGuests.get(id).count >= MAX_GUESTS) {
    return { ok: false, status: 409, error: 'This event has reached its response limit.' };
  }
  const name = clean(input?.name, 80);
  const attending = input?.attending;
  const partySize = Number(input?.partySize);
  if (!name || ![true, false].includes(attending) || !Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
    return { ok: false, status: 400, error: 'Enter your name, choose yes or no, and select a group size from 1 to 20.' };
  }
  statements.createRsvpGuest.run(id, name, Number(attending), partySize, new Date().toISOString());
  return { ok: true };
}

function isValidToken(expected, supplied) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const actualHash = Buffer.from(hashToken(supplied), 'hex');
  const expectedHash = Buffer.from(expected, 'hex');
  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

module.exports = { create, getPublicEvent, getGuests, getGuestsForOwner, respond };
