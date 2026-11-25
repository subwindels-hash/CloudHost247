import type { Queryable } from '../../db/types';
import {
  getInfrastructureProviderCredentials,
  listInfrastructureProviderCredentialNames,
  type InfrastructureProviderRow,
} from '../../db/infrastructure-providers';
import { getKeyRing } from '../../lib/keyring';
import { describeProviderConfiguration, getAdapterProfile, type ProviderConfigurationReport } from './configuration';
import { createInfrastructureProviderAdapter } from './registry';
import { ProviderError, type InfrastructureProviderAdapter } from './types';

/** Matches the prefix convention used by provider adapters, including per-provider bridge tokens. */
export function providerCredentialPrefix(provider: Pick<InfrastructureProviderRow, 'adapter' | 'slug' | 'credential_env_prefix'>): string {
  if (provider.credential_env_prefix) return provider.credential_env_prefix;
  if (provider.adapter === 'generic_http') return provider.slug.replace(/-/g, '_').toUpperCase();
  return getAdapterProfile(provider.adapter)?.defaultEnvPrefix ?? '';
}

/** Adds decrypted provider credentials to an isolated env-like object for one adapter instance. */
export function providerCredentialSource(
  provider: InfrastructureProviderRow,
  credentials: Record<string, string> | null,
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...source };
  if (!credentials) return merged;
  const prefix = providerCredentialPrefix(provider);
  for (const [suffix, value] of Object.entries(credentials)) {
    // All persisted fields are checked against the adapter profile on write. Keep a second guard
    // at the use boundary so an old or manually edited row cannot become an arbitrary env key.
    if (!/^_[A-Z0-9_]{1,95}$/.test(suffix) || !getAdapterProfile(provider.adapter)?.credentials.some((item) => item.suffix === suffix)) {
      continue;
    }
    merged[`${prefix}${suffix}`] = value;
  }
  return merged;
}

/** Resolves a provider adapter with encrypted dashboard credentials, falling back to process env. */
export async function loadInfrastructureProviderCredentials(db: Queryable, providerId: string): Promise<Record<string, string> | null> {
  const names = await listInfrastructureProviderCredentialNames(db, providerId);
  if (names.length === 0) return null;
  return getInfrastructureProviderCredentials(db, getKeyRing(), providerId);
}

export async function createConfiguredInfrastructureProviderAdapter(
  db: Queryable,
  provider: InfrastructureProviderRow,
  source: NodeJS.ProcessEnv = process.env
): Promise<InfrastructureProviderAdapter> {
  let credentials: Record<string, string> | null;
  try {
    credentials = await loadInfrastructureProviderCredentials(db, provider.id);
  } catch (error) {
    throw new ProviderError(
      'CONFIGURATION_REQUIRED',
      error instanceof Error ? error.message : 'Stored provider credentials could not be read; a Super Admin must re-enter them.',
      false
    );
  }
  return createInfrastructureProviderAdapter(provider, providerCredentialSource(provider, credentials, source));
}

/** Names/presence only. Stored ciphertext is not decrypted for an admin configuration report. */
export async function describeConfiguredProvider(
  db: Queryable,
  provider: InfrastructureProviderRow,
  source: NodeJS.ProcessEnv = process.env
): Promise<ProviderConfigurationReport> {
  const credentialNames = new Set(await listInfrastructureProviderCredentialNames(db, provider.id));
  const prefix = providerCredentialPrefix(provider);
  const presenceSource: NodeJS.ProcessEnv = { ...source };
  for (const suffix of credentialNames) {
    if (getAdapterProfile(provider.adapter)?.credentials.some((item) => item.suffix === suffix)) {
      presenceSource[`${prefix}${suffix}`] = 'configured-in-encrypted-dashboard-vault';
    }
  }
  const report = describeProviderConfiguration(provider, presenceSource);
  return {
    ...report,
    credentials: report.credentials.map((credential) => ({
      ...credential,
      stored: credentialNames.has(credential.suffix),
    })),
  };
}
