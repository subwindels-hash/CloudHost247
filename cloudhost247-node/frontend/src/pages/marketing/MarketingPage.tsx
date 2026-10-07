import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon, CheckIcon, ArrowIcon } from '../../components/ui/Icon';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../../components/CatalogStateBanner';
import { useApiResource } from '../../lib/useApiResource';
import { ProductPlansSection } from '../../components/ProductPlansSection';
import type { CatalogListResponse, ProductPlansResponse, PublicPlan } from '../../lib/catalog-types';
import { usePageMeta } from '../../lib/usePageMeta';
import { findPage, type MarketingItem, type MarketingPage, type MarketingSection } from '../../content/registry';

/**
 * The marketing page renderer.
 *
 * Every public product page on this site is the same component reading a different content object
 * from `shared/site/content/*.json`. That is what makes a fifty-page site consistent: the hero,
 * the breadcrumb, the section rhythm, the FAQ block, the related-services grid and the closing CTA
 * are defined once, and a page author only supplies content.
 *
 * Section types are deliberately a closed set (`features`, `cards`, `steps`, `split`, `checks`,
 * `note`, `table`, plus the live-data ones). An unknown type is a generation error, not a silently
 * missing block, so a page can never render half-built.
 *
 * Live-data sections (`catalog`, `live-locations`, `live-status`, `site-search`, `doc-index`,
 * `news`) are the only ones that fetch. Everything else is static content in the bundle, which is
 * why a product page paints immediately and works with JavaScript-only routing.
 */

const ART = '/media/cloudhost247';

function Visual({ page }: { page: MarketingPage }) {
  return (
    <figure className="ch-visual" style={{ margin: 0 }}>
      <img
        src={`${ART}/${page.visual}.svg`}
        alt={`CloudHost247 ${page.title} — infrastructure illustration`}
        width={660}
        height={520}
        loading="eager"
        decoding="async"
      />
      <figcaption className="ch-visual__caption">
        <span>CloudHost247</span>
        <span>{page.category}</span>
      </figcaption>
    </figure>
  );
}

function Breadcrumbs({ page }: { page: MarketingPage }) {
  const trail = useMemo(() => {
    const parts = page.route.split('/').filter(Boolean);
    const crumbs: Array<{ label: string; to: string }> = [{ label: 'Home', to: '/' }];
    let path = '';
    parts.forEach((part, index) => {
      path += `/${part}`;
      const isLast = index === parts.length - 1;
      const known = findPage(path);
      const label = isLast
        ? page.title
        : known?.title ?? part.replace(/-/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
      crumbs.push({ label, to: path });
    });
    return crumbs;
  }, [page]);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.label,
      item: crumb.to,
    })),
  };

  return (
    <>
      <nav className="ch-breadcrumbs" aria-label="Breadcrumb">
        <div className="ch-wrap">
          <ol>
            {trail.map((crumb, index) => {
              const last = index === trail.length - 1;
              return (
                <li key={crumb.to}>
                  {last ? (
                    <span aria-current="page">{crumb.label}</span>
                  ) : (
                    <Link to={crumb.to}>{crumb.label}</Link>
                  )}
                  {last ? null : <span aria-hidden>/</span>}
                </li>
              );
            })}
          </ol>
        </div>
      </nav>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
    </>
  );
}

function SectionItems({ items, columns = 3 }: { items: MarketingItem[]; columns?: number }) {
  return (
    <div className={`ch-grid ch-grid--${columns}`}>
      {items.map((item, index) => {
        const key = `${item.title ?? item.label ?? 'item'}-${index}`;
        const icon = item.icon ? (
          <span className="ch-card__icon" aria-hidden>
            <Icon name={item.icon} />
          </span>
        ) : null;
        const body = (
          <>
            {icon}
            <h3>{item.title ?? item.label}</h3>
            {item.body ? <p>{item.body}</p> : null}
            {item.link ? (
              <span className="ch-card__foot">
                <span className="ch-link">
                  {item.link.label}
                  <span className="ch-link__arrow" aria-hidden><ArrowIcon /></span>
                </span>
              </span>
            ) : item.to ? (
              <span className="ch-card__foot">
                <span className="ch-link">
                  Learn more
                  <span className="ch-link__arrow" aria-hidden><ArrowIcon /></span>
                </span>
              </span>
            ) : null}
          </>
        );
        return item.to ? (
          <Link key={key} className="ch-card" to={item.to} id={item.anchorId}>
            {body}
          </Link>
        ) : (
          <article key={key} className="ch-card" id={item.anchorId}>
            {body}
          </article>
        );
      })}
    </div>
  );
}

