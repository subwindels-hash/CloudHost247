/**
 * Phase 6 — customer application installations repository (spec §11).
 *
 * Status transitions are guarded: setInstallationStatus only allows the legal edges of the
 * lifecycle graph, so a bug (or a hand-crafted request) can never jump e.g. healthy → deleted
 * without passing through deleting, or resurrect a deleted installation.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export interface InstallationRow {
  id: string;
  customer_id: string;
  application_id: string;
  application_version_id: string;
  server_id: string | null;
  subscription_id: string | null;
  order_id: string | null;
  name: string;
  status: string;
  domain: string | null;
  internal_port: number | null;
  external_port: number | null;
  deployment_id: string | null;
  container_project: string | null;
  cpu_limit: number | null;
  memory_limit_mb: number | null;
  storage_limit_mb: number | null;
  health_status: string;
  last_health_check_at: string | null;
  restart_count: number;
  circuit_open_until: string | null;
  last_backup_at: string | null;
  backup_enabled: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Legal status transitions (spec §11). Anything not listed here is rejected. */
const STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['queued', 'cancelled', 'failed'],
  queued: ['deploying', 'failed', 'cancelled'],
  deploying: ['starting', 'failed', 'deleting'],
  starting: ['healthy', 'unhealthy', 'failed', 'deleting'],
  healthy: ['stopped', 'unhealthy', 'updating', 'deleting', 'failed'],
  unhealthy: ['healthy', 'stopped', 'updating', 'deleting', 'failed'],
  stopped: ['starting', 'deleting', 'updating'],
  updating: ['healthy', 'unhealthy', 'stopped', 'failed', 'deleting'],
  failed: ['queued', 'deploying', 'stopped', 'deleting'], // failed → queued = retry/reinstall
  deleting: ['deleted'],
  deleted: [],
  // Legacy-free: 'cancelled' is a terminal state for never-deployed installs.
  cancelled: ['deleting', 'deleted'],
};

export function canTransition(from: string, to: string): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface CreateInstallationInput {
  id?: string;
  customerId: string;
  applicationId: string;
  applicationVersionId: string;
  serverId?: string | null;
  orderId?: string | null;
  name: string;
  domain?: string | null;
  containerProject?: string | null;
  cpuLimit?: number | null;
  memoryLimitMb?: number | null;
  storageLimitMb?: number | null;
}

export async function createInstallation(db: Queryable, input: CreateInstallationInput): Promise<InstallationRow> {
  const { rows } = await db.query<InstallationRow>(
    `INSERT INTO application_installations (
       id, customer_id, application_id, application_version_id, server_id, order_id, name,
       domain, container_project, cpu_limit, memory_limit_mb, storage_limit_mb
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      input.id ?? randomUUID(),
      input.customerId,
      input.applicationId,
      input.applicationVersionId,
      input.serverId ?? null,
      input.orderId ?? null,
      input.name,
      input.domain ?? null,
      input.containerProject ?? null,
      input.cpuLimit ?? null,
      input.memoryLimitMb ?? null,
      input.storageLimitMb ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('createInstallation: insert returned no row');
  return row;
}

export async function findInstallationById(db: Queryable, id: string): Promise<InstallationRow | null> {
  const { rows } = await db.query<InstallationRow>(`SELECT * FROM application_installations WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listInstallationsForCustomer(db: Queryable, customerId: string): Promise<InstallationRow[]> {
  const { rows } = await db.query<InstallationRow>(
    `SELECT * FROM application_installations
     WHERE customer_id = $1 AND status <> 'deleted'
     ORDER BY created_at DESC`,
    [customerId]
  );
  return rows;
}

export async function listInstallationsForServer(db: Queryable, serverId: string): Promise<InstallationRow[]> {
  const { rows } = await db.query<InstallationRow>(
    `SELECT * FROM application_installations
     WHERE server_id = $1 AND status <> 'deleted'
     ORDER BY created_at DESC`,
    [serverId]
  );
  return rows;
}

export async function listAllInstallations(
  db: Queryable,
  filters: { status?: string; customerId?: string; applicationId?: string; limit?: number } = {}
): Promise<InstallationRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filters.customerId) {
    params.push(filters.customerId);
    conditions.push(`customer_id = $${params.length}`);
  }
  if (filters.applicationId) {
    params.push(filters.applicationId);
    conditions.push(`application_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<InstallationRow>(
    `SELECT * FROM application_installations ${where} ORDER BY created_at DESC LIMIT ${filters.limit ?? 200}`,
    params
  );
  return rows;
}

/**
 * Guarded status update. Returns null when the installation doesn't exist; throws when the
 * transition is illegal — callers treat both as hard stops. `force` exists ONLY for the
 * provisioning hook moving a brand-new installation out of 'pending'.
 */
export async function setInstallationStatus(
  db: Queryable,
  id: string,
  next: string,
  options: { force?: boolean } = {}
): Promise<InstallationRow> {
  const existingResult = await db.query<InstallationRow>(
    `SELECT * FROM application_installations WHERE id = $1 FOR UPDATE`,
    [id]
  );
  const existing = existingResult.rows[0];
  if (!existing) throw new Error(`Installation ${id} not found`);
  if (existing.status === next) return existing;
  if (!options.force && !canTransition(existing.status, next)) {
    throw new Error(`Illegal installation status transition: ${existing.status} → ${next}`);
  }
  const { rows } = await db.query<InstallationRow>(
    `UPDATE application_installations SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, next]
  );
  const row = rows[0];
  if (!row) throw new Error('setInstallationStatus: update returned no row');
  return row;
}

