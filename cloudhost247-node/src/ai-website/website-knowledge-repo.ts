import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import type { WebsiteSourceKind } from './types';

/**
 * Persistence for the website knowledge base.
 *
 * This module owns the SQL against `ai_knowledge_sources` / `ai_knowledge_chunks` (0066 + 0096).
 * It never re-implements the AI Control Plane's own repository — that one manages manually authored
 * knowledge; this one manages the *derived* website projection and is the only writer for rows with
 * a non-null `source_key`.
 *
 * Consistency rule: a chunk belongs to exactly one source, and a reindex replaces a source's chunks
 * inside one transaction-free two-statement sequence (delete then insert) guarded by the caller's
 * digest check. If the insert fails, the source row is marked `failed` and its chunks are gone —
 * deliberately fail-closed: a half-written knowledge base is worse than an honest gap.
 */

export interface SourceRow {
  id: string;
  title: string;
  source_type: string;
  source_kind: string | null;
  source_key: string | null;
  surface: string | null;
  url: string | null;
  aliases: unknown;
  section: string | null;
  category: string | null;
  version: string;
  status: string;
  fingerprint: string | null;
  sync_status: string;
  sync_note: string | null;
  failure_count: number;
  last_error_at: string | null;
  last_synced_at: string | null;
  excluded: boolean;
  excluded_reason: string | null;
  chunk_count: number;
  word_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChunkRow {
  id: string;
  source_id: string;
  chunk_index: number;
  title: string | null;
  content: string;
  keywords: string[];
  url: string | null;
  page_title: string | null;
  section: string | null;
  category: string | null;
  source_kind: string | null;
  rank?: number | string;
}

export interface UpsertSourceInput {
  sourceKey: string;
  title: string;
  kind: WebsiteSourceKind;
  surface: string;
  url: string;
  aliases: string[];
  section: string;
  category: string | null;
  fingerprint: string;
  wordCount: number;
}

export async function findSourceByKey(db: Queryable, sourceKey: string): Promise<SourceRow | null> {
  const { rows } = await db.query<SourceRow>('SELECT * FROM ai_knowledge_sources WHERE source_key = $1 LIMIT 1', [sourceKey]);
  return rows[0] ?? null;
}

/**
 * Creates or updates the source row and reports whether an update actually changed anything.
 *
 * The comparison is the point of the whole sync: an unchanged fingerprint means "do nothing", which
 * is what keeps a five-minute reconcile sweep from rewriting a thousand chunks every cycle.
 */
export async function upsertSource(
  db: Queryable,
  input: UpsertSourceInput
): Promise<{ id: string; created: boolean; changed: boolean }> {
  const existing = await findSourceByKey(db, input.sourceKey);
  if (!existing) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO ai_knowledge_sources
         (id, title, source_type, source_kind, source_key, surface, url, aliases, section, category,
          fingerprint, sync_status, word_count, version)
       VALUES ($1,$2,'doc',$3,$4,$5,$6,$7::jsonb,$8,$9,$10,'pending',$11,'1')
       RETURNING id`,
      [
        randomUUID(),
        input.title.slice(0, 255),
        input.kind,
        input.sourceKey,
        input.surface,
        input.url,
        JSON.stringify(input.aliases),
        (input.section ?? '').slice(0, 80) || null,
        (input.category ?? '').slice(0, 80) || null,
        input.fingerprint,
        input.wordCount,
      ]
    );
    return { id: rows[0]!.id, created: true, changed: true };
  }

  const changed =
    existing.fingerprint !== input.fingerprint ||
    existing.title !== input.title.slice(0, 255) ||
    existing.url !== input.url ||
    existing.source_kind !== input.kind ||
    existing.sync_status !== 'indexed';

  await db.query(
    `UPDATE ai_knowledge_sources
        SET title = $2, source_kind = $3, surface = $4, url = $5, aliases = $6::jsonb,
            section = $7, category = $8, fingerprint = $9, word_count = $10,
            source_type = 'doc', updated_at = now()
      WHERE id = $1`,
    [
      existing.id,
      input.title.slice(0, 255),
      input.kind,
      input.surface,
      input.url,
      JSON.stringify(input.aliases),
      (input.section ?? '').slice(0, 80) || null,
      (input.category ?? '').slice(0, 80) || null,
      input.fingerprint,
      input.wordCount,
    ]
  );
  return { id: existing.id, created: false, changed };
}

/** Replaces every chunk of one source. Called only when the fingerprint changed. */
export async function replaceChunks(
  db: Queryable,
  sourceId: string,
  chunks: Array<{ index: number; title: string; content: string; keywords: string[]; section: string }>,
  meta: { url: string; pageTitle: string; kind: string; category: string; fingerprint: string }
): Promise<number> {
  await db.query('DELETE FROM ai_knowledge_chunks WHERE source_id = $1', [sourceId]);
  let inserted = 0;
  for (const chunk of chunks) {
    await db.query(
      `INSERT INTO ai_knowledge_chunks
         (id, source_id, chunk_index, title, content, keywords, url, page_title, section, category, source_kind, fingerprint)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8,$9,$10,$11,$12)`,
      [
        randomUUID(),
        sourceId,
        chunk.index,
        chunk.title.slice(0, 255),
        chunk.content.slice(0, 19_000),
        chunk.keywords.slice(0, 24),
        meta.url,
        meta.pageTitle.slice(0, 255),
        chunk.section.slice(0, 120) || null,
        meta.category.slice(0, 80) || null,
        meta.kind,
        meta.fingerprint,
      ]
    );
    inserted += 1;
  }
  await db.query('UPDATE ai_knowledge_sources SET chunk_count = $2, updated_at = now() WHERE id = $1', [sourceId, inserted]);
  return inserted;
}

export async function markSourceIndexed(db: Queryable, sourceId: string): Promise<void> {
  await db.query(
    `UPDATE ai_knowledge_sources
        SET sync_status = 'indexed', sync_note = NULL, failure_count = 0, last_error_at = NULL,
            last_synced_at = now(), updated_at = now()
      WHERE id = $1`,
    [sourceId]
  );
}

export async function markSourceSkipped(db: Queryable, sourceId: string, note: string): Promise<void> {
  await db.query(
    `UPDATE ai_knowledge_sources
        SET sync_status = 'skipped', sync_note = $2, chunk_count = 0,
            last_synced_at = now(), updated_at = now()
      WHERE id = $1`,
    [sourceId, note.slice(0, 500)]
  );
  await db.query('DELETE FROM ai_knowledge_chunks WHERE source_id = $1', [sourceId]);
}

export async function markSourceExcluded(db: Queryable, sourceId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE ai_knowledge_sources
        SET sync_status = 'excluded', excluded = true, excluded_reason = $2, sync_note = $2,
            chunk_count = 0, last_synced_at = now(), updated_at = now()
      WHERE id = $1`,
    [sourceId, reason.slice(0, 300)]
  );
  await db.query('DELETE FROM ai_knowledge_chunks WHERE source_id = $1', [sourceId]);
}

