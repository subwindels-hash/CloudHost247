import { Link, useParams } from 'react-router-dom';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { ApproxAmount } from '../components/ApproxAmount';
import { useApiResource } from '../lib/useApiResource';
import { usePageMeta } from '../lib/usePageMeta';
import { formatPrice, type CatalogListResponse, type ProductPlansResponse } from '../lib/catalog-types';
import { money, titleCase, type PlatformPlan } from '../lib/platform-api';

const PLATFORM_SERVICES: Record<string, string> = {
  website_builder: 'Website Builder',
  ai_builder: 'AI Website Builder',
  online_store: 'Online Store',
  marketing: 'Marketing',
  inbox: 'Unified Inbox',
  logo_maker: 'Logo Maker',
};

/** Published product and platform catalogues remain the source of truth. */
export function ServicePlansIndex() {
  usePageMeta('Service plans', 'Browse published CloudHost247 service plans and pricing.');
  const catalog = useApiResource<CatalogListResponse>('/api/v1/catalog/products');
  return (
    <main className="ch247-page ch247-page--wide ch247-stack">
      <div className="ch247-card">
        <h1>Service plans</h1>
        <p className="ch247-page__hint">Explore plans and published pricing for our services. Some services may not have plans available yet.</p>
      </div>
      <section className="ch247-card" aria-labelledby="catalog-services">
        <h2 id="catalog-services">Hosting, domains &amp; services</h2>
        {catalog.status === 'loading' && <CatalogLoadingBanner label="Loading services…" />}
        {catalog.status === 'error' && <CatalogErrorBanner message={catalog.message} />}
        {catalog.status === 'success' && catalog.data.products.length === 0 && <p>No services have been published in the catalogue yet.</p>}
        {catalog.status === 'success' && <div className="ch247-service-grid">
          {catalog.data.products.map((product) => (
            <article className="ch247-service-card" key={product.slug}>
              <h3>{product.name}</h3>
              {product.description && <p>{product.description}</p>}
              <p className="ch247-page__hint">{product.available ? 'View published plans and prices' : 'Not currently available'}</p>
              <Link className="ch247-button ch247-button--small" to={`/service-plans/catalog/${encodeURIComponent(product.slug)}`}>View plans</Link>
            </article>
          ))}
        </div>}
      </section>
      <section className="ch247-card" aria-labelledby="platform-services">
        <h2 id="platform-services">Website &amp; business tools</h2>
        <div className="ch247-service-grid">
          {Object.entries(PLATFORM_SERVICES).map(([kind, name]) => (
            <article className="ch247-service-card" key={kind}>
              <h3>{name}</h3>
              <Link className="ch247-button ch247-button--small" to={`/service-plans/platform/${kind}`}>View plans</Link>
            </article>
          ))}
        </div>
      </section>
      <p className="ch247-page__hint">Looking for a service that is not listed? <Link to="/contact">Contact us</Link> for availability.</p>
    </main>
  );
}

export function CatalogServicePlansPage() {
  const { slug = '' } = useParams();
  usePageMeta('Service plans', 'Explore published service plans.');
  const valid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
  const result = useApiResource<ProductPlansResponse>(`/api/v1/catalog/products/${encodeURIComponent(valid ? slug : 'invalid')}/plans`);
  return (
    <main className="ch247-page ch247-page--wide ch247-stack">
      <Link to="/service-plans">← All service plans</Link>
      {result.status === 'loading' && <CatalogLoadingBanner label="Loading plans and pricing…" />}
      {result.status === 'error' && (result.httpStatus === 404 ? <div className="ch247-card"><h1>Service not found</h1><p>This service is not in the published catalogue.</p></div> : <CatalogErrorBanner message={result.message} />)}
      {result.status === 'success' && <section className="ch247-card">
        <h1>{result.data.product.name} plans</h1>
        {result.data.product.description && <p>{result.data.product.description}</p>}
        {!result.data.product.available ? <p>This service is not currently available.</p> : result.data.plans.length === 0 ? <p>No plans have been published for this service yet.</p> : (
          <div className="ch247-plan-grid">
            {result.data.plans.map((plan) => <article className="ch247-plan-card" key={plan.slug}>
              <h2>{plan.name}</h2>
              {plan.description && <p>{plan.description}</p>}
              {plan.features.length > 0 && <ul className="ch247-plan-card__features">{plan.features.map((feature) => <li key={feature.name}>{feature.name}{feature.value ? `: ${feature.value}` : ''}</li>)}</ul>}
              {plan.pricing.length === 0 ? <p>Pricing has not been published for this plan yet.</p> : plan.pricing.map((price) => (
                <div className="ch247-plan-card__price" key={`${price.currency}-${price.billingPeriod}`}>
                  <p>{formatPrice(price)} <ApproxAmount amount={price.amount} currency={price.currency} />{price.setupFee ? ` (+ ${new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency }).format(price.setupFee)} setup)` : ''}</p>
                  {price.currency.toUpperCase() === 'USD' ? <Link className="ch247-button ch247-button--small" to={`/cart?${new URLSearchParams({ product: slug, plan: plan.slug, period: price.billingPeriod })}`}>Choose {price.billingPeriod.replace('_', ' ')}</Link> : <p className="ch247-page__hint">Online checkout is not available for this currency. <Link to="/contact">Contact us</Link>.</p>}
                </div>
              ))}
            </article>)}
          </div>
        )}
      </section>}
    </main>
  );
}

export function PlatformServicePlansPage() {
  const { kind = '' } = useParams();
  const name = PLATFORM_SERVICES[kind];
  usePageMeta(name ? `${name} plans` : 'Service plans', 'Explore published platform service plans.');
  const result = useApiResource<{ plans: PlatformPlan[] }>('/api/v1/platform-services/plans');
  const plans = result.status === 'success' ? result.data.plans.filter((plan) => plan.service_kind === kind) : [];
  return (
    <main className="ch247-page ch247-page--wide ch247-stack">
      <Link to="/service-plans">← All service plans</Link>
      {!name ? <div className="ch247-card"><h1>Service not found</h1></div> : <section className="ch247-card">
        <h1>{name} plans</h1>
        {result.status === 'loading' && <CatalogLoadingBanner label="Loading plans and pricing…" />}
        {result.status === 'error' && <CatalogErrorBanner message={result.message} />}
        {result.status === 'success' && plans.length === 0 && <p>No plans have been published for this service yet.</p>}
        {result.status === 'success' && plans.length > 0 && <div className="ch247-plan-grid">{plans.map((plan) => (
          <article className="ch247-plan-card" key={plan.id}>
            <h2>{plan.name}</h2>
            {plan.description && <p>{plan.description}</p>}
            <p className="ch247-plan-card__price">{money(plan.price_amount, plan.currency)} / {titleCase(plan.billing_period)} <ApproxAmount amount={Number(plan.price_amount)} currency={plan.currency} /></p>
            {plan.features.length > 0 && <ul className="ch247-plan-card__features">{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>}
            {plan.currency.toUpperCase() === 'USD' ? <Link className="ch247-button ch247-button--small" to={`/cart?add=${encodeURIComponent(`${kind}:${plan.code}`)}`}>Choose plan</Link> : <p className="ch247-page__hint">Online checkout is not available for this currency. <Link to="/contact">Contact us</Link>.</p>}
          </article>
        ))}</div>}
      </section>}
    </main>
  );
}
