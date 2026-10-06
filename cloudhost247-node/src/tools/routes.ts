import { DISCOVERY_CATEGORIES, TOOLS_FOOTER } from './catalog';
/**
 * Tools Center — REST surface (`/api/tools/*`, mirrored at `/api/v1/tools/*`).
 *
 * Route layout:
 *   • Discovery    GET  /tools/catalog, /tools/dashboard
 *   • Execution    POST /tools/:slug            (GET also accepted for read-only tools)
 *                  POST /tools/:slug/explain    (run, then explain the real result)
 *                  POST /tools/:slug/report     (run, then save the result as a report)
 *                  POST /tools/:slug/ticket     (run, then open a support ticket with the result)
 *   • Speed test   GET  /tools/speed-test/{latency,download}, POST /tools/speed-test/upload
 *   • Portal       /tools/{history,favorites,reports,monitors} — the signed-in customer's own data
 *
 * Every execution goes through `runTool`, so status gates, abuse blocking, rate limits, caching,
 * execution logging and history are applied in exactly one place. Handlers catch `ToolError` and
 * render the standard error envelope themselves, because the application-wide error handler only
 * knows the generic `{error, message}` shape.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { HttpError, UnauthorizedError, NotFoundError, ValidationError } from '../lib/errors';
import { authenticate, type AuthenticatedRequestContext } from '../lib/require-auth';
import { auditRequest } from '../lib/audit';
import { createNotification } from '../services/notification-service';
import { createTicket } from '../db/support-tickets';
import { listEffectiveTools, effectiveTool, type EffectiveTool } from './core/registry';
import { runTool, resolveCaller, type ToolCaller } from './core/executor';
import { isToolError, toErrorEnvelope, ToolError, type ToolSuccessEnvelope } from './core/errors';
import { listHistory, clearHistory, listFavorites, addFavorite, removeFavorite, listReports, getReport, deleteReport, saveReport, recentlyUsed, popularTools } from './core/history';
import { CATEGORY_LABELS, NON_RUNNABLE_TOOL_SLUGS, catalogEntry } from './catalog';
import { handlerFor, targetFor, missingHandlers } from './handlers';
import { registerAdminToolsRoutes } from '../routes/admin-tools';
import { createMonitor, deleteMonitor, listMonitorEvents, listMonitors, updateMonitor, evaluateMonitor, applyMonitorEvaluation } from './diagnostics/monitors';
import { reportExport } from './diagnostics/library';
import { explainToolResult } from './core/explain';
import { speedTestCaps, speedTestConfig } from './network/speed-test';

const SPEED_TEST_MAX_UPLOAD = 8 * 1024 * 1024;
const SPEED_TEST_MAX_DOWNLOAD = 16 * 1024 * 1024;

interface ExecuteContext {
  db: Queryable;
  env: Env;
  request: FastifyRequest;
  auth: AuthenticatedRequestContext | null;
  caller: ToolCaller;
  tool: EffectiveTool;
  input: Record<string, unknown>;
}

function mergeInput(request: FastifyRequest): Record<string, unknown> {
  const query = request.query && typeof request.query === 'object' ? (request.query as Record<string, unknown>) : {};
  const body =
    request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body) ? (request.body as Record<string, unknown>) : {};
  return { ...query, ...body };
}

function stableKey(input: Record<string, unknown>): string {
  const keys = Object.keys(input)
    .filter((key) => key !== 'refresh' && key !== 'acknowledgeRecipientCheck')
    .sort();
  const normalised: Record<string, unknown> = {};
  for (const key of keys) {
    const value = input[key];
    normalised[key] = value;
  }
  return JSON.stringify(normalised);
}

/** A compact, non-sensitive summary stored with the history row and the execution log. */
function summarizeResult(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  for (const key of ['status', 'summary', 'verdict', 'count', 'counts', 'found', 'verdictStatus']) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') summary[key] = value;
    else if (value && typeof value === 'object' && key === 'verdict') {
      const verdict = value as Record<string, unknown>;
      if (typeof verdict.status === 'string') summary.verdict = verdict.status;
    }
  }
  return summary;
}

