/**
 * Domain services egress — the routes, over the real HTTP pipeline, against a fake registry.
 *
 * This is the test that the module is *finished* on. The behaviour it replaces was a regular
 * expression: `/google|facebook/` meant "taken", everything else meant "available", and the answer
 * was labelled an `estimate`. Here the real application is booted, an operator configures an RDAP
 * provider the way they would in production (create → credentials → Test Connection), and the
 * customer routes are then asserted to report **what the registry said** — including reporting that
 * it has no answer, which the old code never did.
 *
 * The loopback fake is reached through the provider row's `api_base_url` with `environment=sandbox`,
 * which is the only route to the loopback escape hatch in the SSRF guard. `tests/domain-providers
 * .test.js` asserts that a production row pointed at loopback is refused.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startServer, jsonFetch, register } = require('./helpers');
const { startFakeRegistry } = require('./fixtures/fake-registry');

const JWT_SECRET = 'domain-egress-test-secret-value-32';

async function adminToken(base, app, email = 'ds-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' } });
  return login.data.accessToken;
}

async function customerToken(base, email = 'ds-customer@example.com') {
  await register(base, email, 'SuperSecret123!');
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' } });
  return login.data.accessToken;
}

/** Create a provider row through the admin API, exactly as an operator would. */
async function createProvider(base, admin, body) {
  const res = await jsonFetch(base, { path: '/api/v1/admin/domain-services/providers', method: 'POST', body }, admin);
  assert.strictEqual(res.status, 201, JSON.stringify(res.data));
  return res.data.provider;
}

/**
 * An RDAP provider that has really passed its connection test: create, point at the fake, test.
 * Nothing is written straight into the store, so the gate the customer routes depend on
 * (`status: 'connected'`) is earned the way production earns it.
 */
