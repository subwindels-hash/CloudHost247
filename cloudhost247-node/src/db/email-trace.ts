/**
 * Email Trace Centre repository — every SQL statement the feature issues.
 *
 * Kept in `src/db/` like the rest of the platform's data access, so route handlers and the collector
 * never build SQL inline. Two properties matter more than usual here:
 *
 *   - **Tenant scoping is a parameter, not a convention.** List and detail queries accept explicit
 *     `customerIds` / `hostingAccountIds` sets that the access-control layer resolves from the
 *     authenticated user. A query without a scope is the staff/admin view, and that is only reachable
 *     through an admin route.
 *   - **Deduplication happens in the database.** `insertEmailTraceEvents` relies on the unique index
 *     from migration 0089 and reports how many rows were actually written, so a re-collected line is
 *     counted as duplicate rather than stored twice.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from './types';
import type { DeliveryStatus, NormalisedTraceEvent } from '../email-trace/types';

export interface EmailTraceEventRow {
  id: string;
  trace_id: string;
  provider_message_id: string | null;
  hosting_account_id: string | null;
  customer_id: string | null;
  domain_id: string | null;
  sender: string;
  recipient: string;
  sender_domain: string;
  recipient_domain: string;
  event_type: string;
  delivery_status: DeliveryStatus;
  smtp_response_code: number | null;
  smtp_response_text: string | null;
  remote_hostname: string | null;
  event_timestamp: Date;
  source_server_id: string;
  source_event_hash: string;
  retention_hold: boolean;
  created_at: Date;
}

/** A normalised event plus the ownership links resolved at collection time. */
export interface EmailTraceEventInsert extends NormalisedTraceEvent {
  hostingAccountId?: string | null;
  customerId?: string | null;
  domainId?: string | null;
}

export interface EmailTraceSourceRow {
  id: string;
  server_id: string;
  provider_type: string;
  collection_method: string;
  capability: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  collection_enabled: boolean;
  last_success_at: Date | null;
  last_failure_at: Date | null;
  last_error_code: string | null;
  last_error_message: string | null;
  status: string;
  config_reference: string | null;
  retention_days_override: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface EmailTraceCollectionRunRow {
  id: string;
  source_id: string;
  server_id: string;
  started_at: Date;
  completed_at: Date | null;
  status: string;
  records_seen: number;
  records_collected: number;
  records_rejected: number;
  queue_count: number | null;
  queue_oldest_seconds: number | null;
  queue_deferred: number | null;
  error_class: string | null;
  error_message: string | null;
  checkpoint_after: Record<string, unknown> | null;
  lease_holder: string | null;
}

/**
 * Tenant scope passed to every read. An empty (or absent) `customerIds`/`hostingAccountIds` array is
 * a *closed* scope, never "unrestricted" — see src/email-trace/access-control.ts.
 */
export interface EmailTraceScope {
  customerIds?: string[];
  hostingAccountIds?: string[];
}

export interface EmailTraceFilters extends EmailTraceScope {
  /** Free-text-ish exact filters; all bound as parameters. */
  sender?: string;
  recipient?: string;
  /** Matches `recipient_domain` or `sender_domain`. */
  domain?: string;
  messageId?: string;
  statuses?: DeliveryStatus[];
  smtpCode?: number;
  serverIds?: string[];
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

const MAX_LIMIT = 200;

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit) || limit < 1) return 50;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/**
 * Builds the shared WHERE clause for event reads.
 *
 * `scope` is intentionally explicit rather than inferred from the caller's role: the access-control
 * layer decides the scope once, and every read then applies it the same way.
 */
