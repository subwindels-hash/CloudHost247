import { assessRetrievedSources, type TrustTrace } from './source-trust';
import type { KnowledgeFailure } from './knowledge-trust';
import type { Queryable } from '../db/types';
import type { RetrievalRow } from './website-knowledge-repo';
import { findChunksByTitle, knowledgeIndexReady, searchChunks } from './website-knowledge-repo';
import {
  QUESTION_SCAFFOLDING,
  retrievalQueryFor,
  toTsQueryBody,
  understandQuery,
  type QueryUnderstanding,
  type ServiceEntity,
} from './query-understanding';
import { foldText, type WebsiteSourceKind } from './types';
import { websiteVocabulary } from './website-discovery';

/**
 * Knowledge retrieval.
 *
 * Three stages, each with a job the others cannot do:
 *
 *   1. **Candidate generation (PostgreSQL).** One indexed full-text query plus one keyword-array
 *      query. The database does the filtering; nothing is ever loaded wholesale into node (the
 *      Control Plane's older `searchKnowledge` scans every chunk, which is fine for a hundred
 *      hand-authored documents and wrong for four hundred generated ones).
 *   2. **Reranking (deterministic, in-process).** Lexical rank alone ranks a page's footer above a
 *      FAQ that answers the question verbatim. The reranker combines lexical score, how much of the
 *      question the chunk actually covers, which offering families the question named, document
 *      kind (a FAQ beats a marketing page for a verbatim question; a page beats a FAQ for "tell me
 *      about X"), and a small preference for pages whose title matches an entity.
 *   3. **Grouping.** An answer needs at most a handful of *pages*, not twenty chunks of the same
 *      page. Grouping by source, keeping the best two chunks, is what stops the composer from
 *      quoting the same paragraph three times.
 *
 * There is no embedding stage, and none is implemented: no embedding call, no vector column, no
 * configuration key. An earlier comment here described `AI_LLM_*`-configured embeddings as an
 * "optional additive signal", which implied a capability that does not exist. The engine is
 * complete on its own, which is why it works on a stock cPanel PostgreSQL with no extensions;
 * `RetrievedChunk.score` is the seam a future hybrid scorer would use (see §5.4 of
 * docs/AI_WEBSITE_INTELLIGENCE.md for why embeddings are absent).
 */

export interface RetrievedChunk {
  sourceId: string;
  sourceKey: string | null;
  url: string;
  title: string;
  pageTitle: string;
  section: string | null;
  kind: WebsiteSourceKind;
  content: string;
  keywords: string[];
  /** The chunk's own relevance, independent of how many chunks its page contributed. */
  score: number;
  /** Set when the chunk's own text answers the question verbatim. */
  exactAnswer: boolean;
  /**
   * The page aggregate this chunk contributed to. A page earns credit for several relevant chunks,
   * but no page can outrank a better answer merely by having more chunks indexed.
   */
  pageScore?: number;
}

export interface RetrievalResult {
  /** Present when verification failed; empty is NOT evidence of an uncovered topic. */
  verificationFailure?: KnowledgeFailure;
  trustTrace?: TrustTrace;
  understanding: QueryUnderstanding;
  /** The query actually sent to the database, for the console and for tests. */
  effectiveQuery: string;
  chunks: RetrievedChunk[];
  /** Distinct pages, best first — what the answer composer works from. */
  pages: Array<{ url: string; title: string; kind: WebsiteSourceKind; score: number; chunks: RetrievedChunk[] }>;
  /** Offering families resolved from the question. Never a claim that they exist. */
  entities: ServiceEntity[];
  /** True when nothing scored above the usefulness floor. */
  empty: boolean;
  /** Customer words the site does not cover at all, when that is why nothing was returned. */
  ungroundedTerms?: string[];
}

/**
 * The floor below which a chunk is noise rather than evidence. Calibrated against the real corpus:
 * a genuine answer scores in the tens, a coincidental word overlap scores in the low singles. Below
 * the floor the assistant says it could not verify the answer, which is the honest outcome.
 */
export const MIN_USEFUL_SCORE = 9;

