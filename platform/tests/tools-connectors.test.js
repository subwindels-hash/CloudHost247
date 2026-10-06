/**
 * Tools Connectors test suite: live DNS lookup and outbound HTTP uptime monitor probes.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { startServer, jsonFetch } = require('./helpers');
const { resolveDns, checkHttpMonitor, validateTargetUrl } = require('../src/lib/tools-connectors');

test('tools connectors: DNS resolution and HTTP monitoring', async (t) => {
  let customerToken;
  let testHttpServer;
  let testHttpPort;

  // Spin up a small local target HTTP server to act as a monitored site
  await new Promise((resolve) => {
    testHttpServer = http.createServer((req, res) => {
      if (req.url === '/status/500') {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
      }
    });
    testHttpServer.listen(0, '127.0.0.1', () => {
      testHttpPort = testHttpServer.address().port;
      resolve();
    });
  });

  const harness = await startServer();
  const { base, close } = harness;

  const regRes = await jsonFetch(base, {
    method: 'POST',
    path: '/api/v1/auth/register',
    body: { email: 'tools-user@example.com', password: 'Password123!', fullName: 'Tools User' },
  });
  customerToken = regRes.data.accessToken;

  await t.test('unit: resolveDns resolves valid hosts and handles non-existent domains', async () => {
    // Lookup localhost or example.com
    const res = await resolveDns('localhost', 'A');
    assert.strictEqual(res.query.name, 'localhost');
    assert.strictEqual(res.query.type, 'A');
    assert.ok(typeof res.durationMs === 'number');

    const nx = await resolveDns('nonexistent-domain-xyz-ch247-999.test', 'A');
    assert.strictEqual(nx.count, 0);
    assert.ok(nx.warnings.length > 0);
  });

  await t.test('unit: checkHttpMonitor probes target URL with latency and status code', async () => {
    const res = await checkHttpMonitor(`http://127.0.0.1:${testHttpPort}/health`, { allowLoopback: true });
    assert.strictEqual(res.live, true);
    assert.strictEqual(res.status, 'up');
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.latencyMs >= 0);
    assert.ok(res.lastCheckedAt);

    const downRes = await checkHttpMonitor(`http://127.0.0.1:${testHttpPort}/status/500`, { allowLoopback: true });
    assert.strictEqual(downRes.live, true);
    assert.strictEqual(downRes.status, 'down');
    assert.strictEqual(downRes.statusCode, 500);
  });

  await t.test('unit: validateTargetUrl rejects invalid schemes and malformed URLs', async () => {
    await assert.rejects(
      async () => validateTargetUrl('ftp://example.com'),
      /Only HTTP and HTTPS URLs are permitted/
    );
    await assert.rejects(
      async () => validateTargetUrl('not-a-valid-url'),
      /Invalid URL format/
    );
  });

  await t.test('api: POST /api/v1/tools/dns-lookup executes real DNS lookup', async () => {
    const res = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/tools/dns-lookup',
      body: { name: 'localhost', type: 'A' },
    }, customerToken);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.tool, 'dns-lookup');
    assert.strictEqual(res.data.query.name, 'localhost');
    assert.strictEqual(res.data.query.type, 'A');
    assert.ok(Array.isArray(res.data.records));
    assert.ok(typeof res.data.durationMs === 'number');
  });

  await t.test('api: monitors lifecycle and live check probe', async () => {
    // 1. Create a monitor pointing to the local test HTTP server
    const createRes = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/tools/monitors',
      body: { url: `http://127.0.0.1:${testHttpPort}/up`, intervalSeconds: 60 },
    }, customerToken);

    assert.strictEqual(createRes.status, 201);
    const monitorId = createRes.data.monitor.id;
    assert.ok(monitorId);

    // 2. Trigger a live check probe
    const checkRes = await jsonFetch(base, {
      method: 'POST',
      path: `/api/v1/tools/monitors/${monitorId}/check`,
    }, customerToken);

    assert.strictEqual(checkRes.status, 200);
    assert.strictEqual(checkRes.data.live, true);
    assert.strictEqual(checkRes.data.status, 'up');
    assert.strictEqual(checkRes.data.statusCode, 200);
    assert.ok(checkRes.data.lastCheckedAt);
    assert.ok(typeof checkRes.data.latencyMs === 'number');

    // 3. Inspect monitor list to confirm lastCheckedAt was persisted
    const listRes = await jsonFetch(base, {
      method: 'GET',
      path: '/api/v1/tools/monitors',
    }, customerToken);

    assert.strictEqual(listRes.status, 200);
    const found = listRes.data.monitors.find((m) => m.id === monitorId);
    assert.ok(found);
    assert.strictEqual(found.status, 'active');
    assert.strictEqual(found.lastCheckedAt, checkRes.data.lastCheckedAt);
  });

  await new Promise((resolve) => testHttpServer.close(resolve));
  await close();
});
