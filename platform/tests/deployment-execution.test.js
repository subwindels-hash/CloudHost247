/**
 * CI/CD Deployment Execution Pipeline & Worker test suite.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');

test('deployment execution pipeline & worker', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    const ownerReg = await register(base, 'deployer@example.com');
    const ownerToken = ownerReg.data.accessToken;
    const ownerId = ownerReg.data.user.id;

    const adminReg = await register(base, 'admin-dep@example.com');
    const adminId = adminReg.data.user.id;
    await app.store.table('users').updateById(adminId, { role: 'admin' });
    const adminToken = adminReg.data.accessToken;

    // Seed an application installation
    const appRecord = await app.store.table('applications').insert({
      id: uuidv7(),
      slug: 'ghost-blog',
      name: 'Ghost Blog',
      status: 'published',
    });
    const installation = await app.store.table('application_installations').insert({
      id: uuidv7(),
      user_id: ownerId,
      application_id: appRecord.id,
      name: 'My Ghost Blog',
      status: 'pending',
    });

    let deploymentId;

    await t.test('create deployment and verify initial queued state', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/deployments',
        method: 'POST',
        body: {
          source: 'github',
          ref: 'v1.0.0',
          installationId: installation.id,
          action: 'install',
        },
      }, ownerToken);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.deployment.status, 'queued');
      deploymentId = res.data.deployment.id;
    });

    await t.test('execute deployment pipeline runs all 5 steps in order', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/deployments/${deploymentId}/execute`,
        method: 'POST',
      }, ownerToken);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.ok, true);
      assert.strictEqual(res.data.deployment.status, 'succeeded');
      assert.ok(res.data.deployment.completed_at);

      // Verify detail has 5 steps, all succeeded and ordered
      const detail = await jsonFetch(base, {
        path: `/api/v1/deployments/${deploymentId}`,
      }, ownerToken);

      assert.strictEqual(detail.status, 200);
      assert.strictEqual(detail.data.steps.length, 5);
      assert.ok(detail.data.steps.every((s) => s.status === 'succeeded'));
      assert.deepEqual(detail.data.steps.map((s) => s.step_order), [1, 2, 3, 4, 5]);

      // Verify linked installation transitioned to running & healthy
      const updatedInst = await app.store.table('application_installations').findById(installation.id);
      assert.strictEqual(updatedInst.status, 'running');
      assert.strictEqual(updatedInst.health_status, 'healthy');
      assert.ok(updatedInst.last_health_check_at);
    });

    await t.test('executing a non-queued deployment is rejected with 409 Conflict', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/deployments/${deploymentId}/execute`,
        method: 'POST',
      }, ownerToken);

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.data.error, 'CONFLICT');
    });

    await t.test('admin sweep executes all queued deployments in one cycle', async () => {
      // Create 2 queued deployments
      const d1 = await jsonFetch(base, {
        path: '/api/v1/deployments',
        method: 'POST',
        body: { source: 'gitlab', ref: 'main' },
      }, ownerToken);
      const d2 = await jsonFetch(base, {
        path: '/api/v1/deployments',
        method: 'POST',
        body: { source: 'artifact', ref: 'build-42' },
      }, ownerToken);

      assert.strictEqual(d1.data.deployment.status, 'queued');
      assert.strictEqual(d2.data.deployment.status, 'queued');

      // Run admin sweep
      const sweepRes = await jsonFetch(base, {
        path: '/api/v1/admin/deployments/sweep',
        method: 'POST',
      }, adminToken);

      assert.strictEqual(sweepRes.status, 200);
      assert.strictEqual(sweepRes.data.ok, true);
      assert.ok(sweepRes.data.claimed >= 2);
      assert.ok(sweepRes.data.succeeded >= 2);

      // Verify both are now succeeded
      const check1 = await jsonFetch(base, { path: `/api/v1/deployments/${d1.data.deployment.id}` }, ownerToken);
      const check2 = await jsonFetch(base, { path: `/api/v1/deployments/${d2.data.deployment.id}` }, ownerToken);
      assert.strictEqual(check1.data.deployment.status, 'succeeded');
      assert.strictEqual(check2.data.deployment.status, 'succeeded');
    });

    await t.test('autoExecute flag executes pipeline inline during creation', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/deployments',
        method: 'POST',
        body: {
          source: 'github',
          ref: 'release-2.0',
          autoExecute: true,
        },
      }, ownerToken);

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.deployment.status, 'succeeded');
      assert.ok(res.data.deployment.completed_at);
    });

  } finally {
    await close();
  }
});
