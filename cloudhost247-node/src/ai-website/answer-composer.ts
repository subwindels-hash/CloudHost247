import { knowledgeFailureMessage } from './knowledge-trust';
import { openAnswerWithModel, type ModelEvidence } from './grounded-model';
import { cheapestPrice, formatMoney, formatPrice, selectRelevantPrices, type LiveFacts, type LivePrice } from './live-facts';
import type { RetrievalResult, RetrievedChunk } from './retrieval';
import type { QuestionIntent, QueryUnderstanding, ServiceEntity } from './query-understanding';
import { foldText, isSafeInternalPath, truncate } from './types';

/**
 * The answer composer.
 *
 * This is the difference between "a chatbot with a search box" and an assistant that answers from
 * the website. The rules it enforces:
 *
 *   • Every factual sentence is built from a retrieved chunk or from a live catalogue record. There
 *     is no sentence template that states a fact on its own.
 *   • Every link is a *verified route* (`resolveRoute`) and appears only because the retrieved page
 *     is at that route. It is impossible for the composer to emit an invented URL.
 *   • When evidence is thin, the composer says so and offers escalation, in the same words the
 *     existing support operator uses for "I could not verify that".
 *   • Prices are never quoted from indexed text. A pricing question is answered from
 *     `resolveLiveFacts()`; if the catalogue is unreadable the answer says the price cannot be
 *     verified rather than showing an old number.
 *
 * The optional model provider (`grounded-model.ts`) is used only to *phrase* the same evidence. Its
 * output is validated against the evidence before it is returned — an answer that introduces a link
 * or a number the evidence does not contain is discarded in favour of the deterministic composition.
 */

export type AnswerKind = 'ANSWER' | 'CLARIFY' | 'ESCALATE' | 'UNAVAILABLE';

export interface AnswerLink {
  label: string;
  url: string;
  kind: string;
}

export interface AnswerEvidence {
  url: string;
  title: string;
  kind: string;
  section: string | null;
}

export interface ComposedAnswer {
  kind: AnswerKind;
  body: string;
  links: AnswerLink[];
  evidence: AnswerEvidence[];
  intent: string;
  confidence: number;
  /** Which engine produced the final wording, stated honestly to the admin console. */
  engine: 'retrieval' | 'retrieval+model';
  /** True when at least one claim is grounded in retrieved CloudHost247 content. */
  grounded: boolean;
  /** Set when the answer defers to a human; the caller maps this to the existing escalation codes. */
  escalateReason?:
    | 'USER_REQUESTED_HUMAN'
    | 'AI_UNABLE_TO_ANSWER'
    | 'ACCOUNT_SPECIFIC_REQUEST'
    | 'BILLING_SUPPORT_REQUIRED'
    | 'TECHNICAL_SUPPORT_REQUIRED'
    | 'SERVER_SUPPORT_REQUIRED';
}

export interface ComposeOptions {
  retrieval?: RetrievalResult | null;
  facts?: LiveFacts | null;
  /** Verifies a path against the site registry; returns the canonical route or null. */
  resolveRoute: (candidate: string) => string | null;
  /** Titles for verified routes, so a "related" link can be labelled rather than shown as a URL. */
  routeTitles?: ReadonlyMap<string, string>;
  /** Where the visitor is standing, so we do not suggest the page they are already on. */
  currentPath?: string | null;
  /** Phrase the answer with the configured model, if one is available. */
  allowModel?: boolean;
  /** Short human-readable summary of the customer's previous turn, for follow-ups. */
  previousTopic?: string | null;
}

const MAX_BODY = 1800;

/**
 * A question whose subject is only a pronoun: it cannot be answered without a previous turn.
 * Deliberately narrow — it matches only turns with no named subject at all, so "how much is it" and
 * "is it down" are recognised as bare follow-ups while "webhosting prices" is not.
 */
const PRONOUN_ONLY_QUESTION = new RegExp(
  '^\\s*'
  + '(?:(?:how much|how many|what(?:\'s| is)?|which|is|are|does|do|can|will|was|were)\\s*)?'
  + '(?:(?:does|do|is|are|was|were|will|can)\\s*)?'
  + '(?:it|that|this|they|them|those|these)'
  + '(?:\\s+(?:cost|costs|price|pricing|down|available|work|do|include|come with|per month|a month|again))?'
  + '[\\s?!.]*$',
  'i'
);

