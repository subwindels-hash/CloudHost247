import type { Queryable } from '../db/types';
import {
  findConnectedDomainServiceProvider,
  getDomainServiceProviderCredentials,
  type DomainServiceProviderRow,
  type DomainServiceProviderType,
} from '../db/domain-services';
import { getKeyRing } from '../lib/keyring';
import { createDomainProviderAdapter } from './providers/registry';
import { DomainProviderError, type DomainProviderAdapter, type DomainProviderConfig } from './providers/types';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function configFrom(provider: DomainServiceProviderRow, credentials: Record<string, string>): DomainProviderConfig {
  return {
    id: provider.id,
    key: provider.provider_key,
    name: provider.name,
    adapterKey: provider.adapter_key,
    type: provider.provider_type,
    environment: provider.environment,
    apiBaseUrl: provider.api_base_url,
    capabilities: asRecord(provider.capabilities),
    configuration: asRecord(provider.configuration),
    credentials,
  };
}

/**
 * Resolves the currently connection-tested provider for one capability domain. A configured-but
 * untested account is deliberately not usable: production search and ordering must fail closed
 * until Super Admin has performed a successful real connection test.
 */
export async function resolveConnectedDomainProvider(
  db: Queryable,
  providerType: DomainServiceProviderType
): Promise<{ provider: DomainServiceProviderRow; adapter: DomainProviderAdapter }> {
  const provider = await findConnectedDomainServiceProvider(db, providerType);
  if (!provider) {
    throw new DomainProviderError(
      'PROVIDER_NOT_CONFIGURED',
      `No connected ${providerType} domain provider is configured`,
      false
    );
  }

  const credentials = await getDomainServiceProviderCredentials(db, getKeyRing(), provider.id);
  if (!credentials) {
    // A database status must never overrule the credential invariant.
    throw new DomainProviderError(
      'PROVIDER_NOT_CONFIGURED',
      `Connected ${providerType} provider '${provider.provider_key}' has no credentials`,
      false
    );
  }

  return { provider, adapter: createDomainProviderAdapter(configFrom(provider, credentials)) };
}

/** Public-safe readiness query used by the forthcoming Domain Services UI. */
export async function domainProviderReadiness(
  db: Queryable,
  providerType: DomainServiceProviderType
): Promise<{ configured: boolean; providerKey: string | null }> {
  const provider = await findConnectedDomainServiceProvider(db, providerType);
  return { configured: Boolean(provider), providerKey: provider?.provider_key ?? null };
}
