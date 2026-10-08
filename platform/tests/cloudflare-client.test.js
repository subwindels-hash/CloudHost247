/**
 * Cloudflare client — unit behaviour and wire contracts.
 *
 * The wire half runs against `tests/fixtures/fake-cloudflare.js` over a real loopback socket, so the
 * assertions read the actual requests the client would put on the network (URL, method, bearer header,
 * JSON body) and the client's handling of each answer shape Cloudflare really produces — including the
 * two that matter most: an error envelope delivered with HTTP 200, and an `errors` array from GraphQL.
 *
 * The fail-closed half asserts something a mocked transport cannot: that **no request is made at all**
 * when the deployment cannot possibly authenticate.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { startFakeCloudflare } = require('./fixtures/fake-cloudflare');
const {
  createCloudflareClient,
  CloudflareError,
  cloudflareErrorToHttpError,
  resolveAccountCredential,
  normalizeZone,
  normalizeDnsRecord,
  DEFAULT_BASE_URL,
} = require('../src/lib/cloudflare-client');
const { encryptSecret, decryptSecret, describeSecret, PURPOSES } = require('../src/lib/secret-box');

const SECRET = 'unit-test-secret-that-is-long-enough';
const TOKEN = 'cf-test-token-abcdefghijklmnop';

function account(overrides = {}) {
  return {
    id: 'acct-row-1',
    account_name: 'Primary',
    cloudflare_account_id: 'acct-1',
    encrypted_api_token: encryptSecret(SECRET, PURPOSES.cloudflareAccount, TOKEN),
    ...overrides,
  };
}

test('cloudflare secret box: encrypt/decrypt, tamper, purpose separation', async (t) => {
  await t.test('a value round-trips and never appears in the envelope', () => {
    const envelope = encryptSecret(SECRET, PURPOSES.cloudflareAccount, TOKEN);
    assert.ok(!envelope.includes(TOKEN), 'the plaintext must not appear in the stored value');
    assert.match(envelope, /^v1:[^:]+:[^:]+:[^:]+$/);
    assert.strictEqual(decryptSecret(SECRET, PURPOSES.cloudflareAccount, envelope), TOKEN);
    assert.deepStrictEqual(describeSecret(SECRET, PURPOSES.cloudflareAccount, envelope), { state: 'readable', version: 'v1' });
  });

  await t.test('an empty value is refused rather than encrypted into a credential that authenticates nothing', () => {
    assert.throws(() => encryptSecret(SECRET, PURPOSES.cloudflareAccount, ''), /refusing to encrypt an empty value/);
    assert.throws(() => encryptSecret(SECRET, PURPOSES.cloudflareAccount, null), /refusing to encrypt an empty value/);
  });

  await t.test('a tampered tag yields null, not a corrupt credential', () => {
    const envelope = encryptSecret(SECRET, PURPOSES.cloudflareAccount, TOKEN);
    const [version, iv, tag, data] = envelope.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    const tampered = [version, iv, tag, flipped.toString('base64')].join(':');
    assert.strictEqual(decryptSecret(SECRET, PURPOSES.cloudflareAccount, tampered), null);
    assert.strictEqual(describeSecret(SECRET, PURPOSES.cloudflareAccount, tampered).state, 'unreadable');
  });

  await t.test('a different purpose cannot open the envelope, so one feature key cannot read another feature credential', () => {
    const envelope = encryptSecret(SECRET, PURPOSES.cloudflareAccount, TOKEN);
    assert.strictEqual(decryptSecret(SECRET, PURPOSES.domainProvider, envelope), null);
    assert.strictEqual(describeSecret(SECRET, PURPOSES.domainProvider, envelope).state, 'unreadable');
  });

  await t.test('a rotated master secret reads as unreadable rather than as "nothing stored"', () => {
    const envelope = encryptSecret(SECRET, PURPOSES.cloudflareAccount, TOKEN);
    assert.strictEqual(describeSecret('a-completely-different-master-secret', PURPOSES.cloudflareAccount, envelope).state, 'unreadable');
    assert.strictEqual(describeSecret(SECRET, PURPOSES.cloudflareAccount, null).state, 'none');
  });

  await t.test('a foreign envelope format is refused, not guessed at', () => {
    assert.strictEqual(decryptSecret(SECRET, PURPOSES.cloudflareAccount, 'v2:aa:bb:cc'), null);
    assert.strictEqual(decryptSecret(SECRET, PURPOSES.cloudflareAccount, 'not-an-envelope'), null);
  });
});

test('cloudflare client: fail-closed paths make no request', async (t) => {
  const fake = startFakeCloudflare();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  await t.test('no stored token is a configuration answer naming the reason', async () => {
    const client = createCloudflareClient({ account: { id: 'a', account_name: 'Empty' }, secret: SECRET, config: {} });
    await assert.rejects(
      () => client.verifyToken(),
      (error) => {
        assert.ok(error instanceof CloudflareError);
        assert.strictEqual(error.code, 'CLOUDFLARE_NOT_CONFIGURED');
        assert.match(error.message, /no Cloudflare API token is stored/);
        return true;
      },
    );
    assert.strictEqual(fake.state.requests.length, 0, 'a fail-closed path must not touch the network');
  });

  await t.test('an unreadable token says so and names the fix, instead of looking like an outage', async () => {
    const client = createCloudflareClient({
      account: { id: 'a', encrypted_api_token: encryptSecret('a-different-master-secret', PURPOSES.cloudflareAccount, TOKEN) },
      secret: SECRET, config: {},
    });
    await assert.rejects(() => client.verifyToken(), /could not be decrypted/);
    assert.strictEqual(fake.state.requests.length, 0);
  });

  await t.test('a non-HTTPS base URL is refused before the token can be sent in plaintext', async () => {
    const client = createCloudflareClient({
      account: account({ api_base_url: 'http://cloudflare.example.com/client/v4' }),
      secret: SECRET, config: {},
    });
    await assert.rejects(
      () => client.verifyToken(),
      (error) => {
        assert.strictEqual(error.code, 'CLOUDFLARE_INSECURE_BASE_URL');
        return true;
      },
    );
    assert.strictEqual(fake.state.requests.length, 0);
  });

  await t.test('resolveAccountCredential honours a legacy plaintext column read-only, and reports absence otherwise', () => {
    assert.strictEqual(resolveAccountCredential(SECRET, { api_token: 'legacy-token' }).source, 'legacy-plaintext');
    assert.match(resolveAccountCredential(SECRET, { id: 'x' }).reason, /no Cloudflare API token is stored/);
    assert.match(resolveAccountCredential(SECRET, null).reason, /no account is configured/);
  });
});

test('cloudflare client: wire contracts over a real socket', async (t) => {
  const fake = startFakeCloudflare();
  const { baseUrl } = await fake.listen();
  t.after(() => fake.close());

  const calls = [];
  const client = () => createCloudflareClient({
    account: account({ api_base_url: baseUrl }),
    secret: SECRET,
    config: {},
    onCall: (entry) => calls.push(entry),
  });

  await t.test('verifyToken sends the bearer header and maps the verdict', async () => {
    const verdict = await client().verifyToken();
    assert.deepStrictEqual(verdict, { active: true, status: 'active', tokenId: 'token-id-1' });
    const [request] = fake.requestsFor('/user/tokens/verify');
    assert.strictEqual(request.method, 'GET');
    assert.strictEqual(request.authorization, `Bearer ${TOKEN}`);
  });

  await t.test('a token Cloudflare reports as inactive is not rounded to a boolean success', async () => {
    const inactive = startFakeCloudflare({ tokenStatus: 'disabled' });
    const { baseUrl: inactiveUrl } = await inactive.listen();
    try {
      const verdict = await createCloudflareClient({ account: account({ api_base_url: inactiveUrl }), secret: SECRET, config: {} }).verifyToken();
      // The token id is Cloudflare's own answer, so it is reported verbatim; what must NOT be rounded
      // is `active`, which is false here.
      assert.deepStrictEqual(verdict, { active: false, status: 'disabled', tokenId: 'token-id-1' });
    } finally {
      await inactive.close();
    }
  });

  await t.test('an error envelope carried by HTTP 200 is a failure, and the message stays server-side', async () => {
    const hostile = startFakeCloudflare({
      token: 'other-token',
      failures: {},
    });
    const { baseUrl: hostileUrl } = await hostile.listen();
    try {
      const c = createCloudflareClient({ account: account({ api_base_url: hostileUrl }), secret: SECRET, config: {} });
      await assert.rejects(
        () => c.verifyToken(),
        (error) => {
          assert.strictEqual(error.code, 'CLOUDFLARE_AUTHENTICATION_FAILED');
          assert.deepStrictEqual(error.providerCodes, [10000]);
          assert.deepStrictEqual(error.providerMessages, ['Authentication error']);
          // The browser-facing sentence is the platform's own, never Cloudflare's words.
          assert.ok(!error.message.includes('Authentication error'));
          return true;
        },
      );
    } finally {
      await hostile.close();
    }
  });

  await t.test('Cloudflare codes decide the classification, because a bad token arrives as HTTP 400 as often as 401', async () => {
    const reader = startFakeCloudflare();
    const { baseUrl: readerUrl } = await reader.listen();
    try {
      const c = createCloudflareClient({ account: account({ api_base_url: readerUrl }), secret: SECRET, config: {} });
      await assert.rejects(
        () => c.getZone('no-such-zone'),
        (error) => {
          assert.strictEqual(error.code, 'CLOUDFLARE_NOT_FOUND');
          assert.deepStrictEqual(error.providerCodes, [1049]);
          return true;
        },
      );
    } finally {
      await reader.close();
    }
  });

  await t.test('rate limiting and outages stay retryable; a rejection does not', async () => {
    for (const [status, code, retryable] of [[429, 'CLOUDFLARE_RATE_LIMITED', true], [503, 'CLOUDFLARE_UNAVAILABLE', true], [400, 'CLOUDFLARE_REJECTED', false]]) {
      const failures = { 'GET /zones/zone-x': { status, code: 9999, message: 'forced' } };
      const scoped = startFakeCloudflare({ failures });
      const { baseUrl: scopedUrl } = await scoped.listen();
      try {
        const c = createCloudflareClient({ account: account({ api_base_url: scopedUrl }), secret: SECRET, config: {} });
        await assert.rejects(
          () => c.getZone('zone-x'),
          (error) => {
            assert.strictEqual(error.code, code);
            assert.strictEqual(error.retryable, retryable);
            return true;
          },
        );
      } finally {
        await scoped.close();
      }
    }
  });

  await t.test('a slow Cloudflare becomes a retryable timeout rather than an unhandled abort', async () => {
    const slow = startFakeCloudflare({ delayMs: 60 });
    const { baseUrl: slowUrl } = await slow.listen();
    try {
      const c = createCloudflareClient({ account: account({ api_base_url: slowUrl }), secret: SECRET, config: {}, timeoutMs: 15 });
      await assert.rejects(
        () => c.verifyToken(),
        (error) => {
          assert.strictEqual(error.code, 'CLOUDFLARE_TIMEOUT');
          assert.strictEqual(error.retryable, true);
          return true;
        },
      );
    } finally {
      await slow.close();
    }
  });

  await t.test('an unreachable host is classified, not leaked as a raw fetch error', async () => {
    // Port 1 on loopback: loopback is allowed over http by the base-URL rule, and nothing listens.
    const c = createCloudflareClient({ account: account({ api_base_url: 'http://127.0.0.1:1' }), secret: SECRET, config: {} });
    await assert.rejects(
      () => c.verifyToken(),
      (error) => {
        assert.strictEqual(error.code, 'CLOUDFLARE_UNAVAILABLE');
        assert.strictEqual(error.retryable, true);
        return true;
      },
    );
  });

  await t.test('DNS records: create/update/delete speak the documented URLs and bodies', async () => {
    fake.seedZone({ id: 'zone-dns', name: 'example.com' });
    const c = client();

    const created = await c.createDnsRecord('zone-dns', { type: 'A', name: 'www.example.com', content: '203.0.113.10', ttl: 300, proxied: true });
    assert.strictEqual(created.id, 'rec-0001');
    assert.strictEqual(created.ownership, 'CUSTOMER_MANAGED');
    const createRequest = fake.state.requests.find((r) => r.method === 'POST' && r.path === '/zones/zone-dns/dns_records');
    assert.deepStrictEqual(createRequest.body, { type: 'A', name: 'www.example.com', content: '203.0.113.10', ttl: 300, proxied: true });
    assert.strictEqual(createRequest.contentType, 'application/json');

    const updated = await c.updateDnsRecord('zone-dns', created.id, { content: '203.0.113.11' });
    assert.strictEqual(updated.content, '203.0.113.11');
    assert.strictEqual(fake.state.requests.find((r) => r.method === 'PATCH' && r.path.endsWith(created.id)).body.content, '203.0.113.11');

    const deleted = await c.deleteDnsRecord('zone-dns', created.id);
    assert.deepStrictEqual(deleted, { deleted: true, id: created.id });
  });

  await t.test('a record Cloudflare reports as integration-managed stays system-managed', async () => {
    fake.seedZone({ id: 'zone-sys', name: 'sys.example.com' });
    // Cloudflare marks integration-created records itself; the client must read that marker rather
    // than decide ownership from the fact that a row exists locally.
    await store_record(fake, 'zone-sys', { id: 'sys-1', type: 'A', name: 'sys.example.com', content: '203.0.113.20', ttl: 1, proxied: true, source: 'cloudflare' });
    const listed = await client().listDnsRecords('zone-sys');
    assert.strictEqual(listed.items[0].ownership, 'SYSTEM_MANAGED');
  });

  await t.test('listing walks every page, and says so when the bound is reached', async () => {
    fake.seedZone({ id: 'zone-pages', name: 'pages.example.com' });
    const c = client();
    for (let index = 0; index < 150; index += 1) {
      await store_record(fake, 'zone-pages', { id: `bulk-${index}`, type: 'A', name: `h${index}.pages.example.com`, content: '203.0.113.1', ttl: 1, proxied: false });
    }
    const page = await c.listDnsRecords('zone-pages');
    assert.strictEqual(page.items.length, 150);
    assert.strictEqual(page.truncated, false);
  });

  await t.test('settings read as a map, and a write sends the value Cloudflare expects', async () => {
    fake.seedZone({ id: 'zone-settings', name: 'settings.example.com' });
    fake.state.settings.set('zone-settings', { ssl: 'flexible', development_mode: 'off' });
    const c = client();
    const settings = await c.listZoneSettings('zone-settings');
    assert.strictEqual(settings.ssl.value, 'flexible');
    const patched = await c.patchZoneSetting('zone-settings', 'ssl', 'strict');
    assert.deepStrictEqual(patched, { id: 'ssl', value: 'strict' });
    assert.deepStrictEqual(fake.state.requests.find((r) => r.method === 'PATCH' && r.path === '/zones/zone-settings/settings/ssl').body, { value: 'strict' });
  });

  await t.test('access rules create/update/delete carry the configuration object Cloudflare documents', async () => {
    fake.seedZone({ id: 'zone-rules', name: 'rules.example.com' });
    const c = client();
    const created = await c.createAccessRule('zone-rules', { mode: 'block', target: 'ip', value: '203.0.113.5', notes: 'bad actor' });
    assert.strictEqual(created.mode, 'block');
    assert.strictEqual(created.target, 'ip');
    const request = fake.state.requests.find((r) => r.method === 'POST' && r.path === '/zones/zone-rules/firewall/access_rules/rules');
    assert.deepStrictEqual(request.body, { mode: 'block', notes: 'bad actor', configuration: { target: 'ip', value: '203.0.113.5' } });
    const updated = await c.updateAccessRule('zone-rules', created.id, { mode: 'challenge' });
    assert.strictEqual(updated.mode, 'challenge');
    assert.deepStrictEqual(await c.deleteAccessRule('zone-rules', created.id), { deleted: true, id: created.id });
  });

  await t.test('DNSSEC returns the DS record a registrar needs, and the enable/disable verbs are distinct', async () => {
    fake.seedZone({ id: 'zone-dnssec', name: 'dnssec.example.com' });
    const c = client();
    const enabled = await c.enableDnssec('zone-dnssec');
    assert.strictEqual(enabled.status, 'pending');
    assert.ok(enabled.ds.includes('IN DS'));
    const read = await c.getDnssec('zone-dnssec');
    assert.strictEqual(read.keyTag, 2371);
    assert.ok(read.ds.startsWith('example.com.'));
    const disabled = await c.disableDnssec('zone-dnssec');
    assert.strictEqual(disabled.status, 'disabled');
    const methods = fake.state.requests.filter((r) => r.path === '/zones/zone-dnssec/dnssec').map((r) => r.method);
    assert.deepStrictEqual(methods, ['POST', 'GET', 'PATCH']);
  });

  await t.test('purge accepts exactly one target, validated before egress', async () => {
    fake.seedZone({ id: 'zone-purge', name: 'purge.example.com' });
    const c = client();
    await assert.rejects(() => c.purgeCache('zone-purge', {}), /one target/);
    await assert.rejects(() => c.purgeCache('zone-purge', { everything: true, files: ['https://purge.example.com/a.css'] }), /exactly one purge target/);
    const before = fake.state.requests.filter((r) => r.path === '/zones/zone-purge/purge_cache').length;
    assert.strictEqual(before, 0, 'a rejected purge must not reach Cloudflare');
    const outcome = await c.purgeCache('zone-purge', { files: ['https://purge.example.com/a.css'] });
    assert.strictEqual(outcome.purged, true);
    assert.deepStrictEqual(fake.state.purges[0].body, { files: ['https://purge.example.com/a.css'] });
  });

  await t.test('analytics sum Cloudflare\'s series, keep absent days null and count them', async () => {
    fake.seedZone({ id: 'zone-analytics', name: 'analytics.example.com' });
    const analytics = await client().zoneAnalytics('zone-analytics', { days: 3 });
    assert.strictEqual(analytics.timeseries.length, 3);
    assert.strictEqual(analytics.timeseries[0].requests, 100);
    assert.strictEqual(analytics.timeseries[2].requests, null, 'a day with no datapoints stays null, never zero');
    assert.strictEqual(analytics.missingDays, 1);
    assert.strictEqual(analytics.totals.requests, 100 + 101);
    assert.strictEqual(analytics.totals.bandwidth, 1000 + 1001);
    const request = fake.state.requests.find((r) => r.path === '/graphql');
    assert.strictEqual(request.body.variables.zoneTag, 'zone-analytics');
  });

  await t.test('a GraphQL errors array is a failure, not an empty dashboard', async () => {
    const broken = startFakeCloudflare({ graphqlErrors: true });
    const { baseUrl: brokenUrl } = await broken.listen();
    try {
      const c = createCloudflareClient({ account: account({ api_base_url: brokenUrl }), secret: SECRET, config: {} });
      await assert.rejects(() => c.zoneAnalytics('zone-anything'), (error) => {
        assert.ok(['CLOUDFLARE_REJECTED', 'CLOUDFLARE_UNAVAILABLE'].includes(error.code));
        return true;
      });
    } finally {
      await broken.close();
    }
  });

  await t.test('the call record carries timing and outcome, never the credential', async () => {
    fake.seedZone({ id: 'zone-logged', name: 'logged.example.com' });
    calls.length = 0;
    await client().getZone('zone-logged');
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(Object.keys(calls[0]).sort(), ['accountId', 'durationMs', 'errorCode', 'method', 'path', 'statusCode', 'success'].sort());
    assert.strictEqual(calls[0].success, true);
    assert.strictEqual(calls[0].path, '/zones/zone-logged');
    assert.ok(!JSON.stringify(calls).includes(TOKEN));

    calls.length = 0;
    await assert.rejects(() => client().getZone('zone-missing'));
    assert.strictEqual(calls[0].success, false);
    assert.strictEqual(calls[0].errorCode, 'CLOUDFLARE_NOT_FOUND');
  });

  await t.test('a failing observer cannot fail the operation it observes', async () => {
    const c = createCloudflareClient({
      account: account({ api_base_url: baseUrl }), secret: SECRET, config: {},
      onCall: () => { throw new Error('log sink is down'); },
    });
    const zone = await c.getZone('zone-dns');
    assert.strictEqual(zone.id, 'zone-dns');
  });
});

test('cloudflare: HTTP mapping and normalisers', async (t) => {
  await t.test('each failure code maps to one status, and Cloudflare codes ride in details', () => {
    assert.strictEqual(cloudflareErrorToHttpError(new CloudflareError('CLOUDFLARE_NOT_CONFIGURED', 'x')).statusCode, 400);
    assert.strictEqual(cloudflareErrorToHttpError(new CloudflareError('CLOUDFLARE_CREDENTIAL_UNREADABLE', 'x')).statusCode, 400);
    assert.strictEqual(cloudflareErrorToHttpError(new CloudflareError('CLOUDFLARE_AUTHENTICATION_FAILED', 'x')).statusCode, 503);
    assert.strictEqual(cloudflareErrorToHttpError(new CloudflareError('CLOUDFLARE_FORBIDDEN', 'x')).statusCode, 403);
    assert.strictEqual(cloudflareErrorToHttpError(new CloudflareError('CLOUDFLARE_NOT_FOUND', 'x')).statusCode, 404);
    assert.strictEqual(cloudflareErrorToHttpError(new CloudflareError('CLOUDFLARE_RATE_LIMITED', 'x')).statusCode, 503);
    const rejected = cloudflareErrorToHttpError(new CloudflareError('CLOUDFLARE_REJECTED', 'x', { providerCodes: [81057] }));
    assert.strictEqual(rejected.statusCode, 400);
    assert.deepStrictEqual(rejected.details, { cloudflareErrorCodes: [81057] });
  });

  await t.test('an HttpError from a readiness guard passes through untouched', () => {
    const { ValidationError } = require('../src/core/errors');
    const original = new ValidationError('No active Cloudflare account is configured');
    assert.strictEqual(cloudflareErrorToHttpError(original), original);
  });

  await t.test('zone activation is derived from Cloudflare\'s own status, never assumed', () => {
    assert.strictEqual(normalizeZone({ id: 'z', status: 'active' }).activationStatus, 'active');
    assert.strictEqual(normalizeZone({ id: 'z', status: 'pending' }).activationStatus, 'pending');
    assert.strictEqual(normalizeZone({ id: 'z', status: 'deactivated' }).activationStatus, 'pending');
    assert.strictEqual(normalizeZone({}).activationStatus, 'pending');
  });

  await t.test('record ownership is read from Cloudflare, not from the row existing locally', () => {
    assert.strictEqual(normalizeDnsRecord({ id: 'r' }).ownership, 'CUSTOMER_MANAGED');
    assert.strictEqual(normalizeDnsRecord({ id: 'r', source: 'cloudflare' }).ownership, 'SYSTEM_MANAGED');
    assert.strictEqual(normalizeDnsRecord({ id: 'r', meta: { managed_by_apps: true } }).ownership, 'SYSTEM_MANAGED');
  });

  await t.test('the default base URL is Cloudflare\'s, and a per-account override wins', () => {
    assert.strictEqual(DEFAULT_BASE_URL, 'https://api.cloudflare.com/client/v4');
    const c = createCloudflareClient({ account: account({ api_base_url: 'https://staging.example.com/client/v4' }), secret: SECRET, config: {} });
    assert.strictEqual(c.baseUrl(), 'https://staging.example.com/client/v4');
  });
});

/** Push a record straight into the fake's state, bypassing the API (fixture setup, not a client call). */
function store_record(fake, zoneId, record) {
  const list = fake.state.records.get(zoneId) ?? [];
  list.push(record);
  fake.state.records.set(zoneId, list);
  return Promise.resolve();
}