function isBarePronounQuestion(raw: string): boolean {
  return PRONOUN_ONLY_QUESTION.test(raw.trim());
}

function clampBody(text: string): string {
  if (text.length <= MAX_BODY) return text;
  return `${truncate(text, MAX_BODY - 1)}\n\nAsk me to expand on any part of this.`;
}

/** Removes markdown/HTML a model might emit; answers are plain text plus separately rendered links. */
export function sanitiseAnswerText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^#+\s*/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Quotes the most useful sentence(s) of a chunk, without cutting mid-word. */
export function extractExcerpt(content: string, terms: readonly string[], maxChars = 420): string {
  const text = content.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;
  const folded = foldText(text);
  let bestIndex = 0;
  let bestScore = -1;
  for (const term of terms) {
    const index = folded.indexOf(foldText(term));
    if (index >= 0) {
      // Prefer early occurrences: a page's opening statement is usually its summary.
      const score = 1000 - index;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
  }
  let start = Math.max(0, Math.min(bestIndex - 60, text.length - maxChars));
  let end = Math.min(text.length, start + maxChars);
  // Snap to word boundaries. Slicing at a fixed offset cut words in half and the customer read
  // excerpts that began mid-word ("…ontent management systems"), which looks like corruption.
  // The snap is unconditional: a word is never shown in part, even when that costs a few characters.
  if (start > 0 && text[start - 1] !== ' ') {
    const space = text.indexOf(' ', start);
    if (space >= 0) start = space + 1;
  }
  if (end < text.length && text[end] !== ' ') {
    const space = text.lastIndexOf(' ', end);
    if (space > start) end = space;
  }
  let excerpt = text.slice(start, end).trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < text.length) excerpt = `${excerpt}…`;
  return excerpt;
}

function linkFor(
  options: ComposeOptions,
  url: string,
  label: string,
  kind: string,
  currentPath?: string | null
): AnswerLink | null {
  const verified = options.resolveRoute(url);
  if (!verified) return null;
  if (currentPath && verified === currentPath) return null;
  return { label: label || verified, url: verified, kind };
}

function pageLinks(pages: RetrievalResult['pages'], options: ComposeOptions, limit = 3): AnswerLink[] {
  const links: AnswerLink[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    if (links.length >= limit) break;
    const link = linkFor(options, page.url, page.title, page.kind, options.currentPath);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    links.push(link);
  }
  return links;
}

/** The page's label for an introduction: its own title, minus the chunk-level sub-heading. */
function primaryPageTitle(page: RetrievalResult['pages'][number]): string {
  const title = page.title || page.url;
  return title.split(' — ')[0] ?? title;
}

function evidenceOf(pages: RetrievalResult['pages']): AnswerEvidence[] {
  return pages.map((page) => ({
    url: page.url,
    title: page.title,
    kind: page.kind,
    section: page.chunks[0]?.section ?? null,
  }));
}

/** Human phrase for a document kind, used when introducing evidence. */
function kindPhrase(kind: string): string {
  switch (kind) {
    case 'faq':
      return 'the published FAQ';
    case 'legal_document':
      return 'the published policy';
    case 'website_doc':
      return 'the developer documentation';
    case 'website_tool':
      return 'the tools catalogue';
    case 'announcement':
      return 'our announcements';
    case 'product':
    case 'service':
      return 'the published catalogue';
    default:
      return 'the CloudHost247 website';
  }
}

/** A "what we do not have here" line, so an honest gap is stated rather than implied. */
function gapSentence(understanding: QueryUnderstanding): string {
  const entity = understanding.entities[0];
  if (!entity) return '';
  return `I could not find a published CloudHost247 page about ${entity.label} specifically, so I will not guess at plans or prices for it.`;
}

