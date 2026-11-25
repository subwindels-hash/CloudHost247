import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import { currentKeyVersion, decryptSecret, encryptSecret, type EncryptionKeyRing } from '../lib/crypto';

export type ProviderType =
  | 'OVH'
  | 'HETZNER'
  | 'AWS'
  | 'DIGITALOCEAN'
  | 'VULTR'
  | 'CONTABO'
  | 'PROXMOX'
  | 'VIRTUALIZOR'
  | 'SOLUSVM'
  | 'OPENSTACK'
  | 'GENERIC_HTTP'
  // Development-only provider (src/infrastructure/providers/mock-adapter.ts). Disabled in
  // production and never selected automatically.
  | 'MOCK'
  | 'OTHER';

export type ProviderAdapterKind =
  | 'hetzner'
  | 'ovh'
  | 'aws'
  | 'digitalocean'
  | 'vultr'
  | 'contabo'
  | 'proxmox'
  | 'virtualizor'
  | 'solusvm'
  | 'openstack'
  | 'generic_http'
  | 'mock';

export interface InfrastructureProviderRow {
  id: string;
  name: string;
  slug: string;
  provider_type: ProviderType;
  adapter: ProviderAdapterKind;
  status: string;
  api_base_url: string | null;
  credential_env_prefix: string | null;
  capabilities: Record<string, unknown>;
  metadata: Record<string, unknown>;
  last_health_check_at: string | null;
  last_health_status: string | null;
  created_at: string;
  updated_at: string;
}

interface InfrastructureProviderCredentialRow {
  provider_id: string;
  encrypted_credentials: string;
  credential_names: unknown;
  key_version: number;
  created_at: string;
  rotated_at: string | null;
}

function credentialNameArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeProviderCredentials(value: Record<string, string>): Record<string, string> {
  const credentials: Record<string, string> = {};
  for (const [suffix, secret] of Object.entries(value)) {
    if (!/^_[A-Z0-9_]{1,95}$/.test(suffix)) {
      throw new Error(`Invalid infrastructure provider credential field '${suffix}'`);
    }
    if (typeof secret !== 'string' || secret.length < 1 || secret.length > 20_000) {
      throw new Error(`Infrastructure provider credential '${suffix}' must be a non-empty string no longer than 20000 characters`);
    }
    credentials[suffix] = secret;
  }
  if (Object.keys(credentials).length === 0) throw new Error('At least one infrastructure provider credential is required');
  return credentials;
}

/** Names only; this query deliberately avoids decrypting or selecting the ciphertext. */
export async function listInfrastructureProviderCredentialNames(db: Queryable, providerId: string): Promise<string[]> {
  const { rows } = await db.query<{ credential_names: unknown }>(
    `SELECT credential_names FROM infrastructure_provider_credentials WHERE provider_id=$1 LIMIT 1`,
    [providerId]
  );
  return credentialNameArray(rows[0]?.credential_names);
}

/** Server-only credential read for provider adapters. Plaintext never leaves this service boundary. */
export async function getInfrastructureProviderCredentials(
  db: Queryable,
  ring: EncryptionKeyRing,
  providerId: string
): Promise<Record<string, string> | null> {
  const { rows } = await db.query<InfrastructureProviderCredentialRow>(
    `SELECT provider_id,encrypted_credentials,credential_names,key_version,created_at,rotated_at
       FROM infrastructure_provider_credentials WHERE provider_id=$1 LIMIT 1`,
    [providerId]
  );
  const row = rows[0];
  if (!row) return null;

  try {
    const parsed: unknown = JSON.parse(decryptSecret(ring, row.encrypted_credentials));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    const credentials: Record<string, string> = {};
    for (const [suffix, secret] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^_[A-Z0-9_]{1,95}$/.test(suffix) || typeof secret !== 'string' || secret.length < 1) {
        throw new Error('invalid credential record');
      }
      credentials[suffix] = secret;
    }
    if (Object.keys(credentials).length === 0) throw new Error('empty credential record');
    return credentials;
  } catch {
    // Do not surface ciphertext, key versions, or low-level crypto errors to API clients/logs.
    throw new Error('Stored provider credentials could not be decrypted. A Super Admin must re-enter them.');
  }
}

