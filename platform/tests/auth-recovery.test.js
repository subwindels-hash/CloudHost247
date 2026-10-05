/**
 * Integration tests for the auth recovery surface that was missing (auth.ts):
 * POST /auth/password-reset/{request,confirm}, POST /auth/email-verification/{confirm,resend}
 * and POST /auth/mfa/login/verify.
 *
 * These are security-sensitive paths, so the tests check the guarantees (non-enumeration, single
 * use, session invalidation) rather than only the happy path.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

const BOTH = ['/api/auth', '/api/v1/auth'];

test('integration: password reset', async (t) => {
  const { base, app, close } = await startServer();
  try {
    await register(base, 'reset@example.com', 'OriginalPass123!');
    const user = await app.store.table('users').findOne({ email: 'reset@example.com' });

    await t.test('the request is anonymous, 202 and non-enumerating', async () => {
      const known = await jsonFetch(base, {
        path: '/api/auth/password-reset/request', method: 'POST', body: { email: 'reset@example.com' },
      });
      const unknown = await jsonFetch(base, {
        path: '/api/auth/password-reset/request', method: 'POST', body: { email: 'nobody@example.com' },
      });

      assert.strictEqual(known.status, 202);
      assert.strictEqual(unknown.status, 202, 'an unknown address is indistinguishable');
      assert.strictEqual(
        known.data.message,
        unknown.data.message,
        'the body must not reveal whether the account exists',
      );
      assert.match(known.data.message, /^If an active account matches that email address/);

      // Only the known address produced a token.
      assert.ok(known.data.resetToken, 'development surfaces the link instead of dropping it');
      assert.strictEqual(unknown.data.resetToken, undefined);
    });

    await t.test('a suspended account is treated like an unknown one', async () => {
      await app.store.table('users').updateById(user.id, { status: 'suspended' });
      const res = await jsonFetch(base, {
        path: '/api/auth/password-reset/request', method: 'POST', body: { email: 'reset@example.com' },
      });
      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.data.resetToken, undefined, 'no token for an inactive account');
      await app.store.table('users').updateById(user.id, { status: 'active' });
    });

    await t.test('the email is validated', async () => {
      const res = await jsonFetch(base, {
        path: '/api/auth/password-reset/request', method: 'POST', body: { email: 'not-an-email' },
      });
      assert.strictEqual(res.status, 400);
    });

    let resetToken;
    await t.test('confirm sets a new password and invalidates old sessions', async () => {
      const before = await app.store.table('users').findById(user.id);

      const request = await jsonFetch(base, {
        path: '/api/auth/password-reset/request', method: 'POST', body: { email: 'reset@example.com' },
      });
      resetToken = request.data.resetToken;

      const res = await jsonFetch(base, {
        path: '/api/auth/password-reset/confirm', method: 'POST',
        body: { token: resetToken, password: 'BrandNewPass456!' },
      });
      assert.strictEqual(res.status, 200);
      assert.match(res.data.message, /Your password has been reset/);
      assert.ok(res.data.accessToken, 'the customer is signed straight back in');

      const after = await app.store.table('users').findById(user.id);
      assert.ok(after.password_hash !== before.password_hash, 'the hash changed');
      assert.ok(after.auth_session_version > before.auth_session_version, 'existing sessions are invalidated');

      const login = await jsonFetch(base, {
        path: '/api/v1/auth/login', method: 'POST',
        body: { email: 'reset@example.com', password: 'BrandNewPass456!' },
      });
      assert.strictEqual(login.status, 200, 'the new password works');

      const old = await jsonFetch(base, {
        path: '/api/v1/auth/login', method: 'POST',
        body: { email: 'reset@example.com', password: 'OriginalPass123!' },
      });
      assert.strictEqual(old.status, 401, 'the old password no longer works');
    });

    await t.test('the token is single use and invalid tokens get the original message', async () => {
      const replay = await jsonFetch(base, {
        path: '/api/auth/password-reset/confirm', method: 'POST',
        body: { token: resetToken, password: 'AnotherPass789!' },
      });
      assert.strictEqual(replay.status, 400);
      assert.match(replay.data.message, /invalid or has expired. Request a new link to continue/);

      const junk = await jsonFetch(base, {
        path: '/api/auth/password-reset/confirm', method: 'POST',
        body: { token: 'x'.repeat(40), password: 'AnotherPass789!' },
      });
      assert.strictEqual(junk.status, 400);
      assert.strictEqual(junk.data.message, replay.data.message, 'one indistinguishable answer');
    });

    await t.test('a weak password is refused', async () => {
      const request = await jsonFetch(base, {
        path: '/api/auth/password-reset/request', method: 'POST', body: { email: 'reset@example.com' },
      });
      const res = await jsonFetch(base, {
        path: '/api/auth/password-reset/confirm', method: 'POST',
        body: { token: request.data.resetToken, password: 'short' },
      });
      assert.strictEqual(res.status, 400);
    });
  } finally {
    await close();
  }
});

test('integration: email verification', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const reg = await register(base, 'verify@example.com');
    const token = reg.data.accessToken;

    await t.test('resend requires a session and answers 202', async () => {
      for (const prefix of BOTH) {
        const anon = await jsonFetch(base, { path: `${prefix}/email-verification/resend`, method: 'POST', body: {} });
        assert.strictEqual(anon.status, 401, `${prefix} requires authentication`);
      }

      const res = await jsonFetch(base, {
        path: '/api/auth/email-verification/resend', method: 'POST', body: {},
      }, token);
      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.data.queued, true);
      assert.strictEqual(res.data.alreadyVerified, false);
      assert.match(res.data.message, /has been queued for delivery/);
      assert.ok(res.data.verificationToken, 'development surfaces the link');
    });

    let verificationToken;
    await t.test('confirm marks the address verified', async () => {
      const resend = await jsonFetch(base, {
        path: '/api/auth/email-verification/resend', method: 'POST', body: {},
      }, token);
      verificationToken = resend.data.verificationToken;

      const res = await jsonFetch(base, {
        path: '/api/auth/email-verification/confirm', method: 'POST', body: { token: verificationToken },
      });
      assert.strictEqual(res.status, 200);
      assert.match(res.data.message, /Your email address has been verified/);

      const user = await app.store.table('users').findOne({ email: 'verify@example.com' });
      assert.ok(user.email_verified_at, 'the timestamp is recorded');

      // Security events land in auth_audit_log (the original's recordAuthEvent table), not audit_logs.
      const auditRow = await app.store.table('auth_audit_log').findOne({ event_type: 'email_verified', user_id: user.id });
      assert.ok(auditRow, 'verification is recorded as an auth event');
    });

    await t.test('resending when already verified is a no-op 200', async () => {
      const res = await jsonFetch(base, {
        path: '/api/auth/email-verification/resend', method: 'POST', body: {},
      }, token);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.alreadyVerified, true);
      assert.strictEqual(res.data.queued, false);
      assert.match(res.data.message, /already verified/);
    });

    await t.test('a consumed or unknown token gets the original message', async () => {
      const replay = await jsonFetch(base, {
        path: '/api/auth/email-verification/confirm', method: 'POST', body: { token: verificationToken },
      });
      assert.strictEqual(replay.status, 400);
      assert.match(replay.data.message, /invalid or has expired. Request a new link to continue/);

      const junk = await jsonFetch(base, {
        path: '/api/auth/email-verification/confirm', method: 'POST', body: { token: 'y'.repeat(40) },
      });
      assert.strictEqual(junk.status, 400);
      assert.strictEqual(junk.data.message, replay.data.message);
    });
  } finally {
    await close();
  }
});
