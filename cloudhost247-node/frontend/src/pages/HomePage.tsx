import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import { formatPrice, type ProductPlansResponse, type PublicPlan } from '../lib/catalog-types';
import { CatalogErrorBanner } from '../components/CatalogStateBanner';
import { useCurrency } from '../currency/CurrencyProvider';
import { BRAND, UTILITY, NAV_SECTIONS } from '../navigation/registry.generated';
import { resolvePhoto } from '../components/marketing/photo-map.generated';

/**
 * CloudHost247 public homepage — Hostinger-style page grammar.
 *
 * The page is deliberately built as a conversion funnel, in the same order as hostinger.com:
 * promo marquee (shared chrome) → split hero with a product screenshot → capability strip →
 * tabbed pricing cards → "explore more" cards → AI builder prompt → tabbed feature showcase →
 * use-case gallery → "more power" link list → FAQ accordion → full-width CTA → dark footer
 * (shared chrome).
 *
 * Two rules carried over from the original homepage and kept intact:
 *   • Every link resolves to a route this build actually serves (registry-driven where possible).
 *   • No invented price, discount, uptime figure, award, press logo or customer quote. Plans and
 *     prices come from the live catalogue API; if nothing is published the section says so.
 */

const PLAN_TABS = [
  { id: 'websites', label: 'Websites', slug: 'web-hosting', to: '/hosting/web-hosting' },
  { id: 'vps', label: 'VPS hosting', slug: 'vps-hosting', to: '/hosting/vps' },
  { id: 'cloud', label: 'Cloud hosting', slug: 'cloud-hosting', to: '/cloud' },
] as const;

const PROOF = [
  { glyph: '⌁', title: 'Live catalogue pricing', text: 'No stale price list, no placeholder numbers' },
  { glyph: '◈', title: 'One account', text: 'Domains, hosting, servers, apps and billing' },
  { glyph: '⛨', title: 'Security by default', text: 'Passkeys, MFA, encrypted credentials, audit trail' },
];

const EXPLORE = [
  {
    label: 'Domains',
    icon: '🌐',
    title: 'Find a name that fits',
    body: 'Search availability, register or transfer a domain, and manage its DNS from the same account as the site it serves.',
    to: '/domains',
    cta: 'Search domains',
  },
  {
    label: 'Free tools',
    icon: '⚡',
    title: 'Diagnose anything, no account needed',
    body: 'DNS, IP, SSL, network, encoding and security diagnostics — browsable and runnable straight from the Tools Center.',
    to: '/tools',
    cta: 'Open the Tools Center',
  },
  {
    label: 'Website Builder',
    icon: '✦',
    title: 'Build a site without starting from scratch',
    body: 'Start from a template or describe what you want, then shape the page in the builder and publish it to your domain.',
    to: '/websites',
    cta: 'Explore websites',
  },
];

const SHOWCASE = [
  {
    id: 'build',
    label: 'Build',
    hint: 'Get a site, app or server online',
    heading: 'Everything you need to launch, in one platform',
    body: 'Choose a domain, pick a published plan, install an application or deploy from Git. Every step is recorded in the same account that owns the service.',
    points: ['Domain search, registration and transfer', 'Live hosting, VPS and cloud plans', 'Application catalogue and Git deployments', 'Website Builder with templates and AI'],
    tiles: ['Domains', 'Hosting', 'Deploy'],
    to: '/hosting',
    cta: 'Explore hosting',
  },
  {
    id: 'grow',
    label: 'Grow',
    hint: 'Reach customers and sell online',
    heading: 'Keep growing after you go live',
    body: 'Add a storefront, business email, an SSL certificate and marketing tools as the project grows — without migrating to a second provider.',
    points: ['Online store and product catalogue', 'Email hosting and certificates', 'Logo Maker and digital marketing', 'Hire an Expert when you want help'],
    tiles: ['Store', 'Email', 'Marketing'],
    to: '/websites',
    cta: 'Explore websites',
  },
  {
    id: 'manage',
    label: 'Manage',
    hint: 'Operate it all from one dashboard',
    heading: 'One dashboard for everything you run',
    body: 'DNS records, certificates, backups, firewall rules, servers, deployments, invoices and support tickets — with an audit trail behind infrastructure operations.',
    points: ['DNS, SSL and firewall management', 'Scheduled backups with a restore path', 'Monitoring and an honest status page', 'Invoices, services and support tickets'],
    tiles: ['DNS', 'Backups', 'Billing'],
    to: '/status',
    cta: 'See platform status',
  },
] as const;

