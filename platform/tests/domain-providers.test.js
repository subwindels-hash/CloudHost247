/**
 * Domain-provider connectors — unit and wire tests.
 *
 * The adapter code runs against a real HTTP fake of the IANA bootstrap file and an authoritative
 * RDAP registry (`tests/fixtures/fake-registry.js`) on loopback, and WHOIS runs against an injected
 * port-43 transport. Nothing here stubs the adapter itself, so what is verified is the code that
 * ships: bootstrap parsing, TLD resolution, the RDAP projection, fallback ordering, error
 * classification and the GoValue mapping.
 *
 * The rule these tests exist to defend: **a lookup either reports a fact from a provider or reports
 * that it has no answer.** It never guesses, and it never turns an absent value into a zero.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startFakeRegistry, fakeWhoisTransport } = require('./fixtures/fake-registry');
const { registerBuiltInDomainProviderAdapters } = require('../src/lib/domain-providers/register-builtins');
const {
  registerDomainProviderAdapter,
  registeredDomainProviderAdapters,
  createDomainProviderAdapter,
  resetDomainProviderAdaptersForTesting,
} = require('../src/lib/domain-providers/registry');
const { DomainProviderError, safeDomainProviderMessage, domainFailure } = require('../src/lib/domain-providers/types');
const { providerFetch, httpStatusToProviderError } = require('../src/lib/domain-providers/http');
const { RdapAdapter } = require('../src/lib/domain-providers/adapters/rdap');
const { GoValueAppraisalAdapter } = require('../src/lib/domain-providers/adapters/govalue');
const { domainProviderReadiness, resolveConnectedDomainProvider, assertCapabilitySupported } = require('../src/lib/domain-provider-service');
const { decryptSecret, PURPOSES } = require('../src/lib/secret-box');
const { createStore } = require('../src/store');
const { createLogger } = require('../src/core/logger');

const MASTER_SECRET = 'domain-provider-test-secret-value-32';

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const tempDirs = [];
async function newStore() {
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'ch247-domain-providers-'));
  tempDirs.push(dir);
  const store = await createStore({ usingPostgres: false, DATA_DIR: dir, JWT_SECRET: MASTER_SECRET }, createLogger({ level: 'silent' }));
  return store;
}

/** A provider row, as the admin API would have written it. */
async function seedProvider(store, overrides = {}) {
  return store.table('domain_service_providers').insert({
    id: overrides.id ?? 'provider-1',
    provider_key: overrides.providerKey ?? 'rdap-public',
    name: overrides.name ?? 'Public RDAP',
    adapter_key: overrides.adapterKey ?? 'rdap',
    provider_type: overrides.providerType ?? 'rdap',
    api_base_url: overrides.apiBaseUrl ?? null,
    environment: overrides.environment ?? 'production',
    capabilities: overrides.capabilities ?? {},
    configuration: overrides.configuration ?? {},
    status: overrides.status ?? 'connected',
    credentials_encrypted: overrides.credentialsEncrypted ?? null,
  });
}

// ============================================================================ registry

test('domain provider registry fails closed on an adapter this build does not compile', async () => {
  registerBuiltInDomainProviderAdapters();
  const installed = registeredDomainProviderAdapters();
  assert.ok(installed.includes('rdap'));
  assert.ok(installed.includes('govalue'));
  assert.ok(!installed.includes('namecheap'), 'a registrar adapter is not ported yet and must not be advertised');
  assert.ok(!installed.includes('generic'), 'there is deliberately no generic registrar fallback');

  let error = null;
  try { createDomainProviderAdapter({ adapterKey: 'namecheap' }); } catch (err) { error = err; }
  assert.ok(error instanceof DomainProviderError, 'a non-installed adapter must refuse');
  assert.strictEqual(error.code, 'ADAPTER_NOT_INSTALLED');
  assert.match(error.message, /Installed adapters: .*rdap/);
  assert.strictEqual(error.retryable, false);

  // The same refusal for an empty key.
  assert.throws(() => createDomainProviderAdapter({}), (err) => err.code === 'ADAPTER_NOT_INSTALLED');
  // And the positive case: an installed key really does construct, in both spellings.
  assert.strictEqual(createDomainProviderAdapter({ adapterKey: 'rdap' }).key, 'rdap');
  assert.strictEqual(createDomainProviderAdapter({ adapterKey: ' RDAP ' }).key, 'rdap');
});

