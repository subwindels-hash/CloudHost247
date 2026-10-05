/**
 * Customer server actions against a real provider boundary.
 *
 * Two things were deferred here and are now real. The console route used to hand back a random token
 * and the literal word "deferred" — the platform recorded a console being opened for a session that
 * never existed. And every lifecycle action was queued without asking whether the provider performs
 * it at all, so a customer on a provider with no rescue system got a `202` and a job that could only
 * fail, with the server row already flipped to `rescue`.
 *
 * These tests drive the real routes over the real HTTP pipeline against a loopback provider API, and
 * assert both directions: a provider that offers a capability gets a real session, and a provider
 * that documents none is refused *before* anything reaches the network or any row is written.
 *
 * Not claimed: no call has been made to a real provider account, so provider-side acceptance of these
 * requests is unverified.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { startServer, jsonFetch, register } = require('./helpers');

const HETZNER_CONSOLE_PASSWORD = 'one-time-console-password-9f3';
const HETZNER_WSS = 'wss://console.hetzner.example/?token=abc123';
const VULTR_KVM = 'https://kvm.vultr.example/?token=v9';

async function startFakeProvider(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const bare = req.url.split('?')[0];
      const result = routes[`${req.method} ${bare}`];
      if (result === undefined) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
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

const CREDENTIALS = {
  HETZNER_API_TOKEN: 'test-hetzner-token',
  DIGITALOCEAN_API_TOKEN: 'test-do-token',
  VULTR_API_KEY: 'test-vultr-key',
  AWS_ACCESS_KEY_ID: 'AKIATEST',
  AWS_SECRET_ACCESS_KEY: 'test-secret',
  AWS_REGION: 'eu-central-1',
};

async function token(base, email) {
  await register(base, email, 'SuperSecret123!');
  return email;
}

async function login(base, email) {
  const res = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return res.data.accessToken;
}

/**
 * One provider row of each kind, its region, and a customer-owned server pointing at it.
 * `handle` is the provider-side id; omit it to build a server this platform has no record for.
 */
let seedCounter = 0;

