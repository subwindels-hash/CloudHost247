import projection from './content/website-knowledge.generated.json';
import {
  canonicalPath,
  contentFingerprint,
  foldText,
  isSafeInternalPath,
  sanitizeForIndex,
  truncate,
  type DiscoveredPage,
  type ExtractedDocument,
  type WebsiteSourceKind,
  type WebsiteSurface,
} from './types';

/**
 * Website discovery.
 *
 * The input is `content/website-knowledge.generated.json`, produced by
 * `scripts/site/generate-ai-knowledge.mjs` from the same registries and generated content the two
 * public websites are built from. That is a deliberate choice, documented in
 * docs/AI_WEBSITE_INTELLIGENCE.md §2 (D5): crawling the live site from the application would mean
 * the Node process HTTP-fetching its own domain hundreds of times per sync — unreliable behind
 * Passenger, wasteful, and impossible to run inside the worker's leased cycle.
 *
 * What discovery adds on top of the raw projection:
 *   • crawl/publication policy — the registry's own `sitemap.exclude` / `excludePhp` rules, plus
 *     administrator exclusions, decide what may be retrieved. Excluded documents are still reported
 *     (the console shows them and why) but are never indexed for retrieval.
 *   • normalisation — text is cleaned, de-scaffolded and length-capped before chunking.
 *   • identity — one `sourceKey` per document, with alias URLs resolved back to it, so an update
 *     rewrites a row instead of creating a second one.
 *   • verified routes — the set of paths the assistant is allowed to print as links.
 */

export interface RawDocument {
  sourceKey: string;
  url: string;
  aliases: string[];
  title: string;
  description: string;
  kind: WebsiteSourceKind;
  surface: WebsiteSurface;
  section: string;
  category: string;
  related: Array<{ label: string; url: string }>;
  faqs: Array<{ question: string; answer: string }>;
  body: string;
  headings: string[];
}

export interface ProjectionReport {
  sources: Record<string, number>;
  skipped: Array<{ key: string; reason: string }>;
}

export interface WebsiteProjection {
  version: string;
  generatedFrom: string[];
  documents: RawDocument[];
  routes: string[];
  report: ProjectionReport;
}

export const WEBSITE_PROJECTION = projection as unknown as WebsiteProjection;

/**
 * Paths that are private or session-scoped. They are the registry's own crawl exclusions, repeated
 * here because the assistant's retrieval index must never contain a dashboard, checkout or admin
 * destination — a leak there would surface another customer's data shape in a public answer.
 *
 * This list is intentionally the *union* of the registry policy and the routes the router guards:
 * a path is private if either source says so.
 */
const PRIVATE_PATH_RULES: readonly RegExp[] = [
  /^\/(?:login|register|forgot-password|reset-password|verify-email|logout)(?:$|\/)/,
  /^\/(?:dashboard|admin|account|billing|invoices|cart|checkout|inbox|support|services|marketing)(?:$|\/)/,
  /^\/api(?:\/|$)/,
  /^\/(?:servers|sites|store|websites)\/[^/]+/,
  /^\/tools\/(?:history|favorites|reports|monitors)$/,
  /^\/(?:clientarea|cart|register|pwreset|logout|submitticket|supporttickets|viewticket)\.php$/,
  /^\/(?:admin|modules|crons|errors)\//,
  /^\/tools\/(?:admin|data)\//,
];

/** Minimum readable body before a document is worth retrieving from. */
export const MIN_RETRIEVABLE_BODY = 40;

export interface ExcludedSource {
  sourceKey: string;
  url: string;
  reason: string;
}

export interface DiscoveryResult {
  pages: DiscoveredPage[];
  /** Documents kept out of retrieval, with the reason. Nothing is silently dropped. */
  excluded: ExcludedSource[];
  /** Verified destinations the assistant may link to. */
  routes: Set<string>;
  stats: {
    discovered: number;
    publishable: number;
    excluded: number;
    byKind: Record<string, number>;
    bySurface: Record<string, number>;
  };
}

