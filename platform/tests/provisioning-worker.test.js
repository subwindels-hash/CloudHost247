/**
 * The provisioning worker: queued jobs executed against a real provider boundary.
 *
 * Until this, `provisioning_jobs` rows were written by the customer routes and read by nobody — the
 * admin reconcile route failed every one of them with "reconciled: no active worker", so a customer's
 * reboot was a row that went red. These tests drive the real route over the real HTTP pipeline
 * against a loopback provider API, and assert the four properties the worker exists to hold:
 * creation is idempotent, a refusal is not a retry, secrets never land on a job row an admin can
 * read, and an unknown job kind fails by name instead of going green.
 *
 * Not claimed: no call has been made to a real provider account, so provider-side acceptance of these
 * requests is unverified.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { startServer, jsonFetch, register } = require('./helpers');
const { MAX_ATTEMPTS } = require('../src/lib/provisioning-worker');

const RESCUE_PASSWORD = 'rescue-root-password-7c1';

/**
 * A loopback stand-in for a Hetzner API. Handlers may be functions of the recorded request, which is
 * how the idempotency test makes the label lookup start answering after the first create.
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
      const result = typeof entry === 'function' ? entry({ url: req.url, body }) : entry;
      if (result === undefined) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'not found' } }));
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

const now = () => new Date().toISOString();

test('integration: the provisioning worker', async (t) => {
  let createdOnce = false;
  const fake = await startFakeProvider({
    // The idempotency lookup. Answers empty until a server exists, then returns it — which is what
    // makes a retried create find the first machine instead of allocating a second.
    'GET /servers': () => (createdOnce
      ? { status: 200, body: { servers: [{ id: 9001, name: 'build.example.com', status: 'running', public_net: { ipv4: { ip: '203.0.113.99' } }, image: { id: 12345 } }] } }
      : { status: 200, body: { servers: [] } }),
    'POST /servers': () => {
      createdOnce = true;
      return {
        status: 201,
        body: {
          server: {
            id: 9001, name: 'build.example.com', status: 'initializing',
            public_net: { ipv4: { ip: '203.0.113.99' } }, image: { id: 12345, name: 'ubuntu-24.04' },
          },
        },
      };
    },
    'POST /servers/42/actions/reboot': { status: 200, body: { action: { id: 1, status: 'running' } } },
    'POST /servers/42/actions/enable_rescue': { status: 201, body: { root_password: RESCUE_PASSWORD } },
    'POST /servers/42/actions/reset': { status: 201, body: { action: { id: 2 } } },
    'POST /servers/42/actions/create_image': { status: 201, body: { image: { id: 555, status: 'available' } } },
    'DELETE /servers/42': { status: 200, body: { server: { id: 42 } } },
    // A provider that is having a bad day: 500 classifies as retryable.
    'POST /servers/777/actions/reboot': { status: 503, body: { error: { message: 'upstream is melting' } } },
  });

  const { base, app, close } = await startServer({ HETZNER_API_TOKEN: 'test-hetzner-token' });
  try {
    await register(base, 'worker-admin@example.com', 'SuperSecret123!');
    const adminUser = await app.store.table('users').findOne({ email: 'worker-admin@example.com' });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const admin = (await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'worker-admin@example.com', password: 'SuperSecret123!' },
    })).data.accessToken;

    await register(base, 'worker-customer@example.com', 'SuperSecret123!');
    const customer = (await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'worker-customer@example.com', password: 'SuperSecret123!' },
    })).data.accessToken;
    const owner = await app.store.table('users').findOne({ email: 'worker-customer@example.com' });

    // Provider, region, plan and a verified image mapping — the four things a real build needs.
    const provider = (await jsonFetch(base, {
      path: '/api/v1/admin/providers', method: 'POST',
      body: { name: 'Hetzner worker', type: 'hetzner', config: { adapter: 'hetzner' }, apiBaseUrl: fake.base },
    }, admin)).data.provider.id;
    await jsonFetch(base, { path: `/api/v1/admin/providers/${provider}`, method: 'PATCH', body: { status: 'ACTIVE' } }, admin);
    const regionId = (await jsonFetch(base, {
      path: '/api/v1/admin/regions', method: 'POST', body: { name: 'Falkenstein', code: 'fsn1', providerId: provider },
    }, admin)).data.region.id;

    const planId = 'aaaaaaaa-1111-4111-8111-111111111111';
    const osId = 'bbbbbbbb-1111-4111-8111-111111111111';
    await app.store.table('server_plans').insert({
      id: planId, name: 'CX22', slug: 'cx22', active: true, spec: { providerServerType: 'cx22' },
      created_at: now(),
    });
    await app.store.table('os_images').insert({
      id: 'cccccccc-1111-4111-8111-111111111111', os_id: osId, provider_image_id: '12345',
      region_id: regionId, arch: 'x86_64', status: 'active', active: true,
      verified_at: now(), verified_by: adminUser.id, created_at: now(), updated_at: now(),
    });

    const mkServer = async (id, extra = {}) => app.store.table('servers').insert({
      id, user_id: owner.id, name: `server-${id.slice(0, 8)}`, hostname: `${id.slice(0, 8)}.example.com`,
      provider: 'hetzner', region_id: regionId, plan_id: planId, os_id: osId, status: 'active',
      metadata: { providerServerId: '42' }, created_at: now(), updated_at: now(), ...extra,
    });

    const mkJob = async (id, serverId, kind, payload = {}) => app.store.table('provisioning_jobs').insert({
      id, user_id: owner.id, kind, resource_type: 'servers', resource_id: serverId,
      server_id: serverId, status: 'queued', payload, attempts: 0, created_at: now(), updated_at: now(),
    });

    const runWorker = async (limit = 25) => jsonFetch(base, {
      path: '/api/v1/admin/provisioning/worker/run', method: 'POST', body: { limit },
    }, admin);

    await t.test('a queued lifecycle action is executed against the provider', async () => {
      const server = await mkServer('11111111-aaaa-4aaa-8aaa-111111111111');
      const reboot = await jsonFetch(base, {
        path: `/api/v1/servers/${server.id}/reboot`, method: 'POST', body: {},
      }, customer);
      assert.strictEqual(reboot.status, 202, 'the customer route queues rather than pretending');

      const before = fake.requests.length;
      const cycle = await runWorker();
      assert.strictEqual(cycle.status, 200);
      assert.strictEqual(cycle.data.claimed, 1);
      assert.strictEqual(cycle.data.completed, 1);
      assert.strictEqual(cycle.data.failed, 0);

      const sent = fake.requests.slice(before);
      assert.strictEqual(sent.length, 1, 'exactly one provider call');
      assert.strictEqual(sent[0].method, 'POST');
      assert.match(sent[0].url, /^\/servers\/42\/actions\/reboot$/);

      const job = await app.store.table('provisioning_jobs').findById(reboot.data.jobId);
      assert.strictEqual(job.status, 'completed');
      assert.strictEqual(job.attempts, 1);
      assert.ok(job.finished_at, 'the job is finished, not left running');
    });

    await t.test('CREATE allocates once and writes the provider handle back onto the server', async () => {
      const server = await app.store.table('servers').insert({
        id: '22222222-aaaa-4aaa-8aaa-222222222222', user_id: owner.id, name: 'build',
        hostname: 'build.example.com', provider: 'hetzner', region_id: regionId,
        plan_id: planId, os_id: osId, status: 'provisioning', metadata: {},
        created_at: now(), updated_at: now(),
      });
      const job = await mkJob('33333333-aaaa-4aaa-8aaa-333333333333', server.id, 'CREATE');

      const cycle = await runWorker();
      assert.strictEqual(cycle.data.completed, 1, JSON.stringify(cycle.data.results));

      const row = await app.store.table('servers').findById(server.id);
      assert.strictEqual(row.metadata.providerServerId, '9001', 'the handle the rest of the platform needs');
      assert.strictEqual(row.ip_address, '203.0.113.99');
      assert.strictEqual(row.status, 'active', 'the customer sees a machine, not a spinner');

      const creates = fake.requests.filter((r) => r.method === 'POST' && r.url === '/servers');
      assert.strictEqual(creates.length, 1);
      const body = JSON.parse(creates[0].body);
      assert.strictEqual(body.labels.cloudhost247_idempotency, job.id, 'the job id is the idempotency key');
      assert.strictEqual(body.server_type, 'cx22', 'the plan spec is what the provider was told to build');
      assert.strictEqual(body.image, '12345');
      assert.strictEqual(body.location, 'fsn1', 'the region code, not our internal id');
    });

    await t.test('a retried CREATE finds the first machine instead of allocating a second', async () => {
      const server = await app.store.table('servers').insert({
        id: '44444444-aaaa-4aaa-8aaa-444444444444', user_id: owner.id, name: 'build2',
        hostname: 'build2.example.com', provider: 'hetzner', region_id: regionId,
        plan_id: planId, os_id: osId, status: 'provisioning', metadata: {},
        created_at: now(), updated_at: now(),
      });
      const job = await mkJob('55555555-aaaa-4aaa-8aaa-555555555555', server.id, 'CREATE');
      // Simulate the crash the idempotency key exists for: the provider call happened, the local
      // write did not, and the job is queued again.
      await app.store.table('provisioning_jobs').updateById(job.id, { status: 'queued' });
      const before = fake.requests.filter((r) => r.method === 'POST' && r.url === '/servers').length;

      const cycle = await runWorker();
      assert.strictEqual(cycle.data.completed, 1, JSON.stringify(cycle.data.results));
      const after = fake.requests.filter((r) => r.method === 'POST' && r.url === '/servers').length;
      assert.strictEqual(after, before, 'no second machine was allocated');

      const row = await app.store.table('servers').findById(server.id);
      assert.strictEqual(row.metadata.providerServerId, '9001', 'the existing machine was adopted');
    });

    await t.test('a rescue password reaches the credentials table and never the job row', async () => {
      const server = await mkServer('66666666-aaaa-4aaa-8aaa-666666666666');
      const job = await mkJob('77777777-aaaa-4aaa-8aaa-777777777777', server.id, 'RESCUE_ENABLE');

      const cycle = await runWorker();
      assert.strictEqual(cycle.data.completed, 1, JSON.stringify(cycle.data.results));

      const row = await app.store.table('provisioning_jobs').findById(job.id);
      assert.strictEqual(row.status, 'completed');
      assert.strictEqual(JSON.stringify(row).includes(RESCUE_PASSWORD), false,
        'job.result is readable through the admin API, so the password must not be on it');

      const creds = await app.store.table('server_credentials').find({ server_id: server.id });
      const rescue = creds.rows.find((c) => c.kind === 'rescue');
      assert.ok(rescue, 'the password is stored where server secrets live');
      assert.strictEqual(rescue.secret, RESCUE_PASSWORD);
      assert.strictEqual(rescue.username, 'root');
    });

    await t.test('a retryable provider failure is re-queued, then dead-lettered at the attempt limit', async () => {
      const server = await mkServer('88888888-aaaa-4aaa-8aaa-888888888888', { metadata: { providerServerId: '777' } });
      const job = await mkJob('99999999-aaaa-4aaa-8aaa-999999999999', server.id, 'REBOOT');

      for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt += 1) {
        const cycle = await runWorker();
        assert.strictEqual(cycle.data.requeued, 1, `attempt ${attempt} is re-queued, not failed`);
        const row = await app.store.table('provisioning_jobs').findById(job.id);
        assert.strictEqual(row.status, 'queued');
        assert.strictEqual(row.attempts, attempt);
        assert.ok(row.error, 'the reason is on the row');
      }

      const final = await runWorker();
      assert.strictEqual(final.data.deadLettered, 1, 'the attempt limit dead-letters it');
      const row = await app.store.table('provisioning_jobs').findById(job.id);
      assert.strictEqual(row.status, 'failed');
      assert.strictEqual(row.attempts, MAX_ATTEMPTS);
      assert.strictEqual(row.result.failure.retryable, true);
    });

    await t.test('a refusal is final on the first attempt', async () => {
      // A rescue job for a server whose provider offers no rescue system — queued directly, the way
      // a job from before the queue-time gate existed would be.
      const doProvider = (await jsonFetch(base, {
        path: '/api/v1/admin/providers', method: 'POST',
        body: { name: 'DO worker', type: 'digitalocean', slug: 'do-worker', config: { adapter: 'digitalocean' } },
      }, admin)).data.provider.id;
      const doRegion = (await jsonFetch(base, {
        path: '/api/v1/admin/regions', method: 'POST', body: { name: 'NYC', code: 'nyc1', providerId: doProvider },
      }, admin)).data.region.id;
      const server = await app.store.table('servers').insert({
        id: 'a1a1a1a1-aaaa-4aaa-8aaa-a1a1a1a1a1a1', user_id: owner.id, name: 'do-box',
        hostname: 'do.example.com', provider: 'digitalocean', region_id: doRegion,
        status: 'active', metadata: { providerServerId: '99' }, created_at: now(), updated_at: now(),
      });
      const job = await mkJob('b2b2b2b2-aaaa-4aaa-8aaa-b2b2b2b2b2b2', server.id, 'RESCUE_ENABLE');

      const cycle = await runWorker();
      assert.strictEqual(cycle.data.failed, 1, JSON.stringify(cycle.data.results));
      assert.strictEqual(cycle.data.requeued, 0, 'a refusal is not retried');
      const row = await app.store.table('provisioning_jobs').findById(job.id);
      assert.strictEqual(row.status, 'failed');
      assert.strictEqual(row.attempts, 1, 'one attempt, not three');
      assert.match(row.error, /does not offer rescue/);
      assert.strictEqual(row.result.failure.retryable, false);
    });

    await t.test('an unknown job kind fails by name instead of going green', async () => {
      const server = await mkServer('c3c3c3c3-aaaa-4aaa-8aaa-c3c3c3c3c3c3');
      const job = await mkJob('d4d4d4d4-aaaa-4aaa-8aaa-d4d4d4d4d4d4', server.id, 'FLY_TO_THE_MOON');
      const cycle = await runWorker();
      assert.strictEqual(cycle.data.failed, 1);
      const row = await app.store.table('provisioning_jobs').findById(job.id);
      assert.strictEqual(row.status, 'failed');
      assert.match(row.error, /No worker handler is implemented for job kind "FLY_TO_THE_MOON"/);
      assert.strictEqual(row.result.failure.code, 'UNKNOWN_JOB_KIND');
    });

    await t.test('a server with no provider handle fails with a reason rather than silently', async () => {
      const server = await mkServer('e5e5e5e5-aaaa-4aaa-8aaa-e5e5e5e5e5e5', { metadata: {} });
      const job = await mkJob('f6f6f6f6-aaaa-4aaa-8aaa-f6f6f6f6f6f6', server.id, 'REBOOT');
      const cycle = await runWorker();
      assert.strictEqual(cycle.data.failed, 1);
      const row = await app.store.table('provisioning_jobs').findById(job.id);
      assert.match(row.error, /holds no provider record/);
    });

    await t.test('provisioning from an unverified image mapping is refused', async () => {
      const server = await app.store.table('servers').insert({
        id: 'a7a7a7a7-aaaa-4aaa-8aaa-a7a7a7a7a7a7', user_id: owner.id, name: 'unverified',
        hostname: 'unverified.example.com', provider: 'hetzner', region_id: regionId,
        plan_id: planId, os_id: 'a8a8a8a8-1111-4111-8111-111111111111', status: 'provisioning',
        metadata: {}, created_at: now(), updated_at: now(),
      });
      await app.store.table('os_images').insert({
        id: 'a9a9a9a9-1111-4111-8111-111111111111', os_id: server.os_id, provider_image_id: '12345',
        region_id: regionId, arch: 'x86_64', status: 'active', active: true,
        verified_at: null, created_at: now(), updated_at: now(),
      });
      const job = await mkJob('b0b0b0b0-aaaa-4aaa-8aaa-b0b0b0b0b0b0', server.id, 'CREATE');
      const before = fake.requests.filter((r) => r.method === 'POST' && r.url === '/servers').length;
      const cycle = await runWorker();
      assert.strictEqual(cycle.data.failed, 1);
      const row = await app.store.table('provisioning_jobs').findById(job.id);
      assert.match(row.error, /has not been verified against the provider/);
      assert.strictEqual(
        fake.requests.filter((r) => r.method === 'POST' && r.url === '/servers').length, before,
        'nothing was allocated',
      );
    });

    await t.test('reconcile leaves the backlog alone and only fails a job whose lease expired', async () => {
      const server = await mkServer('c1c1c1c1-aaaa-4aaa-8aaa-c1c1c1c1c1c1');
      const queued = await mkJob('d2d2d2d2-aaaa-4aaa-8aaa-d2d2d2d2d2d2', server.id, 'REBOOT');
      const stuck = await mkJob('e3e3e3e3-aaaa-4aaa-8aaa-e3e3e3e3e3e3', server.id, 'REBOOT');
      const live = await mkJob('f4f4f4f4-aaaa-4aaa-8aaa-f4f4f4f4f4f4', server.id, 'REBOOT');
      // One job abandoned mid-action ten minutes ago, one claimed a moment ago.
      await app.store.table('provisioning_jobs').updateById(stuck.id, {
        status: 'running', started_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      });
      await app.store.table('provisioning_jobs').updateById(live.id, {
        status: 'running', started_at: new Date().toISOString(),
      });

      const res = await jsonFetch(base, {
        path: '/api/v1/admin/provisioning/reconcile', method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.reconciled, 1, 'only the abandoned job is failed');
      assert.strictEqual(res.data.leftQueued, 1, 'the backlog is reported, not destroyed');

      assert.strictEqual((await app.store.table('provisioning_jobs').findById(queued.id)).status, 'queued');
      assert.strictEqual((await app.store.table('provisioning_jobs').findById(live.id)).status, 'running');
      const failedStuck = await app.store.table('provisioning_jobs').findById(stuck.id);
      assert.strictEqual(failedStuck.status, 'failed');
      assert.match(failedStuck.error, /stopped responding/);
    });
  } finally {
    await close();
    await fake.close();
  }
});
