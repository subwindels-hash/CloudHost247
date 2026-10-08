/**
 * The registrar adapters and the two capabilities they were ported to serve: the transfer refresh
 * poll and the extension catalogue sync.
 *
 * Everything here runs against `tests/fixtures/fake-registrar.js` over **real HTTP** — no injected
 * transport, no stubbed adapter methods. That is deliberate: the properties under test are
 * properties of the wire conversation (does the XML envelope's `Status` decide success? does a
 * GoDaddy price get divided by the right number? is a missing credential refused before egress?),
 * and a stub would test the stub.
 *
 * No provider account is involved and no provider data is invented: every value is either quoted
 * from the API's documented shape or asserted to be absent. Where the honest answer is "the provider
 * did not say", the assertion is that the platform reports *that* — not a convenient default.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startServer, jsonFetch, register } = require('./helpers');
const { startFakeRegistrar } = require('./fixtures/fake-registrar');
const { startFakeRegistry } = require('./fixtures/fake-registry');
const { XmlParseError, parseXml, findAll, findFirst } = require('../src/lib/domain-providers/xml');
const { NamecheapAdapter } = require('../src/lib/domain-providers/adapters/namecheap');
const { GoDaddyAdapter } = require('../src/lib/domain-providers/adapters/godaddy');
const { DomainProviderError } = require('../src/lib/domain-providers/types');
const { syncExtensionsFromProvider, bareExtension } = require('../src/lib/domain-extension-sync');
const { mapProviderTransferStatus, refreshTransfer } = require('../src/lib/domain-transfer-service');
const { createStore } = require('../src/store');
const { encryptSecret, PURPOSES } = require('../src/lib/secret-box');
const { uuidv7 } = require('../src/lib/ids');

const JWT_SECRET = 'domain-registrar-test-secret-value-32';

function namecheapConfig(endpoint, credentials = {}) {
  return {
    credentials: { apiUser: 'ch247api', apiKey: 'live-key', userName: 'ch247api', clientIp: '203.0.113.9', ...credentials },
    apiBaseUrl: endpoint,
    environment: 'sandbox',
  };
}

function namecheapAdapter(endpoint, credentials) {
  return new NamecheapAdapter(namecheapConfig(endpoint, credentials), { allowLoopback: true });
}

function goDaddyConfig(baseUrl, credentials = {}) {
  return {
    credentials: { apiKey: 'gd-key', apiSecret: 'gd-secret', ...credentials },
    apiBaseUrl: baseUrl,
    environment: 'sandbox',
    configuration: { agreementKeys: ['DNPA'] },
  };
}

function goDaddyAdapter(baseUrl, credentials) {
  return new GoDaddyAdapter(goDaddyConfig(baseUrl, credentials), { allowLoopback: true });
}

/** Capture the typed provider error a call throws. `assert.throws(fn, predicate)` returns nothing. */
async function failureOf(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail, but it resolved');
}

async function newStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registrar-test-'));
  const store = await createStore({ DATA_DIR: dir }, { info() {}, warn() {}, error() {}, debug() {} });
  await store.connect();
  return store;
}

/** A provider row as an operator's create route would leave it: configured, credentials encrypted. */
async function seedRegistrar(store, overrides = {}) {
  const row = {
    id: uuidv7(),
    provider_key: overrides.provider_key ?? 'namecheap-main',
    name: overrides.name ?? 'Namecheap',
    adapter_key: overrides.adapter_key ?? 'namecheap',
    provider_type: 'registrar',
    api_base_url: overrides.api_base_url ?? null,
    environment: 'sandbox',
    capabilities: { availability: true, extensions: true, domainStatus: true },
    configuration: {},
    status: 'connected',
    // Encrypted through secret-box exactly as the credentials route writes them, so the seam's real
    // decryption path is what the refresh and sync tests exercise.
    credentials_encrypted: overrides.credentials_encrypted ?? encryptSecret(JWT_SECRET, PURPOSES.domainProvider, JSON.stringify({
      apiUser: 'ch247api', apiKey: 'live-key', userName: 'ch247api', clientIp: '203.0.113.9',
    })),
    created_at: new Date().toISOString(),
  };
  return store.table('domain_service_providers').insert(row);
}

// ============================================================================ the XML reader

test('the XML reader refuses every markup declaration', () => {
  // The security property, asserted directly: no DOCTYPE means no entity definition, which means
  // XXE and entity-expansion bombs are structurally impossible rather than "handled".
  const xxe = `<?xml version="1.0"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<ApiResponse Status="OK"><Errors /></ApiResponse>`;
  assert.throws(() => parseXml(xxe), (err) => err instanceof XmlParseError && /DOCTYPE/.test(err.message));

  const billion = `<!DOCTYPE lolz [ <!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;"> ]><lolz>&lol2;</lolz>`;
  assert.throws(() => parseXml(billion), (err) => err instanceof XmlParseError);
});

