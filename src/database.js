'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const filename = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'jashn.sqlite');
const directory = path.dirname(filename);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
if (!process.env.DATABASE_PATH) fs.chmodSync(directory, 0o700);

const db = new Database(filename);
fs.chmodSync(filename, 0o600);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    city TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS plans_owner_created ON plans(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS plan_progress (
    plan_id TEXT PRIMARY KEY REFERENCES plans(id) ON DELETE CASCADE,
    checked_checklist_json TEXT NOT NULL DEFAULT '[]',
    host_guests_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rsvp_events (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    event_date TEXT NOT NULL,
    city TEXT NOT NULL,
    manage_token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rsvp_guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES rsvp_events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    attending INTEGER NOT NULL CHECK (attending IN (0, 1)),
    party_size INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS rsvp_guests_event ON rsvp_guests(event_id, id);
`);

const statements = {
  createUser: db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
  getUserByEmail: db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ? COLLATE NOCASE'),
  createSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'),
  getSessionUser: db.prepare(`
    SELECT users.id, users.name, users.email
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  createPlan: db.prepare(`
    INSERT INTO plans (id, user_id, event_type, event_date, city, plan_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  listPlans: db.prepare(`
    SELECT id, event_type, event_date, city, created_at
    FROM plans WHERE user_id = ? ORDER BY created_at DESC
  `),
  getPlan: db.prepare('SELECT id, plan_json FROM plans WHERE id = ? AND user_id = ?'),
  getPlanProgress: db.prepare(`
    SELECT checked_checklist_json AS checkedChecklist, host_guests_json AS guests
    FROM plan_progress WHERE plan_id = ?
  `),
  savePlanProgress: db.prepare(`
    INSERT INTO plan_progress (plan_id, checked_checklist_json, host_guests_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(plan_id) DO UPDATE SET
      checked_checklist_json = excluded.checked_checklist_json,
      host_guests_json = excluded.host_guests_json,
      updated_at = excluded.updated_at
  `),
  createRsvpEvent: db.prepare(`
    INSERT INTO rsvp_events (id, owner_user_id, title, event_date, city, manage_token_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getRsvpEvent: db.prepare('SELECT title, event_date AS date, city FROM rsvp_events WHERE id = ?'),
  getRsvpSecret: db.prepare('SELECT manage_token_hash FROM rsvp_events WHERE id = ?'),
  countRsvpGuests: db.prepare('SELECT COUNT(*) AS count FROM rsvp_guests WHERE event_id = ?'),
  createRsvpGuest: db.prepare(`
    INSERT INTO rsvp_guests (event_id, name, attending, party_size, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  listRsvpGuests: db.prepare(`
    SELECT name, attending, party_size AS partySize, created_at AS createdAt
    FROM rsvp_guests WHERE event_id = ? ORDER BY id
  `),
};

function close() {
  if (db.open) db.close();
}

module.exports = { db, statements, close };
