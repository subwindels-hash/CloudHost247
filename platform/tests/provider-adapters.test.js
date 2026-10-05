/**
 * Provider egress layer: real adapters, real HTTP, no credentials and no egress.
 *
 * Each test starts a loopback HTTP server that plays the part of a provider API and records exactly
 * what the adapter sent. That way the wire contract — method, path, authorization header, body shape,
 * form encoding, signing — is verified end to end without a provider account, and every refusal path
 * (missing credentials, plaintext base URL, unsupported operation, timeout, provider error) is
 * exercised against the same code a deployment runs.
 *
 * What is deliberately NOT claimed here: no call has ever been made to a real provider from this
 * environment, so provider-side acceptance of these requests is unverified. What is verified is the
 * request the adapter constructs, the response it understands, and the failure it reports.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createHash } = require('node:crypto');

const providers = require('../src/lib/providers');
const { ADAPTER_KINDS } = require('../src/lib/provider-adapters');

/**
 * A fake provider API. `routes` maps `METHOD /path` to a handler that returns
 * `{ status?, body?, delayMs? }`; every request is recorded with its headers and raw body.
 */
async function startFakeProvider(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const record = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(record);
      const bare = req.url.split('?')[0];
      const entry = routes[`${req.method} ${bare}`]
        ?? routes[`${req.method} ${decodeURIComponent(bare)}`]
        ?? routes[`${req.method} ${req.url}`];
      const result = typeof entry === 'function' ? entry(record) : entry;
      const send = () => {
        if (result === undefined || result === null) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ message: 'not found' }));
          return;
        }
        res.writeHead(result.status ?? 200, { 'content-type': 'application/json' });
        res.end(result.body === undefined ? '{}' : JSON.stringify(result.body));
      };
      if (result && result.delayMs) setTimeout(send, result.delayMs);
      else send();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function providerRow(adapter, baseUrl, extra = {}) {
  return {
    id: 'prov-1', name: `${adapter} provider`, slug: adapter, adapter,
    api_base_url: baseUrl, credential_env_prefix: null, config: {}, metadata: {}, ...extra,
  };
}

const source = (values) => ({ NODE_ENV: 'test', ...values });