test('domain provider registry refuses a duplicate registration and an illegal key', async () => {
  const { resetDomainProviderAdaptersForTesting: reset, registerDomainProviderAdapter: register } = require('../src/lib/domain-providers/registry');
  // Registration is idempotent for the builtins (guarded by a flag), but a second *direct*
  // registration of the same key is a programming error and must be loud.
  assert.throws(() => register('rdap', () => ({})), /already registered/);
  assert.throws(() => register('Bad Key!', () => ({})), /lowercase letters/);
  assert.throws(() => register('ok-key', 'not a function'), /factory function/);
  assert.strictEqual(reset, resetDomainProviderAdaptersForTesting);
});

// ============================================================================ error surface

test('provider failures never leak provider text into the customer sentence', async () => {
  const leaky = new DomainProviderError('AUTHENTICATION_FAILED', 'registrar-api.internal.example.com rejected key AKIA********ZZZZ', false);
  const message = safeDomainProviderMessage(leaky);
  assert.ok(!message.includes('internal.example.com'));
  assert.ok(!message.includes('AKIA'));
  assert.match(message, /authenticated/i);

  const failure = domainFailure(leaky);
  assert.deepStrictEqual(Object.keys(failure).sort(), ['code', 'message', 'retryable']);
  assert.strictEqual(failure.code, 'AUTHENTICATION_FAILED');
  assert.strictEqual(failure.retryable, false);

  // An unknown failure degrades to the generic sentence rather than echoing an exception message.
  assert.strictEqual(domainFailure(new Error('boom at /srv/secret/path')).code, 'PROVIDER_ERROR');
  assert.strictEqual(safeDomainProviderMessage(new Error('boom at /srv/secret/path')), 'The domain provider could not complete this request.');
  // And an unknown code cannot be constructed at all.
  assert.throws(() => new DomainProviderError('MADE_UP_CODE', 'x', false), /not a known failure code/);
});

test('http status classification maps the statuses a registry actually returns', async () => {
  assert.strictEqual(httpStatusToProviderError(401, '').code, 'AUTHENTICATION_FAILED');
  assert.strictEqual(httpStatusToProviderError(403, '').code, 'AUTHENTICATION_FAILED');
  assert.strictEqual(httpStatusToProviderError(404, '').code, 'NO_REGISTRY_RECORD');
  assert.strictEqual(httpStatusToProviderError(429, '').code, 'RATE_LIMITED');
  assert.strictEqual(httpStatusToProviderError(503, '').code, 'PROVIDER_UNAVAILABLE');
  assert.strictEqual(httpStatusToProviderError(400, '').code, 'PROVIDER_ERROR');
  assert.strictEqual(httpStatusToProviderError(429, '').retryable, true);
  // The body sample is bounded, so a huge provider error cannot bloat a stored evidence column.
  assert.ok(httpStatusToProviderError(500, 'x'.repeat(10_000)).providerDetail.bodySample.length <= 500);
});

