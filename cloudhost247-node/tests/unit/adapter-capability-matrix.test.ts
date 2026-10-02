import { afterEach, describe, expect, it, vi } from 'vitest';
import { ADAPTER_PROFILES } from '../../src/infrastructure/providers/configuration';
import type { InfrastructureProviderAdapter } from '../../src/infrastructure/providers/types';
import type { InfrastructureProviderRow } from '../../src/db/infrastructure-providers';
import { HetznerProviderAdapter } from '../../src/infrastructure/providers/hetzner-adapter';
import { DigitalOceanProviderAdapter } from '../../src/infrastructure/providers/digitalocean-adapter';
import { VultrProviderAdapter } from '../../src/infrastructure/providers/vultr-adapter';
import { AwsProviderAdapter } from '../../src/infrastructure/providers/aws-adapter';
import { ContaboProviderAdapter } from '../../src/infrastructure/providers/contabo-adapter';
import { OvhProviderAdapter } from '../../src/infrastructure/providers/ovh-adapter';
import { ProxmoxProviderAdapter } from '../../src/infrastructure/providers/proxmox-adapter';
import { VirtualizorProviderAdapter } from '../../src/infrastructure/providers/virtualizor-adapter';
import { SolusvmProviderAdapter } from '../../src/infrastructure/providers/solusvm-adapter';
import { OpenStackProviderAdapter } from '../../src/infrastructure/providers/openstack-adapter';
import { GenericHttpProviderAdapter } from '../../src/infrastructure/providers/generic-http-adapter';
import { MockProviderAdapter, resetMockProviderState } from '../../src/infrastructure/providers/mock-adapter';

/**
 * The whole capability matrix — every adapter × every capability — pinned in BOTH directions.
 *
 * A capability flag is a promise with two ways to break it:
 *
 *   false ⇒ the adapter must refuse with a non-retryable `UNSUPPORTED_OPERATION` **before any
 *           provider request**. Otherwise the platform makes a call it told the operator it would
 *           never make, and a template can be sold an operation the adapter answers with unrelated
 *           data. (This is exactly how DigitalOcean's `getServerMetrics` came to return
 *           `/droplets/{id}/neighbors` — other customers' droplets on the same physical host — and
 *           how DigitalOcean and Vultr came to answer a "console" request with the resource's
 *           action history while advertising `console: true`.)
 *   true  ⇒ the adapter must never answer `UNSUPPORTED_OPERATION` unconditionally. Otherwise the
 *           flag advertises an operation the code refuses, the admin UI offers a button that always
 *           fails, and template validation forbids enabling a capability that actually works.
 *
 * Both directions are checked with the transport under test control: for the refusals the transport
 * *throws*, so an adapter that reached the network fails here instead of silently pretending; for
 * the advertised capabilities the transport is permissive, and any failure other than
 * `UNSUPPORTED_OPERATION` is accepted because this suite judges the capability decision, not each
 * provider's payload shape (those have their own suites).
 *
 * Documented exceptions, each asserted rather than skipped:
 *   - `aws.reinstall` is false *by default* and implemented behind the deployment opt-in
 *     `AWS_ALLOW_ROOT_VOLUME_REPLACEMENT=true` (see docs/NODE_PLATFORM_STATUS.md §"EC2 reinstall").
 *     Both halves are pinned below.
 *   - `aws.snapshot` and `solusvm.rescue` may refuse *conditionally* at runtime (an instance with no
 *     discoverable root volume; an arm64 server SolusVM would boot an x86 rescue kernel into). The
 *     fixtures here describe a server those conditions do not apply to, so the matrix still holds.
 */

type Capability = 'reinstall' | 'snapshot' | 'resize' | 'console' | 'metrics' | 'rescue';

const CAPABILITIES: readonly Capability[] = ['reinstall', 'snapshot', 'resize', 'console', 'metrics', 'rescue'];

const ADAPTER_KINDS = Object.keys(ADAPTER_PROFILES);

const BASE_URLS: Record<string, string | null> = {
  hetzner: 'https://api.hetzner.test/v1',
  digitalocean: 'https://api.digitalocean.test/v2',
  vultr: 'https://api.vultr.test/v2',
  aws: null,
  contabo: 'https://api.contabo.test/v1',
  ovh: 'https://eu.api.ovh.test/1.0',
  proxmox: 'https://proxmox.test:8006',
  virtualizor: 'https://virtualizor.test:4085',
  solusvm: 'https://solusvm.test:5656',
  openstack: 'https://nova.test:8774/v2.1',
  generic_http: 'https://bridge.test',
  mock: null,
};