/** Encrypts credentials before persistence. The encrypted envelope is never returned. */
export async function storeInfrastructureProviderCredentials(
  db: Queryable,
  ring: EncryptionKeyRing,
  providerId: string,
  value: Record<string, string>
): Promise<void> {
  const credentials = normalizeProviderCredentials(value);
  await db.query(
    `INSERT INTO infrastructure_provider_credentials
       (provider_id,encrypted_credentials,credential_names,key_version)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (provider_id) DO UPDATE SET
       encrypted_credentials=EXCLUDED.encrypted_credentials,
       credential_names=EXCLUDED.credential_names,
       key_version=EXCLUDED.key_version,
       rotated_at=now()`,
    [providerId, encryptSecret(ring, JSON.stringify(credentials)), JSON.stringify(Object.keys(credentials).sort()), currentKeyVersion(ring)]
  );
}

export interface InfrastructureRegionRow {
  id: string;
  provider_id: string;
  code: string;
  name: string;
  country_code: string | null;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface InfrastructureDatacenterRow {
  id: string;
  region_id: string;
  code: string;
  name: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ServerOsImageRow {
  id: string;
  provider_id: string;
  operating_system_version_id: string;
  provider_image_id: string | null;
  provider_template_id: string | null;
  architecture: 'x86_64' | 'arm64';
  region_id: string | null;
  datacenter_id: string | null;
  status: string;
  metadata: Record<string, unknown>;
  verified_at: string | null;
  verified_by: string | null;
  verification_error: string | null;
  created_at: string;
  updated_at: string;
}

export async function listProviders(db: Queryable): Promise<InfrastructureProviderRow[]> {
  const { rows } = await db.query<InfrastructureProviderRow>(
    `SELECT * FROM infrastructure_providers ORDER BY name ASC`
  );
  return rows;
}

export async function findProviderById(db: Queryable, id: string): Promise<InfrastructureProviderRow | null> {
  const { rows } = await db.query<InfrastructureProviderRow>(
    `SELECT * FROM infrastructure_providers WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function createProvider(
  db: Queryable,
  input: {
    name: string;
    slug: string;
    providerType: ProviderType;
    adapter: ProviderAdapterKind;
    status?: string;
    apiBaseUrl?: string | null;
    credentialEnvPrefix?: string | null;
    capabilities?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): Promise<InfrastructureProviderRow> {
  const { rows } = await db.query<InfrastructureProviderRow>(
    `INSERT INTO infrastructure_providers
       (id, name, slug, provider_type, adapter, status, api_base_url, credential_env_prefix, capabilities, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      randomUUID(), input.name, input.slug, input.providerType, input.adapter,
      input.status ?? 'CONFIGURATION_REQUIRED', input.apiBaseUrl ?? null,
      input.credentialEnvPrefix ?? null, JSON.stringify(input.capabilities ?? {}),
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('createProvider: insert returned no row');
  return row;
}

export async function updateProvider(
  db: Queryable,
  id: string,
  patch: Partial<{
    name: string;
    status: string;
    apiBaseUrl: string | null;
    credentialEnvPrefix: string | null;
    capabilities: Record<string, unknown>;
    metadata: Record<string, unknown>;
    lastHealthStatus: string | null;
  }>
): Promise<InfrastructureProviderRow | null> {
  const existing = await findProviderById(db, id);
  if (!existing) return null;
  const { rows } = await db.query<InfrastructureProviderRow>(
    `UPDATE infrastructure_providers SET
       name=$2, status=$3, api_base_url=$4, credential_env_prefix=$5,
       capabilities=$6, metadata=$7,
       last_health_status=$8,
       last_health_check_at=CASE WHEN $9::boolean THEN now() ELSE last_health_check_at END,
       updated_at=now()
     WHERE id=$1 RETURNING *`,
    [
      id,
      patch.name ?? existing.name,
      patch.status ?? existing.status,
      patch.apiBaseUrl !== undefined ? patch.apiBaseUrl : existing.api_base_url,
      patch.credentialEnvPrefix !== undefined ? patch.credentialEnvPrefix : existing.credential_env_prefix,
      JSON.stringify(patch.capabilities ?? existing.capabilities),
      JSON.stringify(patch.metadata ?? existing.metadata),
      patch.lastHealthStatus !== undefined ? patch.lastHealthStatus : existing.last_health_status,
      patch.lastHealthStatus !== undefined,
    ]
  );
  return rows[0] ?? null;
}

export async function listRegions(db: Queryable, providerId?: string): Promise<InfrastructureRegionRow[]> {
  const { rows } = await db.query<InfrastructureRegionRow>(
    `SELECT * FROM infrastructure_regions
     WHERE ($1::uuid IS NULL OR provider_id = $1::uuid)
     ORDER BY name ASC`,
    [providerId ?? null]
  );
  return rows;
}

export async function findRegionById(db: Queryable, id: string): Promise<InfrastructureRegionRow | null> {
  const { rows } = await db.query<InfrastructureRegionRow>(`SELECT * FROM infrastructure_regions WHERE id=$1`, [id]);
  return rows[0] ?? null;
}

export async function createRegion(
  db: Queryable,
  input: { providerId: string; code: string; name: string; countryCode?: string | null; status?: string; metadata?: Record<string, unknown> }
): Promise<InfrastructureRegionRow> {
  const { rows } = await db.query<InfrastructureRegionRow>(
    `INSERT INTO infrastructure_regions (id, provider_id, code, name, country_code, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [randomUUID(), input.providerId, input.code, input.name, input.countryCode ?? null, input.status ?? 'DISABLED', JSON.stringify(input.metadata ?? {})]
  );
  const row = rows[0];
  if (!row) throw new Error('createRegion: insert returned no row');
  return row;
}

export async function updateRegion(
  db: Queryable,
  id: string,
  patch: Partial<{ name: string; countryCode: string | null; status: string; metadata: Record<string, unknown> }>
): Promise<InfrastructureRegionRow | null> {
  const existing = await findRegionById(db, id);
  if (!existing) return null;
  const { rows } = await db.query<InfrastructureRegionRow>(
    `UPDATE infrastructure_regions SET name=$2,country_code=$3,status=$4,metadata=$5,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, patch.name ?? existing.name, patch.countryCode !== undefined ? patch.countryCode : existing.country_code, patch.status ?? existing.status, JSON.stringify(patch.metadata ?? existing.metadata)]
  );
  return rows[0] ?? null;
}

export async function listDatacenters(db: Queryable, regionId?: string): Promise<InfrastructureDatacenterRow[]> {
  const { rows } = await db.query<InfrastructureDatacenterRow>(
    `SELECT * FROM infrastructure_datacenters
     WHERE ($1::uuid IS NULL OR region_id = $1::uuid)
     ORDER BY name ASC`,
    [regionId ?? null]
  );
  return rows;
}

export async function findDatacenterById(db: Queryable, id: string): Promise<InfrastructureDatacenterRow | null> {
  const { rows } = await db.query<InfrastructureDatacenterRow>(`SELECT * FROM infrastructure_datacenters WHERE id=$1`, [id]);
  return rows[0] ?? null;
}

export async function updateDatacenter(
  db: Queryable,id: string,patch: Partial<{ name:string;status:string;metadata:Record<string,unknown> }>
): Promise<InfrastructureDatacenterRow|null> {
  const current=await findDatacenterById(db,id);if(!current)return null;
  const {rows}=await db.query<InfrastructureDatacenterRow>(
    `UPDATE infrastructure_datacenters SET name=$2,status=$3,metadata=$4,updated_at=now() WHERE id=$1 RETURNING *`,
    [id,patch.name??current.name,patch.status??current.status,JSON.stringify(patch.metadata??current.metadata)]
  );
  return rows[0]??null;
}

export async function createDatacenter(
  db: Queryable,
  input: { regionId: string; code: string; name: string; status?: string; metadata?: Record<string, unknown> }
): Promise<InfrastructureDatacenterRow> {
  const { rows } = await db.query<InfrastructureDatacenterRow>(
    `INSERT INTO infrastructure_datacenters (id, region_id, code, name, status, metadata)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [randomUUID(), input.regionId, input.code, input.name, input.status ?? 'DISABLED', JSON.stringify(input.metadata ?? {})]
  );
  const row = rows[0];
  if (!row) throw new Error('createDatacenter: insert returned no row');
  return row;
}

export async function findOsImageById(db: Queryable, id: string): Promise<ServerOsImageRow | null> {
  const { rows } = await db.query<ServerOsImageRow>(`SELECT * FROM server_os_images WHERE id=$1`, [id]);
  return rows[0] ?? null;
}

export async function listOsImages(
  db: Queryable,
  filters: { providerId?: string; versionId?: string; operatingSystemId?: string; status?: string } = {}
): Promise<Array<ServerOsImageRow & { provider_name: string; os_display_name: string; region_name: string | null; datacenter_name: string | null }>> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => { params.push(value); conditions.push(sql.replace('?', `$${params.length}`)); };
  if (filters.providerId) add('i.provider_id=?', filters.providerId);
  if (filters.versionId) add('i.operating_system_version_id=?', filters.versionId);
  if (filters.operatingSystemId) add('v.operating_system_id=?', filters.operatingSystemId);
  if (filters.status) add('i.status=?', filters.status);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<ServerOsImageRow & { provider_name: string; os_display_name: string; region_name: string | null; datacenter_name: string | null }>(
    `SELECT i.*, p.name provider_name, v.display_name os_display_name,
            r.name region_name, d.name datacenter_name
     FROM server_os_images i
     JOIN infrastructure_providers p ON p.id=i.provider_id
     JOIN operating_system_versions v ON v.id=i.operating_system_version_id
     LEFT JOIN infrastructure_regions r ON r.id=i.region_id
     LEFT JOIN infrastructure_datacenters d ON d.id=i.datacenter_id
     ${where} ORDER BY i.created_at DESC`, params
  );
  return rows;
}

export async function createOsImage(
  db: Queryable,
  input: {
    providerId: string; operatingSystemVersionId: string; providerImageId?: string | null;
    providerTemplateId?: string | null; architecture: 'x86_64' | 'arm64'; regionId?: string | null;
    datacenterId?: string | null; metadata?: Record<string, unknown>;
  }
): Promise<ServerOsImageRow> {
  const { rows } = await db.query<ServerOsImageRow>(
    `INSERT INTO server_os_images
       (id,provider_id,operating_system_version_id,provider_image_id,provider_template_id,architecture,region_id,datacenter_id,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [randomUUID(),input.providerId,input.operatingSystemVersionId,input.providerImageId ?? null,input.providerTemplateId ?? null,input.architecture,input.regionId ?? null,input.datacenterId ?? null,JSON.stringify(input.metadata ?? {})]
  );
  const row = rows[0];
  if (!row) throw new Error('createOsImage: insert returned no row');
  return row;
}

export async function updateOsImage(
  db: Queryable,
  id: string,
  patch: Partial<{
    providerImageId: string | null; providerTemplateId: string | null; architecture: 'x86_64' | 'arm64';
    regionId: string | null; datacenterId: string | null; status: string; metadata: Record<string, unknown>;
    verifiedAt: string | null; verifiedBy: string | null; verificationError: string | null;
  }>
): Promise<ServerOsImageRow | null> {
  const existing = await findOsImageById(db, id);
  if (!existing) return null;
  const { rows } = await db.query<ServerOsImageRow>(
    `UPDATE server_os_images SET provider_image_id=$2,provider_template_id=$3,architecture=$4,
       region_id=$5,datacenter_id=$6,status=$7,metadata=$8,verified_at=$9,verified_by=$10,
       verification_error=$11,updated_at=now() WHERE id=$1 RETURNING *`,
    [id,
      patch.providerImageId !== undefined ? patch.providerImageId : existing.provider_image_id,
      patch.providerTemplateId !== undefined ? patch.providerTemplateId : existing.provider_template_id,
      patch.architecture ?? existing.architecture,
      patch.regionId !== undefined ? patch.regionId : existing.region_id,
      patch.datacenterId !== undefined ? patch.datacenterId : existing.datacenter_id,
      patch.status ?? existing.status,
      JSON.stringify(patch.metadata ?? existing.metadata),
      patch.verifiedAt !== undefined ? patch.verifiedAt : existing.verified_at,
      patch.verifiedBy !== undefined ? patch.verifiedBy : existing.verified_by,
      patch.verificationError !== undefined ? patch.verificationError : existing.verification_error,
    ]
  );
  return rows[0] ?? null;
}

export async function deleteOsImage(db: Queryable, id: string): Promise<boolean> {
  const result = await db.query(
    `DELETE FROM server_os_images i
     WHERE i.id=$1 AND i.status <> 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM servers s WHERE s.os_image_id=i.id)
       AND NOT EXISTS (SELECT 1 FROM provisioning_jobs j WHERE j.os_image_id=i.id)
     RETURNING id`,
    [id]
  );
  return result.rows.length > 0;
}
