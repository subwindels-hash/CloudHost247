import { useApiResource } from '../lib/useApiResource';
import { formatPrice, type ProductPlansResponse } from '../lib/catalog-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from './CatalogStateBanner';

/**
 * Live plan/pricing block shared by the cPanel Hosting and VPS Hosting pages, backed by
 * GET /api/v1/catalog/products/:slug/plans (src/routes/catalog-public.ts). Every state this data
 * can actually be in is handled explicitly and honestly — there is no fallback to fabricated plan
 * names or prices at any point:
 *
 *  - loading:                a visible loading banner
 *  - network/server/malformed error: a visible error banner with the real error message
 *  - 404 (product not yet in the catalog at all): "hasn't been added to the catalog yet"
 *  - product exists but is still draft/unavailable: "being finalized"
 *  - product available but zero published plans: "no plans published yet"
 *  - a plan with zero published pricing rows: that specific plan says so, individually —
 *    it is never hidden and never shown with an invented price
 */
export function ProductPlansSection({ slug }: { slug: string }) {
  const result = useApiResource<ProductPlansResponse>(`/api/v1/catalog/products/${slug}/plans`);

  if (result.status === 'loading') {
    return <CatalogLoadingBanner label="Loading plans and pricing…" />;
  }

  if (result.status === 'error') {
    if (result.httpStatus === 404) {
      return (
        <p className="ch247-placeholder-notice">
          Plan tiers and pricing for this service haven&apos;t been added to this platform&apos;s live catalog yet —
          check back soon, or create an account and we&apos;ll follow up with current options.
        </p>
      );
    }
    return <CatalogErrorBanner message={result.message} />;
  }

  const { product, plans } = result.data;

  if (!product.available) {
    return (
      <p className="ch247-placeholder-notice">
        This service is being finalized in our catalog and isn&apos;t available yet — check back soon.
      </p>
    );
  }

  if (plans.length === 0) {
    return <p className="ch247-placeholder-notice">No plans have been published for this service yet.</p>;
  }

  return (
    <div className="ch247-plan-grid">
      {plans.map((plan) => (
        <div className="ch247-plan-card" key={plan.slug}>
          <h3>{plan.name}</h3>
          {plan.description && <p>{plan.description}</p>}

          {plan.pricing.length === 0 ? (
            <p className="ch247-plan-card__price-unpublished">Pricing hasn&apos;t been published for this plan yet.</p>
          ) : (
            <div className="ch247-plan-card__price">
              {plan.pricing.map((price) => (
                <div key={price.billingPeriod}>
                  {formatPrice(price)}
                  {price.setupFee ? ` (+ setup fee)` : ''}
                </div>
              ))}
            </div>
          )}

          {plan.features.length > 0 && (
            <ul className="ch247-plan-card__features">
              {plan.features.map((feature) => (
                <li key={feature.name}>
                  {feature.name}
                  {feature.value ? `: ${feature.value}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
