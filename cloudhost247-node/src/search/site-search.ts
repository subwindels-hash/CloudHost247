/**
 * Site search — an in-memory inverted index over the published corpus.
 *
 * The corpus (`site-search-corpus.generated.ts`) is built by `scripts/site/generate.mjs` from
 * content that is already published: the marketing pages, the documentation index, the public
 * tools catalogue and the FAQ. Nothing is invented to make the index look bigger, and a result is
 * always a page that exists — the same guarantee the navigation registry makes.
 *
 * Why in memory rather than a database table: the corpus is a build artefact, not customer data. It
 * is regenerated with the site, it is read on every request, and it never changes at runtime. The
 * tools catalogue (`src/tools/catalog.ts`) is served the same way. A database table would add a
 * migration, a seed and a sync path to reproduce something the build already knows.
 *
 * Ranking is deliberately plain and explainable: a query term found in a title counts most, then
 * the category, then the summary, then the body; a run of the whole phrase counts extra. There is
 * no machine-learned model, so a result can always be explained by the words it matched.
 */
import { SITE_SEARCH_CORPUS, type SiteSearchDoc } from './site-search-corpus.generated';

export interface SiteSearchResult {
  href: string;
  title: string;
  category: string;
  description: string;
  /** A short window of the matched text, so a visitor can see why this result came back. */
  snippet: string;
  score: number;
}

export interface SiteSearchResponse {
  query: string;
  results: SiteSearchResult[];
  /** Matches before `limit` was applied — the UI can say "27 results" without fetching them all. */
  total: number;
  limit: number;
}

export const SITE_SEARCH_MIN_QUERY_LENGTH = 2;
export const SITE_SEARCH_DEFAULT_LIMIT = 20;
export const SITE_SEARCH_MAX_LIMIT = 40;

/** Below this a query is noise: "a", "7", or the first keystroke of a word. */
export function normalizeQuery(query: unknown): string {
  return String(query ?? '').trim().slice(0, 100);
}

/**
 * Light plural folding, applied to documents and queries alike so the two always agree: "servers"
 * finds "server" and vice versa. Words ending in a double s ("class", "address" is safe because the
 * rule needs length > 3 and a trailing single s) are left alone.
 */
function normalizeToken(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(normalizeToken)
    .filter((token) => token.length >= 2);
}

interface IndexedDoc {
  doc: SiteSearchDoc;
  titleTokens: Set<string>;
  categoryTokens: Set<string>;
  descriptionTokens: Set<string>;
  bodyText: string;
  /** Term → occurrences in the body, for a small frequency boost. */
  bodyFrequency: Map<string, number>;
}

const INDEX: IndexedDoc[] = SITE_SEARCH_CORPUS.map((doc) => {
  const bodyText = `${doc.title} ${doc.description} ${doc.body}`;
  const bodyFrequency = new Map<string, number>();
  for (const token of tokenize(bodyText)) {
    bodyFrequency.set(token, (bodyFrequency.get(token) ?? 0) + 1);
  }
  return {
    doc,
    titleTokens: new Set(tokenize(doc.title)),
    categoryTokens: new Set(tokenize(doc.category)),
    descriptionTokens: new Set(tokenize(doc.description)),
    bodyText,
    bodyFrequency,
  };
});

/** Term → positions in INDEX. Built once at module load; the corpus is static. */
const POSTINGS = new Map<string, number[]>();
INDEX.forEach((entry, position) => {
  for (const term of entry.bodyFrequency.keys()) {
    const postings = POSTINGS.get(term);
    if (postings) postings.push(position);
    else POSTINGS.set(term, [position]);
  }
});

/** How many indexed documents there are — used by the audit and by tests. */
export function siteSearchCorpusSize(): number {
  return INDEX.length;
}

function excerpt(text: string, terms: string[], radius = 80): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const found = lower.indexOf(term.toLowerCase());
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/**
 * Search the corpus.
 *
 * A query shorter than {@link SITE_SEARCH_MIN_QUERY_LENGTH} returns nothing rather than
 * everything: a one-character query is not a question, and returning the whole corpus would read
 * as a match. An empty result is a real answer, not an error.
 */
export function searchSite(query: unknown, limit = SITE_SEARCH_DEFAULT_LIMIT): SiteSearchResponse {
  const raw = normalizeQuery(query);
  const capped = Math.min(Math.max(Math.trunc(limit) || SITE_SEARCH_DEFAULT_LIMIT, 1), SITE_SEARCH_MAX_LIMIT);
  const terms = tokenize(raw);
  if (raw.length < SITE_SEARCH_MIN_QUERY_LENGTH || terms.length === 0) {
    return { query: raw, results: [], total: 0, limit: capped };
  }

  const phrase = raw.toLowerCase();
  const scores = new Map<number, number>();
  for (const term of terms) {
    const postings = POSTINGS.get(term);
    if (!postings) continue;
    for (const position of postings) {
      const entry = INDEX[position];
      if (!entry) continue;
      let weight = 1;
      if (entry.titleTokens.has(term)) weight += 6;
      if (entry.categoryTokens.has(term)) weight += 3;
      if (entry.descriptionTokens.has(term)) weight += 2;
      const frequency = entry.bodyFrequency.get(term) ?? 1;
      scores.set(position, (scores.get(position) ?? 0) + weight * (1 + Math.log10(frequency)));
    }
  }

  const ranked = [...scores.entries()]
    .map(([position, score]) => {
      const entry = INDEX[position];
      if (!entry) return null;
      // A run of the whole phrase is a much stronger signal than the same words scattered.
      if (entry.doc.title.toLowerCase().includes(phrase)) score += 10;
      else if (entry.bodyText.toLowerCase().includes(phrase)) score += 4;
      return {
        href: entry.doc.href,
        title: entry.doc.title,
        category: entry.doc.category,
        description: entry.doc.description,
        snippet: excerpt(entry.bodyText, terms),
        score,
      } satisfies SiteSearchResult;
    })
    .filter((result): result is SiteSearchResult => result !== null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  return { query: raw, results: ranked.slice(0, capped), total: ranked.length, limit: capped };
}
