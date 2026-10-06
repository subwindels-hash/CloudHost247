import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { CatalogErrorBanner } from '../../components/CatalogStateBanner';
import { Pill } from '../../components/platform/ui';
import { useNavigationSections } from '../../components/navigation/PlatformMegaMenu';
import { fetchPublishedPlans, money, titleCase, type PlatformPlan } from '../../lib/platform-api';
import type { NavSection } from '../../lib/platform-api';

/**
 * Landing page for a navigation section that is otherwise a group of tools rather than a single
 * product (currently Websites). The content comes from the same navigation definition the menu
 * renders plus the published plans, so nothing here can go stale or advertise an unpriced product.
 */
export default function PlatformHubPage({ sectionId, fallback }: { sectionId: string; fallback: { title: string; intro: string } }) {
  usePageMeta(fallback.title, fallback.intro, { canonical: `/${sectionId}` });
  const sections = useNavigationSections();
  const navError: string | null = null;
  const [plans, setPlans] = useState<PlatformPlan[]>([]);

  useEffect(() => {
    fetchPublishedPlans('website_builder')
      .then((response) => setPlans(response.plans))
      .catch(() => setPlans([]));
  }, []);

  const section = sections.find((entry: NavSection) => entry.id === sectionId);

  return (
    <div className="ch247-page">
      <h1>{fallback.title}</h1>
      <p className="ch247-page__hint">{fallback.intro}</p>
      {navError ? <CatalogErrorBanner message={navError} /> : null}

      {section ? (
        section.groups.map((group) => (
          <section key={group.title} className="ch247-card">
            <h2>{group.title}</h2>
            <div className="ch247-service-grid">
              {group.links.map((link) => (
                <article key={link.to} className="ch247-service-card">
                  <h3>
                    {link.label} {link.badge ? <Pill tone="ok">{link.badge}</Pill> : null}
                  </h3>
                  <p>{link.description}</p>
                  <div className="ch247-service-card__footer">
                    <Link className="ch247-button ch247-button--small" to={link.to}>
                      Open
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      ) : (
        <p className="ch247-page__hint">Loading the section…</p>
      )}

      {sectionId === 'websites' ? (
        <section className="ch247-card">
          <h2>Website plans</h2>
          {plans.length === 0 ? (
            <p>
              No website plan is published yet. An administrator publishes plans (with real prices) before they appear
              here — the platform never invents a price to fill the gap.
            </p>
          ) : (
            <div className="ch247-service-grid">
              {plans.map((plan) => (
                <article key={plan.id} className="ch247-service-card">
                  <h3>{plan.name}</h3>
                  <p>{plan.description}</p>
                  <ul className="ch247-plainlist">
                    {plan.features.slice(0, 5).map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <p className="ch247-page__hint">
                    {Object.entries(plan.limits ?? {})
                      .map(([key, value]) => `${titleCase(key)}: ${value}`)
                      .join(' · ') || ' '}
                  </p>
                  <div className="ch247-service-card__footer">
                    <span className="ch247-price">
                      {money(plan.price_amount, plan.currency)} <span className="ch247-page__hint">{titleCase(plan.billing_period)}</span>
                    </span>
                    <Link className="ch247-button ch247-button--small" to={`/cart?add=website_builder:${encodeURIComponent(plan.code)}`}>
                      Add to cart
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
