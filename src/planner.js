'use strict';

const { TYPES, SPLITS, MILESTONES, CHECKLISTS } = require('./planner-data');
const { clean } = require('./text');
const { buildPrompt, parseIdeas, fallbackIdeas } = require('./planner-ideas');

const DAY = 864e5;

function validate(b = {}, now = new Date()) {
  const errors = [];
  const type = clean(b.type, 20);
  if (!TYPES.includes(type)) errors.push('Choose wedding, birthday or community event.');
  const tone = b.tone === 'hinglish' ? 'hinglish' : 'english';
  const guests = Number(b.guests);
  if (!Number.isInteger(guests) || guests < 1 || guests > 5000)
    errors.push('Guests must be a whole number from 1 to 5000.');
  const budget = Number(b.budget);
  if (!Number.isFinite(budget) || budget < 1000 || budget > 1e8)
    errors.push('Budget must be between 1,000 and 100,000,000.');
  const date = new Date(`${clean(b.date, 10)}T00:00:00Z`);
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date < today || date - today > 3 * 365 * DAY)
    errors.push('Pick a date from today up to 3 years ahead.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      type,
      guests,
      budget: Math.round(budget),
      date,
      city: clean(b.city, 60),
      vibe: clean(b.vibe, 200),
      tone,
    },
  };
}

/**
 * Splits a total budget into event-specific categories.
 * @param {string} type Event type.
 * @param {number} total Total budget.
 * @param {number} guests Guest count.
 * @returns {{total: number, perGuest: number, rows: object[]}} Budget breakdown.
 */
function buildBudget(type, total, guests) {
  const rows = Object.entries(SPLITS[type]).map(([name, pct]) => ({
    name,
    pct: Math.round(pct * 100),
    amount: Math.round(total * pct),
  }));
  rows[rows.length - 1].amount += total - rows.reduce((s, r) => s + r.amount, 0); // keep the sum exact
  return { total, perGuest: Math.round(total / guests), rows };
}

/**
 * Builds dated planning milestones, compressing them when time is short.
 * @param {string} type Event type.
 * @param {Date} eventDate Celebration date.
 * @param {Date} [now] Current time.
 * @returns {object[]} Ordered timeline milestones.
 */
function buildTimeline(type, eventDate, now = new Date()) {
  const list = MILESTONES[type];
  const daysLeft = Math.max(0, (eventDate - now) / DAY);
  const scale = Math.min(1, daysLeft / (list[0][0] * 7)); // short on time? squeeze the plan
  return list.map(([weeks, task]) => ({
    task,
    weeksBefore: weeks,
    due: new Date(eventDate - weeks * 7 * scale * DAY).toISOString().slice(0, 10),
  }));
}

/** @param {string} type Event type. @returns {{id: number, item: string}[]} Vendor checklist. */
const buildChecklist = (type) => CHECKLISTS[type].map((item, id) => ({ id, item }));

module.exports = {
  TYPES,
  validate,
  buildBudget,
  buildTimeline,
  buildChecklist,
  buildPrompt,
  parseIdeas,
  fallbackIdeas,
  clean,
};
