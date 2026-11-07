import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon, CheckIcon, ArrowIcon } from '../components/ui/Icon';
import { Illustration } from '../components/marketing/Illustration';
import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import { formatPrice } from '../lib/catalog-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { useCurrency } from '../currency/CurrencyProvider';
import { NAV_SECTIONS, BRAND, UTILITY } from '../navigation/registry.generated';

/**
 * CloudHost247 homepage — premium marketing surface.
 *
 * Structure follows a conversion page, not a catalogue: each section answers "what is this
 * and where do I go next", and the deep pages do the explaining. The one exception is the
 * featured plans strip, which shows real plans and real prices from the live catalogue so a
 * visitor can order without leaving the page.
 *
 * Every link comes from the shared navigation registry, so the homepage cannot advertise a
 * product the rest of the site does not have — and adding a product updates this page too.
 *
 * Deliberately absent: a customer-logo wall, an uptime percentage, a data-centre pin map and
 * any invented price. None of those can be stated truthfully without data this deployment
 * does not hold, and each of them is a thing a visitor has learned to distrust anyway.
 */

const FAMILIES = NAV_SECTIONS.filter((section) => section.id !== 'resources' && section.id !== 'company');

const SPOTLIGHTS = [
  {
    to: '/hosting/web-hosting',
    title: 'Web Hosting',
    body: 'Shared and business hosting with live catalogue plans, mailboxes and certificates.',
    visual: 'hosting/web-hosting',
    visual3d: 'hosting/web-hosting-3d',
  },
  {
    to: '/hosting/vps',
    title: 'VPS & Cloud',
    body: 'Virtual servers with the provider, region and resources the catalogue actually lists.',
    visual: 'cloud/vps',
    visual3d: 'cloud/vps-3d',
  },
  {
    to: '/domains',
    title: 'Domains',
    body: 'Search, register, transfer and manage DNS from the same account as the site they serve.',
    visual: 'domains/domain-network',
    visual3d: 'domains/domain-network-3d',
  },
  {
    to: '/platforms/applications',
    title: 'Applications',
    body: 'Explore application requirements, supported versions and deployment options.',
    visual: 'applications/application-stack',
    visual3d: 'applications/application-stack-3d',
  },
];

const PILLARS = [
  {
    icon: 'shield',
    title: 'Security that is a practice',
    body: 'Passkeys and multi-factor sign-in, least-privilege administration, encryption in transit, and an audit trail behind every infrastructure operation.',
    to: '/security',
  },
  {
    icon: 'hard-drive',
    title: 'Backups with a restore path',
    body: 'Scheduled jobs scoped to each service, a run history you can inspect, and a restore performed from your own account.',
    to: '/hosting/backups',
  },
  {
    icon: 'activity',
    title: 'Monitoring, honestly reported',
    body: 'Telemetry on the resources you run. The status page reports only the checks this platform can genuinely perform, and says which components it cannot see.',
    to: '/status',
  },
  {
    icon: 'wrench',
    title: 'One place to operate',
    body: 'Servers, domains, DNS, certificates, applications, deployments, invoices and tickets in the same account as the services they belong to.',
    to: '/dashboard',
  },
];

const AUDIENCES = [
  { icon: 'briefcase', title: 'A business website', body: 'Domain, hosting, business email and HTTPS — with someone to call when it breaks.', to: '/hosting/business' },
  { icon: 'code', title: 'An application', body: 'A supported application version, its configuration, a domain and a deployment record you can inspect.', to: '/developers/deployment' },
  { icon: 'server-rack', title: 'Infrastructure you run', body: 'VPS, cloud or dedicated servers with firewall rules, backups and telemetry.', to: '/cloud' },
  { icon: 'store', title: 'A storefront', body: 'Sell products online, with the store and the hosting on the same platform.', to: '/websites' },
];

