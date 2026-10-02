/** Scoped memory + knowledge base (RAG) persistence. */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { KnowledgeChunkRow, KnowledgeSourceRow, MemoryScope } from '../types';

export interface MemoryRow {
  id: string;
  scope: MemoryScope;
  customer_id: string | null;
  agent_slug: string | null;
  memory_key: string;
  value: unknown;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

const UNSET = '00000000-0000-0000-0000-000000000000';

/** Reads one memory. Tenant isolation is structural: scope+customerId are part of the key, so
 *  a caller can only ever read the exact tenant scope it names. */
export async function getMemory(
  db: Queryable,
  scope: MemoryScope,
  customerId: string | null,
  agentSlug: string | null,
  key: string
): Promise<MemoryRow | null> {
  const { rows } = await db.query<MemoryRow>(
    `SELECT * FROM ai_memories
     WHERE scope = $1
       AND COALESCE(customer_id, '${UNSET}'::uuid) = COALESCE($2, '${UNSET}'::uuid)
       AND COALESCE(agent_slug, '') = COALESCE($3, '')
       AND memory_key = $4
       AND (expires_at IS NULL OR expires_at > now())`,
    [scope, customerId, agentSlug, key]
  );
  return rows[0] ?? null;
}

export async function putMemory(
  db: Queryable,
  input: { scope: MemoryScope; customerId?: string | null; agentSlug?: string | null; key: string; value: unknown; expiresAt?: string | null }
): Promise<void> {
  await db.query(
    `INSERT INTO ai_memories (id, scope, customer_id, agent_slug, memory_key, value, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (scope, COALESCE(customer_id, '${UNSET}'::uuid), COALESCE(agent_slug, ''), memory_key)
     DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now()`,
    [
      randomUUID(),
      input.scope,
      input.customerId ?? null,
      input.agentSlug ?? null,
      input.key,
      JSON.stringify(input.value),
      input.expiresAt ?? null,
    ]
  );
}

export async function listMemories(
  db: Queryable,
  opts: { scope?: MemoryScope; customerId?: string; limit?: number } = {}
): Promise<MemoryRow[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.scope) {
    params.push(opts.scope);
    conditions.push(`scope = $${params.length}`);
  }
  if (opts.customerId) {
    params.push(opts.customerId);
    conditions.push(`customer_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  const { rows } = await db.query<MemoryRow>(
    `SELECT * FROM ai_memories ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
    params
  );
  return rows;
}

export async function pruneExpiredMemories(db: Queryable): Promise<number> {
  const { rows } = await db.query<{ id: string }>(`DELETE FROM ai_memories WHERE expires_at IS NOT NULL AND expires_at <= now() RETURNING id`);
  return rows.length;
}

// ----------------------------------------------------------------------------------------------
// Knowledge base

export async function createKnowledgeSource(
  db: Queryable,
  input: { title: string; sourceType: string; uri?: string | null; version?: string; createdBy?: string | null }
): Promise<KnowledgeSourceRow> {
  const { rows } = await db.query<KnowledgeSourceRow>(
    `INSERT INTO ai_knowledge_sources (id, title, source_type, uri, version, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [randomUUID(), input.title, input.sourceType, input.uri ?? null, input.version ?? '1', input.createdBy ?? null]
  );
  if (!rows[0]) throw new Error('ai_knowledge_sources: insert returned no row');
  return rows[0];
}

export async function listKnowledgeSources(db: Queryable): Promise<Array<KnowledgeSourceRow & { chunk_count: string }>> {
  const { rows } = await db.query<KnowledgeSourceRow & { chunk_count: string }>(
    `SELECT s.*, (SELECT count(*)::text FROM ai_knowledge_chunks c WHERE c.source_id = s.id) AS chunk_count
     FROM ai_knowledge_sources s ORDER BY s.created_at DESC`
  );
  return rows;
}

export async function getKnowledgeSource(db: Queryable, id: string): Promise<KnowledgeSourceRow | null> {
  const { rows } = await db.query<KnowledgeSourceRow>(`SELECT * FROM ai_knowledge_sources WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function addKnowledgeChunks(
  db: Queryable,
  sourceId: string,
  chunks: Array<{ title?: string | null; content: string; keywords?: string[] }>
): Promise<number> {
  let inserted = 0;
  for (const [index, chunk] of chunks.entries()) {
    await db.query(
      `INSERT INTO ai_knowledge_chunks (id, source_id, chunk_index, title, content, keywords)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [randomUUID(), sourceId, index, chunk.title ?? null, chunk.content, chunk.keywords ?? []]
    );
    inserted += 1;
  }
  return inserted;
}

export interface KnowledgeHit {
  chunk: KnowledgeChunkRow;
  source: KnowledgeSourceRow;
  score: number;
}

/**
 * Deterministic keyword search: scores by query-term overlap with chunk keywords/title/content.
 * Only ACTIVE sources are searched. No embeddings, no invented answers — if nothing scores,
 * the caller must say "not documented" rather than improvise (spec §24).
 */
export async function searchKnowledge(db: Queryable, query: string, limit = 5): Promise<KnowledgeHit[]> {
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 12);
  if (terms.length === 0) return [];
  const { rows } = await db.query<KnowledgeChunkRow & { source_title: string; source_type: string; source_version: string; source_uri: string | null; source_id: string }>(
    `SELECT c.*, s.title AS source_title, s.source_type, s.version AS source_version, s.uri AS source_uri
     FROM ai_knowledge_chunks c
     JOIN ai_knowledge_sources s ON s.id = c.source_id AND s.status = 'active'
     ORDER BY c.created_at DESC
     LIMIT 500`
  );
  const hits: KnowledgeHit[] = [];
  for (const row of rows) {
    const haystack = `${row.title ?? ''}\n${row.content}\n${row.keywords.join(' ')}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (row.keywords.some((k) => k.toLowerCase().includes(term))) score += 3;
      if ((row.title ?? '').toLowerCase().includes(term)) score += 2;
      if (haystack.includes(term)) score += 1;
    }
    if (score > 0) {
      hits.push({
        chunk: { id: row.id, source_id: row.source_id, chunk_index: row.chunk_index, title: row.title, content: row.content, keywords: row.keywords, created_at: row.created_at },
        source: {
          id: row.source_id,
          title: row.source_title,
          source_type: row.source_type,
          uri: row.source_uri,
          version: row.source_version,
          status: 'active',
          created_by: null,
          created_at: '',
          updated_at: '',
        } as KnowledgeSourceRow,
        score,
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, Math.min(Math.max(limit, 1), 10));
}