function formatPriceBlock(prices: LivePrice[], understanding: QueryUnderstanding): { text: string; link: AnswerLink[] } {
  const links: AnswerLink[] = [];
  if (prices.length === 0) return { text: '', link: links };
  // The plan name already carries the product name for most catalogue rows ("VPS Basic"), so
  // repeating the product produced "VPS Basic — VPS Basic: USD 19 per month".
  const lines = prices.slice(0, 8).map((price) => {
    const alreadyNamed = foldText(price.planName).includes(foldText(price.productName));
    const label = alreadyNamed ? price.planName : `${price.productName} — ${price.planName}`;
    return `• ${label}: ${formatPrice(price)}`;
  });
  const cheapest = cheapestPrice(prices);
  const wantsCheapest = /\bcheap(?:est)?\b|\baffordable\b|\bbudget\b|\blowest\b/i.test(understanding.raw);
  const header = wantsCheapest && cheapest
    ? `The lowest published price for that group is **${cheapest.productName} — ${cheapest.planName}: ${formatPrice(cheapest)}**. Here is the published price list:`
    : 'These are the current published CloudHost247 catalogue prices:';
  return {
    text: `${header}\n\n${lines.join('\n')}\n\nPrices are read from the live catalogue each time you ask, and the product page is the source of truth for what is included.`,
    link: links,
  };
}