export async function markSourceFailed(db: Queryable, sourceId: string, message: string): Promise<void> {
  await db.query(
    `UPDATE ai_knowledge_sources
        SET sync_status = 'failed', sync_note = $2, failure_count = failure_count + 1,
            last_error_at = now(), updated_at = now()
      WHERE id = $1`,
    [sourceId, message.slice(0, 500)]
  );
}

/**
 * Removes sources whose page no longer exists. Only rows this subsystem owns (non-null
 * `source_key`) are eligible — manually authored Control Plane knowledge is never deleted by a
 * website sync.
 */
export async function deleteSourcesNotIn(db: Queryable, keepKeys: readonly string[]): Promise<number> {
  if (keepKeys.length === 0) return 0;
  const { rows } = await db.query<{ id: string; source_key: string }>(
    `DELETE FROM ai_knowledge_sources
      WHERE source_key IS NOT NULL
        AND NOT (source_key = ANY($1::text[]))
      RETURNING id, source_key`,
    [keepKeys]
  );
  return rows.length;
}

/** Sources with a non-null key, for the reconciling sweep's diff. */
export async function listWebsiteSources(db: Queryable, limit = 5000): Promise<Array<Pick<SourceRow, 'id' | 'source_key' | 'fingerprint' | 'sync_status' | 'url' | 'title' | 'source_kind'>>> {
  const { rows } = await db.query<Pick<SourceRow, 'id' | 'source_key' | 'fingerprint' | 'sync_status' | 'url' | 'title' | 'source_kind'>>(
    `SELECT id, source_key, fingerprint, sync_status, url, title, source_kind
       FROM ai_knowledge_sources
      WHERE source_key IS NOT NULL
      ORDER BY source_key ASC
      LIMIT $1`,
    [Math.min(Math.max(limit, 1), 20_000)]
  );
  return rows;
}