export function isPrivatePath(path: string): boolean {
  const candidate = canonicalPath(path);
  return PRIVATE_PATH_RULES.some((rule) => rule.test(candidate));
}

/** Normalises a candidate link to a verified route, or returns null. Never invents a path. */
export function resolveRoute(candidate: string, routes: ReadonlySet<string> = new Set(WEBSITE_PROJECTION.routes)): string | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!isSafeInternalPath(trimmed)) return null;
  const path = canonicalPath(trimmed);
  if (routes.has(path)) return path;
  const lowered = path.toLowerCase();
  for (const route of routes) {
    if (route.toLowerCase() === lowered) return route;
  }
  return null;
}

/** True when the platform serves this path (ignoring case), including the root. */
export function routeServed(path: string): boolean {
  return resolveRoute(path) !== null;
}

/** Normalises a discovery body into the shape the indexer chunks. */
function normaliseDocument(raw: RawDocument): ExtractedDocument {
  const faqs = (raw.faqs ?? [])
    .map((faq) => ({ question: sanitizeForIndex(faq.question ?? ''), answer: sanitizeForIndex(faq.answer ?? '') }))
    .filter((faq) => faq.question.length > 0 && faq.answer.length > 0);

  const bodyParts = [sanitizeForIndex(raw.body ?? '')];
  // A FAQ is part of the page a visitor reads, so it belongs in the page body too — but the
  // standalone FAQ document is what wins retrieval for a verbatim question.
  for (const faq of faqs) {
    const rendered = `${faq.question}\n${faq.answer}`;
    if (!bodyParts[0]!.includes(rendered)) bodyParts.push(rendered);
  }

  const body = truncate(bodyParts.filter(Boolean).join('\n\n'), 60_000);

  return {
    title: sanitizeForIndex(raw.title ?? ''),
    description: sanitizeForIndex(raw.description ?? ''),
    headings: (raw.headings ?? []).map((heading) => sanitizeForIndex(heading)).filter(Boolean).slice(0, 40),
    body,
    faqs,
    relatedLinks: (raw.related ?? [])
      .filter((link) => isSafeInternalPath(link.url ?? ''))
      .map((link) => ({ label: sanitizeForIndex(link.label ?? link.url), url: canonicalPath(link.url) })),
    prices: [],
    updatedAt: null,
  };
}

export interface DiscoveryOptions {
  projection?: WebsiteProjection;
  /** Administrator exclusions (`ai_knowledge_exclusions.pattern`), matched as path or key prefixes. */
  exclusionPatterns?: string[];
  /** Additional documents produced outside the projection (e.g. live catalogue products). */
  extraDocuments?: RawDocument[];
}

/**
 * Discovers every eligible public document.
 *
 * Pure and synchronous: no network, no database, no clock. The sync service supplies database-backed
 * inputs (catalogue documents, administrator exclusions) and does the writing.
 */
