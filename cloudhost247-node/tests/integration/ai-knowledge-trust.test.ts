import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { syncWebsiteKnowledge } from '../../src/ai-website/knowledge-sync';
import { retrieveKnowledge } from '../../src/ai-website/retrieval';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import type { Queryable } from '../../src/db/types';

const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost/test', JWT_SECRET: 't'.repeat(40) });
describe('knowledge outage handoff with real SQL persistence', () => {
  let db: PGlite;
  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    await syncWebsiteKnowledge(db, { trigger: 'manual' });
  });
  afterEach(async () => { await db.close(); });

  it('audits a retrieval outage and preserves the conversation without inventing a content gap', async () => {
    const brokenSearch: Queryable = {
      async query<T>(sql: string, params?: unknown[]) {
        if (sql.includes('ts_rank(')) throw new Error('private-dsn-password');
        return db.query<T>(sql, params);
      },
    };
    const app = buildApp(env, { serveFrontend: false, pool: brokenSearch });
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/ai-support/conversations' });
      expect(created.statusCode).toBe(201);
      const { conversationId, accessToken } = created.json();
      const headers = { 'x-ai-conversation-token': accessToken };
      const result = await app.inject({ method: 'POST', url: `/api/v1/ai-support/conversations/${conversationId}/messages`, headers,
        payload: { message: 'What is VPS hosting?' } });
      expect(result.statusCode).toBe(200);
      expect(result.json().decision).toMatchObject({ kind: 'ESCALATE', reason: 'TECHNICAL_SUPPORT_REQUIRED', knowledgeFailure: 'SEARCH_UNAVAILABLE' });
      expect(result.json().decision.body).toContain('does not mean the information is missing');
      expect(result.body).not.toContain('private-dsn-password');
      const gaps = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM ai_support_unanswered_questions');
      expect(gaps.rows[0]?.count).toBe('0');
      const audit = await db.query<{ metadata: Record<string, unknown> }>(
        "SELECT metadata FROM audit_logs WHERE action = 'AI_ESCALATION_TRIGGERED' AND resource_id = $1", [conversationId]);
      expect(audit.rows[0]?.metadata).toMatchObject({ knowledgeFailure: 'SEARCH_UNAVAILABLE', reason: 'TECHNICAL_SUPPORT_REQUIRED' });
      expect(JSON.stringify(audit.rows)).not.toMatch(/private-dsn-password|What is VPS hosting/);
      const transcript = await app.inject({ method: 'GET', url: `/api/v1/ai-support/conversations/${conversationId}`, headers });
      expect(transcript.json().conversation.status).toBe('WAITING_FOR_HUMAN');
      expect(transcript.json().messages.filter((m: { author_type: string }) => m.author_type === 'CUSTOMER')).toHaveLength(1);
      expect(transcript.json().messages.some((m: { author_type: string; body: string }) => m.author_type === 'AI' && m.body.includes('temporarily unable'))).toBe(true);
      const outageMessage = transcript.json().messages.find((m: { author_type: string; intent: string }) => m.author_type === 'AI' && m.intent === 'knowledge_unavailable');
      expect(outageMessage).toBeTruthy();
      const feedback = await app.inject({ method: 'POST',
        url: `/api/v1/ai-support/conversations/${conversationId}/messages/${outageMessage.id}/feedback`,
        headers, payload: { rating: 'down', reason: 'other' },
      });
      expect(feedback.statusCode).toBe(200);
      expect((await db.query<{ count: string }>('SELECT count(*)::text AS count FROM ai_support_feedback')).rows[0]?.count).toBe('1');
      expect((await db.query<{ count: string }>('SELECT count(*)::text AS count FROM ai_support_unanswered_questions')).rows[0]?.count).toBe('0');
      const unauthorized = await app.inject({ method: 'GET', url: `/api/v1/ai-support/conversations/${conversationId}` });
      expect([401, 403, 404]).toContain(unauthorized.statusCode);
    } finally { await app.close(); }
  });

  it('does not treat failed sync or sources with missing chunks as verified knowledge', async () => {
    await db.query("UPDATE ai_knowledge_sync_runs SET status = 'failed'");
    const failed = await retrieveKnowledge(db, 'What is VPS hosting?');
    expect(failed.verificationFailure).toBe('INDEX_NOT_READY');
    await db.query("UPDATE ai_knowledge_sync_runs SET status = 'succeeded'");
    await db.query('DELETE FROM ai_knowledge_chunks WHERE id = (SELECT c.id FROM ai_knowledge_chunks c JOIN ai_knowledge_sources s ON s.id = c.source_id WHERE s.chunk_count > 1 LIMIT 1)');
    expect((await retrieveKnowledge(db, 'What is VPS hosting?')).verificationFailure).toBe('INDEX_NOT_READY');
    await db.query('DELETE FROM ai_knowledge_chunks WHERE source_id = (SELECT source_id FROM ai_knowledge_chunks LIMIT 1)');
    const partial = await retrieveKnowledge(db, 'What is VPS hosting?');
    expect(partial.verificationFailure).toBe('INDEX_NOT_READY');
    await db.query('DELETE FROM ai_knowledge_chunks');
    const empty = await retrieveKnowledge(db, 'What is VPS hosting?');
    expect(empty.verificationFailure).toBe('INDEX_NOT_READY');
    expect(empty.pages).toEqual([]);
  });
});