export interface RetrievalRow extends ChunkRow {
  source_url: string;
  source_title: string;
  source_kind: string;
}

/**
 * The lexical leg of retrieval.
 *
 * `to_tsquery` is used (not `websearch_to_tsquery`) because the caller supplies an already-normalised
 * OR-query with prefix markers. The query text is built only from sanitised, tokenised input — see
 * `toTsQueryBody()` — never from raw customer text, so no tsquery syntax can be injected.
 *
 * Ordering is by ts_rank over the weighted vector (page title > section > body), which is what makes
 * "vps" rank the VPS page above a passing mention of "VPS" inside a comparison article.
 */
export async function searchChunks(
  db: Queryable,
  input: { tsQuery: string; keywords: string[]; limit?: number; kinds?: string[] }
): Promise<RetrievalRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 40, 1), 200);
  const kinds = input.kinds && input.kinds.length > 0 ? input.kinds : null;
  const params: unknown[] = [];
  const where: string[] = [];

  if (input.tsQuery) {
    params.push(input.tsQuery);
    where.push(`c.search_vector @@ to_tsquery('english', $${params.length})`);
  }
  if (input.keywords.length > 0) {
    params.push(input.keywords.slice(0, 20));
    where.push(`c.keywords && $${params.length}::text[]`);
  }
  if (kinds) {
    params.push(kinds);
    where.push(`s.source_kind = ANY($${params.length}::text[])`);
  }
  params.push(limit);

  const rankExpression = input.tsQuery
    ? `ts_rank(c.search_vector, to_tsquery('english', $1))`
    : '0';

  const { rows } = await db.query<RetrievalRow>(
    `SELECT c.id, c.source_id, c.chunk_index, c.title, c.content, c.keywords, c.url, c.page_title,
            c.section, c.category, c.source_kind,
            s.url AS source_url, s.title AS source_title, coalesce(s.source_kind, 'website_page') AS source_kind,
            ${rankExpression} AS rank
       FROM ai_knowledge_chunks c
       JOIN ai_knowledge_sources s ON s.id = c.source_id
      WHERE s.status = 'active'
        AND s.excluded = false
        AND s.sync_status = 'indexed'
        AND (${where.join(' OR ')})
      ORDER BY rank DESC, c.chunk_index ASC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

/** Exact-ish product/page lookup that does not depend on the FTS dictionary. */
export async function findChunksByTitle(db: Queryable, term: string, limit = 10): Promise<RetrievalRow[]> {
  const { rows } = await db.query<RetrievalRow>(
    `SELECT c.id, c.source_id, c.chunk_index, c.title, c.content, c.keywords, c.url, c.page_title,
            c.section, c.category, c.source_kind,
            s.url AS source_url, s.title AS source_title, coalesce(s.source_kind, 'website_page') AS source_kind,
            1::real AS rank
       FROM ai_knowledge_chunks c
       JOIN ai_knowledge_sources s ON s.id = c.source_id
      WHERE s.status = 'active' AND s.excluded = false AND s.sync_status = 'indexed'
        AND (lower(c.page_title) = lower($1) OR lower(s.title) = lower($1) OR lower(c.page_title) LIKE lower($2))
      ORDER BY c.chunk_index ASC
      LIMIT $3`,
    [term, `%${term}%`, Math.min(Math.max(limit, 1), 50)]
  );
  return rows;
}

/** Whole-source fetch, for "explain <page>" answers and for related-content expansion. */
export async function chunksForSource(db: Queryable, sourceId: string, limit = 12): Promise<RetrievalRow[]> {
  const { rows } = await db.query<RetrievalRow>(
    `SELECT c.id, c.source_id, c.chunk_index, c.title, c.content, c.keywords, c.url, c.page_title,
            c.section, c.category, c.source_kind,
            s.url AS source_url, s.title AS source_title, coalesce(s.source_kind, 'website_page') AS source_kind,
            0::real AS rank
       FROM ai_knowledge_chunks c
       JOIN ai_knowledge_sources s ON s.id = c.source_id
      WHERE c.source_id = $1
      ORDER BY c.chunk_index ASC
      LIMIT $2`,
    [sourceId, Math.min(Math.max(limit, 1), 60)]
  );
  return rows;
}

export async function findSourceByUrl(db: Queryable, url: string): Promise<SourceRow | null> {
  const { rows } = await db.query<SourceRow>(
    `SELECT * FROM ai_knowledge_sources
      WHERE url = $1 AND source_key IS NOT NULL AND sync_status = 'indexed'
      ORDER BY (source_kind = 'website_page') DESC, (source_kind = 'faq') ASC
      LIMIT 1`,
    [url]
  );
  return rows[0] ?? null;
}

/** Counts used by the administrator knowledge console. */
export async function knowledgeOverview(db: Queryable): Promise<{
  totals: Record<string, number>;
  byKind: Array<{ source_kind: string; total: number; indexed: number; failed: number; skipped: number }>;
  lastRun: Record<string, unknown> | null;
  failed: number;
  stale: number;
  chunks: number;
}> {
  const totals: Record<string, number> = {};
  const rows = await db.query<{ sync_status: string; count: string }>(
    `SELECT sync_status, count(*)::text AS count FROM ai_knowledge_sources WHERE source_key IS NOT NULL GROUP BY sync_status`
  );
  for (const row of rows.rows) totals[row.sync_status] = Number(row.count);
  const all = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM ai_knowledge_sources WHERE source_key IS NOT NULL');
  totals.discovered = Number(all.rows[0]?.count ?? 0);
  const chunkCount = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM ai_knowledge_chunks');
  const byKind = await db.query<{ source_kind: string; total: string; indexed: string; failed: string; skipped: string }>(
    `SELECT coalesce(source_kind, 'manual') AS source_kind,
            count(*)::text AS total,
            count(*) FILTER (WHERE sync_status = 'indexed')::text AS indexed,
            count(*) FILTER (WHERE sync_status = 'failed')::text AS failed,
            count(*) FILTER (WHERE sync_status IN ('skipped', 'excluded'))::text AS skipped
       FROM ai_knowledge_sources
      WHERE source_key IS NOT NULL
      GROUP BY coalesce(source_kind, 'manual')
      ORDER BY count(*) DESC`
  );
  const lastRun = await db.query<Record<string, unknown>>('SELECT * FROM ai_knowledge_sync_runs ORDER BY started_at DESC LIMIT 1');
  const stale = await db.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM ai_knowledge_sources
      WHERE source_key IS NOT NULL AND sync_status = 'indexed'
        AND (last_synced_at IS NULL OR last_synced_at < now() - interval '7 days')`
  );
  return {
    totals,
    byKind: byKind.rows.map((row) => ({
      source_kind: row.source_kind,
      total: Number(row.total),
      indexed: Number(row.indexed),
      failed: Number(row.failed),
      skipped: Number(row.skipped),
    })),
    lastRun: lastRun.rows[0] ?? null,
    failed: totals.failed ?? 0,
    stale: Number(stale.rows[0]?.count ?? 0),
    chunks: Number(chunkCount.rows[0]?.count ?? 0),
  };
}

