/**
 * Read-side composition for the Email Trace Centre.
 *
 * This layer exists so no route ever builds a status label or an ownership decision on its own. It
 * turns repository rows into the objects the UI renders, and it is the single place where the
 * vocabulary's honesty rules are attached to the data:
 *
 *   - `DELIVERED` is described as "the receiving server accepted it over SMTP", never as "it reached
 *     the inbox", and nothing in this module can produce an "opened" or "read" claim.
 *   - A summary always contains every status, with zeroes — an absent status is never rendered as a
 *     gap that looks like "no problem".
 *   - Capability and queue data are labelled with *when* they were observed, because both are
 *     snapshots of a collection run, not live readings of a mail server.
 */
import type { Queryable } from '../db/types';
import {
  findEmailTraceSourceByServer,
  findEmailTraceTimeline,
  listEmailTraceCollectionRuns,
  listEmailTraceEvents,
  listLatestQueueSnapshots,
  summariseEmailTraceEvents,
  type EmailTraceEventRow,
  type EmailTraceFilters,
  type EmailTraceScope,
  type EmailTraceSourceRow,
} from '../db/email-trace';
import { DELIVERY_STATUSES, type DeliveryStatus, type QueueSnapshot } from './types';

export interface StatusDescription {
  label: string;
  /** What the platform actually observed. Written for a customer, no jargon, no promises. */
  explanation: string;
  /** How much this status can be trusted as evidence of delivery. */
  evidence: 'transport' | 'local' | 'none';
}

const STATUS_DESCRIPTIONS: Record<DeliveryStatus, StatusDescription> = {
  ACCEPTED: {
    label: 'Accepted',
    explanation: 'Our mail server accepted the message for delivery. Nothing has been sent onwards yet.',
    evidence: 'local',
  },
  QUEUED: {
    label: 'Queued',
    explanation: 'The message is waiting in the mail queue for another delivery attempt.',
    evidence: 'local',
  },
  PROCESSING: {
    label: 'Processing',
    explanation: 'The mail server is working on the message right now.',
    evidence: 'local',
  },
  DEFERRED: {
    label: 'Deferred',
    explanation:
      'The receiving server did not accept the message yet and asked us to try again later. This is often temporary.',
    evidence: 'transport',
  },
  DELIVERED: {
    label: 'Delivered',
    explanation:
      'The receiving mail server accepted the message over SMTP. This confirms transport, not inbox placement, and it says nothing about whether the message was read.',
    evidence: 'transport',
  },
  BOUNCED: {
    label: 'Bounced',
    explanation: 'The receiving server rejected the message permanently. The reply from that server is shown below.',
    evidence: 'transport',
  },
  REJECTED: {
    label: 'Rejected',
    explanation: 'Our mail server refused to accept the message, usually because of a policy on the sending side.',
    evidence: 'local',
  },
  FAILED: {
    label: 'Failed',
    explanation: 'Our mail server could not complete delivery, and the log does not contain a reply from the receiving server.',
    evidence: 'none',
  },
  UNKNOWN: {
    label: 'Unknown',
    explanation:
      'The log evidence for this message is incomplete or contradictory, so no status is claimed. This is reported honestly rather than guessed.',
    evidence: 'none',
  },
};

export function describeStatus(status: DeliveryStatus): StatusDescription {
  return STATUS_DESCRIPTIONS[status];
}

/** Platform-wide statement, repeated wherever statuses appear. */
export const DELIVERY_EVIDENCE_NOTE =
  'Statuses come from SMTP replies recorded in mail server logs. Inbox placement, spam-folder placement and whether a message was opened are never observed by this platform.';

export interface TraceEventView {
  id: string;
  traceId: string;
  eventType: string;
  status: DeliveryStatus;
  statusLabel: string;
  statusExplanation: string;
  sender: string;
  recipient: string;
  senderDomain: string;
  recipientDomain: string;
  smtpResponseCode: number | null;
  smtpResponseText: string | null;
  remoteHostname: string | null;
  occurredAt: string;
  serverId: string;
}

/**
 * Mask the local part of an address (`jane.doe@example.com` → `j***@example.com`).
 *
 * Off by default: the address is what a customer needs to find their own message. It is available
 * for deployments that decide trace lists are shown to a wider audience than the mailbox owner.
 */