test('provider requests are refused before egress when the target is not a public web address', async (t) => {
  let requested = 0;
  const transport = async () => { requested += 1; return { status: 200, text: '{}' }; };

  await assert.rejects(
    () => providerFetch({ url: 'file:///etc/passwd', transport }),
    (err) => /Only HTTP and HTTPS URLs are permitted/.test(err.message),
  );
  assert.strictEqual(requested, 0, 'a refused target must not reach the transport');

  // Loopback is permitted only because the harness sets NODE_ENV=test. In production a provider row
  // pointed at a private address must be refused *before* any request is made — that is the SSRF
  // guard, and it is asserted here by running the guard as production would.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(
      () => providerFetch({ url: 'http://169.254.169.254/latest/meta-data/', transport }),
      (err) => err instanceof DomainProviderError
        && err.code === 'PROVIDER_NOT_CONFIGURED'
        && /blocked \(private IP\)/.test(err.message)
        && err.providerDetail.reason === 'BLOCKED_TARGET',
      'the cloud metadata address is refused as a configuration fault',
    );
    await assert.rejects(
      () => providerFetch({ url: 'http://localhost/rdap/dns.json', transport }),
      (err) => err instanceof DomainProviderError && /blocked \(private or internal host\)/.test(err.message),
    );
    // A credential in the URL never reaches the error detail.
    await assert.rejects(
      () => providerFetch({ url: 'http://user:secret@localhost/rdap/dns.json', transport }),
      (err) => !JSON.stringify(err.providerDetail).includes('secret'),
    );
    assert.strictEqual(requested, 0, 'no request may be made to a blocked target');
  } finally {
    // `process.env.X = undefined` stores the literal string "undefined", so delete instead.
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('a provider request that times out or cannot connect is retryable and never an answer', async () => {
  // The timer here is deliberately NOT unref'd: it keeps the loop alive so the timeout under test is
  // what ends the wait. If the abort never fired, the test fails with its own message instead of
  // hanging the file.
  const hanging = async (url, init) => new Promise((resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('the transport was never aborted — the timeout did not fire')), 2000);
    init.signal.addEventListener('abort', () => {
      clearTimeout(guard);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });
  await assert.rejects(
    () => providerFetch({ url: 'http://127.0.0.1:9/rdap/dns.json', transport: hanging, timeoutMs: 30, allowLoopback: true }),
    (err) => err.code === 'PROVIDER_UNAVAILABLE' && err.retryable === true,
  );

  const refusing = async () => { throw new Error('ECONNREFUSED'); };
  await assert.rejects(
    () => providerFetch({ url: 'http://127.0.0.1:9/rdap/dns.json', transport: refusing, allowLoopback: true }),
    (err) => err.code === 'NETWORK_TEMPORARY_FAILURE' && err.retryable === true,
  );
});

// ============================================================================ RDAP adapter

test('rdap: bootstrap resolution, TLD routing and the public projection', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());
  fake.seedDomain('example.com');
  fake.seedDomain('taken.net', { registrar: 'Other Registrar LLC' });

  const adapter = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { allowLoopback: true });
  const info = await adapter.getDomainInfo('EXAMPLE.com');

  assert.strictEqual(info.domainName, 'example.com');
  assert.strictEqual(info.registrar, 'Fake Registrar, Inc.');
  assert.strictEqual(info.createdAt, '2011-04-12T04:00:00Z');
  assert.strictEqual(info.updatedAt, '2024-02-01T09:30:00Z');
  assert.strictEqual(info.expiresAt, '2027-04-12T04:00:00Z');
  // Lowercased on purpose: the WHOIS path has always lowercased, and the same domain must not
  // report its nameservers differently depending on which transport answered.
  assert.deepStrictEqual(info.nameservers, ['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
  assert.deepStrictEqual(info.statuses, ['client transfer prohibited']);
  assert.strictEqual(info.source, 'rdap');
  assert.strictEqual(info.privacyProtected, true, 'the registry marked the registrant redacted');
  assert.match(info.providerReference, /^REG-EXAMPLE-COM$/);

  // Only the public projection is ever produced: there is no field for registrant data.
  assert.deepStrictEqual(Object.keys(info).sort(), [
    'createdAt', 'domainName', 'expiresAt', 'nameservers', 'privacyProtected',
    'providerReference', 'registrar', 'registry', 'source', 'statuses', 'updatedAt',
  ]);

  // The bootstrap is fetched once and cached for the process; the second lookup must reuse it.
  const bootstrapsBefore = fake.state.bootstrapped;
  await adapter.getDomainInfo('taken.net');
  assert.strictEqual(fake.state.bootstrapped, bootstrapsBefore, 'the bootstrap file is cached');
  assert.strictEqual(fake.requestsFor('/rdap/domain/taken.net').length, 1);
});

test('rdap: a 404 from the authoritative registry is a real answer, not a provider outage', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  const adapter = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { allowLoopback: true });
  await assert.rejects(
    () => adapter.getDomainInfo('never-registered.com'),
    (err) => err instanceof DomainProviderError && err.code === 'NO_REGISTRY_RECORD' && err.retryable === false,
  );

  const presence = await adapter.lookupRegistryPresence(['never-registered.com']);
  assert.deepStrictEqual(presence, [
    { domainName: 'never-registered.com', status: 'no_registry_record', reason: null, responseStatus: 404 },
  ]);
});

