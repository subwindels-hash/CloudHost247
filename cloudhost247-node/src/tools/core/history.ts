/**
 * Tools Center — execution log, customer history, favorites and saved reports (spec §56, §57, §77).
 *
 * What is stored where:
 *   tool_execution_logs — append-only platform log: tool, caller, target label, status, duration.
 *   tool_history        — the customer-visible list; only created for signed-in users, with the
 *                         same safe target label and a tiny summary (never a full result payload).
 *   tool_reports        — explicitly saved results, already redacted by the executor.
 *
 * Nothing in this file accepts a credential-shaped field; the executor redacts before calling in,
 * and `summarize()` truncates anything unexpectedly large.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import { redact, safeTargetLabel } from './redact';

export type ExecutionStatus =
  | 'SUCCESS'
  | 'ERROR'
  | 'RATE_LIMITED'
  | 'BLOCKED'
  | 'CONFIGURATION_REQUIRED'
  | 'SERVICE_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_INPUT';

export interface ExecutionLogInput {
  toolSlug: string;
  userId: string | null;
  actorRole: string | null;
  ipAddress: string | null;
  target: string | null;
  status: ExecutionStatus;
  code: string | null;
  durationMs: number | null;
  cacheHit: boolean;
  resultSummary?: unknown;
}

export async function recordExecution(db: Queryable, input: ExecutionLogInput): Promise<string> {
  const id = randomUUID();
  await db.query(
    `INSERT INTO tool_execution_logs
       (id, tool_slug, user_id, actor_role, ip_address, target, status, code, duration_ms, cache_hit, result_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      input.toolSlug,
      input.userId,
      input.actorRole,
      input.ipAddress,
      input.target ? safeTargetLabel(input.target) : null,
      input.status,
      input.code,
      input.durationMs ?? null,
      input.cacheHit,
      JSON.stringify(redact(input.resultSummary ?? {}, { maxString: 500, maxDepth: 4 })),
    ]
  );
  return id;
}

/** Records a customer-visible history entry. Returns null for anonymous callers. */
export async function recordHistory(
  db: Queryable,
  input: { userId: string | null; toolSlug: string; target: string | null; status: ExecutionStatus; summary?: unknown }
): Promise<string | null> {
  if (!input.userId) return null;
  const id = randomUUID();
  await db.query(
    `INSERT INTO tool_history (id, user_id, tool_slug, target, status, summary) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      id,
      input.userId,
      input.toolSlug,
      input.target ? safeTargetLabel(input.target) : null,
      input.status,
      JSON.stringify(redact(input.summary ?? {}, { maxString: 500, maxDepth: 4 })),
    ]
  );
  return id;
}

export interface HistoryRow {
  id: string;
  user_id: string;
  tool_slug: string;
  target: string | null;
  status: string;
  summary: Record<string, unknown>;
  created_at: string;
}

export async function listHistory(
  db: Queryable,
  userId: string,
  options: { limit?: number; offset?: number; toolSlug?: string } = {}
): Promise<{ entries: HistoryRow[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const params: unknown[] = [userId];
  let filter = '';
  if (options.toolSlug) {
    params.push(options.toolSlug);
    filter = `AND tool_slug = $${params.length}`;
  }
  const { rows } = await db.query<HistoryRow>(
    `SELECT * FROM tool_history WHERE user_id = $1 ${filter} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM tool_history WHERE user_id = $1 ${filter}`,
    params
  );
  return { entries: rows, total: Number.parseInt(countRows[0]?.count ?? '0', 10) };
}

/** Clears one entry, or the caller's whole history. Scoped to the caller by SQL, never by the UI. */
export async function clearHistory(db: Queryable, userId: string, entryId?: string): Promise<number> {
  const { rows } = entryId
    ? await db.query<{ id: string }>(`DELETE FROM tool_history WHERE user_id = $1 AND id = $2 RETURNING id`, [userId, entryId])
    : await db.query<{ id: string }>(`DELETE FROM tool_history WHERE user_id = $1 RETURNING id`, [userId]);
  return rows.length;
}

export async function listFavorites(db: Queryable, userId: string): Promise<Array<{ id: string; tool_slug: string; created_at: string }>> {
  const { rows } = await db.query<{ id: string; tool_slug: string; created_at: string }>(
    `SELECT id, tool_slug, created_at FROM tool_favorites WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows;
}

/** Adds a favorite. Returns created=false when it already existed (idempotent for the UI). */
export async function addFavorite(db: Queryable, userId: string, toolSlug: string): Promise<{ id: string; created: boolean }> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO tool_favorites (id, user_id, tool_slug) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, tool_slug) DO NOTHING RETURNING id`,
    [randomUUID(), userId, toolSlug]
  );
  const created = rows[0];
  if (created) return { id: created.id, created: true };
  const { rows: existing } = await db.query<{ id: string }>(
    `SELECT id FROM tool_favorites WHERE user_id = $1 AND tool_slug = $2`,
    [userId, toolSlug]
  );
  return { id: existing[0]?.id ?? '', created: false };
}

export async function removeFavorite(db: Queryable, userId: string, toolSlug: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM tool_favorites WHERE user_id = $1 AND tool_slug = $2 RETURNING id`,
    [userId, toolSlug]
  );
  return rows.length > 0;
}

