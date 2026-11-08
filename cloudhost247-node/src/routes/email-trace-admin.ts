/**
 * Administrative Email Trace Centre API (`/api/v1/admin/email-trace*`).
 *
 * Role-gated with `requireRole([...EMAIL_TRACE_ADMIN_ROLES])`, which re-reads the caller's role from
 * the database on every request. Every action here is audited *before* it is performed and the
 * request fails if the audit row cannot be written — "an admin asked a mail server for data" is not
 * an action that may happen without a record.
 *
 * The admin surface is deliberately small. There is no endpoint that edits Exim configuration,
 * restarts a mail service, deletes or forces a queue entry, or reads an arbitrary path: collection
 * reads a bounded slice of one configured log, and the queue is listed read-only.
 */
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';
import {
  findEmailTraceSourceById,
  listEmailTraceEvents,
  listEmailTraceSources,
  updateEmailTraceSource,
} from '../db/email-trace';
import { EMAIL_TRACE_ADMIN_ROLES, scopeForAdminConsole } from '../email-trace/access-control';
import { auditEmailTraceAction, auditEmailTraceRead } from '../email-trace/audit';
import { collectServerTrace, collectEnabledServers } from '../email-trace/collector';
import { createAgentEximTraceAdapter } from '../email-trace/adapters/exim-agent';
import {
  buildHealthView,
  buildQueueView,
  buildSummary,
  buildTimeline,
  listRunViews,
  toEventView,
  DELIVERY_EVIDENCE_NOTE,
} from '../email-trace/trace-service';
import { DELIVERY_STATUSES, type DeliveryStatus } from '../email-trace/types';

const collectBodySchema = z.object({
  serverId: z.string().uuid().optional(),
  /** Collect every enabled source instead of one server. Mutually exclusive with `serverId`. */
  all: z.boolean().optional(),
});

const sourcePatchSchema = z.object({
  collectionEnabled: z.boolean().optional(),
  retentionDaysOverride: z.number().int().min(1).max(3650).nullable().optional(),
});

