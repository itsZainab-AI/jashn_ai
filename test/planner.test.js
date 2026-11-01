'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const SQLite = require('better-sqlite3');
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jashn-test-'));
process.env.DATABASE_PATH = path.join(testDirectory, 'test.sqlite');
process.env.SMTP_HOST = 'smtp.example.test';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASS = 'test';
process.env.EMAIL_FROM = 'Jashn <accounts@example.test>';
process.env.APP_URL = 'http://localhost:3000';
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_MAPS_API_KEY;
const p = require('../src/planner');
const app = require('../server');
const database = require('../src/database');
const email = require('../src/email');

const future = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
const good = { type: 'wedding', guests: 150, budget: 1500000, date: future(200), city: 'Pune', vibe: 'pastel' };
const sentEmails = [];
let failEmailDelivery = false;
email.setTestTransport({
  sendMail: async (message) => {
    if (failEmailDelivery) throw new Error('Simulated SMTP failure');
    sentEmails.push(message);
    return { accepted: [message.to] };
  },
});
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

test('database migration marks existing accounts as requiring verification', () => {
  const legacyPath = path.join(testDirectory, 'legacy.sqlite');
  const legacy = new SQLite(legacyPath);
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  legacy.close();
  const script = `
    const database = require(${JSON.stringify(path.resolve(__dirname, '../src/database'))});
    const columns = database.db.prepare('PRAGMA table_info(users)').all();
    console.log(columns.some((column) => column.name === 'email_verified_at'));
    database.close();
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_PATH: legacyPath },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /true/);
});

test('registration, login, logout, and saved plans work with persistent account ownership', async () => {
  const s = app.listen(0);
  const base = `http://127.0.0.1:${s.address().port}`;
  sentEmails.length = 0;
  try {
    assert.equal((await fetch(`${base}/api/plans`)).status, 401);
    const configuredHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      const noEmailConfig = await post(base, '/api/auth/register', { name: 'No Email', email: 'no-email@example.com', password: 'celebrate123' });
      assert.equal(noEmailConfig.status, 503);
      assert.equal(database.db.prepare('SELECT id FROM users WHERE email = ?').get('no-email@example.com'), undefined);
    } finally {
      process.env.SMTP_HOST = configuredHost;
    }

    failEmailDelivery = true;
    let failedDelivery;
    const log = console.error;
    const loggedErrors = [];
    console.error = (...args) => loggedErrors.push(args);
    try {
      failedDelivery = await post(base, '/api/auth/register', { name: 'No Delivery', email: 'no-delivery@example.com', password: 'celebrate123' });
    } finally {
      failEmailDelivery = false;
      console.error = log;
    }
    assert.equal(failedDelivery.status, 503);
    assert.equal(database.db.prepare('SELECT id FROM users WHERE email = ?').get('no-delivery@example.com'), undefined);
    assert.equal(loggedErrors.length, 1);

    const register = await post(base, '/api/auth/register', { name: 'Aarav Sharma', email: 'AARAV@example.com', password: 'celebrate123' });
    assert.equal(register.status, 202);
    const registered = await register.json();
    assert.match(registered.message, /verification link/);
    const account = database.db.prepare('SELECT id, password_hash, email_verified_at FROM users WHERE email = ?').get('aarav@example.com');
    assert.match(account.password_hash, /^scrypt\$/);
    assert.equal(account.email_verified_at, null);
    const verificationEmail = sentEmails.find((message) => message.subject.includes('Verify'));
    assert.ok(verificationEmail);
    const verificationToken = verificationEmail.text.match(/verify=([a-f0-9]{64})/)[1];
    assert.notEqual(database.db.prepare('SELECT token_hash FROM account_tokens WHERE user_id = ?').get(account.id).token_hash, verificationToken);
    assert.equal((await post(base, '/api/auth/register', { name: 'Aarav', email: 'aarav@example.com', password: 'celebrate123' })).status, 409);

    const invalidLogin = await post(base, '/api/auth/login', { email: 'aarav@example.com', password: 'incorrect123' });
    assert.equal(invalidLogin.status, 401);
    const unverifiedLogin = await post(base, '/api/auth/login', { email: 'aarav@example.com', password: 'celebrate123' });
    assert.equal(unverifiedLogin.status, 403);
    assert.equal((await unverifiedLogin.json()).code, 'EMAIL_NOT_VERIFIED');
    const resend = await post(base, '/api/auth/verification/resend', { email: 'aarav@example.com' });
    assert.equal(resend.status, 200);
    const resentEmail = sentEmails.filter((message) => message.subject.includes('Verify')).at(-1);
    const resentToken = resentEmail.text.match(/verify=([a-f0-9]{64})/)[1];
    assert.equal((await post(base, '/api/auth/verify-email', { token: verificationToken })).status, 400);
    const verification = await post(base, '/api/auth/verify-email', { token: resentToken });
    assert.equal(verification.status, 200);
    const verificationCookieHeader = verification.headers.get('set-cookie');
    assert.match(verificationCookieHeader, /HttpOnly/i);
    assert.match(verificationCookieHeader, /SameSite=Lax/i);
    const verificationCookie = verificationCookieHeader.match(/jashn_session=([^;]+)/)[0];
    assert.ok(database.db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(account.id).email_verified_at);
    assert.equal((await post(base, '/api/auth/verify-email', { token: resentToken })).status, 400);

    const login = await post(base, '/api/auth/login', { email: 'aarav@example.com', password: 'celebrate123' });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get('set-cookie').match(/jashn_session=([^;]+)/)[0];
    assert.equal((await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } })).json()).user.email, 'aarav@example.com');
    assert.notEqual(database.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(account.id).token_hash, loginCookie.slice('jashn_session='.length));

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
    const reply = (await savedGuests.json()).guests[0];
    assert.equal(reply.name, 'Mira');
    assert.ok(Number.isInteger(reply.id));
    const updateReply = await fetch(`${base}/api/plans/${plan.planId}/guests/${reply.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify({ name: 'Mira Sharma', attending: false, partySize: 3 }),
    });
    assert.equal(updateReply.status, 200);
    const editedReplies = await (await fetch(`${base}/api/plans/${plan.planId}/guests`, { headers: { Cookie: loginCookie } })).json();
    assert.deepEqual(
      { id: editedReplies.guests[0].id, name: editedReplies.guests[0].name, attending: editedReplies.guests[0].attending, partySize: editedReplies.guests[0].partySize },
      { id: reply.id, name: 'Mira Sharma', attending: false, partySize: 3 },
    );
    const invalidReplyUpdate = await fetch(`${base}/api/plans/${plan.planId}/guests/${reply.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify({ name: '', attending: 'maybe', partySize: 21 }),
    });
    assert.equal(invalidReplyUpdate.status, 400);

    const progressUrl = `${base}/api/plans/${plan.planId}/progress`;
    assert.deepEqual((await (await fetch(progressUrl, { headers: { Cookie: loginCookie } })).json()).progress, { checkedChecklist: [], guests: [] });
    const progress = { checkedChecklist: [0, 2], guests: [{ name: 'Aarav Sharma', email: 'aarav.invited@example.com', status: 'pending' }] };
    const savedProgress = await fetch(progressUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify(progress),
    });
    assert.equal(savedProgress.status, 200);
    assert.deepEqual((await (await fetch(progressUrl, { headers: { Cookie: loginCookie } })).json()).progress, progress);
    const sentInvite = await post(base, `/api/plans/${plan.planId}/invites`, {
      name: 'Aarav Sharma',
      email: 'aarav.invited@example.com',
    }, loginCookie);
    assert.equal(sentInvite.status, 200);
    assert.equal((await sentInvite.json()).message, 'Invitation sent.');
    assert.match(sentEmails.at(-1).text, /rsvp=/);
    failEmailDelivery = true;
    const invitationDeliveryLog = console.error;
    let failedInvite;
    console.error = () => {};
    try {
      failedInvite = await post(base, `/api/plans/${plan.planId}/invites`, {
        name: 'Aarav Sharma',
        email: 'aarav.invited@example.com',
      }, loginCookie);
    } finally {
      failEmailDelivery = false;
      console.error = invitationDeliveryLog;
    }
    assert.equal(failedInvite.status, 503);
    const unlistedInvite = await post(base, `/api/plans/${plan.planId}/invites`, {
      name: 'Someone Else',
      email: 'else@example.com',
    }, loginCookie);
    assert.equal(unlistedInvite.status, 400);
    const invalidProgress = await fetch(progressUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify({ ...progress, checkedChecklist: [999] }),
    });
    assert.equal(invalidProgress.status, 400);
    const invalidGuestEmail = await fetch(progressUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: loginCookie },
      body: JSON.stringify({ ...progress, guests: [{ name: 'Aarav', email: 'not-an-email', status: 'pending' }] }),
    });
    assert.equal(invalidGuestEmail.status, 400);

    const unknownReset = await post(base, '/api/auth/password-reset/request', { email: 'nobody@example.com' });
    const knownReset = await post(base, '/api/auth/password-reset/request', { email: 'aarav@example.com' });
    assert.equal(unknownReset.status, 202);
    assert.equal((await unknownReset.json()).message, (await knownReset.json()).message);
    const resetEmail = sentEmails.filter((message) => message.subject.includes('Reset')).at(-1);
    assert.ok(resetEmail);
    const resetToken = resetEmail.text.match(/reset=([a-f0-9]{64})/)[1];
    const { hashToken } = require('../src/auth');
    database.db.prepare('UPDATE account_tokens SET expires_at = ? WHERE token_hash = ?').run(Date.now() - 1, hashToken(resetToken));
    assert.equal((await post(base, '/api/auth/password-reset/complete', { token: resetToken, password: 'newpassword123' })).status, 400);
    const freshReset = await post(base, '/api/auth/password-reset/request', { email: 'aarav@example.com' });
    assert.equal(freshReset.status, 202);
    const freshResetEmail = sentEmails.filter((message) => message.subject.includes('Reset')).at(-1);
    const freshResetToken = freshResetEmail.text.match(/reset=([a-f0-9]{64})/)[1];
    assert.equal((await post(base, '/api/auth/password-reset/complete', { token: freshResetToken, password: 'newpassword123' })).status, 200);
    assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } })).status, 200);
    assert.equal((await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } })).json()).user, null);
    assert.equal((await post(base, '/api/auth/password-reset/complete', { token: freshResetToken, password: 'newpassword123' })).status, 400);
    assert.equal((await post(base, '/api/auth/login', { email: 'aarav@example.com', password: 'celebrate123' })).status, 401);
    const newLogin = await post(base, '/api/auth/login', { email: 'aarav@example.com', password: 'newpassword123' });
    assert.equal(newLogin.status, 200);
    const newLoginCookie = newLogin.headers.get('set-cookie').match(/jashn_session=([^;]+)/)[0];

    const otherId = 'other-test-user';
    const otherHash = await require('../src/auth').hashPassword('celebrate123');
    database.statements.createUser.run(otherId, 'Mira', 'mira@example.com', otherHash, new Date().toISOString());
    database.statements.verifyUser.run(new Date().toISOString(), otherId);
    const otherSession = require('../src/auth').createSessionToken();
    database.statements.createSession.run(
      require('../src/auth').hashToken(otherSession),
      otherId,
      Date.now() + 60_000,
      new Date().toISOString(),
    );
    const otherCookie = `jashn_session=${otherSession}`;
    assert.equal((await fetch(`${base}/api/plans/${plan.planId}`, { headers: { Cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/plans/${plan.planId}/guests`, { headers: { Cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(progressUrl, { headers: { Cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(`${base}/api/plans/${plan.planId}/guests/${reply.id}`, {
      method: 'DELETE',
      headers: { Cookie: otherCookie },
    })).status, 404);
    const deleteReply = await fetch(`${base}/api/plans/${plan.planId}/guests/${reply.id}`, {
      method: 'DELETE',
      headers: { Cookie: newLoginCookie },
    });
    assert.equal(deleteReply.status, 200);

    assert.equal((await post(base, '/api/auth/logout', {}, loginCookie)).status, 204);
    assert.equal((await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } })).json()).user, null);
    assert.notEqual(verificationCookie, loginCookie);
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
  const guestReply = (await guests.json()).guests[0];
  assert.equal(guestReply.name, 'Aarav');
  const updateGuestReply = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}/guests/${guestReply.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-manage-token': j.invite.manageToken },
    body: JSON.stringify({ name: 'Aarav Sharma', attending: false, partySize: 1 }),
  });
  assert.equal(updateGuestReply.status, 200);
  const denied = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}/guests`);
  assert.equal(denied.status, 403);
  const deniedMutation = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}/guests/${guestReply.id}`, {
    method: 'DELETE',
  });
  assert.equal(deniedMutation.status, 403);
  const invalidReply = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '', attending: 'yes', partySize: 21 }),
  });
  assert.equal(invalidReply.status, 400);
  const deleteGuestReply = await fetch(`http://127.0.0.1:${s.address().port}/api/rsvp/${j.invite.id}/guests/${guestReply.id}`, {
    method: 'DELETE',
    headers: { 'x-manage-token': j.invite.manageToken },
  });
  assert.equal(deleteGuestReply.status, 200);
  assert.equal((await post({})).status, 400);
  await new Promise((resolve) => s.close(resolve));
});
