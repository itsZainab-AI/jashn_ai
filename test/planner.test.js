'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../src/planner');
const app = require('../server');

const future = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const good = { type: 'wedding', guests: 150, budget: 1500000, date: future(200), city: 'Pune', vibe: 'pastel' };

test('validate accepts a good request', () => assert.equal(p.validate(good).ok, true));
test('validate rejects bad type, guests, budget and past date', () => {
  const r = p.validate({ type: 'rave', guests: 0, budget: 5, date: '2001-01-01' });
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 4);
});
test('validate strips angle brackets from free text', () => {
  assert.ok(!/[<>]/.test(p.validate({ ...good, vibe: '<script>x</script>' }).value.vibe));
});
test('planner voice supports Hinglish and defaults safely to English', () => {
  assert.equal(p.validate({ ...good, tone: 'hinglish' }).value.tone, 'hinglish');
  assert.equal(p.validate({ ...good, tone: 'unsupported' }).value.tone, 'english');
  assert.match(p.buildPrompt({ ...p.validate({ ...good, tone: 'hinglish' }).value }), /Hinglish/);
  assert.equal(p.fallbackIdeas({ type: 'wedding', tone: 'hinglish' }).theme, 'Blush & Gold Wala Pyaar');
});
test('budget rows always sum to the total', () => {
  for (const t of p.TYPES) for (const total of [1000, 77777, 1500001]) {
    assert.equal(p.buildBudget(t, total, 10).rows.reduce((s, r) => s + r.amount, 0), total);
  }
});
test('timeline never lands in the past, even with little time', () => {
  const now = new Date();
  const t = p.buildTimeline('wedding', new Date(now.getTime() + 10 * 864e5), now);
  assert.ok(t.every((m) => m.due >= now.toISOString().slice(0, 10)));
});
test('parseIdeas rejects junk and accepts valid output', () => {
  assert.equal(p.parseIdeas('nope'), null);
  const ok = p.parseIdeas('{"theme":"T","tagline":"x","toast":"y","ideas":[{"title":"a","detail":"b"},{"title":"c","detail":"d"},{"title":"e","detail":"f"}]}');
  assert.equal(ok.ideas.length, 3);
});
test('API returns a full plan without a Gemini key, and 400 on bad input', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  const s = app.listen(0);
  const post = (body) => fetch(`http://127.0.0.1:${s.address().port}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ok = await post(good);
  const j = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(j.ai.aiPowered, false);
  assert.ok(j.timeline.length && j.checklist.length);
  assert.equal(j.venues.reason, 'not_configured');
  const invite = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}`);
  assert.equal(invite.status, 200);
  assert.equal((await invite.json()).date, good.date);
  const reply = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Aarav', attending: true, partySize: 2 }),
  });
  assert.equal(reply.status, 201);
  const guests = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}/guests`, { headers: { 'x-manage-token': j.invite.manageToken } });
  assert.equal((await guests.json()).guests[0].name, 'Aarav');
  const denied = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}/guests`);
  assert.equal(denied.status, 403);
  const invalidReply = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '', attending: 'yes', partySize: 21 }),
  });
  assert.equal(invalidReply.status, 400);
  assert.equal((await post({})).status, 400);
  await new Promise((resolve) => s.close(resolve));
});