test('rdap: registry-presence batches answer per name and never throw for one bad name', async (t) => {
  const fake = startFakeRegistry({ tlds: ['com', 'net'] });
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());
  fake.seedDomain('taken.com');
  fake.setOverride('GET', '/rdap/domain/broken.com', { status: 500, code: 9999, message: 'registry on fire' });

  const adapter = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { allowLoopback: true });
  const results = await adapter.lookupRegistryPresence(['taken.com', 'free.com', 'broken.com', 'unknown.tld']);

  assert.strictEqual(results.length, 4, 'one entry per name, in order');
  assert.strictEqual(results[0].status, 'registered');
  assert.strictEqual(results[0].registryHandle, 'REG-TAKEN-COM');
  assert.strictEqual(results[1].status, 'no_registry_record');
  assert.strictEqual(results[2].status, 'unknown');
  assert.strictEqual(results[2].reason, 'PROVIDER_UNAVAILABLE');
  assert.strictEqual(results[3].status, 'unknown');
  assert.strictEqual(results[3].reason, 'NO_RDAP_SERVICE_FOR_TLD', 'a TLD with no RDAP service is reported, not guessed');
});

test('rdap: falls back to port-43 WHOIS through the IANA referral chain', async (t) => {
  const fake = startFakeRegistry({ tlds: ['com'] });   // '.legacy' has no RDAP service at all
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  const whois = fakeWhoisTransport({
    'whois.iana.org': 'refer:        whois.nic.legacy\n\norganisation:  Legacy Registry\n',
    'whois.nic.legacy': [
      'Domain Name: legacy-example.legacy',
      'Registrar: Legacy Registrar BV',
      'Creation Date: 2004-01-05T00:00:00Z',
      'Updated Date: 2023-11-02T00:00:00Z',
      'Registry Expiry Date: 2028-01-05T00:00:00Z',
      'Domain Status: ok',
      'Name Server: NS1.LEGACY.EXAMPLE.NET',
      'Name Server: ns2.legacy.example.net',
      'Registrant Organization: Privacy Protect, LLC (PrivacyProtect.org)',
    ].join('\n'),
  });

  const adapter = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { whoisTransport: whois, allowLoopback: true });
  const info = await adapter.getDomainInfo('legacy-example.legacy');

  assert.strictEqual(info.source, 'whois');
  assert.strictEqual(info.registry, 'whois.nic.legacy');
  assert.strictEqual(info.registrar, 'Legacy Registrar BV');
  assert.strictEqual(info.createdAt, '2004-01-05T00:00:00Z');
  assert.strictEqual(info.expiresAt, '2028-01-05T00:00:00Z');
  assert.deepStrictEqual(info.nameservers, ['ns1.legacy.example.net', 'ns2.legacy.example.net'], 'deduplicated and lowercased');
  assert.strictEqual(info.privacyProtected, true, 'a privacy provider in the record means protected');
  assert.deepStrictEqual(whois.calls.map((call) => call.server), ['whois.iana.org', 'whois.nic.legacy']);
});

test('rdap: a registry referral that fails still returns the IANA answer it did get', async (t) => {
  const fake = startFakeRegistry({ tlds: ['com'] });
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  const whois = fakeWhoisTransport({
    'whois.iana.org': 'refer: whois.nic.legacy\nstatus: ACTIVE\n',
    // 'whois.nic.legacy' is deliberately absent, so the second hop throws.
  });
  const adapter = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { whoisTransport: whois, allowLoopback: true });
  const info = await adapter.getDomainInfo('partial.legacy');

  assert.strictEqual(info.registry, 'whois.nic.legacy');
  // The IANA summary carries no `Domain Status:` line, so nothing is claimed — an empty list, not
  // the registry's unrelated `status:` key.
  assert.deepStrictEqual(info.statuses, []);
  assert.strictEqual(info.registrar, null);
  assert.strictEqual(info.privacyProtected, true, 'no registrar visible means nothing to report as public');
});