const ENV_PREFIXES: Record<string, string | null> = {
  generic_http: 'BRIDGE',
  mock: null,
};

const CREDENTIALS: Record<string, NodeJS.ProcessEnv> = {
  hetzner: { HETZNER_API_TOKEN: 'token' },
  digitalocean: { DIGITALOCEAN_API_TOKEN: 'token' },
  vultr: { VULTR_API_KEY: 'token' },
  aws: { AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'us-east-1' },
  contabo: {
    CONTABO_CLIENT_ID: 'client-id', CONTABO_CLIENT_SECRET: 'client-secret',
    CONTABO_API_USER: 'api-user@example.test', CONTABO_API_PASSWORD: 'api-password',
    CONTABO_TOKEN_URL: 'https://auth.contabo.test/token',
  },
  ovh: {
    OVH_APPLICATION_KEY: 'app-key', OVH_APPLICATION_SECRET: 'app-secret',
    OVH_CONSUMER_KEY: 'consumer-key', OVH_CLOUD_PROJECT_ID: 'project-1',
  },
  proxmox: { PROXMOX_API_TOKEN: 'user@pve!token=uuid' },
  virtualizor: { VIRTUALIZOR_API_KEY: 'api-key', VIRTUALIZOR_API_SECRET: 'api-secret' },
  solusvm: { SOLUSVM_API_ID: 'api-id', SOLUSVM_API_KEY: 'api-key' },
  openstack: { OPENSTACK_API_TOKEN: 'keystone-token', OPENSTACK_API_URL: 'https://nova.test:8774/v2.1' },
  generic_http: { BRIDGE_API_TOKEN: 'bridge-token' },
  mock: { ALLOW_MOCK_PROVIDER: 'true', NODE_ENV: 'test' },
};

function providerRow(kind: string): InfrastructureProviderRow {
  return {
    id: `provider-${kind}`, name: kind, slug: kind, provider_type: kind.toUpperCase(),
    adapter: kind, status: 'ACTIVE', api_base_url: BASE_URLS[kind] ?? null,
    credential_env_prefix: kind in ENV_PREFIXES ? ENV_PREFIXES[kind] : null,
    capabilities: {}, metadata: {}, last_health_check_at: null, last_health_status: null,
    created_at: '', updated_at: '',
  };
}

/** Plan metadata broad enough that any adapter can find the key it expects. */
const PLAN_METADATA: Record<string, unknown> = {
  providerServerType: 'plan-1', providerFlavorId: 'flavor-1', providerSize: 'size-1',
  providerPlanId: 'plan-1', providerProductId: 'product-1', contaboPeriodMonths: '12',
  cpuCores: 2, memoryMb: 4096, storageMb: 81920,
};

const REINSTALL_INPUT = {
  providerServerId: 'srv-1', idempotencyKey: 'operation-matrix-1', isRetry: false,
  image: { provider_image_id: 'image-1', provider_template_id: 'template-1' },
  architecture: 'x86_64', hostname: 'matrix-host', sshPublicKeys: [], userData: '',
} as never;

const CALLS: Record<Capability, (adapter: InfrastructureProviderAdapter) => Promise<unknown>> = {
  reinstall: (adapter) => adapter.reinstallServer(REINSTALL_INPUT),
  snapshot: (adapter) => adapter.createSnapshot('srv-1', 'capability matrix snapshot'),
  resize: (adapter) => adapter.resizeServer('srv-1', PLAN_METADATA),
  console: (adapter) => adapter.getConsole('srv-1'),
  metrics: (adapter) => adapter.getServerMetrics('srv-1'),
  rescue: (adapter) => adapter.enableRescue('srv-1', { architecture: 'x86_64' }),
};

/** A plausible AWS EC2 fixture set, so conditional refusals do not fire for the wrong reason. */
function awsResponse(command: unknown): unknown {
  const name = (command as { constructor: { name: string } }).constructor.name;
  const instance = {
    InstanceId: 'i-matrix', InstanceType: 't3.micro', ImageId: 'ami-1',
    State: { Name: 'running' }, Placement: { AvailabilityZone: 'us-east-1a' },
    PublicIpAddress: '203.0.113.10',
    BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeId: 'vol-root', Status: 'attached' } }],
    Tags: [{ Key: 'Name', Value: 'matrix-host' }],
  };
  switch (name) {
    case 'DescribeInstancesCommand': return { Reservations: [{ Instances: [instance] }] };
    case 'RunInstancesCommand': return { Instances: [{ ...instance, InstanceId: 'i-replacement' }] };
    case 'CreateSnapshotCommand': return { SnapshotId: 'snap-1', State: 'pending' };
    case 'DescribeSnapshotsCommand': return { Snapshots: [{ SnapshotId: 'snap-1', State: 'completed' }] };
    case 'GetConsoleOutputCommand': return { Output: Buffer.from('boot log').toString('base64') };
    case 'GetMetricStatisticsCommand': return { Datapoints: [{ Average: 12.5, Maximum: 30, Unit: 'Percent', Timestamp: new Date() }] };
    case 'DescribeImagesCommand': return { Images: [{ ImageId: 'ami-1', Name: 'ubuntu', State: 'available', Architecture: 'x86_64' }] };
    default: return {};
  }
}

