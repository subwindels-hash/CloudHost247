/**
 * Cloudflare egress — the routes, over the real HTTP pipeline, against a fake Cloudflare.
 *
 * These are the assertions the Cloudflare module is *finished* on: a request that used to be answered
 * from a local cache (or from a fabricated `cf-rec-<uuid>`) now reaches the provider, and a failure
 * reaches the caller as a refusal rather than as a success. `startServer` boots the real application —
 * routing, middleware, guards, validation, error serialisation — and the fake Cloudflare is bound per
 * account through `api_base_url`, exactly as a staging account would be pointed at a staging API.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, jsonFetch, register } = require('./helpers');
const { startFakeCloudflare } = require('./fixtures/fake-cloudflare');
const { encryptSecret, PURPOSES } = require('../src/lib/secret-box');

const JWT_SECRET = 'cloudflare-egress-test-secret-value-32';
const PROVIDER_TOKEN = 'cf-test-token-abcdefghijklmnop';

async function adminToken(base, app, email = 'cf-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' } });
  return { token: login.data.accessToken, id: user.id };
}

/** One account wired to the fake, created through the admin API so its token is really encrypted. */
async function createAccount(base, admin, baseUrl, overrides = {}) {
  const res = await jsonFetch(base, {
    path: '/api/v1/admin/cloudflare/accounts',
    method: 'POST',
    body: {
      accountName: overrides.accountName ?? 'Fake Cloudflare',
      cloudflareAccountId: overrides.cloudflareAccountId ?? 'acct-1',
      apiToken: overrides.apiToken ?? PROVIDER_TOKEN,
      apiBaseUrl: baseUrl,
    },
  }, admin);
  assert.strictEqual(res.status, 201, JSON.stringify(res.data));
  return res.data.account;
}

/** A customer-owned, active service pointing at an account. */
async function createService(app, user, account, zoneName, overrides = {}) {
  return app.store.table('cloudflare_services').insert({
    user_id: user.id,
    account_id: account.id,
    zone_name: zoneName,
    status: 'active',
    activation_status: 'pending',
    cloudflare_plan: 'free',
    created_at: new Date().toISOString(),
    ...overrides,
  });
}

test('cloudflare admin: Test Connection reports a real verdict for each state', async (t) => {
  const fake = startFakeCloudflare();
  const { baseUrl } = await fake.listen();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);

  await t.test('a valid token answers connected, having really called Cloudflare', async () => {
    const account = await createAccount(base, admin.token, baseUrl);
    const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/accounts/${account.id}/test`, method: 'POST' }, admin.token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'connected');
    assert.strictEqual(res.data.attempted, true);
    assert.strictEqual(fake.requestsFor('/user/tokens/verify').length, 1);
    // The DTO must never carry the token, only the fact that one is stored and readable.
    assert.strictEqual(res.data.tokenStatus, 'active');
    assert.strictEqual(JSON.stringify(res.data).includes(PROVIDER_TOKEN), false);
  });

  await t.test('a token Cloudflare rejects answers authentication_failed rather than throwing', async () => {
    const account = await createAccount(base, admin.token, baseUrl, { accountName: 'Wrong token', apiToken: 'not-the-right-token-at-all' });
    const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/accounts/${account.id}/test`, method: 'POST' }, admin.token);
    assert.strictEqual(res.status, 200, 'an operator asked for a diagnosis, not a 502');
    assert.strictEqual(res.data.status, 'authentication_failed');
    assert.strictEqual(res.data.failureCode, 'CLOUDFLARE_AUTHENTICATION_FAILED');
  });

  await t.test('an account with no token makes no request and says so', async () => {
    const account = await app.store.table('cloudflare_accounts').insert({
      account_name: 'No token', cloudflare_account_id: 'acct-empty', account_id: 'acct-empty', status: 'active',
    });
    const before = fake.state.requests.length;
    const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/accounts/${account.id}/test`, method: 'POST' }, admin.token);
    assert.strictEqual(res.data.status, 'not_configured');
    assert.strictEqual(res.data.attempted, false);
    assert.strictEqual(fake.state.requests.length, before, 'not_configured must be a configuration answer, not an outage');
  });

  await t.test('a token encrypted under another master secret reads as unreadable, naming the fix', async () => {
    const account = await app.store.table('cloudflare_accounts').insert({
      account_name: 'Stale key', cloudflare_account_id: 'acct-stale', account_id: 'acct-stale', status: 'active',
      encrypted_api_token: encryptSecret('a-master-secret-this-deployment-does-not-have', PURPOSES.cloudflareAccount, 'some-old-token-value'),
    });
    const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/accounts/${account.id}/test`, method: 'POST' }, admin.token);
    assert.strictEqual(res.data.status, 'credential_unreadable');
    assert.match(res.data.message, /rotated|different master secret/i);
  });

  await t.test('the account list reports credential state without ever returning the token', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/admin/cloudflare/accounts' }, admin.token);
    assert.strictEqual(res.status, 200);
    const states = res.data.accounts.map((a) => a.credentialState);
    assert.ok(states.includes('readable'));
    assert.ok(states.includes('none'));
    assert.ok(states.includes('unreadable'));
    assert.ok(!JSON.stringify(res.data).includes(PROVIDER_TOKEN));
    assert.ok(res.data.accounts.every((a) => a.hasToken === undefined || typeof a.hasToken === 'boolean'));
  });

  await t.test('the overview counts unusable credentials, which is a rotatable fault rather than an outage', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/admin/cloudflare' }, admin.token);
    assert.strictEqual(res.data.stats.accounts_unreadable_credentials, 1);
    assert.strictEqual(res.data.stats.accounts_without_token, 1);
  });
});

