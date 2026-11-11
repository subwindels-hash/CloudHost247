import { describe, expect, it } from 'vitest';
import { assessSources, freshness, type TrustSource } from '../../src/ai-website/source-trust';
const now = Date.now();
const source = (id: string, extra: Partial<TrustSource> = {}): TrustSource => ({
  id, source_kind: 'product', fingerprint: 'a'.repeat(64), approved_fingerprint: 'a'.repeat(64),
  approval_status: 'approved', authority_tier: 2, last_synced_at: new Date(now - 1000),
  source_modified_at: null, valid_until: null, historical: false, sync_status: 'indexed',
  status: 'active', excluded: false, verified_claims: { 'vps.usd.monthly': '10' }, ...extra,
});
describe('deterministic source authority and freshness', () => {
  it('selects authoritative policy over an outdated FAQ', () => {
    const result = assessSources([source('policy', { authority_tier: 1 }), source('faq', { authority_tier: 4, last_synced_at: new Date(now - 8 * 86400000), verified_claims: { 'vps.usd.monthly': '5' } })], ['faq', 'policy'], now);
    expect(result.selected).toEqual(['policy']);
    expect(result.conflicts[0]?.status).toBe('resolved_by_authority');
  });
  it('does not let historical pricing override current pricing', () => {
    expect(assessSources([source('current'), source('old', { historical: true, authority_tier: 5 })], ['old', 'current'], now).selected).toEqual(['current']);
  });
  it('escalates contradictory equally authoritative claims, regardless of newer timestamp', () => {
    const result = assessSources([source('a'), source('b', { last_synced_at: new Date(now), verified_claims: { 'vps.usd.monthly': '20' } })], ['a'], now);
    expect(result.outcome).toBe('conflict'); expect(result.selected).toEqual([]);
    expect(result.conflicts[0]?.sourceIds).toEqual(['a', 'b']);
  });
  it('resolves conflicting values by authority, not lexical score', () => {
    const result = assessSources([source('a'), source('b', { authority_tier: 4, verified_claims: { 'vps.usd.monthly': '20' } })], ['b', 'a'], now);
    expect(result.selected).toEqual(['a']);
  });
  it('does not invent replacement evidence when only the losing source was retrieved', () => {
    expect(assessSources([source('a'), source('b', { authority_tier: 4, verified_claims: { 'vps.usd.monthly': '20' } })], ['b'], now).outcome).toBe('stale');
  });
  it.each([
    [{ last_synced_at: null }, 'unsynchronized'],
    [{ last_synced_at: new Date(now - 8 * 86400000) }, 'stale'],
    [{ source_modified_at: new Date(now) }, 'unsynchronized'],
    [{ valid_until: new Date(now - 1) }, 'stale'],
    [{ fingerprint: 'b'.repeat(64) }, 'revision_unapproved'],
    [{ approval_status: 'rejected' }, 'rejected'],
    [{ sync_status: 'failed' }, 'unsynchronized'],
  ] as const)('detects %j as %s', (extra, expected) => expect(freshness(source('a', extra), now)).toBe(expected));
  it('never treats unreviewed content as human-approved authority', () => {
    const trace = assessSources([source('a', { approval_status: 'unreviewed', authority_tier: 1 })], ['a'], now);
    expect(trace.sources[0]?.authority).toBe(6);
    expect(trace.sources[0]?.approval).toBe('unreviewed');
  });
  it('fails closed if metadata is missing', () => expect(assessSources([], ['missing'], now).outcome).toBe('unavailable'));
  it('does not compare unrelated scoped prices', () => {
    expect(assessSources([source('a'), source('b', { verified_claims: { 'vps.ngn.yearly': '20' } })], ['a'], now).conflicts).toEqual([]);
  });
});

// Synthetic test prices, never production observations.
import { resolveRoute } from '../../src/ai-website/website-discovery';
import { composeAnswer } from '../../src/ai-website/answer-composer';
import { understandQuery } from '../../src/ai-website/query-understanding';
import type { RetrievalResult } from '../../src/ai-website/retrieval';
describe('current live pricing versus indexed historical price prose', () => {
  const understanding = understandQuery('How much is VPS hosting?');
  const chunk = { sourceId: 'test-source', sourceKey: 'test:vps', url: '/hosting/vps', title: 'VPS Hosting', pageTitle: 'VPS Hosting', section: 'Pricing', kind: 'website_page' as const, content: 'VPS Hosting costs USD 1 per month according to an old FAQ.', keywords: ['vps'], score: 100, exactAnswer: false };
  const retrieval: RetrievalResult = { understanding, effectiveQuery: 'vps', chunks: [chunk], pages: [{ url: chunk.url, title: chunk.title, kind: chunk.kind, score: 100, chunks: [chunk] }], entities: understanding.entities, empty: false };
  it('quotes current live records only, without repeating the indexed amount', async () => {
    const answer = await composeAnswer(understanding.raw, understanding, { retrieval, resolveRoute, allowModel: false,
      facts: { available: true, products: [], comingSoon: [], unavailableReason: null, prices: [{ productName: 'VPS Hosting', productSlug: 'vps', planName: 'Test Plan', planSlug: 'test', amount: '29', currency: 'USD', billingPeriod: 'monthly', setupFee: null, url: '/hosting/vps' }] } });
    expect(answer.body).toContain('USD 29');
    expect(answer.body).not.toContain('USD 1');
    expect(answer.body).not.toContain('old FAQ');
  });
  it('does not fall back to indexed prices when live records are unavailable', async () => {
    const answer = await composeAnswer(understanding.raw, understanding, { retrieval, resolveRoute, allowModel: false,
      facts: { available: false, products: [], prices: [], comingSoon: [], unavailableReason: 'private-test-error' } });
    expect(answer.body).not.toContain('USD 1');
    expect(answer.body).not.toContain('private-test-error');
    expect(answer.body).toContain('cannot reach');
  });
});
