'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../src/planner');

const future = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const good = {
  type: 'wedding',
  guests: 150,
  budget: 1_500_000,
  date: future(200),
  city: 'Pune',
  vibe: 'pastel',
};

test('validate accepts a good request', () => assert.equal(planner.validate(good).ok, true));

test('validate rejects bad type, guests, budget and past date', () => {
  const result = planner.validate({ type: 'rave', guests: 0, budget: 5, date: '2001-01-01' });
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 4);
});

test('validate strips angle brackets from free text', () => {
  assert.ok(!/[<>]/.test(planner.validate({ ...good, vibe: '<script>x</script>' }).value.vibe));
});

test('planner voice supports Hinglish and defaults safely to English', () => {
  assert.equal(planner.validate({ ...good, tone: 'hinglish' }).value.tone, 'hinglish');
  assert.equal(planner.validate({ ...good, tone: 'unsupported' }).value.tone, 'english');
  assert.match(
    planner.buildPrompt({ ...planner.validate({ ...good, tone: 'hinglish' }).value }),
    /Hinglish/,
  );
  assert.equal(
    planner.fallbackIdeas({ type: 'wedding', tone: 'hinglish' }).theme,
    'Blush & Gold Wala Pyaar',
  );
});

test('budget rows always sum to the total', () => {
  for (const type of planner.TYPES) {
    for (const total of [1_000, 77_777, 1_500_001]) {
      assert.equal(
        planner.buildBudget(type, total, 10).rows.reduce((sum, row) => sum + row.amount, 0),
        total,
      );
    }
  }
});

test('timeline never lands in the past, even with little time', () => {
  const now = new Date();
  const timeline = planner.buildTimeline('wedding', new Date(now.getTime() + 10 * 864e5), now);
  assert.ok(timeline.every((milestone) => milestone.due >= now.toISOString().slice(0, 10)));
});

test('parseIdeas rejects junk and accepts valid output', () => {
  assert.equal(planner.parseIdeas('nope'), null);
  const parsed = planner.parseIdeas(
    '{"theme":"T","tagline":"x","toast":"y","ideas":[{"title":"a","detail":"b"},{"title":"c","detail":"d"},{"title":"e","detail":"f"}]}',
  );
  assert.equal(parsed.ideas.length, 3);
});