/** Full-text search over indexed content, for the administrator console. */
export async function searchIndexedContent(
  db: Queryable,
  query: string,
  limit = 30
): Promise<Array<{ source_id: string; source_key: string | null; title: string; url: string | null; kind: string | null; section: string | null; chunk_count: number; rank: number }>> {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((term) => term.length >= 2)
    .slice(0, 8);
  const tsQuery = terms.map((term) => `${term}:*`).join(' & ');
  if (!tsQuery) return [];
  const { rows } = await db.query<{ source_id: string; source_key: string | null; title: string; url: string | null; kind: string | null; section: string | null; chunk_count: number; rank: number }>(
    `SELECT DISTINCT ON (s.id)
            s.id AS source_id, s.source_key, s.title, s.url, s.source_kind AS kind, s.section,
            s.chunk_count, max(ts_rank(c.search_vector, to_tsquery('english', $1))) AS rank
       FROM ai_knowledge_chunks c
       JOIN ai_knowledge_sources s ON s.id = c.source_id
      WHERE s.sync_status = 'indexed'
        AND c.search_vector @@ to_tsquery('english', $1)
      GROUP BY s.id, s.source_key, s.title, s.url, s.source_kind, s.section, s.chunk_count
      ORDER BY s.id, rank DESC
      LIMIT $2`,
    [tsQuery, Math.min(Math.max(limit, 1), 200)]
  );
  return rows.map((row) => ({ ...row, rank: Number(row.rank) })).sort((a, b) => b.rank - a.rank);
}
