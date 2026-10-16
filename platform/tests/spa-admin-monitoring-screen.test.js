'use strict';

/**
 * Admin monitoring screen contract (AdminMonitoringPage).
 *
 * Walks the exact HTTP sequence the screen issues — the fleet server-health table and a per-server
 * drill into the monitoring record — over the real app, with real telemetry seeded through the
 * documented agent telemetry endpoint. Pins the page source to the response keys it renders.
 * (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminMonitoringPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

test('admin monitoring screen: server-health contract', async (t) => {
  const harness = await startServer();
  const { base, app, close } = harness;

  try {
    await register(base, 'mon-screen-admin@example.com');
    const adminUser = await app.store.table('users').findOne({ email: 'mon-screen-admin@example.com' });
    await app.store.table('users').updateById(adminUser.id, { role: 'super_admin' });
    const login = await jsonFetch(base, {
      path: '/api/v1/auth/login', method: 'POST', body: { email: 'mon-screen-admin@example.com', password: 'SuperSecret123!' },
    });
    const admin = login.data.accessToken;

    // A server plus one telemetry datapoint, posted through the agent-facing endpoint.
    const cust = await register(base, 'mon-screen-cust@example.com');
    const created = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/servers', body: { name: 'monbox', hostname: 'monbox.example.com' },
    }, cust.data.accessToken);
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    const serverId = created.data.server.id;

    const post = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/monitoring/servers/${serverId}/metrics`,
      body: { cpuPercent: 33, memoryPercent: 44, diskPercent: 55 },
    }, cust.data.accessToken);
    assert.ok([200, 201].includes(post.status), `telemetry accepted: ${post.status} ${JSON.stringify(post.data)}`);

    // -- fleet table --
    const health = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/monitoring/server-health' }, admin);
    assert.strictEqual(health.status, 200);
    assert.ok(Array.isArray(health.data.servers) && health.data.servers.length >= 1, 'table reads servers');
    const row = health.data.servers.find((s) => s.id === serverId);
    for (const key of ['id', 'name', 'status', 'cpuPercent', 'memoryPercent', 'diskPercent']) {
      assert.ok(key in row, `health row reads ${key}`);
    }

    // -- drill-in --
    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/monitoring/servers/${serverId}` }, admin);
    assert.strictEqual(detail.status, 200);
    const mon = detail.data.monitoring;
    for (const key of ['serverName', 'healthStatus', 'metrics', 'services', 'containers', 'agentLastSeenAt']) {
      assert.ok(key in mon, `detail reads ${key}`);
    }

    // -- staff gate --
    const denied = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/monitoring/server-health' }, cust.data.accessToken);
    assert.strictEqual(denied.status, 403);

    // -- pin the page + client to this contract --
    for (const key of ['cpuPercent', 'memoryPercent', 'diskPercent', 'healthStatus', 'agentLastSeenAt', 'containers', 'no datapoints']) {
      assert.ok(PAGE_SRC.includes(key), `AdminMonitoringPage renders response key '${key}'`);
    }
    assert.ok(PAGE_SRC.includes('no datapoints'), 'missing telemetry is honestly labelled, never shown as zero');
    for (const pathPart of ['/api/v1/admin/monitoring/server-health', '/api/v1/monitoring/servers/']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
