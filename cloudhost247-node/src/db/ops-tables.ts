/**
 * Phase 6 — backups repository (spec §18), subscriptions repository (spec §21), platform
 * settings (spec §21 configurable grace period), and server metric snapshots (spec §51).
 *
 * Grouped in one module because each is small and cohesive around its table; the repo's existing
 * convention is table-group-per-file with larger domains split out.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

// --- Backups -------------------------------------------------------------------------------------

/**
 * What the agent reported about the database dump inside a backup archive, stored verbatim on the
 * row. `engine` is null when a dump was requested and none was produced, in which case `reason` and
 * `attempted` say why. Absent means the agent reported nothing — never "no dump was needed".
 */
export interface BackupDatabaseDumpReport {
  engine: string | null;
  service?: string | null;
  file?: string | null;
  reason?: string;
  attempted?: string[];
}

export interface BackupRow {
  id: string;
  installation_id: string;
  server_id: string | null;
  deployment_id: string | null;
  storage_provider: string;
  storage_path: string | null;
  size_bytes: number | null;
  status: string;
  checksum: string | null;
  database_dump: BackupDatabaseDumpReport | null;
  started_at: string | null;
  completed_at: string | null;
  expires_at: string | null;
  error_message: string | null;
  created_at: string;
}

export async function createBackup(
  db: Queryable,
  input: { installationId: string; serverId?: string | null; deploymentId?: string | null; storageProvider?: string; expiresAt?: string | null }
): Promise<BackupRow> {
  const { rows } = await db.query<BackupRow>(
    `INSERT INTO backups (id, installation_id, server_id, deployment_id, storage_provider, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      randomUUID(),
      input.installationId,
      input.serverId ?? null,
      input.deploymentId ?? null,
      input.storageProvider ?? 'local',
      input.expiresAt ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('createBackup: insert returned no row');
  return row;
}

export async function updateBackup(
  db: Queryable,
  id: string,
  patch: {
    status?: string;
    storagePath?: string | null;
    sizeBytes?: number | null;
    checksum?: string | null;
    /** The agent's report; `undefined` and `null` both mean "leave the column as it is". */
    databaseDump?: BackupDatabaseDumpReport | null;
    startedAt?: string | null;
    completedAt?: string | null;
    errorMessage?: string | null;
    expiresAt?: string | null;
  }
): Promise<BackupRow | null> {
  const existing = await db.query<BackupRow>(`SELECT * FROM backups WHERE id = $1 FOR UPDATE`, [id]);
  const current = existing.rows[0];
  if (!current) return null;
  const { rows } = await db.query<BackupRow>(
    `UPDATE backups SET
       status = COALESCE($2, status), storage_path = COALESCE($3, storage_path),
       size_bytes = COALESCE($4, size_bytes), checksum = COALESCE($5, checksum),
       started_at = COALESCE($6, started_at), completed_at = COALESCE($7, completed_at),
       error_message = $8, expires_at = COALESCE($9, expires_at),
       database_dump = COALESCE($10::jsonb, database_dump)
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.status ?? null,
      patch.storagePath ?? null,
      patch.sizeBytes ?? null,
      patch.checksum ?? null,
      patch.startedAt ?? null,
      patch.completedAt ?? null,
      patch.errorMessage !== undefined ? patch.errorMessage : null,
      patch.expiresAt ?? null,
      // Serialised here, not by the driver: `pg` and PGlite both accept a JS object for jsonb, but
      // only by accident of their own serialisers, and this column must mean the same thing on both.
      patch.databaseDump === undefined || patch.databaseDump === null
        ? null
        : JSON.stringify(patch.databaseDump),
    ]
  );
  return rows[0] ?? null;
}

