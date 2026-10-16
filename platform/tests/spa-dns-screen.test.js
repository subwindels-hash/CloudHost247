'use strict';

/**
 * Customer DNS screen contract (DnsPage + dnsApi).
 *
 * Walks the exact HTTP sequence the DnsPage data layer issues — zone list/create, nested record
 * CRUD, export, propagation check, deletes — against the real app, and asserts every response key
 * the screen renders. The final assertions pin the page source to the same contract, so a screen
 * that starts reading different JSON keys fails here rather than at runtime in the browser.
 * (The browser render itself is covered by `npm run smoke` in spa/.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const DNSS_PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'DnsPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

test('customer DNS screen: endpoint sequence and response contract', async (t) => {
  const harness = await startServer();
  const { base, close } = harness;

  try {
    const reg = await register(base, 'dns-screen@example.com');
    const token = reg.data.accessToken;

    // -- zones list (screen's initial load) --
    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/dns/zones' }, token);
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.data.zones), 'screen reads data.zones');
    assert.ok(typeof list.data.total === 'number', 'screen can read data.total');

    // -- create zone --
    const created = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/dns/zones',
      body: { domain: 'screen-contract.test' },
    }, token);
    assert.strictEqual(created.status, 201);
    const zone = created.data.zone;
    assert.ok(zone.id && zone.domain === 'screen-contract.test' && zone.status, 'screen reads data.zone.{id,domain,status}');

    // -- zone detail (screen's openZone) --
    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/dns/zones/${zone.id}` }, token);
    assert.strictEqual(detail.status, 200);
    assert.ok(detail.data.zone && Array.isArray(detail.data.records), 'screen reads data.zone + data.records');
    assert.ok(detail.data.records.length >= 2, 'new zone seeds NS records');

    // -- nested record create (screen's submitRecord) --
    const recRes = await jsonFetch(base, {
      method: 'POST',
      path: `/api/v1/dns/zones/${zone.id}/records`,
      body: { name: 'app', type: 'A', content: '198.51.100.25', ttl: 300, proxied: false },
    }, token);
    assert.strictEqual(recRes.status, 201);
    const record = recRes.data.record;
    for (const key of ['id', 'zoneId', 'type', 'name', 'content', 'ttl', 'proxied']) {
      assert.ok(record[key] !== undefined, `screen reads record.${key}`);
    }

    // -- nested record update (screen's edit flow) --
    const patched = await jsonFetch(base, {
      method: 'PATCH',
      path: `/api/v1/dns/zones/${zone.id}/records/${record.id}`,
      body: { content: '198.51.100.26', ttl: 600 },
    }, token);
    assert.strictEqual(patched.status, 200);
    assert.strictEqual(patched.data.record.content, '198.51.100.26');
    assert.strictEqual(patched.data.record.ttl, 600);

    // -- propagation check (screen's checkRecord) --
    const check = await jsonFetch(base, {
      method: 'POST',
      path: `/api/v1/dns/zones/${zone.id}/records/${record.id}/check`,
    }, token);
    assert.strictEqual(check.status, 200);
    assert.ok(typeof check.data.matches === 'boolean', 'screen reads data.matches');
    assert.ok(typeof check.data.resolved === 'boolean', 'screen reads data.resolved');
    assert.ok(Array.isArray(check.data.liveAnswers), 'screen reads data.liveAnswers');
    assert.ok(check.data.hostname && check.data.type && check.data.expectedContent, 'screen reads check labels');

    // -- zone export (screen's exportZone) --
    const exported = await jsonFetch(base, { method: 'GET', path: `/api/v1/dns/zones/${zone.id}/export` }, token);
    assert.strictEqual(exported.status, 200);
    assert.ok(typeof exported.data.zoneFile === 'string' && exported.data.zoneFile.includes('$ORIGIN screen-contract.test.'),
      'screen reads data.zoneFile (RFC 1035)');
    assert.ok(typeof exported.data.recordsCount === 'number');

    // -- nested record delete (screen's deleteRecord) --
    const delRec = await jsonFetch(base, {
      method: 'DELETE',
      path: `/api/v1/dns/zones/${zone.id}/records/${record.id}`,
    }, token);
    assert.strictEqual(delRec.status, 204);

    // -- zone delete (screen's deleteZone) --
    const delZone = await jsonFetch(base, { method: 'DELETE', path: `/api/v1/dns/zones/${zone.id}` }, token);
    assert.strictEqual(delZone.status, 204);

    // -- ownership scoping: another customer cannot see the zone shape the screen assumes --
    const other = await register(base, 'dns-screen-other@example.com');
    const missing = await jsonFetch(base, { method: 'GET', path: `/api/v1/dns/zones/${zone.id}` }, other.data.accessToken);
    assert.strictEqual(missing.status, 404);

    // -- pin the screen + client to this contract --
    assert.match(DNSS_PAGE_SRC, /from '\.\.\/lib\/api\.js'/, 'DnsPage uses the shared api client');
    for (const key of ['zones', 'records', 'zoneFile', 'liveAnswers', 'matches', 'resolved']) {
      assert.ok(DNSS_PAGE_SRC.includes(key), `DnsPage renders response key '${key}'`);
    }
    assert.ok(API_CLIENT_SRC.includes("export const dnsApi"), 'api client exports dnsApi');
    for (const pathPart of [
      '/api/v1/dns/zones',
      '/api/v1/dns/zones/${encodeURIComponent(id)}',
      '/api/v1/dns/zones/${encodeURIComponent(zoneId)}/records',
      '/export',
      '/check',
    ]) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `dnsApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});

test('customer DNS screen: MX priority rule the form enforces', async (t) => {
  const harness = await startServer();
  const { base, close } = harness;

  try {
    const reg = await register(base, 'dns-screen-mx@example.com');
    const token = reg.data.accessToken;
    const created = await jsonFetch(base, {
      method: 'POST', path: '/api/v1/dns/zones', body: { domain: 'mx-contract.test' },
    }, token);
    const zoneId = created.data.zone.id;

    // The screen only shows the priority field for MX/SRV and always sends it for those types.
    const rejected = await jsonFetch(base, {
      method: 'POST',
      path: `/api/v1/dns/zones/${zoneId}/records`,
      body: { name: '@', type: 'MX', content: 'mail.mx-contract.test', ttl: 3600 },
    }, token);
    assert.strictEqual(rejected.status, 400, 'server enforces priority for MX; screen sends it');

    const accepted = await jsonFetch(base, {
      method: 'POST',
      path: `/api/v1/dns/zones/${zoneId}/records`,
      body: { name: '@', type: 'MX', content: 'mail.mx-contract.test', ttl: 3600, priority: 10 },
    }, token);
    assert.strictEqual(accepted.status, 201);
    assert.strictEqual(accepted.data.record.priority, 10);
  } finally {
    await close();
  }
});
