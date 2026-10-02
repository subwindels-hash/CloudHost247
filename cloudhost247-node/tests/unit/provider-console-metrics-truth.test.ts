import { afterEach, describe, expect, it, vi } from 'vitest';
import { DigitalOceanProviderAdapter } from '../../src/infrastructure/providers/digitalocean-adapter';
import { VultrProviderAdapter } from '../../src/infrastructure/providers/vultr-adapter';
import { ContaboProviderAdapter } from '../../src/infrastructure/providers/contabo-adapter';
import { ADAPTER_PROFILES } from '../../src/infrastructure/providers/configuration';
import type { InfrastructureProviderRow } from '../../src/db/infrastructure-providers';

/**
 * Console and metrics truth for the two adapters that advertised a console they could not deliver
 * and a metrics call that read the wrong endpoint.
 *
 * Before this change:
 *   - `digitalocean.getConsole()` returned `/droplets/{id}/actions` (the droplet's action history)
 *     and `vultr.getConsole()` returned `/instances/{id}/actions`, while both profiles advertised
 *     `console: true`. The customer route gates on `server.capabilities.console === true`, so the
 *     customer saw an "Open console" button, the platform audited `SERVER_CONSOLE_OPENED`, and the
 *     UI rendered a list of past power events inside a panel titled "Serial console session".
 *   - `digitalocean.getServerMetrics()` returned `/droplets/{id}/neighbors` — not metrics at all,
 *     but the list of *other customers' droplets sharing the same physical host*.
 *
 * Neither provider has a console operation in its API (verified against the DigitalOcean API v2
 * reference — the Droplet Console and out-of-band Recovery Console are Control Panel features — and
 * against Vultr API v2, whose web console is a customer-portal feature). Both DO have a real
 * metrics surface, so metrics are implemented rather than refused: DigitalOcean's Monitoring API
 * and Vultr's daily bandwidth endpoint, each reporting only what the provider actually measures.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function providerRow(adapter: string, apiBaseUrl: string): InfrastructureProviderRow {
  return {
    id: `provider-${adapter}`, name: adapter, slug: adapter, provider_type: adapter.toUpperCase(),
    adapter, status: 'ACTIVE', api_base_url: apiBaseUrl, credential_env_prefix: null, capabilities: {},
    metadata: {}, last_health_check_at: null, last_health_status: null, created_at: '', updated_at: '',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function digitaloceanAdapter(responses: Map<string, unknown> | ((url: string) => unknown)) {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const body = typeof responses === 'function' ? responses(url) : responses.get(url.split('?')[0] ?? url);
    if (body === undefined) throw new Error(`Unexpected DigitalOcean request: ${url}`);
    return json(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  const instance = new DigitalOceanProviderAdapter(providerRow('digitalocean', 'https://api.digitalocean.test/v2'), {
    DIGITALOCEAN_API_TOKEN: 'token',
  } as NodeJS.ProcessEnv);
  return { instance, urls, fetchMock };
}

function vultrAdapter(body: unknown) {
  const urls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return json(body);
  });
  vi.stubGlobal('fetch', fetchMock);
  const instance = new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), {
    VULTR_API_KEY: 'token',
  } as NodeJS.ProcessEnv);
  return { instance, urls, fetchMock };
}

/** A DigitalOcean Monitoring series: `{ metric: labels, values: [[unixSeconds, "stringValue"]] }`. */
function series(labels: Record<string, string>, values: Array<[number, string | number]>) {
  return { metric: labels, values };
}

function monitoring(result: unknown[]) {
  return { status: 'success', data: { resultType: 'matrix', result } };
}