function buildEventWhere(filters: EmailTraceFilters, scope: EmailTraceFilters): { clause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  const push = (sql: (index: number) => string, value: unknown) => {
    params.push(value);
    clauses.push(sql(params.length));
  };

  if (filters.sender) push((i) => `lower(sender) = lower($${i})`, filters.sender);
  if (filters.recipient) push((i) => `lower(recipient) = lower($${i})`, filters.recipient);
  if (filters.domain) {
    push((i) => `(recipient_domain = lower($${i}) OR sender_domain = lower($${i}))`, filters.domain);
  }
  if (filters.messageId) push((i) => `trace_id = $${i}`, filters.messageId);
  if (filters.smtpCode !== undefined) push((i) => `smtp_response_code = $${i}`, filters.smtpCode);
  if (filters.statuses && filters.statuses.length > 0) {
    const placeholders = filters.statuses.map((status) => {
      params.push(status);
      return `$${params.length}`;
    });
    clauses.push(`delivery_status IN (${placeholders.join(', ')})`);
  }
  if (filters.serverIds && filters.serverIds.length > 0) {
    const placeholders = filters.serverIds.map((id) => {
      params.push(id);
      return `$${params.length}`;
    });
    clauses.push(`source_server_id IN (${placeholders.join(', ')})`);
  }
  if (filters.from) push((i) => `event_timestamp >= $${i}`, filters.from);
  if (filters.to) push((i) => `event_timestamp <= $${i}`, filters.to);

  if (scope.customerIds) {
    if (scope.customerIds.length === 0) clauses.push('false');
    else {
      const placeholders = scope.customerIds.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      clauses.push(`customer_id IN (${placeholders.join(', ')})`);
    }
  }
  if (scope.hostingAccountIds) {
    if (scope.hostingAccountIds.length === 0) clauses.push('false');
    else {
      const placeholders = scope.hostingAccountIds.map((id) => {
        params.push(id);
        return `$${params.length}`;
      });
      clauses.push(`hosting_account_id IN (${placeholders.join(', ')})`);
    }
  }

  return { clause: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

/**
 * Inserts a batch of events, ignoring any that already exist.
 *
 * Returns the rows actually written: the difference between the batch size and this count is the
 * number of duplicates the unique index rejected, which the collection run records honestly.
 */
export async function insertEmailTraceEvents(
  db: Queryable,
  sourceServerId: string,
  events: EmailTraceEventInsert[]
): Promise<{ inserted: number; duplicates: number }> {
  if (events.length === 0) return { inserted: 0, duplicates: 0 };

  const columns = [
    'id',
    'trace_id',
    'provider_message_id',
    'hosting_account_id',
    'customer_id',
    'domain_id',
    'sender',
    'recipient',
    'sender_domain',
    'recipient_domain',
    'event_type',
    'delivery_status',
    'smtp_response_code',
    'smtp_response_text',
    'remote_hostname',
    'event_timestamp',
    'source_server_id',
    'source_event_hash',
  ];

  const params: unknown[] = [];
  const tuples: string[] = [];

  for (const event of events) {
    const placeholders = [
      randomUUID(),
      event.traceId,
      event.providerMessageId,
      event.hostingAccountId ?? null,
      event.customerId ?? null,
      event.domainId ?? null,
      event.sender,
      event.recipient,
      event.senderDomain,
      event.recipientDomain,
      event.eventType,
      event.deliveryStatus,
      event.smtpResponseCode,
      event.smtpResponseText,
      event.remoteHostname,
      event.eventTimestamp,
      sourceServerId,
      event.sourceEventHash,
    ].map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    tuples.push(`(${placeholders.join(', ')})`);
  }

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO email_trace_events (${columns.join(', ')})
     VALUES ${tuples.join(', ')}
     ON CONFLICT (source_server_id, source_event_hash) DO NOTHING
     RETURNING id`,
    params
  );

  return { inserted: rows.length, duplicates: events.length - rows.length };
}

/** Paged event list, newest first, with the total count for the same filters. */
export async function listEmailTraceEvents(
  db: Queryable,
  filters: EmailTraceFilters,
  scope: EmailTraceFilters = {}
): Promise<{ events: EmailTraceEventRow[]; total: number; limit: number; offset: number }> {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset && filters.offset > 0 ? Math.floor(filters.offset) : 0;
  const { clause, params } = buildEventWhere(filters, scope);

  const countResult = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM email_trace_events ${clause}`,
    params
  );

  const pagedParams = [...params, limit, offset];
  const { rows } = await db.query<EmailTraceEventRow>(
    `SELECT * FROM email_trace_events ${clause}
     ORDER BY event_timestamp DESC, created_at DESC
     LIMIT $${pagedParams.length - 1} OFFSET $${pagedParams.length}`,
    pagedParams
  );

  return { events: rows, total: Number(countResult.rows[0]?.count ?? 0), limit, offset };
}

/**
 * One trace, oldest first — the timeline.
 *
 * Returns `null` when the trace does not exist *inside the caller's scope*, so a customer cannot
 * distinguish "not yours" from "not found".
 */
export async function findEmailTraceTimeline(
  db: Queryable,
  traceId: string,
  scope: EmailTraceFilters = {}
): Promise<EmailTraceEventRow[] | null> {
  const { clause, params } = buildEventWhere({ messageId: traceId }, scope);
  const { rows } = await db.query<EmailTraceEventRow>(
    `SELECT * FROM email_trace_events ${clause}
     ORDER BY event_timestamp ASC, created_at ASC
     LIMIT $${params.length + 1}`,
    [...params, MAX_LIMIT]
  );
  return rows.length > 0 ? rows : null;
}

/** Status counts for the dashboard, within a window and a scope. */
export async function summariseEmailTraceEvents(
  db: Queryable,
  filters: EmailTraceFilters,
  scope: EmailTraceFilters = {}
): Promise<{ total: number; byStatus: Record<DeliveryStatus, number> }> {
  const { clause, params } = buildEventWhere(filters, scope);
  const { rows } = await db.query<{ delivery_status: DeliveryStatus; count: string }>(
    `SELECT delivery_status, count(*)::text AS count
     FROM email_trace_events ${clause}
     GROUP BY delivery_status`,
    params
  );

  const byStatus: Record<DeliveryStatus, number> = {
    ACCEPTED: 0,
    QUEUED: 0,
    PROCESSING: 0,
    DEFERRED: 0,
    DELIVERED: 0,
    BOUNCED: 0,
    REJECTED: 0,
    FAILED: 0,
    UNKNOWN: 0,
  };
  let total = 0;
  for (const row of rows) {
    byStatus[row.delivery_status] = Number(row.count);
    total += Number(row.count);
  }
  return { total, byStatus };
}

// ---------------------------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------------------------

export async function findEmailTraceSourceByServer(
  db: Queryable,
  serverId: string
): Promise<EmailTraceSourceRow | null> {
  const { rows } = await db.query<EmailTraceSourceRow>(
    `SELECT * FROM email_trace_sources WHERE server_id = $1`,
    [serverId]
  );
  return rows[0] ?? null;
}

export async function findEmailTraceSourceById(
  db: Queryable,
  id: string
): Promise<EmailTraceSourceRow | null> {
  const { rows } = await db.query<EmailTraceSourceRow>(
    `SELECT * FROM email_trace_sources WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listEmailTraceSources(db: Queryable): Promise<EmailTraceSourceRow[]> {
  const { rows } = await db.query<EmailTraceSourceRow>(
    `SELECT * FROM email_trace_sources ORDER BY created_at ASC`
  );
  return rows;
}

export interface UpsertSourceInput {
  serverId: string;
  providerType?: string;
  collectionMethod?: string;
  collectionEnabled?: boolean;
  configReference?: string | null;
  retentionDaysOverride?: number | null;
}

/** Creates the source row for a server if it does not exist, and never overwrites a live one. */
export async function ensureEmailTraceSource(
  db: Queryable,
  input: UpsertSourceInput
): Promise<EmailTraceSourceRow> {
  const { rows } = await db.query<EmailTraceSourceRow>(
    `INSERT INTO email_trace_sources
       (id, server_id, provider_type, collection_method, collection_enabled, config_reference,
        retention_days_override, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'not_configured')
     ON CONFLICT (server_id) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      randomUUID(),
      input.serverId,
      input.providerType ?? 'unknown',
      input.collectionMethod ?? 'none',
      input.collectionEnabled ?? false,
      input.configReference ?? null,
      input.retentionDaysOverride ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create the email trace source row');
  return row;
}

export interface SourceUpdateInput {
  collectionEnabled?: boolean;
  collectionMethod?: string;
  providerType?: string;
  configReference?: string | null;
  retentionDaysOverride?: number | null;
  status?: string;
  capability?: Record<string, unknown>;
}

/** Updates source configuration. Returns null when the source does not exist (404 at the route). */
export async function updateEmailTraceSource(
  db: Queryable,
  id: string,
  input: SourceUpdateInput
): Promise<EmailTraceSourceRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const set = (sql: (index: number) => string, value: unknown) => {
    params.push(value);
    sets.push(sql(params.length));
  };

  if (input.collectionEnabled !== undefined) set((i) => `collection_enabled = $${i}`, input.collectionEnabled);
  if (input.collectionMethod !== undefined) set((i) => `collection_method = $${i}`, input.collectionMethod);
  if (input.providerType !== undefined) set((i) => `provider_type = $${i}`, input.providerType);
  if (input.configReference !== undefined) set((i) => `config_reference = $${i}`, input.configReference);
  if (input.retentionDaysOverride !== undefined) {
    set((i) => `retention_days_override = $${i}`, input.retentionDaysOverride);
  }
  if (input.status !== undefined) set((i) => `status = $${i}`, input.status);
  if (input.capability !== undefined) set((i) => `capability = $${i}::jsonb`, JSON.stringify(input.capability));

  if (sets.length === 0) return findEmailTraceSourceById(db, id);

  params.push(id);
  const { rows } = await db.query<EmailTraceSourceRow>(
    `UPDATE email_trace_sources
        SET ${sets.join(', ')}, updated_at = now()
      WHERE id = $${params.length}
      RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

/** Records a healthy collection: checkpoint advances, the previous failure is cleared. */
export async function markEmailTraceSourceSuccess(
  db: Queryable,
  id: string,
  checkpoint: Record<string, unknown>,
  capability?: Record<string, unknown>
): Promise<void> {
  await db.query(
    `UPDATE email_trace_sources
        SET checkpoint = $2::jsonb,
            capability = COALESCE($3::jsonb, capability),
            status = 'ok',
            last_success_at = now(),
            last_error_code = NULL,
            last_error_message = NULL,
            updated_at = now()
      WHERE id = $1`,
    [id, JSON.stringify(checkpoint), capability === undefined ? null : JSON.stringify(capability)]
  );
}

/**
 * Records a failed collection. The checkpoint is deliberately left untouched so the next run
 * re-reads the same window instead of skipping the lines that caused the failure.
 */
export async function markEmailTraceSourceFailure(
  db: Queryable,
  id: string,
  errorCode: string,
  errorMessage: string
): Promise<void> {
  await db.query(
    `UPDATE email_trace_sources
        SET status = 'error',
            last_failure_at = now(),
            last_error_code = $2,
            last_error_message = $3,
            updated_at = now()
      WHERE id = $1`,
    [id, errorCode, errorMessage.slice(0, 500)]
  );
}

// ---------------------------------------------------------------------------------------------
// Collection runs
// ---------------------------------------------------------------------------------------------

export async function startEmailTraceCollectionRun(
  db: Queryable,
  input: { sourceId: string; serverId: string; leaseHolder?: string | null }
): Promise<EmailTraceCollectionRunRow> {
  const { rows } = await db.query<EmailTraceCollectionRunRow>(
    `INSERT INTO email_trace_collection_runs (id, source_id, server_id, status, lease_holder)
     VALUES ($1, $2, $3, 'running', $4)
     RETURNING *`,
    [randomUUID(), input.sourceId, input.serverId, input.leaseHolder ?? null]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to start an email trace collection run');
  return row;
}

export interface CompleteRunInput {
  status: 'ok' | 'partial' | 'failed' | 'skipped';
  /** Counts default to 0 so a failed run does not have to invent them. */
  recordsSeen?: number;
  recordsCollected?: number;
  recordsRejected?: number;
  queueCount?: number | null;
  queueOldestSeconds?: number | null;
  queueDeferred?: number | null;
  errorClass?: string | null;
  errorMessage?: string | null;
  checkpointAfter?: Record<string, unknown> | null;
}

export async function completeEmailTraceCollectionRun(
  db: Queryable,
  id: string,
  input: CompleteRunInput
): Promise<EmailTraceCollectionRunRow | null> {
  const { rows } = await db.query<EmailTraceCollectionRunRow>(
    `UPDATE email_trace_collection_runs
        SET completed_at = now(),
            status = $2,
            records_seen = $3,
            records_collected = $4,
            records_rejected = $5,
            queue_count = $6,
            queue_oldest_seconds = $7,
            queue_deferred = $8,
            error_class = $9,
            error_message = $10,
            checkpoint_after = $11::jsonb
      WHERE id = $1
      RETURNING *`,
    [
      id,
      input.status,
      input.recordsSeen ?? 0,
      input.recordsCollected ?? 0,
      input.recordsRejected ?? 0,
      input.queueCount ?? null,
      input.queueOldestSeconds ?? null,
      input.queueDeferred ?? null,
      input.errorClass ?? null,
      input.errorMessage ? input.errorMessage.slice(0, 500) : null,
      input.checkpointAfter === null || input.checkpointAfter === undefined
        ? null
        : JSON.stringify(input.checkpointAfter),
    ]
  );
  return rows[0] ?? null;
}

export async function listEmailTraceCollectionRuns(
  db: Queryable,
  filters: { sourceId?: string; status?: string; limit?: number; offset?: number } = {}
): Promise<{ runs: EmailTraceCollectionRunRow[]; total: number }> {
  const limit = clampLimit(filters.limit);
  const offset = filters.offset && filters.offset > 0 ? Math.floor(filters.offset) : 0;
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.sourceId) {
    params.push(filters.sourceId);
    clauses.push(`source_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    clauses.push(`status = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const countResult = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM email_trace_collection_runs ${where}`,
    params
  );

  const pagedParams = [...params, limit, offset];
  const { rows } = await db.query<EmailTraceCollectionRunRow>(
    `SELECT * FROM email_trace_collection_runs ${where}
     ORDER BY started_at DESC
     LIMIT $${pagedParams.length - 1} OFFSET $${pagedParams.length}`,
    pagedParams
  );

  return { runs: rows, total: Number(countResult.rows[0]?.count ?? 0) };
}

/**
 * The queue as of each server's last successful collection.
 *
 * Reading the queue from the run history (rather than probing live on a page load) keeps the admin
 * view honest about *when* the number was observed.
 */
export async function listLatestQueueSnapshots(
  db: Queryable
): Promise<Array<{ server_id: string; source_id: string; observed_at: Date; queue_count: number; queue_oldest_seconds: number | null; queue_deferred: number | null }>> {
  const { rows } = await db.query<{
    server_id: string;
    source_id: string;
    observed_at: Date;
    queue_count: number;
    queue_oldest_seconds: number | null;
    queue_deferred: number | null;
  }>(
    `SELECT DISTINCT ON (server_id)
            server_id, source_id, completed_at AS observed_at,
            queue_count, queue_oldest_seconds, queue_deferred
       FROM email_trace_collection_runs
      WHERE queue_count IS NOT NULL AND completed_at IS NOT NULL
      ORDER BY server_id, completed_at DESC`
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------------------------

/**
 * Deletes events older than the retention window, except rows pinned by an investigation.
 *
 * Returns how many rows were deleted and how many were held back, so the sweep can report a held
 * count instead of appearing to have erased evidence.
 */
export async function trimEmailTraceEvents(
  db: Queryable,
  retentionDays: number
): Promise<{ deleted: number; held: number }> {
  const days = Math.max(1, Math.min(Math.floor(retentionDays), 3650));
  const deleted = await db.query<{ id: string }>(
    `DELETE FROM email_trace_events
      WHERE event_timestamp < now() - ($1 || ' days')::interval
        AND retention_hold = false
      RETURNING id`,
    [String(days)]
  );
  const held = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM email_trace_events
      WHERE event_timestamp < now() - ($1 || ' days')::interval
        AND retention_hold = true`,
    [String(days)]
  );
  return { deleted: deleted.rows.length, held: Number(held.rows[0]?.count ?? 0) };
}

export async function trimEmailTraceCollectionRuns(
  db: Queryable,
  retentionDays: number
): Promise<number> {
  const days = Math.max(1, Math.min(Math.floor(retentionDays), 3650));
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM email_trace_collection_runs
      WHERE started_at < now() - ($1 || ' days')::interval
      RETURNING id`,
    [String(days)]
  );
  return rows.length;
}
