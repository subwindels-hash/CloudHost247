import { describe, expect, it } from 'vitest';
import { understandQuery } from '../../src/ai-website/query-understanding';
import { websiteVocabulary, buildVocabulary, WEBSITE_PROJECTION } from '../../src/ai-website/website-discovery';
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

describe('audit: the corpus vocabulary covers what is actually indexed', () => {
  /**
   * The vocabulary was built from titles, descriptions, sections and headings only — never body
   * prose or FAQ answers. Since body and FAQ text is indexed and quotable, a word that appeared
   * only there counted as "not on the site", in the very check that decides whether to refuse.
   *
   * The assertion is over the *whole* projection against both builders, because a single FAQ
   * happened to contain no word that discriminated the two implementations: the earlier version of
   * this test passed against the defective code, which made it worthless.
   */
  it('includes words that appear only in body prose or FAQ answers', () => {
    const documents = (WEBSITE_PROJECTION as unknown as { documents: Array<Record<string, unknown>> }).documents;
    const metadataOnly = buildVocabulary({
      documents: documents.map((doc) => ({
        title: doc.title, description: doc.description, body: '', section: doc.section,
        category: doc.category, headings: doc.headings, faqs: [],
      })),
    } as never);
    const full = buildVocabulary(WEBSITE_PROJECTION);

    // Words present in indexed body/FAQ text but absent from metadata-only vocabulary.
    const bodyOnly = [...full].filter((word) => !metadataOnly.has(word) && word.length >= 6);
    expect(bodyOnly.length, 'projection must contain body/FAQ-only words').toBeGreaterThan(100);

    // Every one of them must be covered, or the coverage guard will call real content unknown.
    const uncovered = bodyOnly.filter((word) => !full.has(word));
    expect(uncovered).toEqual([]);

    // And the production accessor must agree with the full builder, not the metadata one.
    const declared = websiteVocabulary();
    expect(bodyOnly.filter((word) => !declared.has(word))).toEqual([]);
  });
});

