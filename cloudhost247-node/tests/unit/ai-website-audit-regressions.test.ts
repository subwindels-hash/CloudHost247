import { describe, expect, it } from 'vitest';
import { understandQuery } from '../../src/ai-website/query-understanding';
import { websiteVocabulary } from '../../src/ai-website/website-discovery';
import { extractExcerpt } from '../../src/ai-website/answer-composer';
import { loadCatalogDocuments } from '../../src/ai-website/live-facts';
import type { DiscoveryResult } from '../../src/ai-website/website-discovery';
import type { Queryable } from '../../src/db/types';

/**
 * Regressions found by the Phase 10 independent acceptance audit.
 *
 * Each case here failed against `e9d29d4` and is kept so the same defect cannot come back silently.
 * They are deliberately end-state assertions about customer-visible behaviour ("this question must
 * not produce a confident answer"), not assertions about internal shapes.
 */

const vocabulary = websiteVocabulary();

describe('audit: coverage guard actually fires on unsupported subjects', () => {
  it('marks genuinely unknown subject words as ungrounded', () => {
    const u = understandQuery('What is your policy on interstellar travel?', { vocabulary });
    expect(u.ungroundedTokens).toEqual(expect.arrayContaining(['interstellar', 'travel']));
  });

  it('never marks ordinary question scaffolding as ungrounded', () => {
    // These were all false positives that would have refused real questions once the guard was
    // made effective: "cost"/"cheapest" are how people ask about price, not subject matter.
    for (const question of [
      'How much does VPS Basic cost?',
      'cheapest vps',
      'What payment methods do you accept?',
      'Can I speak to a human?',
    ]) {
      const u = understandQuery(question, { vocabulary });
      expect(u.ungroundedTokens ?? [], question).toEqual([]);
    }
  });

  it('treats a compound of two known words as covered', () => {
    // "webhosting" is not a corpus word, but "web" + "hosting" both are.
    const u = understandQuery('webhosting prices', { vocabulary });
    expect(u.ungroundedTokens ?? []).not.toContain('webhosting');
  });
});

describe('audit: catalogue documents never leak instructions to customers', () => {
  const fakeDb = (plans: string[]) => ({
    query: async (sql: string) => {
      if (/FROM products/.test(sql)) {
        return {
          rows: [{
            id: '11111111-1111-1111-1111-111111111111',
            slug: 'vps',
            name: 'VPS Hosting',
            description: 'Virtual servers.',
            product_type: 'product',
            productType: 'product',
            status: 'active',
            visibility: 'public',
            display_order: 1,
          }],
        };
      }
      if (/FROM product_plans/.test(sql)) {
        return {
          rows: plans.map((name, index) => ({
            id: `22222222-2222-2222-2222-22222222222${index}`,
            product_id: '11111111-1111-1111-1111-111111111111',
            name,
            status: 'active',
            display_order: index,
          })),
        };
      }
      if (/FROM plan_pricing/.test(sql)) return { rows: [] };
      if (/FROM plan_features/.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  }) as unknown as Queryable;

  const forbidden = /the assistant|never from memory|must not be offered|must quote/i;

  it('does not put instruction text into the indexed body when plans are published', async () => {
    const docs = await loadCatalogDocuments(fakeDb(['VPS Basic']));
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      expect(doc.body, doc.sourceKey).not.toMatch(forbidden);
      expect(doc.description ?? '', doc.sourceKey).not.toMatch(forbidden);
    }
  });

  it('does not put instruction text into the indexed body when nothing is purchasable', async () => {
    const docs = await loadCatalogDocuments(fakeDb([]));
    for (const doc of docs) {
      expect(doc.body, doc.sourceKey).not.toMatch(forbidden);
    }
  });
});

describe('audit: excerpts are cut on word boundaries', () => {
  /** True when the excerpt's first character starts a word in the source text. */
  const startsOnBoundary = (content: string, excerpt: string): boolean => {
    const at = content.indexOf(excerpt);
    return at >= 0 && (at === 0 || content[at - 1] === ' ');
  };

  it('does not begin an excerpt mid-word', () => {
    // A long unbroken run guarantees that the `bestIndex - 60` offset lands inside a word, which is
    // how the real excerpts came out as "...ontent management systems".
    const unbroken = 'mlkjihgfedcba'.repeat(20);
    const content = `${unbroken} databases turnaround ${'y'.repeat(300)}`;
    const excerpt = extractExcerpt(content, ['databases'], 200).replace(/^…/, '').replace(/…$/, '');
    expect(excerpt.length).toBeGreaterThan(0);
    expect(startsOnBoundary(content, excerpt)).toBe(true);
  });
});

describe('audit: an unreadable page fails loudly instead of indexing nothing', () => {
  const makeSync = async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { PgliteClient } = await import('../../database/db-client');
    const { migrateUp } = await import('../../database/migrate');
    const db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    return db;
  };

  it('counts a document with no content as failed and records it', async () => {
    const db = await makeSync();
    try {
      const { syncWebsiteKnowledge } = await import('../../src/ai-website/knowledge-sync');
      const page = {
        sourceKey: 'spa:/no-content',
        url: '/no-content',
        aliases: [],
        title: 'Page that could not be read',
        kind: 'website_page' as const,
        surface: 'spa' as const,
        section: 'Test',
        category: 'Test',
        related: [],
        headings: [],
        faqs: [],
        publishable: true,
        content: undefined,
      };
      const discovery = {
        pages: [page],
        excluded: [],
        routes: new Set<string>(),
        stats: { discovered: 1, publishable: 1, excluded: 0, byKind: {}, bySurface: {} },
      } as unknown as DiscoveryResult;

      const result = await syncWebsiteKnowledge(db, { trigger: 'manual', discovery });
      expect(result.indexed).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.status).toBe('failed');

      const stored = await db.query<{ sync_status: string; chunk_count: number }>(
        `SELECT sync_status, chunk_count FROM ai_knowledge_sources WHERE source_key = 'spa:/no-content'`
      );
      // The admin console's "failed sources" view must actually be reachable.
      expect(stored.rows[0]?.sync_status).toBe('failed');
      expect(stored.rows[0]?.chunk_count).toBe(0);
    } finally {
      await db.close();
    }
  }, 120_000);
});
