import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import type { CatalogListResponse } from '../lib/catalog-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { ProductPlansSection } from '../components/ProductPlansSection';

/**
 * Public "Domains" marketing/info page — distinct from the authenticated /account/domains page,
 * which manages domains already on a signed-in customer's account.
 *
 * Phase 3 deliberately keeps two things separate, as required:
 *  1. Catalog capability — whether this app's own catalog (products/product_plans/pricing) has
 *     any domain-type entries configured, which this page now queries for real via
 *     GET /api/v1/catalog/products?type=domain and renders honestly (including "none configured
 *     yet").
 *  2. Real domain availability/search/registration — actually checking whether a specific domain
 *     name is free and registering it requires a live registrar/WHMCS connection
 *     (modules/addons/cloudhost247_domain_lookup, domain.php, tblpricing) that this Node app does
 *     not have yet. That stays explicitly "not yet connected" regardless of what the catalog
 *     query above returns — having a "Domain Registration" catalog product does not imply a
 *     working search box or live TLD availability, and this page must never imply otherwise.
 */
export default function DomainsMarketingPage() {
  usePageMeta('Domains', 'Domain registration and management at CloudHost247.');
  const catalog = useApiResource<CatalogListResponse>('/api/v1/catalog/products?type=domain');

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Domains</h1>
          <p>Register and manage domain names alongside your hosting.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <p>
            Domain registration and management is one of our services, alongside hosting, email,
            SSL, and backups.
          </p>

          <p className="ch247-placeholder-notice">
            Domain search, live availability checks, and online registration aren&apos;t connected
            on this platform yet — this app doesn&apos;t have a live connection to a domain
            registry/registrar system, so we&apos;re not showing a search box or availability
            results that wouldn&apos;t actually work. Existing customers can manage their domains
            from the current client area; new customers can create an account below and we&apos;ll
            follow up about domain options.
          </p>

          <h2>Domain catalog</h2>
          {catalog.status === 'loading' && <CatalogLoadingBanner label="Loading domain catalog…" />}
          {catalog.status === 'error' && <CatalogErrorBanner message={catalog.message} />}
          {catalog.status === 'success' && catalog.data.products.length === 0 && (
            <p className="ch247-page__hint">No domain products have been configured in this platform&apos;s catalog yet.</p>
          )}
          {catalog.status === 'success' &&
            catalog.data.products.map((product) => (
              <div key={product.slug} style={{ marginBottom: '1.5rem' }}>
                <h3>{product.name}</h3>
                {product.description && <p>{product.description}</p>}
                {!product.available && (
                  <p className="ch247-page__hint">
                    <em>This is being finalized and isn&apos;t available yet.</em>
                  </p>
                )}
                {product.available && <ProductPlansSection slug={product.slug} />}
              </div>
            ))}

          <p>
            Domain registrations are governed by our Domain Registration Agreement and Domain Name
            Auto-Renewal and Deletion Policy — see the <NavLink to="/legal">Legal &amp; Policy Center</NavLink>.
          </p>
          <NavLink className="ch247-button" to="/register">
            Create your account
          </NavLink>
        </div>
      </section>
    </div>
  );
}