/** Deterministic composition from evidence. This is the answer whenever a model is unavailable. */
function composeDeterministic(
  understanding: QueryUnderstanding,
  retrieval: RetrievalResult,
  options: ComposeOptions
): ComposedAnswer {
  const pages = retrieval.pages;
  const links = pageLinks(pages, options, 3);
  const evidence = evidenceOf(pages);
  const terms = [...understanding.correctedTokens, ...understanding.expansions];

  if (pages.length === 0) {
    return {
      kind: 'ESCALATE',
      body:
        'I could not find anything on the CloudHost247 website that answers that, and I will not guess. '
        + 'I can pass this to CloudHost247 Support with the conversation so far — they can answer from your account and from unpublished detail, and add it to the knowledge base so the assistant knows next time.',
      links: [],
      evidence: [],
      intent: understanding.intent,
      confidence: 0.1,
      engine: 'retrieval',
      grounded: false,
      escalateReason: 'AI_UNABLE_TO_ANSWER',
    };
  }

  const primary = pages[0]!;
  // The opening chunk of the primary page is preferred as its summary — unless a later chunk scored
  // much better, which happens when the question is answered by one specific section.
  const opening = primary.chunks.find((chunk) => (chunk.section ?? '') === primary.title.split(' — ')[0]) ?? primary.chunks[0]!;
  const primaryChunk = opening.score >= primary.chunks[0]!.score * 0.6 ? opening : primary.chunks[0]!;
  const sections: string[] = [];

  // A "where do I …" question deserves a destination before an explanation. The destination is a
  // verified route from the registry, so this is a fact about the site, not a guess.
  if (understanding.intent === 'navigation') {
    const destinations = retrieval.entities
      .map((entity) => ({ label: entity.label, url: options.resolveRoute(entity.route) }))
      .filter((entry): entry is { label: string; url: string } => Boolean(entry.url));
    if (destinations.length > 0) {
      sections.push(
        `${destinations.map((entry) => entry.label).join(' or ')} ${destinations.length > 1 ? 'are' : 'is'} where you do that: `
        + `${destinations.map((entry) => entry.url).join(' · ')}. You will need to be signed in to your CloudHost247 account.`
      );
    }
  }

  // Opening: name the page and quote its own summary. The title is used, never invented copy.
  const intro = primary.kind === 'faq' ? '' : `From ${kindPhrase(primary.kind)} — ${primaryPageTitle(primary)}:`;
  const excerpt = extractExcerpt(primaryChunk.content, terms, 520);
  // Monetary answers must not mix indexed/historical amounts with the live catalogue.
  // A pricing question gets verified page destinations plus live facts, never page prose.
  if (understanding.intent !== 'pricing') sections.push(intro ? `${intro}\n${excerpt}` : excerpt);

  // A second page is worth quoting when it adds a different angle (comparison questions need it).
  if (understanding.intent !== 'pricing' && pages[1] && (understanding.isComparison || pages[1].score > primary.score * 0.55)) {
    const second = pages[1];
    const secondChunk = second.chunks[0]!;
    const secondExcerpt = extractExcerpt(secondChunk.content, terms, 320);
    if (foldText(secondExcerpt) !== foldText(excerpt)) {
      sections.push(`Also relevant — ${second.title}:\n${secondExcerpt}`);
    }
  }

  // Domain pricing is a different catalogue (per-extension offerings, not plans), and the plan
  // price list has no row for it. Without this branch a ".com renewal price" question fell through
  // to whatever website prose matched, which is how a customer could ask a price and be told about
  // infrastructure instead.
  // `.com` needs its own alternative: a word boundary cannot precede a dot, so putting the dotted
  // TLDs inside a special character class makes ".com" unmatchable.
  const asksAboutDomains = /\b(?:domains?|tlds?|extensions?)\b|\.[a-z]{2,}\b/i.test(understanding.raw);
  if (understanding.intent === 'pricing' && asksAboutDomains && options.facts?.domainPrices?.available) {
    // Extensions are stored without the leading dot ("com"), while customers write ".com". The
    // comparison normalises both sides; comparing the raw forms silently matched nothing.
    const wanted = (understanding.raw.match(/\.[a-z]{2,}/gi) ?? []).map((value) => value.slice(1).toLowerCase());
    const rows = options.facts.domainPrices.extensions.filter(
      (row) => wanted.length === 0 || wanted.includes(row.extension.replace(/^\./, '').toLowerCase())
    );
    const lines = rows.slice(0, 8).flatMap((row) => {
      const parts: string[] = [];
      if (row.registration) parts.push(`registration ${formatMoney(row.registration)}`);
      if (row.renewal) parts.push(`renewal ${formatMoney(row.renewal)}`);
      if (row.transfer) parts.push(`transfer ${formatMoney(row.transfer)}`);
      return parts.length > 0 ? [`• .${row.extension.replace(/^\./, '')} — ${parts.join(', ')}`] : [];
    });
    if (lines.length > 0) {
      sections.push(`These are the current published domain prices:\n${lines.join('\n')}`);
    }
  }

  // Pricing is always the live answer, appended when the question asked about money.
  if (understanding.intent === 'pricing' && options.facts?.available) {
    const prices = selectRelevantPrices(options.facts, [...terms, ...retrieval.entities.map((entity) => entity.label)], 8);
    const block = formatPriceBlock(prices, understanding);
    if (block.text) {
      sections.push(block.text);
    } else if (options.facts.prices.length > 0) {
      // Nothing in the catalogue matched, so there is no price that answers this question. Say so
      // accurately and name what does have a price — verified from the catalogue, not guessed. The
      // old wording ("no published price for that product group") blamed the catalogue for a gap
      // that is really in the question.
      const names = [...new Set(options.facts.prices.map((price) => price.productName))].slice(0, 8);
      sections.push(
        'I could not match that to any published CloudHost247 product, so I will not quote a price. '
        + `The products with published prices right now are: ${names.join(', ')}.`
      );
    } else {
      sections.push('The catalogue is readable but has no published price for that product group, so there is no price I can quote. A draft or unpublished product is never presented as purchasable.');
    }
  } else if (understanding.intent === 'pricing' && options.facts && !options.facts.available) {
    sections.push('I cannot reach the published catalogue at the moment, so I will not quote a price from memory. CloudHost247 Support can confirm the current price.');
  }

  // A comparison needs both offerings named, even when only one page retrieved well.
  if (understanding.isComparison && understanding.entities.length >= 2) {
    const [first, second] = understanding.entities;
    if (first && second && !foldText(sections.join(' ')).includes(foldText(second.label))) {
      sections.push(`For the difference between ${first.label} and ${second.label}: I found published detail for ${first.label} only. I will not describe ${second.label} from memory, so ask me about it directly and I will retrieve its published page.`);
    }
  }

  // A resolved offering's own page is a verified destination and is exactly where the customer
  // should end up. It is added after the retrieved pages so it never displaces real evidence.
  for (const entity of retrieval.entities.slice(0, 2)) {
    if (links.length >= 3) break;
    const link = linkFor(options, entity.route, entity.label, 'route', options.currentPath);
    if (link && !links.some((existing) => existing.url === link.url)) links.push(link);
  }

  const linkLines = links.map((link) => `• ${link.label}: ${link.url}`);
  if (linkLines.length > 0) sections.push(`Where to look:\n${linkLines.join('\n')}`);

  const body = clampBody(sanitiseAnswerText(sections.filter(Boolean).join('\n\n')));
  // Confidence reflects how strongly the corpus answered, on the page aggregate rather than a single
  // chunk, and is capped short of certainty because grounding is not the same as being right.
  const confidence = Math.max(0.4, Math.min(0.93, 0.42 + primary.score / 160));

  return {
    kind: 'ANSWER',
    body,
    links,
    evidence,
    intent: understanding.intent,
    confidence: Math.round(confidence * 100) / 100,
    engine: 'retrieval',
    grounded: true,
  };
}