test('rdap: an empty WHOIS response is a failure, not an empty record', async (t) => {
  const fake = startFakeRegistry({ tlds: ['com'] }); // '.legacy' has no RDAP service -> WHOIS path
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  // A connection that is accepted and then closed without a byte: a firewall, not an answer.
  const silent = fakeWhoisTransport({ 'whois.iana.org': '' });
  const adapter = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { whoisTransport: silent, allowLoopback: true });
  await assert.rejects(
    () => adapter.getDomainInfo('silent.legacy'),
    (err) => err instanceof DomainProviderError && err.code === 'PROVIDER_UNAVAILABLE' && err.retryable === true,
    'nothing was answered, so nothing may be reported',
  );

  // Whitespace only is the same thing.
  const blank = fakeWhoisTransport({ 'whois.iana.org': '   \n\t\n' });
  const adapter2 = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { whoisTransport: blank, allowLoopback: true });
  await assert.rejects(() => adapter2.getDomainInfo('blank.legacy'), (err) => err.code === 'PROVIDER_UNAVAILABLE');
});

test('rdap: a malformed registry document is refused rather than half-read', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());
  fake.seedDomainRaw('garbled.com', 'not json at all');

  const adapter = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { allowLoopback: true });
  await assert.rejects(
    () => adapter.getDomainInfo('garbled.com'),
    (err) => err instanceof DomainProviderError && err.code === 'INVALID_PROVIDER_RESPONSE',
  );
});

test('rdap: the bootstrap registry is only trusted when it names TLD services', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());
  fake.setOverride('GET', '/rdap/dns.json', { status: 200, body: { description: 'empty', services: [] } });

  const adapter = new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { allowLoopback: true });
  await assert.rejects(
    () => adapter.loadBootstrap(),
    (err) => err.code === 'INVALID_PROVIDER_RESPONSE',
    'an empty bootstrap file would otherwise make every TLD look unsupported',
  );
});

test('rdap: Test Connection reports the bootstrap result instead of throwing', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  const broken = startFakeRegistry();
  const { baseUrl: brokenUrl } = await broken.listen();
  t.after(async () => { await fake.close(); await broken.close(); });
  broken.setOverride('GET', '/rdap/dns.json', { status: 503, code: 9999, message: 'down' });

  const good = await new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: baseUrl }, { allowLoopback: true }).testConnection();
  assert.strictEqual(good.status, 'connected');
  assert.match(good.message, /resolved 6 TLD services/);
  assert.strictEqual(good.capabilities.domainInfo, true);
  assert.strictEqual(good.capabilities.registration, false);

  const bad = await new RdapAdapter({ adapterKey: 'rdap', apiBaseUrl: brokenUrl }, { allowLoopback: true }).testConnection();
  assert.strictEqual(bad.status, 'unavailable');
  assert.ok(typeof bad.message === 'string' && bad.message.length > 0);
});

test('rdap claims only the capabilities it has and refuses the rest by name', async () => {
  const adapter = new RdapAdapter({ adapterKey: 'rdap' });
  assert.strictEqual(adapter.capabilities.domainInfo, true);
  assert.strictEqual(adapter.capabilities.registryPresence, true);
  for (const capability of ['availability', 'pricing', 'registration', 'transfer', 'appraisal']) {
    assert.strictEqual(adapter.capabilities[capability], false, `${capability} must not be claimed`);
  }
  for (const method of ['checkAvailability', 'getPricing', 'getExtensions', 'registerDomain', 'transferDomain', 'getDomainStatus', 'appraiseDomain']) {
    await assert.rejects(
      () => adapter[method](),
      (err) => err instanceof DomainProviderError && err.code === 'UNSUPPORTED_OPERATION',
      `${method} must refuse`,
    );
  }
});

// ============================================================================ GoValue adapter

