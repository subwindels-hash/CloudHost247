/**
 * Tools Center — the single execution path every tool goes through.
 *
 * Responsibilities, in order:
 *   1. Refuse to run when the tool is not ACTIVE (spec §72) — DISABLED → ACCESS_DENIED, MAINTENANCE
 *      → SERVICE_UNAVAILABLE, CONFIGURATION_REQUIRED/SERVICE_UNAVAILABLE pass through as-is.
 *   2. Enforce the abuse block, then the per-IP/user/account/tool budgets (spec §68).
 *   3. Serve from / write to the controlled cache (spec §67) unless the caller asked to refresh.
 *   4. Run the service, measure it, and record an execution log + (for signed-in users) a history
 *      entry — on success *and* on failure, because a failing diagnostic is still a data point.
 *   5. Return the standard success envelope. Errors are thrown as ToolError and rendered by
 *      `sendToolError` in the route layer with the standard error envelope (spec §73).
 *
 * The executor never swallows a provider/capability problem into a fake success: the only way this
 * function returns `success: true` is if the service genuinely produced data.
 */
import { performance } from 'node:perf_hooks';
import type { FastifyRequest } from 'fastify';
import type { Env } from '../../config/env';
import type { Queryable } from '../../db/types';
import type { AuthenticatedRequestContext } from '../../lib/require-auth';
import { authenticate } from '../../lib/require-auth';
import { UnauthorizedError } from '../../lib/errors';
import { ToolError, type ToolSuccessEnvelope } from './errors';
import { cacheKey, withCache } from './cache';
import { abuseBlockState, checkRateLimits, rateLimitedError, recordAbuseEvent } from './rate-limit';
import { recordExecution, recordHistory, type ExecutionStatus } from './history';
import { catalogEntry } from '../catalog';
import type { EffectiveTool } from './registry';

export interface ToolCaller {
  userId: string | null;
  accountId: string | null;
  role: string | null;
  ip: string | null;
  supportSessionId: string | null;
}

export interface ToolRunContext {
  db: Queryable;
  env: Env;
  request: FastifyRequest;
  caller: ToolCaller;
}

export interface RunToolOptions<T> {
  tool: EffectiveTool;
  /** Safe target label for logs/history (hostname or IP — never a URL with a query string). */
  target: string | null;
  /** Cache key parts; when omitted the cache is skipped entirely. */
  cacheParts?: Array<string | number | boolean | null | undefined>;
  /** Bypass the cache read (the UI's refresh action). */
  refresh?: boolean;
  /** Write a customer history row on success (defaults to true for signed-in callers). */
  recordHistoryEntry?: boolean;
  /** Compact summary stored with the history entry (redacted by the history layer). */
  summaryOf?: (value: T) => unknown;
  /** Additional sources (providers/resolvers) that produced the result. */
  sources?: string[] | ((value: T) => string[]);
  warnings?: string[];
  run: (context: ToolRunContext) => Promise<T>;
}

export function callerFromAuth(auth: AuthenticatedRequestContext | null, ip: string | null): ToolCaller {
  return {
    userId: auth?.userId ?? null,
    accountId: auth?.userId ?? null,
    role: auth?.role ?? null,
    ip,
    supportSessionId: auth?.supportSessionId ?? null,
  };
}

/**
 * Authenticates when the request carries a bearer token, stays anonymous when it does not, and
 * never silently downgrades a malformed/expired token to anonymous (that would let a revoked
 * session keep using the tool).
 */
export async function optionalAuth(
  request: FastifyRequest,
  env: Env,
  pool: Queryable
): Promise<AuthenticatedRequestContext | null> {
  const header = request.headers.authorization;
  if (!header) return null;
  return authenticate(request, env, pool);
}

export async function resolveCaller(
  request: FastifyRequest,
  env: Env,
  pool: Queryable,
  tool: EffectiveTool
): Promise<{ caller: ToolCaller; auth: AuthenticatedRequestContext | null }> {
  const auth = await optionalAuth(request, env, pool);

  if (tool.authRequired && !auth) {
    throw new UnauthorizedError('Sign in to CloudHost247 to use this tool.');
  }
  if (tool.visibility === 'admin' && !auth) {
    throw new UnauthorizedError('Sign in to CloudHost247 to use this tool.');
  }
  if (tool.visibility === 'admin' && auth && !['admin', 'super_admin'].includes(auth.role ?? '')) {
    // Admin-only tooling (provider/resolver diagnostics) is never exposed to customers.
    throw new UnauthorizedError('This tool is restricted to CloudHost247 staff.');
  }

  return { caller: callerFromAuth(auth, request.ip ?? null), auth };
}

function statusToExecutionStatus(error: ToolError): ExecutionStatus {
  switch (error.code) {
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'CONFIGURATION_REQUIRED':
      return 'CONFIGURATION_REQUIRED';
    case 'SERVICE_UNAVAILABLE':
    case 'CAPABILITY_UNAVAILABLE':
    case 'PROVIDER_ERROR':
    case 'DNS_LOOKUP_FAILED':
    case 'INTERNAL_ERROR':
      return 'SERVICE_UNAVAILABLE';
    case 'TIMEOUT':
      return 'TIMEOUT';
    case 'INVALID_INPUT':
    case 'TARGET_BLOCKED':
    case 'DOMAIN_NOT_FOUND':
      return 'INVALID_INPUT';
    case 'ACCESS_DENIED':
      return 'BLOCKED';
    default:
      return 'ERROR';
  }
}

/**
 * Runs a tool. Throws ToolError for every non-success outcome; the route layer converts that into
 * the standard error envelope.
 */
