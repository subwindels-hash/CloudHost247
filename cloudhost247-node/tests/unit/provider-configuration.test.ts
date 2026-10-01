import { describe, expect, it, vi } from 'vitest';
import { ADAPTER_PROFILES, describeProviderConfiguration } from '../../src/infrastructure/providers/configuration';
import { createInfrastructureProviderAdapter } from '../../src/infrastructure/providers/registry';
import { ProviderError } from '../../src/infrastructure/providers/types';
import type { InfrastructureProviderRow, ProviderAdapterKind, ProviderType } from '../../src/db/infrastructure-providers';

function provider(
  adapter: ProviderAdapterKind,
  type: ProviderType = 'OTHER',
  overrides: Partial<InfrastructureProviderRow> = {}
): InfrastructureProviderRow {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    name: 'Provider',
    slug: 'provider',
    provider_type: type,
    adapter,
    status: 'ACTIVE',
    api_base_url: null,
    credential_env_prefix: null,
    capabilities: {},
    metadata: {},
    last_health_check_at: null,
    last_health_status: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('every adapter kind fails closed without server-side credentials', () => {
  const kinds: Array<[ProviderAdapterKind, ProviderType]> = [
    ['hetzner', 'HETZNER'],
    ['ovh', 'OVH'],
    ['proxmox', 'PROXMOX'],
    ['virtualizor', 'VIRTUALIZOR'],
    ['solusvm', 'SOLUSVM'],
    ['openstack', 'OPENSTACK'],
    ['aws', 'AWS'],
    ['digitalocean', 'DIGITALOCEAN'],
    ['vultr', 'VULTR'],
    ['contabo', 'CONTABO'],
  ];

  for (const [adapter, type] of kinds) {
    it(`${adapter} refuses to provision and never contacts the network`, async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const instance = createInfrastructureProviderAdapter(
        provider(adapter, type, { api_base_url: 'https://panel.example.test' }),
        {} as NodeJS.ProcessEnv
      );
      await expect(instance.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
        code: 'PROVIDER_NOT_CONFIGURED',
        retryable: false,
      });
      await expect(
        instance.createServer({
          idempotencyKey: 'job-1',
          hostname: 'test.example.com',
          planMetadata: { cpuCores: 2, memoryMb: 2048, storageMb: 20480 },
          image: {
            provider_image_id: 'image-1',
            architecture: 'x86_64',
          } as never,
          regionCode: 'eu-central',
          datacenterCode: null,
          sshPublicKeys: ['ssh-ed25519 AAAA test@example.com'],
          userData: '#cloud-config\n',
        })
      ).rejects.toBeInstanceOf(ProviderError);
      expect(fetchMock).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  }

  it('an unknown adapter is never substituted by a working or mock implementation', async () => {
    const instance = createInfrastructureProviderAdapter(
      provider('not-a-real-adapter' as ProviderAdapterKind),
      {} as NodeJS.ProcessEnv
    );
    await expect(instance.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'SERVICE_UNAVAILABLE',
      retryable: false,
    });
  });

  it('refuses to send a generic bridge bearer token over external plaintext HTTP', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const instance = createInfrastructureProviderAdapter(
      provider('generic_http', 'GENERIC_HTTP', {
        api_base_url: 'http://bridge.example.test',
        credential_env_prefix: 'BRIDGE',
      }),
      { BRIDGE_API_TOKEN: 'bridge-secret-token' } as NodeJS.ProcessEnv,
    );
    await expect(instance.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'INVALID_CONFIGURATION',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('mock provider isolation', () => {
  const mockProvider = provider('mock' as ProviderAdapterKind, 'MOCK' as ProviderType);

  it('refuses to run in production even when explicitly allowed', async () => {
    const instance = createInfrastructureProviderAdapter(mockProvider, {
      NODE_ENV: 'production',
      ALLOW_MOCK_PROVIDER: 'true',
    } as NodeJS.ProcessEnv);
    await expect(instance.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'SERVICE_UNAVAILABLE',
      retryable: false,
    });
  });

  it('refuses to run outside production unless explicitly opted in', async () => {
    const instance = createInfrastructureProviderAdapter(mockProvider, { NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    await expect(instance.validateConfiguration()).rejects.toBeInstanceOf(ProviderError);
  });

  it('only works in development with the explicit opt-in, and marks its resources as mock', async () => {
    const instance = createInfrastructureProviderAdapter(mockProvider, {
      NODE_ENV: 'development',
      ALLOW_MOCK_PROVIDER: 'true',
    } as NodeJS.ProcessEnv);
    await expect(instance.validateConfiguration()).resolves.toBeUndefined();
    const created = await instance.createServer({
      idempotencyKey: 'mock-job-1',
      hostname: 'dev.example.com',
      planMetadata: { cpuCores: 1, memoryMb: 1024, storageMb: 10240 },
      image: { provider_image_id: 'mock-image', architecture: 'x86_64' } as never,
      regionCode: 'dev',
      datacenterCode: null,
      sshPublicKeys: [],
      userData: '#cloud-config\n',
    });
    expect(created.id.startsWith('mock-')).toBe(true);
    expect(created.metadata).toMatchObject({ mock: true });
    // Idempotent: the same key resolves to the same resource instead of creating a second one.
    const again = await instance.findServerByIdempotencyKey('mock-job-1');
    expect(again?.id).toBe(created.id);
  });
});

describe('provider configuration reporting never leaks secrets', () => {
  it('lists required variables and reports what is missing', () => {
    const report = describeProviderConfiguration(provider('hetzner', 'HETZNER'), {} as NodeJS.ProcessEnv);
    expect(report.ready).toBe(false);
    expect(report.missing).toContain('HETZNER_API_TOKEN');
    expect(report.credentials.every((credential) => credential.present === false)).toBe(true);
  });

  it('reports ready once the prefixed variable exists, without echoing the value', () => {
    const secret = 'super-secret-token-value';
    const report = describeProviderConfiguration(
      provider('hetzner', 'HETZNER', { credential_env_prefix: 'HETZNER_EU' }),
      { HETZNER_EU_API_TOKEN: secret } as NodeJS.ProcessEnv
    );
    expect(report.ready).toBe(true);
    expect(report.credentials[0]).toMatchObject({ name: 'HETZNER_EU_API_TOKEN', present: true });
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it('reports native AWS and Contabo adapters as ready with their complete credentials', () => {
    const aws=describeProviderConfiguration(provider('aws','AWS'),{
      AWS_ACCESS_KEY_ID:'id',AWS_SECRET_ACCESS_KEY:'secret',AWS_REGION:'us-east-1',
    } as NodeJS.ProcessEnv);
    const contabo=describeProviderConfiguration(provider('contabo','CONTABO'),{
      CONTABO_CLIENT_ID:'id',CONTABO_CLIENT_SECRET:'secret',CONTABO_API_USER:'user',CONTABO_API_PASSWORD:'password',
    } as NodeJS.ProcessEnv);
    expect(aws.ready).toBe(true);expect(contabo.ready).toBe(true);
    expect(contabo.capabilities).toMatchObject({ reinstall: true, snapshot: true, resize: false });
  });

  it('accepts either OpenStack login mode', () => {
    const passwordLogin = describeProviderConfiguration(provider('openstack', 'OPENSTACK'), {
      OPENSTACK_AUTH_URL: 'https://keystone.example.test/v3',
      OPENSTACK_USERNAME: 'svc',
      OPENSTACK_PASSWORD: 'pw',
      OPENSTACK_PROJECT_ID: 'project',
    } as NodeJS.ProcessEnv);
    expect(passwordLogin.ready).toBe(true);
    const tokenLogin = describeProviderConfiguration(
      provider('openstack', 'OPENSTACK', { api_base_url: 'https://nova.example.test/v2.1' }),
      { OPENSTACK_API_TOKEN: 'token' } as NodeJS.ProcessEnv
    );
    expect(tokenLogin.ready).toBe(true);
    expect(describeProviderConfiguration(provider('openstack', 'OPENSTACK'), {} as NodeJS.ProcessEnv).ready).toBe(false);
  });

  it('treats a self-hosted panel without an API base URL as incomplete', () => {
    const report = describeProviderConfiguration(provider('proxmox', 'PROXMOX'), {} as NodeJS.ProcessEnv);
    expect(report.apiBaseUrlRequired).toBe(true);
    expect(report.missing).toContain('api_base_url');
  });

  it('does not report an external plaintext bridge as ready', () => {
    const report = describeProviderConfiguration(
      provider('generic_http', 'GENERIC_HTTP', { api_base_url: 'http://bridge.example.test', credential_env_prefix: 'BRIDGE' }),
      { BRIDGE_API_TOKEN: 'bridge-secret-token' } as NodeJS.ProcessEnv,
    );
    expect(report.ready).toBe(false);
    expect(report.missing).toContain('api_base_url must use https');
    expect(JSON.stringify(report)).not.toContain('bridge-secret-token');
  });

  it('reports an unimplemented adapter as fail-closed rather than ready', () => {
    const report = describeProviderConfiguration(
      provider('not-a-real-adapter' as ProviderAdapterKind),
      {} as NodeJS.ProcessEnv
    );
    expect(report.ready).toBe(false);
    expect(report.missing).toContain('adapter implementation');
  });

  it('documents every adapter the registry can build', () => {
    for (const kind of Object.keys(ADAPTER_PROFILES)) {
      const profile = ADAPTER_PROFILES[kind as keyof typeof ADAPTER_PROFILES];
      expect(profile.label.length).toBeGreaterThan(0);
      expect(profile.defaultEnvPrefix.length).toBeGreaterThan(0);
      if (kind !== 'mock') expect(profile.credentials.length).toBeGreaterThan(0);
    }
  });
});
