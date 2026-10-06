/**
 * Tools Center — controlled result caching (spec §67).
 *
 * Cache entries live in `tool_cache` rather than process memory, because a cPanel Passenger
 * deployment runs several short-lived processes and an in-memory cache would give each of them a
 * different answer to the same question (and evict itself on every restart).
 *
 * Rules enforced here:
 *   - Only successful, non-personal results are cached. A handler returning `undefined`/null, or
 *     any handler that throws, caches nothing.
 *   - A caller-supplied key must be built from `cacheKey()` so the tool slug is always part of it.
 *   - Expired rows are removed opportunistically on write; there is also a worker sweep.
 *   - `force` (the UI's refresh button) skips the read but still refreshes the entry.
 */
import { createHash } from 'node:crypto';
import type { Queryable } from '../../db/types';

export function cacheKey(toolSlug: string, parts: Array<string | number | boolean | null | undefined>): string {
  return `${toolSlug}:${createHash('sha256').update(JSON.stringify(parts)).digest('hex')}`;
}

export interface CachedResult<T> {
  value: T;
  cached: boolean;
  /** When the cached value was produced (ISO), for display. */
  storedAt: string | null;
}

export async function withCache<T>(
  db: Queryable,
  options: { toolSlug: string; key: string; seconds: number; force?: boolean },
  producer: () => Promise<T | null | undefined>
): Promise<CachedResult<T>> {
  const { toolSlug, key, seconds } = options;
  if (seconds <= 0) {
    const value = await producer();
    if (value === null || value === undefined) throw new Error('withCache: producer returned no value');
    return { value, cached: false, storedAt: null };
  }

  if (!options.force) {
    const { rows } = await db.query<{ value: T; created_at: string }>(
      `SELECT value, created_at FROM tool_cache WHERE cache_key = $1 AND expires_at > now()`,
      [key]
    );
    const hit = rows[0];
    if (hit) return { value: hit.value, cached: true, storedAt: hit.created_at };
  }

  const value = await producer();
  if (value === null || value === undefined) throw new Error('withCache: producer returned no value');

  const bounded = Math.min(Math.max(Math.floor(seconds), 1), 86_400);
  await db.query(
    `INSERT INTO tool_cache (cache_key, tool_slug, value, expires_at)
     VALUES ($1,$2,$3, now() + ($4::int * interval '1 second'))
     ON CONFLICT (cache_key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [key, toolSlug, JSON.stringify(value), bounded]
  );
  // Opportunistic cleanup — cheap, indexed on expires_at, and keeps the table from growing on
  // deployments whose worker does not run.
  if (Math.random() < 0.05) {
    await db.query(`DELETE FROM tool_cache WHERE expires_at < now() - interval '1 day'`);
  }
  return { value, cached: false, storedAt: new Date().toISOString() };
}

/** Removes every cache entry for a tool (admin action after changing provider config). */
export async function invalidateToolCache(db: Queryable, toolSlug?: string): Promise<number> {
  const { rows } = toolSlug
    ? await db.query<{ count: string }>(`WITH deleted AS (DELETE FROM tool_cache WHERE tool_slug = $1 RETURNING 1) SELECT count(*)::text AS count FROM deleted`, [toolSlug])
    : await db.query<{ count: string }>(`WITH deleted AS (DELETE FROM tool_cache RETURNING 1) SELECT count(*)::text AS count FROM deleted`);
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}