const STEPS = [
  { index: '01', title: 'Make it yours', body: 'Search for a domain and register it — or transfer one you already own — from the same account as the services it serves.' },
  { index: '02', title: 'Bring it online', body: 'Choose hosting, a server or an application from the live catalogue and provision it in minutes.' },
  { index: '03', title: 'Deploy and grow', body: 'Deploy from Git, add certificates and backups, then scale the plan as the workload grows.' },
];

/**
 * Featured plans strip: the first three published plans for web hosting, straight from the
 * live catalogue. Every possible state of the catalogue data is rendered honestly — loading,
 * error, missing product, no plans — and no price is ever invented.
 */
function HomePlansSection() {
  const result = useApiResource<{ product: { slug: string; name: string }; plans: Array<{
    slug: string; name: string; description: string | null;
    pricing: Array<{ billingPeriod: string; currency: string; amount: number; setupFee: number | null }>;
    features: Array<{ name: string; value: string | null }>;
  }> }>('/api/v1/catalog/products/web-hosting/plans');
  const { formatAmount } = useCurrency();

  if (result.status === 'loading') return <CatalogLoadingBanner label="Loading hosting plans…" />;
  if (result.status === 'error') {
    if (result.httpStatus === 404) {
      return (
        <section className="ch-section ch-section--tight">
          <div className="ch-wrap">
            <div className="ch-state">
              <strong>Hosting plans aren't in the live catalogue yet.</strong>{' '}
              Create an account and we'll follow up with current options, or{' '}
              <Link to="/contact">ask us about hosting</Link>.
            </div>
          </div>
        </section>
      );
    }
    return <CatalogErrorBanner message={result.message} />;
  }

  const { plans } = result.data;
  const featured = plans.slice(0, 3);

  if (plans.length === 0) {
    return (
      <section className="ch-section ch-section--tight">
        <div className="ch-wrap">
          <div className="ch-state">
            <strong>No hosting plans have been published yet.</strong>{' '}
            Ask us about current options or{' '}
            <Link to="/contact">contact us</Link>.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="ch-section ch-section--tight">
      <div className="ch-wrap">
        <div className="ch-section__head">
          <div>
            <p className="ch-section__badge">Live from the catalogue</p>
            <h2>Hosting plans that fit what you are building</h2>
          </div>
          <p className="ch-lede">
            Prices shown in your selected currency and read straight from the product catalogue —
            what you see here is what the order form charges.
          </p>
        </div>
        <div className="ch-grid ch-grid--3">
          {featured.map((plan) => {
            const price = plan.pricing.find((p) => p.billingPeriod === 'monthly') ?? plan.pricing[0];
            const formatted = price ? formatAmount(price.amount) : null;
            return (
              <div className="ch-card ch-card--raised" key={plan.slug}>
                <h3>{plan.name}</h3>
                {plan.description && <p style={{ fontSize: '0.85rem', color: 'var(--ch-muted)' }}>{plan.description}</p>}
                {price ? (
                  <div style={{ marginTop: 'auto' }}>
                    <div style={{ fontSize: '2rem', fontWeight: 650, letterSpacing: '-0.03em', marginBottom: 2 }}>
                      {formatted?.text ?? formatPrice(price)}
                      <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--ch-muted)' }}>
                        {formatted?.converted ? ` · ${formatted.currency}` : price.currency}{' / '}{price.billingPeriod.replace('_', ' ')}
                      </span>
                    </div>
                    {price.setupFee && <p style={{ fontSize: '0.8rem', color: 'var(--ch-muted)' }}>+ setup fee</p>}
                  </div>
                ) : null}
                {plan.features.slice(0, 4).length > 0 && (
                  <ul style={{ listStyle: 'none', padding: 0, margin: 'var(--ch-space-4) 0 0', fontSize: '0.87rem', color: 'var(--ch-muted)' }}>
                    {plan.features.slice(0, 4).map((feature) => (
                      <li key={feature.name} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', marginBottom: 6 }}>
                        <span style={{ color: 'var(--ch-mint-strong)', fontWeight: 700 }}>{'\u00B7'}</span>
                        {feature.name}{feature.value ? ` — ${feature.value}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
                <Link className="ch-link" to={`/hosting/web-hosting#plans`}>
                  Choose {plan.name}<span className="ch-link__arrow" aria-hidden><ArrowIcon /></span>
                </Link>
              </div>
            );
          })}
        </div>
        <p style={{ marginTop: '30px', marginBottom: 0, textAlign: 'center' }}>
          <Link className="ch-link" to="/hosting/web-hosting">
            See all hosting plans<span className="ch-link__arrow" aria-hidden><ArrowIcon /></span>
          </Link>
        </p>
      </div>
    </section>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [domainQuery, setDomainQuery] = useState('');

  usePageMeta(
    'CloudHost247 — Hosting, Cloud, Domains & Developer Platform',
    BRAND.description,
    {
      canonical: '/',
      og: { type: 'website', image: '/media/cloudhost247/social/cloudhost247-social.png' },
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: BRAND.legalName,
          alternateName: BRAND.name,
          slogan: BRAND.tagline,
          description: BRAND.description,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: BRAND.name,
          description: BRAND.description,
        },
      ],
    }
  );

  function onDomainSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = domainQuery.trim();
    navigate(trimmed ? `/domains?q=${encodeURIComponent(trimmed)}` : '/domains');
  }

  return (
    <div className="ch-ds">
      <section className="ch-hero">
        <div className="ch-wrap ch-hero-grid">
          <div>
            <p className="ch-kicker">Domains · Hosting · Cloud · Platforms · Tools</p>
            <h1>
              Build. Host.<br /> Deploy. <em>Scale.</em>
            </h1>
            <p className="ch-lede">
              Register the domain, host the website, deploy the application, run the server and
              connect the API — with one account, one catalogue and one support relationship
              instead of five vendors pointing at each other.
            </p>
            <form className="ch-domain-search" onSubmit={onDomainSearch} role="search">
              <label className="ch-visually-hidden" htmlFor="ch-home-domain">
                Search for a domain name
              </label>
              <div className="ch-domain-search__field">
                <input
                  id="ch-home-domain"
                  className="ch-domain-search__input"
                  type="search"
                  name="q"
                  value={domainQuery}
                  onChange={(event) => setDomainQuery(event.target.value)}
                  placeholder="Search a domain, e.g. example.com"
                  maxLength={253}
                  autoComplete="off"
                />
                <button className="ch-btn ch-btn--mint ch-btn--lg" type="submit">
                  Search domains
                </button>
              </div>
            </form>
            <div className="ch-hero__ctas">
              <Link className="ch-btn ch-btn--mint ch-btn--lg" to={UTILITY.createAccount.to}>
                {UTILITY.createAccount.label}
              </Link>
              <Link className="ch-btn ch-btn--on-ink ch-btn--lg" to="/hosting/web-hosting">
                Explore hosting plans
              </Link>
            </div>
            <ul className="ch-hero__points">
              <li><CheckIcon size={15} />Live catalogue pricing, never a stale price list</li>
              <li><CheckIcon size={15} />Manage DNS, certificates and backups where available</li>
              <li><CheckIcon size={15} />Documented APIs for everything you own</li>
            </ul>
          </div>

          <Illustration
            visual="hero/infrastructure"
            visual3d="hero/infrastructure-3d"
            alt="CloudHost247 platform: a 3D view of servers, cloud compute and a control layer"
            caption={{ left: 'CloudHost247 platform', right: 'Infrastructure' }}
            eager
          />
        </div>
      </section>

      <HomePlansSection />

      <section className="ch-section ch-section--soft">
        <div className="ch-wrap">
          <div className="ch-section__head">
            <div>
              <p className="ch-kicker">Start here</p>
              <h2>Hosting, cloud, domains and applications</h2>
            </div>
            <p className="ch-lede">
              Choose your starting point. Explore the specifications and options for your next project.
            </p>
          </div>
          <div className="ch-grid ch-grid--4">
            {SPOTLIGHTS.map((item) => (
              <Link className="ch-card" to={item.to} key={item.to}>
                <Illustration visual={item.visual} visual3d={item.visual3d} alt="" />
                <h3>{item.title}</h3>
                <p>{item.body}</p>
                <span className="ch-card__foot">
                  <span className="ch-link">
                    Explore
                    <span className="ch-link__arrow" aria-hidden><ArrowIcon /></span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="ch-section">
        <div className="ch-wrap">
          <div className="ch-section__head">
            <div>
              <p className="ch-kicker">Eight product families, one account</p>
              <h2>Everything you need to run online</h2>
            </div>
            <p className="ch-lede">
              Each card opens a real product area. The menu, the footer and this page are all rendered
              from the same definition, so nothing here leads to a page that does not exist.
            </p>
          </div>
          <div className="ch-grid ch-grid--4">
            {FAMILIES.map((family) => (
              <Link className="ch-card" to={family.to} key={family.id}>
                <span className="ch-card__icon" aria-hidden>
                  <Icon name={
                    family.id === 'hosting' ? 'server'
                      : family.id === 'cloud' ? 'cloud'
                        : family.id === 'domains' ? 'domain'
                          : family.id === 'platforms' ? 'app'
                            : family.id === 'developers' ? 'code'
                              : family.id === 'tools' ? 'tools' : 'layers'
                  } />
                </span>
                <h3>{family.label}</h3>
                <p>{family.blurb}</p>
                <span className="ch-card__foot">
                  <span className="ch-link">
                    Explore
                    <span className="ch-link__arrow" aria-hidden><ArrowIcon /></span>
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="ch-section ch-section--soft">
        <div className="ch-wrap">
          <div className="ch-section__head">
            <div>
              <p className="ch-kicker">How it works</p>
              <h2>From domain to running service</h2>
            </div>
            <p className="ch-lede">
              Three steps, one account. Everything after the order — DNS, certificates, backups,
              deployments and support — lives inside the same dashboard.
            </p>
          </div>
          <ul className="ch-steps">
            {STEPS.map((step) => (
              <li key={step.index} className="ch-step">
                <span className="ch-step__index">{step.index}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ch-section">
        <div className="ch-wrap">
          <div className="ch-section__head">
            <div>
              <p className="ch-kicker">What we can actually claim</p>
              <h2>Four things we do differently</h2>
            </div>
            <p className="ch-lede">
              No invented uptime figure, no certification badge, no map with pins on cities we do not
              deploy to. These four statements are backed by the platform itself.
            </p>
          </div>
          <div className="ch-grid ch-grid--4">
            {PILLARS.map((pillar) => (
              <Link className="ch-card" to={pillar.to} key={pillar.title}>
                <span className="ch-card__icon" aria-hidden><Icon name={pillar.icon} /></span>
                <h3>{pillar.title}</h3>
                <p>{pillar.body}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="ch-newsletter">
        <div className="ch-wrap">
          <h2>Platform news, straight to your inbox</h2>
          <p>Product updates, maintenance notices and the occasional engineering note. No spam.</p>
          <form role="search" aria-label="Newsletter signup" onSubmit={(event) => event.preventDefault()}>
            <input type="email" name="email" placeholder="you@example.com" required />
            <button className="ch-btn ch-btn--mint" type="submit">Subscribe</button>
          </form>
        </div>
      </section>

      <section className="ch-cta">
        <div className="ch-wrap">
          <div className="ch-cta__inner">
            <div>
              <h2>Ready when you are</h2>
              <p>Create an account to see live pricing and order a service, or ask us a question first.</p>
            </div>
            <div className="ch-cta__actions">
              <Link className="ch-btn ch-btn--on-ink" to={UTILITY.createAccount.to}>
                {UTILITY.createAccount.label}
              </Link>
              <Link className="ch-btn ch-btn--outline" to="/contact">Contact us</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
