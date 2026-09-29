/**
 * Phase 6 — server registry repository (spec §5) and encrypted credentials (spec §6).
 *
 * Credential values arrive plaintext from an admin request and leave this module only as
 * AES-256-GCM envelopes (src/lib/crypto.ts). Nothing here or in any route ever returns a
 * decrypted credential — decryption happens exclusively inside the deployment adapters, at the
 * moment a job needs to talk to that server.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import { encryptSecret, decryptSecret, rotateEnvelope, type EncryptionKeyRing } from '../lib/crypto';

export type ServerType = 'VPS' | 'DEDICATED' | 'CPANEL' | 'KUBERNETES' | 'SHARED';

export interface ServerRow {
  id: string;
  name: string;
  hostname: string;
  ip_address: string | null;
  server_type: ServerType;
  provider: string | null;
  region: string | null;
  status: string;
  agent_id: string | null;
  agent_version: string | null;
  agent_last_seen_at: string | null;
  cpu_cores: number;
  memory_mb: number;
  storage_mb: number;
  docker_enabled: boolean;
  kubernetes_enabled: boolean;
  cpanel_enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ServerCredentialRow {
  id: string;
  server_id: string;
  credential_type: string;
  encrypted_secret: string;
  key_version: number;
  created_at: string;
  rotated_at: string | null;
}

export interface CreateServerInput {
  id?: string;
  name: string;
  hostname: string;
  ipAddress?: string | null;
  serverType: ServerType;
  provider?: string | null;
  region?: string | null;
  status?: string;
  cpuCores: number;
  memoryMb: number;
  storageMb: number;
  dockerEnabled?: boolean;
  kubernetesEnabled?: boolean;
  cpanelEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export async function createServer(db: Queryable, input: CreateServerInput): Promise<ServerRow> {
  const { rows } = await db.query<ServerRow>(
    `INSERT INTO servers (
       id, name, hostname, ip_address, server_type, provider, region, status,
       cpu_cores, memory_mb, storage_mb, docker_enabled, kubernetes_enabled, cpanel_enabled, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      input.id ?? randomUUID(),
      input.name,
      input.hostname,
      input.ipAddress ?? null,
      input.serverType,
      input.provider ?? null,
      input.region ?? null,
      input.status ?? 'active',
      input.cpuCores,
      input.memoryMb,
      input.storageMb,
      input.dockerEnabled ?? false,
      input.kubernetesEnabled ?? false,
      input.cpanelEnabled ?? false,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('createServer: insert returned no row');
  return row;
}

export async function updateServer(
  db: Queryable,
  id: string,
  patch: Partial<CreateServerInput> & { agentVersion?: string | null; agentLastSeenAt?: string | null }
): Promise<ServerRow | null> {
  const existingResult = await db.query<ServerRow>(`SELECT * FROM servers WHERE id = $1 FOR UPDATE`, [id]);
  const existing = existingResult.rows[0];
  if (!existing) return null;
  const { rows } = await db.query<ServerRow>(
    `UPDATE servers SET
       name = $2, hostname = $3, ip_address = $4, server_type = $5, provider = $6, region = $7,
       status = $8, cpu_cores = $9, memory_mb = $10, storage_mb = $11, docker_enabled = $12,
       kubernetes_enabled = $13, cpanel_enabled = $14, metadata = $15, agent_version = $16,
       agent_last_seen_at = $17, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.name ?? existing.name,
      patch.hostname ?? existing.hostname,
      patch.ipAddress !== undefined ? patch.ipAddress : existing.ip_address,
      patch.serverType ?? existing.server_type,
      patch.provider !== undefined ? patch.provider : existing.provider,
      patch.region !== undefined ? patch.region : existing.region,
      patch.status ?? existing.status,
      patch.cpuCores ?? existing.cpu_cores,
      patch.memoryMb ?? existing.memory_mb,
      patch.storageMb ?? existing.storage_mb,
      patch.dockerEnabled ?? existing.docker_enabled,
      patch.kubernetesEnabled ?? existing.kubernetes_enabled,
      patch.cpanelEnabled ?? existing.cpanel_enabled,
      patch.metadata !== undefined ? JSON.stringify(patch.metadata) : JSON.stringify(existing.metadata),
      patch.agentVersion !== undefined ? patch.agentVersion : existing.agent_version,
      patch.agentLastSeenAt !== undefined ? patch.agentLastSeenAt : existing.agent_last_seen_at,
    ]
  );
  return rows[0] ?? null;
}

/** Soft-retire: history (installations, deployments, audit) must survive server removal. */
export async function retireServer(db: Queryable, id: string): Promise<ServerRow | null> {
  const { rows } = await db.query<ServerRow>(
    `UPDATE servers SET status = 'retired', updated_at = now() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findServerById(db: Queryable, id: string): Promise<ServerRow | null> {
  const { rows } = await db.query<ServerRow>(`SELECT * FROM servers WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findServerByAgentId(db: Queryable, agentId: string): Promise<ServerRow | null> {
  const { rows } = await db.query<ServerRow>(`SELECT * FROM servers WHERE agent_id = $1`, [agentId]);
  return rows[0] ?? null;
}

export async function listServers(db: Queryable, filters: { type?: string; status?: string } = {}): Promise<ServerRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.type) {
    params.push(filters.type);
    conditions.push(`server_type = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<ServerRow>(`SELECT * FROM servers ${where} ORDER BY created_at ASC`, params);
  return rows;
}

// --- Credentials ---------------------------------------------------------------------------------

export type CredentialType =
  | 'agent_secret'
  | 'whm_api_token'
  | 'cpanel_api_token'
  | 'ssh_key'
  | 'kubernetes_kubeconfig';

export async function storeCredential(
  db: Queryable,
  ring: EncryptionKeyRing,
  serverId: string,
  type: CredentialType,
  secretPlaintext: string
): Promise<ServerCredentialRow> {
  const encrypted = encryptSecret(ring, secretPlaintext);
  const { rows } = await db.query<ServerCredentialRow>(
    `INSERT INTO server_credentials (id, server_id, credential_type, encrypted_secret, key_version)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (server_id, credential_type) DO UPDATE SET
       encrypted_secret = EXCLUDED.encrypted_secret,
       key_version = EXCLUDED.key_version,
       rotated_at = now()
     RETURNING *`,
    [randomUUID(), serverId, type, encrypted, Number.parseInt(encrypted.slice(1, encrypted.indexOf(':')), 10)]
  );
  const row = rows[0];
  if (!row) throw new Error('storeCredential: upsert returned no row');
  return row;
}

/** Decrypts a credential for adapter use. Never expose the result through any API response. */
export async function getCredential(
  db: Queryable,
  ring: EncryptionKeyRing,
  serverId: string,
  type: CredentialType
): Promise<string | null> {
  const { rows } = await db.query<ServerCredentialRow>(
    `SELECT * FROM server_credentials WHERE server_id = $1 AND credential_type = $2`,
    [serverId, type]
  );
  const row = rows[0];
  if (!row) return null;
  return decryptSecret(ring, row.encrypted_secret);
}

export async function listCredentialMetadata(db: Queryable, serverId: string): Promise<
  Array<{ credentialType: string; keyVersion: number; createdAt: string; rotatedAt: string | null }>
> {
  const { rows } = await db.query<ServerCredentialRow>(
    `SELECT * FROM server_credentials WHERE server_id = $1 ORDER BY credential_type`,
    [serverId]
  );
  // Metadata only — never the envelope, never anything derived from the plaintext.
  return rows.map((r) => ({
    credentialType: r.credential_type,
    keyVersion: r.key_version,
    createdAt: r.created_at,
    rotatedAt: r.rotated_at,
  }));
}

/** Re-encrypts all of a server's credentials under the ring's newest key (rotation sweep). */
export async function rotateServerCredentials(db: Queryable, ring: EncryptionKeyRing, serverId: string): Promise<number> {
  const { rows } = await db.query<ServerCredentialRow>(
    `SELECT * FROM server_credentials WHERE server_id = $1 FOR UPDATE`,
    [serverId]
  );
  let rotated = 0;
  for (const row of rows) {
    const updated = rotateEnvelope(ring, row.encrypted_secret);
    if (updated !== row.encrypted_secret) {
      await db.query(
        `UPDATE server_credentials
         SET encrypted_secret = $2, key_version = $3, rotated_at = now()
         WHERE id = $1`,
        [row.id, updated, Number.parseInt(updated.slice(1, updated.indexOf(':')), 10)]
      );
      rotated += 1;
    }
  }
  return rotated;
}

/** Aggregate resources currently committed to non-deleted installations on a server. */
export async function getServerAllocation(
  db: Queryable,
  serverId: string
): Promise<{ cpu: number; memoryMb: number; storageMb: number; installations: number }> {
  const { rows } = await db.query<{ cpu: string; memory: string; storage: string; count: string }>(
    `SELECT
       COALESCE(SUM(cpu_limit), 0)::text AS cpu,
       COALESCE(SUM(memory_limit_mb), 0)::text AS memory,
       COALESCE(SUM(storage_limit_mb), 0)::text AS storage,
       count(*)::text AS count
     FROM application_installations
     WHERE server_id = $1 AND status NOT IN ('deleted', 'deleting', 'failed')`,
    [serverId]
  );
  const row = rows[0];
  return {
    cpu: Number.parseInt(row?.cpu ?? '0', 10),
    memoryMb: Number.parseInt(row?.memory ?? '0', 10),
    storageMb: Number.parseInt(row?.storage ?? '0', 10),
    installations: Number.parseInt(row?.count ?? '0', 10),
  };
}