function Split({ section }: { section: MarketingSection }) {
  return (
    <div className="ch-split">
      <div>
        {section.kicker ? <p className="ch-kicker">{section.kicker}</p> : null}
        {section.heading ? <h2>{section.heading}</h2> : null}
        {(section.lede ? [section.lede] : []).concat(
          Array.isArray((section as { body?: string[] }).body) ? (section as unknown as { body: string[] }).body : []
        ).map((paragraph) => (
          <p key={paragraph.slice(0, 24)} className="ch-lede">{paragraph}</p>
        ))}
        {section.items?.length ? (
          <ul className="ch-check-list" style={{ marginTop: '22px' }}>
            {section.items.map((item) => (
              <li key={item.label ?? item.title}>
                <span className="ch-check-list__mark" aria-hidden><CheckIcon /></span>
                <span>
                  <strong>{item.label ?? item.title}</strong>
                  {item.body ? <span className="ch-check-list__body">{item.body}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {section.links?.length
          ? section.links.map((link) => (
              <p key={link.to} style={{ marginTop: '20px', marginBottom: 0 }}>
                <Link className="ch-link" to={link.to ?? '/'}>
                  {link.label}
                  <span className="ch-link__arrow" aria-hidden><ArrowIcon /></span>
                </Link>
              </p>
            ))
          : null}
      </div>
      <div>
        <div className="ch-visual" style={{ background: 'var(--ch-soft)', borderColor: 'var(--ch-line)' }}>
          <img
            src={`${ART}/${(section as { visual?: string }).visual ?? 'hero/infrastructure'}.svg`}
            alt=""
            width={660}
            height={520}
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </div>
  );
}

function Checks({ section }: { section: MarketingSection }) {
  return (
    <ul className="ch-check-list">
      {section.items?.map((item) => (
        <li key={(item.label ?? item.title) as string}>
          <span className="ch-check-list__mark" aria-hidden><CheckIcon /></span>
          <span>
            <strong>{item.label ?? item.title}</strong>
            {item.body ? <span className="ch-check-list__body">{item.body}</span> : null}
            {item.link ? (
              <span className="ch-check-list__body">
                <Link to={item.link.to}>{item.link.label}</Link>
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Steps({ section }: { section: MarketingSection }) {
  return (
    <ol className="ch-steps">
      {section.items?.map((item, index) => (
        <li className="ch-step" key={(item.title ?? item.label) as string}>
          <span className="ch-step__index" aria-hidden>{String(index + 1).padStart(2, '0')}</span>
          <div>
            <h3>{item.title ?? item.label}</h3>
            <p>{item.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Table({ section }: { section: MarketingSection }) {
  return (
    <>
      <div className="ch-table-wrap">
        <table className="ch-table">
          {section.columns ? (
            <thead>
              <tr>{section.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
            </thead>
          ) : null}
          <tbody>
            {(section.rows ?? []).map((row, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {section.note ? <p className="ch-muted" style={{ marginTop: '14px', fontSize: '0.85rem' }}>{section.note}</p> : null}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Live-data sections                                                   */
/* ------------------------------------------------------------------ */

interface LocationRow {
  code: string;
  name: string;
  countryCode: string | null;
  provider: string;
  datacenters: number;
}

function LiveLocations({ section }: { section: MarketingSection }) {
  const state = useApiResource<{ configured: boolean; locations: LocationRow[] }>('/api/v1/public/locations');

  return (
    <>
      <h2>{section.heading}</h2>
      {state.status === 'loading' ? <CatalogLoadingBanner label="Reading configured regions…" /> : null}
      {state.status === 'error' ? <CatalogErrorBanner message={state.message} /> : null}
      {state.status === 'success' ? (
        state.data.locations.length > 0 ? (
          <div className="ch-grid ch-grid--3">
            {state.data.locations.map((location) => (
              <article className="ch-card" key={location.code}>
                <span className="ch-card__icon" aria-hidden><Icon name="data-center" /></span>
                <h3>{location.name}</h3>
                <p>
                  <strong>{location.provider}</strong>
                  {location.countryCode ? ` · ${location.countryCode}` : ''}
                  <br />
                  {location.datacenters > 0
                    ? `${location.datacenters} configured ${location.datacenters === 1 ? 'facility' : 'facilities'}`
                    : 'Facility details are not itemised for this region'}
                </p>
                <span className="ch-card__foot">
                  <span className="ch-pill">Region code {location.code}</span>
                </span>
              </article>
            ))}
          </div>
        ) : (
          <div className="ch-state ch-state--warn">
            <Icon name="alert" size={20} />
            <span>
              <strong>No regions are configured on this deployment.</strong>
              {section.emptyMessage}
            </span>
          </div>
        )
      ) : null}
    </>
  );
}

interface StatusComponent {
  id: string;
  name: string;
  state: 'operational' | 'degraded' | 'unmonitored';
  detail: string;
}

function LiveStatus({ section }: { section: MarketingSection }) {
  const state = useApiResource<{ monitored: boolean; checkedAt: string; components: StatusComponent[] }>('/api/v1/public/status');

  const label = (value: StatusComponent['state']) => (
    value === 'operational' ? 'Operational' : value === 'degraded' ? 'Degraded' : 'Not monitored'
  );
  const dot = (value: StatusComponent['state']) => (
    value === 'operational' ? 'ok' : value === 'degraded' ? 'down' : 'unknown'
  );

  return (
    <>
      <h2>{section.heading}</h2>
      {state.status === 'loading' ? <CatalogLoadingBanner label="Running checks…" /> : null}
      {state.status === 'error' ? <CatalogErrorBanner message={state.message} /> : null}
      {state.status === 'success' ? (
        <>
          <p className="ch-muted" style={{ fontSize: '0.85rem' }}>
            Checked at {new Date(state.data.checkedAt).toLocaleString()}. Independent historical
            monitoring is not configured{state.data.monitored ? '' : ', so no uptime percentage is published'}.
          </p>
          <div className="ch-status-grid">
            {state.data.components.map((component) => (
              <div className="ch-status-row" key={component.id}>
                <span className="ch-status-row__name">
                  <span className={`ch-status-dot ch-status-dot--${dot(component.state)}`} aria-hidden />
                  {component.name}
                </span>
                <span className="ch-status-row__meta">
                  <strong>{label(component.state)}</strong> — {component.detail}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function planPrice(plan: PublicPlan) {
  const pricing = [...(plan.pricing ?? [])].sort((a, b) => a.amount - b.amount)[0];
  return pricing ?? null;
}

function Catalog({ section }: { section: MarketingSection }) {
  const catalog = useApiResource<CatalogListResponse>('/api/v1/catalog');
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const plans = useApiResource<ProductPlansResponse>(openSlug ? `/api/v1/catalog/products/${openSlug}/plans` : '');

  return (
    <>
      <h2>{section.heading}</h2>
      {catalog.status === 'loading' ? <CatalogLoadingBanner label="Loading the product catalogue…" /> : null}
      {catalog.status === 'error' ? <CatalogErrorBanner message={catalog.message} /> : null}
      {catalog.status === 'success' && catalog.data.products.length === 0 ? (
        <div className="ch-state ch-state--warn">
          <Icon name="alert" size={20} />
          <span>
            <strong>No products are published in this catalogue yet.</strong>
            This page reads the live catalogue rather than a static price list, so an unconfigured
            deployment shows nothing here instead of invented pricing. Contact us for current plans.
          </span>
        </div>
      ) : null}

      {catalog.status === 'success' && catalog.data.products.length > 0 ? (
        <div className="ch-grid ch-grid--3">
          {catalog.data.products.map((product) => (
            <article className="ch-card" key={product.slug}>
              <span className="ch-card__icon" aria-hidden><Icon name="layers" /></span>
              <h3>{product.name}</h3>
              {product.description ? <p>{product.description}</p> : null}
              <span className="ch-card__foot">
                {product.available ? (
                  <button
                    type="button"
                    className="ch-btn ch-btn--outline ch-btn--sm"
                    onClick={() => setOpenSlug(openSlug === product.slug ? null : product.slug)}
                    aria-expanded={openSlug === product.slug}
                  >
                    {openSlug === product.slug ? 'Hide plans' : 'View plans'}
                  </button>
                ) : (
                  <span className="ch-pill">Not configured for this deployment</span>
                )}
              </span>

              {openSlug === product.slug ? (
                <div style={{ marginTop: '14px' }}>
                  {plans.status === 'loading' ? <CatalogLoadingBanner label="Loading plans…" /> : null}
                  {plans.status === 'error' ? <CatalogErrorBanner message={plans.message} /> : null}
                  {plans.status === 'success' ? (
                    plans.data.plans.length > 0 ? (
                      <ul className="ch-plan-grid" style={{ listStyle: 'none', padding: 0, gridTemplateColumns: '1fr' }}>
                        {plans.data.plans.map((plan) => {
                          const price = planPrice(plan);
                          return (
                            <li className="ch-plan" key={plan.slug}>
                              <h3>{plan.name}</h3>
                              {plan.description ? <p className="ch-muted" style={{ fontSize: '0.85rem' }}>{plan.description}</p> : null}
                              {price ? (
                                <p className="ch-plan__price">
                                  {price.amount.toFixed(2)} <small>{price.currency} / {price.billingPeriod.replace('_', ' ')}</small>
                                </p>
                              ) : (
                                <p className="ch-muted" style={{ fontSize: '0.85rem' }}>Price is not published for this plan.</p>
                              )}
                              {plan.features?.length ? (
                                <ul>
                                  {plan.features.slice(0, 6).map((feature) => (
                                    <li key={feature.name}>
                                      {feature.name}
                                      {feature.value ? `: ${feature.value}` : ''}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                              <Link className="ch-btn ch-btn--sm" to={`/cart?plan=${encodeURIComponent(plan.slug)}`}>
                                Add to cart
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <div className="ch-state">
                        <span>No plans are published for this product yet.</span>
                      </div>
                    )
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </>
  );
}

interface SearchEntry {
  title: string;
  to: string;
  kind: string;
  description: string;
}

function SiteSearch({ section }: { section: MarketingSection }) {
  const [query, setQuery] = useState('');
  const entries: SearchEntry[] = useMemo(() => {
    const list: SearchEntry[] = [];
    for (const page of MARKETING_INDEX) {
      list.push({ title: page.title, to: page.route, kind: page.category, description: page.description });
    }
    for (const document of DOCUMENT_INDEX) {
      list.push({ title: document.title, to: document.href, kind: `Documentation · ${document.section}`, description: document.summary });
    }
    for (const tool of TOOL_INDEX.tools) {
      list.push({ title: tool.name, to: tool.path, kind: 'Tool', description: tool.description });
    }
    return list;
  }, []);

  const needle = query.trim().toLowerCase();
  const results = needle.length < 2
    ? []
    : entries.filter((entry) =>
        entry.title.toLowerCase().includes(needle)
        || entry.description.toLowerCase().includes(needle)
        || entry.kind.toLowerCase().includes(needle)
      ).slice(0, 40);

  return (
    <>
      <h2>{section.heading}</h2>
      <form className="ch-search-box" role="search" onSubmit={(event) => event.preventDefault()}>
        <label className="ch-visually-hidden" htmlFor="ch-site-search">Search services, tools and documents</label>
        <input
          id="ch-site-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Try “vps”, “dns”, “refund”, “deployment”…"
          autoComplete="off"
        />
      </form>
      <p className="ch-muted" style={{ fontSize: '0.82rem', marginTop: '10px' }}>
        Searched in your browser — the query is never sent to the server.
      </p>
      {needle.length >= 2 ? (
        results.length > 0 ? (
          <div className="ch-grid ch-grid--2" style={{ marginTop: '24px' }}>
            {results.map((result) => (
              <Link className="ch-card" to={result.to} key={`${result.kind}-${result.to}-${result.title}`}>
                <span className="ch-pill">{result.kind}</span>
                <h3>{result.title}</h3>
                <p>{result.description}</p>
              </Link>
            ))}
          </div>
        ) : (
          <div className="ch-state" style={{ marginTop: '24px' }}>
            <span>
              Nothing matched “{query}”. Try a service name, a tool, or a policy — or{' '}
              <Link to="/contact">ask us directly</Link>.
            </span>
          </div>
        )
      ) : null}
    </>
  );
}

import { MARKETING_PAGES, DOCUMENTS as DOCUMENT_INDEX } from '../../content/registry';
import TOOL_INDEX from '../../content/tools.generated.json';
import News from '../../components/marketing/News';
import DocIndex from '../../components/marketing/DocIndex';

const MARKETING_INDEX = MARKETING_PAGES;

/* ------------------------------------------------------------------ */

function renderSection(section: MarketingSection, index: number) {
  const key = `${section.type}-${section.heading ?? index}`;
  const heading = section.heading ? <h2>{section.heading}</h2> : null;
  const kicker = section.kicker ? <p className="ch-kicker">{section.kicker}</p> : null;

  switch (section.type) {
    case 'live-locations':
      return <section className="ch-section ch-section--soft" key={key}><div className="ch-wrap"><LiveLocations section={section} /></div></section>;
    case 'live-status':
      return <section className="ch-section" key={key}><div className="ch-wrap"><LiveStatus section={section} /></div></section>;
    case 'catalog':
      return <section className="ch-section ch-section--soft" key={key}><div className="ch-wrap"><Catalog section={section} /></div></section>;
    case 'site-search':
      return <section className="ch-section" key={key}><div className="ch-wrap">{kicker}<SiteSearch section={section} /></div></section>;
    case 'plans':
      return (
        <section className={`ch-section${index % 2 === 1 ? ' ch-section--soft' : ''}`} key={key}>
          <div className="ch-wrap">
            {(kicker || heading) ? (
              <div className="ch-section__head">
                <div>
                  {kicker}
                  {heading}
                </div>
                {section.lede ? <p className="ch-lede">{section.lede}</p> : null}
              </div>
            ) : null}
            <ProductPlansSection slug={(section as { productSlug: string }).productSlug} />
          </div>
        </section>
      );
    case 'doc-index':
      return <section className="ch-section ch-section--soft" key={key}><div className="ch-wrap"><DocIndex section={section} /></div></section>;
    case 'news':
      return <section className="ch-section" key={key}><div className="ch-wrap"><News section={section} /></div></section>;
    default:
      break;
  }

  const soft = index % 2 === 1;

  if (section.type === 'split') {
    return (
      <section className={`ch-section${soft ? ' ch-section--soft' : ''}`} key={key}>
        <div className="ch-wrap"><Split section={section} /></div>
      </section>
    );
  }

  return (
    <section className={`ch-section${soft ? ' ch-section--soft' : ''}`} key={key}>
      <div className="ch-wrap">
        {(kicker || heading || section.lede) ? (
          <div className="ch-section__head">
            <div>
              {kicker}
              {heading}
            </div>
            {section.lede ? <p className="ch-lede">{section.lede}</p> : null}
          </div>
        ) : null}

        {section.type === 'features' && section.items ? <SectionItems items={section.items} columns={3} /> : null}
        {section.type === 'cards' && section.items ? <SectionItems items={section.items} columns={3} /> : null}
        {section.type === 'steps' && section.items ? <Steps section={section} /> : null}
        {section.type === 'checks' && section.items ? <Checks section={section} /> : null}
        {section.type === 'table' ? <Table section={section} /> : null}
        {section.type === 'note' ? (
          <div className="ch-note ch-wrap--prose" style={{ marginInline: 0 }}>
            <h3>{section.heading}</h3>
            <p>{section.note ?? section.lede}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function MarketingPage() {
  const location = useLocation();
  const page = findPage(location.pathname);

  usePageMeta(page?.seoTitle ?? 'Page not found', page?.description, {
    canonical: page?.route,
    noIndex: page?.noindex,
    og: { type: 'website', image: page ? `${ART}/${page.visual}.svg` : undefined },
    jsonLd: page
      ? {
          '@context': 'https://schema.org',
          '@type': 'WebPage',
          name: page.seoTitle,
          description: page.description,
          ...(page.faqs.length
            ? {
                mainEntity: page.faqs.map((faq) => ({
                  '@type': 'Question',
                  name: faq.q,
                  acceptedAnswer: { '@type': 'Answer', text: faq.a },
                })),
              }
            : {}),
        }
      : undefined,
  });

  if (!page) {
    // The router's catch-all renders NotFoundPage, so reaching here means a page definition was
    // removed while a link to it remains. Say so plainly instead of bouncing the visitor around.
    return (
      <div className="ch-ds">
        <section className="ch-section">
          <div className="ch-wrap ch-wrap--prose">
            <h1>That page is not available</h1>
            <p className="ch-lede">
              The address may have changed. Everything currently published is listed in the sitemap.
            </p>
            <div className="ch-cta__actions">
              <Link className="ch-btn ch-btn--mint" to="/sitemap">Open the sitemap</Link>
              <Link className="ch-btn ch-btn--outline" to="/">Back to the homepage</Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const related = page.related
    .map((route) => findPage(route))
    .filter((candidate): candidate is MarketingPage => Boolean(candidate))
    .slice(0, 6);

  return (
    <div className="ch-ds">
      <Breadcrumbs page={page} />

      <section className="ch-hero">
        <div className="ch-wrap">
          <div className="ch-hero__inner">
            <div>
              {page.hero.kicker ? <p className="ch-kicker">{page.hero.kicker}</p> : null}
              <h1>{page.hero.heading}</h1>
              <p className="ch-lede">{page.hero.lede}</p>
              {page.hero.ctas.length ? (
                <div className="ch-hero__ctas">
                  {page.hero.ctas.map((cta) => (
                    <Link
                      key={`${cta.to}-${cta.label}`}
                      className={`ch-btn ${cta.variant === 'primary' ? 'ch-btn--mint' : 'ch-btn--on-ink'}`}
                      to={cta.to}
                    >
                      {cta.label}
                    </Link>
                  ))}
                </div>
              ) : null}
              {page.hero.points?.length ? (
                <ul className="ch-hero__points">
                  {page.hero.points.map((point) => (
                    <li key={point}>
                      <CheckIcon size={15} />
                      {point}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <Visual page={page} />
          </div>
        </div>
      </section>

      {page.sections.map(renderSection)}

      {page.faqs.length ? (
        <section className="ch-section ch-section--soft">
          <div className="ch-wrap">
            <div className="ch-section__head">
              <div>
                <p className="ch-kicker">Questions</p>
                <h2>{page.title} — frequently asked</h2>
              </div>
              <p className="ch-lede">
                If something here is not answered, the support team answers tickets rather than
                escalating them to a FAQ.
              </p>
            </div>
            <div className="ch-wrap--prose" style={{ width: '100%' }}>
              {page.faqs.map((faq) => (
                <details className="ch-faq" key={faq.q}>
                  <summary>{faq.q}</summary>
                  <p>{faq.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {related.length ? (
        <section className="ch-section">
          <div className="ch-wrap">
            <div className="ch-section__head">
              <div>
                <p className="ch-kicker">Related</p>
                <h2>Usually considered together</h2>
              </div>
            </div>
            <div className="ch-grid ch-grid--3">
              {related.map((candidate) => (
                <Link className="ch-card" to={candidate.route} key={candidate.route}>
                  <h3>{candidate.title}</h3>
                  <p>{candidate.hero.lede}</p>
                  <span className="ch-card__foot">
                    <span className="ch-link">
                      Read more
                      <span className="ch-link__arrow" aria-hidden><ArrowIcon /></span>
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="ch-cta">
        <div className="ch-wrap">
          <div className="ch-cta__inner">
            <div>
              <h2>Start with the account, decide the rest later</h2>
              <p>Create an account to see live pricing, order a service, or open a ticket with a question.</p>
            </div>
            <div className="ch-cta__actions">
              <Link className="ch-btn" to="/register">Create account</Link>
              <Link className="ch-btn ch-btn--outline" to="/contact">Talk to us</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
