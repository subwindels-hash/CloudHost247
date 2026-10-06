/**
 * Content access layer for the public site.
 *
 * Everything here reads generated JSON, produced by `node scripts/site/generate.mjs` from
 * `shared/site/registry.json` and `shared/site/content/*.json`. Nothing in this file is authored
 * by hand, which is the point: the audit script, the link checker, the PHP/WHMCS surface and this
 * application all see the same page inventory.
 */
import pagesJson from './pages.generated.json';
import docsJson from './docs.generated.json';

export interface MarketingLink {
  label: string;
  to: string;
  variant?: 'primary' | 'mint' | 'outline' | 'ghost';
}

export interface MarketingItem {
  icon?: string;
  title?: string;
  label?: string;
  body?: string;
  to?: string;
  link?: { label: string; to: string };
  anchorId?: string;
}

export interface MarketingSection {
  type: string;
  kicker?: string;
  heading?: string;
  lede?: string;
  note?: string;
  emptyMessage?: string;
  columns?: string[];
  rows?: string[][];
  items?: MarketingItem[];
  links?: MarketingItem[];
  /** For a `plans` section: the catalogue product whose live plans and prices to render. */
  productSlug?: string;
}

export interface MarketingFaq {
  q: string;
  a: string;
}

export interface MarketingPage {
  route: string;
  title: string;
  category: string;
  seoTitle: string;
  description: string;
  visual: string;
  catalogSlug?: string;
  noindex?: boolean;
  hero: {
    kicker?: string;
    heading: string;
    lede: string;
    ctas: MarketingLink[];
    points?: string[];
  };
  sections: MarketingSection[];
  faqs: MarketingFaq[];
  related: string[];
}

export interface DocumentationEntry {
  slug: string;
  href: string;
  section: string;
  title: string;
  summary: string;
  source: string;
  bytes: number;
}

export interface LegalDocument {
  slug: string;
  spa: string;
  php: string;
  title: string;
  origin: 'pdf' | 'smarty' | 'php-array';
  source: string;
  html: string;
  meta: { description: string; paragraphs: number; headings: number; words: number };
}

const pages = (pagesJson as { pages: MarketingPage[] }).pages;
const documents = (docsJson as { documents: DocumentationEntry[] }).documents;

const byRoute = new Map(pages.map((page) => [page.route, page]));
const docsBySlug = new Map(documents.map((document) => [document.slug, document]));

export const MARKETING_PAGES: MarketingPage[] = pages;
export const MARKETING_ROUTES: string[] = pages.map((page) => page.route);
export const DOCUMENTS: DocumentationEntry[] = documents;

export function findPage(route: string): MarketingPage | undefined {
  return byRoute.get(route.replace(/\/$/, '') || '/');
}

export function findDocument(slug: string): DocumentationEntry | undefined {
  return docsBySlug.get(slug);
}

/** Documentation grouped by its section, in a stable order, for the reader's sidebar. */
export function documentsBySection(): Array<{ section: string; documents: DocumentationEntry[] }> {
  const order = ['APIs', 'Services', 'Accounts', 'Operations'];
  const grouped = new Map<string, DocumentationEntry[]>();
  for (const document of documents) {
    const list = grouped.get(document.section) ?? [];
    list.push(document);
    grouped.set(document.section, list);
  }
  return [...grouped.entries()]
    .sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a[0].localeCompare(b[0]);
    })
    .map(([section, list]) => ({ section, documents: list.sort((x, y) => x.title.localeCompare(y.title)) }));
}

/** Headline counts used by the sitemap page and by the audit report. */
export const CONTENT_COUNTS = {
  pages: pages.length,
  sections: pages.reduce((total, page) => total + page.sections.length, 0),
  faqs: pages.reduce((total, page) => total + page.faqs.length, 0),
  documents: documents.length,
  legal: 0, // supplied by content/legal.ts; kept out of this module so it stays small
};
