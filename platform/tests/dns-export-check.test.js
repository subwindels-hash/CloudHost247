'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

test('integration: DNS zone export and live propagation check', async (t) => {
  const harness = await startServer();
  const { base, close } = harness;

  try {
    const userReg = await register(base, 'dns-admin@example.com');
    const token = userReg.data.accessToken;

    // Create a zone
    const zoneRes = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/dns/zones',
      body: { domain: 'mycloudhost-test.org' },
    }, token);

    assert.strictEqual(zoneRes.status, 201);
    const zoneId = zoneRes.data.zone.id;

    // Add A record
    const aRecordRes = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/dns/records',
      body: {
        zoneId,
        name: 'app',
        type: 'A',
        content: '198.51.100.25',
        ttl: 300,
      },
    }, token);
    assert.strictEqual(aRecordRes.status, 201);
    const aRecordId = aRecordRes.data.record.id;

    // Add MX record
    const mxRecordRes = await jsonFetch(base, {
      method: 'POST',
      path: '/api/v1/dns/records',
      body: {
        zoneId,
        name: '@',
        type: 'MX',
        content: 'mail.mycloudhost-test.org',
        priority: 10,
        ttl: 3600,
      },
    }, token);
    assert.strictEqual(mxRecordRes.status, 201);

    // Test RFC 1035 Zone export
    const exportRes = await jsonFetch(base, {
      method: 'GET',
      path: `/api/v1/dns/zones/${zoneId}/export`,
    }, token);

    assert.strictEqual(exportRes.status, 200);
    assert.strictEqual(exportRes.data.domain, 'mycloudhost-test.org');
    assert.ok(exportRes.data.recordsCount >= 4); // 2 default NS + 1 A + 1 MX
    assert.ok(exportRes.data.zoneFile.includes('$ORIGIN mycloudhost-test.org.'));
    assert.ok(exportRes.data.zoneFile.includes('198.51.100.25'));
    assert.ok(exportRes.data.zoneFile.includes('mail.mycloudhost-test.org'));

    // Test live check on record
    const checkRes = await jsonFetch(base, {
      method: 'POST',
      path: `/api/v1/dns/zones/${zoneId}/records/${aRecordId}/check`,
    }, token);

    assert.strictEqual(checkRes.status, 200);
    assert.strictEqual(checkRes.data.recordId, aRecordId);
    assert.strictEqual(checkRes.data.expectedContent, '198.51.100.25');
    assert.ok(typeof checkRes.data.matches === 'boolean');
  } finally {
    await close();
  }
});