describe('profiles advertise the console and metrics they actually deliver', () => {
  it.each([
    ['digitalocean', { console: false, metrics: true }],
    ['vultr', { console: false, metrics: true }],
  ] as const)('%s declares console/metrics that match its implementation', (kind, expected) => {
    const capabilities = ADAPTER_PROFILES[kind].capabilities as unknown as Record<string, boolean>;
    for (const [capability, value] of Object.entries(expected)) {
      expect(capabilities[capability]).toBe(value);
    }
  });

  it('every real-provider adapter that declares console:false refuses it before any request', async () => {
    // The drift this pins, in both directions: a capability flag and the implementation must agree.
    // `mock` is excluded on purpose — it is a simulator that answers with `{ type: 'none' }` rather
    // than a console, so it never claims one either.
    const fetchMock = vi.fn(async () => {
      throw new Error('network disabled in this test');
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapters = [
      new DigitalOceanProviderAdapter(providerRow('digitalocean', 'https://api.digitalocean.test/v2'), {
        DIGITALOCEAN_API_TOKEN: 'token',
      } as NodeJS.ProcessEnv),
      new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), {
        VULTR_API_KEY: 'token',
      } as NodeJS.ProcessEnv),
      new ContaboProviderAdapter(providerRow('contabo', 'https://api.contabo.test/v1'), {
        CONTABO_CLIENT_ID: 'client-id', CONTABO_CLIENT_SECRET: 'client-secret',
        CONTABO_API_USER: 'api-user@example.test', CONTABO_API_PASSWORD: 'api-password',
        CONTABO_TOKEN_URL: 'https://auth.contabo.test/token',
      } as NodeJS.ProcessEnv),
    ];

    for (const adapter of adapters) {
      expect(ADAPTER_PROFILES[adapter.kind as keyof typeof ADAPTER_PROFILES].capabilities.console).toBe(false);
      await expect(adapter.getConsole('server-1')).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
        retryable: false,
      });
    }
    // Not even a token exchange: the refusal is decided locally.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('console is refused where the provider has no console operation', () => {
  it('refuses DigitalOcean and Vultr consoles before any provider request', async () => {
    // Killing the transport proves the refusal is decided locally, not by a provider response.
    const fetchMock = vi.fn(async () => {
      throw new Error('network disabled in this test');
    });
    vi.stubGlobal('fetch', fetchMock);

    const digitalocean = new DigitalOceanProviderAdapter(providerRow('digitalocean', 'https://api.digitalocean.test/v2'), {
      DIGITALOCEAN_API_TOKEN: 'token',
    } as NodeJS.ProcessEnv);
    const vultr = new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), {
      VULTR_API_KEY: 'token',
    } as NodeJS.ProcessEnv);

    for (const adapter of [digitalocean, vultr]) {
      await expect(adapter.getConsole('server-1')).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
        retryable: false,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the provider and the verified reason, so the refusal is diagnosable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({})));
    const digitalocean = new DigitalOceanProviderAdapter(providerRow('digitalocean', 'https://api.digitalocean.test/v2'), {
      DIGITALOCEAN_API_TOKEN: 'token',
    } as NodeJS.ProcessEnv);
    await expect(digitalocean.getConsole('server-1')).rejects.toThrow(/digitalocean offers no console session through its API/i);
  });
});