test('the XML reader handles the documented Namecheap document shapes', () => {
  const document = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <!-- a comment before the payload -->
  <Errors />
  <CommandResponse Type="namecheap.domains.check">
    <DomainCheckResult Domain="example.com" Available="false" ErrorNo="0" Description="taken &amp; gone" />
    <DomainCheckResult Domain="free-domain.com" Available="true"><Description><![CDATA[premium <not really>]]></Description></DomainCheckResult>
  </CommandResponse>
</ApiResponse>`;

  const root = parseXml(document);
  assert.strictEqual(root.name, 'ApiResponse');
  assert.strictEqual(root.attributes.Status, 'OK');

  // Namespace-prefix agnostic lookups: the fake sends a default namespace, real Namecheap responses
  // have used prefixed forms too.
  const prefixed = parseXml('<ns:ApiResponse Status="OK"><ns:Errors /><ns:CommandResponse><ns:TLD Name="com" /></ns:CommandResponse></ns:ApiResponse>');
  assert.ok(findFirst(prefixed, 'TLD'), 'a prefixed element is found by its local name');
  assert.strictEqual(findAll(prefixed, 'TLD').length, 1);

  const results = findAll(root, 'DomainCheckResult');
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].attributes.Description, 'taken & gone', 'the five entity references decode');
  assert.strictEqual(findFirst(results[1], 'Description').text.trim(), 'premium <not really>', 'CDATA is text, never markup');
});

test('the XML reader rejects a document that is not well formed', () => {
  assert.throws(() => parseXml('<a><b></a>'), (err) => err instanceof XmlParseError && /Mismatched/.test(err.message));
  assert.throws(() => parseXml('<a><b></b>'), (err) => err instanceof XmlParseError && /Unclosed/.test(err.message));
  assert.throws(() => parseXml('<a></a><b></b>'), (err) => err instanceof XmlParseError && /exactly one XML root/.test(err.message));
});

// ============================================================================ Namecheap

test('Namecheap refuses before egress when a credential is missing', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    // `clientIp` is the credential operators forget; Namecheap rejects the call without it, and so
    // does the adapter — before any request reaches the fixture.
    const missingIp = await namecheapAdapter(fake.endpoint(), { clientIp: '' }).testConnection();
    assert.strictEqual(missingIp.status, 'not_configured');
    assert.match(missingIp.message, /clientIp/);
    assert.strictEqual(fake.state.requests.length, 0, 'nothing was sent');

    // The typed refusal is what a caller of a real lookup sees, and it carries the same reason.
    const typed = await failureOf(() => namecheapAdapter(fake.endpoint(), { clientIp: '' }).checkAvailability(['example.com']));
    assert.ok(typed instanceof DomainProviderError);
    assert.strictEqual(typed.code, 'PROVIDER_NOT_CONFIGURED');
    assert.strictEqual(typed.retryable, false, 'a missing credential is never fixed by retrying');

    // A malformed XML answer is a provider fault, not an empty result set.
    fake.setOverride('POST /xml.response', { status: 200, text: '<ApiResponse Status="OK"><Unterminated>' });
    const result = await namecheapAdapter(fake.endpoint()).testConnection();
    assert.strictEqual(result.status, 'unavailable');
  } finally {
    await fake.close();
  }
});

test('Namecheap reads the XML envelope, not the HTTP status', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    // HTTP 200 + Status="ERROR" is how Namecheap reports an application error. An adapter that
    // trusted the HTTP status would return an empty availability list and call it "nothing taken".
    const error = await failureOf(() => namecheapAdapter(fake.endpoint(), { apiKey: 'revoked-key' }).checkAvailability(['example.com']));
    assert.ok(error instanceof DomainProviderError);
    assert.strictEqual(error.code, 'AUTHENTICATION_FAILED', 'the documented IP/key refusal maps to auth, not to retry');
    // ...and Test Connection surfaces it as auth_failed rather than as a vague outage.
    const rejected = await namecheapAdapter(fake.endpoint(), { apiKey: 'revoked-key' }).testConnection();
    assert.strictEqual(rejected.status, 'auth_failed');

    const rateLimited = startFakeRegistrar();
    await rateLimited.listen();
    rateLimited.setOverride('POST /xml.response', {
      status: 200,
      text: '<?xml version="1.0"?><ApiResponse Status="ERROR"><Errors><Error Number="2011170">Too many requests, rate limit exceeded</Error></Errors></ApiResponse>',
    });
    const throttled = await failureOf(() => namecheapAdapter(rateLimited.endpoint()).checkAvailability(['example.com']));
    assert.strictEqual(throttled.code, 'RATE_LIMITED');
    assert.strictEqual(throttled.retryable, true, 'a rate limit is worth retrying; a bad key is not');
    await rateLimited.close();

    // A 5xx has no envelope to read at all and maps through the HTTP vocabulary.
    fake.setOverride('POST /xml.response', { status: 503, text: 'upstream unavailable' });
    const outage = await failureOf(() => namecheapAdapter(fake.endpoint()).checkAvailability(['example.com']));
    assert.strictEqual(outage.code, 'PROVIDER_UNAVAILABLE');
  } finally {
    await fake.close();
  }
});

test('Namecheap reports real availability, real premium prices and unanswered checks', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    fake.seedDomain('taken-example.com', { available: false });
    fake.seedDomain('free-example.com', { available: true });
    fake.seedDomain('premium-example.com', {
      available: true, premium: true, premiumRegistrationPrice: 2450.0, premiumRenewalPrice: 2450.0,
      premiumTransferPrice: 0, premiumPricingType: 'FIXED',
    });
    fake.seedDomain('pending-check.com', { available: false, errorNo: '2030165', description: 'Unknown domain' });

    const results = await namecheapAdapter(fake.endpoint()).checkAvailability([
      'taken-example.com', 'free-example.com', 'premium-example.com', 'pending-check.com',
    ]);

    const byName = Object.fromEntries(results.map((entry) => [entry.domainName, entry]));
    assert.strictEqual(byName['taken-example.com'].status, 'registered');
    assert.strictEqual(byName['free-example.com'].status, 'available');
    assert.strictEqual(byName['premium-example.com'].status, 'premium');
    assert.strictEqual(byName['premium-example.com'].pricing.registration.amount, '2450.00');
    assert.strictEqual(byName['premium-example.com'].pricing.premium, true);
    // The unanswered check is its own state. Reporting it as `registered` or `available` would be a
    // fabricated answer to a question a customer is about to spend money on.
    assert.strictEqual(byName['pending-check.com'].status, 'unavailable');
    assert.strictEqual(byName['pending-check.com'].metadata.errorNo, '2030165');
    assert.deepStrictEqual(fake.state.checked, ['taken-example.com', 'free-example.com', 'premium-example.com', 'pending-check.com']);
  } finally {
    await fake.close();
  }
});

test('Namecheap availability respects the documented 50-name batch limit', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const names = Array.from({ length: 51 }, (_, i) => `batch-${i}.com`);
    for (const name of names) fake.seedDomain(name, { available: true });

    const results = await namecheapAdapter(fake.endpoint()).checkAvailability(names);
    assert.strictEqual(results.length, 51);
    const calls = fake.requestsFor('/xml.response').filter((entry) => entry.form.Command === 'namecheap.domains.check');
    assert.strictEqual(calls.length, 2, '51 names is two calls, not one over-limit call');
    assert.strictEqual(calls[0].form.DomainList.split(',').length, 50);
    assert.strictEqual(calls[1].form.DomainList.split(',').length, 1);
    // Every call carries the four credentials Namecheap requires.
    for (const call of calls) {
      assert.strictEqual(call.form.ApiUser, 'ch247api');
      assert.strictEqual(call.form.ApiKey, 'live-key');
      assert.strictEqual(call.form.UserName, 'ch247api');
      assert.strictEqual(call.form.ClientIp, '203.0.113.9');
    }
  } finally {
    await fake.close();
  }
});

test('Namecheap returns the TLD catalogue it actually quoted', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    fake.seedTld('com', { registrationPrice: 10.87, renewalPrice: 12.98, transferPrice: 10.87, type: 'GTLD' });
    fake.seedTld('.xyz', { registrationPrice: 1.98, renewalPrice: 15.98, transferPrice: 1.98, premium: true, type: 'NEW' });

    const offerings = await namecheapAdapter(fake.endpoint()).getExtensions();
    assert.strictEqual(offerings.length, 2);
    const com = offerings.find((entry) => entry.extension === '.com');
    assert.strictEqual(com.pricing.registration.amount, '10.87');
    assert.strictEqual(com.pricing.registration.currency, 'USD');
    assert.strictEqual(com.providerTld, 'com');
    const xyz = offerings.find((entry) => entry.extension === '.xyz');
    assert.strictEqual(xyz.extension, '.xyz', 'the documented leading dot normalises, it does not leak through');
    assert.strictEqual(xyz.premiumSupported, true);
    assert.ok(xyz.sourcedAt, 'every quote carries when it was sourced');
  } finally {
    await fake.close();
  }
});

test('Namecheap registers and transfers through the documented commands', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const adapter = namecheapAdapter(fake.endpoint());
    const contact = {
      firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '+234.8012345678',
      addressLine1: '1 Broad Street', city: 'Abuja', state: 'FCT', postalCode: '900001', countryCode: 'NG',
    };

    const registration = await adapter.registerDomain({
      domainName: 'brand-new-example.com', years: 1, contacts: { registrant: contact }, idempotencyKey: 'test-1',
    });
    assert.strictEqual(registration.status, 'registered');
    assert.strictEqual(registration.providerReference, '9000001');
    const create = fake.requestsFor('/xml.response').find((entry) => entry.form.Command === 'namecheap.domains.create');
    assert.strictEqual(create.form.RegistrantEmailAddress, 'ada@example.com');
    assert.strictEqual(create.form.WGEnabled, 'yes', 'WHOIS privacy is requested, as in the audited build');

    const transfer = await adapter.transferDomain({ domainName: 'moved-example.com', authCode: 'EPP-CODE-1', idempotencyKey: 'test-2' });
    assert.strictEqual(transfer.status, 'initiated');
    assert.strictEqual(transfer.providerReference, '7770001');
    const transferCall = fake.requestsFor('/xml.response').find((entry) => entry.form.Command === 'namecheap.domains.transfer');
    assert.strictEqual(transferCall.form.EPPCode, 'EPP-CODE-1');

    // A missing auth code is a caller fault the provider expresses, and it must not look like success.
    const missingAuth = await failureOf(() => adapter.transferDomain({ domainName: 'moved-example.com', authCode: '', idempotencyKey: 'test-3' }));
    assert.strictEqual(missingAuth.code, 'PROVIDER_ERROR');
    assert.match(missingAuth.message, /EPP code/);
  } finally {
    await fake.close();
  }
});

test('Namecheap reports domain status, and omits transfer state it was not told', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const adapter = namecheapAdapter(fake.endpoint());

    fake.state.infoStatus.set('settled-example.com', { status: 'OK', transferStatus: 'Transfer completed', expiresAt: '2028-01-02' });
    const completed = await adapter.getDomainStatus('7770001', 'settled-example.com');
    assert.strictEqual(completed.registrationStatus, 'registered');
    assert.strictEqual(completed.transferStatus, 'completed');
    assert.strictEqual(completed.expiresAt, '2028-01-02');

    fake.state.infoStatus.set('moving-example.com', { status: 'OK', transferStatus: 'Transfer in progress' });
    const moving = await adapter.getDomainStatus('7770002', 'moving-example.com');
    assert.strictEqual(moving.transferStatus, 'in_progress');

    // No transfer state in the response means the key is *absent* — never `'initiated'` by default.
    fake.state.infoStatus.set('quiet-example.com', { status: 'OK' });
    const quiet = await adapter.getDomainStatus('7770003', 'quiet-example.com');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(quiet, 'transferStatus'), false);
    assert.strictEqual(quiet.registrationStatus, 'registered');
  } finally {
    await fake.close();
  }
});

test('Namecheap refuses the operations it does not have instead of approximating them', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const adapter = namecheapAdapter(fake.endpoint());
    assert.deepStrictEqual(adapter.capabilities.domainInfo, false);
    assert.deepStrictEqual(adapter.capabilities.appraisal, false);

    for (const call of [() => adapter.getDomainInfo('example.com'), () => adapter.appraiseDomain('example.com'), () => adapter.lookupRegistryPresence(['example.com'])]) {
      const error = await failureOf(call);
      assert.ok(error instanceof DomainProviderError);
      assert.strictEqual(error.code, 'UNSUPPORTED_OPERATION');
      assert.strictEqual(error.retryable, false);
    }
    assert.strictEqual(fake.state.requests.length, 0, 'a refusal costs no egress');
  } finally {
    await fake.close();
  }
});

// ============================================================================ GoDaddy

test('GoDaddy authenticates with sso-key and reports a rejected credential as auth', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const connected = await goDaddyAdapter(fake.baseUrl).testConnection();
    assert.strictEqual(connected.status, 'connected');
    const call = fake.state.requests.at(-1);
    assert.strictEqual(call.authorization, 'sso-key gd-key:gd-secret');
    assert.strictEqual(call.path, '/v1/domains');

    const rejected = await goDaddyAdapter(fake.baseUrl, { apiSecret: 'bad-secret' }).testConnection();
    assert.strictEqual(rejected.status, 'auth_failed');

    // A raw 401 with no `sso-key` header at all is the same answer.
    const anonymous = await goDaddyAdapter(fake.baseUrl, { apiKey: '' }).testConnection();
    assert.strictEqual(anonymous.status, 'not_configured', 'an empty credential never reaches the network');

    // The optional shopper scope is sent only when configured.
    const scoped = goDaddyAdapter(fake.baseUrl, { shopperId: 'shopper-42' });
    await scoped.testConnection();
    assert.strictEqual(fake.state.requests.at(-1).headers['x-shopper-id'], 'shopper-42');
  } finally {
    await fake.close();
  }
});

test('GoDaddy converts both documented price shapes and refuses to guess a third', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    fake.seedGoDaddyDomain('cents-price.com', { available: true, centsPrice: 1499, centsRenewal: 1899 });
    // Legacy shape: price in millionths of the currency unit.
    fake.seedGoDaddyDomain('micro-price.com', { available: true, microPrice: 10_870_000 });
    fake.seedGoDaddyDomain('no-price-shape.com', { available: true });
    fake.seedGoDaddyDomain('gone-example.com', { available: false });

    const results = await goDaddyAdapter(fake.baseUrl).checkAvailability([
      'cents-price.com', 'micro-price.com', 'no-price-shape.com', 'gone-example.com',
    ]);
    const byName = Object.fromEntries(results.map((entry) => [entry.domainName, entry]));

    // Cents: 1499 → 14.99. Getting this factor wrong by 100 is the classic integration bug, and it
    // is a customer-visible price error, so it is asserted explicitly.
    assert.strictEqual(byName['cents-price.com'].pricing.registration.amount, '14.99');
    assert.strictEqual(byName['cents-price.com'].pricing.renewal.amount, '18.99');
    // Millionths: 10870000 → 10.87.
    assert.strictEqual(byName['micro-price.com'].pricing.registration.amount, '10.87');
    // No recognisable price shape → no price. Never 0.00, which would read as "free".
    assert.strictEqual(byName['no-price-shape.com'].pricing, null);
    assert.strictEqual(byName['gone-example.com'].status, 'registered');
    assert.strictEqual(byName['gone-example.com'].pricing, null);
  } finally {
    await fake.close();
  }
});

test('GoDaddy carries the definitive flag through and tolerates the wrapped response shape', async () => {
  const fake = startFakeRegistrar({ objectWrap: true });
  await fake.listen();
  try {
    fake.seedGoDaddyDomain('not-definitive.com', { available: true, definitive: false, centsPrice: 1000 });
    const results = await goDaddyAdapter(fake.baseUrl).checkAvailability(['not-definitive.com']);
    assert.strictEqual(results.length, 1, 'a single-object response is handled like an array');
    assert.strictEqual(results[0].metadata.definitive, false, 'an indicative answer is labelled indicative');
    assert.strictEqual(results[0].status, 'available');
    // And the caller can see it was not definitive, so it is never presented as a guarantee.
    assert.notStrictEqual(results[0].metadata.definitive, true);
  } finally {
    await fake.close();
  }
});

test('GoDaddy registers with consent, transfers, and reports status', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const adapter = goDaddyAdapter(fake.baseUrl);
    const contact = {
      firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '+234.8012345678',
      addressLine1: '1 Broad Street', city: 'Abuja', state: 'FCT', postalCode: '900001', countryCode: 'NG',
    };

    const purchase = await adapter.registerDomain({ domainName: 'bought-example.com', years: 2, contacts: { registrant: contact }, idempotencyKey: 'test-1' });
    assert.strictEqual(purchase.status, 'pending_confirmation');
    assert.strictEqual(purchase.providerReference, '424242');
    const buy = fake.state.requests.find((entry) => entry.path === '/v1/domains/purchase');
    assert.deepStrictEqual(buy.body.consent.agreementKeys, ['DNPA']);
    assert.strictEqual(buy.body.period, 2);
    assert.strictEqual(buy.body.contacts.registrant.addressMailing.country, 'NG');

    const transfer = await adapter.transferDomain({ domainName: 'moved-example.com', authCode: 'EPP-1', contacts: { registrant: contact }, idempotencyKey: 'test-2' });
    assert.strictEqual(transfer.status, 'initiated');
    assert.strictEqual(transfer.providerReference, '880011');

    fake.seedGoDaddyDomain('active-example.com', { onAccount: true, status: 'ACTIVE', expires: '2027-09-09T00:00:00.000Z' });
    const status = await adapter.getDomainStatus(null, 'active-example.com');
    assert.strictEqual(status.registrationStatus, 'registered');
    assert.strictEqual(status.expiresAt, '2027-09-09T00:00:00.000Z');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(status, 'transferStatus'), false, 'absent stays absent');

    // Only once the API reports a transfer does the adapter say one is in progress.
    fake.state.goDaddyTransfer.set('active-example.com', 'SUBMITTED');
    const inFlight = await adapter.getDomainStatus(null, 'active-example.com');
    assert.strictEqual(inFlight.transferStatus, 'in_progress');
  } finally {
    await fake.close();
  }
});

test('GoDaddy refuses a purchase with no order reference and has no TLD catalogue', async () => {
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    fake.setOverride('POST /v1/domains/purchase', { status: 200, body: {} });
    const adapter = goDaddyAdapter(fake.baseUrl);
    const contact = {
      firstName: 'Ada', lastName: 'Obi', email: 'ada@example.com', phone: '+234.8012345678',
      addressLine1: '1 Broad Street', city: 'Abuja', countryCode: 'NG',
    };
    const error = await failureOf(() => adapter.registerDomain({ domainName: 'odd-example.com', years: 1, contacts: { registrant: contact }, idempotencyKey: 'x' }));
    assert.strictEqual(error.code, 'INVALID_PROVIDER_RESPONSE', 'a purchase with no reference is not a success');
    assert.strictEqual(error.retryable, false);

    assert.deepStrictEqual(adapter.capabilities.extensions, false);
    const noCatalogue = await failureOf(() => adapter.getExtensions());
    assert.strictEqual(noCatalogue.code, 'UNSUPPORTED_OPERATION');
  } finally {
    await fake.close();
  }
});

// ============================================================================ transfer status mapping

test('provider transfer wording maps, and unrecognised wording does not invent a status', () => {
  assert.strictEqual(mapProviderTransferStatus('Transfer completed'), 'completed');
  assert.strictEqual(mapProviderTransferStatus('Transfer failed'), 'failed');
  assert.strictEqual(mapProviderTransferStatus('Awaiting admin approval'), 'authorization_required');
  assert.strictEqual(mapProviderTransferStatus('Transfer in progress'), 'transfer_in_progress');
  assert.strictEqual(mapProviderTransferStatus('Pending registry'), 'pending_registry');
  assert.strictEqual(mapProviderTransferStatus('Initiated'), 'transfer_initiated');
  // The point of the whole function: a phrase nobody has seen before is `unknown`, and a caller that
  // writes `unknown` as a status would one day mark a live transfer as something it is not.
  assert.strictEqual(mapProviderTransferStatus('Waiting on the losing registrar, day 3'), 'unknown');
  assert.strictEqual(mapProviderTransferStatus(null), null);
});

// ============================================================================ transfer refresh

test('a refresh writes what the registrar said and completes the transfer once', async () => {
  const store = await newStore();
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const provider = await seedRegistrar(store, { api_base_url: fake.endpoint() });
    const userId = uuidv7();
    const transfer = await store.table('domain_transfers').insert({
      user_id: userId, domain_name: 'incoming-example.com', status: 'transfer_initiated',
      provider_id: provider.id, provider_reference: '7770001', provider_metadata: {},
    });

    // In flight, and phrased the way the registrar phrases it.
    fake.state.infoStatus.set('incoming-example.com', { status: 'OK', transferStatus: 'Transfer in progress' });
    let result = await refreshTransfer(store, transfer, { config: { JWT_SECRET } });
    assert.strictEqual(result.status, 'transfer_in_progress');
    assert.strictEqual(result.completed, false);
    let stored = await store.table('domain_transfers').findById(transfer.id);
    assert.strictEqual(stored.status, 'transfer_in_progress');
    assert.strictEqual(stored.provider_status, 'OK');

    // Language nobody recognises: the local status must not move.
    fake.state.infoStatus.set('incoming-example.com', { status: 'OK', transferStatus: 'pending losing registrar decision' });
    result = await refreshTransfer(store, stored, { config: { JWT_SECRET } });
    assert.strictEqual(result.statusRecognised, false);
    assert.strictEqual(result.status, 'transfer_in_progress');
    stored = await store.table('domain_transfers').findById(transfer.id);
    assert.strictEqual(stored.status, 'transfer_in_progress');

    // Completion: the domain is linked to the customer, and a second refresh is a no-op.
    fake.state.infoStatus.set('incoming-example.com', { status: 'OK', transferStatus: 'Transfer completed', expiresAt: '2029-05-05' });
    result = await refreshTransfer(store, stored, { config: { JWT_SECRET } });
    assert.strictEqual(result.status, 'completed');
    assert.strictEqual(result.completed, true);

    const linked = (await store.table('customer_domains').all()).filter((row) => row.user_id === userId);
    assert.strictEqual(linked.length, 1, 'the transferred domain is the customer\'s now');
    assert.strictEqual(linked[0].domain, 'incoming-example.com');
    assert.strictEqual(linked[0].registrar, 'Namecheap');
    // Registrar expiry dates arrive as `YYYY-MM-DD`; the store normalises the instant, and the test
    // compares instants rather than string shapes so it holds for both stores.
    assert.strictEqual(new Date(linked[0].expires_at).toISOString(), '2029-05-05T00:00:00.000Z');
    stored = await store.table('domain_transfers').findById(transfer.id);
    assert.ok(stored.completed_at, 'completion is stamped');

    const again = await refreshTransfer(store, stored, { config: { JWT_SECRET } });
    assert.strictEqual(again.completed, false);
    assert.strictEqual(again.alreadyCompleted, true, 'completing twice would link the domain twice');
    assert.strictEqual((await store.table('customer_domains').all()).filter((row) => row.user_id === userId).length, 1);
  } finally {
    await fake.close();
  }
});

test('a refresh that cannot run refuses with the reason and leaves the status alone', async () => {
  const store = await newStore();
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const provider = await seedRegistrar(store, { api_base_url: fake.endpoint() });
    const transfer = await store.table('domain_transfers').insert({
      user_id: uuidv7(), domain_name: 'stuck-example.com', status: 'transfer_in_progress',
      provider_id: provider.id, provider_reference: '7770001', provider_metadata: {},
    });

    fake.setOverride('POST /xml.response', { status: 500, text: 'registrar exploded' });
    const error = await failureOf(() => refreshTransfer(store, transfer, { config: { JWT_SECRET } }));
    assert.strictEqual(error.details.failureCode, 'PROVIDER_UNAVAILABLE');

    const stored = await store.table('domain_transfers').findById(transfer.id);
    assert.strictEqual(stored.status, 'transfer_in_progress', 'an unanswerable poll is not progress');
    assert.strictEqual(stored.error_code, 'PROVIDER_UNAVAILABLE', 'the failure is recorded as evidence');
    assert.ok(stored.provider_metadata.lastRefreshFailure, 'and dated');

    // ...and it recovers when the registrar does.
    fake.setOverride('POST /xml.response', null);
    fake.state.infoStatus.set('stuck-example.com', { status: 'OK', transferStatus: 'Transfer in progress' });
    const result = await refreshTransfer(store, stored, { config: { JWT_SECRET } });
    assert.strictEqual(result.status, 'transfer_in_progress');
    assert.strictEqual((await store.table('domain_transfers').findById(transfer.id)).error_code, null);
  } finally {
    await fake.close();
  }
});

test('a refresh with no connected registrar refuses by name', async () => {
  const store = await newStore();
  const transfer = await store.table('domain_transfers').insert({
    user_id: uuidv7(), domain_name: 'orphan-example.com', status: 'transfer_initiated', provider_metadata: {},
  });
  const error = await failureOf(() => refreshTransfer(store, transfer, { config: { JWT_SECRET } }));
  assert.strictEqual(error.code, 'PROVIDER_NOT_CONFIGURED');
  assert.match(error.message, /No connected registrar domain provider is configured/);
  assert.match(error.message, /Installed adapters:/, 'the refusal names what could be configured');

  // A transfer bound to a provider row that was deleted is refused too, rather than silently
  // re-pointed at a different registrar that knows nothing about it.
  const transfer2 = await store.table('domain_transfers').insert({
    user_id: uuidv7(), domain_name: 'deleted-provider-example.com', status: 'transfer_initiated',
    provider_id: uuidv7(), provider_metadata: {},
  });
  const error2 = await failureOf(() => refreshTransfer(store, transfer2, { config: { JWT_SECRET } }));
  assert.match(error2.message, /no longer exists/);
});

test('a transfer with no recorded registrar adopts the connected one, visibly', async () => {
  const store = await newStore();
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const provider = await seedRegistrar(store, { api_base_url: fake.endpoint() });
    const transfer = await store.table('domain_transfers').insert({
      user_id: uuidv7(), domain_name: 'adopted-example.com', status: 'transfer_initiated', provider_metadata: {},
    });
    fake.state.infoStatus.set('adopted-example.com', { status: 'OK', transferStatus: 'Transfer in progress' });

    const result = await refreshTransfer(store, transfer, { config: { JWT_SECRET } });
    assert.strictEqual(result.adopted, true);
    assert.strictEqual(result.providerKey, provider.provider_key);
    // Written onto the row, so the next poll asks the same registrar instead of re-deciding.
    assert.strictEqual((await store.table('domain_transfers').findById(transfer.id)).provider_id, provider.id);
  } finally {
    await fake.close();
  }
});

// ============================================================================ extension sync

test('the extension sync records provider quotes and leaves the selling prices alone', async () => {
  const store = await newStore();
  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    const provider = await seedRegistrar(store, { api_base_url: fake.endpoint() });
    fake.seedTld('com', { registrationPrice: 10.87, renewalPrice: 12.98, transferPrice: 10.87 });
    fake.seedTld('net', { registrationPrice: 12.5, renewalPrice: 14.0, transferPrice: 12.5 });

    // An existing extension the operator has already curated and priced for sale.
    const curated = await store.table('domain_extensions').insert({
      id: uuidv7(), tld: 'com', register_price_cents: 1599, renew_price_cents: 1899, is_trending: true,
      description: 'Our flagship extension', restrictions: 'None for most registrants', status: 'active', active: true,
    });

    const report = await syncExtensionsFromProvider(store, { config: { JWT_SECRET } });
    assert.strictEqual(report.synced, 2);
    assert.strictEqual(report.providerKey, provider.provider_key);
    assert.strictEqual(report.created, 2, 'both quotes are new offerings');
    assert.strictEqual(report.extensionsCreated, 1, 'only `net` was a new extension');
    assert.strictEqual(report.extensionsExisting, 1);

    const offerings = await store.table('domain_provider_extension_offerings').all();
    const com = offerings.find((row) => row.extension === 'com');
    assert.strictEqual(com.registration_price, 10.87, 'the provider quote is recorded as the provider quote');
    assert.strictEqual(com.currency, 'USD');
    assert.strictEqual(com.provider_id, provider.id);

    // The curated row is untouched where it matters: an operator's description, trending flag and —
    // above all — the price this platform *sells* at.
    const after = await store.table('domain_extensions').findById(curated.id);
    assert.strictEqual(after.register_price_cents, 1599, 'a sync never repricess the storefront');
    assert.strictEqual(after.renew_price_cents, 1899);
    assert.strictEqual(after.description, 'Our flagship extension');
    assert.strictEqual(after.is_trending, true);
    assert.strictEqual(after.tld, 'com', 'the bare label is what the platform table stores');

    // A newly synced extension is not silently free: it has no selling price, and that is advertised.
    const net = (await store.table('domain_extensions').all()).find((row) => row.tld === 'net');
    assert.strictEqual(net.register_price_cents, 0);
    assert.strictEqual(report.sellingPricesChanged, 0);

    // A second sync updates the same offering rather than duplicating it.
    fake.seedTld('com', { registrationPrice: 9.99, renewalPrice: 12.98 });
    const second = await syncExtensionsFromProvider(store, { config: { JWT_SECRET } });
    assert.strictEqual(second.created, 0);
    assert.strictEqual(second.updated, 2);
    assert.strictEqual((await store.table('domain_provider_extension_offerings').all()).length, 2, 'one row per provider+extension');
    const updatedCom = (await store.table('domain_provider_extension_offerings').all()).find((row) => row.extension === 'com');
    assert.strictEqual(updatedCom.registration_price, 9.99);
    assert.strictEqual((await store.table('domain_extensions').findById(curated.id)).register_price_cents, 1599);
  } finally {
    await fake.close();
  }
});

test('the extension sync refuses rather than reporting an empty success', async () => {
  const store = await newStore();
  // Nothing connected: a named refusal, because "synced 0" reads as a successful sync of nothing.
  const error = await failureOf(() => syncExtensionsFromProvider(store, { config: { JWT_SECRET } }));
  assert.strictEqual(error.code, 'PROVIDER_NOT_CONFIGURED');

  const fake = startFakeRegistrar();
  await fake.listen();
  try {
    // A registrar that publishes no catalogue is a configuration mismatch. It is refused by name,
    // and the adapter's capability flag is what should have prevented the call in the first place.
    await seedRegistrar(store, { api_base_url: fake.baseUrl });
    const unsupported = await failureOf(() => syncExtensionsFromProvider(store, { config: { JWT_SECRET } }, {
      provider: { id: 'p', name: 'GoDaddy', provider_key: 'godaddy' },
      adapter: new GoDaddyAdapter(goDaddyConfig(fake.baseUrl), { allowLoopback: true }),
    }));
    assert.match(unsupported.message, /does not expose an extension catalogue/);
    assert.match(unsupported.message, /GoDaddy/);

    // And an empty catalogue from a registrar that claims one is refused too, rather than writing
    // zero rows and reporting success.
    const empty = await failureOf(() => syncExtensionsFromProvider(store, { config: { JWT_SECRET } }, {
      provider: { id: 'p2', name: 'Namecheap', provider_key: 'namecheap' },
      adapter: { key: 'namecheap', getExtensions: async () => [], capabilities: { extensions: true } },
    }));
    assert.match(empty.message, /empty extension catalogue/);
    assert.deepStrictEqual(await store.table('domain_provider_extension_offerings').all(), []);
  } finally {
    await fake.close();
  }
});

// ============================================================================ the admin routes

test('the admin routes drive both capabilities over the real HTTP pipeline', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const fake = startFakeRegistrar();
  await fake.listen();
  t.after(() => fake.close());

  await register(base, 'registrar-admin@example.com', 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email: 'registrar-admin@example.com' });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'registrar-admin@example.com', password: 'SuperSecret123!' } });
  const admin = login.data.accessToken;

  // 1. Configure the registrar the way an operator would, then earn `connected` with a real call.
  const created = await jsonFetch(base, {
    path: '/api/v1/admin/domain-services/providers', method: 'POST',
    body: {
      providerKey: 'namecheap-main', name: 'Namecheap', adapterKey: 'namecheap', providerType: 'registrar',
      apiBaseUrl: fake.endpoint(), environment: 'sandbox',
    },
  }, admin);
  assert.strictEqual(created.status, 201, JSON.stringify(created.data));
  const providerId = created.data.provider.id;

  const credentials = await jsonFetch(base, {
    path: `/api/v1/admin/domain-services/providers/${providerId}/credentials`, method: 'PUT',
    body: { credentials: { apiUser: 'ch247api', apiKey: 'live-key', userName: 'ch247api', clientIp: '203.0.113.9' } },
  }, admin);
  assert.strictEqual(credentials.status, 200, JSON.stringify(credentials.data));

  const tested = await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${providerId}/test`, method: 'POST' }, admin);
  assert.strictEqual(tested.data.result.status, 'connected', JSON.stringify(tested.data));

  // 2. The extension sync now really syncs.
  fake.seedTld('com', { registrationPrice: 10.87, renewalPrice: 12.98 });
  fake.seedTld('dev', { registrationPrice: 14.0, renewalPrice: 14.0 });
  const synced = await jsonFetch(base, { path: '/api/v1/admin/domain-services/extensions/sync', method: 'POST' }, admin);
  assert.strictEqual(synced.status, 200, JSON.stringify(synced.data));
  assert.strictEqual(synced.data.synced, 2);
  assert.strictEqual(synced.data.providerName, 'Namecheap');
  assert.strictEqual(synced.data.message, undefined, 'the old empty-success message is gone');

  const listed = await jsonFetch(base, { path: '/api/v1/admin/domain-services/extensions' }, admin);
  assert.deepStrictEqual(listed.data.extensions.map((row) => row.tld).sort(), ['com', 'dev']);

  // 3. The transfer refresh now really polls, and a completed transfer reaches the customer's list.
  // A real registered customer, because the completion path must satisfy the same user invariants
  // the rest of the platform enforces.
  await register(base, 'transfer-customer@example.com', 'SuperSecret123!');
  const userId = (await app.store.table('users').findOne({ email: 'transfer-customer@example.com' })).id;
  const transfer = await app.store.table('domain_transfers').insert({
    user_id: userId, domain_name: 'route-example.com', status: 'transfer_initiated',
    provider_id: providerId, provider_reference: '7770001', provider_metadata: {},
  });
  fake.state.infoStatus.set('route-example.com', { status: 'OK', transferStatus: 'Transfer in progress', expiresAt: '2029-01-01' });

  const refreshed = await jsonFetch(base, { path: `/api/v1/admin/domain-services/transfers/${transfer.id}/refresh`, method: 'POST' }, admin);
  assert.strictEqual(refreshed.status, 200, JSON.stringify(refreshed.data));
  assert.strictEqual(refreshed.data.status, 'transfer_in_progress');
  assert.notStrictEqual(refreshed.data.status, 'deferred', 'the deferral is gone');

  fake.state.infoStatus.set('route-example.com', { status: 'OK', transferStatus: 'Transfer completed', expiresAt: '2029-01-01' });
  const completed = await jsonFetch(base, { path: `/api/v1/admin/domain-services/transfers/${transfer.id}/refresh`, method: 'POST' }, admin);
  assert.strictEqual(completed.data.status, 'completed');
  assert.strictEqual(completed.data.completed, true);
  const linked = (await app.store.table('customer_domains').all()).filter((row) => row.user_id === userId);
  assert.strictEqual(linked.length, 1);
  assert.strictEqual(linked[0].domain, 'route-example.com');

  // 4. A registrar that goes down is reported as such, with the status left where it was.
  const other = await app.store.table('domain_transfers').insert({
    user_id: userId, domain_name: 'outage-example.com', status: 'transfer_in_progress',
    provider_id: providerId, provider_reference: null, provider_metadata: {},
  });
  fake.setOverride('POST /xml.response', { status: 502, text: 'bad gateway' });
  const outage = await jsonFetch(base, { path: `/api/v1/admin/domain-services/transfers/${other.id}/refresh`, method: 'POST' }, admin);
  assert.strictEqual(outage.status, 503, JSON.stringify(outage.data));
  assert.ok(outage.data.details?.failureCode ?? outage.data.failureCode, 'the failure code is exposed');
  assert.strictEqual((await app.store.table('domain_transfers').findById(other.id)).status, 'transfer_in_progress');
});

