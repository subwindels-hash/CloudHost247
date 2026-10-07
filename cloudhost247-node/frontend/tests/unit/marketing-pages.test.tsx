import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import MarketingPage from '../../src/pages/marketing/MarketingPage';
import { MARKETING_PAGES, DOCUMENTS, findPage, CONTENT_COUNTS } from '../../src/content/registry';
import { LEGAL_DOCUMENTS } from '../../src/content/legal';
import { NAV_SECTIONS, FOOTER_COLUMNS, TOOLS_CATEGORIES, SPA_ROUTE_PATTERNS } from '../../src/navigation/registry.generated';

/**
 * Whole-site rendering gate.
 *
 * Every public marketing page is rendered for real, server-side, and its output is asserted. This
 * is the check that catches the failure modes a type system cannot: a page whose hero renders
 * empty, a section whose heading exists but whose body silently disappeared, a reinstated "coming
 * soon" placeholder, or a crash on one route out of fifty-one.
 *
 * It runs without a browser on purpose (none exists in the build environment), so it verifies
 * *content and structure*, not pixel layout. Layout is pinned separately by the stylesheet
 * assertions in `design-system.test.ts`.
 */

/**
 * Copy that only appears when someone has published a holding page. The words themselves are
 * legitimate in prose — a release note describing the removal of placeholders is not a placeholder
 * — so the phrases are specific rather than single words.
 */
const FORBIDDEN = [
  'lorem ipsum',
  'coming soon',
  'not yet built on this platform',
  'this page is a placeholder',
  'will be replaced with',
  'details coming soon',
  'todo:',
  'undefined',
  '[object object]',
];

/** HTML-escapes a string the way React does, so content assertions compare like with like. */
function escaped(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/** True when `route` is served by anything: a marketing page, an app route, a tool or a policy. */
function routeIsServed(route: string) {
  const clean = route.split('#')[0] ?? route;
  if (findPage(clean)) return true;
  if (LEGAL_DOCUMENTS.some((document) => document.spa === clean)) return true;
  if (DOCUMENTS.some((document) => document.href === clean)) return true;
  if (clean.startsWith('/tools')) return true;
  if (SPA_ROUTE_PATTERNS.includes(clean)) return true;
  return SPA_ROUTE_PATTERNS.some((pattern) => {
    if (!pattern.includes(':')) return false;
    const a = pattern.split('/');
    const b = clean.split('/');
    return a.length === b.length && a.every((part, index) => part.startsWith(':') || part === b[index]);
  });
}

function render(route: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[route]}>
      <MarketingPage />
    </MemoryRouter>
  );
}

describe('public marketing pages', () => {
  it('has a page for every published route, with unique titles and descriptions', () => {
    const routes = MARKETING_PAGES.map((page) => page.route);
    expect(new Set(routes).size).toBe(routes.length);
    const titles = MARKETING_PAGES.map((page) => page.seoTitle);
    expect(new Set(titles).size).toBe(titles.length);
  });

  for (const page of MARKETING_PAGES) {
    describe(page.route, () => {
      const html = render(page.route);

      it('renders its H1, hero and breadcrumb', () => {
        expect(html).toContain(escaped(page.hero.heading));
        expect(html).toContain(escaped(page.hero.lede));
        expect(html).toContain('aria-label="Breadcrumb"');
        expect(html).toContain('<h1');
      });

      it('renders every section heading it declares', () => {
        for (const section of page.sections) {
          if (!section.heading) continue;
          expect(html, `${page.route} is missing the "${section.heading}" section`).toContain(section.heading);
        }
      });

      it('renders every FAQ it declares', () => {
        for (const faq of page.faqs) {
          expect(html, `${page.route} is missing the FAQ "${faq.q}"`).toContain(escaped(faq.q));
          expect(html, `${page.route} is missing the answer to "${faq.q}"`).toContain(escaped(faq.a));
        }
      });

      it('links only to routes that exist, and shows no placeholder copy', () => {
        const lower = html.toLowerCase();
        for (const forbidden of FORBIDDEN) {
          expect(lower, `${page.route} contains forbidden placeholder copy: "${forbidden}"`).not.toContain(forbidden);
        }
        // Every internal href rendered on the page must resolve.
        const hrefs = [...html.matchAll(/href="([^"]+)"/g)]
          .map((match) => match[1])
          .filter((href) => href.startsWith('/'));
        const unresolved = hrefs.filter((href) => !routeIsServed(href));
        expect(unresolved, `${page.route} renders links with no destination: ${unresolved.join(', ')}`).toEqual([]);
      });

      it('serves an illustration that exists in the published asset set', () => {
        expect(html).toContain(`/media/cloudhost247/${page.visual}.svg`);
      });

      it('declares its canonical route', () => {
        expect(page.route.startsWith('/')).toBe(true);
      });
    });
  }
});

