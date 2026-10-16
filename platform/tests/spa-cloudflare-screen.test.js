'use strict';

/**
 * Customer Cloudflare screen contract (CloudflareServicesPage + CloudflareServicePage + cloudflareApi).
 *
 * Boots the real app with a fake Cloudflare bound per account (as staging is), seeds one
 * customer-owned service, and walks the exact HTTP sequence the screens issue: services list,
 * detail, cached DNS reads, live DNS writes, sync, firewall rules, cache purge, DNSSEC, analytics,
 * plan. Asserts every response key the screens render and pins the page sources to the same keys.
 * (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');
const { startFakeCloudflare } = require('./fixtures/fake-cloudflare');

const DETAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'CloudflareServicePage.jsx'), 'utf8');
const LIST_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'CloudflareServicesPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

const JWT_SECRET = 'cloudflare-screen-test-secret-value-32';

async function adminToken(base, app, email = 'cf-screen-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' } });
  return login.data.accessToken;
}

test('customer Cloudflare screens: endpoint sequence and response contract', async (t) => {
  const fake = startFakeCloudflare();
  const { baseUrl } = await fake.listen();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);

  // Account wired to the fake, created through the admin API so the token is really encrypted.
  const accountRes = await jsonFetch(base, {
    path: '/api/v1/admin/cloudflare/accounts',
    method: 'POST',
    body: {
      accountName: 'Fake Cloudflare (screen)',
      cloudflareAccountId: 'acct-1',
      apiToken: 'cf-test-token-abcdefghijklmnop',
      apiBaseUrl: baseUrl,
    },
  }, admin);
  assert.strictEqual(accountRes.status, 201, JSON.stringify(accountRes.data));
  const account = accountRes.data.account;

  // Customer with an active service pointing at a seeded zone.
  const customer = await register(base, 'cf-screen-customer@example.com');
  const token = customer.data.accessToken;
  const service = await app.store.table('cloudflare_services').insert({
    user_id: customer.data.user.id,
    account_id: account.id,
    zone_name: 'screen.example.com',
    status: 'active',
    activation_status: 'pending',
    cloudflare_plan: 'pro',
    zone_id: 'zone-screen',
    created_at: new Date().toISOString(),
  });
  fake.seedZone({ id: 'zone-screen', name: 'screen.example.com', status: 'active' });

  // -- services list (CloudflareServicesPage) --
  const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/cloudflare/services' }, token);
  assert.strictEqual(list.status, 200);
  assert.strictEqual(list.data.services.length, 1);
  for (const key of ['id', 'zoneName', 'status', 'cloudflarePlan', 'createdAt']) {
    assert.ok(list.data.services[0][key] !== undefined, `list screen reads service.${key}`);
  }

  // -- service detail (CloudflareServicePage overview) --
  const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}` }, token);
  assert.strictEqual(detail.status, 200);
  assert.ok(detail.data.service.zoneName === 'screen.example.com', 'detail screen reads service.zoneName');
  assert.ok(detail.data.entitlements, 'detail screen reads entitlements');
  assert.ok(detail.data.capabilities, 'detail screen reads capabilities');
  assert.ok(Array.isArray(detail.data.nameservers), 'detail screen reads nameservers');
  assert.ok(detail.data.nameserverNotice, 'detail screen renders the nameserver notice');

  // -- DNS tab: cached read with its honesty contract --
  const dnsList = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/dns` }, token);
  assert.strictEqual(dnsList.status, 200);
  assert.ok(Array.isArray(dnsList.data.records), 'DNS tab reads records');
  assert.ok(typeof dnsList.data.note === 'string', 'DNS tab shows the cache note');
  assert.ok('lastSyncedAt' in dnsList.data, 'DNS tab reads lastSyncedAt');

  // -- DNS create: a live write answered from what Cloudflare returned --
  const created = await jsonFetch(base, {
    method: 'POST',
    path: `/api/v1/cloudflare/services/${service.id}/dns`,
    body: { name: 'www', type: 'A', content: '203.0.113.10', ttl: 300, proxied: true },
  }, token);
  assert.strictEqual(created.status, 201, JSON.stringify(created.data));
  const record = created.data.record;
  for (const key of ['id', 'type', 'name', 'content', 'ttl', 'proxied']) {
    assert.ok(record[key] !== undefined, `DNS tab reads record.${key}`);
  }

  // -- DNS patch + delete --
  const patched = await jsonFetch(base, {
    method: 'PATCH',
    path: `/api/v1/cloudflare/services/${service.id}/dns/${record.id}`,
    body: { content: '203.0.113.11' },
  }, token);
  assert.strictEqual(patched.status, 200);
  assert.strictEqual(patched.data.record.content, '203.0.113.11');

  // -- sync: reports what changed --
  const synced = await jsonFetch(base, { method: 'POST', path: `/api/v1/cloudflare/services/${service.id}/sync` }, token);
  assert.strictEqual(synced.status, 200, JSON.stringify(synced.data));
  assert.strictEqual(synced.data.synced, true, 'Sync button reads data.synced');

  // -- firewall tab: settings + rules + modes --
  const firewall = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/firewall` }, token);
  assert.strictEqual(firewall.status, 200);
  assert.ok(firewall.data.settings, 'firewall tab reads settings');
  assert.ok(Array.isArray(firewall.data.rules), 'firewall tab reads rules');
  assert.ok(Array.isArray(firewall.data.modes) && firewall.data.modes.includes('block'), 'firewall tab reads modes');

  const ruleRes = await jsonFetch(base, {
    method: 'POST',
    path: `/api/v1/cloudflare/services/${service.id}/firewall/rules`,
    body: { value: '203.0.113.50', mode: 'block', notes: 'screen test' },
  }, token);
  assert.strictEqual(ruleRes.status, 201, JSON.stringify(ruleRes.data));
  const rule = ruleRes.data.rule;
  for (const key of ['id', 'target', 'value', 'mode']) {
    assert.ok(rule[key] !== undefined, `firewall tab reads rule.${key}`);
  }
  const delRule = await jsonFetch(base, {
    method: 'DELETE',
    path: `/api/v1/cloudflare/services/${service.id}/firewall/rules/${rule.id}`,
  }, token);
  assert.strictEqual(delRule.status, 200);
  assert.strictEqual(delRule.data.deleted, true);

  // -- caching purge --
  const purge = await jsonFetch(base, {
    method: 'POST',
    path: `/api/v1/cloudflare/services/${service.id}/caching/purge`,
    body: { everything: true },
  }, token);
  assert.strictEqual(purge.status, 200);
  assert.strictEqual(purge.data.purged, true, 'purge button reads data.purged');
  assert.strictEqual(fake.state.purges.length, 1, 'purge really reached Cloudflare');

  // -- settings-backed tabs the screens render --
  for (const tab of ['ssl', 'speed', 'caching', 'scrape-shield']) {
    const res = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/${tab}` }, token);
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.settings, `${tab} tab reads settings`);
  }

  // -- DNSSEC tab: the API 404s "not enabled" before DNSSEC exists (the screen renders that as an
  //    off state), then enable issues the DS record the screen shows --
  const dnssecOff = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/dnssec` }, token);
  assert.strictEqual(dnssecOff.status, 404, 'not-enabled is answered 404 before DNSSEC exists');
  const enabled = await jsonFetch(base, { method: 'POST', path: `/api/v1/cloudflare/services/${service.id}/dnssec/enable` }, token);
  assert.strictEqual(enabled.status, 200, JSON.stringify(enabled.data));
  const dnssec = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/dnssec` }, token);
  assert.strictEqual(dnssec.status, 200);
  assert.ok(dnssec.data.dnssec && 'status' in dnssec.data.dnssec && 'dsRecord' in dnssec.data.dnssec,
    'dnssec tab reads status + dsRecord');

  // -- analytics tab --
  const analytics = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/analytics` }, token);
  assert.strictEqual(analytics.status, 200);
  assert.ok(analytics.data.analytics && analytics.data.analytics.totals, 'analytics tab reads totals');
  assert.ok(analytics.data.dataStatus, 'analytics tab reads dataStatus');
  assert.ok('missingDays' in analytics.data, 'analytics tab reads missingDays');

  // -- plan tab --
  const plan = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/plan` }, token);
  assert.strictEqual(plan.status, 200);
  assert.ok(plan.data.current, 'plan tab reads current');
  assert.ok(Array.isArray(plan.data.options), 'plan tab reads options');
  assert.ok(typeof plan.data.planChangeAllowed === 'boolean', 'plan tab reads planChangeAllowed');

  // -- activity tab --
  const activity = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/activity` }, token);
  assert.strictEqual(activity.status, 200);
  assert.ok(Array.isArray(activity.data.activity), 'activity tab reads activity');

  // -- entitlement gating the screen mirrors: a free-tier service is refused firewall honestly --
  await app.store.table('cloudflare_services').updateById(service.id, { cloudflare_plan: 'free' });
  const refused = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}/firewall` }, token);
  assert.strictEqual(refused.status, 403, 'free tier does not include firewall');
  assert.match(refused.data.error ?? '', /FEATURE_NOT_SUPPORTED|FORBIDDEN/, 'refusal carries a named reason the screen shows');
  await app.store.table('cloudflare_services').updateById(service.id, { cloudflare_plan: 'pro' });

  // -- ownership scoping --
  const other = await register(base, 'cf-screen-other@example.com');
  const missing = await jsonFetch(base, { method: 'GET', path: `/api/v1/cloudflare/services/${service.id}` }, other.data.accessToken);
  assert.strictEqual(missing.status, 404);

  // -- pin the screens + client to this contract --
  for (const key of ['nameservers', 'lastSyncedAt', 'dsRecord', 'planChangeAllowed', 'dataStatus', 'modes']) {
    assert.ok(DETAIL_SRC.includes(key), `CloudflareServicePage renders response key '${key}'`);
  }
  assert.ok(LIST_SRC.includes('services') && LIST_SRC.includes('cloudflarePlan'), 'list screen renders plan + services');
  assert.ok(API_CLIENT_SRC.includes('export const cloudflareApi'), 'api client exports cloudflareApi');
  for (const pathPart of [
    '/api/v1/cloudflare/services',
    '/dns',
    '/firewall/rules',
    '/caching/purge',
    '/dnssec',
    '/analytics',
    '/plan',
  ]) {
    assert.ok(API_CLIENT_SRC.includes(pathPart), `cloudflareApi covers ${pathPart}`);
  }
});