test('the visible adapter set decides which registrars can be configured at all', async () => {
  // The list the admin API advertises and the list `createDomainProviderAdapter` enforces must be
  // the same list, or an operator can create a row that refuses every call.
  assert.strictEqual(bareExtension('.COM'), 'com');
  assert.strictEqual(bareExtension('com'), 'com');
  assert.strictEqual(bareExtension(null), '');
});

// ============================================================================ availability, sourced

test('a connected registrar answers availability, and the row says so', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const fake = startFakeRegistrar();
  await fake.listen();
  t.after(() => fake.close());

  await register(base, 'av-admin@example.com', 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email: 'av-admin@example.com' });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'av-admin@example.com', password: 'SuperSecret123!' } });
  const admin = login.data.accessToken;

  const created = await jsonFetch(base, {
    path: '/api/v1/admin/domain-services/providers', method: 'POST',
    body: {
      providerKey: 'namecheap-av', name: 'Namecheap', adapterKey: 'namecheap', providerType: 'registrar',
      apiBaseUrl: fake.endpoint(), environment: 'sandbox',
    },
  }, admin);
  const providerId = created.data.provider.id;
  await jsonFetch(base, {
    path: `/api/v1/admin/domain-services/providers/${providerId}/credentials`, method: 'PUT',
    body: { credentials: { apiUser: 'ch247api', apiKey: 'live-key', userName: 'ch247api', clientIp: '203.0.113.9' } },
  }, admin);
  await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${providerId}/test`, method: 'POST' }, admin);

  // The registrar is the seller, so it answers for the searched name and its variants.
  fake.seedDomain('sourced-example.com', { available: false });
  fake.seedDomain('getsourced-example.com', { available: true, premium: true, premiumRegistrationPrice: 1999.0, premiumRenewalPrice: 1999.0 });

  const res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'sourced-example.com' } });
  assert.strictEqual(res.status, 200, JSON.stringify(res.data));
  assert.strictEqual(res.data.answerSource, 'registrar', 'the answer says who gave it');
  assert.strictEqual(res.data.providerKey, 'namecheap-av');
  assert.strictEqual(res.data.estimate, false);

  const taken = res.data.results.find((row) => row.domain === 'sourced-example.com');
  assert.strictEqual(taken.status, 'registered');
  assert.strictEqual(taken.available, false);
  assert.strictEqual(taken.source, 'registrar');
  assert.strictEqual(taken.confidence, 'confirmed');

  const free = res.data.results.find((row) => row.domain === 'getsourced-example.com');
  assert.strictEqual(free.status, 'available');
  assert.strictEqual(free.available, true);
  assert.strictEqual(free.source, 'registrar');
  assert.strictEqual(free.confidence, 'confirmed', "a registrar's availability answer settles the question");
  assert.strictEqual(free.premium, true);
  // The registrar's quote is labelled as its quote: the platform's selling price lives on the
  // extension, and a row that blurred the two would show a price nobody agreed to charge.
  assert.strictEqual(free.providerQuote.registration.amount, '1999.00');

  const third = res.data.results.find((row) => row.domain === 'trysourced-example.com');
  assert.strictEqual(third.status, 'unknown', 'an unseeded name was not answered by the fake');
  assert.strictEqual(third.available, null);
  assert.strictEqual(third.source, 'registrar', 'the row still says which provider could not answer');
  assert.strictEqual(third.reason, 'REGISTRAR_DID_NOT_ANSWER');
});

test('a registrar outage falls back to the registry, and the fallback is labelled', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const registrar = startFakeRegistrar();
  await registrar.listen();
  t.after(() => registrar.close());
  const registry = startFakeRegistry();
  const { baseUrl: registryUrl } = await registry.listen();
  t.after(() => registry.close());

  await register(base, 'fallback-admin@example.com', 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email: 'fallback-admin@example.com' });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'fallback-admin@example.com', password: 'SuperSecret123!' } });
  const admin = login.data.accessToken;

  const created = await jsonFetch(base, {
    path: '/api/v1/admin/domain-services/providers', method: 'POST',
    body: {
      providerKey: 'namecheap-fallback', name: 'Namecheap', adapterKey: 'namecheap', providerType: 'registrar',
      apiBaseUrl: registrar.endpoint(), environment: 'sandbox',
    },
  }, admin);
  const providerId = created.data.provider.id;
  await jsonFetch(base, {
    path: `/api/v1/admin/domain-services/providers/${providerId}/credentials`, method: 'PUT',
    body: { credentials: { apiUser: 'ch247api', apiKey: 'live-key', userName: 'ch247api', clientIp: '203.0.113.9' } },
  }, admin);
  await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${providerId}/test`, method: 'POST' }, admin);

  const rdap = await jsonFetch(base, {
    path: '/api/v1/admin/domain-services/providers', method: 'POST',
    body: { providerKey: 'rdap-fallback', name: 'Public RDAP', adapterKey: 'rdap', providerType: 'rdap', apiBaseUrl: registryUrl, environment: 'sandbox' },
  }, admin);
  await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${rdap.data.provider.id}/test`, method: 'POST' }, admin);

  registry.seedDomain('happens-to-be-taken.com');

  // The registrar answers, so its answer is used — the registry is not consulted behind its back.
  registrar.seedDomain('happens-to-be-taken.com', { available: false });
  let res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'happens-to-be-taken.com' } });
  assert.strictEqual(res.data.answerSource, 'registrar');
  assert.strictEqual(registry.requestsFor('/rdap/domain/happens-to-be-taken.com').length, 0, 'the registry was not asked');

  // Now the registrar is out. The registry can still answer, and the row says the answer is the
  // registry's — a fallback that hid its own downgrade would be worse than no fallback.
  registrar.setOverride('POST /xml.response', { status: 500, text: 'registrar down' });
  res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'happens-to-be-taken.com' } });
  assert.strictEqual(res.data.answerSource, 'rdap');
  assert.strictEqual(res.data.status, 'live', 'a fallback still produced a live answer');
  const row = res.data.results.find((entry) => entry.domain === 'happens-to-be-taken.com');
  assert.strictEqual(row.status, 'registered');
  assert.strictEqual(row.source, 'rdap');
});

test('when nothing can answer, the search refuses and names no source', async (t) => {
  const harness = await startServer({ JWT_SECRET });
  const { base, app, close } = harness;
  t.after(() => close());

  const registrar = startFakeRegistrar();
  await registrar.listen();
  t.after(() => registrar.close());

  await register(base, 'nothing-admin@example.com', 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email: 'nothing-admin@example.com' });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, { path: '/api/v1/auth/login', method: 'POST', body: { email: 'nothing-admin@example.com', password: 'SuperSecret123!' } });
  const admin = login.data.accessToken;

  const created = await jsonFetch(base, {
    path: '/api/v1/admin/domain-services/providers', method: 'POST',
    body: {
      providerKey: 'namecheap-alone', name: 'Namecheap', adapterKey: 'namecheap', providerType: 'registrar',
      apiBaseUrl: registrar.endpoint(), environment: 'sandbox',
    },
  }, admin);
  await jsonFetch(base, {
    path: `/api/v1/admin/domain-services/providers/${created.data.provider.id}/credentials`, method: 'PUT',
    body: { credentials: { apiUser: 'ch247api', apiKey: 'live-key', userName: 'ch247api', clientIp: '203.0.113.9' } },
  }, admin);
  await jsonFetch(base, { path: `/api/v1/admin/domain-services/providers/${created.data.provider.id}/test`, method: 'POST' }, admin);

  // A connected registrar and no registry: the registrar is down, so there is nothing left to ask.
  registrar.setOverride('POST /xml.response', { status: 502, text: 'registrar down' });
  const res = await jsonFetch(base, { path: '/api/v1/domain-services/search', method: 'POST', body: { query: 'nobody-can-answer.com' } });
  assert.strictEqual(res.data.status, 'provider_unavailable');
  assert.strictEqual(res.data.answerSource, null);
  assert.strictEqual(res.data.failure.code, 'PROVIDER_UNAVAILABLE');
  for (const row of res.data.results) {
    assert.strictEqual(row.available, null, 'no provider answered, so no row is answered');
    assert.strictEqual(row.source, null);
  }
});
