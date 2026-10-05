/**
 * Infrastructure provider egress: the domain layer calling the ported adapters for real.
 *
 * Until this wiring existed, `domains/infrastructure.js` described the provider side as "deferred"
 * and answered three endpoints from local rows alone — a provider test that only read environment
 * variables, an image "verification" that stamped `verified_at` unconditionally, and a reconciliation
 * sweep that compared our own records to each other. These tests drive the real routes over the real
 * HTTP pipeline against a loopback server playing a Hetzner API, and assert both directions: that a
 * provider answer changes what the platform records, and that a provider failure never becomes a
 * success.
 *
 * What is deliberately NOT claimed: no call has been made to a real provider account, so
 * provider-side acceptance of these requests is unverified. What is verified is the request the
 * platform sends, the verdict it derives, and the refusal it reports.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { startServer, jsonFetch, register } = require('./helpers');

const HETZNER_TOKEN = 'test-hetzner-token';
/** A provider error message that must never reach a browser: it names an internal endpoint. */
const LEAKY_MESSAGE = 'see https://internal-billing.hetzner.example/ops/quota for details';

/**
 * A loopback stand-in for a Hetzner API. `routes` maps `METHOD /path` to `{ status, body }` or a
 * function of the recorded request; every request is recorded with its headers so the tests can
 * assert what the platform actually sent.
 */
