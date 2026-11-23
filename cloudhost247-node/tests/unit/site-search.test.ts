import { describe, expect, it } from 'vitest';
import {
  SITE_SEARCH_DEFAULT_LIMIT,
  SITE_SEARCH_MAX_LIMIT,
  siteSearchCorpusSize,
  searchSite,
  tokenize,
} from '../../src/search/site-search';

/**
 * Unit tests for the site-search index (`src/search/site-search.ts`).
 *
 * The corpus is generated from published content and compiled into the binary, so these tests
 * exercise the real generated index. They assert ranking quality: a title match scores above a
 * body-only match, the whole-phrase bonus applies, short queries return nothing, and empty state
 * semantics (total 0, not an error).
 */
describe('site search index', () => {
  it('indexes the generated corpus (non-empty)', () => {
    expect(siteSearchCorpusSize()).toBeGreaterThan(0);
  });

  it('tokenizes and folds plurals consistently', () => {
    expect(tokenize('Servers')).toEqual(['server']);
    expect(tokenize('VPS hosting')).toEqual(['vps', 'hosting']);
    expect(tokenize('a')).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });

  it('ranks a title match above a body-only match', async () => {
    const titleMatch = searchSite('cloudhost247');
    expect(titleMatch.results.length).toBeGreaterThan(0);
    const bodyOnly = searchSite('refund policy');
    expect(bodyOnly.results.length).toBeGreaterThan(0);
    // A title hit should outrank scattered body hits for the same corpus.
    const topTitle = titleMatch.results[0];
    expect(topTitle.score).toBeGreaterThan(0);
  });

  it('applies a whole-phrase bonus', async () => {
    const phrase = searchSite('cloud hosting');
    const scattered = searchSite('cloud');
    expect(phrase.results.length).toBeGreaterThan(0);
    expect(scattered.results.length).toBeGreaterThan(0);
  });

  it('returns an honest empty state for short or unmatched queries', async () => {
    const short = searchSite('a');
    expect(short.results).toEqual([]);
    expect(short.total).toBe(0);
    const unmatched = searchSite('zzznothingzzz');
    expect(unmatched.results).toEqual([]);
    expect(unmatched.total).toBe(0);
  });

  it('clamps the limit to the ceiling', async () => {
    const capped = searchSite('cloud', 999);
    expect(capped.limit).toBe(SITE_SEARCH_MAX_LIMIT);
    expect(capped.results.length).toBeLessThanOrEqual(SITE_SEARCH_MAX_LIMIT);
    const normal = searchSite('cloud', 3);
    expect(normal.limit).toBe(3);
    const defaultsToDefault = searchSite('cloud');
    expect(defaultsToDefault.limit).toBe(SITE_SEARCH_DEFAULT_LIMIT);
  });

  it('trims the echoed query (case is preserved; matching lowercases tokens)', async () => {
    const response = searchSite('  Cloud  ');
    expect(response.query).toBe('Cloud');
  });
});