export function maskAddress(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return address;
  const local = address.slice(0, at);
  const domain = address.slice(at);
  const keep = local.slice(0, 1);
  return `${keep}${'*'.repeat(Math.max(1, Math.min(local.length - 1, 6)))}${domain}`;
}

export function toEventView(row: EmailTraceEventRow, options: { mask?: boolean } = {}): TraceEventView {
  const description = describeStatus(row.delivery_status);
  return {
    id: row.id,
    traceId: row.trace_id,
    eventType: row.event_type,
    status: row.delivery_status,
    statusLabel: description.label,
    statusExplanation: description.explanation,
    sender: options.mask ? maskAddress(row.sender) : row.sender,
    recipient: options.mask ? maskAddress(row.recipient) : row.recipient,
    senderDomain: row.sender_domain,
    recipientDomain: row.recipient_domain,
    smtpResponseCode: row.smtp_response_code,
    smtpResponseText: row.smtp_response_text,
    remoteHostname: row.remote_hostname,
    occurredAt: new Date(row.event_timestamp).toISOString(),
    serverId: row.source_server_id,
  };
}

export interface SummaryView {
  total: number;
  byStatus: Record<DeliveryStatus, number>;
  from: string | null;
  to: string | null;
  evidenceNote: string;
}

export async function buildSummary(
  db: Queryable,
  filters: EmailTraceFilters,
  scope: EmailTraceScope
): Promise<SummaryView> {
  const summary = await summariseEmailTraceEvents(db, filters, scope);
  const byStatus = {} as Record<DeliveryStatus, number>;
  for (const status of DELIVERY_STATUSES) byStatus[status] = summary.byStatus[status] ?? 0;
  return {
    total: summary.total,
    byStatus,
    from: filters.from ? filters.from.toISOString() : null,
    to: filters.to ? filters.to.toISOString() : null,
    evidenceNote: DELIVERY_EVIDENCE_NOTE,
  };
}

export interface TimelineView {
  traceId: string;
  events: TraceEventView[];
  /** Most recent event's status — the same single-event rule as the dashboard. */
  latestStatus: DeliveryStatus;
  sender: string;
  recipient: string;
  firstSeenAt: string;
  lastSeenAt: string;
  evidenceNote: string;
}

/**
 * One message's timeline, oldest first. Returns `null` when the trace does not exist *or* lies
 * outside the caller's scope — the route turns both into 404.
 */
export async function buildTimeline(
  db: Queryable,
  traceId: string,
  scope: EmailTraceScope,
  options: { mask?: boolean } = {}
): Promise<TimelineView | null> {
  const rows = await findEmailTraceTimeline(db, traceId, scope);
  if (!rows || rows.length === 0) return null;

  const ordered = [...rows].sort(
    (a, b) => new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime()
  );
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;

  return {
    traceId,
    events: ordered.map((row) => toEventView(row, options)),
    latestStatus: last.delivery_status,
    sender: options.mask ? maskAddress(first.sender) : first.sender,
    recipient: options.mask ? maskAddress(first.recipient) : first.recipient,
    firstSeenAt: new Date(first.event_timestamp).toISOString(),
    lastSeenAt: new Date(last.event_timestamp).toISOString(),
    evidenceNote: DELIVERY_EVIDENCE_NOTE,
  };
}

export interface QueueView {
  serverId: string;
  queueCount: number;
  oldestSeconds: number | null;
  deferred: number;
  observedAt: string;
  /** Always present: the queue is a snapshot of the last run, never a live reading. */
  note: string;
}

/**
 * The queue as of each server's last successful collection.
 *
 * Read-only and historical by design: this view cannot delete, freeze, retry or force a message,
 * and it never claims to be live.
 */
export async function buildQueueView(db: Queryable): Promise<{ servers: QueueView[]; note: string }> {
  const snapshots = await listLatestQueueSnapshots(db);
  const note =
    'Queue figures are a snapshot taken by the last successful collection run. They are read-only: this platform never removes, freezes, retries or forces a queued message.';
  return {
    servers: snapshots.map((row) => ({
      serverId: row.server_id,
      queueCount: row.queue_count ?? 0,
      oldestSeconds: row.queue_oldest_seconds,
      deferred: row.queue_deferred ?? 0,
      observedAt: new Date(row.observed_at).toISOString(),
      note,
    })),
    note,
  };
}

