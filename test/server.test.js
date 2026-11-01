'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const SQLite = require('better-sqlite3');
const { closeServer, startServer, testDirectory } = require('./support');

const good = {
  type: 'wedding',
  guests: 150,
  budget: 1_500_000,
  date: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10),
  city: 'Pune',
  vibe: 'pastel',
};

test('home page serves splash and connected account screens', async () => {
  const { server, base } = startServer();
  try {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /id="splash-screen"/);
    assert.match(html, /id="login-screen"/);
    assert.match(html, /id="register-screen"/);
    assert.match(html, /id="dashboard-screen"/);
    assert.doesNotMatch(html, /Prototype only/);
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
    for (const script of scripts) {
      const scriptResponse = await fetch(new URL(script, `${base}/`));
      assert.equal(scriptResponse.status, 200, `${script} should be served`);
    }
  } finally {
    await closeServer(server);
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
    database.close();
    process.exitCode = columns.some((column) => column.name === 'email_verified_at') ? 0 : 1;
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_PATH: legacyPath },
  });
  assert.equal(result.status, 0, result.stderr);
});

test('planning and RSVP API return a full plan and validate guest replies', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  const { server, base } = startServer();
  try {
    const planResponse = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(good),
    });
    const plan = await planResponse.json();
    assert.equal(planResponse.status, 200);
    assert.equal(plan.ai.aiPowered, false);
    assert.ok(plan.timeline.length && plan.checklist.length);
    assert.equal(plan.venues.reason, 'not_configured');

    const inviteResponse = await fetch(`${base}/api/rsvp/${plan.invite.id}`);
    assert.equal(inviteResponse.status, 200);
    assert.equal((await inviteResponse.json()).date, good.date);

    const response = await fetch(`${base}/api/rsvp/${plan.invite.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Aarav', attending: true, partySize: 2 }),
    });
    assert.equal(response.status, 201);

    const guestsResponse = await fetch(`${base}/api/rsvp/${plan.invite.id}/guests`, {
      headers: { 'x-manage-token': plan.invite.manageToken },
    });
    const guest = (await guestsResponse.json()).guests[0];
    assert.equal(guest.name, 'Aarav');

    const updateResponse = await fetch(`${base}/api/rsvp/${plan.invite.id}/guests/${guest.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-manage-token': plan.invite.manageToken,
      },
      body: JSON.stringify({ name: 'Aarav Sharma', attending: false, partySize: 1 }),
    });
    assert.equal(updateResponse.status, 200);

    const denied = await fetch(`${base}/api/rsvp/${plan.invite.id}/guests`);
    assert.equal(denied.status, 403);
    const invalid = await fetch(`${base}/api/rsvp/${plan.invite.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '', attending: 'yes', partySize: 21 }),
    });
    assert.equal(invalid.status, 400);

    const deleteResponse = await fetch(`${base}/api/rsvp/${plan.invite.id}/guests/${guest.id}`, {
      method: 'DELETE',
      headers: { 'x-manage-token': plan.invite.manageToken },
    });
    assert.equal(deleteResponse.status, 200);

    const invalidPlan = await fetch(`${base}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(invalidPlan.status, 400);
  } finally {
    await closeServer(server);
  }
});
