/**
 * Phase 6 — append-only platform audit trail (spec §54).
 *
 * audit_logs records privileged actions (server registration, credential rotation, catalog
 * publishing, deployments, domain/SSL operations, settings changes). Rows are never updated or
 * deleted by application code. Failures to write an audit row are deliberately *loud* (rejected
 * promise) for the admin routes that require them, but `recordAuditBestEffort` exists for
 * post-success contexts (e.g. after a deployment finished) where failing the user-facing
 * operation over the audit write would be worse than logging the gap to the app log.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Queryable } from '../db/types';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

function clientIp(request: FastifyRequest): string | null {
  // trustProxy is enabled (src/app.ts) so Fastify normalizes X-Forwarded-For for us; fall back
  // to the socket address when no proxy header is present (local dev, direct agent calls).
  return request.ip ?? null;
}

/** Writes one audit row inside the caller's transaction/connection. */
export async function recordAudit(
  db: Queryable,
  entry: AuditEntry,
  context: AuditContext = {}
): Promise<void> {
  await db.query(
    `INSERT INTO audit_logs (id, actor_id, action, resource_type, resource_id, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      randomUUID(),
      entry.actorId ?? null,
      entry.action,
      entry.resourceType,
      entry.resourceId ?? null,
      context.ipAddress ?? null,
      context.userAgent ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ]
  );
}

/** Audit-context helper that pulls IP/user-agent straight from the request. */
export function requestAuditContext(request: FastifyRequest): AuditContext {
  return {
    ipAddress: clientIp(request),
    userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  };
}

/** Writes an audit row tied to the acting request (actor, IP, user-agent). */
export async function auditRequest(
  db: Queryable,
  request: FastifyRequest,
  actorId: string | null | undefined,
  entry: AuditEntry
): Promise<void> {
  await recordAudit(db, { ...entry, actorId: actorId ?? null }, requestAuditContext(request));
}

/** Fire-and-forget variant for post-success contexts; logs failures, never throws. */
export async function recordAuditBestEffort(
  db: Queryable,
  entry: AuditEntry,
  context: AuditContext = {}
): Promise<void> {
  try {
    await recordAudit(db, entry, context);
  } catch {
    // Logged by caller if it matters; an audit gap must not take down a completed operation.
  }
}
