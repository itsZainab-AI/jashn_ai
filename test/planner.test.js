'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jashn-test-'));
process.env.DATABASE_PATH = path.join(testDirectory, 'test.sqlite');
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
const p = require('../src/planner');
const app = require('../server');
const database = require('../src/database');

const future = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const good = { type: 'wedding', guests: 150, budget: 1500000, date: future(200), city: 'Pune', vibe: 'pastel' };
const post = (base, route, body, cookie) => fetch(`${base}${route}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  body: JSON.stringify(body),
});

test.after(() => {
  database.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

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
test('home page serves splash and connected account screens', async () => {
  const s = app.listen(0);
  try {
    const response = await fetch(`http://127.0.0.1:${s.address().port}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /id="splash-screen"/);
    assert.match(html, /id="login-screen"/);
    assert.match(html, /id="register-screen"/);
    assert.match(html, /id="dashboard-screen"/);
    assert.doesNotMatch(html, /Prototype only/);
  } finally {
    await new Promise((resolve) => s.close(resolve));
  }
});

test('registration, login, logout, and saved plans work with persistent account ownership', async () => {
  const s = app.listen(0);
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.equal((await fetch(`${base}/api/plans`)).status, 401);
    const register = await post(base, '/api/auth/register', { name: 'Aarav Sharma', email: 'AARAV@example.com', password: 'celebrate123' });
    assert.equal(register.status, 201);
    const registered = await register.json();
    assert.equal(registered.user.email, 'aarav@example.com');
    const cookieHeader = register.headers.get('set-cookie');
    assert.match(cookieHeader, /HttpOnly/i);
    assert.match(cookieHeader, /SameSite=Lax/i);
    const cookie = cookieHeader.match(/jashn_session=([^;]+)/)[0];
    assert.match(database.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(registered.user.id).password_hash, /^scrypt\$/);
    assert.notEqual(database.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get(registered.user.id).token_hash, cookie.slice('jashn_session='.length));
    assert.equal((await post(base, '/api/auth/register', { name: 'Aarav', email: 'aarav@example.com', password: 'celebrate123' })).status, 409);

    const invalidLogin = await post(base, '/api/auth/login', { email: 'aarav@example.com', password: 'incorrect123' });
    assert.equal(invalidLogin.status, 401);
    const login = await post(base, '/api/auth/login', { email: 'aarav@example.com', password: 'celebrate123' });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get('set-cookie').match(/jashn_session=([^;]+)/)[0];
    assert.equal((await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } })).json()).user.email, 'aarav@example.com');

    const planResponse = await post(base, '/api/plan', good, loginCookie);
    const plan = await planResponse.json();
    assert.equal(planResponse.status, 200);
    assert.ok(plan.planId);
    const listResponse = await fetch(`${base}/api/plans`, { headers: { Cookie: loginCookie } });
    assert.equal((await listResponse.json()).plans.length, 1);
    const savedResponse = await fetch(`${base}/api/plans/${plan.planId}`, { headers: { Cookie: loginCookie } });
    const savedPlan = await savedResponse.json();
    assert.equal(savedPlan.invite.id, plan.invite.id);
    assert.equal(savedPlan.invite.manageToken, undefined);
    assert.equal((await fetch(`${base}/api/plans/${plan.planId}/guests`, { headers: { Cookie: loginCookie } })).status, 200);
    await post(base, `/api/rsvp/${plan.invite.id}`, { name: 'Mira', attending: true, partySize: 2 });
    const savedGuests = await fetch(`${base}/api/plans/${plan.planId}/guests`, { headers: { Cookie: loginCookie } });
    assert.equal((await savedGuests.json()).guests[0].name, 'Mira');

    const progressUrl = `${base}/api/plans/${plan.planId}/progress`;
    assert.deepEqual((await (await fetch(progressUrl, { headers: { Cookie: loginCookie } })).json()).progress, { checkedChecklist: [], guests: [] });
    const progress = { checkedChecklist: [0, 2], guests: [{ name: 'Aarav Sharma', status: 'pending' }] };
    const savedProgress = await fetch(progressUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify(progress),
    });
    assert.equal(savedProgress.status, 200);
    assert.deepEqual((await (await fetch(progressUrl, { headers: { Cookie: loginCookie } })).json()).progress, progress);
    const invalidProgress = await fetch(progressUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify({ ...progress, checkedChecklist: [999] }),
    });
    assert.equal(invalidProgress.status, 400);

    const other = await post(base, '/api/auth/register', { name: 'Mira', email: 'mira@example.com', password: 'celebrate123' });
    const otherCookie = other.headers.get('set-cookie').match(/jashn_session=([^;]+)/)[0];
    assert.equal((await fetch(`${base}/api/plans/${plan.planId}`, { headers: { Cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/plans/${plan.planId}/guests`, { headers: { Cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(progressUrl, { headers: { Cookie: otherCookie } })).status, 404);

    assert.equal((await post(base, '/api/auth/logout', {}, loginCookie)).status, 204);
    assert.equal((await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } })).json()).user, null);
  } finally {
    await new Promise((resolve) => s.close(resolve));
  }
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
