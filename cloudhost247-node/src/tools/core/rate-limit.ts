/**
 * Tools Center — per-IP, per-user, per-account and per-tool rate limiting plus abuse escalation
 * (spec §68, §70).
 *
 * @fastify/rate-limit already protects the whole HTTP surface with a coarse global budget. That is
 * not enough for this platform, because the expensive operations here have very different costs:
 * a JSON validation costs nothing, a crawl of 25 pages or a traceroute costs real outbound
 * traffic. So each tool declares a profile, and the counters live in the database
 * (`tool_rate_limits`) so they survive process restarts and hold across Passenger workers.
 *
 * Escalation: repeated rejections from an address inside the abuse window mark it temporarily
 * blocked from diagnostic tools. The block is recorded in `tool_abuse_events` (auditable) and shown
 * to the operator on the admin dashboard.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { getSetting } from '../../db/ops-tables';
import { ToolError } from './errors';
import type { RateLimitProfile } from '../catalog';

export interface RateLimitProfileDefinition {
  /** Requests allowed per window for one source address. */
  ip: number;
  /** Requests allowed per window for one signed-in user. */
  user: number;
  /** Requests allowed per window for one account (all of its users). */
  account: number;
  /** Requests allowed per window for the tool across the whole platform. */
  tool: number;
  windowSeconds: number;
  description: string;
}

export const RATE_LIMIT_PROFILES: Record<RateLimitProfile, RateLimitProfileDefinition> = {
  light: {
    ip: 90,
    user: 180,
    account: 240,
    tool: 3000,
    windowSeconds: 60,
    description: 'Cheap, purely computational tools (parsers, converters, counters).',
  },
  standard: {
    ip: 30,
    user: 60,
    account: 90,
    tool: 1500,
    windowSeconds: 60,
    description: 'Tools that make a small number of DNS or registry queries.',
  },
  heavy: {
    ip: 12,
    user: 24,
    account: 36,
    tool: 600,
    windowSeconds: 60,
    description: 'Tools that fan out to many resolvers or make multiple outbound requests.',
  },
  restricted: {
    ip: 5,
    user: 10,
    account: 15,
    tool: 200,
    windowSeconds: 60,
    description: 'Outbound network operations with abuse potential (ping, ports, crawling, fetching, SMTP).',
  },
};

export interface RateLimitSubject {
  toolSlug: string;
  profile: RateLimitProfile;
  ip: string | null;
  userId: string | null;
  accountId: string | null;
  /** Absolute per-tool override set by an administrator. */
  toolLimitOverride?: number | null;
  windowSecondsOverride?: number | null;
}

export interface RateLimitDecision {
  allowed: boolean;
  scope?: 'ip' | 'user' | 'account' | 'tool';
  limit?: number;
  used?: number;
  retryAfterSeconds?: number;
  profile: RateLimitProfileDefinition;
}

interface CounterRow {
  counter: string;
}

function windowStart(windowSeconds: number, now = Date.now()): Date {
  const bucket = Math.floor(now / 1000 / windowSeconds) * windowSeconds;
  return new Date(bucket * 1000);
}

/**
 * Atomically increments one counter and returns the post-increment value. The UPSERT is the
 * serialization point: two concurrent requests cannot both read "limit - 1".
 */
async function bumpCounter(
  db: Queryable,
  scope: 'ip' | 'user' | 'account' | 'tool',
  scopeId: string,
  toolSlug: string,
  start: Date
): Promise<number> {
  const { rows } = await db.query<CounterRow>(
    `INSERT INTO tool_rate_limits (scope, scope_id, tool_slug, window_start, counter)
     VALUES ($1,$2,$3,$4,1)
     ON CONFLICT (scope, scope_id, tool_slug, window_start)
     DO UPDATE SET counter = tool_rate_limits.counter + 1, updated_at = now()
     RETURNING counter::text AS counter`,
    [scope, scopeId, toolSlug, start.toISOString()]
  );
  return Number.parseInt(rows[0]?.counter ?? '0', 10);
}

export interface AbuseBlockState {
  blocked: boolean;
  events: number;
  threshold: number;
  /** When the block expires, if it is active. */
  until: string | null;
}

/**
 * Reads the caller's abuse state. A block is active when the number of recorded abuse events in the
 * block window reaches the configured threshold; the window slides, so a caller naturally recovers.
 */
export async function abuseBlockState(db: Queryable, ip: string | null, userId: string | null): Promise<AbuseBlockState> {
  const threshold = await getSetting<number>(db, 'tools.abuse_block_threshold', 25);
  const blockMinutes = await getSetting<number>(db, 'tools.abuse_block_minutes', 60);
  if (threshold <= 0) return { blocked: false, events: 0, threshold, until: null };
  if (!ip && !userId) return { blocked: false, events: 0, threshold, until: null };

  const { rows } = await db.query<{ events: string; oldest: string | null }>(
    `SELECT count(*)::text AS events, min(created_at)::text AS oldest
       FROM tool_abuse_events
      WHERE (ip_address = $1 OR ($2::uuid IS NOT NULL AND user_id = $2::uuid))
        AND created_at > now() - ($3::int * interval '1 minute')`,
    [ip, userId, blockMinutes]
  );
  const events = Number.parseInt(rows[0]?.events ?? '0', 10);
  const oldest = rows[0]?.oldest ?? null;
  if (events < threshold || !oldest) return { blocked: false, events, threshold, until: null };
  const until = new Date(new Date(oldest).getTime() + blockMinutes * 60_000).toISOString();
  return { blocked: true, events, threshold, until };
}

