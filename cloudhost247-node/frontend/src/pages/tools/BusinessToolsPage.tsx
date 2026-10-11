import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon';
import { usePageMeta } from '../../lib/usePageMeta';
import {
  BUSINESS_TOOL_CATEGORIES,
  BUSINESS_TOOL_CATEGORY_LABELS,
  BUSINESS_TOOLS_ROOT,
  BUSINESS_TOOLS_TOTAL,
  businessToolsByCategory,
  findBusinessTool,
  searchBusinessTools,
} from '../../../../src/tools/business';
import type { BusinessTool, BusinessToolCategory } from '../../../../src/tools/business';

/**
 * Business Tools — the directory page for the section.
 *
 * Twenty-one working tools in three categories, mirrored from the reference directory's taxonomy:
 * 5 calculators, 12 generators, 4 comparisons. The counts are rendered from the registry rather
 * than typed into the copy, so the page cannot advertise a number the tools do not match.
 *
 * The category filter lives in the query string (`?category=calculators`) rather than only in
 * component state, so a filtered view is a shareable, bookmarkable URL and the navigation can link
 * straight to a category. Search does the same with `?q=`.
 *
 * Everything on this page is client-side: the registry is bundled, so there is no request to make
 * and no spinner to fake. The states that *are* real — no matches, an unknown category, and the
 * per-tool running/success/error states — live here and in the workspace.
 */

const CATEGORY_BLURBS: Record<BusinessToolCategory, string> = {
  calculators: 'Payroll, tax and workforce-cost arithmetic, with the statutory source and effective date beside every rate.',
  generators: 'Job descriptions, offers, payslips, contracts, invoices, cards, identifiers, charts and comment drafts.',
  comparisons: 'Weighted comparisons of accounting, expense, health-cover and pension providers, with the scoring shown.',
};

/** The MRZ tool predates this section and stays available inside it, without being counted as one of the 21. */
const PRESERVED_TOOLS: Array<{ name: string; to: string; description: string; icon: string }> = [
  {
    name: 'MRZ Generator',
    to: '/tools/mrz-generator',
    description:
      'Build, validate and parse ICAO Doc 9303 machine-readable zones for travel and identity documents. The Developer / Document Tools section keeps its own canonical URL.',
    icon: 'file-text',
  },
  {
    name: 'Developer & Document Tools',
    to: '/tools/document',
    description: 'The hub for privacy-first document-format, OCR-calibration and parser-testing utilities.',
    icon: 'code',
  },
];

const KNOWN_CATEGORIES: string[] = [...BUSINESS_TOOL_CATEGORIES, 'all'];

function isCategory(value: string | null): value is BusinessToolCategory {
  return value !== null && (BUSINESS_TOOL_CATEGORIES as readonly string[]).includes(value);
}