const KIND_PRIOR: Record<string, number> = {
  faq: 1.18,
  website_page: 1.12,
  product: 1.12,
  service: 1.1,
  catalog_page: 1.05,
  legal_document: 1.0,
  website_doc: 1.0,
  website_tool: 0.98,
  announcement: 0.92,
  // A moderator-verified community answer may fill a gap the official pages do not cover, but it is
  // never allowed to outrank a page that documents the product itself. See
  // src/community/community-knowledge.ts for how (and how narrowly) these sources are created.
  community_solution: 0.94,
};

/** Words too generic to prove a chunk is about what the customer asked. */
const GENERIC_TERMS = new Set([
  'hosting', 'host', 'cloud', 'server', 'servers', 'service', 'services', 'plan', 'plans',
  'price', 'prices', 'pricing', 'cost', 'costs', 'fee', 'fees', 'cheap', 'cheapest',
  'much', 'many', 'need', 'want', 'offer', 'offers', 'provide', 'provides', 'available',
  'get', 'use', 'make', 'find', 'manage', 'know', 'tell', 'give', 'show', 'help',
  'support', 'supported', 'provide', 'offering', 'solution', 'solutions', 'thing', 'things',
  'option', 'options', 'kind', 'kinds', 'type', 'types', 'please', 'thanks', 'hello',
  // Temporal filler: "next month" is not a subject, however rare the words are in the corpus.
  'next', 'last', 'month', 'months', 'day', 'days', 'week', 'weeks', 'year', 'years',
  'today', 'tomorrow', 'yesterday', 'now', 'currently', 'still', 'ever', 'monthly', 'yearly',
]);

export interface RetrieveOptions {
  limit?: number;
  pageLimit?: number;
  /** Previous customer turn, used only for a short follow-up. */
  previousCustomerMessage?: string | null;
  /** Restrict to these document kinds. */
  kinds?: WebsiteSourceKind[];
  /** Skip the followup merge (used when a question stands alone mid-conversation). */
  standalone?: boolean;
  /**
   * The subject words a page must declare to be usable as evidence. Defaults to the question's own
   * `strictTokens`; tests override it to exercise the anchoring rule without a database.
   */
  subjectTerms?: readonly string[];
}

/**
 * The share of a question's subject words that must appear on the page offered as evidence.
 *
 * A question built from several subject words is making a claim that those words belong together. If
 * the page that won does not even contain most of them, the words matched *different* things and the
 * page is unrelated: "mobile phone plan" won Email Hosting by matching "mobile" alone, because the
 * site says "mobile clients" in a paragraph about webmail and "phone support" on another page
 * entirely. Half of the question was never covered, and the answer was still delivered confidently.
 *
 * Require more than half the non-scaffolding subject words unless the page title or a specifically
 * named offering anchors the question. This lexical guard is not a semantic relevance certificate;
 * regression queries must cover both unsupported subjects and real page-specific questions.
 */
export const MIN_SUBJECT_COVERAGE = 0.5;

/**
 * How much of `terms` a set of chunks covers, by whole-word membership, as a fraction.
 * Whole words only: `foldText` output is space-separated, so substring tests would let "sit" match
 * "site" and "call" match "callback", which is the class of accidental overlap this guards against.
 */
export function subjectCoverage(chunks: RetrievedChunk[], terms: readonly string[]): number {
  if (terms.length === 0) return 1;
  const words = new Set(
    foldText(chunks.map((chunk) => `${chunk.pageTitle} ${chunk.title} ${chunk.content} ${chunk.keywords.join(' ')}`).join(' '))
      .split(' ')
      .filter(Boolean)
  );
  return terms.filter((term) => words.has(term)).length / terms.length;
}

/**
 * Does the winning page's own *title* use one of these words? A page titled "SSL Certificates" is
 * about SSL even when it never writes the word "free", so a modifier the page does not use must not
 * count as missing coverage.
 */
export function titleDeclaresTerm(chunks: RetrievedChunk[], terms: readonly string[]): boolean {
  const words = new Set(
    foldText(chunks.map((chunk) => `${chunk.pageTitle} ${chunk.title}`).join(' ')).split(' ').filter(Boolean)
  );
  return terms.some((term) => words.has(term));
}

