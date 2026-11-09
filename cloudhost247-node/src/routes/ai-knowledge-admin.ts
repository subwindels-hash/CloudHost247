import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { getPool } from '../db/pool';
import { requireRole } from '../lib/require-role';
import { NotFoundError, ValidationError } from '../lib/errors';
import { auditRequest } from '../lib/audit';
import { detectDrift, retryFailedSources, syncSourceKeys, syncWebsiteKnowledge, type SyncTrigger } from '../ai-website/knowledge-sync';
import { knowledgeOverview, searchIndexedContent } from '../ai-website/website-knowledge-repo';
import { modelAvailability } from '../ai-website/grounded-model';

/**
 * Admin knowledge control centre.
 *
 * Scope is deliberately narrow and consistent with the rest of the admin surface:
 *   • reads are available to `staff` (they answer these questions too);
 *   • every mutation — full reindex, targeted reindex, exclusion changes, triage of feedback — is
 *     `admin`/`super_admin` and writes an audit entry with the actor;
 *   • nothing here can *edit* published content. The index is a projection of the website; the way to
 *     change an answer is to change the page, then reindex. Reviewing a wrong answer means fixing its
 *     source, not teaching the crawler a story.
 */

const id = z.string().uuid('id must be a valid UUID');
const ROLES = ['staff', 'admin', 'super_admin'] as const;
const MUTATE = ['admin', 'super_admin'] as const;

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(result.error.issues.map((issue) => issue.message).join(', '));
  return result.data;
}

/** Counts per requirement ("pages, products, services, articles, FAQs"), plus their health. */
const CATEGORY_GROUPS: Record<string, string[]> = {
  pages: ['website_page', 'navigation', 'product', 'service'],
  products: ['product'],
  services: ['service'],
  articles: ['website_doc', 'blog_article'],
  faqs: ['faq'],
  legal: ['legal_document'],
  tools: ['website_tool'],
  announcements: ['announcement'],
};

