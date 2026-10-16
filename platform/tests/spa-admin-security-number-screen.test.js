'use strict';

/**
 * Security-number policy screen contract (AdminSecurityNumberPage).
 *
 * Walks the exact HTTP sequences the screen issues — policy read/write (super-admin writes, the
 * empty update refused by name), per-user lifecycle metadata (which never contains the value or
 * its hash), force-rotate, and require-re-initialization — over the real app. Pins the page
 * source to the response keys it renders. (Browser rendering itself is covered by `npm run smoke`.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminSecurityNumberPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

async function tokenFor(base, app, email, role) {
  await register(base, email, 'SuperSecret123!');
  if (role) {
    const user = await app.store.table('users').findOne({ email });
    await app.store.table('users').updateById(user.id, { role });
  }
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('security-number policy screen: endpoint contracts', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    const superAdmin = await tokenFor(base, app, 'sn-screen-super@example.com', 'super_admin');
    const admin = await tokenFor(base, app, 'sn-screen-admin@example.com', 'admin');
    const customer = await tokenFor(base, app, 'sn-screen-cust@example.com');
    const custUser = await app.store.table('users').findOne({ email: 'sn-screen-cust@example.com' });

    // -- policy card --
    const policy = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/security-number/policy' }, superAdmin);
    assert.strictEqual(policy.status, 200);
    for (const key of [
      'rotationHours', 'allowManualRotation', 'requireStepUp', 'maxVerificationAttempts',
      'attemptWindowSeconds', 'revealTtlSeconds', 'supportSessionMinutes',
    ]) {
      assert.ok(key in policy.data.policy, `policy reads ${key}`);
    }

    const empty = await jsonFetch(base, { method: 'PUT', path: '/api/v1/admin/security-number/policy', body: {} }, superAdmin);
    assert.strictEqual(empty.status, 409);
    assert.match(String(empty.data?.message ?? ''), /At least one setting must be provided/);

    const asAdmin = await jsonFetch(base, {
      method: 'PUT', path: '/api/v1/admin/security-number/policy', body: { rotationHours: 500 },
    }, admin);
    assert.strictEqual(asAdmin.status, 403, 'policy writes are super-admin only');

    const saved = await jsonFetch(base, {
      method: 'PUT', path: '/api/v1/admin/security-number/policy', body: { rotationHours: 500 },
    }, superAdmin);
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.data));
    assert.strictEqual(saved.data.policy.rotationHours, 500, 'policy result reads the saved value');

    // -- per-user lifecycle metadata --
    const before = await jsonFetch(base, {
      method: 'GET', path: `/api/v1/admin/users/${custUser.id}/security-number`,
    }, admin);
    assert.strictEqual(before.status, 200);
    const sn = before.data.securityNumber;
    for (const key of ['initialized', 'requiresReinitialization', 'version', 'createdAt', 'expiresAt']) {
      assert.ok(key in sn, `lifecycle metadata reads ${key}`);
    }
    for (const forbidden of ['hash', 'securityNumberHash', 'value', 'security_number_hash']) {
      assert.ok(!(forbidden in sn), `lifecycle metadata never carries '${forbidden}'`);
    }

    // -- force rotate --
    const rotated = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/users/${custUser.id}/security-number/rotate`, body: {},
    }, admin);
    assert.strictEqual(rotated.status, 200, JSON.stringify(rotated.data));
    assert.strictEqual(rotated.data.securityNumber.initialized, true, 'rotate initializes');
    assert.strictEqual(rotated.data.securityNumber.version, (sn.version ?? 0) + 1, 'rotate bumps the version');
    assert.ok(rotated.data.securityNumber.expiresAt, 'rotate sets expiry from the policy');

    // -- require re-initialization (super-admin only) --
    const reinitRefused = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/users/${custUser.id}/security-number/require-reinitialization`, body: {},
    }, admin);
    assert.strictEqual(reinitRefused.status, 403, 'require-reinitialization is super-admin only');

    const reinit = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/users/${custUser.id}/security-number/require-reinitialization`, body: {},
    }, superAdmin);
    assert.strictEqual(reinit.status, 200, JSON.stringify(reinit.data));
    assert.strictEqual(reinit.data.securityNumber.initialized, false, 're-initialization clears the flag');
    assert.strictEqual(reinit.data.securityNumber.requiresReinitialization, true, 'the flag is mirrored');

    // -- staff gate --
    const denied = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/security-number/policy' }, customer);
    assert.strictEqual(denied.status, 403);

    // -- page pins --
    for (const key of ['rotationHours', 'requiresReinitialization', 'allowManualRotation', 'revealTtlSeconds', 'supportSessionMinutes']) {
      assert.ok(PAGE_SRC.includes(key), `AdminSecurityNumberPage renders '${key}'`);
    }
    assert.ok(PAGE_SRC.includes('never returned'), 'the page states the value is never shown');
    for (const pathPart of [
      '/api/v1/admin/security-number/policy', '/security-number/rotate', '/security-number/require-reinitialization',
    ]) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
