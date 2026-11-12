import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { syncWebsiteKnowledge } from '../../src/ai-website/knowledge-sync';
import { retrieveKnowledge } from '../../src/ai-website/retrieval';
import { composeAnswer } from '../../src/ai-website/answer-composer';
import { resolveLiveFacts } from '../../src/ai-website/live-facts';
import { isPrivatePath, resolveRoute } from '../../src/ai-website/website-discovery';

// Real published projection, real SQL search and real composer. No synthetic product facts,
// mocked retrieval, external model calls, authority auto-approval or confidence-floor changes.
describe('public website topic coverage', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const sync = await syncWebsiteKnowledge(db, { trigger: 'manual' });
    expect(sync.indexed).toBeGreaterThan(0);
  }, 120_000);
  afterAll(async () => { await db?.close(); });

  const cases: Array<[string, string, RegExp]> = [
    ['What is VPS hosting?', '/hosting/vps', /vps|virtual private/i],
    ['Can I use my own WordPress plugins and themes?', '/hosting/wordpress', /plugins|themes/i],
    ['How do I transfer my domain?', '/domains/transfer', /domain|transfer/i],
    ['Can I keep my existing mailboxes when I move?', '/hosting/email', /mailboxes|messages/i],
    ['How do I connect to my RDP remote desktop?', '/hosting/rdp', /remote|desktop/i],
    ['How do I follow my SMM order?', '/smm-services', /order|client area/i],
    ['How do I connect my application to SMTP hosting?', '/smtp-hosting', /smtp|application/i],
    ['What is Google Workspace?', '/google-workspace', /workspace|google/i],
    ['What is Microsoft 365?', '/office-365', /microsoft|365/i],
    ['What are number services?', '/number-services', /number/i],
    ['What are digital products?', '/digital-products', /digital|product/i],
    ['What are LTE proxy services?', '/proxy-services', /proxy|lte/i],
    ['What does the SPF checker validate?', '/tools/dns/spf', /spf|lookup/i],
    ['What does DNSKEY Lookup show?', '/tools/dns/dnskey', /dnskey|algorithm|key tag/i],
    ['What changed in the public website navigation registry?', '/blog', /navigation|registry/i],
  ];
  it.each(cases)('answers %s using the published topic', async (question, route, text) => {
    const retrieval = await retrieveKnowledge(db, question);
    expect(retrieval.verificationFailure).toBeUndefined();
    expect(retrieval.pages.map(page => page.url)).toContain(route);
    const answer = await composeAnswer(question, retrieval.understanding, {
      retrieval, facts: await resolveLiveFacts(db), resolveRoute, allowModel: false,
    });
    expect(answer.kind).toBe('ANSWER');
    expect(answer.body).toMatch(text);
    expect(answer.evidence.length).toBeGreaterThan(0);
    for (const page of retrieval.pages) expect(isPrivatePath(page.url)).toBe(false);
  });

  it('does not invent unpublished guarantees even for a named service', async () => {
    const question = 'Does RDP include quantumflux insurance with guaranteed 999999 GB memory?';
    const retrieval = await retrieveKnowledge(db, question);
    const answer = await composeAnswer(question, retrieval.understanding, {
      retrieval, facts: await resolveLiveFacts(db), resolveRoute, allowModel: false,
    });
    expect(answer.kind).not.toBe('ANSWER');
    expect(answer.grounded).toBe(false);
  });
});
