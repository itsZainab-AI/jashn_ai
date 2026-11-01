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
    email_verified_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE TABLE IF NOT EXISTS account_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK (purpose IN ('email_verification', 'password_reset')),
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS account_tokens_user_purpose ON account_tokens(user_id, purpose);
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

const userColumns = db.prepare('PRAGMA table_info(users)').all();
if (!userColumns.some((column) => column.name === 'email_verified_at')) {
  db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
}

const statements = {
  createUser: db.prepare(
    'INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ),
  getUserByEmail: db.prepare(
    'SELECT id, name, email, password_hash, email_verified_at AS emailVerifiedAt FROM users WHERE email = ? COLLATE NOCASE',
  ),
  getUser: db.prepare(
    'SELECT id, name, email, email_verified_at AS emailVerifiedAt FROM users WHERE id = ?',
  ),
  verifyUser: db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?'),
  updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  createAccountToken: db.prepare(`
    INSERT INTO account_tokens (token_hash, user_id, purpose, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  getAccountToken: db.prepare(`
    SELECT users.id, users.name, users.email, users.email_verified_at AS emailVerifiedAt, account_tokens.purpose
    FROM account_tokens JOIN users ON users.id = account_tokens.user_id
    WHERE account_tokens.token_hash = ? AND account_tokens.expires_at > ?
  `),
  deleteAccountToken: db.prepare('DELETE FROM account_tokens WHERE token_hash = ?'),
  deleteAccountTokens: db.prepare('DELETE FROM account_tokens WHERE user_id = ? AND purpose = ?'),
  deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
  deleteExpiredAccountTokens: db.prepare('DELETE FROM account_tokens WHERE expires_at <= ?'),
  createSession: db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ),
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
    SELECT id, name, attending, party_size AS partySize, created_at AS createdAt
    FROM rsvp_guests WHERE event_id = ? ORDER BY id
  `),
  updateRsvpGuest: db.prepare(`
    UPDATE rsvp_guests SET name = ?, attending = ?, party_size = ?
    WHERE id = ? AND event_id = ?
  `),
  deleteRsvpGuest: db.prepare('DELETE FROM rsvp_guests WHERE id = ? AND event_id = ?'),
};

/** Closes the SQLite connection when it is open. */
function close() {
  if (db.open) db.close();
}

module.exports = { db, statements, close };