/**
 * Did the customer *name* an offering, specifically enough for it to explain their question?
 *
 * The coherence check above is skipped for such questions, because the offering supplies the
 * relationship between the words. The override has to be narrow, though: every offering carries short
 * generic aliases, and matching one is not naming the offering. The `billing` entity lists `card` as an
 * alias, so "sim card" resolved an offering and slipped through the check — a customer asking about a
 * SIM card was answered from billing pages. A name counts as specific when it is a multi-word phrase
 * present in the question, or a single word of five characters or more. `cpanel`, `uptime` and
 * `firewall` qualify; `card` does not.
 */
export function namesSpecificOffering(
  entities: readonly ServiceEntity[],
  subjectTerms: readonly string[],
  rawQuestion: string
): boolean {
  const foldedQuestion = ` ${foldText(rawQuestion)} `;
  const terms = new Set(subjectTerms.map((term) => foldText(term)));
  return entities.some((entity) => {
    if (!entity.route) return false;
    return entity.aliases.some((alias) => {
      const folded = foldText(alias);
      if (!folded) return false;
      if (folded.includes(' ')) return foldedQuestion.includes(` ${folded} `);
      return folded.length >= 5 && terms.has(folded);
    });
  });
}

/** Deterministic reranker. Exported so the arithmetic can be unit-tested directly. */
export function rerank(
  rows: RetrievalRow[],
  understanding: QueryUnderstanding,
  options: { terms: readonly string[]; strictTerms?: readonly string[] } = { terms: [] }
): RetrievedChunk[] {
  /**
   * Terms split into two classes, and the distinction matters:
   *
   *   • `strictTerms` are the words the customer actually used. Missing one of these is real negative
   *     evidence — if you ask about "kubernetes" and a page never says it, that page is not the answer.
   *   • everything else (synonyms, expansions, the aliases of a resolved offering) is a *boost only*.
   *     A page must never be punished for failing to contain a word the customer did not write, or the
   *     generic "hosting" entity's alias list would disqualify every page that is not about shared
   *     hosting.
   */
  const strict = new Set((options.strictTerms ?? understanding.strictTokens ?? understanding.correctedTokens).map((term) => foldText(term)));
  const terms = [...new Set([
    ...understanding.tokens,
    ...understanding.correctedTokens,
    ...understanding.expansions,
    ...options.terms,
  ].map((term) => foldText(term)).filter((term) => term.length >= 2))];

  const questionFolded = foldText(understanding.raw);
  const entityLabels = understanding.entities.map((entity) => entity.label.toLowerCase());
  // The curated vocabulary already knows which page *owns* an offering (SERVICE_ENTITIES.route).
  // When a question resolves to an offering, its canonical page is by definition the best evidence
  // for it — that is how "do you support cPanel" reaches /hosting/cpanel instead of whichever
  // developer document happens to mention cPanel first.
  const entityRoutes = new Set(understanding.entities.map((entity) => entity.route));

  /**
   * Term specificity, measured from the retrieved candidate set.
   *
   * A term that appears on half the site ("hosting") says almost nothing about which page answers a
   * question; a term that appears on one page ("kubernetes") says almost everything. This is computed
   * from the rows actually returned — no corpus-wide statistics are needed, and it self-calibrates as
   * the site changes, which matters because a fixed stopword list cannot know that "kubernetes" is
   * new and only on one page.
   */
  const documentFrequency = new Map<string, number>();
  {
    const perTerm = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = row.source_url || row.source_id;
      const haystack = foldText(`${row.page_title ?? ''} ${row.title ?? ''} ${row.content ?? ''} ${(row.keywords ?? []).join(' ')}`);
      for (const term of terms) {
        if (!haystack.includes(term)) continue;
        const set = perTerm.get(term) ?? new Set<string>();
        set.add(key);
        perTerm.set(term, set);
      }
    }
    // Candidate-set frequency, scaled so a term that appears on a single page still reads as rare
    // even when the candidate set is short. Capping at 30 pages keeps the measure stable when the
    // query happens to return very few rows: "kubernetes" on 1 of 3 candidates is still unique to that
    // page, and must not be diluted to 0.33 by the size of the candidate list.
    const pageCount = Math.max(30, new Set(rows.map((row) => row.source_url || row.source_id)).size);
    for (const [term, set] of perTerm) documentFrequency.set(term, set.size / pageCount);
  }
  /** 1 for a term unique to one candidate page, ~0 for a term on every page. */
  const specificityOf = (term: string): number => {
    if (GENERIC_TERMS.has(term)) return 0.25;
    const df = documentFrequency.get(term) ?? 0;
    return Math.max(0.1, Math.min(1, 1 - df));
  };
  const totalSpecificity = terms.reduce((sum, term) => sum + specificityOf(term), 0) || 1;

  const scored = rows.map((row) => {
    // Rows are defensive: a retrieval that throws because one row lacks a column takes the whole
    // assistant down, and an index with a single malformed chunk is a normal condition to survive.
    const title = foldText(`${row.page_title ?? ''} ${row.title ?? ''}`);
    const body = foldText(row.content ?? '');
    const keywords = new Set((row.keywords ?? []).map((keyword) => foldText(keyword)));
    const rank = Number(row.rank ?? 0);

    let score = 0;
    let matched = 0;
    let distinctiveMatched = 0;
    let matchedSpecificity = 0;
    for (const term of terms) {
      const weight = specificityOf(term);
      // Each term contributes once, at the strength of the best place it was found. Counting a term
      // once per field rewarded long pages that merely repeat the question's words, which is how a
      // ten-chunk marketing page used to outrank the one page that actually answered.
      const inTitle = title.includes(term);
      const inKeywords = keywords.has(term);
      const inBody = body.includes(term);
      if (!inTitle && !inKeywords && !inBody) continue;
      const fieldWeight = inTitle ? 3.2 : inKeywords ? 2.4 : 1;
      score += fieldWeight * (0.35 + weight) * 3;
      matched += 1;
      matchedSpecificity += weight;
      if (!GENERIC_TERMS.has(term)) distinctiveMatched += 1;
    }

    // The page's own title is the strongest single statement about what the page is for: "PHP
    // Hosting" is a page about PHP hosting. Weighting it above incidental body mentions is what
    // keeps a hosting question out of a developer-runtime article that happens to say "hosting".
    const pageTitleFolded = foldText(row.page_title ?? row.source_title ?? '');
    const pageTitleWords = new Set(pageTitleFolded.split(' ').filter(Boolean));
    for (const term of terms) {
      if (!pageTitleWords.has(term)) continue;
      score += (GENERIC_TERMS.has(term) ? 1.5 : 4.5 * specificityOf(term)) * 0.8;
    }

    // Negative evidence: a question that names no offered topic rarely has an answer on the site.
    // "weather forecast" must not be answered by whichever page happens to contain "next month".
    let unknownSpecificity = 0;
    let totalSpecificityLocal = 0;
    for (const term of terms) {
      if (!strict.has(term)) continue;
      // A word the *customer wrote* that appears nowhere in the candidate set is strong evidence
      // against this page — and, when it appears nowhere in the corpus at all, evidence that the site
      // does not cover the subject. An abbreviation or synonym we expanded ourselves ("wp" →
      // "wordpress") is a boost, never a requirement, and is excluded from `strict` already.
      const weight = specificityOf(term);
      totalSpecificityLocal += weight;
      if (!keywords.has(term) && !title.includes(term) && !body.includes(term)) unknownSpecificity += weight;
    }
    // Applied at the end (see below), so that no additive bonus — an entity route, a title match —
    // can buy its way past a word the customer actually wrote and the page does not contain.

    // Coverage of the *distinctive* part of the question, not of its filler.
    // Coverage weighted by how much each matched term actually discriminates. Answering "managed
    // kubernetes hosting" by matching only "hosting" is not coverage — the specific word is the
    // question.
    const coverage = terms.length > 0 ? matched / terms.length : 0;
    const distinctiveCoverage = distinctiveMatched / Math.max(1, terms.filter((term) => !GENERIC_TERMS.has(term)).length);
    const weightedCoverage = totalSpecificity > 0 ? matchedSpecificity / totalSpecificity : 0;
    score += coverage * 2 + distinctiveCoverage * 3 + weightedCoverage * 45;

    if (row.source_url && entityRoutes.has(row.source_url)) score += 15;

    // Position on the page is evidence of purpose. The opening chunk of a page is its summary; a
    // deep FAQ chunk is a corollary. For a "where/how do I …" question the opening is what answers
    // it, so later chunks are damped — otherwise a product page's tenth FAQ ("how do I cancel
    // hosting?") outranks the page's own statement of what it is.
    if (row.chunk_index > 0) {
      const damp = understanding.intent === 'navigation' || understanding.intent === 'how_to' ? 0.55 : 0.85;
      score *= 1 - Math.min(0.25, row.chunk_index * (1 - damp) * 0.25);
    }

    // Named offerings are the strongest single signal a question carries.
    for (const entity of understanding.entities) {
      const label = entity.label.toLowerCase();
      if (title.includes(label)) score += 7;
      else if (body.includes(label)) score += 2.5;
    }

    // A FAQ whose question is essentially the customer's question is the best possible evidence.
    const rowTitle = foldText(row.title ?? '');
    const exactAnswer =
      (row.source_kind === 'faq' || row.title !== row.page_title) &&
      rowTitle.length > 8 &&
      questionFolded.length > 8 &&
      (rowTitle.includes(questionFolded) || questionFolded.includes(rowTitle) || similarity(rowTitle, questionFolded) > 0.72);
    if (exactAnswer) score += 12;

    score += Math.min(6, rank * 12);
    score *= KIND_PRIOR[row.source_kind ?? 'website_page'] ?? 1;

    // Document kind must follow the question. A policy answers "what does the refund policy say";
    // it is a bad answer to "how do I register a domain" even though it contains every keyword.
    // Developer documentation answers "how do I deploy"; it is a bad answer to "do you support
    // cPanel" when a product page exists.
    const commercial = understanding.intent === 'availability'
      || understanding.intent === 'definition'
      || understanding.intent === 'pricing'
      || understanding.intent === 'general';
    if (row.source_kind === 'legal_document' && (understanding.intent === 'how_to' || commercial)) score *= 0.55;
    if (row.source_kind === 'website_doc' && (understanding.intent === 'availability' || understanding.intent === 'definition' || understanding.intent === 'pricing')) score *= 0.7;
    if (understanding.intent === 'definition' && row.source_kind === 'faq') score *= 1.05;

    // Negative evidence is applied last, and multiplicatively. A page that never mentions the
    // specific word the customer used is not the answer, however many bonuses it collected.
    if (totalSpecificityLocal > 0) {
      score *= Math.max(0, 1 - (unknownSpecificity / totalSpecificityLocal) * 1.15);
    }

    // Never let an empty-scan row win: a row reached only by the keyword-array leg with zero term
    // overlap is noise.
    if (matched === 0 && entityLabels.length === 0) score = 0;

    return {
      sourceId: row.source_id,
      sourceKey: (row as { source_key?: string | null }).source_key ?? null,
      url: row.source_url || row.url || '',
      title: row.title ?? row.page_title ?? '',
      pageTitle: row.page_title ?? row.source_title ?? '',
      section: row.section,
      kind: (row.source_kind ?? 'website_page') as WebsiteSourceKind,
      content: row.content,
      keywords: row.keywords ?? [],
      score: Math.round(score * 1000) / 1000,
      exactAnswer,
    };
  });

  return scored.filter((chunk) => chunk.score > 0).sort((a, b) => b.score - a.score);
}