export async function updateInstallation(
  db: Queryable,
  id: string,
  patch: {
    serverId?: string | null;
    subscriptionId?: string | null;
    domain?: string | null;
    internalPort?: number | null;
    externalPort?: number | null;
    deploymentId?: string | null;
    containerProject?: string | null;
    applicationVersionId?: string;
    cpuLimit?: number | null;
    memoryLimitMb?: number | null;
    storageLimitMb?: number | null;
    lastBackupAt?: string | null;
    backupEnabled?: boolean;
  }
): Promise<InstallationRow | null> {
  const existingResult = await db.query<InstallationRow>(
    `SELECT * FROM application_installations WHERE id = $1 FOR UPDATE`,
    [id]
  );
  const existing = existingResult.rows[0];
  if (!existing) return null;
  const { rows } = await db.query<InstallationRow>(
    `UPDATE application_installations SET
       server_id = $2, subscription_id = $3, domain = $4, internal_port = $5, external_port = $6,
       deployment_id = $7, container_project = $8, application_version_id = $9,
       cpu_limit = $10, memory_limit_mb = $11, storage_limit_mb = $12,
       last_backup_at = $13, backup_enabled = $14, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.serverId !== undefined ? patch.serverId : existing.server_id,
      patch.subscriptionId !== undefined ? patch.subscriptionId : existing.subscription_id,
      patch.domain !== undefined ? patch.domain : existing.domain,
      patch.internalPort !== undefined ? patch.internalPort : existing.internal_port,
      patch.externalPort !== undefined ? patch.externalPort : existing.external_port,
      patch.deploymentId !== undefined ? patch.deploymentId : existing.deployment_id,
      patch.containerProject !== undefined ? patch.containerProject : existing.container_project,
      patch.applicationVersionId !== undefined ? patch.applicationVersionId : existing.application_version_id,
      patch.cpuLimit !== undefined ? patch.cpuLimit : existing.cpu_limit,
      patch.memoryLimitMb !== undefined ? patch.memoryLimitMb : existing.memory_limit_mb,
      patch.storageLimitMb !== undefined ? patch.storageLimitMb : existing.storage_limit_mb,
      patch.lastBackupAt !== undefined ? patch.lastBackupAt : existing.last_backup_at,
      patch.backupEnabled !== undefined ? patch.backupEnabled : existing.backup_enabled,
    ]
  );
  return rows[0] ?? null;
}

export async function markDeleted(db: Queryable, id: string): Promise<InstallationRow | null> {
  const { rows } = await db.query<InstallationRow>(
    `UPDATE application_installations
     SET status = 'deleted', deleted_at = now(), updated_at = now()
     WHERE id = $1 AND status IN ('deleting', 'cancelled')
     RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/** Records a health-check result; trips/open the circuit breaker per spec §53 counters. */
export async function recordHealthResult(
  db: Queryable,
  id: string,
  healthy: boolean | null,
  options: { restartCountDelta?: number; circuitOpenUntil?: string | null; resetRestarts?: boolean } = {}
): Promise<InstallationRow | null> {
  const existingResult = await db.query<InstallationRow>(
    `SELECT * FROM application_installations WHERE id = $1 FOR UPDATE`,
    [id]
  );
  const existing = existingResult.rows[0];
  if (!existing) return null;
  const { rows } = await db.query<InstallationRow>(
    `UPDATE application_installations SET
       health_status = CASE
         WHEN $2::boolean IS NULL THEN 'unknown'
         WHEN $2::boolean THEN 'healthy'
         ELSE 'unhealthy'
       END,
       last_health_check_at = now(),
       restart_count = CASE WHEN $4::boolean THEN 0 ELSE restart_count + $3::int END,
       circuit_open_until = $5,
       status = CASE
         WHEN $2::boolean IS TRUE AND status IN ('starting', 'unhealthy', 'updating') THEN 'healthy'
         WHEN $2::boolean IS FALSE AND status IN ('starting', 'healthy', 'updating') THEN 'unhealthy'
         ELSE status
       END,
       updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      healthy,
      options.restartCountDelta ?? 0,
      options.resetRestarts ?? false,
      options.circuitOpenUntil ?? null,
    ]
  );
  return rows[0] ?? null;
}