async function seedServer(base, app, admin, customer, kind, apiBaseUrl, handle, overrides = {}) {
  seedCounter += 1;
  const provider = await jsonFetch(base, {
    path: '/api/v1/admin/providers', method: 'POST',
    body: {
      name: `${kind} test ${seedCounter}`, type: kind, slug: `${kind}-actions-${seedCounter}`,
      config: { adapter: kind }, apiBaseUrl,
    },
  }, admin);
  assert.strictEqual(provider.status, 201, `the ${kind} provider row was created`);
  await jsonFetch(base, {
    path: `/api/v1/admin/providers/${provider.data.provider.id}`, method: 'PATCH', body: { status: 'ACTIVE' },
  }, admin);
  const region = await jsonFetch(base, {
    path: '/api/v1/admin/regions', method: 'POST',
    body: { name: `${kind} region ${seedCounter}`, code: `${kind}-r${seedCounter}`, providerId: provider.data.provider.id },
  }, admin);
  assert.strictEqual(region.status, 201, `the ${kind} region was created`);
  const owner = await app.store.table('users').findOne({ email: customer });
  const server = await app.store.table('servers').insert({
    id: overrides.id,
    user_id: owner.id, name: `${kind} box`,
    provider: kind, region_id: region.data.region.id, status: 'active',
    hostname: `${kind}-${seedCounter}.example.com`,
    metadata: handle ? { providerServerId: handle } : {},
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  return { providerId: provider.data.provider.id, server };
}

test('integration: server actions against a provider', async (t) => {
  const fake = await startFakeProvider({
    'POST /servers/42/actions/request_console': {
      status: 200,
      body: { action: { id: 7, status: 'success' }, wss_url: HETZNER_WSS, password: HETZNER_CONSOLE_PASSWORD },
    },
    'GET /instances/55': {
      status: 200,
      body: { instance: { id: '55', kvm: VULTR_KVM, power_status: 'ok' } },
    },
  });

  const { base, app, close } = await startServer({ ...CREDENTIALS });
  try {
    const adminEmail = await token(base, 'actions-admin@example.com');
    const adminUser = await app.store.table('users').findOne({ email: adminEmail });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const admin = await login(base, adminEmail);
    const customerEmail = await token(base, 'actions-customer@example.com');
    const customer = await login(base, customerEmail);

    const hetzner = await seedServer(base, app, admin, customerEmail, 'hetzner', fake.base, '42', { id: '11111111-2222-4333-8444-111111111111' });
    const digitalocean = await seedServer(base, app, admin, customerEmail, 'digitalocean', fake.base, '99', { id: '22222222-2222-4333-8444-222222222222' });
    const vultr = await seedServer(base, app, admin, customerEmail, 'vultr', fake.base, '55', { id: '33333333-2222-4333-8444-333333333333' });
    const aws = await seedServer(base, app, admin, customerEmail, 'aws', null, 'i-0abc123', { id: '44444444-2222-4333-8444-444444444444' });
    const unhandled = await seedServer(base, app, admin, customerEmail, 'hetzner', fake.base, null, { id: '55555555-2222-4333-8444-555555555555' });

    await t.test('the console route issues a real provider session', async () => {
      const before = fake.requests.length;
      const res = await jsonFetch(base, {
        path: `/api/v1/servers/${hetzner.server.id}/console`, method: 'POST', body: {},
      }, customer);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.provider, 'hetzner');
      assert.strictEqual(res.data.console.url, HETZNER_WSS, 'the customer gets the URL the provider issued');
      assert.strictEqual(res.data.console.password, HETZNER_CONSOLE_PASSWORD, 'and the one-time password with it');
      assert.strictEqual(res.data.console.action, undefined,
        'the provider record is whitelisted, not passed through — Hetzner returns an action object with it');
      const sent = fake.requests.slice(before);
      assert.strictEqual(sent.length, 1, 'exactly one provider request');
      assert.strictEqual(sent[0].method, 'POST');
      assert.match(sent[0].url, /^\/servers\/42\/actions\/request_console$/);
    });

    await t.test('console key material reaches the customer but never the audit log', async () => {
      const logs = await app.store.table('audit_logs').find({ action: 'server.console_opened' });
      assert.ok(logs.rows.length >= 1, 'the fact that a session was issued is on the record');
      const row = logs.rows.find((r) => r.entity_id === hetzner.server.id);
      assert.ok(row, 'and it names the server');
      assert.strictEqual(row.after.adapter, 'hetzner');
      assert.strictEqual(row.after.credentialKind, 'one-time-password', 'the kind is recorded');
      assert.strictEqual(row.after.hasUrl, true);
      const serialized = JSON.stringify(row);
      assert.strictEqual(serialized.includes(HETZNER_CONSOLE_PASSWORD), false, 'the password is not stored');
      assert.strictEqual(serialized.includes(HETZNER_WSS), false, 'nor is the session URL');
    });

    await t.test('a second provider kind normalizes into the same shape', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/servers/${vultr.server.id}/console`, method: 'POST', body: {},
      }, customer);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.provider, 'vultr');
      assert.strictEqual(res.data.console.type, 'novnc');
      assert.strictEqual(res.data.console.url, VULTR_KVM);
      assert.strictEqual(res.data.console.password, undefined, 'a URL-only session invents no credential');
    });

    await t.test('a provider that documents no console is refused before any request', async () => {
      const before = fake.requests.length;
      const res = await jsonFetch(base, {
        path: `/api/v1/servers/${digitalocean.server.id}/console`, method: 'POST', body: {},
      }, customer);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /DigitalOcean/);
      assert.match(res.data.message, /console/);
      assert.strictEqual(fake.requests.length, before, 'nothing reached the network');
      const logs = await app.store.table('audit_logs').find({ action: 'server.console_opened' });
      assert.strictEqual(
        logs.rows.some((r) => r.entity_id === digitalocean.server.id), false,
        'no console session was recorded for a session that never existed',
      );
    });

    await t.test('a server this platform has no provider record for says so', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/servers/${unhandled.server.id}/console`, method: 'POST', body: {},
      }, customer);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /no provider record/i);
    });

    await t.test('rescue is refused on a provider with no rescue system, and the row is untouched', async () => {
      const before = fake.requests.length;
      const res = await jsonFetch(base, {
        path: `/api/v1/servers/${digitalocean.server.id}/rescue`, method: 'POST', body: {},
      }, customer);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /DigitalOcean/);
      assert.match(res.data.message, /rescue/);
      assert.strictEqual(fake.requests.length, before);
      const row = await app.store.table('servers').findById(digitalocean.server.id);
      assert.strictEqual(row.status, 'active', 'a refused action does not leave the server in rescue');
      const jobs = await app.store.table('provisioning_jobs').all();
      assert.strictEqual(
        jobs.some((j) => j.server_id === digitalocean.server.id && j.kind === 'RESCUE_ENABLE'), false,
        'and no job that could only fail was queued',
      );
    });

    await t.test('rescue is queued on a provider that offers it, and only then does the row change', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/servers/${hetzner.server.id}/rescue`, method: 'POST', body: {},
      }, customer);
      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.data.queued, true);
      const row = await app.store.table('servers').findById(hetzner.server.id);
      assert.strictEqual(row.status, 'rescue');
      const jobs = await app.store.table('provisioning_jobs').all();
      assert.ok(jobs.some((j) => j.server_id === hetzner.server.id && j.kind === 'RESCUE_ENABLE'));
    });

    await t.test('power actions are never capability-gated', async () => {
      // Hetzner declares every power action, but the point is that the gate does not consult a
      // capability at all for them: an unavailable flag must not strand a reboot.
      const res = await jsonFetch(base, {
        path: `/api/v1/servers/${hetzner.server.id}/reboot`, method: 'POST', body: {},
      }, customer);
      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.data.queued, true);
    });

    await t.test('reinstall is refused on EC2 unless the deployment opts in', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/servers/${aws.server.id}/reinstall`, method: 'POST', body: { osId: 'x' },
      }, customer);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /Amazon EC2/);
      assert.match(res.data.message, /reinstall/);
    });

    await t.test('snapshots are gated on the snapshot capability', async () => {
      const ok = await jsonFetch(base, {
        path: `/api/v1/servers/${hetzner.server.id}/snapshots`, method: 'POST', body: { description: 'before upgrade' },
      }, customer);
      assert.strictEqual(ok.status, 202, 'Hetzner snapshots are queued');
    });
  } finally {
    await close();
    await fake.close();
  }
});