function sendToolFailure(reply: FastifyReply, error: unknown, slug: string, request?: FastifyRequest): void {
  if (!isToolError(error) && !(error instanceof HttpError) && request) {
    // An unexpected exception must never be silent: the caller gets the generic envelope, the
    // operator gets a log line with the real stack.
    request.log.error({ err: error, tool: slug }, 'tool execution failed unexpectedly');
  }
  if (isToolError(error)) {
    reply.code(error.statusCode).send(toErrorEnvelope(error, slug));
    return;
  }
  if (error instanceof HttpError) {
    reply.code(error.statusCode).send({ success: false, code: error.code, message: error.message, retryable: false, tool: slug });
    return;
  }
  reply.code(500).send(toErrorEnvelope(error, slug));
}

async function resolveToolOrThrow(db: Queryable, slug: string): Promise<EffectiveTool> {
  const tool = await effectiveTool(db, slug);
  if (!tool) throw new NotFoundError(`No tool is registered under "${slug}".`);
  return tool;
}

/**
 * Resolves the executor for a slug. Portal pages (history/favorites/reports/monitors) and unknown
 * slugs are refused *before* authentication, so a signed-out caller gets the same honest 404 as a
 * signed-in one instead of a misleading 401.
 */
function handlerForOrThrow(slug: string) {
  if (NON_RUNNABLE_TOOL_SLUGS.has(slug)) {
    throw new NotFoundError(`"${slug}" is a Tools Center page, not a diagnostic endpoint. Open it in the Tools Center instead.`);
  }
  const handler = handlerFor(slug);
  if (!handler) {
    throw new ToolError('SERVICE_UNAVAILABLE', 'This tool has no implementation in this build. Nothing was run.');
  }
  return handler;
}

/** Runs one tool through the executor with the caller's identity and the tool's cache settings. */
async function executeTool(
  http: { db: Queryable; env: Env; request: FastifyRequest },
  options: { tool: EffectiveTool; input: Record<string, unknown>; refresh?: boolean; recordHistory?: boolean }
): Promise<ToolSuccessEnvelope<unknown>> {
  const handler = handlerForOrThrow(options.tool.slug);
  const { caller, auth } = await resolveCaller(http.request, http.env, http.db, options.tool);
  const execContext: ExecuteContext = {
    db: http.db,
    env: http.env,
    request: http.request,
    auth,
    caller,
    tool: options.tool,
    input: options.input,
  };
  const refresh = options.refresh === true || ['true', '1', 'yes', 'on'].includes(String(options.input.refresh ?? '').toLowerCase());

  return runTool(
    { db: http.db, env: http.env, request: http.request, caller },
    {
      tool: options.tool,
      target: targetFor(options.tool.slug, options.input),
      cacheParts: [stableKey(options.input)],
      refresh,
      recordHistoryEntry: options.recordHistory !== false,
      summaryOf: summarizeResult,
      run: () => handler(options.input, execContext),
    }
  );
}

