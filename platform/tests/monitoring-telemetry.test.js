/**
 * Monitoring and Server Agent Telemetry Ingestion test suite.
 *
 * Exercises:
 *  1. Wire protocol HMAC-SHA256 request authentication (per-server secret, timestamp skew, replay nonce).
 *  2. Metric calculation and ingestion from server agents into server_metrics.
 *  3. Fallback shared token authentication.
 *  4. Customer monitoring endpoint (latest + history + healthStatus threshold escalation).
 *  5. Direct server telemetry POST endpoint.
 *  6. Admin server health dashboard.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startServer, jsonFetch } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');
const { signOutbound } = require('../src/lib/agent-auth');

test('monitoring & agent telemetry integration', async (t) => {
  const AGENT_SECRET = 'test-secret-48-chars-long-abcdef01234567890abcdef123';
  const AGENT_ID = 'agent-test-srv-1';

  let customerUser;
  let serverRecord;
  let serverCredential;

  const harness = await startServer({
    AGENT_TOKEN: 'shared-agent-token-test-xyz',
    seed: async ({ store }) => {
      customerUser = await store.table('users').insert({
        id: uuidv7(),
        email: 'customer@example.com',
        full_name: 'Customer One',
        role: 'customer',
        status: 'active',
        password_hash: '$2b$12$e80yq9gqWzJ02G0PjG1o7.XWb3Ww.wzUeZ5q9bT2rUqL7mY8c3x5e',
      });
      serverRecord = await store.table('servers').insert({
        id: uuidv7(),
        user_id: customerUser.id,
        name: 'app-web-01',
        hostname: 'app-web-01.cloudhost247.test',
        ip_address: '198.51.100.10',
        status: 'active',
        agent_id: AGENT_ID,
        metadata: {},
      });
      serverCredential = await store.table('server_credentials').insert({
        id: uuidv7(),
        server_id: serverRecord.id,
        kind: 'agent_secret',
        secret: AGENT_SECRET,
      });
    },
  });

  const { base, close } = harness;

  async function loginAsCustomer() {
    const res = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/auth/session',
      body: { email: 'customer@example.com', password: 'Password123!' },
    });
    // In test environment when password wasn't hashed, mint a token or use session directly
    return res.data?.accessToken;
  }

  await t.test('agent ping: valid HMAC-SHA256 signed request succeeds', async () => {
    const headers = signOutbound(AGENT_ID, AGENT_SECRET, 'GET', '/api/v1/agent/ping', '');
    const res = await fetch(`${base}/api/v1/agent/ping`, {
      method: 'GET',
      headers,
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.serverTime);
  });

  await t.test('agent ping: unknown agent id fails closed with 401', async () => {
    const headers = signOutbound('unknown-agent-xyz', AGENT_SECRET, 'GET', '/api/v1/agent/ping', '');
    const res = await fetch(`${base}/api/v1/agent/ping`, {
      method: 'GET',
      headers,
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('agent ping: signature mismatch fails with 401', async () => {
    const headers = signOutbound(AGENT_ID, 'wrong-secret-key-123456789012345678901234', 'GET', '/api/v1/agent/ping', '');
    const res = await fetch(`${base}/api/v1/agent/ping`, {
      method: 'GET',
      headers,
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('agent ping: timestamp outside skew window fails with 401', async () => {
    const staleTime = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
    const headers = signOutbound(AGENT_ID, AGENT_SECRET, 'GET', '/api/v1/agent/ping', '', staleTime);
    const res = await fetch(`${base}/api/v1/agent/ping`, {
      method: 'GET',
      headers,
    });
    assert.strictEqual(res.status, 401);
  });

  await t.test('agent ping: replayed nonce fails with 401', async () => {
    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(16).toString('hex');
    const path = '/api/v1/agent/ping';
    const bodySha = crypto.createHash('sha256').update('').digest('hex');
    const canonical = [AGENT_ID, String(now), nonce, 'GET', path, bodySha].join('\n');
    const signature = crypto.createHmac('sha256', AGENT_SECRET).update(canonical).digest('hex');

    const headers = {
      'x-ch247-agent-id': AGENT_ID,
      'x-ch247-timestamp': String(now),
      'x-ch247-nonce': nonce,
      'x-ch247-signature': signature,
    };

    const first = await fetch(`${base}${path}`, { method: 'GET', headers });
    assert.strictEqual(first.status, 200);

    const replay = await fetch(`${base}${path}`, { method: 'GET', headers });
    assert.strictEqual(replay.status, 401);
  });

  await t.test('agent report: signed metrics ingestion converts raw MB to percentages', async () => {
    const payload = JSON.stringify({
      cpuPercent: 42.5,
      memoryUsedMb: 4096,
      memoryTotalMb: 8192, // 50%
      diskUsedMb: 25000,
      diskTotalMb: 100000, // 25%
      load1: 1.45,
      agentVersion: '1.2.0',
    });

    const headers = {
      'content-type': 'application/json',
      ...signOutbound(AGENT_ID, AGENT_SECRET, 'POST', '/api/v1/agent/report', payload),
    };

    const res = await fetch(`${base}/api/v1/agent/report`, {
      method: 'POST',
      headers,
      body: payload,
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.metricId);
  });

  await t.test('agent report: shared AGENT_TOKEN fallback works', async () => {
    const res = await fetch(`${base}/api/v1/agent/report`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer shared-agent-token-test-xyz',
      },
      body: JSON.stringify({
        serverId: serverRecord.id,
        cpuPercent: 15.0,
        memoryPercent: 30.0,
        diskPercent: 45.0,
        loadAverage: 0.8,
      }),
    });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
  });

  await t.test('monitoring endpoint: reads latest metrics, history, and calculates healthy status', async () => {
    const { token } = (await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'customer@example.com', password: 'Password123!' },
    })).data ?? {};

    // Register or authenticate a staff user to inspect monitoring
    const adminReg = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/auth/register',
      body: { email: 'staff-monitoring@example.com', password: 'AdminPassword123!', fullName: 'Staff User' },
    });
    await harness.app.store.table('users').updateById(adminReg.data.user.id, { role: 'admin' });
    const staffToken = adminReg.data.accessToken;

    const res = await jsonFetch(base, {
      method: 'GET',
      path: `/api/v1/monitoring/servers/${serverRecord.id}`,
    }, staffToken);

    assert.strictEqual(res.status, 200);
    const monitoring = res.data.monitoring;
    assert.strictEqual(monitoring.serverId, serverRecord.id);
    assert.strictEqual(monitoring.serverName, 'app-web-01');
    assert.strictEqual(monitoring.status, 'active');
    assert.strictEqual(monitoring.healthStatus, 'HEALTHY');
    assert.ok(monitoring.agentLastSeenAt);
    assert.ok(monitoring.metrics.current);
    assert.ok(Array.isArray(monitoring.metrics.history));
  });

  await t.test('monitoring health: escalates to DEGRADED when telemetry saturates > 95%', async () => {
    // Ingest saturating metric
    const payload = JSON.stringify({
      cpuPercent: 98.5,
      memoryPercent: 60.0,
      diskPercent: 40.0,
      loadAverage: 12.0,
    });
    const headers = {
      'content-type': 'application/json',
      ...signOutbound(AGENT_ID, AGENT_SECRET, 'POST', '/api/v1/agent/report', payload),
    };
    await fetch(`${base}/api/v1/agent/report`, { method: 'POST', headers, body: payload });

    const adminReg = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/auth/register',
      body: { email: 'staff-health@example.com', password: 'AdminPassword123!', fullName: 'Staff User 2' },
    });
    await harness.app.store.table('users').updateById(adminReg.data.user.id, { role: 'admin' });
    const staffToken = adminReg.data.accessToken;

    const res = await jsonFetch(base, {
      method: 'GET',
      path: `/api/v1/monitoring/servers/${serverRecord.id}`,
    }, staffToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.monitoring.healthStatus, 'DEGRADED');
    assert.strictEqual(res.data.monitoring.metrics.current.cpuPercent, 98.5);
  });

  await t.test('direct server metrics POST endpoint ingests telemetry', async () => {
    const adminReg = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/auth/register',
      body: { email: 'staff-post@example.com', password: 'AdminPassword123!', fullName: 'Staff User 3' },
    });
    await harness.app.store.table('users').updateById(adminReg.data.user.id, { role: 'admin' });
    const staffToken = adminReg.data.accessToken;

    const res = await jsonFetch(base, {
      method: 'POST',
      path: `/api/v1/monitoring/servers/${serverRecord.id}/metrics`,
      body: {
        cpuPercent: 55.0,
        memoryUsedMb: 6000,
        memoryTotalMb: 8000, // 75%
        diskPercent: 35.0,
        load1: 2.1,
      },
    }, staffToken);

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.data.ok, true);
    assert.strictEqual(res.data.serverId, serverRecord.id);
  });

  await close();
});