const AI_CHIPS = ['AI Website Builder', 'Cloud AI assistant', 'Logo Maker palettes', 'AI support answers'];

const USE_CASES = [
  { glyph: '▤', title: 'A business website', text: 'Domain, hosting, business email and HTTPS', to: '/hosting/business' },
  { glyph: '▦', title: 'An online store', text: 'A storefront with products and orders', to: '/websites' },
  { glyph: '⌘', title: 'An API or application', text: 'A supported runtime, a domain and a deployment', to: '/developers' },
  { glyph: '▥', title: 'Infrastructure you run', text: 'VPS, cloud or dedicated servers with backups', to: '/cloud' },
];

const MORE_POWER = [
  { title: 'VPS hosting', text: 'Full root access and predictable resources', to: '/hosting/vps' },
  { title: 'Dedicated servers', text: 'Bare-metal capacity for larger workloads', to: '/hosting/dedicated' },
  { title: 'Application deployments', text: 'Ship from Git or a supported runtime', to: '/developers/deployment' },
  { title: 'Application marketplace', text: 'Browse supported apps and requirements', to: '/apps' },
  { title: 'Domains & DNS', text: 'Registration, transfers and DNS records', to: '/domains' },
  { title: 'Security & backups', text: 'Certificates, firewall rules and restore points', to: '/security' },
];

const FAQS = [
  {
    q: 'What is CloudHost247?',
    a: 'A single platform for getting and staying online: domains, website and email hosting, VPS and cloud servers, applications, deployments, billing and a free Tools Center. One account and one support relationship instead of a separate vendor for each piece.',
  },
  {
    q: 'Where do the prices on this site come from?',
    a: 'Prices are read at request time from the product catalogue, in the currency you select. If a plan or price has not been published yet, the page says so instead of showing a made-up number. The same published price is what the order form charges.',
  },
  {
    q: 'Do I need to know how to code?',
    a: 'No. You can search for a domain, choose a published hosting plan and use the Website Builder or an application from the catalogue. If you do write code, the platform also exposes documented APIs, Git deployment and full control over servers.',
  },
  {
    q: 'Can I manage everything from one account?',
    a: 'Yes. Domains, DNS records, certificates, backups, servers, deployments, invoices and support tickets all live in the same account as the services they belong to.',
  },
  {
    q: 'Are external providers configured automatically?',
    a: 'No. Each integration is configured separately by an operator. Until its credentials are set, the platform fails closed and reports exactly which setting is missing rather than pretending an action succeeded.',
  },
  {
    q: 'Can I use the tools without an account?',
    a: 'Yes. The Tools Center publishes free DNS, IP, network, developer, webmaster and security diagnostics that work anonymously. Tools that need an account or a provider say so on the card before you run them.',
  },
  {
    q: 'How is my account protected?',
    a: 'Sign-in supports passkeys and multi-factor authentication, stored credentials are encrypted at rest, and infrastructure operations write an audit record. The status page reports only the checks the platform can genuinely perform.',
  },
];

function Check() {
  return <span className="hg-check" aria-hidden="true">✓</span>;
}

function Arrow() {
  return <span className="hg-link__arrow" aria-hidden="true">→</span>;
}

