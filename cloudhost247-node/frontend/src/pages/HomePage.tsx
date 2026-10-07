import { Link } from 'react-router-dom';
import { Icon, CheckIcon, ArrowIcon } from '../components/ui/Icon';
import { usePageMeta } from '../lib/usePageMeta';
import { NAV_SECTIONS, TOOLS_CATEGORIES, BRAND } from '../navigation/registry.generated';

/**
 * The CloudHost247 homepage.
 *
 * It is a guide into the ecosystem, not a catalogue: each section answers "what is this and where
 * do I go next", and the deep pages do the explaining. The product family cards and tool
 * categories are rendered from the shared navigation registry, so the homepage cannot advertise a
 * product the rest of the site does not have — and adding a product updates this page too.
 *
 * Deliberately absent: a customer-logo wall, an uptime percentage, a data-centre pin map and any
 * price. None of those can be stated truthfully without data this deployment does not hold, and
 * each of them is a thing a visitor has learned to distrust anyway.
 */

const FAMILIES = NAV_SECTIONS.filter((section) => section.id !== 'resources' && section.id !== 'support');

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

export default function HomePage() {
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

  return (
    <div className="ch-ds">
      <section className="ch-hero">
        <div className="ch-wrap">
          <div className="ch-hero__inner">
            <div>
              <p className="ch-kicker">Domains · Hosting · Cloud · Platforms · Tools</p>
              <h1>
                Everything after the idea, <em>in one platform</em>
              </h1>
              <p className="ch-lede">
                Register the domain, host the website, deploy the application, run the server and
                connect the API — with one account, one catalogue and one support relationship
                instead of five vendors pointing at each other.
              </p>
              <div className="ch-hero__ctas">
                <Link className="ch-btn ch-btn--mint ch-btn--lg" to="/register">
                  Create an account
                </Link>
                <Link className="ch-btn ch-btn--on-ink ch-btn--lg" to="/hosting">
                  Explore the platform
                </Link>
              </div>
              <ul className="ch-hero__points">
                <li><CheckIcon size={15} />Live catalogue pricing, never a stale price list</li>
                <li><CheckIcon size={15} />Manage DNS, certificates and backups where available</li>
                <li><CheckIcon size={15} />Documented APIs for everything you own</li>
              </ul>
            </div>

            <figure className="ch-visual" style={{ margin: 0 }}>
              <img
                src="/media/cloudhost247/hero/global-network.svg"
                alt="CloudHost247 platform: domains, hosting, cloud compute, applications and developer tooling connected to one control layer"
                width={660}
                height={520}
              />
              <figcaption className="ch-visual__caption">
                <span>CloudHost247 platform</span>
                <span>Control layer</span>
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      <section className="ch-section ch-section--tight ch-section--soft">
        <div className="ch-wrap">
          <ul className="ch-pill-row" style={{ justifyContent: 'space-between' }}>
            {[
              'Domains & DNS',
              'Web & WordPress hosting',
              'VPS · Cloud · Dedicated',
              'Application marketplace',
              'Application deployments',
              'Website builder & stores',
              'Online tools for everyday work',
              'Documented APIs',
            ].map((item) => (
              <li className="ch-pill" key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ch-section">
        <div className="ch-wrap">
          <div className="ch-section__head">
            <div>
              <p className="ch-kicker">The platform</p>
              <h2>Eight product families, one account</h2>
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
                              : family.id === 'websites' ? 'layout'
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
          <div className="ch-split">
            <div>
              <p className="ch-kicker">Start where you are</p>
              <h2>What are you building?</h2>
              <p className="ch-lede">
                The right entry point depends on what you already have. These four cover most of the
                ways people arrive at CloudHost247.
              </p>
              <ul className="ch-check-list" style={{ marginTop: '26px' }}>
                {AUDIENCES.map((audience) => (
                  <li key={audience.title}>
                    <span className="ch-check-list__mark" aria-hidden><CheckIcon /></span>
                    <span>
                      <strong>{audience.title}</strong>
                      <span className="ch-check-list__body">
                        {audience.body}{' '}
                        <Link to={audience.to}>Start here →</Link>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ch-visual" style={{ background: 'var(--ch-soft)', borderColor: 'var(--ch-line)' }}>
              <img
                src="/media/cloudhost247/hero/infrastructure.svg"
                alt="Isometric view of CloudHost247 hosting, cloud and application layers"
                width={660}
                height={520}
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </section>

      <section className="ch-section">
        <div className="ch-wrap">
          <div className="ch-section__head">
            <div>
              <p className="ch-kicker">Trust</p>
              <h2>What we can actually claim</h2>
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

      <section className="ch-section ch-section--ink">
        <div className="ch-wrap">
          <div className="ch-section__head">
            <div>
              <p className="ch-kicker">Tools</p>
              <h2>Free tools, honest results</h2>
            </div>
            <p className="ch-lede" style={{ color: 'var(--ch-on-dark-muted)' }}>
              DNS, IP, network, security, developer, designer, webmaster, productivity and gaming
              utilities. Each one explains its output instead of dressing it up.
            </p>
          </div>
          <div className="ch-grid ch-grid--4">
            {TOOLS_CATEGORIES.slice(0, 8).map((category) => (
              <Link className="ch-card ch-card--ink" to={`/tools/category/${category.slug}`} key={category.slug}>
                <span className="ch-card__icon" aria-hidden><Icon name={category.icon} /></span>
                <h3>{category.label}</h3>
                <p>{category.desc}</p>
              </Link>
            ))}
          </div>
          <p style={{ marginTop: '30px', marginBottom: 0 }}>
            <Link className="ch-btn ch-btn--mint" to="/tools">Open the Tools Center</Link>
          </p>
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
              <Link className="ch-btn" to="/register">Create account</Link>
              <Link className="ch-btn ch-btn--outline" to="/contact">Contact us</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
