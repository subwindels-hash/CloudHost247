/**
 * Integration tests for the infrastructure operations surface (infrastructure.ts): provisioning
 * metrics, the operating-system lifecycle sweep, scheduled terminations, server state
 * reconciliation/drift and the notification outbox.
 *
 * These are the routes an operator uses when something is already wrong, so each test drives a real
 * inconsistency through the store and checks the route reports it — rather than asserting a shape.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startServer, jsonFetch, register } = require('./helpers');

async function adminToken(base, app, email = 'ops-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return { token: login.data.accessToken, user };
}

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const DAY = 86400000;

/** A tiny HTTP endpoint standing in for the operator's email-delivery webhook. */
async function startEmailSink() {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}');
      requests.push({ headers: req.headers, body: parsed });
      const subject = String(parsed.subject ?? '');
      if (subject.includes('reject')) { res.writeHead(401).end('{}'); return; }
      if (subject.includes('fail')) { res.writeHead(500).end('{}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/deliver`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('integration: infrastructure operations', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const { token: admin, user: adminUser } = await adminToken(base, app);
    const customer = await register(base, 'ops-customer@example.com', 'SuperSecret123!');
    const customerUser = await app.store.table('users').findOne({ email: 'ops-customer@example.com' });

    const provider = await app.store.table('infra_providers').insert({
      id: '90000000-0000-4000-8000-000000000001', name: 'Ops provider', slug: 'ops-provider',
      type: 'hetzner', adapter: 'hetzner', status: 'ACTIVE', active: true,
      created_at: iso(0), updated_at: iso(0),
    });
    const region = await app.store.table('regions').insert({
      id: '90000000-0000-4000-8000-000000000002', provider_id: provider.id, code: 'fra1',
      name: 'Frankfurt', status: 'ACTIVE', active: true, created_at: iso(0), updated_at: iso(0),
    });
    const makeServer = (id, overrides = {}) => app.store.table('servers').insert({
      id, name: `srv-${id.slice(-4)}`, hostname: `${id.slice(-4)}.example.com`, status: 'active',
      user_id: customerUser.id, region_id: region.id, provider: provider.id,
      created_at: iso(0), updated_at: iso(0), ...overrides,
    });

    await t.test('provisioning metrics expose failure, queue depth and stalls', async () => {
      const server = await makeServer('90000000-0000-4000-8000-000000000010');
      await app.store.table('provisioning_jobs').insert({
        id: '90000000-0000-4000-8000-000000000020', server_id: server.id, status: 'ready',
        attempts: 2, started_at: iso(-90000), finished_at: iso(-80000),
        created_at: iso(-90000), updated_at: iso(-80000),
      });
      await app.store.table('provisioning_jobs').insert({
        id: '90000000-0000-4000-8000-000000000021', server_id: server.id, status: 'failed',
        error: 'provider refused the request', attempts: 1,
        started_at: iso(-70000), finished_at: iso(-60000), created_at: iso(-70000), updated_at: iso(-60000),
      });
      await app.store.table('provisioning_jobs').insert({
        id: '90000000-0000-4000-8000-000000000022', server_id: server.id, status: 'running',
        attempts: 1, started_at: iso(-45 * 60000), created_at: iso(-45 * 60000), updated_at: iso(-45 * 60000),
      });
      await app.store.table('deployments').insert({
        id: '90000000-0000-4000-8000-000000000023', action: 'server_create', status: 'queued',
        server_id: server.id, attempts: 0, created_at: iso(0), updated_at: iso(0),
      });

      const res = await jsonFetch(base, { path: '/api/v1/admin/provisioning-metrics' }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.total, 3);
      assert.strictEqual(res.data.ready, 1);
      assert.strictEqual(res.data.failed, 1);
      assert.strictEqual(res.data.retries, 1, 'a job that needed two attempts is one retry');
      assert.strictEqual(res.data.average_duration_seconds, 10);
      assert.strictEqual(res.data.queueDepth, 1);
      assert.strictEqual(res.data.stalledJobs, 1, 'the job running for 45 minutes is stalled');
      assert.deepStrictEqual(res.data.failuresByCode, [{ code: 'provider refused the request', count: 1 }]);
      const row = res.data.providers.find((p) => p.providerId === provider.id);
      assert.ok(row, 'jobs are attributed to the provider that owns the server');
      assert.strictEqual(row.total, 3);
      assert.strictEqual(row.ready, 1);
      assert.strictEqual(row.failed, 1);
      assert.strictEqual(row.inProgress, 1);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/provisioning-metrics' })).status, 401);
    });

    await t.test('the lifecycle sweep only advances catalog statuses', async () => {
      const os = await app.store.table('operating_systems').insert({
        id: '90000000-0000-4000-8000-000000000030', slug: 'debian', name: 'Debian', status: 'active',
        is_vps_supported: true, eol_at: iso(-400 * DAY),
        created_at: iso(0), updated_at: iso(0),
      });
      const make = (id, version, eol) => app.store.table('operating_system_versions').insert({
        id, operating_system_id: os.id, version, display_name: `Debian ${version}`,
        architecture_support: ['x86_64'], status: 'ACTIVE', end_of_life_date: eol,
        created_at: iso(0), updated_at: iso(0),
      });
      await make('90000000-0000-4000-8000-000000000031', '10', iso(-10 * DAY));
      await make('90000000-0000-4000-8000-000000000032', '11', iso(30 * DAY));
      await make('90000000-0000-4000-8000-000000000033', '9', iso(-400 * DAY));

      const res = await jsonFetch(base, { path: '/api/v1/admin/os-lifecycle/sweep', method: 'POST', body: {} }, admin);
      assert.strictEqual(res.status, 200);
      const byId = new Map(res.data.transitions.map((row) => [row.id, row]));
      assert.strictEqual(byId.get('90000000-0000-4000-8000-000000000031').to, 'EOL');
      assert.strictEqual(byId.get('90000000-0000-4000-8000-000000000032').to, 'EOL_WARNING');
      assert.strictEqual(byId.get('90000000-0000-4000-8000-000000000033').to, 'ARCHIVED');
      assert.strictEqual(
        res.data.transitions.find((row) => row.kind === 'operating_system').to, 'archived',
        'the operating system is archived once its own end-of-life has passed',
      );

      // A second sweep has nothing to do — the states are already applied.
      const again = await jsonFetch(base, { path: '/api/v1/admin/os-lifecycle/sweep', method: 'POST', body: {} }, admin);
      assert.deepStrictEqual(again.data.transitions, []);

      // Runtime state is untouched: the sweep is a catalog operation.
      const server = await app.store.table('servers').findById('90000000-0000-4000-8000-000000000010');
      assert.strictEqual(server.status, 'active');
    });

    await t.test('scheduled terminations are enqueued once', async () => {
      const due = await makeServer('90000000-0000-4000-8000-000000000040', {
        metadata: { scheduled_termination_at: iso(-3600000) },
      });
      const notDue = await makeServer('90000000-0000-4000-8000-000000000041', {
        metadata: { scheduled_termination_at: iso(7 * DAY) },
      });

      const res = await jsonFetch(base, { path: '/api/v1/admin/server-terminations/sweep', method: 'POST', body: {} }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.terminated.length, 1);
      assert.strictEqual(res.data.terminated[0].serverId, due.id);

      const deployment = await app.store.table('deployments').findOne({ server_id: due.id, action: 'server_terminate' });
      assert.ok(deployment, 'a DELETE job is queued');
      assert.strictEqual(deployment.status, 'queued');
      assert.strictEqual((await app.store.table('servers').findById(due.id)).status, 'deleting');
      assert.strictEqual((await app.store.table('servers').findById(notDue.id)).status, 'active', 'a future termination is left alone');

      const again = await jsonFetch(base, { path: '/api/v1/admin/server-terminations/sweep', method: 'POST', body: {} }, admin);
      assert.deepStrictEqual(again.data.terminated, [], 'a server with a live termination job is not queued twice');
    });

    await t.test('reconciliation records drift and clears it when it goes away', async () => {
      const terminating = '90000000-0000-4000-8000-000000000050';
      await makeServer(terminating, { status: 'deleting', metadata: { scheduled_termination_at: iso(-2 * 3600000) } });
      await app.store.table('deployments').insert({
        id: '90000000-0000-4000-8000-000000000051', action: 'server_terminate', status: 'ready',
        server_id: terminating, attempts: 1, created_at: iso(-3600000), updated_at: iso(-1800000),
      });
      const mismatched = '90000000-0000-4000-8000-000000000052';
      await makeServer(mismatched, { status: 'active' });
      await app.store.table('deployments').insert({
        id: '90000000-0000-4000-8000-000000000053', action: 'server_resize', status: 'failed',
        server_id: mismatched, attempts: 1, created_at: iso(-3600000), updated_at: iso(-3600000),
      });
      const stale = '90000000-0000-4000-8000-000000000054';
      await makeServer(stale, { status: 'active', metadata: { reconciliation: { kind: 'STATUS_MISMATCH', observedAt: iso(-DAY) } } });

      const res = await jsonFetch(base, { path: '/api/v1/admin/server-reconciliation/sweep', method: 'POST', body: {} }, admin);
      assert.strictEqual(res.status, 200);
      const byServer = new Map(res.data.drifts.map((row) => [row.serverId, row]));
      assert.strictEqual(byServer.get(terminating).kind, 'TERMINATION_CONFIRMED');
      assert.strictEqual(byServer.get(terminating).applied, true);
      assert.strictEqual(byServer.get(mismatched).kind, 'STATUS_MISMATCH');
      assert.strictEqual(byServer.get(mismatched).applied, false, 'nothing is changed without evidence');
      assert.strictEqual(byServer.has(stale), false, 'a server that agrees with itself is not drift');
      assert.strictEqual((await app.store.table('servers').findById(terminating)).status, 'retired', 'a confirmed termination retires the record');
      assert.strictEqual((await app.store.table('servers').findById(stale)).metadata.reconciliation, undefined, 'stale drift is cleared');
      assert.strictEqual((await app.store.table('servers').findById(mismatched)).metadata.reconciliation.kind, 'STATUS_MISMATCH');

      const listed = await jsonFetch(base, { path: '/api/v1/admin/server-drift' }, admin);
      assert.strictEqual(listed.status, 200);
      const ids = listed.data.servers.map((row) => row.id);
      assert.ok(ids.includes(mismatched), 'drift is listed for the operator');
      assert.ok(ids.includes(terminating), 'including a drift that was applied');
      assert.strictEqual(ids.includes(stale), false);
      assert.ok(listed.data.servers.find((row) => row.id === mismatched).lastReconciledAt, 'the check time is recorded');

      const stalled = '90000000-0000-4000-8000-000000000055';
      await makeServer(stalled, { status: 'active' });
      await app.store.table('provisioning_jobs').insert({
        id: '90000000-0000-4000-8000-000000000056', server_id: stalled, status: 'running',
        attempts: 1, started_at: iso(-3 * 3600000), created_at: iso(-3 * 3600000), updated_at: iso(-3 * 3600000),
      });
      const again = await jsonFetch(base, { path: '/api/v1/admin/server-reconciliation/sweep', method: 'POST', body: {} }, admin);
      assert.strictEqual(again.data.drifts.find((row) => row.serverId === stalled).kind, 'PROVISIONING_STALLED');
    });

    await t.test('the outbox reports a backlog and fails closed without a webhook', async () => {
      await app.store.table('notification_outbox').insert({
        id: '90000000-0000-4000-8000-000000000060', user_id: customerUser.id, channel: 'EMAIL',
        subject: 'Your server is ready', body: 'It is ready.', status: 'pending',
        attempts: 0, max_attempts: 5, created_at: iso(0), updated_at: iso(0),
      });

      const before = await jsonFetch(base, { path: '/api/v1/admin/notification-outbox' }, admin);
      assert.strictEqual(before.status, 200);
      assert.deepStrictEqual(before.data.summary, [{ status: 'pending', channel: 'email', count: 1, oldest_created_at: before.data.summary[0].oldest_created_at }]);
      assert.deepStrictEqual(before.data.problems, []);

      const drained = await jsonFetch(base, { path: '/api/v1/admin/notification-outbox/drain', method: 'POST', body: {} }, admin);
      assert.strictEqual(drained.status, 200);
      assert.strictEqual(drained.data.claimed, 1);
      assert.strictEqual(drained.data.delivered, 0, 'nothing was sent, so nothing is reported as sent');
      assert.strictEqual(drained.data.configurationRequired, 1);

      const row = await app.store.table('notification_outbox').findById('90000000-0000-4000-8000-000000000060');
      assert.strictEqual(row.status, 'configuration_required');
      assert.match(row.last_error, /webhook is not configured/);
      assert.ok(Date.parse(row.next_attempt_at) > Date.now(), 'the row waits instead of being burned');

      const after = await jsonFetch(base, { path: '/api/v1/admin/notification-outbox' }, admin);
      assert.strictEqual(after.data.problems.length, 1);
      assert.strictEqual(after.data.problems[0].email, 'ops-customer@example.com');
      assert.strictEqual(after.data.summary[0].status, 'configuration_required');

      const immediate = await jsonFetch(base, { path: '/api/v1/admin/notification-outbox/drain', method: 'POST', body: {} }, admin);
      assert.strictEqual(immediate.data.claimed, 0, 'a row waiting on configuration is not retried immediately');
    });

    assert.ok(adminUser && admin);
    assert.ok(customer.data.accessToken);
  } finally {
    await close();
  }
});