async function connectRdap(base, admin, baseUrl, providerKey = 'rdap-public') {
  const provider = await createProvider(base, admin, {
    providerKey, name: 'Public RDAP', adapterKey: 'rdap', providerType: 'rdap',
    apiBaseUrl: baseUrl, environment: 'sandbox',
  });
  const test = await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${provider.id}/test`, method: 'POST' }, admin);
  assert.strictEqual(test.data.result.status, 'connected', JSON.stringify(test.data));
  return provider;
}

test('domain services: readiness and the installed-adapter list tell the truth', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const res = await jsonFetch(base, { path: '/api/v1/domain-services/readiness' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.data.rdap.configured, false, 'nothing is configured in a fresh deployment');
  assert.strictEqual(res.data.auctions.configured, true, 'the internal marketplace needs no provider');
  // The installed set is the registry's own answer: the registrar adapters are honestly absent.
  assert.deepStrictEqual(res.data.installedAdapters, ['godaddy', 'godaddy-govalue', 'govalue', 'namecheap', 'rdap']);
  assert.ok(res.data.installedAdapters.includes('namecheap'), 'the ported registrar adapter is advertised');
});

test('domain services: with no provider configured, search refuses to guess', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, close } = harness;
  t.after(() => close());

  const res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'acme-works.com' } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  assert.strictEqual(res.data.status, 'provider_unavailable');
  assert.strictEqual(res.data.estimate, false, 'nothing here is an estimate any more — it is a refusal');
  assert.strictEqual(res.data.failure.code, 'PROVIDER_NOT_CONFIGURED');
  assert.match(res.data.message, /not available on this deployment/i);
  // The load-bearing assertion: `available` is null, not a boolean. The old code would have said
  // `true` here, for a name it had never asked anyone about.
  assert.strictEqual(res.data.results.length, 3);
  for (const row of res.data.results) {
    assert.strictEqual(row.available, null, `${row.domain} must not be answered when nothing can answer`);
    assert.strictEqual(row.status, 'unknown');
    assert.strictEqual(row.confidence, null);
  }
  assert.strictEqual(res.data.counts.unknown, 3);
  // And the customer sentence never carries the internal reason.
  assert.ok(!JSON.stringify(res.data).includes('Admin → Domain Services'));
});

test('domain services: an operator connects RDAP and search then reports registry facts', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);
  fake.seedDomain('taken-example.com');
  fake.seedDomain('taken-example.net', { registrar: 'Other Registrar LLC' });

  await t.test('Test Connection really fetches the IANA bootstrap and marks the row connected', async () => {
    const provider = await createProvider(base, admin, {
      providerKey: 'rdap-public', name: 'Public RDAP', adapterKey: 'rdap', providerType: 'rdap',
      apiBaseUrl: baseUrl, environment: 'sandbox',
    });
    assert.strictEqual(provider.status, 'not_configured');
    assert.strictEqual(provider.hasCredentials, false);
    assert.ok(!JSON.stringify(provider).includes('apiToken'));

    const test = await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${provider.id}/test`, method: 'POST' }, admin);
    assert.strictEqual(test.status, 200, JSON.stringify(test.data));
    assert.strictEqual(test.data.result.status, 'connected');
    assert.match(test.data.result.message, /resolved \d+ TLD services/);
    assert.strictEqual(test.data.provider.status, 'connected');
    assert.strictEqual(test.data.provider.connectionSucceeded, true);
    assert.strictEqual(test.data.provider.lastError, null);

    // The bootstrap request really happened, and it went where the row says.
    assert.strictEqual(fake.state.bootstrapped, 1);
  });

  await t.test('readiness now reports the connected provider', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/readiness' });
    assert.strictEqual(res.data.rdap.configured, true);
    assert.strictEqual(res.data.rdap.providerKey, 'rdap-public');
    assert.strictEqual(res.data.credentialStates.rdap, 'none', 'RDAP needs no credentials and that is not a fault');
  });

  await t.test('a registered name is reported as registered, from the registry', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'taken-example.com' } });
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.status, 'live');
    assert.strictEqual(res.data.estimate, false);

    const literal = res.data.results[0];
    assert.strictEqual(literal.domain, 'taken-example.com');
    assert.strictEqual(literal.status, 'registered');
    assert.strictEqual(literal.available, false);
    assert.strictEqual(literal.confidence, 'confirmed');
    assert.strictEqual(literal.source, 'rdap');

    // The variants are asked about too, and the fake has no record of them, so they are
    // "no registry record" — evidence, not a guarantee.
    assert.deepStrictEqual(res.data.results.map((row) => row.domain), [
      'taken-example.com', 'gettaken-example.com', 'trytaken-example.com',
    ]);
    assert.strictEqual(res.data.results[1].status, 'available');
    assert.strictEqual(res.data.results[1].available, true);
    assert.strictEqual(res.data.results[1].confidence, 'indicative');
    assert.match(res.data.results[1].caveat, /confirmed at registration/);
    assert.strictEqual(res.data.counts.registered, 1);
    assert.strictEqual(res.data.counts.available, 2);

    // Every one of those answers came from a real request to a registry endpoint.
    assert.strictEqual(fake.requestsFor('/rdap/domain/taken-example.com').length, 1);
    assert.strictEqual(fake.requestsFor('/rdap/domain/gettaken-example.com').length, 1);
  });

  await t.test('a name the old regex would have called "taken" is decided by the registry', async () => {
    // `googletest.com` contains "google", which the old structural guess treated as registered.
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'googletest.com' } });
    const literal = res.data.results[0];
    assert.strictEqual(literal.domain, 'googletest.com');
    assert.strictEqual(literal.status, 'available');
    assert.strictEqual(literal.confidence, 'indicative', 'the registry has no record, and that is all this says');
    // And the converse: a name the old guess would have called "available" because it merely
    // contains no magic word is reported as registered, because the registry says so.
    const taken = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'taken-example.net' } });
    assert.strictEqual(taken.data.results[0].status, 'registered');
  });

  await t.test('a search is recorded with the provider that answered and how it went', async () => {
    // Anonymous lookups are deliberately not stored; a signed-in customer's are.
    const token = await customerToken(base, 'ds-search-history@example.com');
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'recorded-example.com' } }, token);
    assert.ok(res.data.searchId);

    const rows = await app.store.table('domain_searches').all();
    assert.strictEqual(rows.length, 1, 'only the authenticated search is stored');
    const [row] = rows;
    assert.strictEqual(row.id, res.data.searchId);
    assert.strictEqual(row.status, 'completed');
    assert.strictEqual(row.error_code, null);
    assert.ok(row.provider_id, 'the provider row that answered is recorded');
    assert.ok(row.completed_at);
    assert.ok(Array.isArray(row.results) && row.results.length === 3);

    // And the customer can read their own history back.
    const own = await jsonFetch(base, { path: '/api/v1/domain-services/searches' }, token);
    assert.strictEqual(own.data.searches.length, 1);
    assert.strictEqual(own.data.searches[0].query, 'recorded-example.com');
  });

  await t.test('a TLD with no RDAP service is reported as unknown, not guessed', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'something.totally-unknown-tld' } });
    assert.strictEqual(res.data.results[0].status, 'unknown');
    assert.strictEqual(res.data.results[0].available, null);
    assert.strictEqual(res.data.results[0].reason, 'NO_RDAP_SERVICE_FOR_TLD');
    assert.strictEqual(res.data.results[0].source, null);
  });

  await t.test('a registry outage leaves the search answered but inconclusive', async () => {
    // The registry endpoint accepts the connection and then fails: the registry *is* the outage, so
    // this is the case an operator must be able to see rather than a DNS failure they cannot.
    for (const domain of ['outage-check.com', 'getoutage-check.com', 'tryoutage-check.com']) {
      fake.setOverride('GET', `/rdap/domain/${domain}`, { status: 503, code: 9999, message: 'registry on fire' });
    }
    const token = await customerToken(base, 'ds-outage@example.com');
    try {
      const res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'outage-check.com' } }, token);
      assert.strictEqual(res.status, 200, 'an outage is answered honestly, not turned into a 5xx');
      assert.strictEqual(res.data.status, 'live', 'the search itself ran');
      assert.strictEqual(res.data.results[0].available, null, 'an outage is not an availability answer');
      assert.strictEqual(res.data.results[0].status, 'unknown');
      assert.strictEqual(res.data.results[0].reason, 'PROVIDER_UNAVAILABLE');
      assert.strictEqual(res.data.counts.unknown, 3);

      const rows = (await app.store.table('domain_searches').all()).filter((s) => s.id === res.data.searchId);
      assert.strictEqual(rows[0].status, 'provider_error', 'a search nothing could answer is not stored as completed');
      assert.strictEqual(rows[0].error_code, 'PROVIDER_UNAVAILABLE');

      // The registry's own words never reach the browser.
      assert.ok(!JSON.stringify(res.data).includes('registry on fire'));
    } finally {
      for (const domain of ['outage-check.com', 'getoutage-check.com', 'tryoutage-check.com']) {
        fake.setOverride('GET', `/rdap/domain/${domain}`, null);
      }
    }
  });

  await t.test('a failed bootstrap is refused as a deployment fault, with no answer invented', async () => {
    const broken = startFakeRegistry();
    const { baseUrl: brokenUrl } = await broken.listen();
    try {
      broken.setOverride('GET', '/rdap/dns.json', { status: 500, code: 9999, message: 'bootstrap down' });
      const provider = await createProvider(base, admin, {
        providerKey: 'rdap-broken', name: 'Broken RDAP', adapterKey: 'rdap', providerType: 'rdap',
        apiBaseUrl: brokenUrl, environment: 'sandbox',
      });
      // Its own connection test refuses it, which is what keeps it out of the customer path.
      const test = await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${provider.id}/test`, method: 'POST' }, admin);
      assert.strictEqual(test.data.result.status, 'unavailable');
      assert.strictEqual(test.data.provider.status, 'unavailable');
      assert.strictEqual(test.data.provider.connectionSucceeded, false);
      assert.match(test.data.provider.lastError, /bootstrap/i);
    } finally {
      await broken.close();
    }
  });

  await t.test('bulk search answers per name and counts what it rejected', async () => {
    const token = await customerToken(base, 'ds-bulk@example.com');
    const res = await jsonFetch(base, {
      path: '/api/v1/domain-services/bulk-search', method: 'POST',
      body: { content: 'taken-example.com\nnot-taken.com\nnot a domain\n', sourceType: 'text' },
    }, token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.acceptedCount, 2, 'only the two real names are looked up');
    assert.strictEqual(res.data.rejectedCount, 3, '"not", "a" and "domain" are single labels, not domains');
    assert.strictEqual(res.data.results[0].status, 'registered');
    assert.strictEqual(res.data.results[1].status, 'available');
    assert.ok(res.data.searchId);

    const stored = await app.store.table('domain_searches').findById(res.data.searchId);
    assert.strictEqual(stored.kind, 'bulk');
    assert.strictEqual(stored.status, 'completed');
  });
});

test('domain services: WHOIS returns real registry data and stores the public projection only', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);
  await connectRdap(base, admin, baseUrl);
  await register(base, 'ds-whois@example.com');
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'ds-whois@example.com', password: 'SuperSecret123!' } });
  const token = login.data.accessToken;

  fake.seedDomain('whois-example.com', { registrar: 'Example Registrar, Inc.' });

  await t.test('a registered domain returns the registry projection', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/whois', method: 'POST', body: { domainName: 'whois-example.com' } }, token);
    assert.strictEqual(res.status, 200, JSON.stringify(res.data));
    assert.strictEqual(res.data.status, 'completed');
    assert.strictEqual(res.data.source, 'rdap');
    assert.strictEqual(res.data.result.domainName, 'whois-example.com');
    assert.strictEqual(res.data.result.registrar, 'Example Registrar, Inc.');
    assert.strictEqual(res.data.result.createdAt, '2011-04-12T04:00:00Z');
    assert.deepStrictEqual(res.data.result.nameservers, ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
    assert.strictEqual(res.data.result.privacyProtected, true);
    assert.match(res.data.result.registrant, /privacy protected/i);

    // Nothing resembling registrant data is anywhere in the response.
    const serialised = JSON.stringify(res.data);
    assert.ok(!/REDACTED FOR PRIVACY/.test(serialised) || /privacy protected/i.test(serialised));
    assert.ok(!serialised.includes('vcard'));
  });

  await t.test('the stored lookup is the public projection and carries its provenance', async () => {
    const row = (await app.store.table('domain_whois_lookups').all()).find((l) => l.domain === 'whois-example.com');
    assert.ok(row, 'the lookup is recorded');
    assert.strictEqual(row.status, 'completed');
    assert.strictEqual(row.source, 'rdap');
    assert.strictEqual(row.registrar, 'Example Registrar, Inc.');
    assert.strictEqual(row.privacy_protected, true);
    assert.ok(row.provider_id, 'the provider that answered is recorded');
    assert.ok(row.completed_at);
    assert.deepStrictEqual(Object.keys(row.raw).sort(), ['createdAt', 'expiresAt', 'nameservers', 'registry', 'statuses', 'updatedAt']);
    assert.ok(!JSON.stringify(row.raw).includes('vcard'));
  });

  await t.test('a domain with no registry record is `not_found`, not an error', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/whois', method: 'POST', body: { domainName: 'never-existed.com' } }, token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'not_found');
    assert.match(res.data.message, /No registration record was found/);
    const row = (await app.store.table('domain_whois_lookups').all()).find((l) => l.domain === 'never-existed.com');
    assert.strictEqual(row.status, 'not_found');
  });

  await t.test('a registry outage is recorded as a failure with its code', async () => {
    fake.setOverride('GET', '/rdap/domain/outage.com', { status: 503, code: 9999, message: 'registry down' });
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/whois', method: 'POST', body: { domainName: 'outage.com' } }, token);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.status, 'provider_error');
    assert.strictEqual(res.data.failure.code, 'PROVIDER_UNAVAILABLE');
    assert.ok(!JSON.stringify(res.data).includes('registry down'), 'the registry text stays server-side');

    const row = (await app.store.table('domain_whois_lookups').all()).find((l) => l.domain === 'outage.com');
    assert.strictEqual(row.status, 'provider_error');
    assert.strictEqual(row.error_code, 'PROVIDER_UNAVAILABLE');
  });

  await t.test('the lookup history shows what actually happened', async () => {
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/whois/history' }, token);
    assert.strictEqual(res.status, 200);
    const byDomain = Object.fromEntries(res.data.lookups.map((l) => [l.domain, l]));
    assert.strictEqual(byDomain['whois-example.com'].status, 'completed');
    assert.strictEqual(byDomain['whois-example.com'].source, 'rdap');
    assert.strictEqual(byDomain['never-existed.com'].status, 'not_found');
    assert.strictEqual(byDomain['outage.com'].errorCode, 'PROVIDER_UNAVAILABLE');
  });

  await t.test('another customer cannot see these lookups', async () => {
    const other = await customerToken(base, 'ds-whois-other@example.com');
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/whois/history' }, other);
    assert.deepStrictEqual(res.data.lookups, []);
  });

  await t.test('a deployment with no RDAP provider records the refusal instead of a dead row', async () => {
    const bare = await startServer({ JWT_SECRET });
    try {
      await register(bare.base, 'ds-bare@example.com');
      const bareLogin = await jsonFetch(bare.base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'ds-bare@example.com', password: 'SuperSecret123!' } });
      const res = await jsonFetch(bare.base, { path: '/api/v1/domain-services/whois', method: 'POST', body: { domainName: 'example.com' } }, bareLogin.data.accessToken);
      assert.strictEqual(res.status, 200, JSON.stringify(res.data));
      assert.strictEqual(res.data.status, 'provider_not_configured');
      assert.strictEqual(res.data.failure.code, 'PROVIDER_NOT_CONFIGURED');
      const row = (await bare.app.store.table('domain_whois_lookups').all())[0];
      assert.strictEqual(row.status, 'provider_not_configured', 'the reason is on the row, not lost');
      assert.strictEqual(row.error_code, 'PROVIDER_NOT_CONFIGURED');
    } finally {
      await bare.close();
    }
  });
});

test('domain services: appraisals run against the connected appraisal provider', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(async () => { await close(); await fake.close(); });

  const admin = await adminToken(base, app);

  await t.test('with no appraisal provider the request is refused, and the reason is named', async () => {
    const token = await customerToken(base, 'ds-appraise@example.com');
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/appraisals', method: 'POST', body: { domainName: 'premium-example.com' } }, token);
    assert.strictEqual(res.status, 503, JSON.stringify(res.data));
    assert.strictEqual(res.data.status, 'provider_not_configured');
    assert.strictEqual(res.data.failure.code, 'PROVIDER_NOT_CONFIGURED');
    assert.match(res.data.message, /no domain provider is connected/i);

    const row = await app.store.table('domain_appraisals').findOne({ domain: 'premium-example.com' });
    assert.strictEqual(row.status, 'provider_not_configured');
    assert.strictEqual(row.estimated_value, null, 'no valuation is invented');
  });

  await t.test('an appraisal provider with bad credentials is reported as auth_failed, not connected', async () => {
    const provider = await createProvider(base, admin, {
      providerKey: 'govalue', name: 'GoValue', adapterKey: 'govalue', providerType: 'appraisal',
      apiBaseUrl: baseUrl, environment: 'sandbox',
    });
    await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${provider.id}/credentials`, method: 'PUT', body: { credentials: { apiKey: 'wrong-key', apiSecret: 'wrong-secret' } } }, admin);

    fake.setOverride('GET', '/v1/domains/govalues', { status: 401, body: { code: 'UNAUTHORIZED', message: 'Invalid API key' } });
    const test1 = await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${provider.id}/test`, method: 'POST' }, admin);
    assert.strictEqual(test1.data.result.status, 'auth_failed');
    assert.strictEqual(test1.data.provider.status, 'auth_failed');
    assert.strictEqual(test1.data.provider.connectionSucceeded, false);
    assert.ok(!JSON.stringify(test1.data).includes('wrong-secret'), 'the credential is never echoed');

    // With the override gone the fake accepts, and the row becomes usable.
    fake.setOverride('GET', '/v1/domains/govalues', null);
    const test2 = await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${provider.id}/test`, method: 'POST' }, admin);
    assert.strictEqual(test2.data.result.status, 'connected');
    assert.strictEqual(test2.data.provider.status, 'connected');
  });

  await t.test('a completed appraisal stores the provider valuation and its disclaimer', async () => {
    const token = await customerToken(base, 'ds-appraise2@example.com');
    fake.setOverride('GET', '/v1/domains/govalues', {
      status: 200,
      body: { domainName: 'premium-example.com', goValue: 12500, listPrice: 18000, goValueWholesale: 9000, minPrice: 8000, maxPrice: 21000, salesProbability: 0.31, salesProbability500: 0.12 },
    });

    const res = await jsonFetch(base, { path: '/api/v1/domain-services/appraisals', method: 'POST', body: { domainName: 'premium-example.com' } }, token);
    assert.strictEqual(res.status, 201, JSON.stringify(res.data));
    assert.strictEqual(res.data.status, 'completed');
    assert.deepStrictEqual(res.data.estimatedValue, { amount: '12500.00', currency: 'USD' });
    assert.strictEqual(res.data.confidence, null, 'the provider publishes no confidence band');
    assert.deepStrictEqual(res.data.comparableSales, [], 'no comparable sale is invented');
    assert.strictEqual(res.data.factors.minPrice, 8000);
    assert.match(res.data.disclaimer, /not a guaranteed selling price/);

    const row = await app.store.table('domain_appraisals').findById(res.data.appraisalId);
    assert.strictEqual(row.status, 'completed');
    assert.strictEqual(Number(row.estimated_value), 12500);
    assert.strictEqual(row.provider, 'govalue');
    assert.ok(row.provider_id);
    assert.strictEqual(row.valuation.factors.maxPrice, 21000);
    assert.match(row.valuation.disclaimer, /automated third-party model/);
  });

  await t.test('the stored appraisal is readable afterwards with its valuation', async () => {
    const token = await customerToken(base, 'ds-appraise3@example.com');
    const created = await jsonFetch(base, { path: '/api/v1/domain-services/appraisals', method: 'POST', body: { domainName: 'another-example.com' } }, token);
    assert.strictEqual(created.status, 201);

    const read = await jsonFetch(base, { path: `/api/v1/domain-services/appraisals/${created.data.appraisalId}` }, token);
    assert.strictEqual(read.data.appraisal.status, 'completed');
    assert.strictEqual(read.data.appraisal.confidence, null);
    assert.ok(read.data.appraisal.valuation.factors);

    const list = await jsonFetch(base, { path: '/api/v1/domain-services/appraisals' }, token);
    assert.strictEqual(list.data.appraisals.length, 1, 'a customer sees only their own appraisals');
  });

  await t.test('a provider that answers without a valuation is refused, not zero-priced', async () => {
    const token = await customerToken(base, 'ds-appraise4@example.com');
    fake.setOverride('GET', '/v1/domains/govalues', { status: 200, body: { domainName: 'nothing.com', listPrice: 100 } });
    const res = await jsonFetch(base, { path: '/api/v1/domain-services/appraisals', method: 'POST', body: { domainName: 'nothing.com' } }, token);
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.data.failure.code, 'INVALID_PROVIDER_RESPONSE');
    const row = await app.store.table('domain_appraisals').findOne({ domain: 'nothing.com' });
    assert.strictEqual(row.status, 'provider_error');
    assert.strictEqual(row.estimated_value, null, 'a missing valuation never becomes $0');
  });
});

