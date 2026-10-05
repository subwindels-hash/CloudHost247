'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { startServer, jsonFetch, register } = require('./helpers');

test('integration: full platform over real HTTP', async (t) => {
  const { base, close } = await startServer();

  await t.test('health and ready', async () => {
    const health = await jsonFetch(base, { path: '/health' });
    assert.strictEqual(health.status, 200);
    assert.strictEqual(health.data.status, 'ok');

    const ready = await jsonFetch(base, { path: '/ready' });
    assert.strictEqual(ready.status, 200);
    assert.strictEqual(ready.data.checks.storage, 'ok');
  });

  await t.test('security headers present on every response', async () => {
    const res = await fetch(`${base}/health`);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('x-request-id'));
    assert.ok(res.headers.get('content-security-policy-report-only'));
  });

  await t.test('register -> me -> logout -> revoked', async () => {
    const reg = await register(base);
    assert.strictEqual(reg.status, 201);
    assert.ok(reg.data.accessToken);
    assert.match(reg.data.user.customerId, /^\d{6}$/);

    const me = await jsonFetch(base, { path: '/api/v1/auth/me' }, reg.data.accessToken);
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.data.user.email, 'test@example.com');

    const logout = await jsonFetch(base, { path: '/api/v1/auth/logout', method: 'POST' }, reg.data.accessToken);
    assert.strictEqual(logout.status, 200);

    const after = await jsonFetch(base, { path: '/api/v1/auth/me' }, reg.data.accessToken);
    assert.strictEqual(after.status, 401);
  });

  await t.test('login fails with wrong password and unknown email identically', async () => {
    await register(base, 'l@example.com');

    const bad = await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST',
      body: { email: 'l@example.com', password: 'wrong' },
    });
    assert.strictEqual(bad.status, 401);

    const ghost = await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST',
      body: { email: 'ghost@example.com', password: 'whatever' },
    });
    assert.strictEqual(ghost.status, 401);
    assert.strictEqual(bad.data.message, ghost.data.message, 'no account enumeration');
  });

  await t.test('duplicate email registration is a conflict', async () => {
    await register(base, 'dup@example.com');
    const again = await jsonFetch(base, {
      path: '/api/v1/auth/register', method: 'POST',
      body: { email: 'DUP@example.com', password: 'SuperSecret123!', fullName: 'Dup' },
    });
    assert.strictEqual(again.status, 409);
  });

  await t.test('validation collects all issues', async () => {
    const res = await jsonFetch(base, {
      path: '/api/v1/auth/register', method: 'POST',
      body: { email: 'bad', password: 'x', fullName: '' },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.data.details.length, 3);
  });

  let token;
  await t.test('account endpoints require auth and scope to caller', async () => {
    const reg = await register(base, 'acct@example.com');
    token = reg.data.accessToken;

    const created = await jsonFetch(base, {
      path: '/api/v1/account/tickets', method: 'POST',
      body: { subject: 'Help', body: 'Something broke' },
    }, token);
    assert.strictEqual(created.status, 201);

    const list = await jsonFetch(base, { path: '/api/v1/account/tickets' }, token);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.data.tickets.length, 1);

    const unauthed = await jsonFetch(base, { path: '/api/v1/account/tickets' });
    assert.strictEqual(unauthed.status, 401);
  });

  await t.test('admin route is forbidden for a customer', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/admin/catalog/products' }, token);
    assert.strictEqual(res.status, 403);
  });

  await t.test('password change invalidates the old session', async () => {
    const reg = await register(base, 'pw@example.com');
    const old = reg.data.accessToken;

    const change = await jsonFetch(base, {
      path: '/api/v1/auth/password/change', method: 'POST',
      body: { currentPassword: 'SuperSecret123!', newPassword: 'NewSuperSecret99!' },
    }, old);
    assert.strictEqual(change.status, 200);

    // The OLD token must be rejected now (session version bumped).
    const after = await jsonFetch(base, { path: '/api/v1/auth/me' }, old);
    assert.strictEqual(after.status, 401);

    // The NEW token from the change response works.
    const me = await jsonFetch(base, { path: '/api/v1/auth/me' }, change.data.accessToken);
    assert.strictEqual(me.status, 200);
  });

  await t.test('refresh rotates tokens', async () => {
    const reg = await register(base, 'r@example.com');
    const refresh = await jsonFetch(base, {
      path: '/api/v1/auth/refresh', method: 'POST',
      body: { refreshToken: reg.data.refreshToken },
    });
    assert.strictEqual(refresh.status, 200);
    assert.ok(refresh.data.accessToken);

    // The consumed refresh token cannot be replayed.
    const replay = await jsonFetch(base, {
      path: '/api/v1/auth/refresh', method: 'POST',
      body: { refreshToken: reg.data.refreshToken },
    });
    assert.strictEqual(replay.status, 401);
  });

  await t.test('MFA enrol + confirm gates login', async () => {
    const reg = await register(base, 'mfa@example.com');
    const en = await jsonFetch(base, { path: '/api/v1/auth/mfa/totp/enroll', method: 'POST', body: {} }, reg.data.accessToken);
    assert.strictEqual(en.status, 200);
    assert.ok(en.data.otpauthUri.startsWith('otpauth://totp/'));

    const totpLib = require('../src/lib/totp');
    // Pin explicit counters rather than reading the clock: confirming enrolment consumes its
    // counter, and the platform's replay protection (correctly) refuses to accept the same code
    // twice, so the login must use the next window's code.
    const baseCounter = Math.floor(Date.now() / 1000 / 30);
    const code = totpLib.hotp(en.data.secret, baseCounter);
    const confirm = await jsonFetch(base, {
      path: '/api/v1/auth/mfa/totp/confirm', method: 'POST', body: { code },
    }, reg.data.accessToken);
    assert.strictEqual(confirm.status, 200);
    assert.strictEqual(confirm.data.recoveryCodes.length, 10);

    // Login without a code now demands MFA, and hands back a single-use continuation credential.
    const gated = await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST',
      body: { email: 'mfa@example.com', password: 'SuperSecret123!' },
    });
    assert.strictEqual(gated.status, 202, 'a second factor is still owed');
    assert.strictEqual(gated.data.mfaRequired, true);
    assert.ok(gated.data.mfaToken, 'a continuation credential is issued, not a session');

    // The challenge is exchanged, once, for a session at the completion route.
    const verified = await jsonFetch(base, {
      path: '/api/v1/auth/mfa/login/verify', method: 'POST',
      body: { mfaToken: gated.data.mfaToken, code: totpLib.hotp(en.data.secret, baseCounter + 1) },
    });
    assert.strictEqual(verified.status, 200);
    assert.ok(verified.data.token, 'a session token is returned');
    assert.strictEqual(verified.data.user.email, 'mfa@example.com');

    // Single use: the same challenge cannot be replayed.
    const replay = await jsonFetch(base, {
      path: '/api/v1/auth/mfa/login/verify', method: 'POST',
      body: { mfaToken: gated.data.mfaToken, code: totpLib.hotp(en.data.secret, baseCounter + 1) },
    });
    assert.strictEqual(replay.status, 401);

    // A wrong code against a fresh challenge is a single, non-specific 401.
    const fresh = await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST',
      body: { email: 'mfa@example.com', password: 'SuperSecret123!' },
    });
    const wrong = await jsonFetch(base, {
      path: '/api/v1/auth/mfa/login/verify', method: 'POST',
      body: { mfaToken: fresh.data.mfaToken, code: '000000' },
    });
    assert.strictEqual(wrong.status, 401);
    assert.match(wrong.data.message, /Invalid or expired multi-factor authentication code/);
  });

  await t.test('public site and assets served with caching + 304', async () => {
    const home = await fetch(`${base}/`);
    assert.strictEqual(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);

    const css = await fetch(`${base}/assets/css/site.css`);
    assert.strictEqual(css.status, 200);
    const etag = css.headers.get('etag');
    assert.ok(etag);

    const cond = await fetch(`${base}/assets/css/site.css`, { headers: { 'If-None-Match': etag } });
    assert.strictEqual(cond.status, 304);
  });

  await t.test('path traversal is blocked', async () => {
    const res = await fetch(`${base}/assets/../../.env`);
    assert.ok([403, 404].includes(res.status));
  });

  await t.test('404 and 405 behave', async () => {
    const nf = await jsonFetch(base, { path: '/api/v1/definitely-not-here' });
    assert.strictEqual(nf.status, 404);

    const m405 = await fetch(`${base}/health`, { method: 'DELETE' });
    assert.strictEqual(m405.status, 405);
  });

  await close();
});