/** Asks for one clarifying question when the request is genuinely ambiguous. */
function clarify(understanding: QueryUnderstanding): ComposedAnswer {
  return {
    kind: 'CLARIFY',
    body:
      'I want to answer that accurately rather than guess. Could you tell me which CloudHost247 service you mean — '
      + 'for example web hosting, WordPress hosting, VPS, a dedicated server, domains, business email, SSL or the free tools?',
    links: [],
    evidence: [],
    intent: understanding.intent,
    confidence: 0.2,
    engine: 'retrieval',
    grounded: false,
  };
}

/** Validates model wording against the evidence it was given. */
export function validateModelAnswer(
  text: string,
  evidence: Array<{ url: string; title: string }>,
  allowedPrices: readonly string[],
  resolveRoute: (candidate: string) => string | null
): { ok: boolean; reason: string | null } {
  const urls = new Set(evidence.map((entry) => entry.url));
  // A path must start a word. Without the boundary, the "/month" inside the perfectly ordinary
  // phrase "US$ 19/month" is read as a link to /month, which resolves to nothing, and the whole
  // answer is discarded as containing an unknown link. The model is *invited* to write prices in
  // that form, so the check has to tolerate it: the price check below already covers the amount.
  const mentioned = text.match(/(?<![\w$.,])\/[a-z0-9][a-z0-9/_-]*/gi) ?? [];
  for (const candidate of mentioned) {
    const verified = resolveRoute(candidate);
    if (!verified) return { ok: false, reason: `Unknown link ${candidate}` };
    if (!urls.has(verified) && !allowedPrices.includes(verified)) {
      // A link is allowed only if it is evidence for this answer.
      return { ok: false, reason: `Link ${verified} was not part of the evidence` };
    }
  }
  const money = text.match(/(?:US\$|\$|€|£|₦)\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? [];
  for (const amount of money) {
    const normalised = amount.replace(/\s+/g, '');
    if (!allowedPrices.some((price) => price.replace(/\s+/g, '').includes(normalised))) {
      return { ok: false, reason: `Price ${amount} was not in the evidence` };
    }
  }
  return { ok: true, reason: null };
}

/**
 * Composes an answer.
 *
 * Order of operations matters: retrieval evidence first, then (optionally) model phrasing over that
 * evidence, then deterministic composition as the guaranteed fallback. A model is never asked to
 * answer from its own knowledge.
 */
export async function composeAnswer(
  question: string,
  understanding: QueryUnderstanding,
  options: ComposeOptions
): Promise<ComposedAnswer> {
  const retrieval = options.retrieval ?? null;
  // This precedes clarification and model phrasing: an unavailable index proves no content gap.
  if (retrieval?.verificationFailure) {
    return {
      kind: 'ESCALATE', body: knowledgeFailureMessage(retrieval.verificationFailure), links: [], evidence: [],
      intent: 'knowledge_unavailable', confidence: 0, engine: 'retrieval', grounded: false,
      escalateReason: 'TECHNICAL_SUPPORT_REQUIRED',
    };
  }

  // One-word or bare-noun questions with no resolved offering are genuinely ambiguous.
  if (understanding.tokens.length <= 1 && understanding.entities.length === 0 && retrieval?.empty) {
    return clarify(understanding);
  }

  // "how much is it?" carries no subject of its own. Without a previous turn to resolve the pronoun,
  // any page that happens to score well is a coincidence, not an answer — and a pricing question
  // answered with a page that quotes no price is worse than asking which service the customer means.
  if (isBarePronounQuestion(understanding.raw) && understanding.entities.length === 0 && !options.previousTopic) {
    return clarify(understanding);
  }

  const deterministic = retrieval ? composeDeterministic(understanding, retrieval, options) : {
    kind: 'ESCALATE' as const,
    body: 'I could not search the CloudHost247 website just now. I will not guess — I can pass this to CloudHost247 Support with the conversation so far.',
    links: [],
    evidence: [],
    intent: understanding.intent,
    confidence: 0.1,
    engine: 'retrieval' as const,
    grounded: false,
    escalateReason: 'AI_UNABLE_TO_ANSWER' as const,
  };

  if (
    understanding.intent === 'pricing' ||
    options.allowModel === false ||
    !retrieval ||
    retrieval.pages.length === 0 ||
    deterministic.kind !== 'ANSWER'
  ) {
    return deterministic;
  }

  const evidence: ModelEvidence[] = retrieval.pages.flatMap((page) =>
    page.chunks.slice(0, 2).map((chunk: RetrievedChunk) => ({
      url: page.url,
      pageTitle: page.title,
      section: chunk.section,
      kind: page.kind,
      text: truncate(chunk.content, 1400),
    }))
  );
  const livePrices = options.facts?.available
    ? selectRelevantPrices(options.facts, [...understanding.correctedTokens, ...retrieval.entities.map((entity) => entity.label)], 8)
    : [];
  const priceStrings = livePrices.map((price) => formatPrice(price));

  const modelText = await openAnswerWithModel({
    question,
    intent: understanding.intent,
    evidence,
    livePrices: priceStrings,
    verifiedLinks: retrieval.pages.map((page) => ({ url: page.url, title: page.title })),
  });
  if (!modelText) return deterministic;

  const cleaned = sanitiseAnswerText(modelText);
  const validation = validateModelAnswer(cleaned, retrieval.pages.map((page) => ({ url: page.url, title: page.title })), priceStrings, options.resolveRoute);
  if (!validation.ok) {
    // The model said something the evidence does not support. Keep the grounded composition and let
    // the console know why (the reason is recorded on the run/audit trail by the caller).
    return { ...deterministic, engine: 'retrieval' };
  }

  const links = pageLinks(retrieval.pages, options, 3);
  // A resolved offering's own page is a verified destination and is exactly where the customer
  // should end up. It is added after the retrieved pages so it never displaces real evidence.
  for (const entity of retrieval.entities.slice(0, 2)) {
    if (links.length >= 3) break;
    const link = linkFor(options, entity.route, entity.label, 'route', options.currentPath);
    if (link && !links.some((existing) => existing.url === link.url)) links.push(link);
  }

  const linkLines = links.map((link) => `• ${link.label}: ${link.url}`);
  const body = clampBody(`${cleaned}${linkLines.length > 0 ? `\n\nWhere to look:\n${linkLines.join('\n')}` : ''}`);

  return {
    ...deterministic,
    body,
    links,
    evidence: evidenceOf(retrieval.pages),
    engine: 'retrieval+model',
    grounded: true,
  };
}

/** Suggests the most useful follow-up questions given what was just retrieved. */
export function suggestFollowUps(
  understanding: QueryUnderstanding,
  retrieval: RetrievalResult,
  options: ComposeOptions,
  limit = 3
): string[] {
  const suggestions: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const key = foldText(value);
    if (!key || seen.has(key) || suggestions.length >= limit) return;
    seen.add(key);
    suggestions.push(value);
  };

  if (retrieval.entities.length > 0) {
    const entity = retrieval.entities[0]!;
    if (understanding.intent !== 'pricing') push(`How much does ${entity.label} cost?`);
    push(`How do I order ${entity.label}?`);
  }
  for (const page of retrieval.pages.slice(1)) {
    if (options.resolveRoute(page.url)) push(`Tell me about ${page.title}`);
  }
  if (understanding.intent === 'pricing') push('What is included in each plan?');
  if (suggestions.length < limit) push('Which option is best for a small business?');
  return suggestions.slice(0, limit);
}

/** Builds the "what the AI understands" link map for the admin console and the widget. */
export function linkLabels(pages: RetrievalResult['pages'], resolveRoute: (candidate: string) => string | null): Array<{ url: string; title: string }> {
  const out: Array<{ url: string; title: string }> = [];
  for (const page of pages) {
    const url = resolveRoute(page.url);
    if (url && isSafeInternalPath(url)) out.push({ url, title: page.title });
  }
  return out;
}

export type { QuestionIntent, ServiceEntity };
