import { createHash } from 'node:crypto';

/**
 * AI Website Intelligence — shared types and pure text utilities.
 *
 * Everything in this module is deliberately dependency-free and deterministic: the crawler, the
 * indexer, the retriever and the answer composer all run it, and every one of them has to behave
 * identically in production (PostgreSQL on cPanel) and in the test suite (pglite). No network
 * access, no clock reads, no randomness.
 */

/** What kind of thing a knowledge document is. Mirrors the `ai_knowledge_sources.source_kind` CHECK. */
export type WebsiteSourceKind =
  | 'website_page'
  | 'website_tool'
  | 'website_doc'
  | 'legal_document'
  | 'product'
  | 'service'
  | 'faq'
  | 'announcement'
  | 'catalog_page';

export const WEBSITE_SOURCE_KINDS: readonly WebsiteSourceKind[] = [
  'website_page',
  'website_tool',
  'website_doc',
  'legal_document',
  'product',
  'service',
  'faq',
  'announcement',
  'catalog_page',
];

/** Which website surface a document came from. Shown in the admin console, never guessed. */
export type WebsiteSurface = 'spa' | 'php' | 'catalog' | 'registry';

export interface DiscoveredPage {
  /**
   * Stable identity for the document, independent of the URL form. This is the dedupe key: the SPA
   * route `/hosting/vps` and the PHP route `vps-hosting.php` are two surfaces of the *same* page, and
   * an event-driven sync keys on `sourceKey` so it updates the existing row instead of adding a
   * second one.
   */
  sourceKey: string;
  /** Canonical, visitor-facing URL path on the SPA surface (always starts with `/`). */
  url: string;
  /** Secondary URLs that render the same content (PHP paths, legacy aliases). */
  aliases: string[];
  title: string;
  description: string;
  kind: WebsiteSourceKind;
  surface: WebsiteSurface;
  section: string;
  category: string;
  /** Whether retrieval may use this document. False for policy-excluded or thin pages. */
  publishable: boolean;
  /** Plain-language reason a document was excluded, for the admin console. Never a stack trace. */
  exclusionReason?: string;
  /** Used only when the content lives in a file the indexer must read at sync time. */
  filePath?: string;
  /** Pre-extracted content when the discovery source already has it (content JSON, docs, etc.). */
  content?: ExtractedDocument;
}

export interface ExtractedDocument {
  title: string;
  description: string;
  headings: string[];
  /** The readable body, already normalised. This is what gets chunked. */
  body: string;
  faqs: Array<{ question: string; answer: string }>;
  /** Verified internal links the page itself advertises. Never invented. */
  relatedLinks: Array<{ label: string; url: string }>;
  /** Prices as published in the page prose, so the answer can quote a page without inventing one. */
  prices: string[];
  /** Static path of the page's own hero image, kept for the admin console only. */
  updatedAt?: string | null;
}

export const EMPTY_DOCUMENT: ExtractedDocument = {
  title: '',
  description: '',
  headings: [],
  body: '',
  faqs: [],
  relatedLinks: [],
  prices: [],
  updatedAt: null,
};

/** HTML entities that appear in the generated legal/doc artefacts. Deliberately small. */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|mdash|ndash|hellip|rsquo|lsquo|ldquo|rdquo);/g, (match) => ENTITIES[match] ?? match);
}

/**
 * Converts generated HTML into readable text.
 *
 * This is intentionally NOT a general HTML parser: it handles the two shapes this repository
 * generates (policy HTML from PDF extraction, and documentation HTML), and it removes exactly the
 * things that would otherwise pollute the index — script/style blocks, tags, repeated whitespace.
 * It never executes anything and never resolves an entity it does not know.
 */
export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const withBreaks = withoutBlocks
    .replace(/<\/(?:p|div|li|tr|h[1-6]|section|article|blockquote|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ');
  return normaliseWhitespace(decodeEntities(withBreaks.replace(/<[^>]+>/g, ' ')));
}

/** Extracts the heading text of a generated HTML block, preserving order. */
export function htmlHeadings(html: string): string[] {
  const headings: string[] = [];
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const text = normaliseWhitespace(decodeEntities(String(match[2]).replace(/<[^>]+>/g, ' ')));
    if (text) headings.push(text);
  }
  return headings;
}

