/**
 * Integration tests for the SSL certificate lifecycle (ssl.ts).
 *
 * Covers both mounts, because the original registers every handler under '/api/v1' and the legacy
 * '/api' prefix, and the uppercase lifecycle contract the port now follows.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

const NINETY_DAYS_MS = 90 * 86400 * 1000;

test('integration: ssl certificates', async (t) => {
  const { base, app, close } = await startServer();
  try {
    const owner = (await register(base, 'ssl-owner@example.com')).data.accessToken;
    const other = (await register(base, 'ssl-other@example.com')).data.accessToken;

    let certId;
    await t.test('a certificate starts PENDING with the documented defaults', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/ssl/certificates', method: 'POST', body: { domainName: 'example.com' },
      }, owner);
      assert.strictEqual(res.status, 201);
      const cert = res.data.certificate;
      certId = cert.id;
      assert.strictEqual(cert.status, 'PENDING');
      assert.strictEqual(cert.domain_name, 'example.com');
      assert.strictEqual(cert.issuer, 'LETS_ENCRYPT');
      assert.strictEqual(cert.challenge_type, 'HTTP_01');
      assert.strictEqual(cert.auto_renew, true);
      assert.deepEqual(cert.sans, []);
      assert.strictEqual(cert.expires_at, null, 'no expiry until issued');
    });

    await t.test('validation follows the original schema', async () => {
      const badDomain = await jsonFetch(base, {
        path: '/api/v1/ssl/certificates', method: 'POST', body: { domainName: 'nope' },
      }, owner);
      assert.strictEqual(badDomain.status, 400, 'a bare label is not a domain');

      const badIssuer = await jsonFetch(base, {
        path: '/api/v1/ssl/certificates', method: 'POST', body: { domainName: 'a.com', issuer: 'NOPE' },
      }, owner);
      assert.strictEqual(badIssuer.status, 400);

      const missing = await jsonFetch(base, {
        path: '/api/v1/ssl/certificates', method: 'POST', body: {},
      }, owner);
      assert.strictEqual(missing.status, 400, 'domainName is required');
    });

    await t.test('supplying a PEM records it as ISSUED with a 90-day expiry', async () => {
      const before = Date.now();
      const res = await jsonFetch(base, {
        path: '/api/v1/ssl/certificates', method: 'POST',
        body: { domainName: 'issued.example.com', certificatePem: '-----BEGIN CERTIFICATE-----', sans: ['www.issued.example.com'] },
      }, owner);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.certificate.status, 'ISSUED');
      assert.deepEqual(res.data.certificate.sans, ['www.issued.example.com']);

      const expiry = new Date(res.data.certificate.expires_at).getTime();
      assert.ok(Math.abs(expiry - (before + NINETY_DAYS_MS)) < 60_000, 'expiry is ~90 days out');
    });

    await t.test('listing returns the stored rows for the caller only', async () => {
      const mine = await jsonFetch(base, { path: '/api/v1/ssl/certificates' }, owner);
      assert.strictEqual(mine.status, 200);
      assert.strictEqual(mine.data.certificates.length, 2);

      const theirs = await jsonFetch(base, { path: '/api/v1/ssl/certificates' }, other);
      assert.strictEqual(theirs.data.certificates.length, 0);
    });

    await t.test('detail is owner-scoped and id-validated', async () => {
      const ok = await jsonFetch(base, { path: `/api/v1/ssl/certificates/${certId}` }, owner);
      assert.strictEqual(ok.status, 200);
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/ssl/certificates/${certId}` }, other)).status, 404);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/ssl/certificates/not-a-uuid' }, owner)).status, 400);
    });

    await t.test('renew stamps a fresh 90-day expiry and marks it ISSUED', async () => {
      const before = Date.now();
      const res = await jsonFetch(base, { path: `/api/v1/ssl/certificates/${certId}/renew`, method: 'POST' }, owner);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.certificate.status, 'ISSUED');
      const expiry = new Date(res.data.certificate.expires_at).getTime();
      assert.ok(Math.abs(expiry - (before + NINETY_DAYS_MS)) < 60_000);
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/ssl/certificates/${certId}/renew`, method: 'POST' }, other)).status, 404);
    });

    await t.test('revoke moves the certificate to REVOKED', async () => {
      const res = await jsonFetch(base, { path: `/api/v1/ssl/certificates/${certId}/revoke`, method: 'POST' }, owner);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.certificate.status, 'REVOKED');
    });

    await t.test('the legacy /api prefix serves the same handlers', async () => {
      const created = await jsonFetch(base, {
        path: '/api/ssl/certificates', method: 'POST', body: { domainName: 'legacy.example.com' },
      }, owner);
      assert.strictEqual(created.status, 201);
      const legacyId = created.data.certificate.id;

      const detail = await jsonFetch(base, { path: `/api/ssl/certificates/${legacyId}` }, owner);
      assert.strictEqual(detail.status, 200);
      assert.strictEqual(detail.data.certificate.domain_name, 'legacy.example.com');

      const renewed = await jsonFetch(base, { path: `/api/ssl/certificates/${legacyId}/renew`, method: 'POST' }, owner);
      assert.strictEqual(renewed.status, 200);
      assert.strictEqual(renewed.data.certificate.status, 'ISSUED');

      const revoked = await jsonFetch(base, { path: `/api/ssl/certificates/${legacyId}/revoke`, method: 'POST' }, owner);
      assert.strictEqual(revoked.status, 200);
      assert.strictEqual(revoked.data.certificate.status, 'REVOKED');

      const del = await jsonFetch(base, { path: `/api/ssl/certificates/${legacyId}`, method: 'DELETE' }, owner);
      assert.strictEqual(del.status, 204);
      assert.strictEqual((await jsonFetch(base, { path: `/api/ssl/certificates/${legacyId}` }, owner)).status, 404);
    });

    await t.test('delete removes the certificate', async () => {
      const del = await jsonFetch(base, { path: `/api/v1/ssl/certificates/${certId}`, method: 'DELETE' }, owner);
      assert.strictEqual(del.status, 204);
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/ssl/certificates/${certId}` }, owner)).status, 404);
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/ssl/certificates/${certId}`, method: 'DELETE' }, owner)).status, 404);
    });

    await t.test('every mutation is audited', async () => {
      const { rows } = await app.store.table('audit_logs').find({ entity_type: 'ssl_certificate' });
      const actions = rows.map((r) => r.action);
      for (const expected of [
        'SSL_CERTIFICATE_REQUESTED', 'SSL_CERTIFICATE_RENEWED', 'SSL_CERTIFICATE_REVOKED', 'SSL_CERTIFICATE_DELETED',
      ]) {
        assert.ok(actions.includes(expected), `${expected} recorded`);
      }
    });
  } finally {
    await close();
  }
});