async function startFakeProvider(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const bare = req.url.split('?')[0];
      const entry = routes[`${req.method} ${bare}`] ?? routes[`${req.method} ${req.url}`];
      const result = typeof entry === 'function' ? entry({ url: req.url }) : entry;
      if (result === undefined || result === null) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: LEAKY_MESSAGE, code: 404 } }));
        return;
      }
      res.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body ?? {}));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    requests,
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function adminToken(base, app, email = 'egress-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

const now = () => new Date().toISOString();

test('integration: infrastructure provider egress', async (t) => {
  const fake = await startFakeProvider({
    // Diagnostics: one authenticated read-only call.
    'GET /servers': { status: 200, body: { servers: [], meta: { pagination: {} } } },
    // The same call against a provider that rejects our credentials. The body deliberately names an
    // internal endpoint: that text must be logged server-side and never returned to the browser.
    'GET /v1-rejects/servers': { status: 401, body: { error: { message: LEAKY_MESSAGE, code: 'unauthorized' } } },
    // Image verification, by numeric provider id.
    'GET /images/12345': {
      status: 200,
      body: { image: { id: 12345, name: 'ubuntu-24.04', architecture: 'x86', status: 'available' } },
    },
    // Reconciliation: the platform's record says active, the provider says off.
    'GET /servers/777': {
      status: 200,
      body: { server: { id: 777, name: 'drifting', status: 'off', public_net: { ipv4: { ip: '203.0.113.7' } }, image: { id: 12345 } } },
    },
    'GET /servers/888': {
      status: 200,
      body: { server: { id: 888, name: 'agreeing', status: 'running', public_net: { ipv4: { ip: '203.0.113.8' } }, image: { id: 12345 } } },
    },
  });

  const { base, app, close } = await startServer({ HETZNER_API_TOKEN: HETZNER_TOKEN });
  try {
    const admin = await adminToken(base, app);

    let provider;
    let region;
    await t.test('a configured provider and its region exist', async () => {
      const created = await jsonFetch(base, {
        path: '/api/v1/admin/providers', method: 'POST',
        body: { name: 'Hetzner FRA', type: 'hetzner', config: { adapter: 'hetzner' }, apiBaseUrl: fake.base },
      }, admin);
      assert.strictEqual(created.status, 201);
      provider = created.data.provider.id;
      await jsonFetch(base, {
        path: `/api/v1/admin/providers/${provider}`, method: 'PATCH', body: { status: 'ACTIVE' },
      }, admin);
      const regionRes = await jsonFetch(base, {
        path: '/api/v1/admin/regions', method: 'POST',
        body: { name: 'Falkenstein', code: 'fsn1', providerId: provider },
      }, admin);
      assert.strictEqual(regionRes.status, 201);
      region = regionRes.data.region.id;
    });

    await t.test('the diagnostics route makes a real provider call and reports success', async () => {
      const before = fake.requests.length;
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/providers/${provider}/test`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.diagnostics.ok, true);
      assert.strictEqual(res.data.diagnostics.attempted, true, 'a request was really made');
      assert.ok(res.data.diagnostics.latencyMs >= 0);

      const sent = fake.requests.slice(before);
      assert.strictEqual(sent.length, 1, 'exactly one provider request');
      assert.strictEqual(sent[0].method, 'GET');
      assert.match(sent[0].url, /^\/servers\?per_page=1$/);
      assert.strictEqual(sent[0].headers.authorization, `Bearer ${HETZNER_TOKEN}`, 'credentials went to the provider');
      assert.strictEqual(JSON.stringify(res.data).includes(HETZNER_TOKEN), false, 'the token never comes back in a response');
    });

    await t.test('the verdict is recorded on the provider row', async () => {
      const row = await app.store.table('infra_providers').findById(provider);
      assert.strictEqual(row.metadata.connectionTest.ok, true);
      assert.strictEqual(row.metadata.connectionTest.attempted, true);
      assert.ok(row.metadata.connectionTest.checkedAt);
      const logs = await app.store.table('audit_logs').find({ action: 'PROVIDER_CONNECTION_TESTED' });
      assert.strictEqual(logs.rows.length, 1);
      assert.strictEqual(logs.rows[0].after.ok, true);
    });

    await t.test('a provider that rejects our credentials is reported as a failure, with its own text withheld', async () => {
      const bad = await jsonFetch(base, {
        path: '/api/v1/admin/providers', method: 'POST',
        body: { name: 'Broken cloud', type: 'hetzner', slug: 'broken-hetzner', config: { adapter: 'hetzner' }, apiBaseUrl: fake.base },
      }, admin);
      // Point it at a path the fake answers 401 for.
      await app.store.table('infra_providers').updateById(bad.data.provider.id, { api_base_url: `${fake.base}/v1-rejects` });
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/providers/${bad.data.provider.id}/test`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200, 'the honest verdict is the response, not an error page');
      assert.strictEqual(res.data.diagnostics.ok, false);
      assert.strictEqual(res.data.diagnostics.attempted, true);
      assert.strictEqual(res.data.diagnostics.code, 'AUTHENTICATION_FAILED');
      assert.strictEqual(JSON.stringify(res.data).includes('internal-billing.hetzner.example'), false,
        'the provider message that names an internal endpoint is never returned');
      const row = await app.store.table('infra_providers').findById(bad.data.provider.id);
      assert.strictEqual(row.status, 'DISABLED', 'a failed test does not activate a provider');
    });

    await t.test('a half-configured provider is refused before any request is made', async () => {
      const unconfigured = await jsonFetch(base, {
        path: '/api/v1/admin/providers', method: 'POST',
        body: { name: 'Unconfigured cloud', type: 'vultr', config: { adapter: 'vultr' } },
      }, admin);
      const before = fake.requests.length;
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/providers/${unconfigured.data.provider.id}/test`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.diagnostics.ok, false);
      assert.strictEqual(res.data.diagnostics.attempted, false, 'no egress for a provider that cannot answer');
      assert.strictEqual(res.data.diagnostics.code, 'CONFIGURATION_REQUIRED');
      assert.match(res.data.diagnostics.message, /VULTR_API_KEY/, 'the missing variable is named');
      assert.strictEqual(fake.requests.length, before, 'nothing reached the network');
    });

    await t.test('image verification asks the provider and stamps only on a real answer', async () => {
      const image = await app.store.table('os_images').insert({
        id: '66666666-6666-4666-8666-666666666666', os_id: '44444444-4444-4444-8444-444444444444',
        provider_image_id: '12345', region_id: region, arch: 'x86_64', status: 'active', active: true,
        created_at: now(), updated_at: now(),
      });
      const before = fake.requests.length;
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/os-images/${image.id}/test`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.verified, true);
      assert.ok(res.data.image.verifiedAt, 'verified_at is stamped');
      assert.strictEqual(res.data.providerImage.name, 'ubuntu-24.04', 'the provider said what it has');
      assert.ok(fake.requests.slice(before).some((r) => r.url.startsWith('/images/12345')), 'the provider was asked');
    });

    await t.test('an image the provider does not have is left unverified, with the reason', async () => {
      const image = await app.store.table('os_images').insert({
        id: '77777777-7777-4777-8777-777777777777', os_id: '44444444-4444-4444-8444-444444444444',
        provider_image_id: '99999', region_id: region, arch: 'x86_64', status: 'active', active: true,
        created_at: now(), updated_at: now(),
      });
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/os-images/${image.id}/test`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.verified, false, 'a missing image is never verified');
      assert.strictEqual(res.data.image.verifiedAt, null);
      assert.match(res.data.reason, /does not have an image/);
      const row = await app.store.table('os_images').findById(image.id);
      assert.strictEqual(row.verified_at, null, 'the row is not stamped either');
    });

    await t.test('an architecture the provider contradicts is caught', async () => {
      const image = await app.store.table('os_images').insert({
        id: '88888888-8888-4888-8888-888888888888', os_id: '44444444-4444-4444-8444-444444444444',
        provider_image_id: '12345', region_id: region, arch: 'arm64', status: 'active', active: true,
        created_at: now(), updated_at: now(),
      });
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/os-images/${image.id}/test`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.data.verified, false);
      assert.match(res.data.reason, /Architecture mismatch/);
      assert.match(res.data.reason, /arm64/);
      assert.match(res.data.reason, /x86_64/);
    });

    await t.test('an image with no region is not silently verified', async () => {
      const image = await app.store.table('os_images').insert({
        id: '99999999-9999-4999-8999-999999999999', os_id: '44444444-4444-4444-8444-444444444444',
        provider_image_id: '12345', region_id: null, arch: 'x86_64', status: 'active', active: true,
        created_at: now(), updated_at: now(),
      });
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/os-images/${image.id}/test`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.data.verified, false);
      assert.match(res.data.reason, /not assigned to a region/);
    });

    await t.test('reconciliation compares a server against its provider', async () => {
      await app.store.table('servers').insert({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', hostname: 'drift.example.com', name: 'drift',
        user_id: null, provider: 'hetzner', region_id: region, status: 'active',
        metadata: { providerServerId: '777' }, created_at: now(), updated_at: now(),
      });
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/server-reconciliation/sweep', method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.reconciled.providerChecked, 1, 'one server was really compared with a provider');
      const drift = res.data.drifts.find((d) => d.serverId === 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      assert.ok(drift, 'the disagreement is reported');
      assert.strictEqual(drift.kind, 'PROVIDER_STATUS_MISMATCH');
      assert.strictEqual(drift.from, 'active');
      assert.strictEqual(drift.to, 'off');
      assert.strictEqual(drift.applied, false, 'a provider-side power state is not auto-applied');
      const row = await app.store.table('servers').findById('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      assert.strictEqual(row.status, 'active', 'the customer\'s server status was not changed');
    });

    await t.test('a server that agrees with its provider produces no drift', async () => {
      await app.store.table('servers').insert({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', hostname: 'agree.example.com', name: 'agree',
        user_id: null, provider: 'hetzner', region_id: region, status: 'active',
        metadata: { providerServerId: '888' }, created_at: now(), updated_at: now(),
      });
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/server-reconciliation/sweep', method: 'POST', body: {},
      }, admin);
      assert.strictEqual(
        res.data.drifts.some((d) => d.serverId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false,
        'running vs active is agreement, not drift',
      );
      assert.strictEqual(res.data.reconciled.providerChecked, 2);
    });

    await t.test('a server the provider no longer has is reported as missing', async () => {
      await app.store.table('servers').insert({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', hostname: 'gone.example.com', name: 'gone',
        user_id: null, provider: 'hetzner', region_id: region, status: 'active',
        metadata: { providerServerId: '404004' }, created_at: now(), updated_at: now(),
      });
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/server-reconciliation/sweep', method: 'POST', body: {},
      }, admin);
      const drift = res.data.drifts.find((d) => d.serverId === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');
      assert.ok(drift, 'the missing server is reported');
      assert.strictEqual(drift.kind, 'PROVIDER_MISSING');
    });

    await t.test('a server with no provider handle is counted as local-only, not as agreed', async () => {
      await app.store.table('servers').insert({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', hostname: 'local.example.com', name: 'local',
        user_id: null, provider: 'hetzner', region_id: null, status: 'active',
        metadata: {}, created_at: now(), updated_at: now(),
      });
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/server-reconciliation/sweep', method: 'POST', body: { limit: 200 },
      }, admin);
      assert.strictEqual(res.data.reconciled.localOnly, 1, 'the one server with no handle is named as such');
      assert.strictEqual(
        res.data.reconciled.candidates,
        res.data.reconciled.providerChecked + res.data.reconciled.localOnly,
        'the counts add up, so a sweep cannot under-report what it skipped',
      );
    });
  } finally {
    await close();
    await fake.close();
  }
});
