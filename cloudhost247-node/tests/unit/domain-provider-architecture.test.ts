import { afterEach, describe, expect, it } from 'vitest';
import {
  createDomainProviderAdapter,
  registerDomainProviderAdapter,
  registeredDomainProviderAdapters,
  resetDomainProviderAdaptersForTesting,
} from '../../src/domain-services/providers/registry';
import { DomainProviderError, safeDomainProviderMessage, type DomainProviderConfig } from '../../src/domain-services/providers/types';

const config: DomainProviderConfig = {
  id: 'provider-id',
  key: 'registrar-primary',
  name: 'Registrar primary',
  adapterKey: 'uninstalled-registrar',
  type: 'registrar',
  environment: 'sandbox',
  apiBaseUrl: 'https://registrar.example.test',
  capabilities: {},
  configuration: {},
  credentials: { apiKey: 'secret' },
};

describe('domain-provider architecture', () => {
  afterEach(() => resetDomainProviderAdaptersForTesting());

  it('fails closed when a database provider names an adapter that is not compiled', () => {
    expect(() => createDomainProviderAdapter(config)).toThrow(DomainProviderError);
    try {
      createDomainProviderAdapter(config);
    } catch (error) {
      expect(error).toMatchObject({ code: 'ADAPTER_NOT_INSTALLED', retryable: false });
      expect(safeDomainProviderMessage(error)).toBe('Service Provider Not Configured');
    }
  });

  it('requires explicit one-time adapter registration and never selects a fallback', () => {
    const adapter = {
      key: 'real-adapter',
      capabilities: { availability: true },
      testConnection: async () => ({ status: 'connected' as const, message: 'Connected', capabilities: { availability: true } }),
      checkAvailability: async () => [],
      getPricing: async () => [],
      getExtensions: async () => [],
      registerDomain: async () => { throw new DomainProviderError('UNSUPPORTED_OPERATION', 'not supported', false); },
      transferDomain: async () => { throw new DomainProviderError('UNSUPPORTED_OPERATION', 'not supported', false); },
      getDomainStatus: async () => { throw new DomainProviderError('UNSUPPORTED_OPERATION', 'not supported', false); },
      getDomainInfo: async () => { throw new DomainProviderError('UNSUPPORTED_OPERATION', 'not supported', false); },
      appraiseDomain: async () => { throw new DomainProviderError('UNSUPPORTED_OPERATION', 'not supported', false); },
    };
    registerDomainProviderAdapter('real-adapter', () => adapter);

    expect(registeredDomainProviderAdapters()).toEqual(['real-adapter']);
    expect(createDomainProviderAdapter({ ...config, adapterKey: 'real-adapter' })).toBe(adapter);
    expect(() => registerDomainProviderAdapter('real-adapter', () => adapter)).toThrow(/already registered/i);
  });

  it('uses a safe generic customer message for provider errors', () => {
    expect(safeDomainProviderMessage(new DomainProviderError('AUTHENTICATION_FAILED', 'vendor says token=secret', false)))
      .toBe('Domain provider is unavailable. Please try again later.');
    expect(safeDomainProviderMessage(new Error('database credentials')))
      .toBe('We could not complete this request right now. Please try again.');
  });
});
