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
const { createHash, createHmac } = require('node:crypto');

const providers = require('../src/lib/providers');
const { ADAPTER_KINDS } = require('../src/lib/provider-adapters');

/**
 * A fake provider API. `routes` maps `METHOD /path` to a handler that returns
 * `{ status?, body?, raw?, headers?, contentType?, delayMs? }`; every request is recorded with its
 * headers and raw body. `raw` is how the AWS query-protocol tests answer with XML, and `headers` is
 * how the OpenStack test returns Keystone's `x-subject-token`.
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
        res.writeHead(result.status ?? 200, {
          'content-type': result.contentType ?? 'application/json',
          ...(result.headers ?? {}),
        });
        if (result.raw !== undefined) res.end(result.raw);
        else res.end(result.body === undefined ? '{}' : JSON.stringify(result.body));
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


  await t.test('contabo: OAuth2 password grant, marked display name, secret-backed rescue', async () => {
    const instances = [];
    const fake = await startFakeProvider({
      'POST /token': (request) => {
        const form = new URLSearchParams(request.body);
        assert.strictEqual(form.get('grant_type'), 'password', 'Contabo authorises with the API user password grant');
        assert.strictEqual(form.get('client_id'), 'contabo-client');
        assert.strictEqual(form.get('username'), 'api-user');
        assert.match(String(request.headers['content-type']), /application\/x-www-form-urlencoded/);
        return { body: { access_token: 'contabo-access-token', expires_in: 600 } };
      },
      'GET /compute/instances': (request) => {
        // The idempotency lookup asks the provider for the marker before anything is created.
        if (request.url.includes('displayName=ch247%3Ajob-contabo') || request.url.includes('displayName=ch247:job-contabo')) {
          return { body: { data: instances } };
        }
        return { body: { data: instances } };
      },
      'POST /compute/instances': (request) => {
        const body = JSON.parse(request.body);
        const instance = {
          instanceId: 12345, status: 'provisioning', displayName: body.displayName,
          imageId: body.imageId, productId: body.productId, region: body.region,
          ipConfig: { v4: { ip: '198.51.100.4' } },
        };
        instances.push(instance);
        return { body: { data: [instance] } };
      },
      'GET /compute/instances/12345': { body: { data: [{ instanceId: 12345, status: 'running', displayName: 'web [ch247:job-contabo]', imageId: 'image-debian', ipConfig: { v4: { ip: '198.51.100.4' } } }] } },
      'GET /compute/instances/404': { status: 404, body: { message: 'instance not found' } },
      'POST /secrets': (request) => {
        const body = JSON.parse(request.body);
        assert.strictEqual(body.type, 'password');
        assert.strictEqual(/[lLoO01]/.test(body.value), false, 'the rescue password avoids the confusable characters Contabo rejects');
        return { body: { data: [{ secretId: 77 }] } };
      },
      'POST /compute/instances/12345/actions/rescue': { body: { data: [{}] } },
      'POST /compute/instances/12345/actions/restart': { body: { data: [{}] } },
      'PUT /compute/instances/12345': { body: { data: [{ instanceId: 12345, status: 'installing' }] } },
      'POST /compute/instances/12345/snapshots': (request) => {
        const body = JSON.parse(request.body);
        return { body: { data: [{ snapshotId: 5, name: body.name }] } };
      },
      'DELETE /compute/instances/12345/snapshots/5': { body: { data: [{}] } },
      'POST /compute/instances/12345/snapshots/5/rollback': { body: { data: [{}] } },
      'GET /compute/images': (request) => {
        if (request.url.includes('page=2')) {
          return { body: { data: [{ imageId: 'image-ubuntu', name: 'Ubuntu 24.04', status: 'available', osType: 'Linux', standardImage: true }], _pagination: { page: 2, totalPages: 2 } } };
        }
        return { body: { data: [{ imageId: 'image-debian', name: 'Debian 12', status: 'available' }], _pagination: { page: 1, totalPages: 2 } } };
      },
    });

    try {
      const base = source({
        CONTABO_CLIENT_ID: 'contabo-client', CONTABO_CLIENT_SECRET: 'contabo-secret',
        CONTABO_API_USER: 'api-user', CONTABO_API_PASSWORD: 'api-password',
        CONTABO_TOKEN_URL: `${fake.base}/token`,
      });
      const row = providerRow('contabo', fake.base, { credential_env_prefix: null });
      const adapter = providers.createInfrastructureProviderAdapter(row, { source: base });

      await adapter.validateConfiguration();
      const images = await adapter.getAvailableImages();
      assert.deepStrictEqual(images.map((image) => image.id), ['image-debian', 'image-ubuntu'], 'the image list is paged to the end');
      assert.strictEqual(images[1].available, true);
      assert.strictEqual(images[1].metadata.osType, 'Linux');

      const created = await adapter.createServer({
        idempotencyKey: 'job-contabo', name: 'web', regionCode: 'EU', datacenterCode: null,
        image: { providerImageId: 'image-debian' }, planMetadata: { providerServerType: 'VPS-4', contaboPeriodMonths: 12, contaboDefaultUser: 'root' },
        sshPublicKeys: [], userData: '#cloud-config',
      });
      assert.strictEqual(created.id, '12345');
      assert.strictEqual(created.ipAddress, '198.51.100.4');

      const post = fake.requests.find((r) => r.method === 'POST' && r.url === '/compute/instances');
      assert.strictEqual(post.headers.authorization, 'Bearer contabo-access-token');
      assert.match(post.headers['x-request-id'], /^[0-9a-f-]{36}$/, 'each call carries a request id for Contabo support');
      const body = JSON.parse(post.body);
      assert.strictEqual(body.displayName, 'web [ch247:job-contabo]');
      assert.strictEqual(body.productId, 'VPS-4');
      assert.strictEqual(body.period, 12);
      assert.strictEqual(body.defaultUser, 'root');
      assert.strictEqual(body.imageId, 'image-debian');
      assert.strictEqual(JSON.stringify(fake.requests.map((r) => r.url)).includes('api-password'), false, 'the API password is a form field on the token call, never a URL');
      assert.strictEqual(JSON.stringify(fake.requests.map((r) => r.url)).includes('contabo-secret'), false);

      // The token is exchanged once and reused.
      assert.strictEqual(fake.requests.filter((r) => r.url === '/token').length, 1);

      // A second create for the same key finds the marked instance and creates nothing.
      const posts = fake.requests.filter((r) => r.method === 'POST' && r.url === '/compute/instances').length;
      const again = await adapter.createServer({
        idempotencyKey: 'job-contabo', name: 'web', regionCode: 'EU', datacenterCode: null,
        image: { providerImageId: 'image-debian' }, planMetadata: { providerServerType: 'VPS-4' },
        sshPublicKeys: [], userData: '',
      });
      assert.strictEqual(again.id, '12345');
      assert.strictEqual(fake.requests.filter((r) => r.method === 'POST' && r.url === '/compute/instances').length, posts, 'the marked display name short-circuits the create');

      const status = await adapter.getServerStatus('12345');
      assert.strictEqual(status.status, 'running');
      assert.strictEqual(status.name, 'web [ch247:job-contabo]');

      await assert.rejects(() => adapter.getServerStatus('404'), (err) => err.code === 'RESOURCE_NOT_FOUND');

      // Rescue: the plaintext password is created as a Contabo secret, passed by id, and returned once.
      const rescue = await adapter.enableRescue('12345', {});
      assert.strictEqual(rescue.type, 'contabo-rescue');
      assert.strictEqual(rescue.username, 'root');
      assert.match(rescue.password, /^[A-Z][A-Za-z2-9!@#$^&*?_~]{9}$/);
      assert.strictEqual(/[lLoO01]/.test(rescue.password), false);
      const secretCall = fake.requests.find((r) => r.url === '/secrets');
      assert.strictEqual(JSON.parse(secretCall.body).value, rescue.password, 'the password travels to Contabo as a secret value');
      const rescueCall = fake.requests.filter((r) => r.url.endsWith('/actions/rescue')).pop();
      assert.strictEqual(JSON.parse(rescueCall.body).rootPassword, 77, 'Contabo receives the secret id, never the plaintext');
      assert.strictEqual(JSON.stringify(JSON.parse(rescueCall.body)).includes(rescue.password), false);
      assert.strictEqual(JSON.stringify(adapter).includes(rescue.password), false, 'the adapter stores no rescue password');

      // With SSH-key secrets the rescue action needs no password at all.
      const keyed = await adapter.enableRescue('12345', { providerSshKeyIds: ['31', '32'] });
      assert.strictEqual(keyed.password, undefined);
      const keyedCall = fake.requests.filter((r) => r.url.endsWith('/actions/rescue')).pop();
      assert.deepStrictEqual(JSON.parse(keyedCall.body).sshKeys, [31, 32]);

      // Reinstall, snapshot and rollback all address the endpoints Contabo documents.
      const reinstalled = await adapter.reinstallServer({
        providerServerId: '12345', idempotencyKey: 'job-contabo', hostname: 'web',
        image: { providerImageId: 'image-debian' }, userData: '#cloud-config', isRetry: false,
      });
      assert.strictEqual(reinstalled.status, 'running');
      const put = fake.requests.find((r) => r.method === 'PUT');
      assert.deepStrictEqual(JSON.parse(put.body), { imageId: 'image-debian', userData: '#cloud-config', defaultUser: 'admin' });

      await adapter.createSnapshot('12345', 'before upgrade');
      await adapter.deleteSnapshot('12345', '5');
      await adapter.restoreSnapshot('12345', '5');
      assert.ok(fake.requests.some((r) => r.method === 'DELETE' && r.url.endsWith('/snapshots/5')));
      assert.ok(fake.requests.some((r) => r.method === 'POST' && r.url.endsWith('/snapshots/5/rollback')));

      // Refusals that are Contabo's own documented position, emitted without any provider call.
      const before = fake.requests.length;
      for (const [method, call] of [
        ['deleteServer', () => adapter.deleteServer('12345')],
        ['resizeServer', () => adapter.resizeServer('12345', { providerServerType: 'VPS-8' })],
        ['getConsole', () => adapter.getConsole('12345')],
        ['getServerMetrics', () => adapter.getServerMetrics('12345')],
      ]) {
        await assert.rejects(call, (err) => {
          assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION', `${method} must refuse rather than pretend`);
          assert.strictEqual(err.retryable, false);
          return true;
        });
      }
      assert.strictEqual(fake.requests.length, before, 'an unsupported operation makes no provider call at all');

      // A plan without a product id, and an image without a Contabo id, are configuration errors.
      await assert.rejects(
        () => adapter.createServer({ idempotencyKey: 'job-x', name: 'x', planMetadata: {}, image: { providerImageId: 'i' }, userData: '' }),
        (err) => err.code === 'INVALID_CONFIGURATION' && /product id/.test(err.message),
      );
      await assert.rejects(
        () => adapter.createServer({ idempotencyKey: 'job-x', name: 'x', planMetadata: { providerServerType: 'VPS-4' }, image: {}, userData: '' }),
        (err) => err.code === 'IMAGE_UNAVAILABLE',
      );

      // Plaintext endpoints are refused: an OAuth client secret must not travel over http.
      const plaintext = providers.createInfrastructureProviderAdapter(
        providerRow('contabo', 'http://api.contabo.example.com'),
        { source: base },
      );
      await assert.rejects(() => plaintext.validateConfiguration(), (err) => {
        assert.strictEqual(err.code, 'INVALID_CONFIGURATION');
        assert.match(err.message, /must use https/);
        return true;
      });

      const unconfigured = providers.createInfrastructureProviderAdapter(
        providerRow('contabo', fake.base), { source: source({}) },
      );
      await assert.rejects(() => unconfigured.validateConfiguration(), (err) => err.code === 'PROVIDER_NOT_CONFIGURED');
    } finally {
      await fake.close();
    }
  });

  await t.test('contabo: the rescue password generator is deterministic when driven, and excludes confusables', async () => {
    // The picker stands in for randomInt so the alphabet positions are exactly controlled.
    assert.strictEqual(providers.adapters.contabo.generateRescuePassword(() => 0), 'Aa222!aaaa');
    const generated = new Set();
    for (let index = 0; index < 200; index += 1) generated.add(providers.adapters.contabo.generateRescuePassword());
    assert.strictEqual(generated.size > 150, true, 'the generator does not repeat itself');
    for (const password of generated) {
      // Contabo's documented policy: letters and digits minus l, o, 0 and 1 (the generator's own
      // alphabet), one leading capital, 10 characters total.
      assert.match(password, /^[A-Z][A-Za-z2-9!@#$^&*?_~]{9}$/);
      assert.strictEqual(/[lLoO01]/.test(password), false, 'no confusable characters anywhere');
    }
    // The provider-visible name is bounded to Contabo's 255 characters and keeps the marker intact.
    const long = providers.adapters.contabo.providerDisplayName('n'.repeat(300), 'job-1');
    assert.strictEqual(long.length, 255);
    assert.strictEqual(long.endsWith('[ch247:job-1]'), true);
  });

  await t.test('openstack: Keystone password login, catalog resolution and Nova actions', async () => {
    let authCalls = 0;
    let created = null;
    const fake = await startFakeProvider({
      'POST /v3/auth/tokens': (request) => {
        authCalls += 1;
        const body = JSON.parse(request.body);
        const methods = body.auth?.identity?.methods;
        assert.deepStrictEqual(methods, ['password']);
        assert.strictEqual(body.auth.identity.password.user.name, 'os-user');
        assert.strictEqual(body.auth.identity.password.user.domain.name, 'Default');
        assert.deepStrictEqual(body.auth.scope, { project: { id: 'project-1' } });
        return {
          status: 201,
          headers: { 'x-subject-token': 'keystone-subject-token' },
          body: {
            token: {
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
              catalog: [
                { type: 'compute', endpoints: [{ interface: 'public', region: 'RegionOne', url: `${fake.base}/nova/v2.1` }] },
                { type: 'image', endpoints: [{ interface: 'public', region: 'RegionOne', url: `${fake.base}/glance` }] },
              ],
            },
          },
        };
      },
      'GET /nova/v2.1/servers': () => ({ body: { servers: created ? [{ id: 'os-1' }] : [] } }),
      'GET /nova/v2.1/servers/detail': () => ({
        body: {
          servers: created
            ? [{ id: 'os-1', name: 'ch247-jobopenstack', status: 'ACTIVE', metadata: { cloudhost247_idempotency: 'job-openstack' }, image: { id: 'image-id' }, addresses: { private: [{ addr: '10.0.0.5', version: 4 }], public: [{ addr: '203.0.113.9', version: 4, 'OS-EXT-IPS:type': 'floating' }] } }]
            : [],
        },
      }),
      'POST /nova/v2.1/servers': (request) => {
        const body = JSON.parse(request.body);
        created = true;
        return { body: { server: { id: 'os-1', name: body.server.name, status: 'BUILD', image: body.server.imageRef, metadata: body.server.metadata, addresses: {} } } };
      },
      'GET /nova/v2.1/servers/os-1': {
        body: { server: { id: 'os-1', name: 'ch247-jobopenstack', status: 'ACTIVE', image: { id: 'image-id' }, metadata: {}, addresses: { public: [{ addr: '203.0.113.9', version: 4, 'OS-EXT-IPS:type': 'floating' }] } } },
      },
      'GET /nova/v2.1/servers/403': { status: 403, body: { message: 'policy does not allow diagnostics' } },
      'GET /nova/v2.1/servers/os-1/diagnostics': { status: 403, body: { message: 'policy does not allow diagnostics' } },
      'POST /nova/v2.1/servers/os-1/action': (request) => {
        const body = JSON.parse(request.body);
        if (body.rescue) return { body: { adminPass: 'nova-rescue-once' } };
        return { body: {} };
      },
      'POST /nova/v2.1/servers/os-1/remote-consoles': (request) => {
        const body = JSON.parse(request.body);
        return { body: { remote_console: { protocol: body.remote_console.protocol, type: body.remote_console.type, url: `${fake.base}/vnc` } } };
      },
      'GET /glance/v2/images': {
        body: { images: [{ id: 'image-id', name: 'Debian 12', status: 'active', architecture: 'x86_64' }, { id: 'image-arm', name: 'Debian 12 arm64', status: 'active', architecture: 'aarch64' }] },
      },
      'GET /glance/v2/images/image-id': { body: { id: 'image-id', name: 'Debian 12', status: 'active', architecture: 'x86_64' } },
    });

    try {
      // `fake` is referenced inside its own routes, so the adapter is built after the server exists.
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('openstack', null),
        {
          source: source({
            OPENSTACK_AUTH_URL: `${fake.base}/v3`,
            OPENSTACK_USERNAME: 'os-user',
            OPENSTACK_PASSWORD: 'os-password',
            OPENSTACK_PROJECT_ID: 'project-1',
            OPENSTACK_REGION: 'RegionOne',
          }),
        },
      );

      await adapter.validateConfiguration();
      assert.strictEqual(authCalls, 1, 'the token is fetched once and reused');

      const images = await adapter.getAvailableImages();
      assert.deepStrictEqual(images.map((image) => image.architecture), ['x86_64', 'arm64']);
      assert.strictEqual((await adapter.getImage({ provider_image_id: 'image-id' })).name, 'Debian 12');
      assert.strictEqual(await adapter.getImage({}), null, 'an unmapped image needs no provider call');

      const createdServer = await adapter.createServer({
        idempotencyKey: 'job-openstack', name: 'web', regionCode: 'RegionOne', datacenterCode: 'nova',
        image: { providerImageId: 'image-id' }, planMetadata: { providerFlavorId: 'flavor-2', providerNetworkId: 'net-1', providerKeypairName: 'kp' },
        sshPublicKeys: [], userData: '#cloud-config',
      });
      assert.strictEqual(createdServer.id, 'os-1');

      const post = fake.requests.find((r) => r.method === 'POST' && r.url === '/nova/v2.1/servers');
      assert.strictEqual(post.headers['x-auth-token'], 'keystone-subject-token');
      const body = JSON.parse(post.body).server;
      assert.strictEqual(body.name, 'ch247-jobopenstack');
      assert.strictEqual(Buffer.from(body.user_data, 'base64').toString('utf8'), '#cloud-config');
      assert.deepStrictEqual(body.metadata, { cloudhost247_idempotency: 'job-openstack' });
      assert.deepStrictEqual(body.networks, [{ uuid: 'net-1' }]);
      assert.strictEqual(body.key_name, 'kp');
      assert.strictEqual(body.availability_zone, 'nova');

      // A second create finds the marked server and sends no second POST.
      const posts = fake.requests.filter((r) => r.method === 'POST' && r.url === '/nova/v2.1/servers').length;
      const again = await adapter.createServer({
        idempotencyKey: 'job-openstack', name: 'web', image: { providerImageId: 'image-id' },
        planMetadata: { providerFlavorId: 'flavor-2' }, userData: '',
      });
      assert.strictEqual(again.id, 'os-1');
      assert.strictEqual(fake.requests.filter((r) => r.method === 'POST' && r.url === '/nova/v2.1/servers').length, posts);
      assert.strictEqual(JSON.stringify(fake.requests.map((r) => r.url)).includes('os-password'), false, 'the Keystone password never appears in a URL');

      const status = await adapter.getServerStatus('os-1');
      assert.strictEqual(status.status, 'active');
      assert.strictEqual(status.ipAddress, '203.0.113.9', 'the floating IPv4 is preferred over the fixed one');

      const consoleSession = await adapter.getConsole('os-1');
      assert.strictEqual(consoleSession.protocol, 'vnc');
      const consoleCall = fake.requests.find((r) => r.url === '/nova/v2.1/servers/os-1/remote-consoles');
      assert.deepStrictEqual(JSON.parse(consoleCall.body), { remote_console: { protocol: 'vnc', type: 'novnc' } });

      const rescue = await adapter.enableRescue('os-1', {});
      assert.deepStrictEqual(rescue, { type: 'nova-rescue', username: 'root', password: 'nova-rescue-once', rebooted: true });
      await adapter.disableRescue('os-1');
      const actions = fake.requests.filter((r) => r.url === '/nova/v2.1/servers/os-1/action').map((r) => JSON.parse(r.body));
      assert.ok(actions.some((action) => action.unrescue === null));

      // Diagnostics a project may not read are a capability answer, not an empty metric document.
      await assert.rejects(() => adapter.getServerMetrics('os-1'), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION');
        assert.match(err.message, /may not read Nova diagnostics/);
        return true;
      });

      // A plan without a flavor id cannot be turned into a create.
      await assert.rejects(
        () => adapter.createServer({ idempotencyKey: 'job-y', name: 'y', image: { providerImageId: 'image-id' }, planMetadata: {}, userData: '' }),
        (err) => err.code === 'INVALID_CONFIGURATION' && /flavor/.test(err.message),
      );

      // Static-token configuration: no Keystone call at all, the token is used directly.
      const staticAdapter = providers.createInfrastructureProviderAdapter(
        providerRow('openstack', `${fake.base}/nova/v2.1`),
        { source: source({ OPENSTACK_API_TOKEN: 'static-token', OPENSTACK_API_URL: `${fake.base}/nova/v2.1` }) },
      );
      const authBefore = authCalls;
      await staticAdapter.getServerStatus('os-1');
      assert.strictEqual(authCalls, authBefore, 'a static token needs no identity call');
      const staticCall = fake.requests.filter((r) => r.url === '/nova/v2.1/servers/os-1').pop();
      assert.strictEqual(staticCall.headers['x-auth-token'], 'static-token');

      const unconfigured = providers.createInfrastructureProviderAdapter(
        providerRow('openstack', null), { source: source({}) },
      );
      await assert.rejects(() => unconfigured.validateConfiguration(), (err) => {
        assert.strictEqual(err.code, 'PROVIDER_NOT_CONFIGURED');
        assert.match(err.message, /OpenStack credentials are not configured/);
        return true;
      });
    } finally {
      await fake.close();
    }
  });


  // ---------------------------------------------------------------- AWS

  /** XML as AWS sends it: EC2 lowercases member names, CloudWatch capitalises them. */
  const xml = (...lines) => lines.join('\n');

  const awsInstance = (overrides = {}) => xml(
    '<item>',
    `  <instanceId>${overrides.id ?? 'i-1'}</instanceId>`,
    `  <imageId>${overrides.imageId ?? 'ami-1'}</imageId>`,
    `  <instanceType>${overrides.instanceType ?? 't3.micro'}</instanceType>`,
    `  <publicIpAddress>${overrides.ip ?? '203.0.113.5'}</publicIpAddress>`,
    `  <instanceState><code>16</code><name>${overrides.state ?? 'running'}</name></instanceState>`,
    '  <placement><availabilityZone>us-east-1a</availabilityZone></placement>',
    `  <rootDeviceName>${overrides.rootDevice ?? '/dev/sda1'}</rootDeviceName>`,
    '  <tagSet>',
    '    <item><key>Name</key><value>web</value></item>',
    '    <item><key>cloudhost247:idempotency</key><value>job-aws</value></item>',
    '    <item><key>team</key><value>platform</value></item>',
    '  </tagSet>',
    `  <blockDeviceMapping><item><deviceName>${overrides.rootDevice ?? '/dev/sda1'}</deviceName><ebs><volumeId>vol-1</volumeId></ebs></item></blockDeviceMapping>`,
    '  <groupSet><item><groupId>sg-1</groupId></item></groupSet>',
    '  <subnetId>subnet-1</subnetId>',
    '</item>',
  );

  const describeInstances = (items) => xml(
    '<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">',
    '  <requestId>req-1</requestId>',
    '  <reservationSet><item><reservationId>res-1</reservationId>',
    `    <instancesSet>${items}</instancesSet>`,
    '  </item></reservationSet>',
    '</DescribeInstancesResponse>',
  );

  const runInstances = (item) => xml(
    '<RunInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">',
    '  <reservationId>res-2</reservationId>',
    `  <instancesSet>${item}</instancesSet>`,
    '</RunInstancesResponse>',
  );

  const awsError = (code, message, status = 400) => ({
    status,
    contentType: 'text/xml',
    raw: xml(
      '<Response><Errors><Error>',
      `  <Code>${code}</Code>`,
      `  <Message>${message}</Message>`,
      '</Error></Errors><RequestID>req-err</RequestID></Response>',
    ),
  });

  /**
   * An independent SigV4 implementation, written here from the documented algorithm, used to check
   * that each request the adapter actually sent carries a signature over exactly those bytes. The
   * published test-suite vectors live in tests/aws-sigv4.test.js; this closes the other half — that
   * the adapter signs the request it sends and not some earlier draft of it.
   */
  function expectedAuthorization(record, options) {
    // The signed header list is taken from the Authorization header itself, which is the AWS rule:
    // every name the signature covers must have been sent with exactly the value that was signed.
    const declared = /SignedHeaders=([^,]+)/.exec(record.headers.authorization)[1].split(';');
    const signedHeaders = {};
    for (const name of declared) {
      const value = record.headers[name];
      assert.notStrictEqual(value, undefined, `the signature covers ${name}, so ${name} must have been sent`);
      signedHeaders[name] = Array.isArray(value) ? value[0] : value;
    }
    const names = Object.keys(signedHeaders).sort();
    assert.deepStrictEqual(names, declared, 'SignedHeaders is sorted, as SigV4 requires');
    const canonicalHeaders = names.map((name) => `${name}:${String(signedHeaders[name]).trim().replace(/\s+/g, ' ')}\n`).join('');
    const payloadHash = createHash('sha256').update(record.body).digest('hex');
    const canonicalRequest = ['POST', '/', '', canonicalHeaders, names.join(';'), payloadHash].join('\n');
    const scope = `${record.headers['x-amz-date'].slice(0, 8)}/${options.region}/${options.service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256', record.headers['x-amz-date'], scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const hmac = (key, data) => createHmac('sha256', key).update(data).digest();
    const signingKey = hmac(
      hmac(hmac(hmac(`AWS4${options.secretAccessKey}`, record.headers['x-amz-date'].slice(0, 8)), options.region), options.service),
      'aws4_request',
    );
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    return `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  }

  await t.test('aws: signed query protocol, idempotent create, serial console and CloudWatch metrics', async () => {
    const secret = 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY';
    const credentials = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: secret, region: 'us-east-1' };
    const calls = [];
    let instanceCreated = false;

    const fake = await startFakeProvider({
      'POST /': (request) => {
        const params = new URLSearchParams(request.body);
        const action = params.get('Action');
        calls.push({ action, params, record: request });
        switch (action) {
          case 'DescribeRegions':
            return { contentType: 'text/xml', raw: '<DescribeRegionsResponse><regionInfo><item><regionName>us-east-1</regionName></item></regionInfo></DescribeRegionsResponse>' };
          case 'DescribeInstances':
            if (params.get('InstanceId.1') === 'i-404') return awsError('InvalidInstanceID.NotFound', 'The instance ID i-404 does not exist');
            if (params.get('Filter.1.Name') === 'tag:cloudhost247:idempotency') {
              return { contentType: 'text/xml', raw: describeInstances(instanceCreated ? awsInstance() : '') };
            }
            return { contentType: 'text/xml', raw: describeInstances(awsInstance()) };
          case 'RunInstances':
            instanceCreated = true;
            return { contentType: 'text/xml', raw: runInstances(awsInstance({ id: 'i-created', state: 'pending' })) };
          case 'DescribeImages':
            return { contentType: 'text/xml', raw: xml(
              '<DescribeImagesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><imagesSet><item>',
              '  <imageId>ami-1</imageId>',
              '  <name>Debian 12</name>',
              '  <architecture>x86_64</architecture>',
              '  <imageState>available</imageState>',
              '  <imageOwnerId>099720109477</imageOwnerId>',
              '  <rootDeviceType>ebs</rootDeviceType>',
              '  <creationDate>2026-01-01T00:00:00.000Z</creationDate>',
              '</item></imagesSet></DescribeImagesResponse>',
            ) };
          case 'SendSerialConsoleSSHPublicKey':
            return { contentType: 'text/xml', raw: '<SendSerialConsoleSSHPublicKeyResponse><RequestId>req-2</RequestId><Success>true</Success></SendSerialConsoleSSHPublicKeyResponse>' };
          case 'GetMetricStatistics': {
            const metric = params.get('MetricName');
            const datapoints = metric === 'CPUUtilization'
              ? '<Datapoints><member><Timestamp>2026-10-05T09:00:00Z</Timestamp><Average>12.5</Average><Maximum>30.0</Maximum><Unit>Percent</Unit></member>'
                + '<member><Timestamp>2026-10-05T09:05:00Z</Timestamp><Average>20.25</Average><Maximum>40.0</Maximum><Unit>Percent</Unit></member></Datapoints>'
              : '<Datapoints></Datapoints>';
            return { contentType: 'text/xml', raw: `<GetMetricStatisticsResponse><GetMetricStatisticsResult>${datapoints}<Label>${metric}</Label></GetMetricStatisticsResult></GetMetricStatisticsResponse>` };
          }
          case 'StopInstances': case 'StartInstances': case 'RebootInstances': case 'TerminateInstances':
          case 'ModifyInstanceAttribute': case 'CreateSnapshot': case 'DeleteSnapshot':
            return { contentType: 'text/xml', raw: `<${action}Response><return>true</return></${action}Response>` };
          default:
            return awsError('InvalidAction', `no fake route for ${action}`);
        }
      },
    });

    try {
      const adapter = providers.createInfrastructureProviderAdapter(
        providerRow('aws', fake.base),
        {
          source: source({
            AWS_ACCESS_KEY_ID: credentials.accessKeyId,
            AWS_SECRET_ACCESS_KEY: credentials.secretAccessKey,
            AWS_REGION: credentials.region,
            AWS_CLOUDWATCH_ENDPOINT: fake.base,
            AWS_INSTANCE_CONNECT_ENDPOINT: fake.base,
          }),
        },
      );

      await adapter.validateConfiguration();
      assert.strictEqual(calls[0].action, 'DescribeRegions');
      assert.strictEqual(calls[0].params.get('RegionNames.1') ?? calls[0].params.get('RegionName.1'), 'us-east-1');

      const created = await adapter.createServer({
        idempotencyKey: 'job-aws', name: 'web', regionCode: 'us-east-1', datacenterCode: null,
        image: { providerImageId: 'ami-1' }, planMetadata: { providerServerType: 't3.micro', awsKeyName: 'ch247-key' },
        sshPublicKeys: ['ssh-rsa AAAA'], userData: '#cloud-config',
      });
      assert.strictEqual(created.id, 'i-created');
      assert.strictEqual(created.status, 'pending');
      assert.strictEqual(created.name, 'web');

      // The lookup really happens first, on the idempotency tag.
      assert.deepStrictEqual(calls.slice(1, 3).map((call) => call.action), ['DescribeInstances', 'RunInstances']);
      assert.strictEqual(calls[1].params.get('Filter.1.Name'), 'tag:cloudhost247:idempotency');
      assert.strictEqual(calls[1].params.get('Filter.1.Value.1'), 'job-aws');

      const run = calls[2].params;
      assert.strictEqual(run.get('Version'), '2016-11-15');
      assert.strictEqual(run.get('ImageId'), 'ami-1');
      assert.strictEqual(run.get('InstanceType'), 't3.micro');
      assert.strictEqual(run.get('MinCount'), '1');
      assert.strictEqual(run.get('MaxCount'), '1');
      assert.strictEqual(run.get('ClientToken'), 'job-aws', 'EC2 needs the client token to deduplicate a retried create');
      assert.strictEqual(run.get('KeyName'), 'ch247-key');
      assert.strictEqual(run.get('TagSpecification.1.ResourceType'), 'instance');
      assert.strictEqual(run.get('TagSpecification.1.Tag.1.Key'), 'Name');
      assert.strictEqual(run.get('TagSpecification.1.Tag.1.Value'), 'web');
      assert.strictEqual(run.get('TagSpecification.1.Tag.2.Key'), 'cloudhost247:idempotency');
      assert.strictEqual(run.get('TagSpecification.1.Tag.2.Value'), 'job-aws');
      assert.strictEqual(Buffer.from(run.get('UserData'), 'base64').toString('utf8'), '#cloud-config');

      // A second create finds the tagged instance and never launches another one.
      const runInstancesCalls = calls.filter((call) => call.action === 'RunInstances').length;
      const again = await adapter.createServer({
        idempotencyKey: 'job-aws', name: 'web', regionCode: 'us-east-1',
        image: { providerImageId: 'ami-1' }, planMetadata: { providerServerType: 't3.micro' },
        sshPublicKeys: [], userData: '',
      });
      assert.strictEqual(again.id, 'i-1');
      assert.strictEqual(calls.filter((call) => call.action === 'RunInstances').length, runInstancesCalls);

      // Status, name tag, root volume and address mapping.
      const status = await adapter.getServerStatus('i-1');
      assert.strictEqual(status.status, 'running');
      assert.strictEqual(status.ipAddress, '203.0.113.5');
      assert.strictEqual(status.imageId, 'ami-1');
      assert.deepStrictEqual(status.metadata, { instanceType: 't3.micro', availabilityZone: 'us-east-1a', rootVolumeId: 'vol-1' });

      await assert.rejects(() => adapter.getServerStatus('i-404'), (err) => {
        assert.strictEqual(err.code, 'RESOURCE_NOT_FOUND', 'an AWS NotFound code is classified by the code, not by the HTTP 400 that carries it');
        assert.strictEqual(err.retryable, false);
        return true;
      });

      for (const [method, action] of [['startServer', 'StartInstances'], ['shutdownServer', 'StopInstances'], ['rebootServer', 'RebootInstances'], ['deleteServer', 'TerminateInstances']]) {
        await adapter[method]('i-1');
        const call = calls.filter((entry) => entry.action === action).pop();
        assert.strictEqual(call.params.get('InstanceId.1'), 'i-1', `${action} must address the instance explicitly`);
      }

      const resized = await adapter.resizeServer('i-1', { providerServerType: 'm5.large' });
      assert.strictEqual(resized.id, 'i-1');
      assert.strictEqual(calls.filter((c) => c.action === 'ModifyInstanceAttribute').pop().params.get('InstanceType.Value'), 'm5.large');

      const snapshot = await adapter.createSnapshot('i-1', 'before upgrade');
      assert.deepStrictEqual(snapshot, { id: null, state: null, volumeId: 'vol-1', description: 'before upgrade' });
      assert.strictEqual(calls.filter((c) => c.action === 'CreateSnapshot').pop().params.get('VolumeId'), 'vol-1');
      await adapter.deleteSnapshot('i-1', 'snap-1');
      assert.strictEqual(calls.filter((c) => c.action === 'DeleteSnapshot').pop().params.get('SnapshotId'), 'snap-1');

      // Images.
      calls.length = 0;
      const images = await adapter.getAvailableImages();
      assert.deepStrictEqual(images, [{
        id: 'ami-1',
        name: 'Debian 12',
        architecture: 'x86_64',
        available: true,
        metadata: { creationDate: '2026-01-01T00:00:00.000Z', ownerId: '099720109477', rootDeviceType: 'ebs' },
      }]);
      assert.strictEqual(calls[0].params.get('Owner.1'), 'self');
      assert.strictEqual(calls[0].params.get('Owner.2'), 'amazon');
      assert.strictEqual(calls[0].params.get('Filter.1.Name'), 'state');
      assert.deepStrictEqual(await adapter.getImage({ providerImageId: 'ami-1' }), images[0]);
      assert.strictEqual(await adapter.getImage({}), null, 'an unmapped image needs no provider call');
      assert.strictEqual(calls.length, 2, 'only the two image lookups reached the provider');

      // The serial console: an SSH key pushed through EC2 Instance Connect, not a VNC session.
      const consoleSession = await adapter.getConsole('i-1');
      const consoleCall = calls.filter((c) => c.action === 'SendSerialConsoleSSHPublicKey').pop();
      assert.strictEqual(consoleCall.params.get('InstanceId'), 'i-1');
      assert.strictEqual(consoleCall.params.get('SerialPort'), '0');
      assert.match(consoleCall.params.get('SSHPublicKey'), /^ssh-rsa [A-Za-z0-9+/=]+ cloudhost247-serial-console$/);
      assert.strictEqual(consoleSession.type, 'ec2-serial-console-ssh');
      assert.strictEqual(consoleSession.username, 'i-1.port0');
      assert.match(consoleSession.privateKey, /^-----BEGIN RSA PRIVATE KEY-----/);
      assert.match(consoleSession.notes, /ssh -i <saved-key-file> i-1\.port0@serial-console\.ec2-instance-connect\.us-east-1\.aws/);

      // CloudWatch metrics: five-minute averages over the last hour, with absent metrics named.
      const metrics = await adapter.getServerMetrics('i-1');
      assert.strictEqual(metrics.namespace, 'AWS/EC2');
      assert.strictEqual(metrics.periodSeconds, 300);
      assert.deepStrictEqual(metrics.metrics.CPUUtilization, { unit: 'Percent', average: 20.25, maximum: 40, samples: 2 });
      assert.deepStrictEqual(metrics.missing, ['NetworkIn', 'NetworkOut', 'DiskReadOps', 'DiskWriteOps', 'StatusCheckFailed']);
      assert.strictEqual(metrics.metrics.NetworkIn, undefined, 'a metric the instance has not reported is never invented as zero');
      const metricCalls = calls.filter((c) => c.action === 'GetMetricStatistics');
      assert.strictEqual(metricCalls.length, 6);
      assert.strictEqual(metricCalls[0].params.get('Dimensions.member.1.Name'), 'InstanceId');
      assert.strictEqual(metricCalls[0].params.get('Statistics.member.1'), 'Average');
      assert.strictEqual(metricCalls[0].params.get('Period'), '300');
      assert.strictEqual(metricCalls[0].params.get('Namespace'), 'AWS/EC2');

      // EC2 has no rescue: the adapter refuses without making a call.
      const before = calls.length;
      await assert.rejects(() => adapter.enableRescue('i-1', {}), (err) => err.code === 'UNSUPPORTED_OPERATION');
      await assert.rejects(() => adapter.disableRescue('i-1'), (err) => err.code === 'UNSUPPORTED_OPERATION');
      assert.strictEqual(calls.length, before);

      // Every request was signed over exactly the bytes that were sent, with the right service scope.
      assert.strictEqual(fake.requests.length > 0, true);
      for (const record of fake.requests) {
        assert.strictEqual(record.headers['content-type'], 'application/x-www-form-urlencoded; charset=utf-8');
        const service = record.url === '/' && record.body.includes('Action=SendSerialConsoleSSHPublicKey')
          ? 'ec2-instance-connect'
          : record.body.includes('Action=GetMetricStatistics') ? 'monitoring' : 'ec2';
        assert.strictEqual(
          record.headers.authorization,
          expectedAuthorization(record, { ...credentials, service }),
          `the ${service} request carries a signature over the bytes actually sent`,
        );
        assert.match(record.headers.authorization, new RegExp(`/${credentials.region}/${service}/aws4_request`));
        assert.strictEqual(record.url.includes(secret), false, 'the secret access key is never a query parameter');
        assert.strictEqual(record.body.includes(secret), false);
        assert.match(record.headers['x-amz-date'], /^\d{8}T\d{6}Z$/);
      }
    } finally {
      await fake.close();
    }
  });

  await t.test('aws: AWS error codes, and the destructive workflows behind the operator switch', async () => {
    const credentials = {
      AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'us-east-1',
    };
    const calls = [];
    const fake = await startFakeProvider({
      'POST /': (request) => {
        const params = new URLSearchParams(request.body);
        const action = params.get('Action');
        calls.push({ action, params, record: request });
        switch (action) {
          case 'DescribeInstances':
            if (params.get('InstanceId.1') === 'i-gone') return { contentType: 'text/xml', raw: describeInstances('') };
            // The idempotency lookup answers with the tagged instance only for the key it was tagged with.
            if (params.get('Filter.1.Name') === 'tag:cloudhost247:idempotency') {
              return { contentType: 'text/xml', raw: describeInstances(params.get('Filter.1.Value.1') === 'job-aws' ? awsInstance({ state: 'running' }) : '') };
            }
            return { contentType: 'text/xml', raw: describeInstances(awsInstance({ state: 'running' })) };
          case 'RunInstances': {
            if (params.get('ImageId') === 'ami-capacity') return awsError('InsufficientInstanceCapacity', 'There is no Spot capacity available');
            return { contentType: 'text/xml', raw: runInstances(awsInstance({ id: 'i-2', state: 'pending' })) };
          }
          case 'DescribeSnapshots':
            return { contentType: 'text/xml', raw: xml('<DescribeSnapshotsResponse><snapshotSet><item>', '<snapshotId>snap-1</snapshotId>', '<volumeId>vol-1</volumeId>', '<status>completed</status>', '<description>before upgrade</description>', '</item></snapshotSet></DescribeSnapshotsResponse>') };
          case 'CreateVolume':
            return { contentType: 'text/xml', raw: '<CreateVolumeResponse><volumeId>vol-new</volumeId><status>creating</status></CreateVolumeResponse>' };
          case 'SendSerialConsoleSSHPublicKey':
            return awsError('SerialConsoleAccessDisabled', 'EC2 Serial Console is disabled for your account');
          case 'DescribeRegions':
            return { status: 403, contentType: 'text/xml', raw: '<Response><Errors><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match the signature you provided.</Message></Error></Errors></Response>' };
          case 'TerminateInstances': case 'AttachVolume': case 'DetachVolume':
            return { contentType: 'text/xml', raw: `<${action}Response><return>true</return></${action}Response>` };
          default:
            return { contentType: 'text/xml', raw: `<${action}Response><return>true</return></${action}Response>` };
        }
      },
    });

    // Point every AWS service the adapter uses at the fake; without this the console call would
    // address the real regional endpoint and fail on DNS instead of reaching the fake.
    const awsEnv = { ...credentials, AWS_CLOUDWATCH_ENDPOINT: fake.base, AWS_INSTANCE_CONNECT_ENDPOINT: fake.base };

    try {
      const disabled = providers.createInfrastructureProviderAdapter(providerRow('aws', fake.base), { source: source(awsEnv) });
      for (const [method, call] of [
        ['reinstallServer', () => disabled.reinstallServer({ providerServerId: 'i-1', idempotencyKey: 'job', image: { providerImageId: 'ami-9' }, userData: '' })],
        ['restoreSnapshot', () => disabled.restoreSnapshot('i-1', 'snap-1')],
      ]) {
        await assert.rejects(call, (err) => {
          assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION', `${method} is a destructive EC2 workflow, so it is off by default`);
          assert.match(err.message, /AWS_ALLOW_ROOT_VOLUME_REPLACEMENT/);
          return true;
        });
      }
      assert.strictEqual(calls.length, 0, 'a disabled workflow makes no provider call at all');

      const enabled = providers.createInfrastructureProviderAdapter(providerRow('aws', fake.base), {
        source: source({ ...awsEnv, AWS_ALLOW_ROOT_VOLUME_REPLACEMENT: 'true' }),
      });

      // Reinstall = launch a replacement from the new AMI, then stop the old instance.
      const replacement = await enabled.reinstallServer({
        providerServerId: 'i-1', idempotencyKey: 'job-reinstall', hostname: 'web-2',
        image: { providerImageId: 'ami-9' }, userData: '#cloud-config',
      });
      assert.strictEqual(replacement.id, 'i-2');
      assert.deepStrictEqual(replacement.metadata.replacement, {
        previousServerId: 'i-1', previousState: 'running', previousAction: 'stopped', workflow: 'replacement-instance',
      });
      const launch = calls.filter((c) => c.action === 'RunInstances').pop().params;
      assert.strictEqual(launch.get('ImageId'), 'ami-9');
      assert.strictEqual(launch.get('InstanceType'), 't3.micro', 'the replacement keeps the source instance type');
      assert.strictEqual(launch.get('ClientToken'), 'job-reinstall');
      assert.strictEqual(launch.get('Placement.AvailabilityZone'), 'us-east-1a');
      assert.strictEqual(launch.get('SubnetId'), 'subnet-1');
      assert.strictEqual(launch.get('SecurityGroupId.1'), 'sg-1');
      assert.strictEqual(launch.get('TagSpecification.1.Tag.1.Key'), 'Name');
      assert.strictEqual(launch.get('TagSpecification.1.Tag.1.Value'), 'web-2');
      const copiedTags = Object.entries(Object.fromEntries(launch)).filter(([key]) => key.startsWith('TagSpecification.1.Tag.'));
      assert.strictEqual(copiedTags.some(([, value]) => value === 'cloudhost247:replacement-for'), true, 'the replacement records what it replaced');
      assert.strictEqual(copiedTags.some(([, value]) => value === 'platform'), true, 'the source non-identity tags are carried across');
      assert.strictEqual(calls.filter((c) => c.action === 'StopInstances').length, 1);
      assert.strictEqual(calls.filter((c) => c.action === 'StopInstances')[0].params.get('InstanceId.1'), 'i-1');

      // Restore = volume surgery: new volume from the snapshot, stop, detach, attach, start.
      calls.length = 0;
      await enabled.restoreSnapshot('i-1', 'snap-1');
      assert.deepStrictEqual(calls.map((call) => call.action), [
        'DescribeInstances', 'DescribeSnapshots', 'CreateVolume', 'StopInstances', 'DetachVolume', 'AttachVolume', 'StartInstances',
      ]);
      assert.strictEqual(calls[2].params.get('AvailabilityZone'), 'us-east-1a');
      assert.strictEqual(calls[2].params.get('VolumeType'), 'gp3');
      assert.strictEqual(calls[4].params.get('VolumeId'), 'vol-1');
      assert.strictEqual(calls[5].params.get('VolumeId'), 'vol-new');
      assert.strictEqual(calls[5].params.get('Device'), '/dev/sda1');
      assert.strictEqual(calls[6].params.get('InstanceId.1'), 'i-1');

      // A running instance that is not found, and a not-ready snapshot, are distinct refusals.
      await assert.rejects(() => enabled.restoreSnapshot('i-gone', 'snap-1'), (err) => err.code === 'RESOURCE_NOT_FOUND');

      // AWS error codes decide the classification: capacity is retryable, a disabled serial console is not.
      await assert.rejects(
        () => enabled.createServer({
          idempotencyKey: 'job-capacity', name: 'web', regionCode: 'us-east-1',
          image: { providerImageId: 'ami-capacity' }, planMetadata: { providerServerType: 't3.micro' },
          sshPublicKeys: [], userData: '',
        }),
        (err) => {
          assert.strictEqual(err.code, 'INSUFFICIENT_CAPACITY');
          assert.strictEqual(err.retryable, true, 'capacity does come back, so the job may be retried');
          const httpError = providers.providerErrorToHttpError(err);
          assert.strictEqual(/no Spot capacity/.test(httpError.message), false, 'AWS wording stays server-side');
          return true;
        },
      );

      await assert.rejects(() => enabled.getConsole('i-1'), (err) => {
        assert.strictEqual(err.code, 'UNSUPPORTED_OPERATION');
        assert.match(err.message, /EnableSerialConsoleAccess/);
        return true;
      });

      await assert.rejects(() => enabled.validateConfiguration(), (err) => {
        assert.strictEqual(err.code, 'AUTHENTICATION_FAILED');
        assert.strictEqual(err.retryable, false);
        return true;
      });

      // A region mismatch is refused before the provider is contacted at all.
      calls.length = 0;
      await assert.rejects(
        () => enabled.createServer({ idempotencyKey: 'job-eu', name: 'web', regionCode: 'eu-west-1', image: { providerImageId: 'ami-1' }, planMetadata: { providerServerType: 't3.micro' }, userData: '' }),
        (err) => err.code === 'INVALID_CONFIGURATION' && /does not match this provider's configured region/.test(err.message),
      );
      assert.strictEqual(calls.length, 0, 'the configured region is checked before the idempotency lookup');

      await assert.rejects(
        () => enabled.createServer({ idempotencyKey: 'job-noami', name: 'web', regionCode: 'us-east-1', image: {}, planMetadata: { providerServerType: 't3.micro' }, userData: '' }),
        (err) => err.code === 'IMAGE_UNAVAILABLE',
      );
      await assert.rejects(
        () => enabled.createServer({ idempotencyKey: 'job-nokey', name: 'web', regionCode: 'us-east-1', image: { providerImageId: 'ami-1' }, planMetadata: { providerServerType: 't3.micro' }, sshPublicKeys: ['ssh-rsa AAAA'], userData: '' }),
        (err) => err.code === 'INVALID_CONFIGURATION' && /awsKeyName/.test(err.message),
      );
      await assert.rejects(
        () => enabled.resizeServer('i-1', {}),
        (err) => err.code === 'INVALID_CONFIGURATION' && /instance type/.test(err.message),
      );
      assert.strictEqual(calls.filter((call) => call.action === 'RunInstances').length, 0, 'none of these launched anything');
      assert.strictEqual(calls.every((call) => call.action === 'DescribeInstances'), true,
        'the only provider call any of them made was the idempotency lookup that precedes the checks');

      const noKeys = providers.createInfrastructureProviderAdapter(providerRow('aws', fake.base), { source: source({ AWS_REGION: 'us-east-1' }) });
      await assert.rejects(() => noKeys.validateConfiguration(), (err) => {
        assert.strictEqual(err.code, 'PROVIDER_NOT_CONFIGURED');
        assert.match(err.message, /access key id and secret access key/);
        return true;
      });

      const noRegion = providers.createInfrastructureProviderAdapter(providerRow('aws', fake.base), {
        source: source({ AWS_ACCESS_KEY_ID: 'AKIDEXAMPLE', AWS_SECRET_ACCESS_KEY: 'secret' }),
      });
      await assert.rejects(() => noRegion.validateConfiguration(), (err) => err.code === 'PROVIDER_NOT_CONFIGURED');

      const plaintext = providers.createInfrastructureProviderAdapter(providerRow('aws', 'http://ec2.example.com'), { source: source(awsEnv) });
      await assert.rejects(() => plaintext.validateConfiguration(), (err) => {
        assert.strictEqual(err.code, 'INVALID_CONFIGURATION');
        assert.match(err.message, /must use https/);
        return true;
      });
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
