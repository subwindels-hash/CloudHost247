/**
 * Phase 6 — per-installation environment variables (spec §16) and volumes (spec §17).
 *
 * Environment values are stored as AES-256-GCM envelopes. Two read paths exist, and they are
 * the only read paths:
 *   - listEnvironmentKeys: keys + secret flag, for API responses (secret VALUES never leave).
 *   - resolveEnvironment: full decrypted map, for the deployment worker composing the Compose
 *     file — used server-side only, never serialized into a response.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import { encryptSecret, decryptSecret, type EncryptionKeyRing } from '../lib/crypto';

export interface EnvironmentEntryRow {
  id: string;
  installation_id: string;
  key: string;
  encrypted_value: string;
  is_secret: boolean;
  created_at: string;
  updated_at: string;
}

export async function upsertEnvironmentEntry(
  db: Queryable,
  ring: EncryptionKeyRing,
  installationId: string,
  key: string,
  value: string,
  isSecret: boolean
): Promise<EnvironmentEntryRow> {
  const encrypted = encryptSecret(ring, value);
  const { rows } = await db.query<EnvironmentEntryRow>(
    `INSERT INTO application_environment (id, installation_id, key, encrypted_value, is_secret)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (installation_id, key) DO UPDATE SET
       encrypted_value = EXCLUDED.encrypted_value,
       is_secret = EXCLUDED.is_secret,
       updated_at = now()
     RETURNING *`,
    [randomUUID(), installationId, key, encrypted, isSecret]
  );
  const row = rows[0];
  if (!row) throw new Error('upsertEnvironmentEntry: upsert returned no row');
  return row;
}

export async function deleteEnvironmentEntry(db: Queryable, installationId: string, key: string): Promise<void> {
  await db.query(`DELETE FROM application_environment WHERE installation_id = $1 AND key = $2`, [
    installationId,
    key,
  ]);
}

export async function listEnvironmentEntries(db: Queryable, installationId: string): Promise<EnvironmentEntryRow[]> {
  const { rows } = await db.query<EnvironmentEntryRow>(
    `SELECT * FROM application_environment WHERE installation_id = $1 ORDER BY key ASC`,
    [installationId]
  );
  return rows;
}

/** API-safe listing: keys and flags only — values (secret or not) never leave the server. */
export async function listEnvironmentKeys(
  db: Queryable,
  installationId: string
): Promise<Array<{ key: string; isSecret: boolean; updatedAt: string }>> {
  const rows = await listEnvironmentEntries(db, installationId);
  return rows.map((r) => ({ key: r.key, isSecret: r.is_secret, updatedAt: r.updated_at }));
}

/** Worker-only: decrypts the full environment for Compose generation. */
export async function resolveEnvironment(
  db: Queryable,
  ring: EncryptionKeyRing,
  installationId: string
): Promise<Record<string, string>> {
  const rows = await listEnvironmentEntries(db, installationId);
  const resolved: Record<string, string> = {};
  for (const row of rows) {
    resolved[row.key] = decryptSecret(ring, row.encrypted_value);
  }
  return resolved;
}

// --- Volumes (spec §17) --------------------------------------------------------------------------

export interface VolumeRow {
  id: string;
  installation_id: string;
  name: string;
  mount_path: string;
  host_path: string | null;
  size_mb: number | null;
  created_at: string;
}

export async function upsertVolume(
  db: Queryable,
  installationId: string,
  input: { name: string; mountPath: string; hostPath?: string | null; sizeMb?: number | null }
): Promise<VolumeRow> {
  const { rows } = await db.query<VolumeRow>(
    `INSERT INTO application_volumes (id, installation_id, name, mount_path, host_path, size_mb)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (installation_id, name) DO UPDATE SET
       mount_path = EXCLUDED.mount_path,
       host_path = EXCLUDED.host_path,
       size_mb = EXCLUDED.size_mb
     RETURNING *`,
    [randomUUID(), installationId, input.name, input.mountPath, input.hostPath ?? null, input.sizeMb ?? null]
  );
  const row = rows[0];
  if (!row) throw new Error('upsertVolume: upsert returned no row');
  return row;
}

export async function listVolumes(db: Queryable, installationId: string): Promise<VolumeRow[]> {
  const { rows } = await db.query<VolumeRow>(
    `SELECT * FROM application_volumes WHERE installation_id = $1 ORDER BY name ASC`,
    [installationId]
  );
  return rows;
}