export function discoverWebsiteDocuments(options: DiscoveryOptions = {}): DiscoveryResult {
  const source = options.projection ?? WEBSITE_PROJECTION;
  const patterns = (options.exclusionPatterns ?? [])
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.length > 0);

  const matchesAdminExclusion = (key: string, url: string): string | null => {
    for (const pattern of patterns) {
      const lowered = pattern.toLowerCase();
      if (key.toLowerCase().startsWith(lowered) || url.toLowerCase() === lowered || (lowered.endsWith('/') && url.toLowerCase().startsWith(lowered))) {
        return `Excluded by administrator rule "${pattern}"`;
      }
    }
    return null;
  };

  const pages: DiscoveredPage[] = [];
  const excluded: ExcludedSource[] = [];
  const byKind: Record<string, number> = {};
  const bySurface: Record<string, number> = {};
  const documents = [...source.documents, ...(options.extraDocuments ?? [])];

  for (const raw of documents) {
    const key = String(raw.sourceKey ?? '').trim();
    const url = canonicalPath(String(raw.url ?? ''));
    if (!key || !url.startsWith('/')) {
      excluded.push({ sourceKey: key || '(missing key)', url, reason: 'Document has no usable identity or URL' });
      continue;
    }

    byKind[raw.kind] = (byKind[raw.kind] ?? 0) + 1;
    bySurface[raw.surface] = (bySurface[raw.surface] ?? 0) + 1;

    const adminExclusion = matchesAdminExclusion(key, url);
    if (adminExclusion) {
      excluded.push({ sourceKey: key, url, reason: adminExclusion });
      continue;
    }
    if (isPrivatePath(url)) {
      excluded.push({ sourceKey: key, url, reason: 'Private or session-scoped destination (never indexed)' });
      continue;
    }

    const content = normaliseDocument(raw);

    // A page with a title but no body is a real page (a dashboard destination, a tool landing page)
    // and is worth a link, but it is not an answer. It stays discoverable and non-retrievable.
    if (content.body.trim().length < MIN_RETRIEVABLE_BODY) {
      pages.push({
        sourceKey: key,
        url,
        aliases: (raw.aliases ?? []).filter(isSafeInternalPath).map(canonicalPath).slice(0, 8),
        title: content.title || url,
        description: content.description,
        kind: raw.kind,
        surface: raw.surface,
        section: sanitizeForIndex(raw.section ?? ''),
        category: sanitizeForIndex(raw.category ?? ''),
        publishable: false,
        exclusionReason: 'No readable content on this page (link only)',
        content,
      });
      continue;
    }

    pages.push({
      sourceKey: key,
      url,
      aliases: (raw.aliases ?? []).filter(isSafeInternalPath).map(canonicalPath).slice(0, 8),
      title: content.title || url,
      description: content.description,
      kind: raw.kind,
      surface: raw.surface,
      section: sanitizeForIndex(raw.section ?? ''),
      category: sanitizeForIndex(raw.category ?? ''),
      publishable: true,
      content,
    });
  }

  const routes = new Set<string>(source.routes ?? []);
  for (const page of pages) {
    routes.add(page.url);
    for (const alias of page.aliases) routes.add(alias);
  }
  try {
    routes.add('/');
  } catch {
    /* unreachable: Set.add always succeeds; kept for symmetry with resolveRoute */
  }

  return {
    pages,
    excluded,
    routes,
    stats: {
      discovered: documents.length,
      publishable: pages.filter((page) => page.publishable).length,
      excluded: excluded.length,
      byKind,
      bySurface,
    },
  };
}

/** Fingerprint used by the sync to decide whether a document actually changed. */
export function fingerprintOf(page: DiscoveredPage): string {
  const content = page.content ?? { title: page.title, description: page.description, body: '', faqs: [] };
  return contentFingerprint({
    title: page.title,
    description: page.description,
    body: content.body,
    faqs: content.faqs,
  });
}

/**
 * Vocabulary for typo correction: the words that actually appear in titles, sections and page
 * summaries. Built once from the projection, so "kubernets" starts correcting to "kubernetes" the
 * moment a page about Kubernetes is published — with no code change.
 */
export function buildVocabulary(source: WebsiteProjection = WEBSITE_PROJECTION): Set<string> {
  const vocabulary = new Set<string>();
  const add = (text: string | undefined | null) => {
    if (!text) return;
    for (const token of foldText(text).split(' ')) {
      if (token.length >= 3) vocabulary.add(token);
    }
  };
  for (const document of source.documents) {
    add(document.title);
    add(document.description);
    add(document.section);
    add(document.category);
    for (const heading of document.headings ?? []) add(heading);
  }
  return vocabulary;
}

/** Cached vocabulary — the projection is immutable for the lifetime of the process. */
let cachedVocabulary: Set<string> | null = null;
export function websiteVocabulary(): Set<string> {
  if (!cachedVocabulary) cachedVocabulary = buildVocabulary();
  return cachedVocabulary;
}
