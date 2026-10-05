/**
 * The Fastify platform mounts several modules twice: registerHandlers() is called once for
 * '/api/v1' and once for the legacy '/api' prefix, so both URLs serve the same handlers. This test
 * pins that down — dropping one mount would otherwise be invisible because the primary prefix still
 * works.
 *
 * It compares the two prefixes pairwise rather than asserting fixed status codes, so it keeps
 * holding as the handlers themselves evolve.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

const GHOST = '00000000-0000-0000-0000-0000000000aa';

// [method, path, body, who]
const DUAL_ROUTES = [
  ['GET', '/provisioning/jobs', undefined, 'customer'],
  ['GET', `/provisioning/jobs/${GHOST}`, undefined, 'customer'],
  ['POST', `/provisioning/jobs/${GHOST}/retry`, {}, 'admin'],
  ['POST', `/provisioning/jobs/${GHOST}/cancel`, {}, 'admin'],
  ['GET', '/services', undefined, 'customer'],
  ['GET', `/services/${GHOST}`, undefined, 'customer'],
  ['POST', '/services', {}, 'customer'],
  ['PATCH', `/services/${GHOST}`, {}, 'customer'],
  ['POST', `/services/${GHOST}/provision`, {}, 'customer'],
  ['POST', `/services/${GHOST}/suspend`, {}, 'customer'],
  ['POST', `/services/${GHOST}/unsuspend`, {}, 'customer'],
  ['POST', `/services/${GHOST}/terminate`, {}, 'customer'],
  ['GET', '/licenses', undefined, 'customer'],
  ['GET', `/licenses/${GHOST}`, undefined, 'customer'],
  ['POST', '/licenses', {}, 'customer'],
  ['POST', `/licenses/${GHOST}/activate`, {}, 'customer'],
  ['POST', `/licenses/${GHOST}/renew`, {}, 'customer'],
  ['POST', `/licenses/${GHOST}/cancel`, {}, 'customer'],
  ['GET', '/dns/zones', undefined, 'customer'],
  ['POST', '/dns/zones', {}, 'customer'],
  ['GET', `/dns/zones/${GHOST}`, undefined, 'customer'],
  ['DELETE', `/dns/zones/${GHOST}`, undefined, 'customer'],
  ['POST', '/dns/records', {}, 'customer'],
  ['PATCH', `/dns/records/${GHOST}`, {}, 'customer'],
  ['DELETE', `/dns/records/${GHOST}`, undefined, 'customer'],
  ['GET', `/dns/zones/${GHOST}/records`, undefined, 'customer'],
  ['POST', `/dns/zones/${GHOST}/records`, {}, 'customer'],
  ['PATCH', `/dns/zones/${GHOST}/records/${GHOST}`, {}, 'customer'],
  ['DELETE', `/dns/zones/${GHOST}/records/${GHOST}`, undefined, 'customer'],
  ['GET', `/monitoring/servers/${GHOST}`, undefined, 'customer'],
  ['GET', `/monitoring/services/${GHOST}`, undefined, 'customer'],
  ['GET', '/audit-logs', undefined, 'admin'],
];

test('integration: the legacy /api prefix mirrors /api/v1', async (t) => {
  const { base, app, close } = await startServer();
  try {
    await register(base, 'legacy-admin@example.com', 'SuperSecret123!');
    const adminUser = await app.store.table('users').findOne({ email: 'legacy-admin@example.com' });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const admin = (await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'legacy-admin@example.com', password: 'SuperSecret123!' },
    })).data.accessToken;

    const customer = (await register(base, 'legacy-customer@example.com')).data.accessToken;
    assert.ok(admin && customer, 'both tokens issued');

    for (const [method, path, body, who] of DUAL_ROUTES) {
      await t.test(`${method} ${path}`, async () => {
        const token = who === 'admin' ? admin : customer;
        const primary = await jsonFetch(base, { path: `/api/v1${path}`, method, body }, token);
        const legacy = await jsonFetch(base, { path: `/api${path}`, method, body }, token);

        assert.strictEqual(
          legacy.status, primary.status,
          `/api${path} -> ${legacy.status} but /api/v1${path} -> ${primary.status}`,
        );
        // A routing miss would answer "Cannot GET /api/…", so matching the handler's own message
        // proves the legacy path is really mounted and not merely coinciding on a 404.
        if (primary.data && primary.data.message) {
          assert.strictEqual(legacy.data.message, primary.data.message, 'same handler produced the error');
          assert.doesNotMatch(String(legacy.data.message), /^Cannot /, 'not a routing miss');
        }
        assert.deepEqual(
          Object.keys(legacy.data ?? {}).sort(),
          Object.keys(primary.data ?? {}).sort(),
          'the two prefixes return the same envelope',
        );
      });
    }

    await t.test('GET /audit-logs follows the original admin contract on both prefixes', async () => {
      for (const prefix of ['/api/v1', '/api']) {
        const res = await jsonFetch(base, { path: `${prefix}/audit-logs` }, admin);
        assert.strictEqual(res.status, 200);
        assert.ok(Array.isArray(res.data.logs), 'logs array');
        assert.strictEqual(typeof res.data.total, 'number');
        assert.strictEqual(res.data.limit, 50, 'default limit is 50');
        assert.strictEqual(res.data.offset, 0);

        const denied = await jsonFetch(base, { path: `${prefix}/audit-logs` }, customer);
        assert.strictEqual(denied.status, 403, 'the audit log is not a self-scoped feed');

        const paged = await jsonFetch(base, { path: `${prefix}/audit-logs?limit=1&offset=0` }, admin);
        assert.strictEqual(paged.data.limit, 1);
        assert.ok(paged.data.logs.length <= 1);
      }
    });
  } finally {
    await close();
  }
});
