'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  closeServer,
  database,
  post,
  sentEmails,
  setEmailDeliveryFailure,
  startServer,
} = require('./support');

test('registration, email verification, login, and logout work', async () => {
  const { server, base } = startServer();
  sentEmails.length = 0;
  try {
    const configuredHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      const response = await post(base, '/api/auth/register', {
        name: 'No Email',
        email: 'no-email@example.com',
        password: 'celebrate123',
      });
      assert.equal(response.status, 503);
      assert.equal(
        database.db.prepare('SELECT id FROM users WHERE email = ?').get('no-email@example.com'),
        undefined,
      );
    } finally {
      process.env.SMTP_HOST = configuredHost;
    }

    const originalError = console.error;
    const loggedErrors = [];
    console.error = (...args) => loggedErrors.push(args);
    setEmailDeliveryFailure(true);
    let failedDelivery;
    try {
      failedDelivery = await post(base, '/api/auth/register', {
        name: 'No Delivery',
        email: 'no-delivery@example.com',
        password: 'celebrate123',
      });
    } finally {
      setEmailDeliveryFailure(false);
      console.error = originalError;
    }
    assert.equal(failedDelivery.status, 503);
    assert.equal(loggedErrors.length, 1);
    assert.equal(
      database.db.prepare('SELECT id FROM users WHERE email = ?').get('no-delivery@example.com'),
      undefined,
    );

    const registration = await post(base, '/api/auth/register', {
      name: 'Aarav Sharma',
      email: 'AARAV@example.com',
      password: 'celebrate123',
    });
    assert.equal(registration.status, 202);
    assert.match((await registration.json()).message, /verification link/);

    const account = database.db
      .prepare('SELECT id, password_hash, email_verified_at FROM users WHERE email = ?')
      .get('aarav@example.com');
    assert.match(account.password_hash, /^scrypt\$/);
    assert.equal(account.email_verified_at, null);
    const verificationEmail = sentEmails.find((message) => message.subject.includes('Verify'));
    assert.ok(verificationEmail);
    const verificationToken = verificationEmail.text.match(/verify=([a-f0-9]{64})/)[1];
    assert.notEqual(
      database.db.prepare('SELECT token_hash FROM account_tokens WHERE user_id = ?').get(account.id)
        .token_hash,
      verificationToken,
    );

    const duplicate = await post(base, '/api/auth/register', {
      name: 'Aarav',
      email: 'aarav@example.com',
      password: 'celebrate123',
    });
    assert.equal(duplicate.status, 409);

    const invalidLogin = await post(base, '/api/auth/login', {
      email: 'aarav@example.com',
      password: 'incorrect123',
    });
    assert.equal(invalidLogin.status, 401);
    const unverifiedLogin = await post(base, '/api/auth/login', {
      email: 'aarav@example.com',
      password: 'celebrate123',
    });
    assert.equal(unverifiedLogin.status, 403);
    assert.equal((await unverifiedLogin.json()).code, 'EMAIL_NOT_VERIFIED');

    const resend = await post(base, '/api/auth/verification/resend', {
      email: 'aarav@example.com',
    });
    assert.equal(resend.status, 200);
    const resentEmail = sentEmails.filter((message) => message.subject.includes('Verify')).at(-1);
    const resentToken = resentEmail.text.match(/verify=([a-f0-9]{64})/)[1];
    assert.equal(
      (await post(base, '/api/auth/verify-email', { token: verificationToken })).status,
      400,
    );

    const verification = await post(base, '/api/auth/verify-email', { token: resentToken });
    assert.equal(verification.status, 200);
    const verificationCookieHeader = verification.headers.get('set-cookie');
    assert.match(verificationCookieHeader, /HttpOnly/i);
    assert.match(verificationCookieHeader, /SameSite=Lax/i);
    const verificationCookie = verificationCookieHeader.match(/jashn_session=([^;]+)/)[0];
    assert.ok(
      database.db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(account.id)
        .email_verified_at,
    );
    assert.equal((await post(base, '/api/auth/verify-email', { token: resentToken })).status, 400);

    const login = await post(base, '/api/auth/login', {
      email: 'aarav@example.com',
      password: 'celebrate123',
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get('set-cookie').match(/jashn_session=([^;]+)/)[0];
    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } });
    assert.equal((await me.json()).user.email, 'aarav@example.com');
    assert.notEqual(
      database.db
        .prepare(
          'SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        )
        .get(account.id).token_hash,
      loginCookie.slice('jashn_session='.length),
    );

    assert.equal((await post(base, '/api/auth/logout', {}, loginCookie)).status, 204);
    const loggedOut = await fetch(`${base}/api/auth/me`, { headers: { Cookie: loginCookie } });
    assert.equal((await loggedOut.json()).user, null);
    assert.notEqual(verificationCookie, loginCookie);
  } finally {
    await closeServer(server);
  }
});