const runsQuerySchema = z.object({
  sourceId: z.string().uuid().optional(),
  status: z.enum(['running', 'ok', 'partial', 'failed', 'skipped']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const listQuerySchema = z.object({
  status: z.string().optional(),
  domain: z.string().max(253).optional(),
  messageId: z.string().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  }
  return parsed.data;
}

export async function registerEmailTraceAdminRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);

  app.get('/api/v1/admin/email-trace', async (request) => {
    const auth = await requireRole(request, env, pool, EMAIL_TRACE_ADMIN_ROLES);
    const query = parseOrThrow(listQuerySchema, request.query);
    const statuses = query.status
      ?.split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
      .filter((value): value is DeliveryStatus => (DELIVERY_STATUSES as readonly string[]).includes(value));

    const result = await listEmailTraceEvents(
      pool,
      {
        statuses,
        domain: query.domain,
        messageId: query.messageId,
        limit: query.limit,
        offset: query.offset,
      },
      scopeForAdminConsole()
    );

    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.list_view', {
      scope: 'admin',
      resultCount: result.events.length,
    });

    return {
      events: result.events.map((row) => ({
        ...toEventView(row, {}),
        // Only the admin surface exposes attribution, and only as ids — never another tenant's name.
        customerId: row.customer_id,
        hostingAccountId: row.hosting_account_id,
      })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      evidenceNote: DELIVERY_EVIDENCE_NOTE,
    };
  });

  app.get('/api/v1/admin/email-trace/summary', async (request) => {
    const auth = await requireRole(request, env, pool, EMAIL_TRACE_ADMIN_ROLES);
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
    const summary = await buildSummary(pool, { from, to }, scopeForAdminConsole());
    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.summary_view', { scope: 'admin' });
    return { window: '24h', unclaimedEventsIncluded: true, ...summary };
  });

  app.get('/api/v1/admin/email-trace/sources', async (request) => {
    const auth = await requireRole(request, env, pool, EMAIL_TRACE_ADMIN_ROLES);
    const sources = await listEmailTraceSources(pool);
    const health = await buildHealthView(pool, scopeForAdminConsole());
    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.source_view', { scope: 'admin' });
    return {
      sources: sources.map((source) => ({
        id: source.id,
        serverId: source.server_id,
        providerType: source.provider_type,
        collectionMethod: source.collection_method,
        collectionEnabled: source.collection_enabled,
        status: source.status,
        capability: source.capability,
        checkpoint: source.checkpoint,
        retentionDaysOverride: source.retention_days_override,
        lastSuccessAt: source.last_success_at,
        lastFailureAt: source.last_failure_at,
        lastErrorCode: source.last_error_code,
        lastErrorMessage: source.last_error_message,
      })),
      health: health.sources,
      note:
        'Collection is opt-in per server. A server that has never been enabled has no source row and produces no trace data.',
    };
  });

  app.patch('/api/v1/admin/email-trace/sources/:sourceId', async (request) => {
    const auth = await requireRole(request, env, pool, EMAIL_TRACE_ADMIN_ROLES);
    const params = parseOrThrow(z.object({ sourceId: z.string().uuid() }), request.params);
    const body = parseOrThrow(sourcePatchSchema, request.body ?? {});

    const existing = await findEmailTraceSourceById(pool, params.sourceId);
    if (!existing) throw new NotFoundError('Trace source not found');

    await auditEmailTraceAction(pool, request, auth.userId, 'email_trace.source_updated', {
      sourceId: params.sourceId,
      serverId: existing.server_id,
      changes: body,
    });

    const updated = await updateEmailTraceSource(pool, params.sourceId, body);
    if (!updated) throw new NotFoundError('Trace source not found');
    return {
      source: {
        id: updated.id,
        serverId: updated.server_id,
        collectionEnabled: updated.collection_enabled,
        retentionDaysOverride: updated.retention_days_override,
        status: updated.status,
      },
    };
  });

  app.post(
    '/api/v1/admin/email-trace/collect',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const auth = await requireRole(request, env, pool, EMAIL_TRACE_ADMIN_ROLES);
      const body = parseOrThrow(collectBodySchema, request.body ?? {});
      if (!body.serverId && body.all !== true) {
        throw new ValidationError('serverId is required (or "all": true to collect every enabled source)');
      }

      await auditEmailTraceAction(pool, request, auth.userId, 'email_trace.collect_requested', {
        serverId: body.serverId ?? null,
        all: body.all === true,
      });

      const adapter = createAgentEximTraceAdapter(pool);
      if (body.all === true) {
        const results = await collectEnabledServers(pool, adapter);
        return {
          collected: results.length,
          results: results.map((result) => ({
            serverId: result.serverId,
            runId: result.runId,
            status: result.status,
            reason: result.reason,
            seen: result.seen,
            collected: result.collected,
            duplicates: result.duplicates,
            rejected: result.rejected,
            unattributed: result.unattributed,
            capability: result.capability,
          })),
        };
      }

      const result = await collectServerTrace(pool, adapter, {
        serverId: body.serverId!,
        trigger: 'admin',
        actorId: auth.userId,
      });

      return {
        collected: 1,
        results: [
          {
            serverId: result.serverId,
            runId: result.runId,
            status: result.status,
            reason: result.reason,
            seen: result.seen,
            collected: result.collected,
            duplicates: result.duplicates,
            rejected: result.rejected,
            unattributed: result.unattributed,
            capability: result.capability,
          },
        ],
      };
    }
  );

  app.get('/api/v1/admin/email-trace/collection-runs', async (request) => {
    const auth = await requireRole(request, env, pool, EMAIL_TRACE_ADMIN_ROLES);
    const query = parseOrThrow(runsQuerySchema, request.query);
    const runs = await listRunViews(pool, query);
    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.health_view', {
      scope: 'admin',
      view: 'collection-runs',
    });
    return runs;
  });

  app.get('/api/v1/admin/email-trace/queue', async (request) => {
    const auth = await requireRole(request, env, pool, EMAIL_TRACE_ADMIN_ROLES);
    const view = await buildQueueView(pool);
    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.queue_view', { scope: 'admin' });
    return view;
  });

  app.get('/api/v1/admin/email-trace/:traceId', async (request) => {
    const auth = await requireRole(request, env, pool, EMAIL_TRACE_ADMIN_ROLES);
    const params = parseOrThrow(z.object({ traceId: z.string().min(1).max(128) }), request.params);
    const timeline = await buildTimeline(pool, params.traceId, scopeForAdminConsole());
    if (!timeline) throw new NotFoundError('Trace not found');
    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.detail_view', {
      traceId: params.traceId,
      scope: 'admin',
    });
    return timeline;
  });
}
