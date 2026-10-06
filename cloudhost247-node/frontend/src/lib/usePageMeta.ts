import { useEffect } from 'react';

const SITE_NAME = 'CloudHost247';

/**
 * Absolute base for canonical/OG URLs. In the browser this is always the deployed origin, so the
 * canonical tag can never point at a different host from the page a visitor is on. Outside a
 * browser (bundle tooling, tests) the optional build-time `VITE_SITE_URL` is used; when it is not
 * configured the URLs stay root-relative rather than guessing a hostname. No hostname is
 * hard-coded anywhere in the frontend.
 */
const CONFIGURED_SITE_URL = (import.meta.env.VITE_SITE_URL as string | undefined)?.trim().replace(/\/+$/, '') ?? '';

function siteBase(): string {
  if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
    return window.location.origin;
  }
  return CONFIGURED_SITE_URL;
}

export interface PageMetaOptions {
  /** Path (or absolute URL) this page's canonical address. Defaults to the current path. */
  canonical?: string;
  /** Open Graph overrides; `type` defaults to `website`. */
  og?: { title?: string; description?: string; type?: 'website' | 'article' | 'product'; image?: string };
  /** Structured data (schema.org JSON-LD) describing this page. */
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  /** Set true for private/utility pages that must never be indexed. */
  noIndex?: boolean;
}

function absolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith('/') ? url : `/${url}`;
  return `${siteBase()}${path}`;
}

function upsertMeta(selector: string, attrs: Record<string, string>): HTMLMetaElement {
  let tag = document.head.querySelector<HTMLMetaElement>(selector);
  if (!tag) {
    tag = document.createElement('meta');
    document.head.appendChild(tag);
  }
  for (const [key, value] of Object.entries(attrs)) tag.setAttribute(key, value);
  return tag;
}

function upsertLink(rel: string, href: string): HTMLLinkElement {
  let tag = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', rel);
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', href);
  return tag;
}

/**
 * Sets per-route document title, meta description, canonical URL, Open Graph tags and optional
 * schema.org JSON-LD.
 *
 * This app is a client-rendered SPA with no server-side rendering, so a crawler that does not
 * execute JavaScript sees only `index.html`'s static fallback metadata. Public pages that must be
 * discoverable (and are crawlable without JS) are also listed in the server-rendered
 * `/sitemap.xml` and carry a real server-rendered HTML shell; this hook is what makes the metadata
 * correct for real browsers and for crawlers that do execute JavaScript. It is never a substitute
 * for the server-rendered sitemap and per-page routes.
 */
export function usePageMeta(title: string, description?: string, options: PageMetaOptions = {}): void {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`;

    const touched: Array<{ tag: HTMLElement; attribute: string; previous: string | null }> = [];
    const remember = (tag: HTMLElement, attribute: string) => {
      touched.push({ tag, attribute, previous: tag.getAttribute(attribute) });
    };

    if (description) {
      const existing = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (existing) remember(existing, 'content');
      upsertMeta('meta[name="description"]', { name: 'description', content: description });
    }

    const canonicalTag = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonicalTag) remember(canonicalTag, 'href');
    let canonicalHref: string;
    if (options.canonical) {
      canonicalHref = absolute(options.canonical);
    } else {
      const browserPath = typeof window === 'undefined' ? '/' : window.location.pathname || '/';
      // A document URL of plain "/" means the page did not tell us which route it is (a page
      // rendered without a router, or a non-browser test environment). When another component has
      // already declared a deeper canonical — the Tools Center does exactly that, because one tool
      // component serves many slugs — that declaration is kept rather than flattened to the root.
      const alreadyDeclared = canonicalTag?.getAttribute('href');
      canonicalHref = browserPath === '/' && alreadyDeclared ? alreadyDeclared : absolute(browserPath);
    }
    upsertLink('canonical', canonicalHref);

    const ogTitle = options.og?.title ?? (title === SITE_NAME ? SITE_NAME : `${title} · ${SITE_NAME}`);
    const ogTags: Array<[string, string]> = [['og:title', ogTitle], ['og:url', canonicalHref], ['og:type', options.og?.type ?? 'website'], ['og:site_name', SITE_NAME]];
    const ogDescription = options.og?.description ?? description;
    if (ogDescription) ogTags.push(['og:description', ogDescription]);
    if (options.og?.image) ogTags.push(['og:image', absolute(options.og.image)]);
    for (const [property, content] of ogTags) {
      const selector = `meta[property="${property}"]`;
      const existing = document.head.querySelector<HTMLMetaElement>(selector);
      if (existing) remember(existing, 'content');
      upsertMeta(selector, { property, content });
    }
    const twitterCard = document.head.querySelector<HTMLMetaElement>('meta[name="twitter:card"]');
    if (twitterCard) remember(twitterCard, 'content');
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });

    const robotsTag = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (robotsTag) remember(robotsTag, 'content');
    upsertMeta('meta[name="robots"]', { name: 'robots', content: options.noIndex ? 'noindex, nofollow' : 'index, follow' });

    let jsonLd: HTMLScriptElement | null = null;
    if (options.jsonLd) {
      jsonLd = document.createElement('script');
      jsonLd.type = 'application/ld+json';
      jsonLd.text = JSON.stringify(options.jsonLd);
      document.head.appendChild(jsonLd);
    }

    return () => {
      document.title = previousTitle;
      for (const { tag, attribute, previous } of touched) {
        if (previous === null) tag.removeAttribute(attribute);
        else tag.setAttribute(attribute, previous);
      }
      jsonLd?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options is a fresh object each render; the
    // primitives that matter are serialised into the dependency list below.
  }, [title, description, options.canonical, options.noIndex, JSON.stringify(options.og ?? null), JSON.stringify(options.jsonLd ?? null)]);
}