function buildAdapter(kind: string, mode: 'blocked' | 'permissive'): { adapter: InfrastructureProviderAdapter; transportCalls: () => number } {
  const env = CREDENTIALS[kind] as NodeJS.ProcessEnv;
  const row = providerRow(kind);

  if (kind === 'aws') {
    const send = vi.fn(async (command: unknown) => {
      if (mode === 'blocked') throw new Error('network disabled in this test');
      return awsResponse(command);
    });
    return { adapter: new AwsProviderAdapter(row, env, { send }) as unknown as InfrastructureProviderAdapter, transportCalls: () => send.mock.calls.length };
  }

  let calls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (mode === 'blocked') throw new Error(`network disabled in this test (${String(input)} ${init?.method ?? 'GET'})`);
    const url = String(input);
    const body: unknown = permissivePayload(kind, url, init?.method ?? 'GET');
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);

  const adapter = (() => {
    switch (kind) {
      case 'hetzner': return new HetznerProviderAdapter(row, env);
      case 'digitalocean': return new DigitalOceanProviderAdapter(row, env);
      case 'vultr': return new VultrProviderAdapter(row, env);
      case 'contabo': return new ContaboProviderAdapter(row, env);
      case 'ovh': return new OvhProviderAdapter(row, env);
      case 'proxmox': return new ProxmoxProviderAdapter(row, env);
      case 'virtualizor': return new VirtualizorProviderAdapter(row, env);
      case 'solusvm': return new SolusvmProviderAdapter(row, env);
      case 'openstack': return new OpenStackProviderAdapter(row, env);
      case 'generic_http': return new GenericHttpProviderAdapter(row, env);
      case 'mock': return new MockProviderAdapter(row, env);
      default: throw new Error(`no adapter builder for ${kind}`);
    }
  })();
  return { adapter, transportCalls: () => calls };
}

/**
 * Permissive-mode payloads. The point is only that the adapter is *willing* to perform the
 * operation, so a minimal well-shaped envelope is enough; adapters that need more have their own
 * suites. Anything these do not satisfy produces a parse/configuration error, which this suite
 * accepts — it fails only on `UNSUPPORTED_OPERATION`.
 */
function permissivePayload(kind: string, url: string, method: string): unknown {
  if (kind === 'contabo' && url.includes('/token')) {
    return { access_token: 'token', token_type: 'bearer', expires_in: 3600 };
  }
  if (kind === 'openstack') {
    // Keystone-style envelopes: the client validates the shape before the adapter can use it.
    if (url.includes('/remote_console')) return { remote_console: { type: 'novnc', protocol: 'vnc', url: 'https://nova.test/console' } };
    return {};
  }
  if (kind === 'solusvm') {
    // SolusVM answers form-encoded key=value with a status field.
    return { status: 'success', statusmsg: 'ok', password: 'one-time', user: 'root', port: '600', ip: '203.0.113.20', hostname: 'matrix-host' };
  }
  if (kind === 'virtualizor') {
    return { status: 1, done: 1, info: { vps_name: 'matrix' }, act: 'listvs' };
  }
  if (kind === 'proxmox') {
    return { data: method === 'POST' ? { UPID: 'upid-1' } : { cpu: 0.1, mem: 1024, disk: 2048, status: 'running', template: 0 } };
  }
  if (kind === 'ovh') {
    if (url.endsWith('/instance/srv-1')) return { id: 'srv-1', name: 'matrix-host', status: 'ACTIVE', ipAddresses: [{ ip: '203.0.113.5', version: 'v4', type: 'public' }], imageId: 'image-1', region: 'GRA11' };
    return {};
  }
  if (kind === 'generic_http') {
    return { id: 'srv-1', status: 'running', name: 'matrix-host', ipAddress: '203.0.113.7', imageId: 'image-1', metadata: {} };
  }
  if (kind === 'hetzner') {
    return { server: { id: 1, name: 'matrix-host', status: 'running', public_net: { ipv4: { ip: '203.0.113.9' } } } };
  }
  if (kind === 'digitalocean') {
    return { droplet: { id: 1, name: 'matrix-host', status: 'active', networks: { v4: [{ ip_address: '203.0.113.11', type: 'public' }] } }, action: { id: 1, status: 'in-progress' } };
  }
  if (kind === 'vultr') {
    return { instance: { id: 'srv-1', label: 'matrix-host', status: 'active', main_ip: '203.0.113.12' }, bandwidth: {} };
  }
  return {};
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetMockProviderState();
});

