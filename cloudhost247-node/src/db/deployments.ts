/**
 * Phase 6 — deployment job queue + step/event records (spec §12, §13, §14, §28).
 *
 * PostgreSQL IS the queue broker: one transaction system covers jobs, steps, installations, and
 * financial state, and `FOR UPDATE SKIP LOCKED` gives multiple workers exactly-once claiming
 * without Redis. Enqueue is idempotent on idempotency_key (spec §12): a retried API request
 * returns the original job instead of creating a duplicate. Claiming is a single atomic
 * UPDATE...RETURNING, so two racing workers can never hold the same job; a lease with expiry
 * makes crashed workers recoverable — an expired lease is reclaimable by any worker.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';

export type DeploymentAction =
  | 'install'
  | 'start'
  | 'stop'
  | 'restart'
  | 'update'
  | 'backup'
  | 'restore'
  | 'reinstall'
  | 'uninstall'
  | 'ssl_provision'
  | 'domain_configure'
  | 'provision'
  | 'suspend'
  | 'terminate'
  | 'healthcheck';

export interface DeploymentRow {
  id: string;
  installation_id: string | null;
  server_id: string | null;
  order_id: string | null;
  action: DeploymentAction;
  status: string;
  idempotency_key: string;
  requested_by: string | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  run_after: string;
  lease_expires_at: string | null;
  worker_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeploymentStepRow {
  id: string;
  deployment_id: string;
  step_order: number;
  name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  output: string | null;
  error: string | null;
}

export interface DeploymentEventRow {
  id: string;
  deployment_id: string;
  level: string;
  message: string;
  created_at: string;
}

export interface EnqueueInput {
  installationId?: string | null;
  serverId?: string | null;
  orderId?: string | null;
  action: DeploymentAction;
  requestedBy?: string | null;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  /** Delay before the job becomes claimable (retry backoff). */
  runAfter?: Date;
}

export interface EnqueueResult {
  deployment: DeploymentRow;
  created: boolean;
}

/**
 * Idempotent enqueue. When idempotency_key already exists the existing row is returned with
 * created=false — the caller can surface "already queued" without erroring (spec §12).
 */