export interface ReportRow {
  id: string;
  user_id: string;
  tool_slug: string;
  tool_name: string;
  target: string;
  status: string;
  result: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function saveReport(
  db: Queryable,
  input: { userId: string; toolSlug: string; toolName: string; target: string; status: string; result: unknown }
): Promise<ReportRow> {
  const { rows } = await db.query<ReportRow>(
    `INSERT INTO tool_reports (id, user_id, tool_slug, tool_name, target, status, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [
      randomUUID(),
      input.userId,
      input.toolSlug,
      input.toolName,
      safeTargetLabel(input.target, 255),
      input.status,
      JSON.stringify(redact(input.result, { maxString: 20_000, maxDepth: 12 })),
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('saveReport: insert returned no row');
  return row;
}

export async function listReports(
  db: Queryable,
  userId: string,
  options: { limit?: number; offset?: number; toolSlug?: string } = {}
): Promise<{ reports: ReportRow[]; total: number }> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const params: unknown[] = [userId];
  let filter = '';
  if (options.toolSlug) {
    params.push(options.toolSlug);
    filter = `AND tool_slug = $${params.length}`;
  }
  const { rows } = await db.query<ReportRow>(
    `SELECT * FROM tool_reports WHERE user_id = $1 ${filter} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const { rows: countRows } = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM tool_reports WHERE user_id = $1 ${filter}`,
    params
  );
  return { reports: rows, total: Number.parseInt(countRows[0]?.count ?? '0', 10) };
}

export async function getReport(db: Queryable, userId: string, reportId: string): Promise<ReportRow | null> {
  const { rows } = await db.query<ReportRow>(`SELECT * FROM tool_reports WHERE user_id = $1 AND id = $2`, [userId, reportId]);
  return rows[0] ?? null;
}

export async function deleteReport(db: Queryable, userId: string, reportId: string): Promise<boolean> {
  const { rows } = await db.query<{ id: string }>(
    `DELETE FROM tool_reports WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, reportId]
  );
  return rows.length > 0;
}

/** Recently used tools for the dashboard, derived from the caller's own history (spec §3). */
export async function recentlyUsed(db: Queryable, userId: string, limit = 6): Promise<Array<{ toolSlug: string; lastUsedAt: string; runs: number }>> {
  const { rows } = await db.query<{ tool_slug: string; last_used: string; runs: string }>(
    `SELECT tool_slug, max(created_at)::text AS last_used, count(*)::text AS runs
       FROM tool_history WHERE user_id = $1
      GROUP BY tool_slug ORDER BY max(created_at) DESC LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 24)]
  );
  return rows.map((row) => ({ toolSlug: row.tool_slug, lastUsedAt: row.last_used, runs: Number.parseInt(row.runs, 10) }));
}

/**
 * Most-executed tools across the platform (spec §3 "Popular tools"). Anonymous-safe: it reads the
 * append-only log aggregate, never any caller's history rows.
 */
export async function popularTools(db: Queryable, limit = 6): Promise<Array<{ toolSlug: string; runs: number }>> {
  const { rows } = await db.query<{ tool_slug: string; runs: string }>(
    `SELECT tool_slug, count(*)::text AS runs
       FROM tool_execution_logs
      WHERE created_at > now() - interval '30 days' AND status = 'SUCCESS'
      GROUP BY tool_slug ORDER BY count(*) DESC LIMIT $1`,
    [Math.min(Math.max(limit, 1), 24)]
  );
  return rows.map((row) => ({ toolSlug: row.tool_slug, runs: Number.parseInt(row.runs, 10) }));
}
