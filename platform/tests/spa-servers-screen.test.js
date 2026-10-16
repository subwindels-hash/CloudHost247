'use strict';

/**
 * Customer server screens contract (ServersPage + ServerDetailPage + serversApi).
 *
 * Walks the exact HTTP sequence the screens issue: list, create (queues provisioning), detail,
 * status/job/log reads, health, snapshots, power actions (queued jobs, never fake results),
 * resize options + resize, cancellation. Asserts every response key the screens render and pins the
 * page sources to the same keys. Also checks the console route's honest refusal when no provider
 * adapter is configured — the reason the screen shows instead of a dead button.
 * (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const LIST_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'ServersPage.jsx'), 'utf8');
const DETAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'ServerDetailPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

test('customer server screens: endpoint sequence and response contract', async (t) => {
  const harness = await startServer({
    seed: async ({ store }) => {
      await store.table('server_plans').insert({
        id: 'plan-2core', name: '2 vCPU / 4 GB', price_cents: 2000, active: true,
      });
    },
  });
  const { base, close } = harness;

  try {
    const reg = await register(base, 'servers-screen@example.com');
    const token = reg.data.accessToken;

    // -- list (ServersPage initial load) --
    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/servers' }, token);
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.data.servers), 'list reads servers');
    assert.ok(Array.isArray(list.data.deploymentTargets), 'list reads deploymentTargets');

    // -- create (new-server form) --
    const created = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/servers',
      body: { name: 'web1', hostname: 'web1.example.com', planId: 'plan-2core' },
    }, token);
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    const server = created.data.server;
    for (const key of ['id', 'name', 'hostname', 'status', 'planId']) {
      assert.ok(server[key] !== undefined, `server row reads server.${key}`);
    }
    assert.strictEqual(server.status, 'provisioning', 'create reports the queued truth');

    // -- detail (ServerDetailPage initial load) --
    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/servers/${server.id}` }, token);
    assert.strictEqual(detail.status, 200);
    assert.ok(detail.data.server, 'detail reads server');

    // -- health card --
    const health = await jsonFetch(base, { method: 'GET', path: `/api/v1/servers/${server.id}/health` }, token);
    assert.strictEqual(health.status, 200);
    for (const key of ['status', 'cpuPercent', 'memoryPercent', 'diskPercent', 'online']) {
      assert.ok(key in health.data, `health card reads ${key}`);
    }

    // -- latest job + logs --
    const prov = await jsonFetch(base, { method: 'GET', path: `/api/v1/servers/${server.id}/provisioning-status` }, token);
    assert.strictEqual(prov.status, 200);
    assert.ok('latestJob' in prov.data, 'detail reads latestJob');
    const logs = await jsonFetch(base, { method: 'GET', path: `/api/v1/servers/${server.id}/logs` }, token);
    assert.strictEqual(logs.status, 200);
    assert.ok(Array.isArray(logs.data.logs), 'log card reads logs');

    // -- power action: a queued job, reported as such --
    const power = await jsonFetch(base, { method: 'POST', path: `/api/v1/servers/${server.id}/start` }, token);
    assert.strictEqual(power.status, 202);
    for (const key of ['jobId', 'status', 'queued']) {
      assert.ok(power.data[key] !== undefined, `power result reads ${key}`);
    }

    // -- snapshots --
    const snap = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/servers/${server.id}/snapshots`, body: { description: 'before upgrade' },
    }, token);
    assert.strictEqual(snap.status, 202);
    assert.ok(snap.data.jobId, 'snapshot result reads jobId');
    const snaps = await jsonFetch(base, { method: 'GET', path: `/api/v1/servers/${server.id}/snapshots` }, token);
    assert.strictEqual(snaps.status, 200);
    assert.ok(Array.isArray(snaps.data.snapshots), 'snapshot card reads snapshots');
    const snapRow = snaps.data.snapshots[0];
    for (const key of ['id', 'status', 'description', 'createdAt']) {
      assert.ok(snapRow[key] !== undefined, `snapshot row reads ${key}`);
    }

    // -- resize options + resize --
    const options = await jsonFetch(base, { method: 'GET', path: `/api/v1/servers/${server.id}/resize-options` }, token);
    assert.strictEqual(options.status, 200);
    assert.ok(Array.isArray(options.data.options) && options.data.options.length >= 1, 'resize form reads options');
    assert.ok(options.data.options[0].planId && options.data.options[0].name, 'option rows read planId + name');
    const resized = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/servers/${server.id}/resize`, body: { targetPlanId: 'plan-2core' },
    }, token);
    assert.strictEqual(resized.status, 202);
    assert.ok(resized.data.jobId, 'resize result reads jobId');

    // -- console: with no provider adapter configured the refusal names the reason --
    const consoleRes = await jsonFetch(base, { method: 'POST', path: `/api/v1/servers/${server.id}/console` }, token);
    assert.ok([400, 422].includes(consoleRes.status), `console answered ${consoleRes.status} without a provider`);
    assert.ok(consoleRes.data.message, 'the refusal carries the reason the screen shows');

    // -- cancellation round trip --
    const cancelled = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/servers/${server.id}/cancel`, body: { reason: 'no longer needed' },
    }, token);
    assert.strictEqual(cancelled.status, 200);
    assert.strictEqual(cancelled.data.status, 'cancellation_requested', 'cancel card reads status');
    const uncancelled = await jsonFetch(base, { method: 'DELETE', path: `/api/v1/servers/${server.id}/cancel` }, token);
    assert.strictEqual(uncancelled.status, 200);
    assert.strictEqual(uncancelled.data.status, 'active');

    // -- ownership scoping --
    const other = await register(base, 'servers-screen-other@example.com');
    const missing = await jsonFetch(base, { method: 'GET', path: `/api/v1/servers/${server.id}` }, other.data.accessToken);
    assert.strictEqual(missing.status, 404);

    // -- pin the screens + client to this contract --
    for (const key of ['deploymentTargets', 'provisioning']) {
      assert.ok(LIST_SRC.includes(key), `ServersPage renders response key '${key}'`);
    }
    for (const key of ['latestJob', 'cpuPercent', 'jobId', 'queued']) {
      assert.ok(DETAIL_SRC.includes(key), `ServerDetailPage renders response key '${key}'`);
    }
    assert.ok(API_CLIENT_SRC.includes('export const serversApi'), 'api client exports serversApi');
    for (const pathPart of ['/api/v1/servers', '/resize', '/snapshots', '/console', '/health', '/metrics']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `serversApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
