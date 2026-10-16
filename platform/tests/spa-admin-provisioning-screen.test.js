'use strict';

/**
 * Admin provisioning screen contract (AdminProvisioningPage).
 *
 * Walks the exact HTTP sequence the screen issues — metrics, job list + status filter, job detail,
 * one worker cycle (the route a scheduler hits), reconcile, retry/cancel with the server's status
 * guards — over the real app with a real queued job from the customer server-create flow.
 * Pins the page source to the response keys it renders.
 * (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminProvisioningPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

async function adminToken(base, app, email = 'prov-screen-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('admin provisioning screen: endpoint sequence and response contract', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    const admin = await adminToken(base, app);

    // A real queued job: a customer creates a server.
    const customer = await register(base, 'prov-screen-cust@example.com');
    const created = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/servers', body: { name: 'provbox', hostname: 'provbox.example.com' },
    }, customer.data.accessToken);
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));

    // -- metrics card --
    const metrics = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/provisioning/metrics' }, admin);
    assert.strictEqual(metrics.status, 200);
    assert.ok(typeof metrics.data.total === 'number', 'metrics reads total');
    assert.ok(metrics.data.byStatus && typeof metrics.data.byStatus === 'object', 'metrics reads byStatus');

    // -- jobs table --
    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/provisioning/jobs' }, admin);
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.data.jobs) && list.data.jobs.length >= 1, 'jobs table reads jobs');
    assert.ok(typeof list.data.total === 'number', 'jobs table reads total');
    const row = list.data.jobs.find((j) => j.kind === 'CREATE');
    for (const key of ['id', 'kind', 'resourceType', 'resourceId', 'status', 'createdAt', 'userId']) {
      assert.ok(row[key] !== undefined, `job row reads ${key}`);
    }

    const filtered = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/provisioning/jobs?status=queued' }, admin);
    assert.strictEqual(filtered.status, 200);
    assert.ok(filtered.data.jobs.every((j) => j.status === 'queued'), 'status filter applied');

    // -- job detail --
    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/provisioning-jobs/${row.id}` }, admin);
    assert.strictEqual(detail.status, 200);
    assert.ok(detail.data.job, 'detail reads job');
    for (const key of ['id', 'kind', 'status', 'attempts', 'startedAt', 'finishedAt']) {
      assert.ok(detail.data.job[key] !== undefined, `detail reads job.${key}`);
    }
    assert.ok(Array.isArray(detail.data.steps) && Array.isArray(detail.data.events), 'detail reads steps + events');

    // -- retry + cancel guards (checked while the CREATE job is still queued) --
    const retried = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/provisioning-jobs/${row.id}/retry`,
    }, admin);
    assert.strictEqual(retried.status, 409, 'a non-failed job cannot be retried');
    const failedJob = await app.store.table('provisioning_jobs').insert({
      kind: 'CREATE', resource_type: 'servers', resource_id: 'srv-x', status: 'failed', error: 'boom', attempts: 3,
    });
    const cancelRefused = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/provisioning-jobs/${failedJob.id}/cancel`,
    }, admin);
    assert.strictEqual(cancelRefused.status, 409, 'a non-queued job cannot be cancelled on the strict route');
    const retry = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/provisioning-jobs/${failedJob.id}/retry`,
    }, admin);
    assert.strictEqual(retry.status, 200);
    assert.strictEqual(retry.data.queued, true, 'retry result reads queued');

    // -- worker cycle (the route a scheduler hits) --
    const cycle = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/admin/provisioning/worker/run', body: { limit: 10 },
    }, admin);
    assert.strictEqual(cycle.status, 200, JSON.stringify(cycle.data));
    for (const key of ['claimed', 'completed', 'failed', 'requeued', 'deadLettered', 'results']) {
      assert.ok(key in cycle.data, `worker result reads ${key}`);
    }

    // -- reconcile --
    const rec = await jsonFetch(base, { method: 'POST', path: '/api/v1/admin/provisioning/reconcile' }, admin);
    assert.strictEqual(rec.status, 200);
    assert.ok(typeof rec.data.reconciled === 'number' && typeof rec.data.leftQueued === 'number',
      'reconcile reads reconciled + leftQueued');

    // -- staff gate --
    const denied = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/provisioning/jobs' }, customer.data.accessToken);
    assert.strictEqual(denied.status, 403);

    // -- pin the page + client to this contract --
    for (const key of ['byStatus', 'deadLettered', 'leftQueued', 'attempts']) {
      assert.ok(PAGE_SRC.includes(key), `AdminProvisioningPage renders response key '${key}'`);
    }
    assert.ok(API_CLIENT_SRC.includes('export const adminApi'), 'api client exports adminApi');
    for (const pathPart of ['/api/v1/admin/provisioning/jobs', '/api/v1/admin/provisioning/metrics', '/worker/run', '/reconcile', '/retry']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
