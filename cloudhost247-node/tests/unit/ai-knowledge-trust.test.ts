import { describe, expect, it, vi } from 'vitest';
import type { Queryable } from '../../src/db/types';
import { knowledgeIndexReady } from '../../src/ai-website/website-knowledge-repo';
import { retrieveKnowledge } from '../../src/ai-website/retrieval';
import { composeAnswer } from '../../src/ai-website/answer-composer';
import { decideSupportResponse } from '../../src/services/ai-support-operator';

const healthy = { indexed: '1', incomplete: '0', latest_status: 'succeeded' };
function database(options: { readiness?: object; failStatus?: boolean; failSearch?: boolean; failTitle?: boolean } = {}) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('AS latest_status')) {
      if (options.failStatus) throw new Error('private-dsn-and-password');
      return { rows: [options.readiness ?? healthy] };
    }
    if (options.failSearch && sql.includes('ts_rank(')) throw new Error('private-customer-prompt');
    if (options.failTitle && sql.includes('lower(c.page_title)')) throw new Error('private-api-key');
    return { rows: [] };
  });
  return { query, db: { query } as unknown as Queryable };
}

describe('knowledge availability is not content coverage', () => {
  it.each([
    { indexed: '0', incomplete: '0', latest_status: null },
    { indexed: '1', incomplete: '1', latest_status: 'succeeded' },
    { indexed: '1', incomplete: '0', latest_status: 'failed' },
    { indexed: '1', incomplete: '0', latest_status: 'partial' },
    { indexed: '1', incomplete: '0', latest_status: 'running' },
    { indexed: '1', incomplete: '0', latest_status: null },
  ])('does not treat incomplete index state %j as ready', async readiness => {
    const { db } = database({ readiness });
    expect(await knowledgeIndexReady(db)).toBe(false);
    expect((await retrieveKnowledge(db, 'What is VPS hosting?')).verificationFailure).toBe('INDEX_NOT_READY');
  });
  it('distinguishes a healthy empty search from an unavailable search', async () => {
    const { db } = database();
    const result = await retrieveKnowledge(db, 'What is VPS hosting?');
    expect(result.empty).toBe(true);
    expect(result.verificationFailure).toBeUndefined();
  });
  it.each([
    [{ failStatus: true }, 'INDEX_STATUS_UNAVAILABLE'],
    [{ failSearch: true }, 'SEARCH_UNAVAILABLE'],
    [{ failTitle: true }, 'SEARCH_UNAVAILABLE'],
  ] as const)('returns a safe failure state for %j', async (options, reason) => {
    const { db } = database(options);
    const result = await retrieveKnowledge(db, 'What is VPS hosting?');
    expect(result.verificationFailure).toBe(reason);
    expect(result.pages).toEqual([]);
    expect(result.chunks).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/private-/);
    const answer = await composeAnswer('What is VPS hosting?', result.understanding, { retrieval: result });
    expect(answer.kind).toBe('ESCALATE');
    expect(answer.escalateReason).toBe('TECHNICAL_SUPPORT_REQUIRED');
    expect(answer.body).toContain('does not mean the information is missing');
    expect(answer.evidence).toEqual([]);
    expect(answer.grounded).toBe(false);
  });
  it('does not use a reviewed procedure to conceal an unavailable index', async () => {
    const { db } = database({ failStatus: true });
    const decision = await decideSupportResponse(db, 'How do I update a DNS record for my domain?');
    expect(decision.kind).toBe('ESCALATE');
    expect(decision.reason).toBe('TECHNICAL_SUPPORT_REQUIRED');
    expect(decision.knowledgeFailure).toBe('INDEX_STATUS_UNAVAILABLE');
    expect(decision.body).not.toContain('DNS Management');
    expect(decision.body).not.toMatch(/private-/);
  });
});
