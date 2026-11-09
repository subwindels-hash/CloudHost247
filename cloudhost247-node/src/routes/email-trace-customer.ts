/**
 * Customer-facing Email Trace Centre API (`/api/v1/email-trace*`).
 *
 * Every handler authenticates first, then builds its scope with `scopeForOwnMail()` — which is
 * always the caller's own customer id, whatever the caller's role. There is no query parameter that
 * widens that scope, and a trace that exists outside it returns 404, never 403, so this API never
 * confirms that another customer's message exists.
 *
 * What is returned is deliberately narrow: addresses, domains, timestamps, the SMTP reply and the
 * status — plus the explanation of what that status does and does not mean. Raw log lines, subjects,
 * message bodies, attachments and the sender's authentication state are never exposed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import { getPool } from '../db/pool';
import type { Queryable } from '../db/types';
import { authenticate } from '../lib/require-auth';
import { NotFoundError, ValidationError } from '../lib/errors';
import { DELIVERY_STATUSES, type DeliveryStatus } from '../email-trace/types';
import { resolveDomainAccess, scopeForOwnMail } from '../email-trace/access-control';
import { auditEmailTraceRead } from '../email-trace/audit';
import { diagnoseDomain, defaultDiagnosticRunners, DEFAULT_DKIM_SELECTORS } from '../email-trace/diagnostics';
import {
  buildHealthView,
  buildQueueView,
  buildSummary,
  buildTimeline,
  describeStatus,
  listEmailTraceEvents,
  toEventView,
  DELIVERY_EVIDENCE_NOTE,
} from '../email-trace/trace-service';

const statusSchema = z.enum(DELIVERY_STATUSES);
const idSchema = z.string().uuid('must be a valid id');

const listQuerySchema = z.object({
  status: z.string().optional(),
  domain: z.string().max(253).optional(),
  messageId: z.string().max(128).optional(),
  sender: z.string().max(320).optional(),
  recipient: z.string().max(320).optional(),
  smtpCode: z.coerce.number().int().min(100).max(599).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const windowSchema = z.object({
  window: z.enum(['24h', '7d', '30d', '90d']).default('24h'),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues.map((issue) => issue.message).join(', '));
  }
  return parsed.data;
}

function parseStatuses(raw: string | undefined): DeliveryStatus[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (values.length === 0) return undefined;
  const unknown = values.filter((value) => !statusSchema.safeParse(value).success);
  if (unknown.length > 0) throw new ValidationError(`Unknown status: ${unknown.join(', ')}`);
  return values as DeliveryStatus[];
}

/** Per-check ceiling for the diagnostics endpoint: one hung resolver must not stall the page. */
const EMPTY_TRACE_CHECK_TIMEOUT_MS = 8_000;

const WINDOW_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

export async function registerEmailTraceCustomerRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable) {
  const pool = overridePool ?? getPool(env);
  const mask = env.EMAIL_TRACE_MASK_ADDRESSES;

  /** The evidence vocabulary is published so the UI never hard-codes a status label. */
  app.get('/api/v1/email-trace/statuses', async (request) => {
    await authenticate(request, env, pool);
    return {
      statuses: DELIVERY_STATUSES.map((status) => ({ status, ...describeStatus(status) })),
      evidenceNote: DELIVERY_EVIDENCE_NOTE,
    };
  });

  app.get('/api/v1/email-trace', async (request) => {
    const auth = await authenticate(request, env, pool);
    const query = parseOrThrow(listQuerySchema, request.query);
    const scope = scopeForOwnMail(auth);

    const result = await listEmailTraceEvents(
      pool,
      {
        statuses: parseStatuses(query.status),
        domain: query.domain,
        messageId: query.messageId,
        sender: query.sender,
        recipient: query.recipient,
        smtpCode: query.smtpCode,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
        limit: query.limit,
        offset: query.offset,
      },
      scope
    );

    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.list_view', {
      resultCount: result.events.length,
      viaSupportSession: auth.supportSessionId ?? null,
    });

    return {
      events: result.events.map((row) => toEventView(row, { mask })),
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      evidenceNote: DELIVERY_EVIDENCE_NOTE,
    };
  });

  app.get('/api/v1/email-trace/summary', async (request) => {
    const auth = await authenticate(request, env, pool);
    const { window } = parseOrThrow(windowSchema, request.query);
    const scope = scopeForOwnMail(auth);
    const to = new Date();
    const from = new Date(to.getTime() - WINDOW_MS[window]!);

    const summary = await buildSummary(pool, { from, to }, scope);
    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.summary_view', {
      window,
      viaSupportSession: auth.supportSessionId ?? null,
    });
    return { window, ...summary };
  });

  app.get('/api/v1/email-trace/queue', async (request) => {
    const auth = await authenticate(request, env, pool);
    const scope = scopeForOwnMail(auth);
    const view = await buildQueueView(pool);

    // A customer only sees queue figures for servers that have carried their mail.
    const { sources } = await buildHealthView(pool, scope);
    const visible = new Set(sources.map((source) => source.serverId));

    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.queue_view', {
      serverCount: view.servers.length,
      viaSupportSession: auth.supportSessionId ?? null,
    });
    return { ...view, servers: view.servers.filter((server) => visible.has(server.serverId)) };
  });

  app.get('/api/v1/email-trace/health', async (request) => {
    const auth = await authenticate(request, env, pool);
    const scope = scopeForOwnMail(auth);
    const health = await buildHealthView(pool, scope);
    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.health_view', {
      viaSupportSession: auth.supportSessionId ?? null,
    });
    return health;
  });

  app.get('/api/v1/email-trace/domains/:domainId', async (request) => {
    const auth = await authenticate(request, env, pool);
    const params = parseOrThrow(z.object({ domainId: idSchema }), request.params);
    const access = await resolveDomainAccess(pool, auth, params.domainId);
    // Not mine and not real are the same answer.
    if (!access) throw new NotFoundError('Domain not found');

    const to = new Date();
    const from = new Date(to.getTime() - WINDOW_MS['30d']!);
    const filters = { domain: access.domainName, from, to };
    const [events, summary] = await Promise.all([
      listEmailTraceEvents(pool, filters, access.scope),
      buildSummary(pool, filters, access.scope),
    ]);

    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.domain_view', {
      domainId: access.domainId,
      domain: access.domainName,
      viaSupportSession: auth.supportSessionId ?? null,
    });

    return {
      domain: { id: access.domainId, name: access.domainName },
      window: { from: from.toISOString(), to: to.toISOString() },
      summary,
      events: events.events.map((row) => toEventView(row, { mask })),
      total: events.total,
    };
  });

  /**
   * Domain mail diagnostics: SPF, DKIM, DMARC, MX, PTR and (opt-in) the SMTP banner.
   *
   * Scoped by `resolveDomainAccess`, so a customer can only diagnose a domain they own and an
   * unknown/foreign domain is a 404. The checks themselves are the Tools Center's own functions —
   * this endpoint adds ownership and one consistent vocabulary, not a second DNS implementation.
   */
  app.get('/api/v1/email-trace/domains/:domainId/diagnostics', async (request) => {
    const auth = await authenticate(request, env, pool);
    const params = parseOrThrow(z.object({ domainId: idSchema }), request.params);
    const query = parseOrThrow(
      z.object({
        banner: z.enum(['true', 'false']).optional(),
        selectors: z.string().max(200).optional(),
      }),
      request.query
    );
    const access = await resolveDomainAccess(pool, auth, params.domainId);
    if (!access) throw new NotFoundError('Domain not found');

    const selectors = query.selectors
      ? query.selectors
          .split(',')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 10)
      : DEFAULT_DKIM_SELECTORS;

    const diagnostics = await diagnoseDomain(
      {
        domain: access.domainName,
        dkimSelectors: selectors,
        includeSmtpBanner: query.banner === 'true',
        // Bound every check so this endpoint always answers, even when a resolver is hanging.
        perCheckTimeoutMs: EMPTY_TRACE_CHECK_TIMEOUT_MS,
      },
      defaultDiagnosticRunners(pool)
    );

    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.domain_view', {
      domainId: access.domainId,
      domain: access.domainName,
      view: 'diagnostics',
      banner: query.banner === 'true',
      viaSupportSession: auth.supportSessionId ?? null,
    });

    return diagnostics;
  });

  app.get('/api/v1/email-trace/:traceId/timeline', async (request) => {
    const auth = await authenticate(request, env, pool);
    const params = parseOrThrow(z.object({ traceId: z.string().min(1).max(128) }), request.params);
    const timeline = await buildTimeline(pool, params.traceId, scopeForOwnMail(auth), { mask });
    if (!timeline) throw new NotFoundError('Trace not found');

    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.timeline_view', {
      traceId: params.traceId,
      eventCount: timeline.events.length,
      viaSupportSession: auth.supportSessionId ?? null,
    });
    return timeline;
  });

  app.get('/api/v1/email-trace/:traceId', async (request) => {
    const auth = await authenticate(request, env, pool);
    const params = parseOrThrow(z.object({ traceId: z.string().min(1).max(128) }), request.params);
    const timeline = await buildTimeline(pool, params.traceId, scopeForOwnMail(auth), { mask });
    if (!timeline) throw new NotFoundError('Trace not found');

    await auditEmailTraceRead(pool, request, auth.userId, 'email_trace.detail_view', {
      traceId: params.traceId,
      viaSupportSession: auth.supportSessionId ?? null,
    });

    return {
      traceId: timeline.traceId,
      latestStatus: timeline.latestStatus,
      statusDetail: describeStatus(timeline.latestStatus),
      sender: timeline.sender,
      recipient: timeline.recipient,
      firstSeenAt: timeline.firstSeenAt,
      lastSeenAt: timeline.lastSeenAt,
      eventCount: timeline.events.length,
      events: timeline.events,
      evidenceNote: timeline.evidenceNote,
    };
  });
}