test('govalue: maps only what the API returns and never invents a comparable sale', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  const adapter = new GoValueAppraisalAdapter({
    adapterKey: 'govalue', apiBaseUrl: baseUrl,
    environment: 'sandbox', credentials: { apiKey: 'key-1', apiSecret: 'secret-1' },
  }, { allowLoopback: true });
  const result = await adapter.appraiseDomain('PremiumExample.com');

  assert.deepStrictEqual(result.estimatedValue, { amount: '2450.00', currency: 'USD' });
  assert.strictEqual(result.confidence, null, 'the provider publishes no confidence band, so none is claimed');
  assert.deepStrictEqual(result.comparableSales, [], 'comparable sales are never synthesised');
  assert.strictEqual(result.tld, 'com');
  assert.strictEqual(result.domainLength, 'premiumexample.com'.length);
  assert.strictEqual(result.factors.minPrice, 1500);
  assert.strictEqual(result.factors.maxPrice, 4200);
  assert.strictEqual(result.factors.salesProbability, 0.42);

  const [call] = fake.requestsFor('/v1/domains/govalues');
  assert.strictEqual(call.authorization, 'sso-key key-1:secret-1');
  assert.strictEqual(call.query.domainName, 'premiumexample.com');
});

test('govalue: without credentials it refuses before egress', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  const adapter = new GoValueAppraisalAdapter({ adapterKey: 'govalue', apiBaseUrl: baseUrl, credentials: {} }, { allowLoopback: true });
  await assert.rejects(
    () => adapter.appraiseDomain('example.com'),
    (err) => err.code === 'PROVIDER_NOT_CONFIGURED',
  );
  assert.strictEqual(fake.state.requests.length, 0, 'no request may be made without credentials');

  const halfConfigured = new GoValueAppraisalAdapter({ adapterKey: 'govalue', apiBaseUrl: baseUrl, credentials: { apiKey: 'only-the-key' } }, { allowLoopback: true });
  await assert.rejects(() => halfConfigured.appraiseDomain('example.com'), (err) => err.code === 'PROVIDER_NOT_CONFIGURED');
  assert.strictEqual(fake.state.requests.length, 0);
});

test('govalue: an absent valuation is refused rather than reported as zero', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());
  fake.setOverride('GET', '/v1/domains/govalues', {
    status: 200,
    body: { domainName: 'example.com', listPrice: 3999, salesProbability: 0.4 },
  });

  const adapter = new GoValueAppraisalAdapter({
    adapterKey: 'govalue', apiBaseUrl: baseUrl, credentials: { apiKey: 'k', apiSecret: 's' },
  }, { allowLoopback: true });
  await assert.rejects(
    () => adapter.appraiseDomain('example.com'),
    (err) => err.code === 'INVALID_PROVIDER_RESPONSE',
    'a missing goValue must not become $0.00',
  );
});

test('govalue: Test Connection distinguishes bad credentials from an outage', async (t) => {
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  const good = new GoValueAppraisalAdapter({ adapterKey: 'govalue', apiBaseUrl: baseUrl, credentials: { apiKey: 'k', apiSecret: 's' } }, { allowLoopback: true });
  assert.strictEqual((await good.testConnection()).status, 'connected');

  fake.setOverride('GET', '/v1/domains/govalues', { status: 401, body: { message: 'Unauthorized' } });
  const bad = new GoValueAppraisalAdapter({ adapterKey: 'govalue', apiBaseUrl: baseUrl, credentials: { apiKey: 'wrong', apiSecret: 'wrong' } }, { allowLoopback: true });
  assert.strictEqual((await bad.testConnection()).status, 'auth_failed');

  fake.setOverride('GET', '/v1/domains/govalues', { status: 500, body: { message: 'boom' } });
  assert.strictEqual((await bad.testConnection()).status, 'unavailable');

  const unconfigured = new GoValueAppraisalAdapter({ adapterKey: 'govalue', apiBaseUrl: baseUrl, credentials: {} }, { allowLoopback: true });
  assert.strictEqual((await unconfigured.testConnection()).status, 'not_configured');
});

// ============================================================================ the seam