/** The live tool count is data, not a marketing number we made up. */
function ToolCountProof() {
  const result = useApiResource<{ count?: number }>('/api/tools/catalog');
  const count = result.status === 'success' && typeof result.data.count === 'number' ? result.data.count : null;
  return (
    <div className="hg-proof__item">
      <i aria-hidden="true">✦</i>
      <div>
        <b>{count === null ? 'Free online tools' : `${count} free online tools`}</b>
        <small>DNS, IP, SSL, network and developer diagnostics</small>
      </div>
    </div>
  );
}

function Price({ plan }: { plan: PublicPlan }) {
  const { formatAmount } = useCurrency();
  const price = plan.pricing.find((p) => p.billingPeriod === 'monthly') ?? plan.pricing[0];
  if (!price) {
    return (
      <>
        <div className="hg-plan__price"><strong style={{ fontSize: '1.25rem' }}>Contact us</strong></div>
        <p className="hg-plan__billing">No price has been published for this plan yet.</p>
      </>
    );
  }
  const formatted = formatAmount(price.amount, price.currency);
  return (
    <>
      <div className="hg-plan__price">
        <strong>{formatted.text || formatPrice(price)}</strong>
        <span>/mo</span>
      </div>
      <p className="hg-plan__billing">
        Billed {price.billingPeriod.replace(/_/g, ' ')} · {formatted.converted ? formatted.currency : price.currency}
        {price.setupFee ? ' · setup fee applies' : ''}
      </p>
    </>
  );
}

/**
 * Tabbed pricing cards — the centrepiece of a Hostinger-style page. Data comes from the public
 * catalogue API, so loading / error / empty are all real states with honest wording.
 */
