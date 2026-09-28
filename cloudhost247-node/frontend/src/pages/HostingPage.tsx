import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import type { CatalogListResponse } from '../lib/catalog-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

/**
 * `/hosting` is now the real catalog/category landing page (Phase 3): the primary content below
 * is fetched live from GET /api/v1/catalog rather than hard-coded, so a category an administrator
 * enables/disables through the catalog admin API (src/routes/catalog-admin.ts) is reflected here
 * immediately, with no frontend code change or redeploy.
 *
 * `KNOWN_DEDICATED_PAGES` is only a *link* map — which catalog product slugs happen to have a
 * dedicated content page built on this platform so far (cPanel Hosting, VPS Hosting). It does not
 * gate what the catalog API returns.
 *
 * `STATIC_NOT_YET_CATALOGUED` covers real, currently-published CloudHost247 service lines (see
 * faqs.php's "What services do you offer?" answer, also reused verbatim on /faq) that simply
 * don't have a row in this app's catalog database yet — the catalog starts empty until an
 * administrator configures it (see docs/API_CATALOG.md), so this list prevents the page looking
 * emptier than the real, current service lineup actually is. It is never a substitute for real
 * catalog data once a category *is* configured — see the empty-catalog handling below.
 */
const KNOWN_DEDICATED_PAGES: Record<string, string> = {
  'cpanel-hosting': '/hosting/cpanel',
  'vps-hosting': '/hosting/vps',
};

const STATIC_NOT_YET_CATALOGUED = [
  { title: 'Shared Hosting', description: 'Entry-level hosting for smaller sites, sharing server resources.' },
  { title: 'Dedicated Hosting', description: 'An entire physical server for maximum performance and isolation.' },
  { title: 'Cloud Hosting Solutions', description: 'Scalable, cloud-based hosting infrastructure.' },
  { title: 'Managed Server Support', description: 'Hands-on server administration and maintenance.' },
  { title: 'Email Hosting', description: 'Send and receive mail on your own domain.' },
];

export default function HostingPage() {
  usePageMeta('Hosting', 'CloudHost247 hosting plans and services.');
  const catalog = useApiResource<CatalogListResponse>('/api/v1/catalog');

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Hosting</h1>
          <p>Cloud hosting and infrastructure services, built for dependable performance and transparent billing.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide">
          {catalog.status === 'loading' && <CatalogLoadingBanner label="Loading service catalog…" />}
          {catalog.status === 'error' && <CatalogErrorBanner message={catalog.message} />}

          <div className="ch247-index-grid">
            {catalog.status === 'success' &&
              catalog.data.products.map((product) => {
                const dedicatedPage = KNOWN_DEDICATED_PAGES[product.slug];
                const canLink = product.available && dedicatedPage;
                return (
                  <div className="ch247-index-card" key={product.slug}>
                    <span
                      className={`ch247-index-card__status ${
                        product.available ? 'ch247-index-card__status--available' : 'ch247-index-card__status--pending'
                      }`}
                    >
                      {product.available ? 'Available here' : 'Coming soon'}
                    </span>
                    <h3>{product.name}</h3>
                    {product.description && <p>{product.description}</p>}
                    {canLink ? (
                      <NavLink to={dedicatedPage}>View details →</NavLink>
                    ) : (
                      <p className="ch247-page__hint">
                        <em>{product.available ? 'Details coming soon.' : "This service line is being finalized — check back soon."}</em>
                      </p>
                    )}
                  </div>
                );
              })}

            {STATIC_NOT_YET_CATALOGUED.map((category) => (
              <div className="ch247-index-card" key={category.title}>
                <span className="ch247-index-card__status ch247-index-card__status--pending">On the current site</span>
                <h3>{category.title}</h3>
                <p>{category.description}</p>
                <p className="ch247-page__hint">
                  <em>Not yet built on this platform — see the current CloudHost247 site or contact us for details.</em>
                </p>
              </div>
            ))}
          </div>

          {catalog.status === 'success' && catalog.data.products.length === 0 && (
            <p className="ch247-page__hint">No hosting categories have been added to this platform&apos;s live catalog yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
