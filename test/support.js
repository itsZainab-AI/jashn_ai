'use strict';

const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

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

const app = require('../server');
const database = require('../src/database');
const email = require('../src/email');
const { hashPassword, createSessionToken, hashToken } = require('../src/auth');

const sentEmails = [];
let failEmailDelivery = false;
email.setTestTransport({
  sendMail: async (message) => {
    if (failEmailDelivery) throw new Error('Simulated SMTP failure');
    sentEmails.push(message);
    return { accepted: [message.to] };
  },
});

/**
 * Sends a JSON POST request to the test server.
 * @param {string} base Server base URL.
 * @param {string} route Request path.
 * @param {object} body JSON request body.
 * @param {string} [cookie] Session cookie.
 * @returns {Promise<Response>} HTTP response.
 */
function post(base, route, body, cookie) {
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

/**
 * Starts the Express app on an ephemeral port.
 * @returns {{server: import('node:http').Server, base: string}} Running server and base URL.
 */
function startServer() {
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

/**
 * Closes an HTTP server after its tests complete.
 * @param {import('node:http').Server} server Running server.
 * @returns {Promise<void>}
 */
function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

/**
 * Toggles simulated SMTP delivery failures for integration tests.
 * @param {boolean} value Whether the test transport should reject sends.
 * @returns {void}
 */
function setEmailDeliveryFailure(value) {
  failEmailDelivery = value;
}

/**
 * Creates a verified test account and a valid session cookie without email setup.
 * @param {string} [name] Display name.
 * @param {string} [emailAddress] Account email.
 * @returns {Promise<{id: string, cookie: string}>} Account ID and session cookie.
 */
async function createAuthenticatedUser(name = 'Test User', emailAddress = 'test@example.com') {
  const id = randomUUID();
  const passwordHash = await hashPassword('celebrate123');
  database.statements.createUser.run(
    id,
    name,
    emailAddress,
    passwordHash,
    new Date().toISOString(),
  );
  database.statements.verifyUser.run(new Date().toISOString(), id);
  const token = createSessionToken();
  database.statements.createSession.run(
    hashToken(token),
    id,
    Date.now() + 60_000,
    new Date().toISOString(),
  );
  return { id, cookie: `jashn_session=${token}` };
}

test.after(() => {
  database.close();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

module.exports = {
  app,
  closeServer,
  createAuthenticatedUser,
  database,
  email,
  post,
  sentEmails,
  startServer,
  testDirectory,
  setEmailDeliveryFailure,
};