export async function runTool<T>(
  context: ToolRunContext,
  options: RunToolOptions<T>
): Promise<ToolSuccessEnvelope<T>> {
  const { tool } = options;
  const startedAt = performance.now();

  if (tool.status !== 'ACTIVE') {
    const error = toolStatusError(tool);
    await logFailure(context, tool, options, error, Math.round(performance.now() - startedAt));
    throw error;
  }

  const block = await abuseBlockState(context.db, context.caller.ip, context.caller.userId);
  if (block.blocked) {
    await recordAbuseEvent(context.db, {
      toolSlug: tool.slug,
      kind: 'ABUSE_BLOCKED',
      ip: context.caller.ip,
      userId: context.caller.userId,
      detail: `Temporary block active (${block.events} events in the abuse window).`,
    });
    const error = new ToolError(
      'RATE_LIMITED',
      `This address is temporarily blocked from diagnostic tools after repeated rate-limit violations. The block lifts at ${block.until ?? 'the end of the abuse window'}.`,
      { abuseBlock: true, until: block.until }
    );
    await logFailure(context, tool, options, error, Math.round(performance.now() - startedAt));
    throw error;
  }

  const decision = await checkRateLimits(context.db, {
    toolSlug: tool.slug,
    profile: tool.rateLimitProfile,
    ip: context.caller.ip,
    userId: context.caller.userId,
    accountId: context.caller.accountId,
  });
  if (!decision.allowed) {
    await recordAbuseEvent(context.db, {
      toolSlug: tool.slug,
      kind: 'RATE_LIMITED',
      ip: context.caller.ip,
      userId: context.caller.userId,
      detail: `${decision.scope} scope exceeded ${decision.used}/${decision.limit}.`,
    });
    const error = rateLimitedError(decision, tool.slug);
    await logFailure(context, tool, options, error, Math.round(performance.now() - startedAt));
    throw error;
  }

  let result: T;
  let cached = false;
  let storedAt: string | null = null;

  try {
    if (options.cacheParts && tool.cacheSeconds > 0 && !tool.requiresOwnership && catalogEntry(tool.slug)?.cacheSeconds !== 0) {
      const outcome = await withCache(
        context.db,
        {
          toolSlug: tool.slug,
          key: cacheKey(tool.slug, [...options.cacheParts, context.caller.userId]),
          seconds: tool.cacheSeconds,
          force: options.refresh === true,
        },
        () => options.run(context)
      );
      result = outcome.value;
      cached = outcome.cached;
      storedAt = outcome.storedAt;
    } else {
      result = await options.run(context);
    }
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    if (error instanceof ToolError) {
      await logFailure(context, tool, options, error, durationMs);
      throw error;
    }
    const wrapped = new ToolError('INTERNAL_ERROR', 'This tool failed unexpectedly. The failure has been logged.');
    await logFailure(context, tool, options, wrapped, durationMs);
    throw wrapped;
  }

  const durationMs = Math.round(performance.now() - startedAt);
  const sources = typeof options.sources === 'function' ? options.sources(result) : (options.sources ?? []);
  const summary = options.summaryOf ? options.summaryOf(result) : {};

  let historyId: string | null = null;
  if (options.recordHistoryEntry !== false && context.caller.userId) {
    historyId = await recordHistory(context.db, {
      userId: context.caller.userId,
      toolSlug: tool.slug,
      target: options.target,
      status: 'SUCCESS',
      summary,
    });
  }

  if (tool.loggingEnabled) {
    await recordExecution(context.db, {
      toolSlug: tool.slug,
      userId: context.caller.userId,
      actorRole: context.caller.role,
      ipAddress: context.caller.ip,
      target: options.target,
      status: 'SUCCESS',
      code: null,
      durationMs,
      cacheHit: cached,
      resultSummary: summary,
    });
  }

  return {
    success: true,
    tool: tool.slug,
    status: 'ACTIVE',
    generatedAt: new Date().toISOString(),
    data: result,
    meta: {
      durationMs,
      cached,
      sources,
      warnings: [
        ...(options.warnings ?? []),
        ...(cached && storedAt ? [`Served from the CloudHost247 diagnostic cache (produced ${storedAt}).`] : []),
      ],
      ...(historyId ? { historyId } : {}),
    },
  };
}

function toolStatusError(tool: EffectiveTool): ToolError {
  const message = tool.statusMessage ?? 'This tool is not available.';
  switch (tool.status) {
    case 'DISABLED':
      return new ToolError('SERVICE_UNAVAILABLE', message, { toolStatus: tool.status });
    case 'MAINTENANCE':
      return new ToolError('SERVICE_UNAVAILABLE', message, { toolStatus: tool.status });
    case 'CONFIGURATION_REQUIRED':
      return new ToolError('CONFIGURATION_REQUIRED', message, { toolStatus: tool.status });
    case 'SERVICE_UNAVAILABLE':
      return new ToolError('SERVICE_UNAVAILABLE', message, { toolStatus: tool.status });
    default:
      return new ToolError('ACCESS_DENIED', message, { toolStatus: tool.status });
  }
}

async function logFailure<T>(
  context: ToolRunContext,
  tool: EffectiveTool,
  options: RunToolOptions<T>,
  error: ToolError,
  durationMs: number
): Promise<void> {
  try {
    if (!tool.loggingEnabled) return;
    await recordExecution(context.db, {
      toolSlug: tool.slug,
      userId: context.caller.userId,
      actorRole: context.caller.role,
      ipAddress: context.caller.ip,
      target: options.target,
      status: statusToExecutionStatus(error),
      code: error.code,
      durationMs,
      cacheHit: false,
      resultSummary: { message: error.message, ...error.detail },
    });
  } catch {
    // Never let a logging failure change the tool's answer: the caller already has a real error.
  }
}
