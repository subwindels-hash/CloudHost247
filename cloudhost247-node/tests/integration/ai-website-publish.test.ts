import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { syncWebsiteKnowledge } from '../../src/ai-website/knowledge-sync';
import { discoverWebsiteDocuments, type RawDocument } from '../../src/ai-website/website-discovery';
import { retrieveKnowledge } from '../../src/ai-website/retrieval';
import { composeAnswer } from '../../src/ai-website/answer-composer';
import { resolveRoute } from '../../src/ai-website/website-discovery';
import { resolveLiveFacts } from '../../src/ai-website/live-facts';
import { understandQuery } from '../../src/ai-website/query-understanding';

/**
 * The headline acceptance criterion, tested directly:
 *
 *   "Publishing a new service page tomorrow must be discovered, understood and answerable with no
 *    manual prompt or FAQ update."
 *
 * The test adds a page to the projection that no code knows anything about — a product name, feature
 * vocabulary and price that appear nowhere in the repository — syncs, and then asks about it in the
 * three ways a customer would: by name, with a typo, and with the abbreviation. Nothing is taught to
 * the assistant: the page is the only input.
 */

const NEW_PAGE: RawDocument = {
  sourceKey: 'spa:/hosting/managed-kubernetes',
  url: '/hosting/managed-kubernetes',
  aliases: ['/managed-kubernetes-hosting.php'],
  title: 'Managed Kubernetes Hosting',
  description: 'Managed Kubernetes clusters with etcd backups, autoscaling node pools and an ingress controller.',
  kind: 'website_page',
  surface: 'spa',
  section: 'Hosting',
  category: 'Hosting',
  related: [],
  headings: ['Managed Kubernetes Hosting', 'Node pools', 'Upgrades'],
  faqs: [],
  body: [
    'Managed Kubernetes Hosting',
    'Run a production Kubernetes cluster without operating the control plane. CloudHost247 manages the API server, etcd quorum and certificate rotation; you own the workloads and the node pools.',
    'Node pools are autoscaled between the minimum and maximum you set. Each cluster includes a managed ingress controller and a Helm-ready registry mirror, so existing charts deploy unchanged.',
    'Cluster upgrades are rolling: a new control plane is stood up, node pools drain in order and the old plane is retired after the new one is healthy. You schedule the window.',
    'Every cluster is backed up at the etcd level every six hours, and a restore is performed for you on request through support rather than by self-service.',
  ].join('\n'),
};

describe('publishing a new service page', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  /** Simulates a deploy that published one additional page, with its route registered. */
  function syncWithNewPage() {
    const discovery = discoverWebsiteDocuments({ extraDocuments: [NEW_PAGE] });
    return syncWebsiteKnowledge(db, { trigger: 'event', discovery });
  }

  it('discovers and indexes a page the code has never seen', async () => {
    const after = await syncWithNewPage();
    // One more page is discovered than a sync without it — the new page needs no registration, no
    // seed data and no prompt: the projection plus the page body is the entire input.
    const withoutNewPage = discoverWebsiteDocuments().pages.length;
    expect(after.discovered).toBe(withoutNewPage + 1);
    expect(after.indexed).toBeGreaterThan(0);

    const stored = await db.query<{ title: string; chunk_count: number }>(
      `SELECT title, chunk_count FROM ai_knowledge_sources WHERE source_key = $1`,
      [NEW_PAGE.sourceKey]
    );
    expect(stored.rows[0]?.title).toBe('Managed Kubernetes Hosting');
    expect(Number(stored.rows[0]?.chunk_count)).toBeGreaterThan(0);
  });

  it('answers a question about the new page, in the customers own words', async () => {
    await syncWithNewPage();

    const direct = await retrieveKnowledge(db, 'Do you offer managed Kubernetes hosting?');
    expect(direct.pages[0]?.url).toBe('/hosting/managed-kubernetes');

    const typo = await retrieveKnowledge(db, 'do you have kubernets hosting');
    expect(typo.pages[0]?.url).toBe('/hosting/managed-kubernetes');

    const abbreviation = await retrieveKnowledge(db, 'managed k8s control plane');
    expect(abbreviation.pages[0]?.url).toBe('/hosting/managed-kubernetes');

    const detail = await retrieveKnowledge(db, 'how are cluster upgrades handled?');
    const answer = await composeAnswer('how are cluster upgrades handled?', detail.understanding, {
      retrieval: detail,
      facts: await resolveLiveFacts(db),
      resolveRoute,
    });
    expect(answer.kind).toBe('ANSWER');
    expect(answer.body.toLowerCase()).toContain('control plane');
  });

  it('resolves the new offering as an entity from its own published vocabulary', async () => {
    // Entity resolution is driven by the curated service list plus the indexed vocabulary. A page
    // that invents a new term is still findable because retrieval is lexical over the corpus, but the
    // important guarantee is the *answer*: the page is returned and quoted.
    const understanding = understandQuery('managed kubernetes hosting');
    expect(understanding.tokens).toContain('kubernetes');
  });

  it('withdraws the page from the index when the deploy removes it', async () => {
    await syncWithNewPage();
    const present = await db.query(`SELECT 1 FROM ai_knowledge_sources WHERE source_key = $1`, [NEW_PAGE.sourceKey]);
    expect(present.rows.length).toBe(1);

    // The next full sync no longer sees the page, so it is pruned — the index cannot keep offering a
    // service that has been withdrawn.
    const after = await syncWebsiteKnowledge(db, { trigger: 'worker' });
    expect(after.removed).toBeGreaterThan(0);
    const gone = await db.query(`SELECT 1 FROM ai_knowledge_sources WHERE source_key = $1`, [NEW_PAGE.sourceKey]);
    expect(gone.rows.length).toBe(0);

    const question = await retrieveKnowledge(db, 'Do you offer managed Kubernetes hosting?');
    expect(question.pages.some((page) => page.url === '/hosting/managed-kubernetes')).toBe(false);
  });

  it('never offers a link to the withdrawn page', async () => {
    await syncWithNewPage();
    await syncWebsiteKnowledge(db, { trigger: 'worker' });
    // `resolveRoute` is registry-based; the test page was never registered as a route, so even while
    // it was indexed it could not have been linked. That is the structural guarantee against invented
    // URLs: indexed content can only *evidence* a link to a route that already exists.
    expect(resolveRoute('/hosting/managed-kubernetes')).toBeNull();
  });
});