describe('DigitalOcean metrics read the Monitoring API', () => {
  const t0 = 1_700_000_000;
  const t1 = t0 + 60;

  function healthyResponses(url: string): unknown {
    if (url.includes('/monitoring/metrics/droplet/cpu')) {
      return monitoring([
        series({ host_id: '123', mode: 'idle' }, [[t0, '1900'], [t1, '2800']]),
        series({ host_id: '123', mode: 'user' }, [[t0, '100'], [t1, '160']]),
        series({ host_id: '123', mode: 'system' }, [[t0, '50'], [t1, '90']]),
        series({ host_id: '123', mode: 'iowait' }, [[t0, '0'], [t1, '0']]),
      ]);
    }
    if (url.includes('/monitoring/metrics/droplet/load_1')) return monitoring([series({ host_id: '123' }, [[t0, '0.25'], [t1, '0.5']])]);
    if (url.includes('/monitoring/metrics/droplet/load_5')) return monitoring([series({ host_id: '123' }, [[t1, '0.4']])]);
    if (url.includes('/monitoring/metrics/droplet/load_15')) return monitoring([series({ host_id: '123' }, [[t1, '0.3']])]);
    if (url.includes('/monitoring/metrics/droplet/memory_total')) return monitoring([series({ host_id: '123' }, [[t1, '1000000000']])]);
    if (url.includes('/monitoring/metrics/droplet/memory_available')) return monitoring([series({ host_id: '123' }, [[t1, '250000000']])]);
    if (url.includes('/monitoring/metrics/droplet/filesystem_size')) {
      return monitoring([series({ host_id: '123', device: '/dev/vda1', fstype: 'ext4', mountpoint: '/' }, [[t1, '20000000000']])]);
    }
    if (url.includes('/monitoring/metrics/droplet/filesystem_free')) {
      return monitoring([series({ host_id: '123', device: '/dev/vda1', fstype: 'ext4', mountpoint: '/' }, [[t1, '5000000000']])]);
    }
    throw new Error(`Unexpected DigitalOcean request: ${url}`);
  }

  it('queries the documented monitoring endpoints with host_id/start/end, never /neighbors', async () => {
    const { instance, urls } = digitaloceanAdapter(healthyResponses);
    await instance.getServerMetrics('123');

    expect(urls).toHaveLength(8);
    for (const url of urls) {
      expect(url).toContain('https://api.digitalocean.test/v2/monitoring/metrics/droplet/');
      expect(url).toContain('host_id=123');
      expect(url).toMatch(/start=\d{9,}/);
      expect(url).toMatch(/end=\d{9,}/);
      // The regression this pins: /droplets/{id}/neighbors lists other customers' droplets on the
      // same physical host and is not a metrics endpoint.
      expect(url).not.toContain('neighbors');
    }
    expect(urls.map((url) => url.split('/droplet/')[1]?.split('?')[0]).sort()).toEqual(
      ['cpu', 'filesystem_free', 'filesystem_size', 'load_1', 'load_15', 'load_5', 'memory_available', 'memory_total']
    );
  });

  it('derives CPU utilisation from the per-mode counters and reports gauges honestly', async () => {
    const { instance } = digitaloceanAdapter(healthyResponses);
    const result = await instance.getServerMetrics('123');
    const metrics = result.metrics as Record<string, any>;

    // Δtotal = 900 idle + 60 user + 40 system + 0 iowait = 1000; used = 100 → 10%.
    expect(metrics.cpuPercent).toBe(10);
    expect(metrics.cpuCounterDeltas).toMatchObject({ idle: 900, user: 60, system: 40, iowait: 0 });

    expect(metrics.load_1).toMatchObject({ latest: 0.5, maximum: 0.5, samples: 2 });
    expect(metrics.load_5).toMatchObject({ latest: 0.4, samples: 1 });
    expect(metrics.memoryTotalBytes).toMatchObject({ latest: 1_000_000_000 });
    expect(metrics.memoryAvailableBytes).toMatchObject({ latest: 250_000_000 });
    expect(metrics.memoryUsedPercent).toBe(75);

    // Provider labels are passed through, not renamed or guessed at.
    expect(metrics.filesystems).toEqual([
      {
        labels: { host_id: '123', device: '/dev/vda1', fstype: 'ext4', mountpoint: '/' },
        sizeBytes: 20_000_000_000,
        freeBytes: 5_000_000_000,
        usedPercent: 75,
      },
    ]);

    expect(result.missing).toEqual([]);
    expect(result.provider).toBe('digitalocean');
    expect(result.dropletId).toBe('123');
  });

  it('reports an unmonitored droplet as missing metrics instead of inventing zeros', async () => {
    // DigitalOcean answers 200 with an empty result set when the monitoring agent is not reporting.
    const { instance } = digitaloceanAdapter(() => monitoring([]));
    const result = await instance.getServerMetrics('123');
    const metrics = result.metrics as Record<string, any>;

    expect(result.missing).toEqual(['cpu', 'load_1', 'load_5', 'load_15', 'memory', 'filesystem']);
    expect(metrics.cpuPercent).toBeNull();
    expect(metrics.load_1).toBeNull();
    expect(metrics.memoryTotalBytes).toBeNull();
    expect(metrics.memoryUsedPercent).toBeNull();
    expect(metrics.filesystems).toEqual([]);
    expect(Object.keys(result.missingReasons as Record<string, string>)).toHaveLength(6);
    // Nothing anywhere claims a measured 0%.
    expect(JSON.stringify(metrics)).not.toContain('"cpuPercent":0');
  });

  it('refuses to compute CPU from a counter that went backwards (droplet rebooted in-window)', async () => {
    const { instance } = digitaloceanAdapter((url: string) => {
      if (url.includes('/droplet/cpu')) {
        return monitoring([
          series({ host_id: '123', mode: 'idle' }, [[t0, '5000'], [t1, '900']]),
          series({ host_id: '123', mode: 'user' }, [[t0, '100'], [t1, '160']]),
        ]);
      }
      return monitoring([]);
    });
    const result = await instance.getServerMetrics('123');
    const metrics = result.metrics as Record<string, any>;

    expect(metrics.cpuPercent).toBeNull();
    expect(result.missing).toContain('cpu');
  });

  it('fails closed without a token, before any request', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new DigitalOceanProviderAdapter(providerRow('digitalocean', 'https://api.digitalocean.test/v2'), {} as NodeJS.ProcessEnv);
    await expect(adapter.getServerMetrics('123')).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Vultr metrics report the only thing Vultr measures', () => {
  it('reads the documented bandwidth endpoint with a bounded date_range', async () => {
    const { instance, urls } = vultrAdapter({
      bandwidth: {
        '2026-09-30': { incoming_bytes: 100, outgoing_bytes: 200 },
        '2026-09-29': { incoming_bytes: 50, outgoing_bytes: 25 },
      },
    });
    const result = await instance.getServerMetrics('inst-1');

    expect(urls).toHaveLength(1);
    expect(urls[0]).toBe('https://api.vultr.test/v2/instances/inst-1/bandwidth?date_range=30');

    // Sorted by day, exactly as reported, with the totals made explicit.
    expect((result.metrics as any).bandwidth.days).toEqual([
      { date: '2026-09-29', incomingBytes: 50, outgoingBytes: 25 },
      { date: '2026-09-30', incomingBytes: 100, outgoingBytes: 200 },
    ]);
    expect((result.metrics as any).bandwidth.daysReported).toBe(2);
    expect((result.metrics as any).bandwidth.totalIncomingBytes).toBe(150);
    expect((result.metrics as any).bandwidth.totalOutgoingBytes).toBe(225);
  });

  it('names every metric Vultr does not expose rather than implying they were measured', async () => {
    const { instance } = vultrAdapter({ bandwidth: { '2026-09-30': { incoming_bytes: 1, outgoing_bytes: 2 } } });
    const result = await instance.getServerMetrics('inst-1');

    expect(result.missing).toEqual(['cpu', 'memory', 'filesystem', 'load']);
    expect(result.missingReasons).toMatchObject({ cpu: expect.stringMatching(/no endpoint/i) });
    expect(typeof result.note).toBe('string');
    expect(result.note).toMatch(/bandwidth/i);
  });

  it('skips a day whose counters are not numbers instead of coercing them to zero', async () => {
    const { instance } = vultrAdapter({
      bandwidth: {
        '2026-09-30': { incoming_bytes: 100, outgoing_bytes: 200 },
        '2026-09-29': { incoming_bytes: 'not-a-number', outgoing_bytes: null },
        '2026-09-28': null,
      },
    });
    const result = await instance.getServerMetrics('inst-1');
    expect((result.metrics as any).bandwidth.days).toEqual([{ date: '2026-09-30', incomingBytes: 100, outgoingBytes: 200 }]);
  });

  it('reports an empty bandwidth object as no data, not as zero traffic', async () => {
    const { instance } = vultrAdapter({ bandwidth: {} });
    const result = await instance.getServerMetrics('inst-1');
    const bandwidth = (result.metrics as any).bandwidth;
    expect(bandwidth.days).toEqual([]);
    expect(bandwidth.daysReported).toBe(0);
    // null, not 0: Vultr reported no history, which is not the same as measuring no traffic.
    expect(bandwidth.totalIncomingBytes).toBeNull();
    expect(bandwidth.totalOutgoingBytes).toBeNull();
    expect(result.missing).toContain('cpu');
  });

  it('fails closed without an API key, before any request', async () => {
    const fetchMock = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new VultrProviderAdapter(providerRow('vultr', 'https://api.vultr.test/v2'), {} as NodeJS.ProcessEnv);
    await expect(adapter.getServerMetrics('inst-1')).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