test('integration: the EC2 reinstall opt-in is honoured by the same predicate the adapter uses', async (t) => {
  // The profile says `reinstall: false` because the workflow is deployment-scoped. A gate that read
  // only the profile would refuse an operator who had explicitly enabled it; a gate that re-implemented
  // the rule would eventually drift from the adapter. So it reuses `replacementEnabled`.
  const { base, app, close } = await startServer({
    ...CREDENTIALS, AWS_ALLOW_ROOT_VOLUME_REPLACEMENT: 'true',
  });
  try {
    const adminEmail = await token(base, 'optin-admin@example.com');
    const adminUser = await app.store.table('users').findOne({ email: adminEmail });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const admin = await login(base, adminEmail);
    const customerEmail = await token(base, 'optin-customer@example.com');
    const customer = await login(base, customerEmail);

    const aws = await seedServer(base, app, admin, customerEmail, 'aws', null, 'i-0optin', { id: '66666666-2222-4333-8444-666666666666' });
    const res = await jsonFetch(base, {
      path: `/api/v1/servers/${aws.server.id}/reinstall`, method: 'POST', body: { osId: 'x' },
    }, customer);
    assert.strictEqual(res.status, 202, 'the deployment opt-in enables the workflow');
    assert.strictEqual(res.data.queued, true);
  } finally {
    await close();
  }
});
