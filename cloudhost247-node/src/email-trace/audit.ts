/**
 * Audit trail for the Email Trace Centre.
 *
 * Two different things are recorded here, for two different reasons:
 *
 *  1. **Access** — who looked at whose mail. A trace timeline is personal data even without bodies,
 *     so a customer-facing read is recorded (subject + support-mode admin included) rather than
 *     silently allowed. This is what makes "who has been reading my message history?" answerable.
 *  2. **Actions** — collection requests and source configuration changes, with enough detail to
 *     reconstruct what the collector did (server, trigger, run id) without copying any message
 *     content into the audit log.
 *
 * Nothing here writes an address, a subject, a body or a credential into `audit_logs`. The trace id
 * is included because it is the identifier an investigation needs, and it is not personal data on
 * its own.
 */
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/types';
import { auditRequest, recordAuditBestEffort, requestAuditContext } from '../lib/audit';

export const EMAIL_TRACE_AUDIT_RESOURCE = 'email_trace';

export type EmailTraceAuditAction =
  | 'email_trace.list_view'
  | 'email_trace.detail_view'
  | 'email_trace.timeline_view'
  | 'email_trace.summary_view'
  | 'email_trace.domain_view'
  | 'email_trace.queue_view'
  | 'email_trace.health_view'
  | 'email_trace.collect_requested'
  | 'email_trace.source_view'
  | 'email_trace.source_updated';

/**
 * Records a read. Best-effort on purpose: an audit outage must not turn a customer's own message
 * history into a 500, and the access itself is already filtered by tenant scope. Failures are
 * swallowed exactly as `recordAuditBestEffort` documents.
 */
export async function auditEmailTraceRead(
  db: Queryable,
  request: FastifyRequest,
  actorId: string,
  action: EmailTraceAuditAction,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await recordAuditBestEffort(
    db,
    {
      actorId,
      action,
      resourceType: EMAIL_TRACE_AUDIT_RESOURCE,
      resourceId: typeof metadata.traceId === 'string' ? metadata.traceId : null,
      metadata,
    },
    requestAuditContext(request)
  );
}

/**
 * Records an administrative action. Deliberately *not* best-effort: if we cannot write the audit
 * row for "an admin asked a mail server for data", the action is refused rather than performed
 * unaudited.
 */
export async function auditEmailTraceAction(
  db: Queryable,
  request: FastifyRequest,
  actorId: string,
  action: EmailTraceAuditAction,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await auditRequest(db, request, actorId, {
    action,
    resourceType: EMAIL_TRACE_AUDIT_RESOURCE,
    resourceId: typeof metadata.serverId === 'string' ? metadata.serverId : null,
    metadata,
  });
}

/** Worker-context audit write (no HTTP request): collection outcomes and retention trims. */
export async function auditEmailTraceWorkerAction(
  db: Queryable,
  action: EmailTraceAuditAction,
  metadata: Record<string, unknown>
): Promise<void> {
  await recordAuditBestEffort(db, {
    actorId: null,
    action,
    resourceType: EMAIL_TRACE_AUDIT_RESOURCE,
    resourceId: typeof metadata.serverId === 'string' ? metadata.serverId : null,
    metadata,
  });
}