export default function BusinessToolsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = searchParams.get('q') ?? '';
  const categoryParam = searchParams.get('category');
  const unknownCategory = categoryParam !== null && !KNOWN_CATEGORIES.includes(categoryParam);
  const category: BusinessToolCategory | 'all' = isCategory(categoryParam) ? categoryParam : 'all';

  usePageMeta(
    'Business Tools — Calculators, Generators & Comparisons | CloudHost247',
    `Free Business Tools from CloudHost247: ${BUSINESS_TOOLS_TOTAL} working payroll and business utilities — ${businessToolsByCategory('calculators').length} calculators, ${businessToolsByCategory('generators').length} generators and ${businessToolsByCategory('comparisons').length} comparisons. Every calculation runs in your browser.`,
    {
      canonical: BUSINESS_TOOLS_ROOT,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Business Tools',
        description: 'Free payroll, tax, document and comparison tools. All computation runs client-side.',
        url: BUSINESS_TOOLS_ROOT,
        hasPart: BUSINESS_TOOLS_ALL_NAMES(),
      },
    }
  );

  const tools = useMemo(() => searchBusinessTools(query, category), [query, category]);
  const counts = useMemo(
    () => ({
      all: BUSINESS_TOOLS_TOTAL,
      calculators: businessToolsByCategory('calculators').length,
      generators: businessToolsByCategory('generators').length,
      comparisons: businessToolsByCategory('comparisons').length,
    }),
    []
  );

  function updateParams(next: { q?: string; category?: BusinessToolCategory | 'all' }): void {
    const params = new URLSearchParams(searchParams);
    if (next.q !== undefined) {
      if (next.q.trim() === '') params.delete('q');
      else params.set('q', next.q);
    }
    if (next.category !== undefined) {
      if (next.category === 'all') params.delete('category');
      else params.set('category', next.category);
    }
    setSearchParams(params, { replace: true });
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <nav aria-label="Breadcrumb">
            <ol className="bt247-breadcrumbs">
              <li>
                <Link to="/">Home</Link>
              </li>
              <li>
                <Link to="/tools">Tools</Link>
              </li>
              <li aria-current="page">Business Tools</li>
            </ol>
          </nav>
          <h1>Business Tools</h1>
          <p>
            Free payroll, tax, document and provider-comparison utilities for running a business.
            Every calculation and every generated document is produced in your browser tab — salary
            figures, employee names, contract terms and client details are never uploaded to a
            CloudHost247 server or to any third party.
          </p>
          <ul className="bt247-hero__counts">
            <li>
              <strong>{counts.all}</strong> tools
            </li>
            {BUSINESS_TOOL_CATEGORIES.map((slug) => (
              <li key={slug}>
                <strong>{counts[slug]}</strong> {BUSINESS_TOOL_CATEGORY_LABELS[slug]}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide ch247-stack">
          <div className="bt247-controls">
            <div className="bt247-search">
              <label className="ch247-field-label" htmlFor="bt247-search-input">
                Search all {counts.all} tools
              </label>
              <input
                id="bt247-search-input"
                type="search"
                value={query}
                placeholder="Try “pension”, “invoice”, “PAYE” or “comparison”"
                onChange={(event) => updateParams({ q: event.target.value })}
                aria-describedby="bt247-search-help"
              />
            </div>
            <p className="ch247-page__hint" id="bt247-search-help" style={{ margin: 0 }}>
              Search matches tool names, descriptions and keywords. Every word you type must appear
              somewhere in a tool for it to be listed.
            </p>

            <div className="bt247-filters" role="group" aria-label="Filter tools by category">
              <button
                type="button"
                className="bt247-filter"
                aria-pressed={category === 'all'}
                onClick={() => updateParams({ category: 'all' })}
              >
                All tools <span className="bt247-filter__count">({counts.all})</span>
              </button>
              {BUSINESS_TOOL_CATEGORIES.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  className="bt247-filter"
                  aria-pressed={category === slug}
                  onClick={() => updateParams({ category: slug })}
                >
                  {BUSINESS_TOOL_CATEGORY_LABELS[slug]} <span className="bt247-filter__count">({counts[slug]})</span>
                </button>
              ))}
            </div>
          </div>

          {unknownCategory ? (
            <div className="bt247-state bt247-state--error" role="alert">
              <h2 className="bt247-state__title">Unknown category “{categoryParam}”</h2>
              <p style={{ margin: 0 }}>
                Business Tools has three categories: {BUSINESS_TOOL_CATEGORIES.map((slug) => slug).join(', ')}.{' '}
                <Link to={BUSINESS_TOOLS_ROOT}>Show all {counts.all} tools</Link>.
              </p>
            </div>
          ) : (
            <>
              <p className="bt247-result-count" role="status" aria-live="polite">
                Showing {tools.length} of {counts.all} tools
                {category !== 'all' ? ` in ${BUSINESS_TOOL_CATEGORY_LABELS[category]}` : ''}
                {query.trim() !== '' ? ` matching “${query.trim()}”` : ''}.
              </p>

              {tools.length === 0 ? (
                <div className="bt247-state">
                  <h2 className="bt247-state__title">No tools match that search</h2>
                  <p style={{ margin: '0 auto', maxWidth: '34rem' }}>
                    Nothing in Business Tools matches
                    {query.trim() !== '' ? <> “{query.trim()}”</> : ' this filter'}
                    {category !== 'all' ? ` within ${BUSINESS_TOOL_CATEGORY_LABELS[category]}` : ''}. Try fewer
                    words, or clear the filters to see all {counts.all} tools.
                  </p>
                  <div className="bt247-actions" style={{ justifyContent: 'center', marginTop: '0.75rem' }}>
                    <button type="button" className="ch247-button" onClick={() => setSearchParams(new URLSearchParams(), { replace: true })}>
                      Clear search and filters
                    </button>
                    <Link className="ch247-button ch247-button--ghost" to="/tools">
                      Browse the full Tools Center
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="bt247-grid">
                  {tools.map((tool) => (
                    <ToolCard key={tool.slug} tool={tool} />
                  ))}
                </div>
              )}
            </>
          )}

          {category === 'all' && query.trim() === '' && !unknownCategory ? (
            <>
              <div className="ch247-card">
                <h2>Also in Business Tools</h2>
                <p className="ch247-page__hint">
                  The Developer &amp; Document Tools utilities keep their own canonical URLs and are
                  not counted among the {counts.all} tools above.
                </p>
                <div className="bt247-grid" style={{ marginTop: '0.75rem' }}>
                  {PRESERVED_TOOLS.map((entry) => (
                    <article className="bt247-card" key={entry.to}>
                      <div className="bt247-card__head">
                        <span className="bt247-card__icon" aria-hidden="true">
                          <Icon name={entry.icon} size={18} />
                        </span>
                        <div>
                          <h3 className="bt247-card__title">{entry.name}</h3>
                          <p className="bt247-card__category">Developer / Document Tools</p>
                        </div>
                      </div>
                      <p className="bt247-card__summary">{entry.description}</p>
                      <div className="bt247-card__foot">
                        <Link className="ch247-button ch247-button--small" to={entry.to}>
                          Open Tool
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </div>

              <div className="ch247-card">
                <h2>How these tools handle your data</h2>
                <ul className="ch247-plainlist" style={{ lineHeight: 1.7 }}>
                  <li>
                    <strong>Nothing is uploaded.</strong> Every calculator, generator and comparison
                    runs on the code bundled into this page. There is no API call carrying your
                    salary figures, employee names, contract terms or client details.
                  </li>
                  <li>
                    <strong>Nothing is stored.</strong> These pages write no localStorage or
                    sessionStorage entries and set no cookies. Reload the page and the form is empty
                    again — which is the intended behaviour for a tool that handles payroll.
                  </li>
                  <li>
                    <strong>Exports are yours.</strong> Copy, download and print all act on the text
                    you just generated, in your browser.
                  </li>
                  <li>
                    <strong>Rates are sourced, not invented.</strong> Where a tool applies a
                    statutory rate it names the jurisdiction, the instrument it came from and the
                    date it was verified against. Where a figure is a planning estimate it says so.
                  </li>
                  <li>
                    <strong>Estimates are not advice.</strong> Nothing here is tax, legal or
                    financial advice. Confirm any figure you intend to file, remit or sign against
                    the relevant authority or a qualified professional.
                  </li>
                </ul>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function BUSINESS_TOOLS_ALL_NAMES(): Array<{ '@type': string; name: string; url: string }> {
  return [...businessToolsByCategory('calculators'), ...businessToolsByCategory('generators'), ...businessToolsByCategory('comparisons')].map(
    (tool) => ({ '@type': 'WebApplication', name: tool.name, url: tool.path })
  );
}

function ToolCard({ tool }: { tool: BusinessTool }) {
  return (
    <article className="bt247-card">
      <div className="bt247-card__head">
        <span className="bt247-card__icon" aria-hidden="true">
          <Icon name={tool.icon} size={18} />
        </span>
        <div>
          <h2 className="bt247-card__title">{tool.name}</h2>
          <p className="bt247-card__category">{BUSINESS_TOOL_CATEGORY_LABELS[tool.category]}</p>
        </div>
      </div>
      <p className="bt247-card__summary">{tool.summary}</p>
      <div className="bt247-card__foot">
        <Link className="ch247-button ch247-button--small" to={tool.path}>
          Open Tool
        </Link>
        <span className="bt247-card__units">{tool.units}</span>
      </div>
    </article>
  );
}

/** Re-exported for the workspace's "related tools" list and for tests. */
export { findBusinessTool };