/** Normalised similarity of two folded strings, cheap and symmetric. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  let intersection = 0;
  for (const word of wordsA) if (wordsB.has(word)) intersection += 1;
  return (2 * intersection) / (wordsA.size + wordsB.size);
}

/** Groups chunks by page, keeping the three strongest per page. */
export function groupByPage(chunks: RetrievedChunk[], pageLimit = 4): RetrievalResult['pages'] {
  const pages = new Map<string, RetrievalResult['pages'][number]>();
  for (const chunk of chunks) {
    const key = chunk.url || chunk.sourceId;
    const existing = pages.get(key);
    if (!existing) {
      pages.set(key, { url: chunk.url, title: chunk.pageTitle || chunk.title, kind: chunk.kind, score: chunk.score, chunks: [chunk] });
      continue;
    }
    // Additional evidence raises the page's standing, with diminishing returns: the third relevant
    // chunk should refine the ranking, never let a long page swamp a precise short one.
    existing.score += chunk.score * (existing.chunks.length === 1 ? 0.3 : 0.12);
    if (existing.chunks.length < 3) existing.chunks.push(chunk);
  }
  const ranked = [...pages.values()]
    .map((page) => {
      page.chunks.sort((a, b) => b.score - a.score);
      const head = page.chunks[0];
      if (head) head.pageScore = page.score;
      return page;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, pageLimit));
  return ranked;
}