export async function recordAbuseEvent(
  db: Queryable,
  input: { toolSlug: string; kind: string; ip: string | null; userId: string | null; detail: string }
): Promise<void> {
  await db.query(
    `INSERT INTO tool_abuse_events (id, user_id, ip_address, tool_slug, kind, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), input.userId, input.ip, input.toolSlug, input.kind, input.detail.slice(0, 500)]
  );
}

/**
 * Enforces every applicable counter for one tool invocation.
 *
 * Returns a decision instead of throwing so the executor can log the rejection and record the
 * abuse event before turning it into the standard RATE_LIMITED error envelope.
 */
export async function checkRateLimits(db: Queryable, subject: RateLimitSubject): Promise<RateLimitDecision> {
  const profile = RATE_LIMIT_PROFILES[subject.profile] ?? RATE_LIMIT_PROFILES.standard;
  const windowSeconds = Math.min(Math.max(subject.windowSecondsOverride ?? profile.windowSeconds, 5), 3600);
  const toolLimit = Math.min(subject.toolLimitOverride ?? profile.tool, profile.tool);
  const start = windowStart(windowSeconds);

  const checks: Array<{ scope: 'ip' | 'user' | 'account' | 'tool'; id: string; limit: number }> = [];
  if (subject.ip) checks.push({ scope: 'ip', id: subject.ip, limit: profile.ip });
  if (subject.userId) checks.push({ scope: 'user', id: subject.userId, limit: profile.user });
  if (subject.accountId) checks.push({ scope: 'account', id: subject.accountId, limit: profile.account });
  checks.push({ scope: 'tool', id: 'global', limit: toolLimit });

  let mostConstrained: RateLimitDecision = { allowed: true, profile };

  for (const check of checks) {
    const used = await bumpCounter(db, check.scope, check.id, subject.toolSlug, start);
    if (used > check.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((start.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
      return { allowed: false, scope: check.scope, limit: check.limit, used, retryAfterSeconds, profile };
    }
    // Keep the tightest remaining budget for the response header.
    const remaining = check.limit - used;
    if (mostConstrained.limit === undefined || remaining < (mostConstrained.limit - (mostConstrained.used ?? 0))) {
      mostConstrained = { allowed: true, scope: check.scope, limit: check.limit, used, retryAfterSeconds: windowSeconds, profile };
    }
  }

  return mostConstrained;
}

export function rateLimitedError(decision: RateLimitDecision, toolSlug: string): ToolError {
  const scopeLabel =
    decision.scope === 'ip'
      ? 'your connection'
      : decision.scope === 'user'
        ? 'your account'
        : decision.scope === 'account'
          ? 'your organisation'
          : 'this tool platform-wide';
  return new ToolError(
    'RATE_LIMITED',
    `Rate limit reached for ${scopeLabel} on "${toolSlug}" (${decision.used}/${decision.limit} per window). Try again in ${decision.retryAfterSeconds ?? 60} seconds.`,
    {
      scope: decision.scope,
      limit: decision.limit,
      used: decision.used,
      retryAfterSeconds: decision.retryAfterSeconds ?? 60,
    }
  );
}

export interface AbuseSummary {
  windowMinutes: number;
  limitEvents: number;
  blockedEvents: number;
  blockedAddresses: number;
  topTools: Array<{ toolSlug: string; events: number }>;
}

/** Admin dashboard aggregate (spec §82 "rate-limit events" / "abuse events"). */
export async function abuseSummary(db: Queryable, windowMinutes = 1440): Promise<AbuseSummary> {
  const { rows } = await db.query<{ kind: string; events: string }>(
    `SELECT kind, count(*)::text AS events FROM tool_abuse_events WHERE created_at > now() - ($1::int * interval '1 minute') GROUP BY kind`,
    [Math.min(Math.max(windowMinutes, 5), 43_200)]
  );
  const { rows: toolRows } = await db.query<{ tool_slug: string; events: string }>(
    `SELECT tool_slug, count(*)::text AS events FROM tool_abuse_events WHERE created_at > now() - ($1::int * interval '1 minute') GROUP BY tool_slug ORDER BY count(*) DESC LIMIT 10`,
    [Math.min(Math.max(windowMinutes, 5), 43_200)]
  );
  const { rows: addressRows } = await db.query<{ addresses: string }>(
    `SELECT count(DISTINCT ip_address)::text AS addresses FROM tool_abuse_events WHERE created_at > now() - ($1::int * interval '1 minute') AND kind IN ('RATE_LIMITED','ABUSE_BLOCKED')`,
    [Math.min(Math.max(windowMinutes, 5), 43_200)]
  );
  const byKind = new Map(rows.map((row) => [row.kind, Number.parseInt(row.events, 10)]));
  return {
    windowMinutes,
    limitEvents: byKind.get('RATE_LIMITED') ?? 0,
    blockedEvents: byKind.get('ABUSE_BLOCKED') ?? 0,
    blockedAddresses: Number.parseInt(addressRows[0]?.addresses ?? '0', 10),
    topTools: toolRows.map((row) => ({ toolSlug: row.tool_slug, events: Number.parseInt(row.events, 10) })),
  };
}