function PricingSection() {
  const [activeId, setActiveId] = useState<string>(PLAN_TABS[0].id);
  const active = PLAN_TABS.find((tab) => tab.id === activeId) ?? PLAN_TABS[0];
  const result = useApiResource<ProductPlansResponse>(`/api/v1/catalog/products/${active.slug}/plans`);

  return (
    <section className="hg-section hg-pricing" id="pricing">
      <div className="hg-wrap">
        <div className="hg-section__head" data-reveal>
          <p className="hg-eyebrow">Plans &amp; prices</p>
          <h2 className="hg-h2">Choose the plan that fits what you are building</h2>
          <p className="hg-lede">
            Start with what you need and move up as the project grows. Prices are read from the live
            catalogue — what you see here is what the order form charges.
          </p>
        </div>

        <div className="hg-tabs" role="tablist" aria-label="Plan categories">
          {PLAN_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeId === tab.id}
              className={activeId === tab.id ? 'is-active' : ''}
              onClick={() => setActiveId(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {result.status === 'loading' ? (
          <div className="hg-state">Loading the published {active.label.toLowerCase()} plans…</div>
        ) : result.status === 'error' ? (
          result.httpStatus === 404 ? (
            <div className="hg-state">
              <strong>No {active.label.toLowerCase()} plans are published yet.</strong>{' '}
              An administrator has not added this product to the catalogue.{' '}
              <Link className="hg-link" to={active.to}>See the product page</Link> or{' '}
              <Link className="hg-link" to="/contact">ask us about current options</Link>.
            </div>
          ) : (
            <CatalogErrorBanner message={result.message} />
          )
        ) : result.data.plans.length === 0 ? (
          <div className="hg-state">
            <strong>No {active.label.toLowerCase()} plans are published yet.</strong>{' '}
            <Link className="hg-link" to={active.to}>See the product page</Link> for what is available.
          </div>
        ) : (
          <div className="hg-plans" role="tabpanel">
            {result.data.plans.slice(0, 3).map((plan, index) => {
              const featured = index === 1 && result.data.plans.length > 1;
              return (
                <article className={`hg-plan${featured ? ' hg-plan--featured' : ''}`} key={plan.slug}>
                  {featured ? <span className="hg-plan__ribbon">Most flexible</span> : null}
                  <h3 className="hg-plan__name">{plan.name}</h3>
                  <p className="hg-plan__desc">{plan.description ?? `A ${active.label.toLowerCase()} plan from the live catalogue.`}</p>
                  <Price plan={plan} />
                  <Link className={`hg-btn${featured ? '' : ' hg-btn--ghost'}`} to={active.to}>
                    Choose plan
                  </Link>
                  {plan.features.length > 0 ? (
                    <ul className="hg-plan__features">
                      {plan.features.slice(0, 7).map((feature) => (
                        <li key={`${feature.name}-${feature.displayOrder}`}>
                          <Check />
                          <span>{feature.name}{feature.value ? ` — ${feature.value}` : ''}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="hg-plan__billing">Full specifications on the product page.</p>
                  )}
                </article>
              );
            })}
          </div>
        )}

        <p className="hg-pricing__note">
          All prices come from the published product catalogue. Plans renew at the price shown unless
          an administrator publishes a change; no price on this page is a placeholder.
        </p>
      </div>
    </section>
  );
}

/**
 * Hero visual — real, licensed enterprise data-centre photography in a metallic frame.
 *
 * Deliberately NOT a CSS-drawn "product screenshot": the old mock dashboard looked like a generic
 * illustration and told the visitor nothing about the infrastructure behind the service. The photo
 * comes from the same generated registry as every other marketing illustration, so the homepage
 * and the WHMCS theme show the same scene. The frame tilts a few degrees with the pointer and the
 * two capability chips float at a different depth; nothing else on the page moves.
 */
function HeroVisual() {
  const photo = resolvePhoto('hero/infrastructure-3d');
  const srcSet = (format: string) =>
    [640, 960, 1280].map((width) => `/media/cloudhost247/${photo.key}-${width}.${format} ${width}w`).join(', ');

  return (
    <div className="hg-hero__visual" data-tilt data-tilt-max="5">
      <figure className="ch-photo-frame hg-hero__frame">
        <picture>
          <source type="image/avif" sizes="(max-width: 900px) 100vw, 620px" srcSet={srcSet('avif')} />
          <source type="image/webp" sizes="(max-width: 900px) 100vw, 620px" srcSet={srcSet('webp')} />
          <img
            src={`/media/cloudhost247/${photo.key}.jpg`}
            width={1280}
            height={855}
            alt={photo.alt}
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <figcaption className="ch-photo-frame__label">Enterprise infrastructure</figcaption>
      </figure>
      <div className="hg-float hg-float--one ch-float--ambient"><i>✓</i> One account for every service</div>
      <div className="hg-float hg-float--two ch-float--ambient-slow"><i>↗</i> Live catalogue pricing</div>
    </div>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [domainQuery, setDomainQuery] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [showcaseId, setShowcaseId] = useState<string>('build');
  const showcase = SHOWCASE.find((item) => item.id === showcaseId) ?? SHOWCASE[0];

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
        { '@context': 'https://schema.org', '@type': 'WebSite', name: BRAND.name, description: BRAND.description },
      ],
    }
  );

  function onDomainSearch(event: FormEvent) {
    event.preventDefault();
    const trimmed = domainQuery.trim();
    navigate(trimmed ? `/domains?q=${encodeURIComponent(trimmed)}` : '/domains');
  }

  function onAiPrompt(event: FormEvent) {
    event.preventDefault();
    navigate(aiPrompt.trim() ? `/register?idea=${encodeURIComponent(aiPrompt.trim())}` : UTILITY.createAccount.to);
  }

  return (
    <div className="hg-page">
      {/* 1. Hero — big headline, domain search, primary CTA, product screenshot */}
      <section className="hg-hero">
        <div className="hg-hero__glow" data-parallax="0.10" aria-hidden="true" />
        <div className="hg-wrap hg-hero__grid">
          <div>
            <p className="hg-hero__pill"><span>Platform</span> Domains · Hosting · Cloud · Apps · Tools</p>
            <h1>Your idea, online. <span className="hg-accent">All in one place.</span></h1>
            <p className="hg-hero__sub">
              Register the domain, host the website, deploy the application, run the server and
              connect the API — with one account, one catalogue and one support relationship.
            </p>
            <form className="hg-domain" onSubmit={onDomainSearch} role="search" aria-label="Search for a domain name">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <label className="ch-visually-hidden" htmlFor="hg-domain-input">Search for a domain name</label>
              <input
                id="hg-domain-input"
                type="search"
                name="q"
                value={domainQuery}
                onChange={(event) => setDomainQuery(event.target.value)}
                placeholder="Find your domain, e.g. example.com"
                maxLength={253}
                autoComplete="off"
              />
              <button className="hg-btn hg-btn--sm" type="submit">Search</button>
            </form>
            <div className="hg-hero__ctas">
              <Link className="hg-btn" to={UTILITY.createAccount.to}>{UTILITY.createAccount.label}</Link>
              <Link className="hg-btn hg-btn--ghost" to="/#pricing">See plans</Link>
            </div>
            <ul className="hg-hero__points">
              <li><Check /> Live catalogue pricing, never a stale price list</li>
              <li><Check /> DNS, certificates, backups and deployments in one account</li>
              <li><Check /> Documented APIs for everything you own</li>
            </ul>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* 2. Capability strip — real capabilities instead of press logos we do not have */}
      <section className="hg-proof ch-assurance" aria-label="Platform capabilities">
        <div className="hg-wrap hg-proof__grid">
          {PROOF.map((item) => (
            <div className="hg-proof__item" key={item.title}>
              <i aria-hidden="true">{item.glyph}</i>
              <div><b>{item.title}</b><small>{item.text}</small></div>
            </div>
          ))}
          <ToolCountProof />
        </div>
      </section>

      {/* 3. Tabbed pricing cards */}
      <PricingSection />

      {/* 4. Explore more */}
      <section className="hg-section hg-section--soft">
        <div className="hg-wrap">
          <div className="hg-section__head--split" data-reveal>
            <div>
              <p className="hg-eyebrow">Explore the platform</p>
              <h2 className="hg-h2">Everything you need before you go live</h2>
            </div>
            <p className="hg-lede">Each card opens a real product area. The menu, footer and this page all come from the same navigation definition.</p>
          </div>
          <div className="hg-cards hg-cards--3">
            {EXPLORE.map((card) => (
              <Link className="hg-card" to={card.to} key={card.title}>
                <span className="hg-card__icon" aria-hidden="true">{card.icon}</span>
                <span className="hg-card__label">{card.label}</span>
                <h3 className="hg-h3">{card.title}</h3>
                <p>{card.body}</p>
                <span className="hg-card__foot"><span className="hg-link">{card.cta} <Arrow /></span></span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 5. AI builder prompt */}
      <section className="hg-section hg-ai">
        <div className="hg-wrap" style={{ position: 'relative', textAlign: 'center' }}>
          <p className="hg-eyebrow">Describe it. Build it live.</p>
          <h2 className="hg-h2">Tell CloudHost247 what you want to create</h2>
          <p className="hg-lede">
            Describe a website, keep prompting to shape it, then publish it to a domain you own.
            The built-in generator always works; external model providers are optional and never
            silently substituted.
          </p>
          <form className="hg-prompt" onSubmit={onAiPrompt} role="search" aria-label="Describe your website">
            <label className="ch-visually-hidden" htmlFor="hg-ai-input">Describe the website you want</label>
            <input
              id="hg-ai-input"
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder="A portfolio site for a design studio in Abuja…"
              maxLength={300}
            />
            <button className="hg-btn" type="submit">Create with AI</button>
          </form>
          <div className="hg-ai__chips">
            {AI_CHIPS.map((chip) => <span key={chip}>{chip}</span>)}
          </div>
        </div>
      </section>

      {/* 6. Tabbed feature showcase */}
      <section className="hg-section hg-section--white">
        <div className="hg-wrap">
          <div className="hg-section__head" data-reveal>
            <p className="hg-eyebrow">Tools for every online project</p>
            <h2 className="hg-h2">More control over what you build, without more complexity</h2>
            <p className="hg-lede">Build it, grow it, then run it — all from the same platform.</p>
          </div>
          <div className="hg-showcase">
            <div className="hg-showcase__tabs" role="tablist" aria-label="Platform areas">
              {SHOWCASE.map((item) => (
                <button
                  type="button"
                  role="tab"
                  key={item.id}
                  aria-selected={showcaseId === item.id}
                  className={`hg-showcase__tab${showcaseId === item.id ? ' is-active' : ''}`}
                  onClick={() => setShowcaseId(item.id)}
                >
                  <b>{item.label}</b>
                  <small>{item.hint}</small>
                </button>
              ))}
            </div>
            <div className="hg-showcase__panel" role="tabpanel">
              <h3>{showcase.heading}</h3>
              <p>{showcase.body}</p>
              <ul className="hg-showcase__list">
                {showcase.points.map((point) => <li key={point}><Check />{point}</li>)}
              </ul>
              <div className="hg-showcase__mock" aria-hidden="true">
                {showcase.tiles.map((tile) => <div key={tile}>{tile}</div>)}
              </div>
              <p style={{ marginTop: 22, marginBottom: 0 }}>
                <Link className="hg-link" to={showcase.to}>{showcase.cta} <Arrow /></Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. Use cases — Hostinger has a customer gallery; we show real starting points instead
             of inventing testimonials. */}
      <section className="hg-section hg-section--soft">
        <div className="hg-wrap">
          <div className="hg-section__head" data-reveal>
            <p className="hg-eyebrow">What will you build?</p>
            <h2 className="hg-h2">Pick a starting point</h2>
            <p className="hg-lede">Every tile opens a product area that exists in this build.</p>
          </div>
          <div className="hg-cards hg-cards--4">
            {USE_CASES.map((item) => (
              <Link className="hg-usecase" to={item.to} key={item.title}>
                <span className="hg-usecase__glyph" aria-hidden="true">{item.glyph}</span>
                <b>{item.title}</b>
                <small>{item.text}</small>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 8. "More power when you need it" link list, from the shared navigation registry */}
      <section className="hg-section hg-section--white">
        <div className="hg-wrap">
          <div className="hg-section__head--split" data-reveal>
            <div>
              <p className="hg-eyebrow">More power when you need it</p>
              <h2 className="hg-h2">Scale on your own terms</h2>
            </div>
            <p className="hg-lede">{NAV_SECTIONS.length} product families, one account. Move up without moving providers.</p>
          </div>
          <div className="hg-linklist">
            {MORE_POWER.map((link) => (
              <Link to={link.to} key={link.title}>
                <span>{link.title}<small>{link.text}</small></span>
                <span aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* 9. FAQ accordion */}
      <section className="hg-section hg-section--soft" id="faq">
        <div className="hg-wrap">
          <div className="hg-section__head" data-reveal>
            <p className="hg-eyebrow">Platform FAQs</p>
            <h2 className="hg-h2">Questions, answered honestly</h2>
          </div>
          <div className="hg-faq">
            {FAQS.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 28, marginBottom: 0 }}>
            <Link className="hg-link" to="/faq">Read the full FAQ <Arrow /></Link>
          </p>
        </div>
      </section>

      {/* 10. Final CTA */}
      <section className="hg-cta">
        <div className="hg-wrap">
          <h2>Your idea, online. Now&apos;s the time.</h2>
          <p>Create an account to see live pricing and order a service, or ask us a question first.</p>
          <div className="hg-cta__actions">
            <Link className="hg-btn hg-btn--light" to={UTILITY.createAccount.to}>{UTILITY.createAccount.label}</Link>
            <Link className="hg-btn hg-btn--light" to="/contact" style={{ background: 'transparent', color: '#fff', borderColor: 'rgba(255,255,255,0.55)' }}>Contact us</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