export interface SourceHealthView {
  serverId: string;
  status: string;
  collectionEnabled: boolean;
  collectionMethod: string;
  checkpointOffset: number | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  capability: Record<string, unknown>;
}

function toSourceHealth(row: EmailTraceSourceRow): SourceHealthView {
  const checkpoint = (row.checkpoint ?? {}) as Record<string, unknown>;
  return {
    serverId: row.server_id,
    status: row.status,
    collectionEnabled: row.collection_enabled,
    collectionMethod: row.collection_method,
    checkpointOffset: typeof checkpoint.offset === 'number' ? checkpoint.offset : null,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at).toISOString() : null,
    lastFailureAt: row.last_failure_at ? new Date(row.last_failure_at).toISOString() : null,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    capability: row.capability ?? {},
  };
}

/**
 * Per-server collection health. Scoped: a customer sees the status of the servers that hold their
 * mail, but never another tenant's source configuration.
 */
export async function buildHealthView(
  db: Queryable,
  scope: EmailTraceScope,
  serverIds?: string[]
): Promise<{ sources: SourceHealthView[]; note: string; summary: { ok: number; degraded: number; error: number; disabled: number } }> {
  const { rows } = await db.query<EmailTraceSourceRow>(
    `SELECT DISTINCT ON (s.id) s.*
       FROM email_trace_sources s
       LEFT JOIN email_trace_events e ON e.source_server_id = s.server_id
      WHERE ($1::uuid[] IS NULL OR e.customer_id = ANY($1::uuid[]))
        AND ($2::uuid[] IS NULL OR s.server_id = ANY($2::uuid[]))
      ORDER BY s.id`,
    [scope.customerIds && scope.customerIds.length > 0 ? scope.customerIds : null, serverIds && serverIds.length > 0 ? serverIds : null]
  );

  const summary = { ok: 0, degraded: 0, error: 0, disabled: 0 };
  for (const row of rows) {
    if (row.status === 'ok') summary.ok += 1;
    else if (row.status === 'degraded') summary.degraded += 1;
    else if (row.status === 'error') summary.error += 1;
    else summary.disabled += 1;
  };

  return {
    sources: rows.map(toSourceHealth),
    summary,
    note: 'Collection health describes whether this platform could read each mail server. "Error" means the server could not be read — not that no mail was sent.',
  };
}

export interface CollectionRunView {
  id: string;
  serverId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  recordsSeen: number;
  recordsCollected: number;
  recordsRejected: number;
  queueCount: number | null;
  errorClass: string | null;
  errorMessage: string | null;
}

/** Recent collection runs for the admin console — the audit trail of the collector itself. */
export async function listRunViews(
  db: Queryable,
  filters: { sourceId?: string; status?: string; limit?: number; offset?: number } = {}
): Promise<{ runs: CollectionRunView[]; total: number }> {
  const { runs, total } = await listEmailTraceCollectionRuns(db, filters);
  return {
    total,
    runs: runs.map((row) => ({
      id: row.id,
      serverId: row.server_id,
      status: row.status,
      startedAt: new Date(row.started_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      recordsSeen: row.records_seen,
      recordsCollected: row.records_collected,
      recordsRejected: row.records_rejected,
      queueCount: row.queue_count,
      errorClass: row.error_class,
      errorMessage: row.error_message,
    })),
  };
}

/** Convenience re-exports so routes import one module, not five. */
export { listEmailTraceEvents, findEmailTraceSourceByServer, type EmailTraceFilters, type EmailTraceScope };

export interface QueueServerRef {
  serverId: string;
}

/** Parse the queue snapshot stored in a run, for tests and future per-run views. */
export function parseStoredQueue(rows: Array<{ queue_count: number | null; queue_deferred: number | null; queue_oldest_seconds: number | null }>): QueueSnapshot | null {
  const head = rows[0];
  if (!head || head.queue_count === null) return null;
  return {
    messages: [],
    count: head.queue_count,
    oldestSeconds: head.queue_oldest_seconds,
    deferred: head.queue_deferred ?? 0,
    unparsedLines: 0,
  };
}