test('the seam uses only a connection-tested provider, and says why when there is none', async () => {
  const store = await newStore();

  await assert.rejects(
    () => resolveConnectedDomainProvider(store, 'rdap', { secret: MASTER_SECRET }),
    (err) => err.code === 'PROVIDER_NOT_CONFIGURED' && /Admin → Domain Services/.test(err.message),
  );
  await assert.rejects(() => resolveConnectedDomainProvider(store, 'not-a-type', { secret: MASTER_SECRET }), /Unknown domain provider type/);

  // A configured-but-untested row is deliberately NOT usable: the operator has not proven it works.
  await seedProvider(store, { status: 'configured' });
  await assert.rejects(() => resolveConnectedDomainProvider(store, 'rdap', { secret: MASTER_SECRET }), (err) => err.code === 'PROVIDER_NOT_CONFIGURED');
  await assert.rejects(() => resolveConnectedDomainProvider(store, 'rdap', { secret: MASTER_SECRET }), (err) => err.code === 'PROVIDER_NOT_CONFIGURED');

  // A disabled row is not usable either, whatever else it claims.
  await store.table('domain_service_providers').updateById('provider-1', { status: 'disabled' });
  await assert.rejects(() => resolveConnectedDomainProvider(store, 'rdap', { secret: MASTER_SECRET }), (err) => err.code === 'PROVIDER_NOT_CONFIGURED');

  // RDAP needs no credentials, so a connected row with nothing stored is usable.
  await store.table('domain_service_providers').updateById('provider-1', { status: 'connected' });
  const resolved = await resolveConnectedDomainProvider(store, 'rdap', { secret: MASTER_SECRET });
  assert.strictEqual(resolved.provider.provider_key, 'rdap-public');
  assert.strictEqual(resolved.adapter.key, 'rdap');
  assert.deepStrictEqual(resolved.credentials, {});
});

test('a database status never overrules the credential invariant', async () => {
  const store = await newStore();
  // Marked connected, adapter installed, credentials present but written by a *different*
  // deployment's master secret: unusable, and the refusal must say so rather than fail at the
  // provider as though the registry were down.
  const foreign = encryptLikeLegacy('a-master-secret-from-an-older-deployment', { apiKey: 'k', apiSecret: 's' });
  await seedProvider(store, { providerKey: 'govalue', adapterKey: 'govalue', providerType: 'appraisal', status: 'connected', credentialsEncrypted: foreign });

  await assert.rejects(
    () => resolveConnectedDomainProvider(store, 'appraisal', { secret: MASTER_SECRET }),
    (err) => err.code === 'PROVIDER_NOT_CONFIGURED' && /could not be decrypted/.test(err.message),
  );

  // An adapter this build does not compile outranks the credential question: no credential could
  // ever make it work, so that is what the refusal must say.
  await seedProvider(store, { id: 'provider-nc', providerKey: 'nc', adapterKey: 'namecheap', providerType: 'registrar', status: 'connected' });
  await assert.rejects(
    () => resolveConnectedDomainProvider(store, 'registrar', { secret: MASTER_SECRET }),
    (err) => err.code === 'ADAPTER_NOT_INSTALLED',
  );

  // And a row with no credentials at all for a credentialed adapter is refused too.
  await store.table('domain_service_providers').deleteById('provider-1');
  await seedProvider(store, { id: 'provider-2', providerKey: 'govalue-2', adapterKey: 'govalue', providerType: 'appraisal', status: 'connected' });
  await assert.rejects(
    () => resolveConnectedDomainProvider(store, 'appraisal', { secret: MASTER_SECRET }),
    (err) => err.code === 'PROVIDER_NOT_CONFIGURED' && /no stored credentials/.test(err.message),
  );
});

test('credentials written before secret-box existed still open', async () => {
  const store = await newStore();
  // Byte-for-byte the envelope `domains/admin-domain-services.js#encryptCreds` produced: same
  // salt, same scrypt call, same v1 layout. This is the compatibility promise that means no
  // operator has to re-enter a credential to make it usable.
  const legacy = encryptLikeLegacy(MASTER_SECRET, { apiKey: 'legacy-key', apiSecret: 'legacy-secret' });
  assert.match(legacy, /^v1:[^:]+:[^:]+:[^:]+$/);

  await seedProvider(store, { providerKey: 'govalue-legacy', adapterKey: 'govalue', providerType: 'appraisal', status: 'connected', credentialsEncrypted: legacy });
  const resolved = await resolveConnectedDomainProvider(store, 'appraisal', { secret: MASTER_SECRET });
  assert.strictEqual(resolved.credentials.apiKey, 'legacy-key', 'secret-box reads the legacy envelope');
  assert.ok(resolved.adapter instanceof GoValueAppraisalAdapter);
  // And the same envelope is readable through secret-box directly.
  assert.strictEqual(decryptSecret(MASTER_SECRET, PURPOSES.domainProvider, legacy).includes('legacy-key'), true);
});