test('domain services: the admin door refuses an adapter this build does not compile', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const admin = await adminToken(base, app, 'ds-admin2@example.com');
  const list = await jsonFetch(base, { path: '/api/v1/admin/domain-services/providers' }, admin);
  assert.deepStrictEqual(list.data.installedAdapters, ['godaddy', 'godaddy-govalue', 'govalue', 'namecheap', 'rdap']);

  const res = await jsonFetch(base, {
    path: '/api/v1/admin/domain-services/providers', method: 'POST',
    body: { providerKey: 'enom', name: 'Enom', adapterKey: 'enom', providerType: 'registrar' },
  }, admin);
  assert.strictEqual(res.status, 400, JSON.stringify(res.data));
  assert.match(res.data.message, /not installed in this build/);
  assert.match(res.data.message, /namecheap/);

  // Nothing was created, so no row can sit there refusing every call later.
  assert.strictEqual((await app.store.table('domain_service_providers').all()).length, 0);

  // ...and the ported registrar adapter is accepted, because it can actually be called.
  const accepted = await jsonFetch(base, {
    path: '/api/v1/admin/domain-services/providers', method: 'POST',
    body: { providerKey: 'namecheap', name: 'Namecheap', adapterKey: 'namecheap', providerType: 'registrar', environment: 'sandbox' },
  }, admin);
  assert.strictEqual(accepted.status, 201, JSON.stringify(accepted.data));
  assert.strictEqual(accepted.data.provider.adapterKey, 'namecheap');
  // Created without credentials, so it is honestly `not_configured` and carries no capability to be
  // used until an operator enters the API key/username/IP and the connection test passes.
  assert.strictEqual(accepted.data.provider.status, 'not_configured');
});
