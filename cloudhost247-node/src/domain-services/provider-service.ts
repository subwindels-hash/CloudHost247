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
import { registerBuiltInDomainProviderAdapters } from './providers/register-builtins';

// The compiled adapters (Namecheap, GoDaddy, RDAP, GoValue) are the only providers that can ever
// be resolved. Registration is idempotent and happens on first import of this module.
registerBuiltInDomainProviderAdapters();

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

/** Public-safe readiness query used by the Domain Services UI. */
export async function domainProviderReadiness(
  db: Queryable,
  providerType: DomainServiceProviderType
): Promise<{ configured: boolean; providerKey: string | null }> {
  const provider = await findConnectedDomainServiceProvider(db, providerType);
  return { configured: Boolean(provider), providerKey: provider?.provider_key ?? null };
}

interface ProviderRowForAdapter {
  id: string;
  provider_key: string;
  name: string;
  adapter_key: string;
  provider_type: DomainServiceProviderType;
  api_base_url: string | null;
  environment: 'sandbox' | 'production';
  capabilities: Record<string, unknown> | null;
  configuration: Record<string, unknown> | null;
}

/**
 * Resolves a specific provider row (by id) into a live adapter, for worker sweeps that must use
 * the provider recorded on the row being processed (registrations, transfers) rather than
 * "whatever is connected now". Returns null when the provider, its credentials, or its adapter
 * are unavailable — callers decide how to fail honestly for that record.
 */
export async function resolveDomainProviderById(
  db: Queryable,
  providerId: string | null
): Promise<{ provider: { id: string; name: string }; adapter: DomainProviderAdapter } | null> {
  if (!providerId) return null;
  const { rows } = await db.query<ProviderRowForAdapter>(
    `SELECT id, provider_key, name, adapter_key, provider_type, api_base_url, environment,
            capabilities, configuration
       FROM domain_service_providers WHERE id = $1`,
    [providerId]
  );
  const providerRow = rows[0];
  if (!providerRow) return null;

  const credentials = await getDomainServiceProviderCredentials(db, getKeyRing(), providerRow.id);
  if (!credentials) return null;

  try {
    const adapter = createDomainProviderAdapter({
      id: providerRow.id,
      key: providerRow.provider_key,
      name: providerRow.name,
      adapterKey: providerRow.adapter_key,
      type: providerRow.provider_type,
      environment: providerRow.environment,
      apiBaseUrl: providerRow.api_base_url,
      capabilities: providerRow.capabilities ?? {},
      configuration: providerRow.configuration ?? {},
      credentials,
    });
    return { provider: { id: providerRow.id, name: providerRow.name }, adapter };
  } catch {
    // ADAPTER_NOT_INSTALLED and friends: not resolvable, but never a crash in a sweep.
    return null;
  }
}
