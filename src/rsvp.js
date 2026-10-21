'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const { clean } = require('./planner');

const events = new Map();
const MAX_EVENTS = 1000;
const MAX_GUESTS = 5000;

function create(event) {
  if (events.size >= MAX_EVENTS) events.delete(events.keys().next().value);
  const id = randomBytes(18).toString('hex');
  const manageToken = randomBytes(32).toString('hex');
  events.set(id, { ...event, manageToken, guests: [] });
  return { id, manageToken };
}

function getPublicEvent(id) {
  const event = events.get(id);
  if (!event) return null;
  return { title: event.title, date: event.date, city: event.city };
}

function getGuests(id, token) {
  const event = events.get(id);
  if (!event || !isValidToken(event.manageToken, token)) return null;
  return event.guests.map(({ name, attending, partySize, createdAt }) => ({ name, attending, partySize, createdAt }));
}

function respond(id, input) {
  const event = events.get(id);
  if (!event) return { ok: false, status: 404, error: 'This RSVP link is no longer available.' };
  if (event.guests.length >= MAX_GUESTS) return { ok: false, status: 409, error: 'This event has reached its response limit.' };
  const name = clean(input?.name, 80);
  const attending = input?.attending;
  const partySize = Number(input?.partySize);
  if (!name || ![true, false].includes(attending) || !Number.isInteger(partySize) || partySize < 1 || partySize > 20) {
    return { ok: false, status: 400, error: 'Enter your name, choose yes or no, and select a group size from 1 to 20.' };
  }
  event.guests.push({ name, attending, partySize, createdAt: new Date().toISOString() });
  return { ok: true };
}

function isValidToken(expected, supplied) {
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

module.exports = { create, getPublicEvent, getGuests, respond };
