/**
 * Backup Jobs Database Repository (Section 34).
 *
 * Manages server snapshots, container/app backups, database dumps,
 * remote S3/R2 storage targets, and retention policies.
 */
import type { Queryable } from './types';

export interface BackupJobRow {
  id: string;
  server_id: string | null;
  service_id: string | null;
  installation_id: string | null;
  job_type: 'SERVER_SNAPSHOT' | 'APP_BACKUP' | 'DATABASE_BACKUP' | 'FULL_SYSTEM';
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  storage_provider: 'local' | 's3' | 'r2' | 'remote';
  storage_path: string | null;
  size_bytes: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  server_name?: string;
  server_ip?: string;
}

const SELECT_BACKUP_JOINS = `
  SELECT
    bj.*,
    s.name AS server_name,
    COALESCE(s.ipv4, s.ip_address) AS server_ip
  FROM backup_jobs bj
  LEFT JOIN servers s ON s.id = bj.server_id
`;

export async function listBackupJobsForServer(pool: Queryable, serverId: string): Promise<BackupJobRow[]> {
  const { rows } = await pool.query<BackupJobRow>(
    `${SELECT_BACKUP_JOINS} WHERE bj.server_id = $1 ORDER BY bj.created_at DESC`,
    [serverId]
  );
  return rows;
}

export async function listBackupJobsForService(pool: Queryable, serviceId: string): Promise<BackupJobRow[]> {
  const { rows } = await pool.query<BackupJobRow>(
    `${SELECT_BACKUP_JOINS} WHERE bj.service_id = $1 ORDER BY bj.created_at DESC`,
    [serviceId]
  );
  return rows;
}

export async function findBackupJobById(pool: Queryable, id: string): Promise<BackupJobRow | null> {
  const { rows } = await pool.query<BackupJobRow>(
    `${SELECT_BACKUP_JOINS} WHERE bj.id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export interface CreateBackupJobInput {
  serverId?: string | null;
  serviceId?: string | null;
  installationId?: string | null;
  jobType?: BackupJobRow['job_type'];
  status?: BackupJobRow['status'];
  storageProvider?: BackupJobRow['storage_provider'];
  storagePath?: string | null;
  sizeBytes?: number | null;
  metadata?: Record<string, unknown>;
}

export async function createBackupJob(pool: Queryable, input: CreateBackupJobInput): Promise<BackupJobRow> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO backup_jobs (
       server_id, service_id, installation_id, job_type, status,
       storage_provider, storage_path, size_bytes, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      input.serverId ?? null,
      input.serviceId ?? null,
      input.installationId ?? null,
      input.jobType ?? 'SERVER_SNAPSHOT',
      input.status ?? 'QUEUED',
      input.storageProvider ?? 'local',
      input.storagePath ?? null,
      input.sizeBytes ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('Failed to create backup job');
  const created = await findBackupJobById(pool, id);
  if (!created) throw new Error('Failed to load created backup job');
  return created;
}

export interface UpdateBackupJobInput {
  status?: BackupJobRow['status'];
  sizeBytes?: number | null;
  storagePath?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export async function updateBackupJob(
  pool: Queryable,
  id: string,
  patch: UpdateBackupJobInput
): Promise<BackupJobRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  function set(column: string, value: unknown) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if (patch.status !== undefined) set('status', patch.status);
  if (patch.sizeBytes !== undefined) set('size_bytes', patch.sizeBytes);
  if (patch.storagePath !== undefined) set('storage_path', patch.storagePath);
  if (patch.startedAt !== undefined) set('started_at', patch.startedAt);
  if (patch.completedAt !== undefined) set('completed_at', patch.completedAt);
  if (patch.errorMessage !== undefined) set('error_message', patch.errorMessage);
  if (patch.metadata !== undefined) set('metadata', JSON.stringify(patch.metadata));

  if (sets.length === 0) {
    return findBackupJobById(pool, id);
  }

  sets.push('updated_at = now()');
  params.push(id);
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE backup_jobs SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
    params
  );
  if (!rows[0]) return null;
  return findBackupJobById(pool, id);
}

export async function deleteBackupJob(pool: Queryable, id: string): Promise<boolean> {
  const { rows } = await pool.query<{ id: string }>(`DELETE FROM backup_jobs WHERE id = $1 RETURNING id`, [id]);
  return rows.length > 0;
}
