'use strict';

/**
 * Admin deployments screen contract (AdminDeploymentsPage).
 *
 * Walks the exact HTTP sequence the screen issues — queue list with status/action filters, detail
 * with step pipeline + events, queued-only Execute/Cancel (the server's guard, refusal verbatim),
 * and the deployment worker cycle a scheduler hits — over the real app. Pins the page source to
 * the response keys it renders. (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminDeploymentsPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

test('admin deployments screen: queue contract', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    await register(base, 'dep-screen-admin@example.com');
    const adminUser = await app.store.table('users').findOne({ email: 'dep-screen-admin@example.com' });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const login = await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'dep-screen-admin@example.com', password: 'SuperSecret123!' },
    });
    const admin = login.data.accessToken;

    // A real queued deployment requested by the admin (admins manage their own requests).
    const cust = await register(base, 'dep-screen-cust@example.com');
    await register(base, 'dep-screen-admin2@example.com');
    const created = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/deployments',
      body: { source: 'git', ref: 'main', action: 'install' },
    }, admin);
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    const deploymentId = created.data.deployment.id;

    // A customer-requested deployment is listable by staff but detail is owner-scoped
    // (canSeeDeployment is deliberately user-based) — the screen must show that refusal honestly.
    const custDep = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/deployments',
      body: { source: 'git', ref: 'prod', action: 'install' },
    }, cust.data.accessToken);
    assert.strictEqual(custDep.status, 201, JSON.stringify(custDep.data));

    // -- queue table + filters --
    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/deployments' }, admin);
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.data.deployments) && list.data.deployments.length >= 1, 'table reads deployments');
    const row = list.data.deployments.find((d) => d.id === deploymentId);
    for (const key of ['id', 'action', 'status', 'source', 'ref']) {
      assert.ok(key in row, `deployment row reads ${key}`);
    }
    const filtered = await jsonFetch(base, { method: 'GET', path: '/api/v1/deployments?status=queued&action=install' }, admin);
    assert.strictEqual(filtered.status, 200);
    assert.ok(filtered.data.deployments.every((d) => d.status === 'queued' && d.action === 'install'), 'filters applied');
    assert.ok(filtered.data.deployments.some((d) => d.id === custDep.data.deployment.id), 'staff see customer-requested deployments in the queue');

    const foreignDetail = await jsonFetch(base, { method: 'GET', path: `/api/v1/deployments/${custDep.data.deployment.id}` }, admin);
    assert.strictEqual(foreignDetail.status, 404, 'detail is owner-scoped even for staff');

    // -- detail --
    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/deployments/${deploymentId}` }, admin);
    assert.strictEqual(detail.status, 200);
    assert.ok(detail.data.deployment, 'detail reads deployment');
    assert.ok(Array.isArray(detail.data.steps) && Array.isArray(detail.data.events), 'detail reads steps + events');

    // -- cancel: queued-only guard --
    const finished = await app.store.table('deployments').insert({
      user_id: adminUser.id, requested_by: adminUser.id,
      source: 'git', ref: 'v1', action: 'install', status: 'succeeded', idempotency_key: 'dep-screen-done',
    });
    const cancelRefused = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/deployments/${finished.id}/cancel`,
    }, admin);
    assert.strictEqual(cancelRefused.status, 409, 'a non-queued deployment cannot be cancelled');
    assert.match(String(cancelRefused.data?.message ?? ''), /queued/i, 'the refusal names the guard');

    const cancelled = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/deployments/${deploymentId}/cancel`,
    }, admin);
    assert.strictEqual(cancelled.status, 200, JSON.stringify(cancelled.data));
    assert.strictEqual(cancelled.data.deployment.status, 'cancelled', 'cancel result reads deployment');

    // -- execute route exists and answers --
    const dep2 = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/deployments',
      body: { source: 'git', ref: 'main', action: 'install' },
    }, admin);
    const execute = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/deployments/${dep2.data.deployment.id}/execute`,
    }, admin);
    assert.ok([200, 201].includes(execute.status), `execute answers: ${execute.status} ${JSON.stringify(execute.data)}`);

    // -- worker cycle (the route a scheduler hits) --
    const sweep = await jsonFetch(base, { method: 'POST', path: '/api/v1/admin/deployments/sweep' }, admin);
    assert.strictEqual(sweep.status, 200);
    assert.strictEqual(sweep.data.ok, true, 'sweep reads ok');

    // -- staff gate on the sweep --
    const denied = await jsonFetch(base, { method: 'POST', path: '/api/v1/admin/deployments/sweep' }, cust.data.accessToken);
    assert.strictEqual(denied.status, 403);

    // -- pin the page + client to this contract --
    for (const key of ['deployments', 'steps', 'events', 'errorMessage', 'Only queued deployments can be cancelled']) {
      // the guard string is server-side; the page must render the server refusal verbatim
      assert.ok(PAGE_SRC.includes(key === 'Only queued deployments can be cancelled' ? 'describeError' : key),
        `AdminDeploymentsPage renders response key '${key}'`);
    }
    for (const pathPart of ['/api/v1/deployments', '/execute', '/cancel', '/api/v1/admin/deployments/sweep']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