test('cloudflare admin: provision, sync, purge and lifecycle reach the provider', async (t) => {
  const fake = startFakeCloudflare();
  const { baseUrl } = await fake.listen();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);
  const account = await createAccount(base, admin.token, baseUrl);
  const customer = (await register(base, 'cf-provision-cust@example.com')).data.accessToken;
  const customerUser = await app.store.table('users').findOne({ email: 'cf-provision-cust@example.com' });

  const service = await createService(app, customerUser, account, 'provision.example.com', { status: 'pending', plan_id: null });

  await t.test('provision creates the zone at Cloudflare and records what Cloudflare returned', async () => {
    const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${service.id}/provision`, method: 'POST' }, admin.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.created, true);
    assert.ok(res.data.zoneId.startsWith('zone-'), `expected a Cloudflare zone id, got ${res.data.zoneId}`);
    assert.deepStrictEqual(res.data.nameservers, ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
    assert.strictEqual(res.data.activationStatus, 'pending');

    const row = await app.store.table('cloudflare_services').findById(service.id);
    assert.strictEqual(row.zone_id, res.data.zoneId);
    assert.strictEqual(row.name_server_1, 'ada.ns.cloudflare.com');
    assert.strictEqual(row.status, 'active');
  });

  await t.test('re-provisioning a retried request finds the existing zone instead of creating a second one', async () => {
    const pending = await createService(app, customerUser, account, 'retry.example.com', { status: 'pending' });
    const first = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${pending.id}/provision`, method: 'POST' }, admin.token);
    assert.strictEqual(first.data.created, true);
    const created = fake.state.zones.size;

    // Force the same service back into a state that permits a re-provision, as an operator retry would.
    await app.store.table('cloudflare_services').updateById(pending.id, { status: 'provisioning_failed' });
    const second = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${pending.id}/provision`, method: 'POST' }, admin.token);
    assert.strictEqual(second.data.created, false);
    assert.strictEqual(second.data.zoneId, first.data.zoneId);
    assert.strictEqual(fake.state.zones.size, created, 'a retry must not allocate a second zone');
  });

  await t.test('the job and API log tables record real provider traffic', async () => {
    const jobs = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/jobs?serviceId=${service.id}` }, admin.token);
    assert.ok(jobs.data.items.length > 0);
    assert.strictEqual(jobs.data.items[0].status, 'succeeded');
    assert.strictEqual(jobs.data.items[0].outcome, 'zone_created');

    const logs = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/logs?serviceId=${service.id}` }, admin.token);
    assert.ok(logs.data.items.length > 0);
    assert.ok(logs.data.items.every((l) => typeof l.path === 'string' && l.path.startsWith('/zones')));
    const overview = await jsonFetch(base, { path: '/api/v1/admin/cloudflare' }, admin.token);
    assert.strictEqual(overview.data.stats.api_errors_24h, 0, 'a clean account has no provider errors');
  });

  await t.test('a failing provider call is a refusal, and leaves the service provisionable again', async () => {
    const broken = startFakeCloudflare({ failures: { 'GET /zones': { status: 500, code: 9999, message: 'boom' } } });
    const { baseUrl: brokenUrl } = await broken.listen();
    try {
      const brokenAccount = await createAccount(base, admin.token, brokenUrl, { accountName: 'Broken', cloudflareAccountId: 'acct-broken' });
      const svc = await createService(app, customerUser, brokenAccount, 'broken.example.com', { status: 'pending' });
      const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${svc.id}/provision`, method: 'POST' }, admin.token);
      assert.strictEqual(res.status, 503);
      assert.strictEqual((await app.store.table('cloudflare_services').findById(svc.id)).status, 'provisioning_failed');
      const jobs = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/jobs?serviceId=${svc.id}` }, admin.token);
      assert.strictEqual(jobs.data.items[0].status, 'failed');
      assert.strictEqual(jobs.data.items[0].failure.code, 'CLOUDFLARE_UNAVAILABLE');
    } finally {
      await broken.close();
    }
  });

  await t.test('sync fills the cache from Cloudflare, deletes what Cloudflare no longer has and preserves platform settings', async () => {
    const svc = await createService(app, customerUser, account, 'sync.example.com', { status: 'active' });
    fake.seedZone({ id: 'zone-sync', name: 'sync.example.com', status: 'active' });
    await app.store.table('cloudflare_services').updateById(svc.id, { zone_id: 'zone-sync' });

    // The state the sync has to reconcile: one record that still exists upstream, one that does not,
    // and a platform-owned setting (`__`-prefixed) that Cloudflare knows nothing about.
    fake.state.records.set('zone-sync', [{ id: 'rec-live', type: 'A', name: 'sync.example.com', content: '203.0.113.9', ttl: 1, proxied: true }]);
    fake.state.settings.set('zone-sync', { ssl: 'strict', development_mode: 'on' });
    await app.store.table('cloudflare_dns_records').insert({
      id: 'stale-1', service_id: svc.id, cloudflare_record_id: 'rec-gone', type: 'A', name: 'gone.sync.example.com', content: '203.0.113.1', ttl: 1, proxied: false,
    });
    // A row from the era when ids were fabricated: it has no provider id, so it cannot be matched
    // against anything. It must be kept and reported, never silently deleted.
    await app.store.table('cloudflare_dns_records').insert({
      id: 'legacy-1', service_id: svc.id, cloudflare_record_id: null, type: 'A', name: 'legacy.sync.example.com', content: '203.0.113.2', ttl: 1, proxied: false,
    });
    await app.store.table('cloudflare_zone_settings').insert({ id: 'set-1', service_id: svc.id, settings: { __dnssec: 'disabled' } });

    const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${svc.id}/sync`, method: 'POST' }, admin.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.records.created, 1);
    assert.strictEqual(res.data.records.removed, 1);
    assert.strictEqual(res.data.records.unreconcilable, 1);

    const records = (await app.store.table('cloudflare_dns_records').all()).filter((r) => r.service_id === svc.id);
    assert.strictEqual(records.length, 2, 'the live record plus the unreconcilable leftover; the upstream-deleted one is gone');
    assert.ok(records.some((r) => r.cloudflare_record_id === 'rec-live'));
    assert.ok(!records.some((r) => r.cloudflare_record_id === 'rec-gone'));
    assert.ok(records.some((r) => r.id === 'legacy-1'), 'an unmatchable row is reported, not deleted');

    const settings = (await app.store.table('cloudflare_zone_settings').findById('set-1')).settings;
    assert.strictEqual(settings.__dnssec, 'disabled', 'a platform key must survive a provider sync');
    assert.strictEqual(settings.ssl, 'strict');

    const row = await app.store.table('cloudflare_services').findById(svc.id);
    assert.strictEqual(row.activation_status, 'active');
    assert.strictEqual(row.ssl_mode, 'strict');
    assert.ok(row.last_synced_at);
  });

  await t.test('purge really purges, and the job records the target', async () => {
    const svc = await createService(app, customerUser, account, 'purge.example.com', { zone_id: 'zone-purge' });
    fake.seedZone({ id: 'zone-purge', name: 'purge.example.com' });

    const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${svc.id}/purge-cache`, method: 'POST', body: { everything: true } }, admin.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.purged, true);
    assert.ok(res.data.purgeId, 'Cloudflare returns a purge id; the response must carry it');
    assert.strictEqual(fake.state.purges.length, 1);
    assert.deepStrictEqual(fake.state.purges[0].body, { everything: true });
  });

  await t.test('terminate deletes the zone at Cloudflare before the local row says terminated', async () => {
    const svc = await createService(app, customerUser, account, 'terminate.example.com', { zone_id: 'zone-terminate' });
    fake.seedZone({ id: 'zone-terminate', name: 'terminate.example.com' });
    const res = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${svc.id}/terminate`, method: 'POST' }, admin.token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(fake.state.zones.has('zone-terminate'), false);
    assert.strictEqual((await app.store.table('cloudflare_services').findById(svc.id)).status, 'terminated');
  });

  await t.test('suspend asks Cloudflare to pause the zone; a zone type Cloudflare will not pause is refused, not faked', async () => {
    const svc = await createService(app, customerUser, account, 'pause.example.com', { zone_id: 'zone-pause' });
    fake.seedZone({ id: 'zone-pause', name: 'pause.example.com', type: 'full' });
    const refused = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${svc.id}/suspend`, method: 'POST' }, admin.token);
    assert.strictEqual(refused.status, 400);
    assert.strictEqual((await app.store.table('cloudflare_services').findById(svc.id)).status, 'active', 'a refused pause must not mark the service suspended');

    fake.seedZone({ id: 'zone-pause-partial', name: 'pause2.example.com', type: 'partial' });
    const svc2 = await createService(app, customerUser, account, 'pause2.example.com', { zone_id: 'zone-pause-partial' });
    const ok = await jsonFetch(base, { path: `/api/v1/admin/cloudflare/services/${svc2.id}/suspend`, method: 'POST' }, admin.token);
    assert.strictEqual(ok.status, 202);
    assert.strictEqual(ok.data.zonePaused, true);
    assert.strictEqual((await app.store.table('cloudflare_services').findById(svc2.id)).status, 'suspended');
  });
});

test('cloudflare customer: writes reach Cloudflare and carry real provider ids', async (t) => {
  const fake = startFakeCloudflare();
  const { baseUrl } = await fake.listen();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);
  const account = await createAccount(base, admin.token, baseUrl);
  await register(base, 'cf-customer@example.com');
  const user = await app.store.table('users').findOne({ email: 'cf-customer@example.com' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'cf-customer@example.com', password: 'SuperSecret123!' } });
  const customer = login.data.accessToken;

  fake.seedZone({ id: 'zone-cust', name: 'customer.example.com', status: 'active' });
  fake.state.settings.set('zone-cust', { ssl: 'flexible', min_tls_version: '1.2' });
  const service = await createService(app, user, account, 'customer.example.com', {
    zone_id: 'zone-cust', plan_id: null, cloudflare_plan: 'pro',
  });

  await t.test('a created record is keyed by Cloudflare\'s own id, never a fabricated one', async () => {
    const res = await jsonFetch(base, {
      path: `/api/v1/cloudflare/services/${service.id}/dns`,
      method: 'POST',
      body: { type: 'A', name: 'www.customer.example.com', content: '203.0.113.50', ttl: 300, proxied: true },
    }, customer);
    assert.strictEqual(res.status, 201, JSON.stringify(res.data));
    assert.ok(String(res.data.record.id).startsWith('rec-'), `expected Cloudflare's id, got ${res.data.record.id}`);
    assert.ok(!String(res.data.record.id).startsWith('cf-rec-'), 'the fabricated id prefix must be gone');
    assert.strictEqual(res.data.record.ownership, 'CUSTOMER_MANAGED');

    const stored = (await app.store.table('cloudflare_dns_records').all()).find((r) => r.service_id === service.id);
    assert.strictEqual(stored.cloudflare_record_id, res.data.record.id);
  });

  await t.test('a record written before live synchronisation is refused by name instead of 404ing upstream', async () => {
    const legacy = await app.store.table('cloudflare_dns_records').insert({
      id: 'legacy-rec', service_id: service.id, cloudflare_record_id: null,
      type: 'A', name: 'old.customer.example.com', content: '203.0.113.51', ttl: 1, proxied: false, ownership: 'CUSTOMER_MANAGED',
    });
    const patch = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/dns/${legacy.id}`, method: 'PATCH', body: { content: '203.0.113.52' } }, customer);
    assert.strictEqual(patch.status, 400);
    assert.match(patch.data.message, /predates live synchronisation/);
    const del = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/dns/${legacy.id}`, method: 'DELETE' }, customer);
    assert.strictEqual(del.status, 400);
  });

  await t.test('a system-managed record cannot be edited or deleted here', async () => {
    const managed = await app.store.table('cloudflare_dns_records').insert({
      id: 'sys-rec', service_id: service.id, cloudflare_record_id: 'rec-sys',
      type: 'A', name: 'customer.example.com', content: '203.0.113.53', ttl: 1, proxied: true, ownership: 'SYSTEM_MANAGED',
    });
    const patch = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/dns/${managed.id}`, method: 'PATCH', body: { content: '203.0.113.54' } }, customer);
    assert.strictEqual(patch.status, 400);
    assert.match(patch.data.message, /managed by CloudHost247 hosting automation/);
  });

  await t.test('updating and deleting a record addresses the real one at Cloudflare', async () => {
    const created = await jsonFetch(base, {
      path: `/api/v1/cloudflare/services/${service.id}/dns`, method: 'POST',
      body: { type: 'A', name: 'edit.customer.example.com', content: '203.0.113.60', ttl: 120 },
    }, customer);
    const recordId = created.data.record.id;

    const patched = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/dns/${recordId}`, method: 'PATCH', body: { content: '203.0.113.61' } }, customer);
    assert.strictEqual(patched.status, 200, JSON.stringify(patched.data));
    assert.strictEqual(patched.data.record.content, '203.0.113.61');
    assert.strictEqual(fake.state.records.get('zone-cust').find((r) => r.id === recordId).content, '203.0.113.61');

    const deleted = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/dns/${recordId}`, method: 'DELETE' }, customer);
    assert.strictEqual(deleted.status, 200);
    assert.strictEqual(fake.state.records.get('zone-cust').some((r) => r.id === recordId), false);
    assert.strictEqual((await app.store.table('cloudflare_dns_records').all()).some((r) => r.cloudflare_record_id === recordId), false);
  });

  await t.test('a settings write patches each setting at Cloudflare before storing it locally', async () => {
    const res = await jsonFetch(base, {
      path: `/api/v1/cloudflare/services/${service.id}/ssl`, method: 'PATCH',
      body: { ssl: 'strict', min_tls_version: '1.3' },
    }, customer);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.deepStrictEqual(res.data.settings, { ssl: 'strict', min_tls_version: '1.3' });
    assert.deepStrictEqual(fake.state.settings.get('zone-cust'), { ssl: 'strict', min_tls_version: '1.3' });
    assert.strictEqual((await app.store.table('cloudflare_services').findById(service.id)).ssl_mode, 'strict');
  });

  await t.test('a setting Cloudflare rejects does not appear applied locally', async () => {
    const rejecting = startFakeCloudflare({ failures: { 'PATCH /zones/zone-reject/settings/brotli': { status: 400, code: 1220, message: 'invalid setting value' } } });
    const { baseUrl: rejectingUrl } = await rejecting.listen();
    try {
      const otherAccount = await createAccount(base, admin.token, rejectingUrl, { accountName: 'Rejecting', cloudflareAccountId: 'acct-reject' });
      rejecting.seedZone({ id: 'zone-reject', name: 'reject.example.com', status: 'active' });
      const svc = await createService(app, user, otherAccount, 'reject.example.com', { zone_id: 'zone-reject', cloudflare_plan: 'pro' });
      const res = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${svc.id}/speed`, method: 'PATCH', body: { brotli: 'on' } }, customer);
      assert.strictEqual(res.status, 400);
      const stored = await app.store.table('cloudflare_zone_settings').findOne({ service_id: svc.id });
      assert.strictEqual(stored, null, 'a rejected setting must not be recorded as applied');
    } finally {
      await rejecting.close();
    }
  });

  await t.test('firewall rules go to Cloudflare and are editable and removable by their real id', async () => {
    const created = await jsonFetch(base, {
      path: `/api/v1/cloudflare/services/${service.id}/firewall/rules`, method: 'POST',
      body: { value: '203.0.113.0/24', mode: 'block', notes: 'scraper' },
    }, customer);
    assert.strictEqual(created.status, 201, JSON.stringify(created.data));
    assert.strictEqual(created.data.rule.target, 'ip_range');
    assert.ok(String(created.data.rule.id).startsWith('rule-'));

    const listed = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/firewall` }, customer);
    assert.strictEqual(listed.data.rules.length, 1);

    const updated = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/firewall/rules/${created.data.rule.id}`, method: 'PATCH', body: { mode: 'challenge' } }, customer);
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(updated.data.rule.mode, 'challenge');

    const removed = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/firewall/rules/${created.data.rule.id}`, method: 'DELETE' }, customer);
    assert.strictEqual(removed.status, 200);
  });

  await t.test('DNSSEC reports Cloudflare\'s DS record and tells the customer it belongs at their registrar', async () => {
    const enabled = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/dnssec/enable`, method: 'POST' }, customer);
    assert.strictEqual(enabled.status, 200, JSON.stringify(enabled.data));
    assert.ok(enabled.data.dnssec.dsRecord.includes('IN DS'), 'the DS record is the whole point of this endpoint');

    const read = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/dnssec` }, customer);
    assert.strictEqual(read.data.dnssec.keyTag, 2371);
    assert.match(read.data.registrarNotice, /registrar/);

    const disabled = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/dnssec/disable`, method: 'POST' }, customer);
    assert.strictEqual(disabled.data.dnssec.status, 'disabled');
  });

  await t.test('analytics answers LIVE with Cloudflare\'s numbers and never zero-fills a missing day', async () => {
    const res = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/analytics?range=3` }, customer);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.dataStatus, 'LIVE');
    assert.strictEqual(res.data.analytics.totals.requests, 201);
    assert.strictEqual(res.data.analytics.timeseries[2].requests, null);
    assert.strictEqual(res.data.missingDays, 1);
  });

  await t.test('a purge is performed, not queued, and a failure is reported as a failure', async () => {
    const res = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/caching/purge`, method: 'POST', body: { everything: true } }, customer);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.purged, true);
    assert.strictEqual(fake.state.purges.length, 1);
  });

  await t.test('a sync from the customer panel reconciles the cache and reports what it changed', async () => {
    fake.state.records.set('zone-cust', []);
    const res = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/sync`, method: 'POST' }, customer);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.synced, true);
    assert.ok(res.data.jobId);
    assert.strictEqual(res.data.records.total, 0);
    const jobs = (await app.store.table('cloudflare_jobs').all()).filter((j) => j.service_id === service.id);
    assert.strictEqual(jobs[0].status, 'succeeded');
  });

  await t.test('a sync reaches only the caller\'s own service', async () => {
    await register(base, 'cf-other@example.com');
    const otherUser = await app.store.table('users').findOne({ email: 'cf-other@example.com' });
    const otherService = await createService(app, otherUser, account, 'other.example.com', { zone_id: 'zone-other' });
    const res = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${otherService.id}/sync`, method: 'POST' }, customer);
    assert.strictEqual(res.status, 404, '"missing" and "not yours" must be the same answer');
  });
});

