/**
 * Integration tests for the customer domain lifecycle (domains.ts, spec §15):
 * add -> prove DNS control -> request SSL -> delete.
 *
 * The verify step performs a real DNS TXT lookup, so against a domain nobody controls it must fail
 * honestly rather than pretend; the already-verified path is driven by seeding the stored status.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

test('integration: customer domains', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const owner = (await register(base, 'dom-owner@example.com')).data.accessToken;
    const other = (await register(base, 'dom-other@example.com')).data.accessToken;

    let domainId;
    await t.test('adding a domain issues a DNS TXT verification challenge', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/domains', method: 'POST', body: { domain: 'verify-me.example' },
      }, owner);
      assert.strictEqual(res.status, 201);
      domainId = res.data.domain.id;

      assert.strictEqual(res.data.domain.verification_status, 'unverified');
      assert.strictEqual(res.data.domain.ssl_status, 'none');
      assert.ok(res.data.domain.verification_token.startsWith('cloudhost247-verify='));

      const ver = res.data.verification;
      assert.strictEqual(ver.method, 'dns_txt');
      assert.strictEqual(ver.recordName, '_cloudhost247-verification.verify-me.example');
      assert.strictEqual(ver.recordValue, res.data.domain.verification_token);
      assert.match(ver.instructions, /POST \/api\/v1\/domains\/.*\/verify/);
    });

    await t.test('a duplicate domain on the same account is refused', async () => {
      const dup = await jsonFetch(base, {
        path: '/api/v1/domains', method: 'POST', body: { domain: 'verify-me.example' },
      }, owner);
      assert.strictEqual(dup.status, 409);
      assert.match(dup.data.message, /already on your account/i);

      const bad = await jsonFetch(base, { path: '/api/v1/domains', method: 'POST', body: { domain: 'nope' } }, owner);
      assert.strictEqual(bad.status, 400, 'a bare label is not a domain');
    });

    await t.test('verify performs a real lookup and fails honestly for an uncontrolled domain', async () => {
      const res = await jsonFetch(base, { path: `/api/v1/domains/${domainId}/verify`, method: 'POST' }, owner);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.verified, false, 'nobody publishes this TXT record');
      assert.strictEqual(res.data.domain.verification_status, 'failed');
      assert.ok(res.data.detail.length > 0, 'the reason is reported');

      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/domains/${domainId}/verify`, method: 'POST' }, other)).status, 404);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/domains/not-a-uuid/verify', method: 'POST' }, owner)).status, 400);
    });

    await t.test('SSL cannot be requested before the domain is verified', async () => {
      const res = await jsonFetch(base, { path: `/api/v1/domains/${domainId}/ssl`, method: 'POST' }, owner);
      assert.strictEqual(res.status, 409);
      assert.match(res.data.message, /Verify domain control/i);
    });

    await t.test('a verified domain can request SSL, which records intent (202)', async () => {
      await app.store.table('customer_domains').updateById(domainId, { verification_status: 'verified' });

      const again = await jsonFetch(base, { path: `/api/v1/domains/${domainId}/verify`, method: 'POST' }, owner);
      assert.strictEqual(again.status, 200);
      assert.strictEqual(again.data.alreadyVerified, true, 'no second lookup once verified');

      const ssl = await jsonFetch(base, { path: `/api/v1/domains/${domainId}/ssl`, method: 'POST' }, owner);
      assert.strictEqual(ssl.status, 202);
      assert.strictEqual(ssl.data.domain.ssl_status, 'pending');
      assert.match(ssl.data.note, /attached to an installation/i);
    });

    await t.test('a domain attached to an installation cannot be deleted', async () => {
      const installation = await app.store.table('application_installations').insert({
        user_id: (await app.store.table('users').findOne({ email: 'dom-owner@example.com' })).id,
        name: 'Site',
      });
      await app.store.table('application_domains').insert({ installation_id: installation.id, domain_id: domainId, primary: true });

      const blocked = await jsonFetch(base, { path: `/api/v1/domains/${domainId}`, method: 'DELETE' }, owner);
      assert.strictEqual(blocked.status, 409);
      assert.match(blocked.data.message, /Detach this domain/i);

      const links = await app.store.table('application_domains').find({ domain_id: domainId });
      for (const link of links.rows) await app.store.table('application_domains').deleteById(link.id);

      const del = await jsonFetch(base, { path: `/api/v1/domains/${domainId}`, method: 'DELETE' }, owner);
      assert.strictEqual(del.status, 204);
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/domains/${domainId}` }, owner)).status, 404);
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/domains/${domainId}`, method: 'DELETE' }, owner)).status, 404);
    });

    await t.test('every mutation is audited', async () => {
      const { rows } = await app.store.table('audit_logs').find({ entity_type: 'customer_domain' });
      const actions = rows.map((r) => r.action);
      for (const expected of ['domain.added', 'domain.verification_failed', 'domain.ssl_requested', 'domain.deleted']) {
        assert.ok(actions.includes(expected), `${expected} recorded`);
      }
    });
  } finally {
    await close();
  }
});
