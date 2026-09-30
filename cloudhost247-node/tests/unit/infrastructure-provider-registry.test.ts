import { describe, expect, it, vi } from 'vitest';
import { createInfrastructureProviderAdapter } from '../../src/infrastructure/providers/registry';
import { ProviderError } from '../../src/infrastructure/providers/types';
import type { InfrastructureProviderRow, ProviderAdapterKind, ProviderType } from '../../src/db/infrastructure-providers';

function provider(adapter: ProviderAdapterKind, type: ProviderType = 'OTHER'): InfrastructureProviderRow {
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
  };
}

describe('infrastructure provider registry fails closed', () => {
  it('does not silently substitute a mock for an unavailable native adapter', async () => {
    const adapter = createInfrastructureProviderAdapter(provider('openstack', 'OPENSTACK'), {} as NodeJS.ProcessEnv);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('does not contact Hetzner or claim configuration without a server-side token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const adapter = createInfrastructureProviderAdapter(provider('hetzner', 'HETZNER'), {} as NodeJS.ProcessEnv);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
      retryable: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('fails closed when DigitalOcean token is absent', async () => {
    const adapter = createInfrastructureProviderAdapter(provider('digitalocean', 'DIGITALOCEAN'), {} as NodeJS.ProcessEnv);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  it('fails closed when Vultr API key is absent', async () => {
    const adapter = createInfrastructureProviderAdapter(provider('vultr', 'VULTR'), {} as NodeJS.ProcessEnv);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  it('fails closed when AWS credentials are absent', async () => {
    const adapter = createInfrastructureProviderAdapter(provider('aws', 'AWS'), {} as NodeJS.ProcessEnv);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  it('fails closed when OVH credentials are absent', async () => {
    const adapter = createInfrastructureProviderAdapter(provider('ovh', 'OVH'), {} as NodeJS.ProcessEnv);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  it('fails closed when Contabo credentials are absent', async () => {
    const adapter = createInfrastructureProviderAdapter(provider('contabo', 'CONTABO'), {} as NodeJS.ProcessEnv);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });

  it('requires both HTTPS bridge configuration and a prefixed token for generic integrations', async () => {
    const adapter = createInfrastructureProviderAdapter({
      ...provider('generic_http', 'OTHER'),
      api_base_url: 'https://bridge.example.test',
      credential_env_prefix: 'PRIVATE_BRIDGE',
    }, {} as NodeJS.ProcessEnv);
    await expect(adapter.validateConfiguration()).rejects.toMatchObject<Partial<ProviderError>>({
      code: 'PROVIDER_NOT_CONFIGURED',
    });
  });
});
