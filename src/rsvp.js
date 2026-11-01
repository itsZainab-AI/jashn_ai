'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const { clean } = require('./planner');
const { statements } = require('./database');
const { hashToken } = require('./auth');

const MAX_GUESTS = 5000;

/**
 * Creates an RSVP event and its private management token.
 * @param {object} event Event details.
 * @param {string|null} [ownerUserId] Owning account ID.
 * @returns {{id: string, manageToken: string}} Public event ID and private token.
 */
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

/**
 * Looks up the public details for an invitation.
 * @param {string} id RSVP event ID.
 * @returns {object|null} Public event or null if unavailable.
 */
function getPublicEvent(id) {
  return statements.getRsvpEvent.get(id) || null;
}

/**
 * Lists RSVP replies after validating the private management token.
 * @param {string} id RSVP event ID.
 * @param {string} token Management token.
 * @returns {object[]|null} Guests or null when access is denied.
 */
function getGuests(id, token) {
  const secret = statements.getRsvpSecret.get(id);
  if (!secret || !isValidToken(secret.manage_token_hash, token)) return null;
  return getGuestRows(id);
}

/**
 * Lists replies for an event accessed by its authenticated owner.
 * @param {string} id RSVP event ID.
 * @returns {object[]|null} Guests or null when the event is unavailable.
 */
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

/**
 * Saves a guest's RSVP response.
 * @param {string} id RSVP event ID.
 * @param {object} input Guest response.
 * @returns {{ok: boolean, status?: number, error?: string}} Operation result.
 */
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
  if (
    !name ||
    ![true, false].includes(attending) ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > 20
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Enter your name, choose yes or no, and select a group size from 1 to 20.',
    };
  }
  statements.createRsvpGuest.run(id, name, Number(attending), partySize, new Date().toISOString());
  return { ok: true };
}

/**
 * Updates an existing RSVP response.
 * @param {string} id RSVP event ID.
 * @param {number} guestId Guest response ID.
 * @param {object} input Updated response.
 * @returns {{ok: boolean, status?: number, error?: string}} Operation result.
 */
function updateResponse(id, guestId, input) {
  const name = clean(input?.name, 80);
  const attending = input?.attending;
  const partySize = Number(input?.partySize);
  if (
    !Number.isInteger(guestId) ||
    guestId < 1 ||
    !name ||
    ![true, false].includes(attending) ||
    !Number.isInteger(partySize) ||
    partySize < 1 ||
    partySize > 20
  ) {
    return {
      ok: false,
      status: 400,
      error: 'Enter a valid name, attendance choice, and group size from 1 to 20.',
    };
  }
  const result = statements.updateRsvpGuest.run(name, Number(attending), partySize, guestId, id);
  if (!result.changes) return { ok: false, status: 404, error: 'RSVP response not found.' };
  return { ok: true };
}

/**
 * Deletes an RSVP response.
 * @param {string} id RSVP event ID.
 * @param {number} guestId Guest response ID.
 * @returns {{ok: boolean, status?: number, error?: string}} Operation result.
 */
function deleteResponse(id, guestId) {
  if (!Number.isInteger(guestId) || guestId < 1) {
    return { ok: false, status: 400, error: 'RSVP response not found.' };
  }
  const result = statements.deleteRsvpGuest.run(guestId, id);
  if (!result.changes) return { ok: false, status: 404, error: 'RSVP response not found.' };
  return { ok: true };
}

function isValidToken(expected, supplied) {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const actualHash = Buffer.from(hashToken(supplied), 'hex');
  const expectedHash = Buffer.from(expected, 'hex');
  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

module.exports = {
  create,
  getPublicEvent,
  getGuests,
  getGuestsForOwner,
  respond,
  updateResponse,
  deleteResponse,
};