test('cloudflare: what the customer was promised at checkout actually happens', async (t) => {
  const fake = startFakeCloudflare();
  const { baseUrl } = await fake.listen();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);
  await createAccount(base, admin.token, baseUrl);
  await register(base, 'cf-buyer@example.com');
  const buyer = await app.store.table('users').findOne({ email: 'cf-buyer@example.com' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'cf-buyer@example.com', password: 'SuperSecret123!' } });
  const token = login.data.accessToken;

  // A purchasable Cloudflare plan mapping, so the order route has something real to price.
  const product = await app.store.table('catalog_products').insert({ id: 'prod-cf', name: 'Cloudflare', slug: 'cloudflare', status: 'active' });
  const plan = await app.store.table('catalog_product_plans').insert({ id: 'plan-cf-pro', product_id: product.id, name: 'Cloudflare Pro', slug: 'pro', status: 'active' });
  await app.store.table('cloudflare_plan_mappings').insert({
    id: 'map-pro', plan_id: plan.id, plan_name: plan.name, product_id: product.id, product_name: product.name,
    cloudflare_plan: 'pro', plan_status: 'active', entitlements: {}, provisioning_mode: 'automatic',
  });
  await app.store.table('catalog_plan_pricing').insert({ id: 'price-cf-pro', plan_id: plan.id, billing_cycle: 'monthly', price: 25, currency: 'USD', is_active: true });

  let orderId;

  await t.test('the purchase records a pending, itemised intent rather than a sentence', async () => {
    const res = await jsonFetch(base, {
      path: '/api/v1/cloudflare/orders', method: 'POST',
      body: { planId: plan.id, billingPeriod: 'monthly', domainName: 'buyer.example.com' },
    }, token);
    assert.strictEqual(res.status, 201, JSON.stringify(res.data));
    orderId = res.data.order.id;

    const pending = (await app.store.table('cloudflare_jobs').all()).filter((j) => j.payload?.orderId === orderId);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].kind, 'provision_zone');
    assert.strictEqual(pending[0].status, 'awaiting_payment', 'a queued job would imply a runner; there is none');
    assert.strictEqual(pending[0].payload.zoneName, 'buyer.example.com');
    assert.ok(pending[0].account_id, 'the account the order was placed against is recorded');

    // Nothing was created at Cloudflare before payment.
    assert.strictEqual((await app.store.table('cloudflare_services').all()).filter((s) => s.user_id === buyer.id).length, 0);
    assert.strictEqual(fake.state.zones.size, 0);
  });

  await t.test('settling the invoice creates the zone and the service row, and closes the job', async () => {
    const invoice = (await app.store.table('invoices').all()).find((i) => i.order_id === orderId);
    assert.ok(Number(invoice.total) > 0, 'the invoice for a paid plan must actually carry its amount');
    const payment = await app.store.table('payments').insert({
      id: 'pay-cf-1', user_id: buyer.id, invoice_id: invoice.id, amount: invoice.total,
      currency: 'USD', gateway: 'sandbox', status: 'pending',
    });
    const { applySuccessfulPayment } = require('../src/lib/billing-apply');
    await app.store.transaction(async (tx) => {
      await applySuccessfulPayment(tx, { paymentId: payment.id, deps: { store: app.store, config: harness.config } });
    });

    const service = (await app.store.table('cloudflare_services').all()).find((s) => s.user_id === buyer.id);
    assert.ok(service, 'the paid order must produce a service');
    assert.strictEqual(service.zone_name, 'buyer.example.com');
    assert.ok(service.zone_id, 'the zone id must come from Cloudflare');
    assert.strictEqual(service.status, 'active');
    assert.strictEqual(service.cloudflare_plan, 'pro');
    assert.strictEqual(fake.state.zones.size, 1);

    const job = (await app.store.table('cloudflare_jobs').all()).find((j) => j.payload?.orderId === orderId);
    assert.strictEqual(job.status, 'succeeded');
    assert.strictEqual(job.payload.outcome, 'fulfilled_after_payment');
  });

  await t.test('a fulfilment that fails records the failure and never fails the payment', async () => {
    const broken = startFakeCloudflare({ failures: { 'GET /zones': { status: 500, code: 9999, message: 'boom' } } });
    const { baseUrl: brokenUrl } = await broken.listen();
    try {
      await register(base, 'cf-buyer2@example.com');
      const buyer2 = await app.store.table('users').findOne({ email: 'cf-buyer2@example.com' });
      const login2 = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'cf-buyer2@example.com', password: 'SuperSecret123!' } });
      const token2 = login2.data.accessToken;
      const brokenAccount = await createAccount(base, admin.token, brokenUrl, { accountName: 'Broken buyer', cloudflareAccountId: 'acct-buyer2' });
      // Point the pending action at the broken account explicitly.
      const order = await jsonFetch(base, { path: '/api/v1/cloudflare/orders', method: 'POST', body: { planId: plan.id, billingPeriod: 'monthly', domainName: 'buyer2.example.com' } }, token2);
      const orderRow = order.data.order.id;
      const job = (await app.store.table('cloudflare_jobs').all()).find((j) => j.payload?.orderId === orderRow);
      await app.store.table('cloudflare_jobs').updateById(job.id, { account_id: brokenAccount.id, payload: { ...job.payload, accountId: brokenAccount.id } });

      const invoice = (await app.store.table('invoices').all()).find((i) => i.order_id === orderRow);
      const payment = await app.store.table('payments').insert({
        id: 'pay-cf-2', user_id: buyer2.id, invoice_id: invoice.id, amount: invoice.total,
        currency: 'USD', gateway: 'sandbox', status: 'pending',
      });
      const { applySuccessfulPayment } = require('../src/lib/billing-apply');
      await app.store.transaction(async (tx) => {
        await applySuccessfulPayment(tx, { paymentId: payment.id, deps: { store: app.store, config: harness.config } });
      });

      assert.strictEqual((await app.store.table('payments').findById(payment.id)).status, 'succeeded', 'the money stays settled');
      const failedJob = (await app.store.table('cloudflare_jobs').all()).find((j) => j.id === job.id);
      assert.strictEqual(failedJob.status, 'failed');
      assert.strictEqual(failedJob.payload.failure.code, 'CLOUDFLARE_UNAVAILABLE');
    } finally {
      await broken.close();
    }
  });

  await t.test('a free plan change is applied immediately; a priced one waits for payment and then lands', async () => {
    const service = (await app.store.table('cloudflare_services').all()).find((s) => s.user_id === buyer.id);
    // A second catalog plan with no pricing row of its own: this is the free-change path. It is a
    // `business`-tier plan because the enterprise tier deliberately forbids further plan changes.
    const bizPlan = await app.store.table('catalog_product_plans').insert({ id: 'plan-cf-biz', product_id: product.id, name: 'Cloudflare Business', slug: 'business', status: 'active' });
    await app.store.table('cloudflare_plan_mappings').insert({
      id: 'map-biz', plan_id: bizPlan.id, plan_name: bizPlan.name, product_id: product.id, product_name: product.name,
      cloudflare_plan: 'business', plan_status: 'active', entitlements: {}, provisioning_mode: 'automatic',
    });

    const free = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/plan/change`, method: 'POST', body: { newPlanId: 'map-biz', billingPeriod: 'monthly' } }, token);
    assert.strictEqual(free.status, 200, JSON.stringify(free.data));
    assert.strictEqual(free.data.applied, true, 'a change with nothing to bill is applied, not queued');
    assert.strictEqual((await app.store.table('cloudflare_services').findById(service.id)).cloudflare_plan, 'business');

    // And the priced path: back to the Pro plan, which has a price, so it is billed first.
    const priced = await jsonFetch(base, { path: `/api/v1/cloudflare/services/${service.id}/plan/change`, method: 'POST', body: { newPlanId: 'map-pro', billingPeriod: 'monthly' } }, token);
    assert.strictEqual(priced.status, 202, JSON.stringify(priced.data));
    assert.strictEqual(priced.data.applied, false);
    const pending = (await app.store.table('cloudflare_jobs').all()).find((j) => j.payload?.outcome === undefined && j.kind === 'plan_change' && j.service_id === service.id);
    assert.strictEqual(pending.status, 'awaiting_payment');
    assert.strictEqual((await app.store.table('cloudflare_services').findById(service.id)).cloudflare_plan, 'business', 'a priced change is not applied before payment');

    const invoice = await app.store.table('invoices').findById(priced.data.invoiceId);
    assert.ok(Number(invoice.total) > 0);
    const payment = await app.store.table('payments').insert({
      id: 'pay-cf-3', user_id: buyer.id, invoice_id: invoice.id, amount: invoice.total, currency: 'USD', gateway: 'sandbox', status: 'pending',
    });
    const { applySuccessfulPayment } = require('../src/lib/billing-apply');
    await app.store.transaction(async (tx) => {
      await applySuccessfulPayment(tx, { paymentId: payment.id, deps: { store: app.store, config: harness.config } });
    });
    assert.strictEqual((await app.store.table('cloudflare_services').findById(service.id)).cloudflare_plan, 'pro', 'settlement applies the plan change it was waiting on');
  });
});
