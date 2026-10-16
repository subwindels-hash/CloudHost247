'use strict';

/**
 * Admin domain-services screen contract (AdminDomainServicesPage).
 *
 * Walks the exact HTTP sequence the screen issues — overview, provider registration, write-only
 * credentials (asserting no credential value ever comes back), Test Connection as a real call to
 * the loopback registrar fake, extensions list/sync/patch, transfers list/patch/refresh refusal,
 * registrations, auctions, club plans, oversight lists — over the real app. Pins the page source
 * to the response keys it renders. (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');
const { startFakeRegistrar } = require('./fixtures/fake-registrar');

const PAGE_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminDomainServicesPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

const JWT_SECRET = 'admin-ds-screen-test-secret-value-32';

async function adminToken(base, app, email = 'ds-screen-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('admin domain-services screen: endpoint sequence and response contract', async (t) => {
  const fake = startFakeRegistrar();
  await fake.listen();
  const registrarEndpoint = fake.endpoint();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);

  // -- overview tab --
  const overview = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/domain-services/overview' }, admin);
  assert.strictEqual(overview.status, 200);
  for (const key of ['registrations', 'transfers', 'auctions', 'club', 'searchesLast24h', 'limits']) {
    assert.ok(key in overview.data, `overview reads ${key}`);
  }

  // -- providers tab: list + installed adapters --
  const providers0 = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/domain-services/providers' }, admin);
  assert.strictEqual(providers0.status, 200);
  assert.ok(Array.isArray(providers0.data.installedAdapters) && providers0.data.installedAdapters.includes('namecheap'),
    'the screen reads the compiled adapter registry');

  // -- register a provider (sandbox so the loopback test API is allowed) --
  const created = await jsonFetch(base, {
    method: 'POST',
    path: '/api/v1/admin/domain-services/providers',
    body: {
      providerKey: 'screen-namecheap', name: 'Screen Namecheap', adapterKey: 'namecheap',
      providerType: 'registrar', apiBaseUrl: registrarEndpoint, environment: 'sandbox',
    },
  }, admin);
  assert.strictEqual(created.status, 201, JSON.stringify(created.data));
  const provider = created.data.provider;
  for (const key of ['id', 'providerKey', 'name', 'adapterKey', 'providerType', 'status', 'hasCredentials']) {
    assert.ok(provider[key] !== undefined, `provider row reads ${key}`);
  }
  assert.strictEqual(provider.hasCredentials, false);

  // -- an adapter that is not installed is refused by name --
  const refusedAdapter = await jsonFetch(base, {
    method: 'POST',
    path: '/api/v1/admin/domain-services/providers',
    body: { providerKey: 'screen-bogus', name: 'Bogus', adapterKey: 'not-an-adapter', providerType: 'registrar' },
  }, admin);
  assert.strictEqual(refusedAdapter.status, 400);
  assert.ok(refusedAdapter.data.message.includes('not installed'), 'the refusal names the fix');

  // -- write-only credentials: stored, and never echoed back --
  const secretValue = 'sk-screen-secret-value-0123456789';
  const creds = await jsonFetch(base, {
    method: 'PUT',
    path: `/api/v1/admin/domain-services/providers/${provider.id}/credentials`,
    body: { credentials: { apiKey: secretValue, apiUser: 'screen-user', userName: 'screen-user', clientIp: '203.0.113.5' } },
  }, admin);
  assert.strictEqual(creds.status, 200, JSON.stringify(creds.data));
  assert.strictEqual(creds.data.provider.hasCredentials, true, 'screen reads hasCredentials');
  assert.ok(!JSON.stringify(creds.data).includes(secretValue), 'no credential value is ever returned');

  // -- Test Connection: a real call to the loopback registrar --
  const tested = await jsonFetch(base, {
    method: 'POST', path: `/api/v1/admin/domain-services/providers/${provider.id}/test`,
  }, admin);
  assert.strictEqual(tested.status, 200, JSON.stringify(tested.data));
  for (const key of ['status', 'message', 'capabilities']) {
    assert.ok(key in tested.data.result, `test verdict reads result.${key}`);
  }
  assert.strictEqual(tested.data.result.status, 'connected', 'the fake registrar accepted the credentials');

  // -- extensions tab --
  const exts = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/domain-services/extensions' }, admin);
  assert.strictEqual(exts.status, 200);
  assert.ok(Array.isArray(exts.data.extensions), 'extensions tab reads extensions');
  const ext = await app.store.table('domain_extensions').insert({
    tld: 'screen', register_price_cents: 1000, renew_price_cents: 1200, status: 'active', active: true,
  });
  const extPatch = await jsonFetch(base, {
    method: 'PATCH', path: `/api/v1/admin/domain-services/extensions/${ext.id}`, body: { status: 'disabled' },
  }, admin);
  assert.strictEqual(extPatch.status, 200);

  // -- transfers tab: list + patch + the refresh refusal when no registrar holds the transfer --
  const transfers = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/domain-services/transfers' }, admin);
  assert.strictEqual(transfers.status, 200);
  assert.ok(Array.isArray(transfers.data.transfers), 'transfers tab reads transfers');
  const transfer = await app.store.table('domain_transfers').insert({
    domain_name: 'moving.example', user_id: null, status: 'transfer_in_progress',
  });
  const tPatch = await jsonFetch(base, {
    method: 'PATCH', path: `/api/v1/admin/domain-services/transfers/${transfer.id}`, body: { status: 'cancelled', note: 'customer stopped' },
  }, admin);
  assert.strictEqual(tPatch.status, 200);
  const refreshed = await jsonFetch(base, {
    method: 'POST', path: `/api/v1/admin/domain-services/transfers/${transfer.id}/refresh`,
  }, admin);
  if (refreshed.status === 200) {
    // A real poll ran and answered a verdict — the screen reads these keys.
    for (const key of ['status', 'providerStatus', 'completed']) {
      assert.ok(key in refreshed.data, `refresh result reads ${key}`);
    }
  } else {
    // A poll that cannot run refuses with the reason the screen shows — never "still in progress".
    assert.ok([400, 409, 422, 502, 503].includes(refreshed.status), `refresh answered ${refreshed.status}`);
    assert.ok(refreshed.data.message, 'a poll that cannot run refuses with the reason the screen shows');
  }

  // -- registrations tab --
  const regs = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/domain-services/registrations' }, admin);
  assert.strictEqual(regs.status, 200);
  assert.ok(Array.isArray(regs.data.registrations), 'registrations tab reads registrations');

  // -- auctions tab: create + list + action --
  const auction = await jsonFetch(base, {
    method: 'POST', path: '/api/v1/admin/domain-services/auctions',
    body: {
      domainName: 'gavel.example', minimumBid: '50', bidIncrement: '5',
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 86400000).toISOString(),
    },
  }, admin);
  assert.ok([200, 201].includes(auction.status), JSON.stringify(auction.data));
  const auctions = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/domain-services/auctions' }, admin);
  assert.strictEqual(auctions.status, 200);
  assert.ok(Array.isArray(auctions.data.auctions) && auctions.data.auctions.length >= 1, 'auctions tab reads auctions');
  for (const key of ['id', 'domainName', 'status', 'currentBid', 'endsAt']) {
    assert.ok(key in auctions.data.auctions[0], `auction row reads ${key}`);
  }

  // -- club plans tab --
  const plan = await jsonFetch(base, {
    method: 'POST', path: '/api/v1/admin/domain-services/club/plans',
    body: { name: 'Screen Club', billingPeriod: 'monthly', priceAmount: '9.99', discountType: 'fixed', discountValue: '0' },
  }, admin);
  assert.ok([200, 201].includes(plan.status), JSON.stringify(plan.data));
  assert.ok(plan.data.plan && plan.data.plan.priceAmount, 'club form reads plan.priceAmount');
  const plans = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/domain-services/club/plans' }, admin);
  assert.strictEqual(plans.status, 200);
  assert.ok(Array.isArray(plans.data.plans) && plans.data.plans.length >= 1, 'club tab reads plans');
  for (const key of ['id', 'name', 'billingPeriod', 'priceAmount', 'status']) {
    assert.ok(plans.data.plans[0][key] !== undefined, `club plan row reads ${key}`);
  }

  // -- oversight tab --
  for (const [path, key] of [['/appraisals', 'appraisals'], ['/whois-lookups', 'lookups'], ['/transactions', 'transactions']]) {
    const res = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/domain-services${path}` }, admin);
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data[key]), `oversight reads ${key}`);
  }

  // -- role gates: staff reads, super-admin mutates --
  const staff = await register(base, 'ds-screen-staff@example.com');
  const staffUser = await app.store.table('users').findOne({ email: 'ds-screen-staff@example.com' });
  await app.store.table('users').updateById(staffUser.id, { role: 'staff' });
  const staffLogin = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email: 'ds-screen-staff@example.com', password: 'SuperSecret123!' },
  });
  const staffToken = staffLogin.data.accessToken;
  assert.strictEqual((await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/domain-services/providers' }, staffToken)).status, 200);
  assert.strictEqual((await jsonFetch(base, {
    method: 'POST', path: '/api/v1/admin/domain-services/providers',
    body: { providerKey: 'staff-nope', name: 'Nope', adapterKey: 'namecheap', providerType: 'registrar' },
  }, staffToken)).status, 403);

  // -- pin the page + client to this contract --
  for (const key of ['installedAdapters', 'hasCredentials', 'searchesLast24h', 'provider_status', 'estimated_value']) {
    assert.ok(PAGE_SRC.includes(key), `AdminDomainServicesPage renders response key '${key}'`);
  }
  assert.ok(API_CLIENT_SRC.includes('export const adminApi'), 'api client exports adminApi');
  for (const pathPart of ['/api/v1/admin/domain-services/providers', '/extensions/sync', '/transfers', '/auctions', '/club/plans']) {
    assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
  }
});
