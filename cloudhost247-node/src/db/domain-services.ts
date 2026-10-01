/**
 * Domain Services provider configuration persistence.
 *
 * This module is intentionally limited to server-side configuration state. It never returns an
 * encrypted credential envelope (or decrypted secret) to a route DTO. Business workflows are
 * implemented in the domain-services service layer in later phases.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import { currentKeyVersion, decryptSecret, encryptSecret, type EncryptionKeyRing } from '../lib/crypto';

export type DomainServiceProviderType = 'registrar' | 'rdap' | 'appraisal' | 'auction';
export type DomainServiceProviderEnvironment = 'sandbox' | 'production';
export type DomainServiceProviderStatus = 'not_configured' | 'configured' | 'connected' | 'auth_failed' | 'unavailable' | 'disabled';

export interface DomainServiceProviderRow {
  id: string;
  provider_key: string;
  name: string;
  adapter_key: string;
  provider_type: DomainServiceProviderType;
  api_base_url: string | null;
  environment: DomainServiceProviderEnvironment;
  status: DomainServiceProviderStatus;
  capabilities: Record<string, unknown>;
  configuration: Record<string, unknown>;
  last_connection_test_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface DomainServiceProviderCredentialRow {
  id: string;
  provider_id: string;
  encrypted_credentials: string;
  credential_names: unknown;
  key_version: number;
  created_at: string;
  rotated_at: string | null;
}

/** Browser-safe provider representation: no secret, encrypted envelope, or raw failure detail. */
export interface DomainServiceProviderDto {
  id: string;
  providerKey: string;
  name: string;
  adapterKey: string;
  providerType: DomainServiceProviderType;
  apiBaseUrl: string | null;
  environment: DomainServiceProviderEnvironment;
  status: DomainServiceProviderStatus;
  capabilities: Record<string, unknown>;
  configuration: Record<string, unknown>;
  credentialNames: string[];
  credentialsConfigured: boolean;
  lastConnectionTestAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function validCredentialMap(value: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawKey, secret] of Object.entries(value)) {
    const key = rawKey.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(key)) throw new Error(`Invalid credential name '${rawKey}'`);
    if (typeof secret !== 'string' || secret.length < 1 || secret.length > 20_000) {
      throw new Error(`Credential '${key}' must be a non-empty string no longer than 20000 characters`);
    }
    result[key] = secret;
  }
  if (Object.keys(result).length === 0) throw new Error('At least one credential is required');
  return result;
}

export function toDomainServiceProviderDto(
  provider: DomainServiceProviderRow,
  credentialRow?: Pick<DomainServiceProviderCredentialRow, 'credential_names'> | null
): DomainServiceProviderDto {
  const credentialNames = asStringArray(credentialRow?.credential_names);
  return {
    id: provider.id,
    providerKey: provider.provider_key,
    name: provider.name,
    adapterKey: provider.adapter_key,
    providerType: provider.provider_type,
    apiBaseUrl: provider.api_base_url,
    environment: provider.environment,
    status: provider.status,
    capabilities: asRecord(provider.capabilities),
    configuration: asRecord(provider.configuration),
    credentialNames,
    credentialsConfigured: credentialNames.length > 0,
    lastConnectionTestAt: provider.last_connection_test_at,
    lastSuccessAt: provider.last_success_at,
    lastFailureAt: provider.last_failure_at,
    lastError: provider.last_error,
    createdAt: provider.created_at,
    updatedAt: provider.updated_at,
  };
}

export async function listDomainServiceProviders(db: Queryable): Promise<DomainServiceProviderDto[]> {
  const { rows } = await db.query<DomainServiceProviderRow & { credential_names: unknown }>(
    `SELECT p.*, c.credential_names
       FROM domain_service_providers p
       LEFT JOIN domain_service_provider_credentials c ON c.provider_id = p.id
      ORDER BY p.provider_type ASC, p.name ASC`
  );
  return rows.map((row) => toDomainServiceProviderDto(row, row));
}

export async function findDomainServiceProviderById(db: Queryable, id: string): Promise<DomainServiceProviderRow | null> {
  const { rows } = await db.query<DomainServiceProviderRow>(
    `SELECT * FROM domain_service_providers WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findDomainServiceProviderByKey(db: Queryable, providerKey: string): Promise<DomainServiceProviderRow | null> {
  const { rows } = await db.query<DomainServiceProviderRow>(
    `SELECT * FROM domain_service_providers WHERE provider_key = $1 LIMIT 1`,
    [providerKey]
  );
  return rows[0] ?? null;
}

export async function createDomainServiceProvider(
  db: Queryable,
  input: {
    providerKey: string;
    name: string;
    adapterKey: string;
    providerType: DomainServiceProviderType;
    apiBaseUrl?: string | null;
    environment?: DomainServiceProviderEnvironment;
    capabilities?: Record<string, unknown>;
    configuration?: Record<string, unknown>;
    createdBy?: string | null;
  }
): Promise<DomainServiceProviderRow> {
  const { rows } = await db.query<DomainServiceProviderRow>(
    `INSERT INTO domain_service_providers
       (id, provider_key, name, adapter_key, provider_type, api_base_url, environment, capabilities, configuration, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      randomUUID(), input.providerKey, input.name, input.adapterKey, input.providerType,
      input.apiBaseUrl ?? null, input.environment ?? 'production', JSON.stringify(input.capabilities ?? {}),
      JSON.stringify(input.configuration ?? {}), input.createdBy ?? null,
    ]
  );
  const provider = rows[0];
  if (!provider) throw new Error('Failed to create domain service provider');
  return provider;
}