export async function registerAiKnowledgeRoutes(app: FastifyInstance, env: Env, override?: Queryable) {
  const db = override ?? getPool(env);

  /** Dashboard: counts, health, exclusions, model availability, last runs. */
  app.get('/api/v1/admin/ai-support/knowledge/overview', async (request) => {
    await requireRole(request, env, db, [...ROLES]);
    const [overview, drift, groups, exclusions, failures, runs] = await Promise.all([
      knowledgeOverview(db),
      detectDrift(db),
      (async () => {
        const { rows } = await db.query<{ source_kind: string; total: string; indexed: string }>(
          `SELECT coalesce(source_kind,'manual') AS source_kind, count(*)::text AS total,
                  count(*) FILTER (WHERE sync_status = 'indexed')::text AS indexed
             FROM ai_knowledge_sources WHERE source_key IS NOT NULL GROUP BY 1`
        );
        const counts: Record<string, { total: number; indexed: number }> = {};
        for (const [group, kinds] of Object.entries(CATEGORY_GROUPS)) {
          counts[group] = { total: 0, indexed: 0 };
          for (const row of rows) {
            if (!kinds.includes(row.source_kind)) continue;
            counts[group]!.total += Number(row.total);
            counts[group]!.indexed += Number(row.indexed);
          }
        }
        return counts;
      })(),
      db.query(
        `SELECT pattern, reason, created_at, created_by FROM ai_knowledge_exclusions ORDER BY created_at DESC LIMIT 100`
      ),
      db.query(
        `SELECT source_key, url, title, source_kind, failure_count, sync_note, last_error_at
           FROM ai_knowledge_sources
          WHERE sync_status = 'failed' OR (failure_count > 0 AND sync_status <> 'indexed')
          ORDER BY failure_count DESC, last_error_at DESC LIMIT 50`
      ),
      db.query(
        `SELECT id, trigger, status, discovered, indexed, unchanged, skipped, excluded, removed, failed,
                duration_ms, started_at, finished_at, notes, triggered_by
           FROM ai_knowledge_sync_runs ORDER BY started_at DESC LIMIT 10`
      ),
    ]);
    const model = modelAvailability(env);
    return {
      overview,
      drift,
      groups,
      exclusions: exclusions.rows,
      failures: failures.rows,
      runs: runs.rows,
      engine: {
        // Stated explicitly so an operator never has to guess why answers are phrased a certain way.
        phrasing: model.configured ? 'retrieval+model' : 'retrieval',
        modelConfigured: model.configured,
        modelReason: model.reason,
        embedding: 'not used — lexical retrieval (tsvector) with synonym expansion and reranking',
      },
    };
  });

  /** Searchable index, so an administrator can see exactly what the assistant can and cannot find. */
  app.get('/api/v1/admin/ai-support/knowledge/search', async (request) => {
    await requireRole(request, env, db, [...ROLES]);
    const query = parse(
      z.object({ q: z.string().trim().min(2).max(200), limit: z.coerce.number().int().min(1).max(100).optional() }),
      request.query ?? {}
    );
    const results = await searchIndexedContent(db, query.q, query.limit ?? 25);
    return { query: query.q, count: results.length, results };
  });

  /** One source, with its chunks — the evidence behind an answer. */
  app.get<{ Params: { id: string } }>('/api/v1/admin/ai-support/knowledge/sources/:id', async (request) => {
    await requireRole(request, env, db, [...ROLES]);
    const sourceId = parse(id, request.params.id);
    const source = await db.query<any>('SELECT * FROM ai_knowledge_sources WHERE id = $1', [sourceId]);
    if (!source.rows[0]) throw new NotFoundError('Source not found');
    const chunks = await db.query(
      `SELECT id, chunk_index, title, section, content, keywords, created_at
         FROM ai_knowledge_chunks WHERE source_id = $1 ORDER BY chunk_index ASC LIMIT 200`,
      [sourceId]
    );
    return { source: source.rows[0], chunks: chunks.rows };
  });

  /** Every source, filterable — the inventory view. */
  app.get('/api/v1/admin/ai-support/knowledge/sources', async (request) => {
    await requireRole(request, env, db, [...ROLES]);
    const query = parse(
      z.object({
        status: z.enum(['indexed', 'skipped', 'excluded', 'failed', 'pending']).optional(),
        kind: z.string().trim().max(40).optional(),
        q: z.string().trim().max(160).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      }),
      request.query ?? {}
    );
    const params: unknown[] = [];
    const where = ['source_key IS NOT NULL'];
    if (query.status) { params.push(query.status); where.push(`sync_status = $${params.length}`); }
    if (query.kind) { params.push(query.kind); where.push(`source_kind = $${params.length}`); }
    if (query.q) {
      params.push(`%${query.q}%`);
      where.push(`(title ILIKE $${params.length} OR url ILIKE $${params.length})`);
    }
    params.push(query.limit ?? 200);
    const rows = await db.query(
      `SELECT id, source_key, url, title, source_kind, surface, section, category, sync_status,
              sync_note, failure_count, last_error_at, last_synced_at, chunk_count, word_count, fingerprint
         FROM ai_knowledge_sources
        WHERE ${where.join(' AND ')}
        ORDER BY sync_status, title
        LIMIT $${params.length}`,
      params
    );
    return { sources: rows.rows, count: rows.rows.length };
  });

  /** Full reindex. Synchronous by request: the operator gets the real counters, not a promise. */
  app.post('/api/v1/admin/ai-support/knowledge/reindex', async (request) => {
    const auth = await requireRole(request, env, db, [...MUTATE]);
    const input = parse(
      z.object({
        keys: z.array(z.string().trim().min(1).max(400)).max(500).optional(),
        trigger: z.enum(['manual', 'event']).optional(),
      }),
      request.body ?? {}
    );
    const trigger: SyncTrigger = input.trigger ?? 'manual';
    const selected = input.keys && input.keys.length > 0
      ? await syncSourceKeys(db, input.keys, { trigger, triggeredBy: auth.userId ?? null })
      : null;
    const result = selected ?? await syncWebsiteKnowledge(db, { trigger: trigger === 'event' ? 'event' : 'manual', triggeredBy: auth.userId ?? null });
    await auditRequest(db, request, auth.userId ?? null, {
      action: 'AI_KNOWLEDGE_REINDEXED',
      resourceType: 'ai_knowledge',
      resourceId: result.runId,
      metadata: {
        scope: input.keys?.length ? 'selected' : 'full',
        keys: input.keys?.slice(0, 20) ?? null,
        indexed: result.indexed,
        failed: result.failed,
        removed: result.removed,
      },
    });
    return { result };
  });

  /** Retry the failures, without a full crawl. */
  app.post('/api/v1/admin/ai-support/knowledge/retry', async (request) => {
    const auth = await requireRole(request, env, db, [...MUTATE]);
    const input = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }), request.body ?? {});
    const result = await retryFailedSources(db, input.limit ?? 25);
    await auditRequest(db, request, auth.userId ?? null, {
      action: 'AI_KNOWLEDGE_RETRIED',
      resourceType: 'ai_knowledge',
      metadata: result,
    });
    return { result };
  });

  /** Exclusions: how an operator keeps a page out of the index, permanently and visibly. */
  app.get('/api/v1/admin/ai-support/knowledge/exclusions', async (request) => {
    await requireRole(request, env, db, [...ROLES]);
    const rows = await db.query(
      `SELECT id, pattern, reason, created_by, created_at FROM ai_knowledge_exclusions ORDER BY created_at DESC LIMIT 200`
    );
    return { exclusions: rows.rows };
  });

  app.post('/api/v1/admin/ai-support/knowledge/exclusions', async (request) => {
    const auth = await requireRole(request, env, db, [...MUTATE]);
    const input = parse(
      z.object({
        pattern: z.string().trim().min(3).max(300),
        reason: z.string().trim().min(3).max(500),
      }),
      request.body ?? {}
    );
    const inserted = await db.query<any>(
      `INSERT INTO ai_knowledge_exclusions (id, pattern, reason, created_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (pattern) DO UPDATE SET reason = EXCLUDED.reason
       RETURNING id, pattern, reason, created_at`,
      [randomUUID(), input.pattern, input.reason, auth.userId ?? null]
    );
    await auditRequest(db, request, auth.userId ?? null, {
      action: 'AI_KNOWLEDGE_EXCLUSION_ADDED',
      resourceType: 'ai_knowledge_exclusion',
      resourceId: inserted.rows[0]?.id ?? null,
      metadata: { pattern: input.pattern },
    });
    return { exclusion: inserted.rows[0] };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/admin/ai-support/knowledge/exclusions/:id', async (request) => {
    const auth = await requireRole(request, env, db, [...MUTATE]);
    const exclusionId = parse(id, request.params.id);
    const deleted = await db.query<{ pattern: string }>(
      'DELETE FROM ai_knowledge_exclusions WHERE id = $1 RETURNING pattern',
      [exclusionId]
    );
    if (!deleted.rows[0]) throw new NotFoundError('Exclusion not found');
    await auditRequest(db, request, auth.userId ?? null, {
      action: 'AI_KNOWLEDGE_EXCLUSION_REMOVED',
      resourceType: 'ai_knowledge_exclusion',
      resourceId: exclusionId,
      metadata: { pattern: deleted.rows[0].pattern },
    });
    return { removed: true };
  });

  /**
   * Answer feedback and unanswered questions.
   *
   * "Unanswered" is measured, not guessed: a conversation that was escalated with
   * `AI_UNABLE_TO_ANSWER` is a question the corpus could not answer, and the customer's message is
   * the exact query to go and cover.
   */
  app.get('/api/v1/admin/ai-support/knowledge/gaps', async (request) => {
    await requireRole(request, env, db, [...ROLES]);
    const query = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }), request.query ?? {});
    const limit = query.limit ?? 50;
    const [negative, queue, unhelpful, coverage, disliked] = await Promise.all([
      db.query(
        `SELECT m.id, m.conversation_id, m.created_at,
                (SELECT body FROM ai_support_messages q
                  WHERE q.conversation_id = m.conversation_id AND q.author_type = 'CUSTOMER'
                    AND q.created_at <= m.created_at
                  ORDER BY q.created_at DESC LIMIT 1) AS question
           FROM ai_support_messages m
          WHERE m.author_type = 'AI' AND m.confidence IS NOT NULL AND m.confidence < 0.5
          ORDER BY m.created_at DESC LIMIT $1`,
        [limit]
      ),
      db.query(
        `SELECT id, question, question_key, intent, occurrences, last_asked_at, resolved, resolution_note
           FROM ai_support_unanswered_questions
          WHERE resolved = false
          ORDER BY occurrences DESC, last_asked_at DESC LIMIT $1`,
        [limit]
      ),
      db.query(
        `SELECT f.rating, f.reason, count(*)::text AS total
           FROM ai_support_feedback f GROUP BY f.rating, f.reason ORDER BY count(*) DESC`
      ),
      db.query(
        `SELECT f.id, f.message_id, f.conversation_id, f.rating, f.reason, f.comment, f.created_at,
                m.body AS answer_body, m.intent, m.evidence
           FROM ai_support_feedback f
           JOIN ai_support_messages m ON m.id = f.message_id
          WHERE f.rating = 'down'
          ORDER BY f.created_at DESC LIMIT $1`,
        [limit]
      ),
      db.query(
        `SELECT count(*)::text AS answers,
                count(*) FILTER (WHERE grounded)::text AS grounded,
                count(*) FILTER (WHERE grounded = false AND author_type = 'AI')::text AS ungrounded
           FROM ai_support_messages WHERE author_type = 'AI'`
      ),
    ]);
    return {
      lowConfidence: negative.rows,
      unanswered: queue.rows,
      feedback: unhelpful.rows,
      disliked: disliked.rows,
      coverage: coverage.rows[0] ?? { answers: 0, grounded: 0, ungrounded: 0 },
    };
  });

  /** Coverage report: which categories exist on the site and how much of each is actually indexed. */
  app.get('/api/v1/admin/ai-support/knowledge/coverage', async (request) => {
    await requireRole(request, env, db, [...ROLES]);
    const { rows } = await db.query<{ source_kind: string; surface: string | null; total: string; indexed: string; excluded: string; failed: string }>(
      `SELECT coalesce(source_kind,'unknown') AS source_kind, surface,
              count(*)::text AS total,
              count(*) FILTER (WHERE sync_status = 'indexed')::text AS indexed,
              count(*) FILTER (WHERE sync_status = 'excluded')::text AS excluded,
              count(*) FILTER (WHERE sync_status = 'failed')::text AS failed
         FROM ai_knowledge_sources
        WHERE source_key IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, 2`
    );
    const bySurface: Record<string, { total: number; indexed: number }> = {};
    for (const row of rows) {
      const key = row.surface ?? 'unknown';
      bySurface[key] ??= { total: 0, indexed: 0 };
      bySurface[key]!.total += Number(row.total);
      bySurface[key]!.indexed += Number(row.indexed);
    }
    return { byKind: rows, bySurface, groups: CATEGORY_GROUPS };
  });
}