test('provider adapters: the registry, the wire contracts and the refusals', async (t) => {
  await t.test('every known adapter kind resolves to an implementation or a named gap', async () => {
    assert.deepStrictEqual(
      [...providers.IMPLEMENTED_ADAPTERS, ...providers.PENDING_ADAPTERS].sort(),
      [...ADAPTER_KINDS].sort(),
      'the implemented and pending lists together must cover exactly the profiles this build knows',
    );

    for (const kind of providers.IMPLEMENTED_ADAPTERS) {
      const adapter = providers.createInfrastructureProviderAdapter(providerRow(kind, null));
      assert.strictEqual(adapter.kind, kind);
      assert.strictEqual(typeof adapter.healthCheck, 'function');
      assert.strictEqual(typeof adapter.createServer, 'function');
    }

    for (const kind of providers.PENDING_ADAPTERS) {
      const adapter = providers.createInfrastructureProviderAdapter(providerRow(kind, null));
      await assert.rejects(
        () => adapter.healthCheck('1', {}),
        (err) => {
          assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION', 'retrying cannot help, so it must not be SERVICE_UNAVAILABLE');
          assert.match(err.message, /not ported into this CloudHost247 build/);
          assert.strictEqual(err.message.includes(kind), true, 'the refusal names the missing adapter');
          return true;
        },
      );
      for (const method of ['createServer', 'getServerStatus', 'getConsole']) {
        await assert.rejects(() => adapter[method](), (err) => err.code === 'UNSUPPORTED_OPERATION');
      }
    }

    const unknown = providers.createInfrastructureProviderAdapter(providerRow('nope', null));
    await assert.rejects(() => unknown.validateConfiguration(), (err) => {
      assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION');
      assert.match(err.message, /No native adapter is implemented/);
      return true;
    });
  });

  await t.test('credentials are refused, never defaulted, and plaintext base URLs are refused', async () => {
    const hetzner = providers.createInfrastructureProviderAdapter(providerRow('hetzner', null), { source: source({}) });
    await assert.rejects(() => hetzner.validateConfiguration(), (err) => {
      assert.strictEqual(err.code, 'PROVIDER_NOT_CONFIGURED');
      assert.match(err.message, /API token is not configured/);
      return true;
    });

    const bridge = providers.createInfrastructureProviderAdapter(
      providerRow('generic_http', 'http://provider.example.com', { credential_env_prefix: 'PROVIDER_BRIDGE' }),
      { source: source({ PROVIDER_BRIDGE_API_TOKEN: 'bridge-token' }) },
    );
    await assert.rejects(() => bridge.validateConfiguration(), (err) => {
      assert.strictEqual(err.code, 'INVALID_CONFIGURATION');
      assert.match(err.message, /must use https/);
      return true;
    });

    // A token without a base URL is a configuration error, not a request to some default host.
    const noUrl = providers.createInfrastructureProviderAdapter(
      providerRow('generic_http', null, { credential_env_prefix: 'PROVIDER_BRIDGE' }), {
      source: source({ PROVIDER_BRIDGE_API_TOKEN: 'bridge-token' }),
    });
    await assert.rejects(() => noUrl.validateConfiguration(), (err) => err.code === 'PROVIDER_NOT_CONFIGURED');
  });

  await t.test('hetzner: idempotent create, lookup before create, and error classification', async () => {
    let created = false;
    const fake = await startFakeProvider({
      // A real provider would answer the label lookup with the server it already created.
      'GET /servers': () => ({
        body: { servers: created ? [{ id: 42, name: 'ch247-job', status: 'running', public_net: { ipv4: { ip: '203.0.113.7' } }, image: { id: 9 } }] : [] },
      }),
      'POST /servers': (request) => {
        const body = JSON.parse(request.body);
        created = true;
        return { body: { server: { id: 42, name: body.name, status: 'running', labels: body.labels, public_net: { ipv4: { ip: '203.0.113.7' } }, image: { id: 9, name: 'debian-12' } } } };
      },
      'GET /servers/42': { body: { server: { id: 42, name: 'ch247-job', status: 'running', public_net: { ipv4: { ip: '203.0.113.7' } }, image: { id: 9 } } } },
      'GET /servers/404': { status: 404, body: { error: { message: 'server not found' } } },
      'GET /servers/500': { status: 500, body: { error: { message: 'internal provider failure' } } },
    });

    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('hetzner', fake.base),
        { source: source({ HETZNER_API_TOKEN: 'hetzner-secret-token' }) },
      );

      const created = await adapter.createServer({
        idempotencyKey: 'job-1', name: 'ch247-job', hostname: 'job.example.com', architecture: 'x86_64',
        image: { providerImageId: '9' }, regionCode: 'fsn1', datacenterCode: null,
        planMetadata: { providerServerType: 'cx22' }, sshPublicKeys: [], userData: '#cloud-config',
      });
      assert.strictEqual(created.id, '42');
      assert.strictEqual(created.ipAddress, '203.0.113.7');
      assert.strictEqual(created.imageId, '9');

      const post = fake.requests.find((r) => r.method === 'POST');
      assert.strictEqual(post.url, '/servers');
      assert.strictEqual(post.headers.authorization, 'Bearer hetzner-secret-token');
      const body = JSON.parse(post.body);
      assert.strictEqual(body.labels.cloudhost247_idempotency, 'job-1');
      assert.strictEqual(body.server_type, 'cx22');
      assert.strictEqual(body.image, '9');
      assert.strictEqual(body.start_after_create, true);
      assert.strictEqual(body.location, 'fsn1');
      assert.strictEqual(JSON.stringify(fake.requests.map((r) => r.url)).includes('hetzner-secret-token'), false,
        'the credential is a header, never a query parameter');

      // The lookup really happens first and really asks the provider for the label.
      const lookup = fake.requests[0];
      assert.strictEqual(lookup.method, 'GET');
      assert.match(decodeURIComponent(lookup.url), /label_selector=cloudhost247_idempotency=job-1/);

      // A second create for the same key after the provider reports it: no second POST.
      fake.requests.length = 0;
      const again = await adapter.createServer({
        idempotencyKey: 'job-1', name: 'ch247-job', hostname: 'job.example.com', architecture: 'x86_64',
        image: { providerImageId: '9' }, regionCode: 'fsn1', datacenterCode: null,
        planMetadata: { providerServerType: 'cx22' }, sshPublicKeys: [], userData: '',
      });
      assert.strictEqual(again.id, '42');
      assert.strictEqual(fake.requests.filter((r) => r.method === 'POST').length, 0, 'idempotency lookup short-circuits the create');

      const status = await adapter.getServerStatus('42');
      assert.strictEqual(status.name, 'ch247-job');

      await assert.rejects(() => adapter.getServerStatus('404'), (err) => {
        assert.strictEqual(err.code, 'RESOURCE_NOT_FOUND');
        assert.strictEqual(err.retryable, false);
        return true;
      });

      await assert.rejects(() => adapter.getServerStatus('500'), (err) => {
        assert.strictEqual(err.code, 'NETWORK_TEMPORARY_FAILURE');
        assert.strictEqual(err.retryable, true);
        assert.strictEqual(err.providerResponse.status, 500);
        assert.deepStrictEqual(err.providerResponse.body, { error: { message: 'internal provider failure' } });
        // The provider's own words never reach the customer.
        const httpError = providers.providerErrorToHttpError(err);
        assert.strictEqual(httpError.statusCode, 503);
        assert.strictEqual(/internal provider failure/.test(httpError.message), false);
        return true;
      });
    } finally {
      await fake.close();
    }
  });

  await t.test('hetzner: rescue hands back the one-time password and never stores it', async () => {
    const fake = await startFakeProvider({
      'POST /servers/7/actions/enable_rescue': { body: { root_password: 'rescue-once-abc' } },
      'POST /servers/7/actions/reset': { body: { action: { id: 1, status: 'running' } } },
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('hetzner', fake.base),
        { source: source({ HETZNER_API_TOKEN: 't' }) },
      );
      const session = await adapter.enableRescue('7', { architecture: 'x86_64', providerSshKeyIds: ['k1'] });
      assert.deepStrictEqual(session, {
        type: 'linux64', username: 'root', password: 'rescue-once-abc', rebooted: true,
      });
      const rescueRequest = fake.requests[0];
      assert.strictEqual(JSON.parse(rescueRequest.body).ssh_keys[0], 'k1');
      assert.strictEqual(fake.requests[1].url, '/servers/7/actions/reset');
      // The adapter keeps nothing: the session it returned holds the only copy the caller sees.
      assert.strictEqual(JSON.stringify(adapter).includes('rescue-once-abc'), false);
    } finally {
      await fake.close();
    }
  });

  await t.test('digitalocean: create carries the idempotency tag and user-data', async () => {
    const fake = await startFakeProvider({
      'GET /droplets': { body: { droplets: [] } },
      'POST /droplets': (request) => ({ body: { droplet: JSON.parse(request.body) } }),
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('digitalocean', fake.base),
        { source: source({ DIGITALOCEAN_API_TOKEN: 'do-token' }) },
      );
      const droplet = await adapter.createServer({
        idempotencyKey: 'job/2 with spaces', name: 'ch247-job2', hostname: 'job2.example.com',
        architecture: 'x86_64', image: { providerImageId: 'debian-12-x64' }, regionCode: 'fra1',
        datacenterCode: null, planMetadata: { providerServerType: 's-1vcpu-1gb' },
        sshPublicKeys: ['ssh-ed25519 AAAA'], userData: '#cloud-config\nhostname: job2',
      });
      const body = JSON.parse(fake.requests.find((r) => r.method === 'POST').body);
      assert.strictEqual(body.region, 'fra1');
      assert.strictEqual(body.size, 's-1vcpu-1gb');
      assert.strictEqual(body.image, 'debian-12-x64');
      assert.strictEqual(body.tags[0], 'ch247_idempotency_job_2_with_spaces', 'the tag is sanitized for the provider');
      assert.deepStrictEqual(body.ssh_keys, ['ssh-ed25519 AAAA']);
      assert.strictEqual(body.ipv6, true);
      assert.strictEqual(droplet.status, 'unknown');
    } finally {
      await fake.close();
    }
  });

  await t.test('digitalocean: no console and no rescue, said out loud', async () => {
    const adapter = providers.createInfrastructureProviderAdapter(
      providerRow('digitalocean', 'http://127.0.0.1:9'),
      { source: source({ DIGITALOCEAN_API_TOKEN: 'do-token' }) },
    );
    await assert.rejects(() => adapter.getConsole('1'), (err) => {
      assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION');
      assert.match(err.message, /API v2 has no console operation/);
      return true;
    });
    await assert.rejects(() => adapter.enableRescue('1', {}), (err) => err.code === 'UNSUPPORTED_OPERATION');
  });

  await t.test('digitalocean: missing monitoring datapoints are reported, never zero-filled', async () => {
    const metric = (body) => ({ body });
    const fake = await startFakeProvider({
      'GET /monitoring/metrics/droplet/cpu': metric({ data: { result: [{ metric: { mode: 'idle' }, values: [[1, 100], [2, 160]] }, { metric: { mode: 'user' }, values: [[1, 10], [2, 40]] }] } }),
      'GET /monitoring/metrics/droplet/load_1': metric({ data: { result: [{ metric: { host_id: '1' }, values: [[1, 0.5], [2, 0.8]] }] } }),
      'GET /monitoring/metrics/droplet/load_5': metric({ data: { result: [] } }),
      'GET /monitoring/metrics/droplet/load_15': metric({ data: { result: [] } }),
      'GET /monitoring/metrics/droplet/memory_total': metric({ data: { result: [{ metric: {}, values: [[1, 1000], [2, 1000]] }] } }),
      'GET /monitoring/metrics/droplet/memory_available': metric({ data: { result: [{ metric: {}, values: [[1, 400], [2, 300]] }] } }),
      'GET /monitoring/metrics/droplet/filesystem_size': metric({ data: { result: [{ metric: { mountpoint: '/' }, values: [[1, 100]] }] } }),
      'GET /monitoring/metrics/droplet/filesystem_free': metric({ data: { result: [{ metric: { mountpoint: '/' }, values: [[1, 40]] }] } }),
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('digitalocean', fake.base),
        { source: source({ DIGITALOCEAN_API_TOKEN: 'do-token' }) },
      );
      const metrics = await adapter.getServerMetrics('123');
      // idle delta 60, user delta 30 → utilisation 33.33%.
      assert.strictEqual(metrics.metrics.cpuPercent, 33.33);
      assert.deepStrictEqual(metrics.metrics.cpuCounterDeltas, { idle: 60, user: 30 });
      assert.deepStrictEqual(metrics.metrics.load_1, { latest: 0.8, average: 0.65, maximum: 0.8, samples: 2 });
      assert.strictEqual(metrics.metrics.load_5, null);
      assert.strictEqual(metrics.metrics.memoryUsedPercent, 70);
      assert.deepStrictEqual(metrics.metrics.filesystems, [
        { labels: { mountpoint: '/' }, sizeBytes: 100, freeBytes: 40, usedPercent: 60 },
      ]);
      assert.deepStrictEqual(metrics.missing, ['load_5', 'load_15']);
      assert.match(metrics.missingReasons.load_5, /no datapoints/);
    } finally {
      await fake.close();
    }
  });

  await t.test('vultr: the console URL is read per call and a missing one is a real failure', async () => {
    const fake = await startFakeProvider({
      'GET /instances/1': { body: { instance: { id: '1', status: 'active', kvm: 'https://kvm.vultr.example/session-xyz' } } },
      'GET /instances/2': { body: { instance: { id: '2', status: 'stopped' } } },
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('vultr', fake.base),
        { source: source({ VULTR_API_KEY: 'vultr-key' }) },
      );
      const session = await adapter.getConsole('1');
      assert.deepStrictEqual(session, { url: 'https://kvm.vultr.example/session-xyz', type: 'novnc' });
      await assert.rejects(() => adapter.getConsole('2'), (err) => {
        assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
        assert.strictEqual(err.retryable, true);
        assert.match(err.message, /no KVM console URL/);
        return true;
      });
    } finally {
      await fake.close();
    }
  });

  await t.test('vultr: rescue attaches the SystemRescue ISO and reboots, or refuses for arm64', async () => {
    const isos = {
      public_isos: [
        { id: 'iso-x86', name: 'SystemRescue', description: 'x86_64 rescue' },
        { id: 'iso-arm', name: 'SystemRescue ARM', description: 'aarch64 rescue' },
      ],
    };
    const fake = await startFakeProvider({
      'GET /iso-public': { body: isos },
      'POST /instances/5/iso/attach': { body: { iso: { id: 'iso-x86' } } },
      'POST /instances/5/reboot': { body: {} },
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('vultr', fake.base),
        { source: source({ VULTR_API_KEY: 'vultr-key' }) },
      );
      const session = await adapter.enableRescue('5', { architecture: 'x86_64' });
      assert.strictEqual(session.username, 'root');
      assert.strictEqual(session.rebooted, true);
      assert.match(session.notes, /SystemRescue/);
      assert.strictEqual(JSON.parse(fake.requests.find((r) => r.method === 'POST').body).iso_id, 'iso-x86');

      // arm64 resolves the ARM entry rather than booting an x86 kernel on an ARM instance.
      const arm = await adapter.enableRescue('5', { architecture: 'arm64' });
      assert.match(arm.notes, /SystemRescue ARM/);
    } finally {
      await fake.close();
    }
  });

  await t.test('vultr: metrics name what Vultr does not measure', async () => {
    const fake = await startFakeProvider({
      'GET /instances/9/bandwidth': {
        body: { bandwidth: { '2026-10-01': { incoming_bytes: 10, outgoing_bytes: 20 }, '2026-10-02': { incoming_bytes: 5, outgoing_bytes: 7 } } },
      },
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('vultr', fake.base),
        { source: source({ VULTR_API_KEY: 'vultr-key' }) },
      );
      const metrics = await adapter.getServerMetrics('9');
      assert.strictEqual(metrics.metrics.bandwidth.daysReported, 2);
      assert.deepStrictEqual(metrics.metrics.bandwidth.days[0], { date: '2026-10-01', incomingBytes: 10, outgoingBytes: 20 });
      assert.strictEqual(metrics.metrics.bandwidth.totalOutgoingBytes, 27);
      assert.deepStrictEqual(metrics.missing, ['cpu', 'memory', 'filesystem', 'load']);
      assert.match(metrics.note, /agent/);
    } finally {
      await fake.close();
    }
  });

  await t.test('generic bridge: the operator contract, including its rescue response', async () => {
    const fake = await startFakeProvider({
      'GET /v1/health': { body: { ok: true } },
      'GET /v1/servers/by-idempotency/job-9': { status: 404, body: { message: 'no such server' } },
      'POST /v1/servers': (request) => ({ body: { id: 'bridge-1', status: 'running', ipAddress: '198.51.100.4', name: JSON.parse(request.body).name, imageId: null, metadata: {} } }),
      'POST /v1/servers/bridge-1/rescue': { body: { type: 'linux64', username: 'root', password: 'once', rebooted: true } },
      'POST /v1/servers/bridge-2/rescue': { body: { type: 'linux64' } },
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('generic_http', fake.base, { credential_env_prefix: 'PROVIDER_BRIDGE' }),
        { source: source({ PROVIDER_BRIDGE_API_TOKEN: 'bridge-token' }) },
      );
      await adapter.validateConfiguration();
      assert.strictEqual(fake.requests[0].headers.authorization, 'Bearer bridge-token');

      assert.strictEqual(await adapter.findServerByIdempotencyKey('job-9'), null, 'a 404 means "not created yet"');

      const created = await adapter.createServer({
        idempotencyKey: 'job-9', name: 'ch247-job9', hostname: 'job9.example.com', architecture: 'x86_64',
        image: { providerImageId: 'img-1' }, regionCode: 'r1', datacenterCode: null,
        planMetadata: { providerServerType: 't1' }, sshPublicKeys: [], userData: '',
      });
      assert.strictEqual(created.id, 'bridge-1');

      const rescue = await adapter.enableRescue('bridge-1', { architecture: 'x86_64' });
      assert.deepStrictEqual(rescue, { type: 'linux64', username: 'root', password: 'once', rebooted: true, notes: undefined });

      await assert.rejects(() => adapter.enableRescue('bridge-2', { architecture: 'x86_64' }), (err) => {
        assert.strictEqual(err.code, 'PROVIDER_ERROR');
        assert.match(err.message, /returned no rescue system or login user/);
        return true;
      });
    } finally {
      await fake.close();
    }
  });

  await t.test('virtualizor: credentials travel as form fields, never in the URL', async () => {
    const fake = await startFakeProvider({
      'POST /index.php': (request) => (request.url.includes('act=listvs')
        ? { body: { vs: { '0': { vpsid: '77', vps_name: 'ch247-job7', hostname: 'ch247-job7', status: '1', osid: '9' } } } }
        : { body: { done: 1 } }),
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('virtualizor', fake.base),
        { source: source({ VIRTUALIZOR_API_KEY: 'vz-key', VIRTUALIZOR_API_SECRET: 'vz-pass' }) },
      );
      const found = await adapter.findServerByIdempotencyKey('job-7');
      assert.strictEqual(found.id, '77');
      assert.strictEqual(found.status, 'running');
      const request = fake.requests[0];
      assert.match(request.url, /^\/index\.php\?act=listvs&api=json/);
      assert.strictEqual(request.headers['content-type'], 'application/x-www-form-urlencoded');
      assert.match(request.body, /apikey=vz-key/);
      assert.match(request.body, /apipass=vz-pass/);
      assert.strictEqual(request.url.includes('vz-pass'), false, 'the secret is not a query parameter');
    } finally {
      await fake.close();
    }
  });

  await t.test('solusvm: form endpoint, its own error vocabulary, and an honest arm64 rescue refusal', async () => {
    const fake = await startFakeProvider({
      'POST /api/admin/command.php': (request) => {
        if (request.body.includes('action=vserver-rescue')) {
          return { body: { status: 'success', user: 'rescueuser', password: 'once-only', ip: '198.51.100.9', port: '22' } };
        }
        if (request.body.includes('hostname=ch247-job8')) {
          return { body: { status: 'error', statusmsg: 'Invalid API key or id' } };
        }
        return { body: { status: 'success', vserverid: '88', vmstat: 'online', ipaddresses: '198.51.100.9,10.0.0.4', hostname: 'ch247-job8' } };
      },
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('solusvm', fake.base),
        { source: source({ SOLUSVM_API_ID: 'id-1', SOLUSVM_API_KEY: 'key-1' }) },
      );
      const server = await adapter.getServerStatus('88');
      assert.strictEqual(server.ipAddress, '198.51.100.9');
      assert.strictEqual(server.status, 'running');
      assert.match(fake.requests[0].body, /rdtype=json/);

      await assert.rejects(() => adapter.findServerByIdempotencyKey('job-8'), (err) => {
        assert.strictEqual(err.code, 'AUTHENTICATION_FAILED', 'the panel said the key/id pair is invalid');
        assert.match(err.message, /Invalid API key or id/);
        return true;
      });

      const rescue = await adapter.enableRescue('88', { architecture: 'x86_64' });
      assert.strictEqual(rescue.username, 'rescueuser');
      assert.strictEqual(rescue.password, 'once-only');
      assert.match(rescue.notes, /ip 198\.51\.100\.9, port 22/);

      const before = fake.requests.length;
      await assert.rejects(() => adapter.enableRescue('88', { architecture: 'arm64' }), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION');
        assert.match(err.message, /only x86 rescue kernels/);
        return true;
      });
      assert.strictEqual(fake.requests.length, before, 'the refusal happens without asking the provider');
    } finally {
      await fake.close();
    }
  });

  await t.test('ovh: the documented signature scheme, checked against an independent HMAC-free recomputation', async () => {
    const fixedNow = 1_700_000_000_000;
    const realDateNow = Date.now;
    Date.now = () => fixedNow;
    const fake = await startFakeProvider({
      'GET /auth/time': { body: 1_700_000_100 },
      'GET /cloud/project/proj-1/instance': { body: [] },
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('ovh', fake.base),
        {
          source: source({
            OVH_APPLICATION_KEY: 'app-key', OVH_APPLICATION_SECRET: 'app-secret',
            OVH_CONSUMER_KEY: 'consumer-key', OVH_CLOUD_PROJECT_ID: 'proj-1',
          }),
        },
      );
      await adapter.findServerByIdempotencyKey('job-1');
      const call = fake.requests.find((r) => r.url === '/cloud/project/proj-1/instance');
      assert.ok(call, 'the instance list was requested');
      assert.strictEqual(call.headers['x-ovh-application'], 'app-key');
      assert.strictEqual(call.headers['x-ovh-consumer'], 'consumer-key');

      const timestamp = Number(call.headers['x-ovh-timestamp']);
      assert.strictEqual(timestamp, 1_700_000_100, 'the server-time offset from /auth/time is applied');

      // Recompute the signature from the OVH rule, separately from the adapter's own code path.
      const url = `${fake.base}/cloud/project/proj-1/instance`;
      const expected = `$1$${createHash('sha1')
        .update(['app-secret', 'consumer-key', 'GET', url, '', String(timestamp)].join('+'))
        .digest('hex')}`;
      assert.strictEqual(call.headers['x-ovh-signature'], expected);
      assert.strictEqual(call.url.includes('app-secret'), false);
    } finally {
      Date.now = realDateNow;
      await fake.close();
    }
  });

  await t.test('proxmox: token header, wrapped responses and task waiting', async () => {
    const fake = await startFakeProvider({
      'GET /api2/json/version': { body: { data: { version: '8.2.4' } } },
      'GET /api2/json/cluster/resources': { body: { data: [{ id: 'qemu/100', type: 'qemu', vmid: 100, name: 'ch247-job3', node: 'node-a', status: 'running', template: 0 }] } },
      'POST /api2/json/nodes/node-a/qemu/100/status/start': { body: { data: 'UPID:node-a:0001' } },
      'GET /api2/json/nodes/node-a/tasks/UPID:node-a:0001/status': { body: { data: { status: 'stopped', exitstatus: 'OK' } } },
      'GET /api2/json/nodes/node-a/qemu/100/status/current': { body: { data: { status: 'running', name: 'ch247-job3' } } },
      'POST /api2/json/nodes/node-a/qemu/100/vncproxy': { body: { data: { ticket: 'PVEVNC:abc', port: 5900 } } },
      'GET /api2/json/nodes/node-a/qemu/100/config': { body: { data: { ipconfig0: 'ip=dhcp', ostemplate: 'local:vztmpl/debian-12.tar.zst' } } },
      'GET /api2/json/nodes/node-a/qemu/100/agent/network-get-interfaces': { body: { data: { result: [{ 'ip-addresses': [{ 'ip-address': '203.0.113.55', 'ip-address-type': 'ipv4' }] }] } } },
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('proxmox', fake.base),
        { source: source({ PROXMOX_API_TOKEN: 'root@pam!ch247=uuid-secret' }) },
      );
      await adapter.validateConfiguration();
      assert.strictEqual(fake.requests[0].headers.authorization, 'PVEAPIToken=root@pam!ch247=uuid-secret');

      const found = await adapter.findServerByIdempotencyKey('job-3');
      assert.strictEqual(found.id, 'node-a/qemu/100');

      await adapter.startServer('node-a/qemu/100');
      const start = fake.requests.find((r) => r.url === '/api2/json/nodes/node-a/qemu/100/status/start');
      assert.ok(start, 'the start call went to the guest status endpoint');
      assert.strictEqual(start.headers.authorization, 'PVEAPIToken=root@pam!ch247=uuid-secret');

      // Mutating calls that carry parameters use Proxmox's urlencoded body, not JSON.
      const consoleTicket = await adapter.getConsole('node-a/qemu/100');
      assert.strictEqual(consoleTicket.port, 5900);
      const vnc = fake.requests.find((r) => r.url.includes('vncproxy'));
      assert.strictEqual(vnc.headers['content-type'], 'application/x-www-form-urlencoded');
      assert.strictEqual(vnc.body, 'websocket=1');

      const status = await adapter.getServerStatus('node-a/qemu/100');
      assert.strictEqual(status.ipAddress, '203.0.113.55');
      assert.strictEqual(status.imageId, 'local:vztmpl/debian-12.tar.zst');

      await assert.rejects(() => adapter.getServerStatus('node-a/qemu/101'), (err) => err.code === 'RESOURCE_NOT_FOUND');
    } finally {
      await fake.close();
    }
  });

  await t.test('mock: hard to enable, self-labelling, idempotent, and refuses what it cannot do', async () => {
    providers.resetMockProviderState();
    try {
      const disabled = providers.createInfrastructureProviderAdapter(providerRow('mock', null), { source: source({}) });
      await assert.rejects(() => disabled.validateConfiguration(), (err) => {
        assert.strictEqual(err.code, 'CONFIGURATION_REQUIRED');
        assert.match(err.message, /ALLOW_MOCK_PROVIDER=true/);
        return true;
      });

      const production = providers.createInfrastructureProviderAdapter(providerRow('mock', null), {
        source: source({ NODE_ENV: 'production', ALLOW_MOCK_PROVIDER: 'true' }),
      });
      await assert.rejects(() => production.validateConfiguration(), (err) => {
        assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
        return true;
      });

      const adapter = providers.createInfrastructureProviderAdapter(providerRow('mock', null), {
        source: source({ ALLOW_MOCK_PROVIDER: 'true' }),
      });
      const input = {
        idempotencyKey: 'job-4', name: 'ch247-job4', hostname: 'job4.example.com', architecture: 'x86_64',
        image: { providerImageId: 'mock-os' }, regionCode: 'r', datacenterCode: null,
        planMetadata: {}, sshPublicKeys: [], userData: '',
      };
      const created = await adapter.createServer(input);
      assert.match(created.id, /^mock-/);
      assert.strictEqual(created.metadata.mock, true);
      assert.strictEqual(created.ipAddress, '192.0.2.10');
      assert.strictEqual((await adapter.createServer(input)).id, created.id, 'create is idempotent per key');
      assert.strictEqual((await adapter.healthCheck(created.id, { providerImageId: 'mock-os' })).imageMatches, true);

      await assert.rejects(() => adapter.getConsole(created.id), (err) => err.code === 'UNSUPPORTED_OPERATION');
      await assert.rejects(() => adapter.getServerMetrics(created.id), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION');
        assert.match(err.message, /no metrics/);
        return true;
      });
      const rescue = await adapter.enableRescue(created.id, { architecture: 'x86_64' });
      assert.strictEqual(rescue.type, 'mock-rescue');
      assert.match(rescue.notes, /No provider was contacted/);
      await adapter.deleteServer(created.id);
      await assert.rejects(() => adapter.getServerStatus(created.id), (err) => err.code === 'RESOURCE_NOT_FOUND');
    } finally {
      providers.resetMockProviderState();
    }
  });

  await t.test('a slow provider is a timeout, not a hang', async () => {
    const fake = await startFakeProvider({
      'GET /servers': () => ({ delayMs: 400, body: { servers: [] } }),
    });
    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('hetzner', fake.base),
        { source: source({ HETZNER_API_TOKEN: 't' }) },
      );
      await assert.rejects(() => providers.providerRequest(`${fake.base}/servers`, {}, { timeoutMs: 50 }), (err) => {
        assert.strictEqual(err.code, 'PROVIDER_TIMEOUT');
        assert.strictEqual(err.retryable, true);
        assert.match(err.message, /timed out/);
        return true;
      });
      void adapter;
    } finally {
      await fake.close();
    }
  });

  await t.test('sanitizer: credentials and cloud-init are redacted, sizes are bounded', async () => {
    const sanitized = providers.sanitizeProviderResponse({
      Authorization: 'Bearer abc',
      password: 'p',
      api_key: 'k',
      user_data: '#cloud-config',
      cloud_init: 'x',
      nested: { access_token: 't', keep: 'visible' },
      long: 'x'.repeat(5000),
      many: Array.from({ length: 60 }, (_, i) => i),
    });
    assert.strictEqual(sanitized.Authorization, '[REDACTED]');
    assert.strictEqual(sanitized.password, '[REDACTED]');
    assert.strictEqual(sanitized.api_key, '[REDACTED]');
    assert.strictEqual(sanitized.user_data, '[REDACTED]');
    assert.strictEqual(sanitized.cloud_init, '[REDACTED]');
    assert.strictEqual(sanitized.nested.access_token, '[REDACTED]');
    assert.strictEqual(sanitized.nested.keep, 'visible');
    assert.match(sanitized.long, /\[truncated\]$/);
    assert.strictEqual(sanitized.many.length, 51);
    assert.match(sanitized.many[50], /10 more items/);
    assert.strictEqual(providers.sanitizeProviderRecord('nope'), null);
  });
});