/**
 * The retrieval entry point used by the answer pipeline.
 */
export async function retrieveKnowledge(
  db: Queryable,
  question: string,
  options: RetrieveOptions = {}
): Promise<RetrievalResult> {
  const vocabulary = websiteVocabulary();
  const understanding = understandQuery(question, {
    vocabulary,
    // The previous customer turn is only ever used to resolve a pronoun or a bare follow-up; it
    // never contributes to the query terms used for scoring beyond `retrievalQueryFor`.
    previousQuery: options.previousCustomerMessage ?? null,
  });
  const effectiveQuery = options.standalone
    ? [...understanding.correctedTokens, ...understanding.expansions].join(' ')
    : retrievalQueryFor(understanding, options.previousCustomerMessage ?? null);

  // A resolved offering contributes its own vocabulary to the query. "Where can I manage my
  // hosting?" resolves to the customer account, so the account destinations are searched too —
  // without this, the words "manage" and "hosting" only ever match product pages.
  const unavailable = (verificationFailure: KnowledgeFailure): RetrievalResult => ({
    understanding, effectiveQuery, chunks: [], pages: [], entities: understanding.entities,
    empty: true, verificationFailure,
    trustTrace: { retrieved: [], selected: [], sources: [], conflicts: [], outcome: 'unavailable', escalationReason: verificationFailure },
  });
  try {
    if (!await knowledgeIndexReady(db)) return unavailable('INDEX_NOT_READY');
  } catch {
    return unavailable('INDEX_STATUS_UNAVAILABLE');
  }

  const entityTerms = understanding.entities
    .slice(0, 2)
    .flatMap((entity) => [entity.label, ...entity.aliases.slice(0, 4)]);
  const terms = [...new Set([
    ...understanding.correctedTokens,
    ...understanding.expansions,
    ...entityTerms,
    ...effectiveQuery.split(/\s+/),
  ].map((term) => foldText(term)).filter((term) => term.length >= 2))];

  const tsQuery = toTsQueryBody(terms);
  const keywords = [...new Set(understanding.correctedTokens.map(foldText).filter((term) => term.length >= 3))];

  let rows: RetrievalRow[] = [];
  try {
    rows = await searchChunks(db, { tsQuery, keywords, limit: options.limit ?? 60, kinds: options.kinds });
  } catch {
    // Do not turn an operational failure into a claim about absent website content.
    return unavailable('SEARCH_UNAVAILABLE');
  }

  // Exact product/page-name match: the database's language configuration stems and stops words, so
  // "WordPress" and "wordpress hosting" can score oddly for a two-word question. One deterministic
  // title lookup fixes the commonest real case at trivial cost.
  const titleCandidates = [understanding.raw.trim(), understanding.entities[0]?.label ?? '']
    .map((candidate) => candidate.replace(/^(?:what|where|how|do you|can i|is|are)\s+/i, '').trim())
    .filter((candidate) => candidate.length >= 3 && candidate.length <= 60);
  for (const candidate of titleCandidates) {
    try {
      const exact = await findChunksByTitle(db, candidate, 6);
      if (exact.length > 0) rows = [...rows, ...exact];
    } catch {
      // An incomplete candidate set is not a verified answer, even if one leg succeeded.
      return unavailable('SEARCH_UNAVAILABLE');
    }
  }

  // Deduplicate by chunk id (a row can arrive from both legs).
  const seen = new Set<string>();
  const unique = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });

  const reranked = rerank(unique, understanding, {
    terms,
    strictTerms: understanding.strictTokens,
  });

  // Coverage check: if the customer's central word appears nowhere on the site, no amount of
  // incidental overlap makes an answer honest. "Can you forecast the weather next month?" shares
  // "next" and "month" with a support page; that is not an answer.
  //
  // The comparison is against the corpus vocabulary, *not* against `terms`. `terms` is built from
  // the customer's own tokens, so comparing an ungrounded token against it always succeeds and the
  // guard could never fire — which is exactly what happened: "policy on interstellar travel"
  // quoted /legal with confidence, and "mobile phone plan" quoted Email Hosting.
  const ungrounded = (understanding.ungroundedTokens ?? []).filter((token) => token.length >= 4);
  if (ungrounded.length > 0) {
    const missing = ungrounded.filter((token) => !vocabulary.has(token));
    if (missing.length >= Math.max(1, Math.ceil(ungrounded.length / 2))) {
      return {
        understanding,
        effectiveQuery,
        chunks: [],
        pages: [],
        entities: understanding.entities,
        empty: true,
        ungroundedTerms: missing,
        trustTrace: { retrieved: [...new Set(unique.map(r => r.source_id))], selected: [], sources: [], conflicts: [], outcome: 'no_match', escalationReason: null },
      };
    }
  }
  const useful = reranked.filter((chunk) => chunk.score >= MIN_USEFUL_SCORE);
  // Trust is applied to relevant evidence before it can reach any composer/model.
  let trustTrace: TrustTrace;
  try {
    trustTrace = await assessRetrievedSources(db, [...new Set(useful.map(c => c.sourceId))]);
  } catch {
    return unavailable('TRUST_METADATA_UNAVAILABLE');
  }
  if (trustTrace.escalationReason) {
    const failure = trustTrace.outcome === 'conflict' ? 'SOURCE_CONFLICT'
      : trustTrace.outcome === 'unavailable' ? 'TRUST_METADATA_UNAVAILABLE' : 'SOURCE_NOT_CURRENT';
    return { ...unavailable(failure), trustTrace };
  }
  const chunks = useful.filter(c => trustTrace.selected.includes(c.sourceId)).slice(0, options.limit ?? 24);
  const pages = groupByPage(chunks, options.pageLimit ?? 4);

  // Subject coverage (see `subjectCoverage`). When the page that won does not even contain most of
  // what the customer asked about, the question's words matched unrelated pages and nothing on the
  // site answers it. Measured on the *winning page*, not on the whole candidate set: across twenty
  // chunks every word appears somewhere, which is exactly the accident that produced the bad answer.
  //
  // Skipped when the question names a specific offering: there the offering supplies the relationship
  // between the words and the customer is legitimately combining it with a modifier ("cPanel license",
  // "uptime SLA" — real questions whose second word the page never uses).
  const namedOffering = namesSpecificOffering(
    understanding.entities,
    options.subjectTerms ?? understanding.strictTokens ?? [],
    understanding.raw
  );
  if (!namedOffering && pages.length > 0) {
    // Acceptance is an intent-bearing relationship (accepting a payment method), not just filler.
    const subjectTerms = [...new Set(
      (options.subjectTerms ?? understanding.strictTokens ?? [])
        .map((term) => foldText(term))
        .filter((term) => term.length >= 3 && !GENERIC_TERMS.has(term) && (!QUESTION_SCAFFOLDING.has(term) || term === 'accept' || term === 'accepted'))
    )];
    const best = pages[0]!.chunks;
    const covered = subjectCoverage(best, subjectTerms);
    // Two ways to be *about* the question. Either the page covers most of the words, or its own title
    // names one of them — which is what separates "free ssl" (page titled SSL Certificates, and no page
    // needs to say "free") from "mobile phone plan" (Email Hosting, whose title names neither word).
    const titled = titleDeclaresTerm(best, subjectTerms);
    if (subjectTerms.length > 0 && (covered === 0 || (subjectTerms.length >= 2 && covered <= MIN_SUBJECT_COVERAGE)) && !titled) {
      return {
        understanding,
        effectiveQuery,
        chunks: [],
        pages: [],
        entities: understanding.entities,
        empty: true,
        ungroundedTerms: subjectTerms,
        trustTrace: { ...trustTrace, selected: [], outcome: 'no_match' },
      };
    }
  }

  return {
    understanding, effectiveQuery, chunks, pages,
    entities: understanding.entities, empty: pages.length === 0, trustTrace,
  };
}