test('integration: the notification outbox delivers through the configured webhook', async (t) => {
  const sink = await startEmailSink();
  const { base, app, close } = await startServer({
    NOTIFICATION_EMAIL_WEBHOOK_URL: sink.url,
    NOTIFICATION_EMAIL_WEBHOOK_TOKEN: 'sink-token',
  });
  try {
    const { token: admin } = await adminToken(base, app, 'outbox-admin@example.com');
    const customerUser = await app.store.table('users').findOne({ email: 'outbox-admin@example.com' });
    const queued = (id, subject, overrides = {}) => app.store.table('notification_outbox').insert({
      id, user_id: customerUser.id, channel: 'EMAIL', subject, body: `${subject} body`,
      status: 'pending', attempts: 0, max_attempts: 5, created_at: iso(0), updated_at: iso(0), ...overrides,
    });

    await queued('90000000-0000-4000-8000-000000000070', 'Welcome aboard');
    const delivered = await jsonFetch(base, { path: '/api/v1/admin/notification-outbox/drain', method: 'POST', body: {} }, admin);
    assert.strictEqual(delivered.data.delivered, 1);
    assert.strictEqual(sink.requests.length, 1);
    assert.strictEqual(sink.requests[0].body.to, 'outbox-admin@example.com');
    assert.strictEqual(sink.requests[0].body.subject, 'Welcome aboard');
    assert.strictEqual(sink.requests[0].headers.authorization, 'Bearer sink-token');
    const sent = await app.store.table('notification_outbox').findById('90000000-0000-4000-8000-000000000070');
    assert.strictEqual(sent.status, 'delivered');
    assert.strictEqual(sent.attempts, 1);
    assert.ok(sent.delivered_at);

    await queued('90000000-0000-4000-8000-000000000071', 'reject this one');
    const rejected = await jsonFetch(base, { path: '/api/v1/admin/notification-outbox/drain', method: 'POST', body: {} }, admin);
    assert.strictEqual(rejected.data.configurationRequired, 1, 'a rejected credential is the operator\'s to fix');
    assert.strictEqual((await app.store.table('notification_outbox').findById('90000000-0000-4000-8000-000000000071')).status, 'configuration_required');

    await queued('90000000-0000-4000-8000-000000000072', 'fail this one');
    const retried = await jsonFetch(base, { path: '/api/v1/admin/notification-outbox/drain', method: 'POST', body: {} }, admin);
    assert.strictEqual(retried.data.retrying, 1, 'a 5xx is retried rather than dropped');
    const pending = await app.store.table('notification_outbox').findById('90000000-0000-4000-8000-000000000072');
    assert.strictEqual(pending.status, 'pending');
    assert.strictEqual(pending.attempts, 1);
    assert.match(pending.last_error, /HTTP 500/);

    // …and once the attempt budget is spent the same row is failed rather than retried forever.
    await app.store.table('notification_outbox').updateById('90000000-0000-4000-8000-000000000072', {
      max_attempts: 1, next_attempt_at: iso(-1000),
    });
    const exhausted = await jsonFetch(base, { path: '/api/v1/admin/notification-outbox/drain', method: 'POST', body: {} }, admin);
    assert.strictEqual(exhausted.data.failed, 1);
    assert.strictEqual((await app.store.table('notification_outbox').findById('90000000-0000-4000-8000-000000000072')).status, 'failed');
  } finally {
    await close();
    await sink.close();
  }
});
