'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  closeServer,
  createAuthenticatedUser,
  database,
  post,
  sentEmails,
  startServer,
} = require('./support');

test('password reset links are generic, expire, and invalidate sessions', async () => {
  const { server, base } = startServer();
  sentEmails.length = 0;
  try {
    const resetAccount = await createAuthenticatedUser('Reset User', 'reset@example.com');
    const sessionCookie = resetAccount.cookie;

    sentEmails.length = 0;
    const unknownReset = await post(base, '/api/auth/password-reset/request', {
      email: 'nobody@example.com',
    });
    const knownReset = await post(base, '/api/auth/password-reset/request', {
      email: 'reset@example.com',
    });
    assert.equal(unknownReset.status, 202);
    assert.equal((await unknownReset.json()).message, (await knownReset.json()).message);

    const firstReset = sentEmails.filter((message) => message.subject.includes('Reset')).at(-1);
    const firstToken = firstReset.text.match(/reset=([a-f0-9]{64})/)[1];
    const { hashToken } = require('../src/auth');
    database.db
      .prepare('UPDATE account_tokens SET expires_at = ? WHERE token_hash = ?')
      .run(Date.now() - 1, hashToken(firstToken));
    const expired = await post(base, '/api/auth/password-reset/complete', {
      token: firstToken,
      password: 'newpassword123',
    });
    assert.equal(expired.status, 400);

    const freshReset = await post(base, '/api/auth/password-reset/request', {
      email: 'reset@example.com',
    });
    assert.equal(freshReset.status, 202);
    const freshEmail = sentEmails.filter((message) => message.subject.includes('Reset')).at(-1);
    const freshToken = freshEmail.text.match(/reset=([a-f0-9]{64})/)[1];
    assert.equal(
      (
        await post(base, '/api/auth/password-reset/complete', {
          token: freshToken,
          password: 'newpassword123',
        })
      ).status,
      200,
    );
    const oldSession = await fetch(`${base}/api/auth/me`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal((await oldSession.json()).user, null);
    assert.equal(
      (
        await post(base, '/api/auth/password-reset/complete', {
          token: freshToken,
          password: 'newpassword123',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post(base, '/api/auth/login', {
          email: 'reset@example.com',
          password: 'celebrate123',
        })
      ).status,
      401,
    );
    const newLogin = await post(base, '/api/auth/login', {
      email: 'reset@example.com',
      password: 'newpassword123',
    });
    assert.equal(newLogin.status, 200);
  } finally {
    await closeServer(server);
  }
});