const monitorCreateSchema = z.object({
  kind: z.enum(['SSL_EXPIRY', 'DNS_RECORD', 'EMAIL_CONFIG']),
  target: z.string().min(1).max(300),
  recordType: z.string().max(12).optional(),
  expectedValue: z.string().max(2000).optional(),
  matchMode: z.enum(['exact', 'contains', 'regex']).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '));
  return result.data;
}

export async function registerToolsRoutes(app: FastifyInstance, env: Env, overridePool?: Queryable): Promise<void> {
  const pool = overridePool ?? getPool(env);

  // Raw upload bodies for the browser-side speed test. Scoped to this plugin, and bounded well below
  // the process memory budget; the handler still re-checks the size itself.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: SPEED_TEST_MAX_UPLOAD }, (_request, body, done) => {
    done(null, body);
  });

  const registerHandlers = (prefix: string): void => {
    // --- Discovery -----------------------------------------------------------------------------

    app.get(`${prefix}/tools/navigation`, async (_request, reply) => {
      const { tools } = await listEffectiveTools(pool);
      reply.header('Cache-Control', 'no-store');
      return { categories: DISCOVERY_CATEGORIES, footer: TOOLS_FOOTER, tools: tools.filter(tool => tool.status === 'ACTIVE' && tool.visibility === 'public' && !tool.authRequired && handlerFor(tool.slug)).map(tool => ({
        slug: tool.slug, name: tool.name, path: tool.path, category: tool.category, summary: tool.summary,
        discoveryCategories: tool.discoveryCategories, icon: tool.icon,
      })) };
    });

    app.get(`${prefix}/tools/catalog`, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { tools, masterEnabled, anonymousAccess } = await listEffectiveTools(pool);
      const categories = Object.entries(CATEGORY_LABELS).map(([slug, label]) => ({
        slug,
        label,
        toolCount: tools.filter((tool) => tool.category === slug).length,
      }));
      const categoryFilter = typeof (request.query as Record<string, unknown> | undefined)?.category === 'string' ? String((request.query as Record<string, unknown>).category) : null;
      const filtered = categoryFilter ? tools.filter((tool) => tool.category === categoryFilter) : tools;
      if (categoryFilter && !Object.keys(CATEGORY_LABELS).includes(categoryFilter)) {
        throw new ValidationError(`Unknown category "${categoryFilter}".`);
      }
      return {
        success: true,
        masterEnabled,
        anonymousAccess,
        categories,
        discoveryCategories: Object.entries(DISCOVERY_CATEGORIES).map(([slug,label]) => ({slug,label,toolCount: tools.filter(tool=>tool.discoveryCategories?.includes(slug)).length})),
        count: filtered.length,
        missingImplementations: missingHandlers(),
        tools: filtered,
      };
    });

    app.get(`${prefix}/tools/dashboard`, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const { tools, masterEnabled, anonymousAccess } = await listEffectiveTools(pool);
      const auth = request.headers.authorization ? await authenticate(request, env, pool).catch(() => null) : null;
      const categoryCounts = new Map<string, number>();
      for (const tool of tools) categoryCounts.set(tool.category, (categoryCounts.get(tool.category) ?? 0) + 1);

      const popular = await popularTools(pool, 6);
      const recent = auth ? await recentlyUsed(pool, auth.userId, 6) : [];
      const favorites = auth ? await listFavorites(pool, auth.userId) : [];
      const favoriteSet = new Set(favorites.map((favorite) => favorite.tool_slug));

      const decorate = (slug: string, extra: Record<string, unknown> = {}) => {
        const tool = tools.find((entry) => entry.slug === slug);
        if (!tool) return null;
        return { ...tool, ...extra };
      };

      return {
        success: true,
        generatedAt: new Date().toISOString(),
        masterEnabled,
        anonymousAccess,
        signedIn: Boolean(auth),
        categories: Object.entries(CATEGORY_LABELS).map(([slug, label]) => ({ slug, label, toolCount: categoryCounts.get(slug) ?? 0 })),
        popular: popular.map((entry) => decorate(entry.toolSlug, { runs: entry.runs })).filter(Boolean),
        recent: recent.map((entry) => decorate(entry.toolSlug, { lastUsedAt: entry.lastUsedAt, runs: entry.runs })).filter(Boolean),
        favorites: tools.filter((tool) => favoriteSet.has(tool.slug)).map((tool) => ({ ...tool, favorite: true })),
        statusSummary: tools.reduce<Record<string, number>>((accumulator, tool) => {
          accumulator[tool.status] = (accumulator[tool.status] ?? 0) + 1;
          return accumulator;
        }, {}),
      };
    });

    // --- Speed test (browser-side measurement) ---------------------------------------------------

    // The raw transfer APIs must not bypass operator disable/auth controls.
    const speedGate = async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const tool = await resolveToolOrThrow(pool, 'speed-test');
        if (tool.status !== 'ACTIVE') throw new ToolError('SERVICE_UNAVAILABLE', tool.statusMessage ?? 'Speed test is unavailable.');
        await resolveCaller(request, env, pool, tool);
      } catch (error) { sendToolFailure(reply, error, 'speed-test', request); return reply; }
    };
    const speedOptions = {preHandler: speedGate, config:{rateLimit:{max:10,timeWindow:'1 minute'}}};

    app.get(`${prefix}/tools/speed-test/latency`, {...speedOptions,config:{rateLimit:{max:30,timeWindow:'1 minute'}}}, async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return { success: true, serverTime: new Date().toISOString() };
    });

    app.get(`${prefix}/tools/speed-test/download`, speedOptions, async (request, reply) => {
      const query = request.query as Record<string, unknown> | undefined;
      const requested = Number(query?.bytes ?? 0);
      // The operator-set cap (tools.speed_test_max_bytes) governs real transfers; the constant is the
      // hard ceiling this process will ever emit.
      const { maxBytes } = await speedTestCaps(pool);
      const cap = Math.min(maxBytes, SPEED_TEST_MAX_DOWNLOAD);
      const bytes = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), cap) : Math.min(1024 * 1024, cap);
      // Incompressible random payload: a repeatable pattern would measure CPU/compression instead of
      // the network and would let caching flatter the number.
      const payload = randomBytes(bytes);
      reply.header('cache-control', 'no-store, no-cache, must-revalidate');
      reply.header('content-type', 'application/octet-stream');
      reply.header('content-length', String(payload.length));
      return reply.send(payload);
    });

    app.post(`${prefix}/tools/speed-test/upload`, speedOptions, async (request, reply) => {
      const started = Date.now();
      const body = request.body;
      const bytes = Buffer.isBuffer(body) ? body.length : Buffer.isBuffer((body as { payload?: unknown } | undefined)?.payload) ? ((body as { payload: Buffer }).payload.length) : 0;
      if (bytes === 0) throw new ValidationError('Send the measurement buffer as application/octet-stream (or {"payload":"<base64>"}).');
      const { maxBytes } = await speedTestCaps(pool);
      const uploadCap = Math.min(maxBytes, SPEED_TEST_MAX_UPLOAD);
      if (bytes > uploadCap) {
        throw new ValidationError(
          `Uploads for the speed test are limited to ${Math.round((uploadCap / 1024 / 1024) * 100) / 100} MB on this deployment (tools.speed_test_max_bytes).`
        );
      }
      reply.header('cache-control', 'no-store');
      return { success: true, receivedBytes: bytes, serverDurationMs: Date.now() - started };
    });

    app.get(`${prefix}/tools/speed-test/config`, speedOptions, async (request) => {
      const query = request.query as Record<string, unknown> | undefined;
      const measure = ['true', '1', 'yes', 'on'].includes(String(query?.measureServerEgress ?? '').toLowerCase());
      return { success: true, data: await speedTestConfig(pool, { measureServerEgress: measure }) };
    });

    // --- Generic execution ------------------------------------------------------------------------
    // Static /tools/* routes are registered in the same radix tree; find-my-way prefers static
    // segments, so `/tools/history` never falls into `:slug`.

    const executeHandler = async (request: FastifyRequest, reply: FastifyReply) => {
      // HTTP intermediaries must never cache visitor IPs, secrets or private results.
      // Public result caching is owned exclusively by the typed executor cache.
      reply.header('Cache-Control', 'no-store');
      const slug = (request.params as { slug?: string }).slug ?? '';
      try {
        const tool = await resolveToolOrThrow(pool, slug);
        const input = mergeInput(request);
        const envelope = await executeTool({ db: pool, env, request }, { tool, input });
        return envelope;
      } catch (error) {
        sendToolFailure(reply, error, slug, request);
        return reply;
      }
    };

    app.post(`${prefix}/tools/:slug`, executeHandler);
    app.get(`${prefix}/tools/:slug`, async (request, reply) => {
      const slug = (request.params as { slug?: string }).slug ?? '';
      const entry = catalogEntry(slug);
      try {
        if (entry && !entry.methods.includes('GET')) {
          throw new ToolError('INVALID_INPUT', `${entry.name} submits data and must be called with POST.`);
        }
        const tool = await resolveToolOrThrow(pool, slug);
        const envelope = await executeTool({ db: pool, env, request }, { tool, input: mergeInput(request) });
        return envelope;
      } catch (error) {
        sendToolFailure(reply, error, slug, request);
        return reply;
      }
    });

    app.post(`${prefix}/tools/:slug/explain`, async (request, reply) => {
      const slug = (request.params as { slug?: string }).slug ?? '';
      try {
        const tool = await resolveToolOrThrow(pool, slug);
        const input = mergeInput(request);
        const envelope = await executeTool({ db: pool, env, request }, { tool, input });
        return {
          success: true,
          tool: slug,
          generatedAt: envelope.generatedAt,
          explanation: explainToolResult(slug, envelope.data, { meta: envelope.meta }),
          data: envelope.data,
        };
      } catch (error) {
        sendToolFailure(reply, error, slug, request);
        return reply;
      }
    });

    app.post(`${prefix}/tools/:slug/report`, async (request, reply) => {
      const slug = (request.params as { slug?: string }).slug ?? '';
      try {
        const tool = await resolveToolOrThrow(pool, slug);
        const { caller } = await resolveCaller(request, env, pool, tool);
        if (!caller.userId) throw new UnauthorizedError('Sign in to save a report.');
        const input = mergeInput(request);
        const envelope = await executeTool({ db: pool, env, request }, { tool, input });
        const report = await saveReport(pool, {
          userId: caller.userId,
          toolSlug: slug,
          toolName: tool.name,
          target: targetFor(slug, input) ?? tool.name,
          status: 'SUCCESS',
          result: envelope.data,
        });
        await auditRequest(pool, request, caller.userId, {
          action: 'TOOL_REPORT_SAVED',
          resourceType: 'tool_report',
          resourceId: report.id,
          metadata: { tool: slug },
        });
        return { success: true, report, envelope };
      } catch (error) {
        sendToolFailure(reply, error, slug, request);
        return reply;
      }
    });

    app.post(`${prefix}/tools/:slug/ticket`, async (request, reply) => {
      const slug = (request.params as { slug?: string }).slug ?? '';
      try {
        const tool = await resolveToolOrThrow(pool, slug);
        const { caller } = await resolveCaller(request, env, pool, tool);
        if (!caller.userId) throw new UnauthorizedError('Sign in to open a support ticket from a tool result.');
        const input = mergeInput(request);
        const envelope = await executeTool({ db: pool, env, request }, { tool, input });
        const target = targetFor(slug, input) ?? tool.name;
        const subject = `${tool.name} result: ${target}`.slice(0, 180);
        const lines = [
          `Tool: ${tool.name} (${slug})`,
          `Target: ${target}`,
          `Run at: ${envelope.generatedAt}`,
          '',
          'What the tool reported (verbatim JSON):',
          '```json',
          JSON.stringify(envelope.data, null, 2).slice(0, 20_000),
          '```',
          '',
          'Notes from the customer:',
          typeof input.note === 'string' ? input.note.slice(0, 2000) : '(none)',
        ];
        const messageId = randomUUID();
        const ticket = await createTicket(pool, {
          id: randomUUID(),
          userId: caller.userId,
          subject,
          priority: 'normal',
          firstMessage: { id: messageId, authorId: caller.userId, authorRole: caller.role ?? 'customer', body: lines.join('\n') },
        });
        await auditRequest(pool, request, caller.userId, {
          action: 'TOOL_TICKET_CREATED',
          resourceType: 'support_ticket',
          resourceId: ticket.id,
          metadata: { tool: slug, target },
        });
        return { success: true, ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status }, envelope };
      } catch (error) {
        sendToolFailure(reply, error, slug, request);
        return reply;
      }
    });

    // --- History and favorites --------------------------------------------------------------------

    app.get(`${prefix}/tools/history`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const query = request.query as Record<string, unknown> | undefined;
      const limit = Number(query?.limit ?? 50);
      const offset = Number(query?.offset ?? 0);
      const toolSlug = typeof query?.tool === 'string' ? query.tool : undefined;
      const history = await listHistory(pool, auth.userId, {
        limit: Number.isFinite(limit) ? limit : 50,
        offset: Number.isFinite(offset) ? offset : 0,
        ...(toolSlug ? { toolSlug } : {}),
      });
      return { success: true, ...history };
    });

    app.delete(`${prefix}/tools/history`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const removed = await clearHistory(pool, auth.userId);
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_HISTORY_CLEARED', resourceType: 'tool_history', resourceId: auth.userId, metadata: { removed } });
      return { success: true, removed };
    });

    app.delete(`${prefix}/tools/history/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = (request.params as { id?: string }).id ?? '';
      const removed = await clearHistory(pool, auth.userId, id);
      if (removed === 0) throw new NotFoundError('That history entry does not exist.');
      return { success: true, removed };
    });

    app.get(`${prefix}/tools/favorites`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const favorites = await listFavorites(pool, auth.userId);
      const { tools } = await listEffectiveTools(pool);
      const slugs = new Set(favorites.map((favorite) => favorite.tool_slug));
      return { success: true, favorites: tools.filter((tool) => slugs.has(tool.slug)) };
    });

    app.post(`${prefix}/tools/favorites`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const slug = typeof body.slug === 'string' ? body.slug : '';
      if (!catalogEntry(slug)) throw new NotFoundError(`No tool is registered under "${slug}".`);
      const result = await addFavorite(pool, auth.userId, slug);
      return { success: true, ...result };
    });

    app.delete(`${prefix}/tools/favorites/:slug`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const slug = (request.params as { slug?: string }).slug ?? '';
      const removed = await removeFavorite(pool, auth.userId, slug);
      if (!removed) throw new NotFoundError('That tool is not in your favorites.');
      return { success: true, removed: true };
    });

    // --- Reports (saved diagnostic results) -------------------------------------------------------

    app.get(`${prefix}/tools/reports`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const query = request.query as Record<string, unknown> | undefined;
      const reports = await listReports(pool, auth.userId, {
        limit: Number(query?.limit ?? 50) || 50,
        offset: Number(query?.offset ?? 0) || 0,
        ...(typeof query?.tool === 'string' ? { toolSlug: query.tool } : {}),
      });
      return { success: true, ...reports };
    });

    app.post(`${prefix}/tools/reports`, async (request, reply) => {
      const body = (request.body ?? {}) as Record<string, unknown>;
      const slug = typeof body.toolSlug === 'string' ? body.toolSlug : '';
      try {
        const tool = await resolveToolOrThrow(pool, slug);
        const { caller } = await resolveCaller(request, env, pool, tool);
        if (!caller.userId) throw new UnauthorizedError('Sign in to save a report.');
        const input = body.input && typeof body.input === 'object' ? (body.input as Record<string, unknown>) : {};
        const envelope = await executeTool({ db: pool, env, request }, { tool, input });
        const report = await saveReport(pool, {
          userId: caller.userId,
          toolSlug: slug,
          toolName: tool.name,
          target: targetFor(slug, input) ?? tool.name,
          status: 'SUCCESS',
          result: envelope.data,
        });
        return { success: true, report, envelope };
      } catch (error) {
        sendToolFailure(reply, error, slug || 'reports', request);
        return reply;
      }
    });

    app.get(`${prefix}/tools/reports/:id/export`, async (request, reply) => {
      const auth = await authenticate(request, env, pool);
      const id = (request.params as { id?: string }).id ?? '';
      const query = request.query as Record<string, unknown> | undefined;
      const format = query?.format === 'csv' || query?.format === 'markdown' ? query.format : 'json';
      const report = await getReport(pool, auth.userId, id);
      if (!report) throw new NotFoundError('That report does not exist.');
      const exported = await reportExport(pool, auth.userId, id, format);
      reply.header('content-type', exported.contentType);
      reply.header('content-disposition', `attachment; filename="${exported.filename}"`);
      return reply.send(exported.body);
    });

    app.get(`${prefix}/tools/reports/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = (request.params as { id?: string }).id ?? '';
      const report = await getReport(pool, auth.userId, id);
      if (!report) throw new NotFoundError('That report does not exist.');
      return { success: true, report };
    });

    app.delete(`${prefix}/tools/reports/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = (request.params as { id?: string }).id ?? '';
      const report = await getReport(pool, auth.userId, id);
      if (!report) throw new NotFoundError('That report does not exist.');
      await deleteReport(pool, auth.userId, id);
      return { success: true, deleted: true };
    });

    // --- Monitors (SSL expiry, DNS records, e-mail configuration) ----------------------------------

    app.get(`${prefix}/tools/monitors`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const query = request.query as Record<string, unknown> | undefined;
      const monitors = await listMonitors(pool, auth.userId);
      const events = await listMonitorEvents(pool, auth.userId, typeof query?.monitorId === 'string' ? query.monitorId : undefined, Number(query?.limit ?? 50) || 50);
      return { success: true, monitors, events };
    });

    app.post(`${prefix}/tools/monitors`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const input = parseOrThrow(monitorCreateSchema, request.body ?? {});
      const monitor = await createMonitor(pool, auth.userId, {
        kind: input.kind,
        target: input.target,
        ...(input.recordType ? { recordType: input.recordType } : {}),
        ...(input.expectedValue ? { expectedValue: input.expectedValue } : {}),
        ...(input.matchMode ? { matchMode: input.matchMode } : {}),
      });
      await auditRequest(pool, request, auth.userId, { action: 'TOOL_MONITOR_CREATED', resourceType: 'tool_monitor', resourceId: monitor.id, metadata: { kind: monitor.kind, target: monitor.target } });
      return { success: true, monitor };
    });

    app.patch(`${prefix}/tools/monitors/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = (request.params as { id?: string }).id ?? '';
      const body = (request.body ?? {}) as Record<string, unknown>;
      const monitor = await updateMonitor(pool, auth.userId, id, {
        ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        ...(typeof body.expectedValue === 'string' || body.expectedValue === null ? { expectedValue: body.expectedValue as string | null } : {}),
        ...(body.matchMode === 'exact' || body.matchMode === 'contains' || body.matchMode === 'regex' ? { matchMode: body.matchMode } : {}),
      });
      if (!monitor) throw new NotFoundError('That monitor does not exist.');
      return { success: true, monitor };
    });

    app.delete(`${prefix}/tools/monitors/:id`, async (request) => {
      const auth = await authenticate(request, env, pool);
      const id = (request.params as { id?: string }).id ?? '';
      const removed = await deleteMonitor(pool, auth.userId, id);
      if (!removed) throw new NotFoundError('That monitor does not exist.');
      return { success: true, deleted: true };
    });

    app.post(`${prefix}/tools/monitors/:id/check`, async (request, reply) => {
      const id = (request.params as { id?: string }).id ?? '';
      try {
        const auth = await authenticate(request, env, pool);
        const monitors = await listMonitors(pool, auth.userId);
        const monitor = monitors.find((entry) => entry.id === id);
        if (!monitor) throw new NotFoundError('That monitor does not exist.');
        const evaluation = await evaluateMonitor(pool, monitor);
        const notification = await applyMonitorEvaluation(pool, monitor, evaluation);
        let delivered = false;
        if (notification) {
          const created = await createNotification(pool, {
            userId: notification.userId,
            type: `tool_monitor_${notification.severity}`,
            title: notification.title,
            message: notification.body,
            resourceType: 'tool_monitor',
            resourceId: notification.monitorId,
          });
          delivered = created !== null;
        }
        return { success: true, evaluation, notification: notification ? { ...notification, delivered } : null };
      } catch (error) {
        sendToolFailure(reply, error, 'tool-monitors', request);
        return reply;
      }
    });
  };

  registerHandlers('/api');
  registerHandlers('/api/v1');

  // The platform's Super Admin surface for the Tools Center lives in its own module.
  await registerAdminToolsRoutes(app, env, pool);
}
