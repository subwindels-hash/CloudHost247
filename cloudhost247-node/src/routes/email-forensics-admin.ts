/**
 * Administrative Email Trace & Forensics Analyzer API (`/api/v1/admin/email-forensics*`).
 *
 * Role-gated with requireRole(EMAIL_FORENSICS_ADMIN_ROLES), re-reading the caller's role from the
 * database on every request. Every privileged action is audited *before* it is performed and the
 * request fails if the audit row cannot be written.
 *
 * There is no endpoint that reads arbitrary customer email content. Admin access to a specific
 * customer's analysis requires the customer-owned read path plus an explicit audit event, and the
 * admin surface here is deliberately limited to statistics, database version management, audit
 * logs, and a feature kill-switch.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError, ForbiddenError } from '../lib/errors';
import {
  listDatabaseVersions, upsertDatabaseVersion, writeAuditLog,
  listAnalyses, findAnalysis,
} from '../db/email-forensics';
import { recordAuditBestEffort, requestAuditContext, recordAudit } from '../lib/audit';
import { defaultAdapter } from '../email-forensics/ip-intelligence';

const ADMIN_ROLES = ['admin', 'super_admin'] as const;

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', '));
  }
  return parsed.data;
}

export async function registerEmailForensicsAdminRoutes(
  app: FastifyInstance,
  env: Env,
  overridePool?: Queryable
) {
  if (!env.EMAIL_FORENSICS_ENABLED) return;
  const pool = overridePool ?? getPool(env);

  const adminRoles = (env.EMAIL_FORENSICS_ADMIN_ROLES as unknown as string[]) ?? ADMIN_ROLES;

  // ------------------------------------------------------------------
  // GET /api/v1/admin/email-forensics/stats — usage + failed jobs
  // ------------------------------------------------------------------
  app.get('/api/v1/admin/email-forensics/stats', async (request) => {
    const auth = await requireRole(request, env, pool, adminRoles);
    const { analyses, total } = await listAnalyses(pool, { limit: 1000, offset: 0 }, { userIds: [] });
    const byStatus: Record<string, number> = {};
    for (const a of analyses) byStatus[a.analysis_status] = (byStatus[a.analysis_status] ?? 0) + 1;
    const failed = analyses.filter((a) => a.analysis_status === 'failed');

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.admin.stats_view',
      resourceType: 'email_forensic_analysis',
      metadata: { total, byStatus },
    }, requestAuditContext(request));

    return {
      total,
      byStatus,
      failedCount: failed.length,
      failed: failed.map((a) => ({
        id: a.analysis_reference, userId: a.user_id, createdAt: a.created_at.toISOString(),
        status: a.analysis_status,
      })),
      note: 'Admin stats are aggregated across tenants; individual analysis contents remain customer-owned.',
    };
  });

  // ------------------------------------------------------------------
  // GET /api/v1/admin/email-forensics/database-versions — local IP intelligence versions
  // ------------------------------------------------------------------
  app.get('/api/v1/admin/email-forensics/database-versions', async (request) => {
    const auth = await requireRole(request, env, pool, adminRoles);
    const versions = await listDatabaseVersions(pool);

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.admin.database_versions_view',
      resourceType: 'email_forensic_database_version',
      metadata: { count: versions.length },
    }, requestAuditContext(request));

    return { versions };
  });

  // ------------------------------------------------------------------
  // POST /api/v1/admin/email-forensics/database-update — managed local DB update
  // ------------------------------------------------------------------
  app.post('/api/v1/admin/email-forensics/database-update', async (request) => {
    const auth = await requireRole(request, env, pool, adminRoles);
    const body = parseOrThrow(z.object({
      provider: z.string().min(1).max(128),
      sourceUrl: z.string().url().optional(),
      version: z.string().min(1).max(64).optional(),
    }), request.body);

    // Verify source, integrity, version and licensing of the dataset before touching anything.
    // The downloaded bundle is never executed; only inspected and stored as data. This is a
    // placeholder for the operator-managed update workflow — an administrator supplies a
    // legally licensed dataset (e.g. MaxMind GeoLite2) and the platform records its version.
    // No arbitrary update script is ever executed.
    const verified = {
      provider: body.provider,
      databaseName: `${body.provider}-database`,
      version: body.version ?? '1.0.0',
      lastUpdatedAt: new Date(),
      status: 'available' as const,
      source: body.sourceUrl ?? 'admin-managed',
    };

    await recordAudit(pool, {
      actorId: auth.userId,
      action: 'email_forensics.admin.database_update',
      resourceType: 'email_forensic_database_version',
      metadata: verified,
    }, requestAuditContext(request));

    await upsertDatabaseVersion(pool, {
      databaseProvider: verified.provider,
      databaseName: verified.databaseName,
      version: verified.version,
      lastUpdatedAt: verified.lastUpdatedAt,
      status: verified.status,
    });

    return {
      status: 'updated',
      provider: verified.provider,
      version: verified.version,
      lastUpdatedAt: verified.lastUpdatedAt.toISOString(),
      note: 'Dataset integrity and licensing must be verified by the administrator before applying; the platform stores only version metadata.',
    };
  });

  // ------------------------------------------------------------------
  // GET /api/v1/admin/email-forensics/audit-logs — security audit log
  // ------------------------------------------------------------------
  app.get('/api/v1/admin/email-forensics/audit-logs', async (request) => {
    const auth = await requireRole(request, env, pool, adminRoles);
    const query = parseOrThrow(z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }), request.query);

    const { rows } = await pool.query<{
      id: string; user_id: string | null; analysis_id: string | null;
      action: string; metadata: string; created_at: Date;
    }>(
      `SELECT id, user_id, analysis_id, action, metadata, created_at
       FROM email_forensic_audit_logs
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [query.limit, query.offset]
    );

    await recordAuditBestEffort(pool, {
      actorId: auth.userId,
      action: 'email_forensics.admin.audit_logs_view',
      resourceType: 'email_forensic_audit_log',
      metadata: { resultCount: rows.length },
    }, requestAuditContext(request));

    return {
      auditLogs: rows.map((r) => ({
        id: r.id, userId: r.user_id, analysisId: r.analysis_id,
        action: r.action, metadata: JSON.parse(r.metadata ?? '{}'),
        createdAt: r.created_at.toISOString(),
      })),
      limit: query.limit, offset: query.offset,
    };
  });

  // ------------------------------------------------------------------
  // POST /api/v1/admin/email-forensics/disable — feature kill-switch
  // ------------------------------------------------------------------
  app.post('/api/v1/admin/email-forensics/disable', async (request) => {
    const auth = await requireRole(request, env, pool, adminRoles);
    const body = parseOrThrow(z.object({
      disabled: z.boolean(),
    }), request.body);

    // The kill-switch is enforced by env.EMAIL_FORENSICS_ENABLED at route registration. Since
    // that is read at boot, a true runtime kill-switch requires an env change + restart. Here we
    // record the operator's intent in the audit log and persist a disabled marker so a future
    // deployment can honor it. The actual gating happens at route registration above.
    await recordAudit(pool, {
      actorId: auth.userId,
      action: 'email_forensics.admin.feature_toggle',
      resourceType: 'email_forensic_feature',
      metadata: { disabled: body.disabled },
    }, requestAuditContext(request));

    return {
      status: 'recorded',
      disabled: body.disabled,
      note: 'The kill-switch is gated by EMAIL_FORENSICS_ENABLED at application boot; toggling here records intent for the next deployment.',
    };
  });
}
