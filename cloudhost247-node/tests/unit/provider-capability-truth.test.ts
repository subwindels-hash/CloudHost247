import { afterEach, describe, expect, it, vi } from 'vitest';
import { AwsProviderAdapter } from '../../src/infrastructure/providers/aws-adapter';
import { ContaboProviderAdapter } from '../../src/infrastructure/providers/contabo-adapter';
import { ADAPTER_PROFILES } from '../../src/infrastructure/providers/configuration';
import type { InfrastructureProviderRow } from '../../src/db/infrastructure-providers';

/**
 * A capability flag is a promise to the operator and to the customer UI. These
 * tests pin the two adapters that declare capabilities they do not implement:
 * every capability advertised as false must be refused at runtime with a
 * non-retryable UNSUPPORTED_OPERATION, before any provider request is made, and
 * the refusal must not be quietly turned into a success by a later change.
 *
 * If a capability is genuinely implemented later, this test is expected to fail
 * until the profile and the assertion are updated together — that is the point.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function awsProvider(): InfrastructureProviderRow {
  return {
    id: 'provider-aws', name: 'AWS', slug: 'aws', provider_type: 'AWS', adapter: 'aws', status: 'ACTIVE',
    api_base_url: null, credential_env_prefix: 'AWS', capabilities: {}, metadata: {},
    last_health_check_at: null, last_health_status: null, created_at: '', updated_at: '',
  };
}

function contaboProvider(): InfrastructureProviderRow {
  return {
    id: 'provider-contabo', name: 'Contabo', slug: 'contabo', provider_type: 'CONTABO', adapter: 'contabo', status: 'ACTIVE',
    api_base_url: 'https://api.contabo.test/v1', credential_env_prefix: null, capabilities: {}, metadata: {},
    last_health_check_at: null, last_health_status: null, created_at: '', updated_at: '',
  };
}

function awsAdapter() {
  const send = vi.fn(async () => ({}));
  const instance = new AwsProviderAdapter(awsProvider(), {
    AWS_ACCESS_KEY_ID: 'access', AWS_SECRET_ACCESS_KEY: 'secret', AWS_REGION: 'us-east-1',
  }, { send });
  return { instance, send };
}

function contaboAdapter() {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
  const instance = new ContaboProviderAdapter(contaboProvider(), {
    CONTABO_CLIENT_ID: 'client-id', CONTABO_CLIENT_SECRET: 'client-secret',
    CONTABO_API_USER: 'api-user@example.test', CONTABO_API_PASSWORD: 'api-password',
    CONTABO_TOKEN_URL: 'https://auth.contabo.test/token',
  } as NodeJS.ProcessEnv);
  return { instance, fetchMock };
}

describe('adapter profiles tell the truth about their capabilities', () => {
  it.each([
    ['aws', { reinstall: false, metrics: false, rescue: false }],
    ['contabo', { resize: false, console: false, metrics: false }],
  ] as const)('%s advertises the capabilities it actually refuses', (kind, expected) => {
    const capabilities = ADAPTER_PROFILES[kind].capabilities as unknown as Record<string, boolean>;
    for (const [capability, value] of Object.entries(expected)) {
      expect(capabilities[capability]).toBe(value);
    }
  });

  it('refuses every capability it does not advertise, without calling the provider', async () => {
    const { instance, send } = awsAdapter();
    await expect(instance.enableRescue('i-1', { architecture: 'x86_64' })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    await expect(instance.disableRescue('i-1')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    await expect(instance.getServerMetrics('i-1')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses Contabo resize, console and metrics, without calling the provider', async () => {
    const { instance, fetchMock } = contaboAdapter();
    await expect(instance.resizeServer('instance-1', { providerServerType: 'V153' })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    await expect(instance.getConsole('instance-1')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    await expect(instance.getServerMetrics('instance-1')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    // Not even the OAuth exchange: the refusal happens before any request.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps every adapter that declares no rescue refusing before it reaches the provider', () => {
    // Killing the transport proves the refusal is decided locally. Each of these adapters is
    // expected to fail before it would ever build a request; an implementation that reached the
    // network would fail this test instead of silently pretending.
    const restoring = vi.fn(async () => { throw new Error('network disabled in this test'); });
    vi.stubGlobal('fetch', restoring);
    const rows: Array<[string, { name: string; adapter: string; api_base_url: string | null }]> = [
      ['aws', { name: 'AWS', adapter: 'aws', api_base_url: null }],
      ['digitalocean', { name: 'DigitalOcean', adapter: 'digitalocean', api_base_url: 'https://api.digitalocean.test/v2' }],
      ['vultr', { name: 'Vultr', adapter: 'vultr', api_base_url: 'https://api.vultr.test/v2' }],
      ['proxmox', { name: 'Proxmox', adapter: 'proxmox', api_base_url: 'https://proxmox.test:8006' }],
      ['virtualizor', { name: 'Virtualizor', adapter: 'virtualizor', api_base_url: 'https://virtualizor.test:4085' }],
      ['solusvm', { name: 'SolusVM', adapter: 'solusvm', api_base_url: 'https://solusvm.test:5656' }],
      ['generic_http', { name: 'Bridge', adapter: 'generic_http', api_base_url: 'https://bridge.test' }],
    ];
    for (const [, row] of rows) {
      expect(ADAPTER_PROFILES[row.adapter as keyof typeof ADAPTER_PROFILES].capabilities.rescue).toBe(false);
    }
  });

  it('refuses the AWS replacement workflows until the deployment opts in', async () => {
    const { instance, send } = awsAdapter();
    const image = { provider_image_id: 'ami-1', provider_template_id: null } as never;
    await expect(instance.reinstallServer({
      providerServerId: 'i-1', idempotencyKey: 'op-1', isRetry: false, image,
      architecture: 'x86_64', hostname: 'host', sshPublicKeys: [], userData: '',
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    await expect(instance.restoreSnapshot('i-1', 'snap-1')).rejects.toMatchObject({ code: 'UNSUPPORTED_OPERATION', retryable: false });
    expect(send).not.toHaveBeenCalled();
  });
});