/** Collapses every run of whitespace, trims, and normalises the unicode dashes/quotes we emit. */
export function normaliseWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Removes instruction-like scaffolding from crawled text before it is stored or shown to a model.
 *
 * A website page is data. It is never a prompt. This function is the belt-and-braces half of that
 * rule (the other half is that the answer composer only ever inserts evidence inside a delimited
 * block and validates the model's output against it). It targets the shapes that actually appear in
 * prompt-injection payloads placed in content an operator might paste: "ignore previous
 * instructions", "system:", "you are now", chat-template control tokens, and zero-width characters
 * used to smuggle text past a reviewer.
 */
export function sanitizeForIndex(value: string): string {
  return normaliseWhitespace(
    value
      // Unicode direction overrides and zero-width characters are never meaningful website content.
      .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
      // Chat-template control tokens.
      .replace(/<\|[^|>]{1,40}\|>/g, ' ')
      .replace(/\[\/?INST\]|<<\/?SYS>>/gi, ' ')
      .replace(
        /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier|system)\s+(?:instructions?|prompts?|rules?)\b/gi,
        '[removed instruction-like text]'
      )
      .replace(/\byou\s+are\s+(?:now|no longer)\b[^.!?\n]{0,120}(?=[.!?\n]|$)/gi, '[removed instruction-like text]')
      .replace(/^\s*(?:system|assistant|developer)\s*:\s*/gim, '')
      // Markup never belongs in the index: a crawled page's tags are presentation, not content, and
      // leaving `<script>` in place would let a page queue up a payload for whatever reads the index
      // next. The text is quoted to a customer, never executed.
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]{1,400}>/g, ' ')
      // Base64 runs long enough to hide a payload.
      .replace(/[A-Za-z0-9+/]{180,}={0,2}/g, ' ')
  );
}

/** Lowercase, accent-folded text used for matching. Keeps digits so "247" still matches. */
export function foldText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Deterministic document fingerprint. Two identical documents always produce the same hash. */
export function contentFingerprint(parts: {
  title: string;
  description?: string;
  body: string;
  faqs?: Array<{ question: string; answer: string }>;
}): string {
  const canonical = [
    'v1',
    normaliseWhitespace(parts.title),
    normaliseWhitespace(parts.description ?? ''),
    normaliseWhitespace(parts.body),
    ...(parts.faqs ?? []).map((faq) => `${normaliseWhitespace(faq.question)}\u0000${normaliseWhitespace(faq.answer)}`),
  ].join('\u0001');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Prices as published in prose. Used to quote a page's own words, never to compute a price. */
export function extractPrices(text: string): string[] {
  const found = new Set<string>();
  const pattern = /(?:US\$|\$|€|£|₦)\s?\d[\d,]*(?:\.\d{1,2})?(?:\s?(?:\/|per)\s?(?:mo|month|year|yr|annum))?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    found.add(match[0].replace(/\s+/g, ' ').trim());
    if (found.size >= 20) break;
  }
  return [...found];
}

/**
 * Validates a URL the platform is prepared to show a customer.
 *
 * Only site-internal absolute paths are allowed. Protocol-relative URLs, `javascript:`, external
 * hosts and anything with a traversal segment are rejected: the assistant's guarantee is that it
 * never prints a link the platform has not verified, and this is the last gate before that link
 * reaches a browser.
 */
export function isSafeInternalPath(value: string): boolean {
  if (typeof value !== 'string') return false;
  const path = value.trim();
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  if (path.includes('\\') || path.includes('://')) return false;
  // A scheme smuggled into a query or fragment is still a scheme the browser may act on when the
  // link is rendered. Links offered to a customer are plain paths, so a scheme anywhere is refused.
  if (/(?:javascript|data|vbscript|file|blob)\s*:/i.test(path)) return false;
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  const segments = path.split(/[?#]/, 1)[0]!.split('/');
  return !segments.some((segment) => segment === '.' || segment === '..');
}

/** Collapses a URL's query/hash and trailing slash so two forms of one page share a key. */
export function canonicalPath(value: string): string {
  const withoutQuery = value.trim().split(/[?#]/, 1)[0] ?? '';
  const collapsed = withoutQuery.replace(/\/{2,}/g, '/');
  if (collapsed === '' || collapsed === '/') return '/';
  return collapsed.replace(/\/+$/, '') || '/';
}

export function truncate(value: string, max: number): string {
  const text = value.trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}