export async function enqueueDeployment(db: Queryable, input: EnqueueInput): Promise<EnqueueResult> {
  const id = randomUUID();
  const { rows } = await db.query<DeploymentRow>(
    `INSERT INTO deployments (
       id, installation_id, server_id, order_id, action, idempotency_key, requested_by,
       payload, max_attempts, run_after
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      id,
      input.installationId ?? null,
      input.serverId ?? null,
      input.orderId ?? null,
      input.action,
      input.idempotencyKey,
      input.requestedBy ?? null,
      JSON.stringify(input.payload ?? {}),
      input.maxAttempts ?? 3,
      (input.runAfter ?? new Date()).toISOString(),
    ]
  );
  const inserted = rows[0];
  if (inserted) return { deployment: inserted, created: true };
  const existing = await db.query<DeploymentRow>(
    `SELECT * FROM deployments WHERE idempotency_key = $1`,
    [input.idempotencyKey]
  );
  const row = existing.rows[0];
  if (!row) throw new Error('enqueueDeployment: conflict path found no existing row');
  return { deployment: row, created: false };
}

/**
 * Atomically claims the next runnable job for a worker (SKIP LOCKED: racing workers skip rows
 * already locked by others, so every job is claimed by at most one of them).
 */
export async function claimNextDeployment(
  db: Queryable,
  workerId: string,
  leaseMs: number
): Promise<DeploymentRow | null> {
  const { rows } = await db.query<DeploymentRow>(
    `WITH next_job AS (
       SELECT id FROM deployments
       WHERE status = 'queued' AND run_after <= now()
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE deployments d
     SET status = 'running',
         worker_id = $1,
         lease_expires_at = now() + make_interval(secs => $2::double precision / 1000.0),
         attempts = d.attempts + 1,
         started_at = COALESCE(d.started_at, now()),
         updated_at = now()
     FROM next_job
     WHERE d.id = next_job.id
     RETURNING d.*`,
    [workerId, leaseMs]
  );
  return rows[0] ?? null;
}

/**
 * Reclaims jobs whose worker died mid-run (lease expired). Same SKIP LOCKED discipline; the
 * attempts counter is NOT incremented here (the claim that started the run already counted it).
 */
export async function reclaimExpiredDeployments(
  db: Queryable,
  workerId: string,
  leaseMs: number
): Promise<DeploymentRow[]> {
  const { rows } = await db.query<DeploymentRow>(
    `WITH expired AS (
       SELECT id FROM deployments
       WHERE status = 'running' AND lease_expires_at < now()
       FOR UPDATE SKIP LOCKED
     )
     UPDATE deployments d
     SET worker_id = $1,
         lease_expires_at = now() + make_interval(secs => $2::double precision / 1000.0),
         updated_at = now()
     FROM expired
     WHERE d.id = expired.id
     RETURNING d.*`,
    [workerId, leaseMs]
  );
  return rows;
}

/** Keeps the lease alive while a handler is still working (long deploys, big image pulls). */
export async function renewDeploymentLease(
  db: Queryable,
  id: string,
  workerId: string,
  leaseMs: number
): Promise<boolean> {
  const { rows } = await db.query(
    `UPDATE deployments
     SET lease_expires_at = now() + make_interval(secs => $3::double precision / 1000.0), updated_at = now()
     WHERE id = $1 AND worker_id = $2 AND status = 'running'
     RETURNING id`,
    [id, workerId, leaseMs]
  );
  return rows.length > 0;
}

export async function completeDeployment(db: Queryable, id: string): Promise<DeploymentRow | null> {
  const { rows } = await db.query<DeploymentRow>(
    `UPDATE deployments
     SET status = 'succeeded', completed_at = now(), lease_expires_at = NULL,
         error_code = NULL, error_message = NULL, updated_at = now()
     WHERE id = $1 AND status = 'running'
     RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export interface FailOptions {
  errorCode?: string;
  errorMessage?: string;
  /** Exponential backoff base for an automatic retry (spec §28 reliability). */
  retryDelayMs?: number;
}

/**
 * Fails a running job. When attempts remain, the job is re-queued with exponential backoff
 * instead of being left failed — the failure is only terminal on the last attempt.
 */
export async function failDeployment(
  db: Queryable,
  deployment: DeploymentRow,
  options: FailOptions = {}
): Promise<DeploymentRow | null> {
  const canRetry = deployment.attempts < deployment.max_attempts;
  const delay = options.retryDelayMs ?? Math.min(60_000, 2 ** deployment.attempts * 5_000);
  const { rows } = await db.query<DeploymentRow>(
    `UPDATE deployments
     SET status = $2::varchar,
         run_after = CASE WHEN $2::varchar = 'queued' THEN now() + make_interval(secs => $3::double precision / 1000.0) ELSE run_after END,
         lease_expires_at = NULL,
         error_code = $4,
         error_message = $5,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      deployment.id,
      canRetry ? 'queued' : 'failed',
      delay,
      options.errorCode ?? null,
      options.errorMessage ?? null,
    ]
  );
  return rows[0] ?? null;
}

/** Marks a running job as rolling back (spec §14) — the worker cleans partial resources. */
export async function markRollingBack(db: Queryable, id: string, reason: string): Promise<DeploymentRow | null> {
  const { rows } = await db.query<DeploymentRow>(
    `UPDATE deployments
     SET status = 'rolling_back', error_message = $2, updated_at = now()
     WHERE id = $1 AND status IN ('running', 'failed')
     RETURNING *`,
    [id, reason]
  );
  return rows[0] ?? null;
}

/** Terminal state after rollback cleanup finished (resources removed) — distinct from failed. */
export async function markRolledBack(db: Queryable, id: string): Promise<DeploymentRow | null> {
  const { rows } = await db.query<DeploymentRow>(
    `UPDATE deployments
     SET status = 'rolled_back', completed_at = now(), lease_expires_at = NULL, updated_at = now()
     WHERE id = $1 AND status = 'rolling_back'
     RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

/** Cancellation is only possible before a job starts running (spec §24). */
export async function cancelDeployment(db: Queryable, id: string): Promise<DeploymentRow | null> {
  const { rows } = await db.query<DeploymentRow>(
    `UPDATE deployments
     SET status = 'cancelled', completed_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'queued'
     RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findDeploymentById(db: Queryable, id: string): Promise<DeploymentRow | null> {
  const { rows } = await db.query<DeploymentRow>(`SELECT * FROM deployments WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findDeploymentByIdempotencyKey(db: Queryable, key: string): Promise<DeploymentRow | null> {
  const { rows } = await db.query<DeploymentRow>(`SELECT * FROM deployments WHERE idempotency_key = $1`, [key]);
  return rows[0] ?? null;
}

export interface DeploymentListFilters {
  installationId?: string;
  serverId?: string;
  requestedBy?: string;
  customerId?: string;
  status?: string;
  action?: string;
  limit?: number;
}

export async function listDeployments(
  db: Queryable,
  filters: DeploymentListFilters = {}
): Promise<DeploymentRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (fragment: string, value: unknown) => {
    params.push(value);
    conditions.push(fragment.replace('?', `$${params.length}`));
  };
  if (filters.installationId) add('d.installation_id = ?', filters.installationId);
  if (filters.serverId) add('d.server_id = ?', filters.serverId);
  if (filters.requestedBy) add('d.requested_by = ?', filters.requestedBy);
  if (filters.customerId) add('i.customer_id = ?', filters.customerId);
  if (filters.status) add('d.status = ?', filters.status);
  if (filters.action) add('d.action = ?', filters.action);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await db.query<DeploymentRow>(
    `SELECT d.* FROM deployments d
     LEFT JOIN application_installations i ON i.id = d.installation_id
     ${where}
     ORDER BY d.created_at DESC
     LIMIT ${filters.limit ?? 100}`,
    params
  );
  return rows;
}

// --- Steps (spec §13) ----------------------------------------------------------------------------

export interface StepDefinition {
  name: string;
}

/** Creates the full step pipeline up-front so a failure states exactly which step failed. */
export async function createDeploymentSteps(
  db: Queryable,
  deploymentId: string,
  stepNames: string[]
): Promise<DeploymentStepRow[]> {
  // A retried deployment restarts its pipeline from the top: the previous attempt's step rows
  // are replaced (deployment_events keeps the full per-attempt history for the console).
  await db.query(`DELETE FROM deployment_steps WHERE deployment_id = $1`, [deploymentId]);
  const rows: DeploymentStepRow[] = [];
  for (let index = 0; index < stepNames.length; index += 1) {
    const { rows: inserted } = await db.query<DeploymentStepRow>(
      `INSERT INTO deployment_steps (id, deployment_id, step_order, name)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [randomUUID(), deploymentId, index + 1, stepNames[index]]
    );
    const row = inserted[0];
    if (!row) throw new Error('createDeploymentSteps: insert returned no row');
    rows.push(row);
  }
  return rows;
}

export async function startStep(db: Queryable, stepId: string): Promise<void> {
  await db.query(
    `UPDATE deployment_steps SET status = 'running', started_at = now() WHERE id = $1 AND status = 'pending'`,
    [stepId]
  );
}

export async function finishStep(
  db: Queryable,
  stepId: string,
  status: 'succeeded' | 'failed' | 'skipped',
  output?: string,
  error?: string
): Promise<void> {
  await db.query(
    `UPDATE deployment_steps
     SET status = $2, completed_at = now(), output = COALESCE($3, output), error = $4
     WHERE id = $1`,
    [stepId, status, output ?? null, error ?? null]
  );
}

export async function listDeploymentSteps(db: Queryable, deploymentId: string): Promise<DeploymentStepRow[]> {
  const { rows } = await db.query<DeploymentStepRow>(
    `SELECT * FROM deployment_steps WHERE deployment_id = $1 ORDER BY step_order ASC`,
    [deploymentId]
  );
  return rows;
}

// --- Events (log stream, spec §24) ---------------------------------------------------------------

export async function appendDeploymentEvent(
  db: Queryable,
  deploymentId: string,
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string
): Promise<void> {
  await db.query(
    `INSERT INTO deployment_events (id, deployment_id, level, message) VALUES ($1, $2, $3, $4)`,
    [randomUUID(), deploymentId, level, message]
  );
}

/** Events after `since` (ISO timestamp) — the SSE endpoint's polling cursor. */
export async function listDeploymentEvents(
  db: Queryable,
  deploymentId: string,
  since?: string
): Promise<DeploymentEventRow[]> {
  const { rows } = await db.query<DeploymentEventRow>(
    `SELECT * FROM deployment_events
     WHERE deployment_id = $1 AND ($2::timestamptz IS NULL OR created_at > $2::timestamptz)
     ORDER BY created_at ASC
     LIMIT 500`,
    [deploymentId, since ?? null]
  );
  return rows;
}
