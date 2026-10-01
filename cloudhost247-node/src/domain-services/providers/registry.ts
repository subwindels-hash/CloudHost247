import {
  DomainProviderError,
  type DomainProviderAdapter,
  type DomainProviderConfig,
} from './types';

/**
 * Concrete adapters are registered by their own module. This registry deliberately starts empty:
 * configuring an arbitrary key in the database must not make an unsupported provider look live.
 */
export type DomainProviderAdapterFactory = (config: DomainProviderConfig) => DomainProviderAdapter;

const factories = new Map<string, DomainProviderAdapterFactory>();

export function registerDomainProviderAdapter(adapterKey: string, factory: DomainProviderAdapterFactory): void {
  const normalized = adapterKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,78}$/.test(normalized)) {
    throw new Error('Domain provider adapter keys must be lowercase letters, numbers, underscores, or hyphens');
  }
  if (factories.has(normalized)) throw new Error(`Domain provider adapter '${normalized}' is already registered`);
  factories.set(normalized, factory);
}

export function registeredDomainProviderAdapters(): string[] {
  return [...factories.keys()].sort();
}

/**
 * Resolves only a compiled, registered adapter. There is no generic HTTP fallback: guessing a
 * registrar protocol would be worse than failing closed because it could misstate availability,
 * pricing, registration or transfer state.
 */
export function createDomainProviderAdapter(config: DomainProviderConfig): DomainProviderAdapter {
  const key = config.adapterKey.trim().toLowerCase();
  const factory = factories.get(key);
  if (!factory) {
    throw new DomainProviderError(
      'ADAPTER_NOT_INSTALLED',
      `The ${key || 'selected'} domain provider adapter is not installed in this CloudHost247 build`,
      false
    );
  }
  return factory(config);
}

/** Test-only cleanup seam; production code never removes an adapter at runtime. */
export function resetDomainProviderAdaptersForTesting(): void {
  factories.clear();
}