export async function updateDomainServiceProvider(
  db: Queryable,
  id: string,
  patch: Partial<{
    name: string;
    adapterKey: string;
    apiBaseUrl: string | null;
    environment: DomainServiceProviderEnvironment;
    status: DomainServiceProviderStatus;
    capabilities: Record<string, unknown>;
    configuration: Record<string, unknown>;
    lastError: string | null;
    connectionTested: boolean;
    connectionSucceeded: boolean;
  }>
): Promise<DomainServiceProviderRow | null> {
  const existing = await findDomainServiceProviderById(db, id);
  if (!existing) return null;
  const tested = patch.connectionTested === true;
  const succeeded = patch.connectionSucceeded === true;
  const status = patch.status ?? existing.status;
  const { rows } = await db.query<DomainServiceProviderRow>(
    `UPDATE domain_service_providers SET
       name=$2, adapter_key=$3, api_base_url=$4, environment=$5, status=$6,
       capabilities=$7, configuration=$8, last_error=$9,
       last_connection_test_at=CASE WHEN $10::boolean THEN now() ELSE last_connection_test_at END,
       last_success_at=CASE WHEN $11::boolean THEN now() ELSE last_success_at END,
       last_failure_at=CASE WHEN $12::boolean THEN now() ELSE last_failure_at END,
       updated_at=now()
     WHERE id=$1 RETURNING *`,
    [
      id,
      patch.name ?? existing.name,
      patch.adapterKey ?? existing.adapter_key,
      patch.apiBaseUrl !== undefined ? patch.apiBaseUrl : existing.api_base_url,
      patch.environment ?? existing.environment,
      status,
      JSON.stringify(patch.capabilities ?? asRecord(existing.capabilities)),
      JSON.stringify(patch.configuration ?? asRecord(existing.configuration)),
      patch.lastError !== undefined ? patch.lastError : existing.last_error,
      tested,
      tested && succeeded,
      tested && !succeeded,
    ]
  );
  return rows[0] ?? null;
}

/** Encrypts and writes credentials. Callers must possess the key ring and must not log input. */
export async function storeDomainServiceProviderCredentials(
  db: Queryable,
  ring: EncryptionKeyRing,
  providerId: string,
  credentials: Record<string, string>
): Promise<void> {
  const normalized = validCredentialMap(credentials);
  const encrypted = encryptSecret(ring, JSON.stringify(normalized));
  await db.query(
    `INSERT INTO domain_service_provider_credentials
       (id, provider_id, encrypted_credentials, credential_names, key_version)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (provider_id) DO UPDATE SET
       encrypted_credentials=EXCLUDED.encrypted_credentials,
       credential_names=EXCLUDED.credential_names,
       key_version=EXCLUDED.key_version,
       rotated_at=now()`,
    [randomUUID(), providerId, encrypted, JSON.stringify(Object.keys(normalized).sort()), currentKeyVersion(ring)]
  );
}

/** Server-only credential read for a concrete provider adapter. Never expose outside services. */
export async function getDomainServiceProviderCredentials(
  db: Queryable,
  ring: EncryptionKeyRing,
  providerId: string
): Promise<Record<string, string> | null> {
  const { rows } = await db.query<DomainServiceProviderCredentialRow>(
    `SELECT * FROM domain_service_provider_credentials WHERE provider_id=$1 LIMIT 1`,
    [providerId]
  );
  const credential = rows[0];
  if (!credential) return null;
  const parsed: unknown = JSON.parse(decryptSecret(ring, credential.encrypted_credentials));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Stored domain provider credentials are invalid');
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') throw new Error('Stored domain provider credentials are invalid');
    normalized[key] = value;
  }
  return normalized;
}

export async function findConnectedDomainServiceProvider(
  db: Queryable,
  type: DomainServiceProviderType
): Promise<DomainServiceProviderRow | null> {
  const { rows } = await db.query<DomainServiceProviderRow>(
    `SELECT p.*
       FROM domain_service_providers p
       JOIN domain_service_provider_credentials c ON c.provider_id = p.id
      WHERE p.provider_type = $1 AND p.status = 'connected'
      ORDER BY p.last_success_at DESC NULLS LAST, p.created_at ASC
      LIMIT 1`,
    [type]
  );
  return rows[0] ?? null;
}