describe('audit: coverage guard actually fires on unsupported subjects', () => {
  it('marks genuinely unknown subject words as ungrounded', () => {
    // "interstellar" appears nowhere on the site; "travel" does (in prose), and since body text is
    // now part of the coverage vocabulary, only the truly unknown word is flagged. One flagged word
    // out of a two-word subject is enough for the guard to fire.
    const u = understandQuery('What is your policy on interstellar travel?', { vocabulary });
    expect(u.ungroundedTokens).toContain('interstellar');
    expect(u.ungroundedTokens ?? []).not.toContain('policy');
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

describe('audit: concurrent syncs are serialised', () => {
  it('reports busy, and does no work, while another sync holds the lock', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { PgliteClient } = await import('../../database/db-client');
    const { migrateUp } = await import('../../database/migrate');
    const { syncWebsiteKnowledge, KNOWLEDGE_SYNC_LEASE_NAME } = await import('../../src/ai-website/knowledge-sync');
    const { tryAcquireWorkerCycleLease, releaseWorkerCycleLease } = await import('../../src/worker/worker-lease');

    const db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    try {
      // Hold the lease the way a competing process would. Asserting on two racing Promise.all
      // calls would only be deterministic if they always overlapped, which they do not.
      const holder = { name: KNOWLEDGE_SYNC_LEASE_NAME, holder: 'test-competitor', leaseMs: 60_000 };
      expect(await tryAcquireWorkerCycleLease(db, holder)).toBe(true);

      const blocked = await syncWebsiteKnowledge(db, { trigger: 'event' });
      expect(blocked.busy).toBe(true);
      expect(blocked.status).toBe('busy');
      expect(blocked.notes.join(' ')).toMatch(/already running/i);
      // Crucially it must not report zeros as though it had run.
      expect(blocked.discovered).toBe(0);
      expect(blocked.runId).toBe('not-started');

      // It really did no work: no sources were written while the lock was held.
      const sources = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_knowledge_sources`);
      expect(sources.rows[0]!.n).toBe(0);

      // Releasing lets the next sync proceed normally.
      await releaseWorkerCycleLease(db, holder);
      const after = await syncWebsiteKnowledge(db, { trigger: 'manual' });
      expect(after.busy).toBeFalsy();
      expect(after.status).toBe('succeeded');
      expect(after.discovered).toBeGreaterThan(300);
      expect(after.failed).toBe(0);
    } finally {
      await db.close();
    }
  }, 180_000);

  it('releases the lock even when the sync itself throws', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { PgliteClient } = await import('../../database/db-client');
    const { migrateUp } = await import('../../database/migrate');
    const { syncWebsiteKnowledge, KNOWLEDGE_SYNC_LEASE_NAME } = await import('../../src/ai-website/knowledge-sync');
    const db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    try {
      // A discovery result that is structurally wrong makes the sync fail on its own terms.
      await syncWebsiteKnowledge(db, { trigger: 'manual', discovery: null as never }).catch(() => undefined);
      const held = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM worker_cycle_leases WHERE name = $1`,
        [KNOWLEDGE_SYNC_LEASE_NAME]
      );
      // A throw must not strand the lock, or every later sync would report busy forever.
      expect(held.rows[0]!.n).toBe(0);
    } finally {
      await db.close();
    }
  }, 180_000);
});

describe('audit: a price is never quoted for a product the question did not name', () => {
  const facts = {
    available: true,
    products: [],
    prices: [
      { productName: 'Email Hosting', planName: 'Mail Basic', amount: '4.50', currency: 'USD', billingPeriod: 'monthly', setupFee: null, url: '/hosting/email' },
      { productName: 'VPS Hosting', planName: 'VPS Basic', amount: '19', currency: 'USD', billingPeriod: 'monthly', setupFee: null, url: '/hosting/vps' },
    ],
    comingSoon: [],
    unavailableReason: null,
  };

  it('returns no price when nothing in the catalogue matches the question', async () => {
    const { selectRelevantPrices } = await import('../../src/ai-website/live-facts');
    // "mobile phone plan" names no CloudHost247 product. The old behaviour fell back to the whole
    // catalogue, cheapest first, so this question was answered with "Email Hosting — USD 4.50".
    expect(selectRelevantPrices(facts as never, ['mobile', 'phone', 'plan'])).toEqual([]);
  });

  it('still quotes the price when the question does name the product', async () => {
    const { selectRelevantPrices } = await import('../../src/ai-website/live-facts');
    // "hosting" legitimately matches both products, so both are offered — but the one the question
    // actually names ("email") must rank first, and its real price must be the one shown.
    const priced = selectRelevantPrices(facts as never, ['email', 'hosting', 'cost']);
    expect(priced.length).toBeGreaterThan(0);
    expect(priced[0]!.productName).toBe('Email Hosting');
    expect(priced[0]!.amount).toBe('4.50');
  });
});

describe('audit: retrieval refuses questions whose subject is not on the site', () => {
  /**
   * The critical defect. `retrieveKnowledge` compared the question's unknown words against `terms`,
   * a list built from those same words, so the guard could never fire. Both questions below quoted
   * legal pages with confidence instead of refusing.
   *
   * This needs a database, which is why the guard's own failure had no unit test before: the
   * `ungroundedTokens` value was always correct, and only the comparison was broken.
   */
  it('returns no evidence for a subject the site never mentions', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { PgliteClient } = await import('../../database/db-client');
    const { migrateUp } = await import('../../database/migrate');
    const { syncWebsiteKnowledge } = await import('../../src/ai-website/knowledge-sync');
    const { retrieveKnowledge } = await import('../../src/ai-website/retrieval');

    const db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    try {
      await syncWebsiteKnowledge(db, { trigger: 'manual' });

      for (const question of [
        'What is your policy on interstellar travel?',
        'Do you sell quantum computers?',
        'Can you forecast the weather next month?',
      ]) {
        const result = await retrieveKnowledge(db, question, {});
        expect(result.pages, `${question} must not retrieve evidence`).toEqual([]);
        expect(result.empty).toBe(true);
      }

      // The counter-case: a real question must still retrieve, or the guard would be useless.
      const real = await retrieveKnowledge(db, 'What is VPS hosting?', {});
      expect(real.empty).toBe(false);
      expect(real.pages.length).toBeGreaterThan(0);
    } finally {
      await db.close();
    }
  }, 180_000);
});

describe('audit: a question naming an offering the site does not sell', () => {
  /**
   * The Phase 31 defect. "mobile phone plan" was answered with Email Hosting (25.7), /help (20.6) and
   * Managed Services (18.3) — a confident answer built entirely from incidental word overlap.
   *
   * Both matches were individually real: /hosting/email says "mobile clients", /help says "phone
   * support". Scoring is additive, so two rare words on two unrelated pages beat the one page about the
   * question. What no page does is mention "mobile" and "phone" in the same *passage*, because the site
   * sells no mobile phone product. The `mobile` test below is the end-to-end assertion; the chunk test
   * is the mechanism, kept separate so a future scoring change cannot quietly reintroduce the overlap.
   */
  it('measures coverage of the question on the page that won, not across all candidates', async () => {
    const { subjectCoverage, titleDeclaresTerm } = await import('../../src/ai-website/retrieval');

    // The real corpus, compressed: /hosting/email mentions "mobile clients" and /help mentions
    // "phone support". Neither page is about a mobile phone plan, and the winning page contains one
    // of the two words — half the question, which is not most of it.
    const emailPage = [
      {
        url: '/hosting/email',
        pageTitle: 'Email Hosting',
        title: 'Email Hosting',
        content: 'Standard IMAP, POP and SMTP, so Outlook, Apple Mail and mobile clients all work.',
        keywords: ['email', 'webmail', 'dns'],
      },
    ] as never;
    expect(subjectCoverage(emailPage, ['mobile', 'phone'])).toBe(0.5);
    expect(titleDeclaresTerm(emailPage, ['mobile', 'phone'])).toBe(false);

    // A page that names the subject in its title is about it, even when it never writes the modifier:
    // "free ssl" must keep working against a page titled "SSL Certificates".
    const sslPage = [
      {
        url: '/hosting/ssl',
        pageTitle: 'SSL Certificates',
        title: 'SSL Certificates',
        content: 'Every certificate is issued and renewed automatically.',
        keywords: ['ssl', 'certificate'],
      },
    ] as never;
    expect(subjectCoverage(sslPage, ['free', 'ssl'])).toBe(0.5);
    expect(titleDeclaresTerm(sslPage, ['free', 'ssl'])).toBe(true);
  });

  it('does not treat a generic alias as the customer naming an offering', async () => {
    const { namesSpecificOffering } = await import('../../src/ai-website/retrieval');
    const { SERVICE_ENTITIES } = await import('../../src/ai-website/query-understanding');
    const billing = SERVICE_ENTITIES.filter((entity) => entity.id === 'billing');

    // "card" is an alias of the billing offering. Naming it is not naming the offering: a question about a
    // SIM card is not a question about billing, and "sim card" must not inherit billing's blessing.
    expect(namesSpecificOffering(billing, ['sim', 'card'], 'sim card')).toBe(false);
    // A real offering name in the question does explain a two-word question.
    const cpanel = SERVICE_ENTITIES.filter((entity) => entity.id === 'cpanel');
    expect(namesSpecificOffering(cpanel, ['cpanel', 'license'], 'cpanel license')).toBe(true);
  });

  it('does not "correct" a real English word into an unrelated one', async () => {
    // `cell` → `call` and `sim` → `sit` both happened: the question was rewritten before it was
    // searched, so no ranking change could ever have fixed it.
    for (const word of ['cell', 'sim']) {
      const { token, corrected } = (await import('../../src/ai-website/query-understanding')).correctToken(
        word,
        vocabulary
      );
      expect({ word, token, corrected }).toEqual({ word, token: word, corrected: false });
    }
  });

  it('returns no evidence for a mobile phone plan, and keeps real questions working', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { PgliteClient } = await import('../../database/db-client');
    const { migrateUp } = await import('../../database/migrate');
    const { syncWebsiteKnowledge } = await import('../../src/ai-website/knowledge-sync');
    const { retrieveKnowledge } = await import('../../src/ai-website/retrieval');

    const db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    try {
      await syncWebsiteKnowledge(db, { trigger: 'manual' });

      for (const question of ['mobile phone plan', 'cell phone plans', 'sim card', 'do you accept paypal']) {
        const result = await retrieveKnowledge(db, question, {});
        expect(result.pages, `${question} must not retrieve evidence`).toEqual([]);
        expect(result.empty, `${question} must be reported empty`).toBe(true);
      }

      /**
       * The counter-cases, and the reason the rule is shaped the way it is. Each of these names a
       * real subject whose two words are never adjacent, so a proximity rule would have broken them:
       * "cPanel license" has no license page, "GDPR" and "compliance" sit thirteen words apart, and
       * "uptime SLA" is the site's own phrasing with the words reversed.
       */
      const expected: Array<[string, string]> = [
        ['cpanel license', '/hosting/cpanel'],
        ['uptime sla', '/cloud/monitoring'],
        ['gdpr compliance', '/legal/data-deletion'],
        ['email migration', '/hosting/email'],
        ['ssl certificate', '/hosting/ssl'],
        ['how do i reset my password', '/docs/passkey'],
      ];
      for (const [question, url] of expected) {
        const result = await retrieveKnowledge(db, question, {});
        expect(result.empty, `${question} must still retrieve`).toBe(false);
        expect(result.pages[0]?.url, `${question} must still reach ${url}`).toBe(url);
      }
    } finally {
      await db.close();
    }
  }, 180_000);
});