/** The exact legacy envelope format, reproduced independently of secret-box. */
function encryptLikeLegacy(secret, obj) {
  const key = crypto.scryptSync(String(secret), 'cloudhost247-domain-providers', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}

test('readiness reflects the rows that exist, not a hardcoded false block', async () => {
  const store = await newStore();
  let readiness = await domainProviderReadiness(store, { secret: MASTER_SECRET });
  assert.strictEqual(readiness.rdap.configured, false);
  assert.strictEqual(readiness.rdap.adapterInstalled, null);
  assert.strictEqual(readiness.auctions.configured, true, 'the internal marketplace never needs a provider');
  assert.ok(readiness.installedAdapters.includes('rdap'));

  await seedProvider(store, { status: 'connected' });
  readiness = await domainProviderReadiness(store, { secret: MASTER_SECRET });
  assert.strictEqual(readiness.rdap.configured, true);
  assert.strictEqual(readiness.rdap.providerKey, 'rdap-public');
  assert.strictEqual(readiness.rdap.adapterInstalled, true);
  assert.strictEqual(readiness.rdap.credentialState, 'none', 'RDAP needs no credentials and that is not a fault');
  assert.strictEqual(readiness.registrar.configured, false);

  // A connected row whose adapter is not compiled is configured-but-unusable, and readiness says so.
  await seedProvider(store, { id: 'p3', providerKey: 'nc', adapterKey: 'namecheap', providerType: 'registrar', status: 'connected' });
  readiness = await domainProviderReadiness(store, { secret: MASTER_SECRET });
  assert.strictEqual(readiness.registrar.configured, true);
  assert.strictEqual(readiness.registrar.adapterInstalled, false);
  await assert.rejects(
    () => resolveConnectedDomainProvider(store, 'registrar', { secret: MASTER_SECRET }),
    (err) => err.code === 'ADAPTER_NOT_INSTALLED',
  );
});

test('only a sandbox provider gets the loopback escape hatch', async () => {
  const store = await newStore();
  const fake = startFakeRegistry();
  const { baseUrl } = await fake.listen();
  try {
    fake.seedDomain('example.com');
    await seedProvider(store, { environment: 'production', apiBaseUrl: baseUrl });
    await assert.rejects(
      () => resolveConnectedDomainProvider(store, 'rdap', { secret: MASTER_SECRET }).then((r) => r.adapter.getDomainInfo('example.com')),
      (err) => /blocked|private/i.test(err.message),
      'a production provider pointed at loopback must be refused by the SSRF guard',
    );

    await store.table('domain_service_providers').updateById('provider-1', { environment: 'sandbox' });
    const resolved = await resolveConnectedDomainProvider(store, 'rdap', { secret: MASTER_SECRET });
    const info = await resolved.adapter.getDomainInfo('example.com');
    assert.strictEqual(info.registrar, 'Fake Registrar, Inc.');
  } finally {
    await fake.close();
  }
});

test('a capability an adapter does not claim is refused before any call', async () => {
  const { RdapAdapter: Adapter } = require('../src/lib/domain-providers/adapters/rdap');
  const adapter = new Adapter({ adapterKey: 'rdap' });
  assert.strictEqual(assertCapabilitySupported(adapter, 'domainInfo'), adapter);
  let error = null;
  try { assertCapabilitySupported(adapter, 'appraisal'); } catch (err) { error = err; }
  assert.ok(error instanceof DomainProviderError, 'an unclaimed capability must refuse');
  assert.strictEqual(error.code, 'UNSUPPORTED_OPERATION');
  assert.strictEqual(error.retryable, false);
  assert.match(error.message, /does not support 'appraisal'/);
});