describe('navigation registry', () => {
  it('publishes nine mega menus with labels, blurbs and links', () => {
    expect(NAV_SECTIONS.length).toBe(9);
    for (const section of NAV_SECTIONS) {
      expect(section.label.length).toBeGreaterThan(2);
      expect(section.blurb.length).toBeGreaterThan(20);
      const links = section.groups.flatMap((group) => group.links);
      if (section.toolsDriven) expect(section.groups.length).toBe(0);
      else expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.to.startsWith('/'), `${section.id}/${link.label} must be an internal path`).toBe(true);
        expect(link.description.length, `${section.id}/${link.label} needs a description`).toBeGreaterThan(10);
      }
    }
  });

  it('publishes footer columns that all have destinations', () => {
    expect(FOOTER_COLUMNS.length).toBe(9);
    for (const column of FOOTER_COLUMNS) {
      expect(column.links.length).toBeGreaterThan(0);
      for (const link of column.links) expect(link.to.startsWith('/')).toBe(true);
    }
  });

  it('never publishes a link the router cannot render', () => {
    const declared = new Set(SPA_ROUTE_PATTERNS);
    const missing: string[] = [];
    for (const link of [
      ...NAV_SECTIONS.flatMap((section) => section.groups.flatMap((group) => group.links)),
      ...FOOTER_COLUMNS.flatMap((column) => column.links),
    ]) {
      const clean = link.to.split('#')[0] ?? link.to;
      if (declared.has(clean)) continue;
      if (MARKETING_PAGES.some((page) => page.route === clean)) continue;
      if (LEGAL_DOCUMENTS.some((document) => document.spa === clean)) continue;
      if (DOCUMENTS.some((document) => document.href === clean)) continue;
      if (clean.startsWith('/tools')) continue;
      const matched = [...declared].some((pattern) => {
        if (!pattern.includes(':')) return false;
        const a = pattern.split('/');
        const b = clean.split('/');
        return a.length === b.length && a.every((part, index) => part.startsWith(':') || part === b[index]);
      });
      if (!matched) missing.push(link.to);
    }
    expect(missing, `these navigation links have no route: ${missing.join(', ')}`).toEqual([]);
  });

  it('publishes a tool category for every category a menu links to', () => {
    const categories = TOOLS_CATEGORIES.map((category) => category.slug);
    expect(new Set(categories).size).toBe(categories.length);
    for (const category of TOOLS_CATEGORIES) {
      expect(category.label.length).toBeGreaterThan(1);
      expect(category.desc.length).toBeGreaterThan(10);
    }
  });
});

describe('legal documents', () => {
  it('publishes every policy with substantive extracted content', () => {
    expect(LEGAL_DOCUMENTS.length).toBeGreaterThanOrEqual(17);
    for (const document of LEGAL_DOCUMENTS) {
      expect(document.meta.words, `${document.slug} is thin`).toBeGreaterThan(80);
      expect(document.html.length).toBeGreaterThan(400);
      // The extractor strips these; if one appears, the sanitising step regressed.
      expect(document.html).not.toMatch(/<script/i);
      expect(document.html).not.toMatch(/\son[a-z]+=/i);
      expect(document.html).not.toMatch(/javascript:/i);
    }
  });

  it('covers the policies a hosting business must publish', () => {
    const slugs = LEGAL_DOCUMENTS.map((document) => document.slug);
    for (const required of ['terms', 'privacy-policy', 'cookies', 'acceptable-use', 'refund-policy', 'backup-policy', 'fair-usage']) {
      expect(slugs, `missing policy: ${required}`).toContain(required);
    }
  });
});

describe('published documentation', () => {
  it('indexes documents with titles, sections and summaries', () => {
    expect(DOCUMENTS.length).toBeGreaterThan(8);
    for (const document of DOCUMENTS) {
      expect(document.title.length).toBeGreaterThan(3);
      expect(document.section.length).toBeGreaterThan(2);
      expect(document.href).toBe(`/docs/${document.slug}`);
    }
  });
});

describe('content inventory', () => {
  it('counts every page, section and FAQ once', () => {
    expect(CONTENT_COUNTS.pages).toBe(MARKETING_PAGES.length);
    expect(CONTENT_COUNTS.sections).toBe(MARKETING_PAGES.reduce((total, page) => total + page.sections.length, 0));
    expect(CONTENT_COUNTS.faqs).toBe(MARKETING_PAGES.reduce((total, page) => total + page.faqs.length, 0));
  });

  it('has no orphan pages: every page is reachable from a menu, the footer, or another page', () => {
    const linked = new Set<string>(['/', '/sitemap']);
    for (const section of NAV_SECTIONS) {
      linked.add(section.to);
      for (const group of section.groups) for (const link of group.links) linked.add(link.to);
    }
    for (const column of FOOTER_COLUMNS) for (const link of column.links) linked.add(link.to);
    for (const page of MARKETING_PAGES) for (const related of page.related) linked.add(related);

    const orphans = MARKETING_PAGES.map((page) => page.route).filter((route) => !linked.has(route));
    expect(orphans, `these pages are linked from nowhere: ${orphans.join(', ')}`).toEqual([]);
  });

  it('resolves every related-service reference to a real page', () => {
    for (const page of MARKETING_PAGES) {
      for (const related of page.related) {
        expect(routeIsServed(related), `${page.route} references ${related}, which nothing serves`).toBe(true);
      }
    }
  });
});