describe('every adapter capability flag matches its implementation', () => {
  it('covers the whole matrix (no adapter or capability is left unasserted)', () => {
    expect(ADAPTER_KINDS.sort()).toEqual(
      ['aws', 'contabo', 'digitalocean', 'generic_http', 'hetzner', 'mock', 'openstack', 'ovh', 'proxmox', 'solusvm', 'virtualizor', 'vultr']
    );
    for (const kind of ADAPTER_KINDS) {
      for (const capability of CAPABILITIES) {
        expect(typeof ADAPTER_PROFILES[kind as keyof typeof ADAPTER_PROFILES].capabilities[capability]).toBe('boolean');
      }
    }
  });

  describe('a capability advertised false is refused before any provider request', () => {
    const refused: Array<[string, Capability]> = [];
    for (const kind of ADAPTER_KINDS) {
      for (const capability of CAPABILITIES) {
        if (ADAPTER_PROFILES[kind as keyof typeof ADAPTER_PROFILES].capabilities[capability] === false) {
          refused.push([kind, capability]);
        }
      }
    }

    it.each(refused)('%s refuses %s', async (kind, capability) => {
      const { adapter, transportCalls } = buildAdapter(kind, 'blocked');
      await expect(CALLS[capability](adapter)).rejects.toMatchObject({
        code: 'UNSUPPORTED_OPERATION',
        retryable: false,
      });
      // The refusal is decided locally: not one byte reached the provider.
      expect(transportCalls()).toBe(0);
    });

    it('finds refusals to assert (the matrix is not vacuously passing)', () => {
      expect(refused.length).toBeGreaterThan(8);
    });
  });

  describe('a capability advertised true is never refused unconditionally', () => {
    const advertised: Array<[string, Capability]> = [];
    for (const kind of ADAPTER_KINDS) {
      for (const capability of CAPABILITIES) {
        if (ADAPTER_PROFILES[kind as keyof typeof ADAPTER_PROFILES].capabilities[capability] === true) {
          advertised.push([kind, capability]);
        }
      }
    }

    it.each(advertised)('%s performs %s', async (kind, capability) => {
      const { adapter } = buildAdapter(kind, 'permissive');
      const outcome = await CALLS[capability](adapter).then(
        () => null,
        (error: unknown) => error as { code?: string; message?: string }
      );
      if (outcome) {
        expect(
          outcome.code,
          `${kind}.${capability} is advertised but refuses with UNSUPPORTED_OPERATION: ${outcome.message ?? ''}`
        ).not.toBe('UNSUPPORTED_OPERATION');
      }
    });

    it('finds advertised capabilities to assert (the matrix is not vacuously passing)', () => {
      expect(advertised.length).toBeGreaterThan(40);
    });
  });

  it('keeps the AWS reinstall opt-in honest in both states', async () => {
    // Default: refused, before any AWS call.
    const gated = buildAdapter('aws', 'blocked');
    await expect(CALLS.reinstall(gated.adapter)).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    expect(gated.transportCalls()).toBe(0);

    // Opted in: the replacement workflow actually runs (see tests/unit/aws-replacement.test.ts for
    // the full call-shape assertions).
    vi.unstubAllGlobals();
    const send = vi.fn(async (command: unknown) => awsResponse(command));
    const enabled = new AwsProviderAdapter(providerRow('aws'), {
      ...(CREDENTIALS.aws as NodeJS.ProcessEnv), AWS_ALLOW_ROOT_VOLUME_REPLACEMENT: 'true',
    }, { send });
    const outcome = await enabled.reinstallServer(REINSTALL_INPUT).then(
      () => null,
      (error: unknown) => error as { code?: string }
    );
    expect(outcome?.code).not.toBe('UNSUPPORTED_OPERATION');
    expect(send).toHaveBeenCalled();
  });
});