export async function listBackupsForInstallation(db: Queryable, installationId: string): Promise<BackupRow[]> {
  const { rows } = await db.query<BackupRow>(
    `SELECT * FROM backups WHERE installation_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [installationId]
  );
  return rows;
}

export async function findBackupById(db: Queryable, id: string): Promise<BackupRow | null> {
  const { rows } = await db.query<BackupRow>(`SELECT * FROM backups WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

// --- Subscriptions (spec §21) --------------------------------------------------------------------

export interface SubscriptionRow {
  id: string;
  customer_id: string;
  plan_id: string;
  order_id: string | null;
  installation_id: string | null;
  status: string;
  provider: string | null;
  provider_subscription_id: string | null;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  grace_period_days: number | null;
  past_due_since: string | null;
  suspended_at: string | null;
  terminated_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function createSubscription(
  db: Queryable,
  input: {
    customerId: string;
    planId: string;
    orderId?: string | null;
    installationId?: string | null;
    provider?: string | null;
    periodEnd: Date;
    status?: string;
  }
): Promise<SubscriptionRow> {
  const { rows } = await db.query<SubscriptionRow>(
    `INSERT INTO subscriptions (id, customer_id, plan_id, order_id, installation_id, provider, current_period_end, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      randomUUID(),
      input.customerId,
      input.planId,
      input.orderId ?? null,
      input.installationId ?? null,
      input.provider ?? null,
      input.periodEnd.toISOString(),
      input.status ?? 'active',
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('createSubscription: insert returned no row');
  return row;
}

export async function findSubscriptionById(db: Queryable, id: string): Promise<SubscriptionRow | null> {
  const { rows } = await db.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listSubscriptionsForCustomer(db: Queryable, customerId: string): Promise<SubscriptionRow[]> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE customer_id = $1 ORDER BY created_at DESC`,
    [customerId]
  );
  return rows;
}

export async function listSubscriptionsByStatus(db: Queryable, status: string): Promise<SubscriptionRow[]> {
  const { rows } = await db.query<SubscriptionRow>(
    `SELECT * FROM subscriptions WHERE status = $1 ORDER BY current_period_end ASC LIMIT 500`,
    [status]
  );
  return rows;
}

export async function updateSubscription(
  db: Queryable,
  id: string,
  patch: Partial<{
    status: string;
    cancelAtPeriodEnd: boolean;
    cancelledAt: string | null;
    gracePeriodDays: number;
    pastDueSince: string | null;
    suspendedAt: string | null;
    terminatedAt: string | null;
    providerSubscriptionId: string | null;
    installationId: string | null;
  }>
): Promise<SubscriptionRow | null> {
  const existing = await db.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE`, [id]);
  const current = existing.rows[0];
  if (!current) return null;
  const { rows } = await db.query<SubscriptionRow>(
    `UPDATE subscriptions SET
       status = $2, cancel_at_period_end = $3, cancelled_at = $4, grace_period_days = $5,
       past_due_since = $6, suspended_at = $7, terminated_at = $8, provider_subscription_id = $9,
       installation_id = $10, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [
      id,
      patch.status ?? current.status,
      patch.cancelAtPeriodEnd ?? current.cancel_at_period_end,
      patch.cancelledAt !== undefined ? patch.cancelledAt : current.cancelled_at,
      patch.gracePeriodDays ?? current.grace_period_days,
      patch.pastDueSince !== undefined ? patch.pastDueSince : current.past_due_since,
      patch.suspendedAt !== undefined ? patch.suspendedAt : current.suspended_at,
      patch.terminatedAt !== undefined ? patch.terminatedAt : current.terminated_at,
      patch.providerSubscriptionId !== undefined ? patch.providerSubscriptionId : current.provider_subscription_id,
      patch.installationId !== undefined ? patch.installationId : current.installation_id,
    ]
  );
  return rows[0] ?? null;
}

// --- Platform settings ---------------------------------------------------------------------------

export interface PlatformSettingRow {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export async function getSetting<T>(db: Queryable, key: string, fallback: T): Promise<T> {
  const { rows } = await db.query<PlatformSettingRow>(
    `SELECT * FROM platform_settings WHERE key = $1`,
    [key]
  );
  const row = rows[0];
  return row ? (row.value as T) : fallback;
}

export async function listSettings(db: Queryable): Promise<PlatformSettingRow[]> {
  const { rows } = await db.query<PlatformSettingRow>(`SELECT * FROM platform_settings ORDER BY key ASC`);
  return rows;
}

export async function setSetting(
  db: Queryable,
  key: string,
  value: unknown,
  updatedBy?: string | null
): Promise<PlatformSettingRow> {
  const { rows } = await db.query<PlatformSettingRow>(
    `INSERT INTO platform_settings (key, value, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [key, JSON.stringify(value), updatedBy ?? null]
  );
  const row = rows[0];
  if (!row) throw new Error('setSetting: upsert returned no row');
  return row;
}

// --- Server metrics (spec §51) -------------------------------------------------------------------

export interface ServerMetricRow {
  id: string;
  server_id: string;
  captured_at: string;
  cpu_percent: string | null;
  load_1: string | null;
  load_5: string | null;
  load_15: string | null;
  memory_used_mb: number | null;
  memory_total_mb: number | null;
  disk_used_mb: number | null;
  disk_total_mb: number | null;
  network_in_bytes: number | null;
  network_out_bytes: number | null;
  uptime_seconds: number | null;
  docker_containers: number | null;
  docker_containers_healthy: number | null;
}

export async function insertServerMetric(
  db: Queryable,
  input: Omit<ServerMetricRow, 'id' | 'captured_at'>
): Promise<ServerMetricRow> {
  const { rows } = await db.query<ServerMetricRow>(
    `INSERT INTO server_metrics (
       id, server_id, cpu_percent, load_1, load_5, load_15, memory_used_mb, memory_total_mb,
       disk_used_mb, disk_total_mb, network_in_bytes, network_out_bytes, uptime_seconds,
       docker_containers, docker_containers_healthy
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [
      randomUUID(),
      input.server_id,
      input.cpu_percent,
      input.load_1,
      input.load_5,
      input.load_15,
      input.memory_used_mb,
      input.memory_total_mb,
      input.disk_used_mb,
      input.disk_total_mb,
      input.network_in_bytes,
      input.network_out_bytes,
      input.uptime_seconds,
      input.docker_containers,
      input.docker_containers_healthy,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('insertServerMetric: insert returned no row');
  return row;
}

export async function listServerMetrics(
  db: Queryable,
  serverId: string,
  limit = 60
): Promise<ServerMetricRow[]> {
  const { rows } = await db.query<ServerMetricRow>(
    `SELECT * FROM server_metrics WHERE server_id = $1 ORDER BY captured_at DESC LIMIT ${limit}`,
    [serverId]
  );
  return rows;
}

/** Retention trim: keeps the newest `keep` snapshots per server (called by the monitoring job). */
export async function trimServerMetrics(db: Queryable, keep = 2016): Promise<void> {
  await db.query(
    `DELETE FROM server_metrics WHERE id IN (
       SELECT id FROM (
         SELECT id, row_number() OVER (PARTITION BY server_id ORDER BY captured_at DESC) AS rn
         FROM server_metrics
       ) ranked WHERE ranked.rn > $1
     )`,
    [keep]
  );
}
