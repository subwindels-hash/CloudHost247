import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';

/**
 * The category list below is the real, currently-published list of service lines CloudHost247
 * offers (see faqs.php, answer to "What services do you offer?", also reused verbatim on the
 * /faq page). Only cPanel Hosting and VPS Hosting have a dedicated page built on this platform so
 * far, matching the agreed Phase 2 scope (a representative sample, not full parity with every
 * product line) — the rest are listed honestly as real, currently-offered services that simply
 * haven't been given a dedicated page on this new platform yet, rather than being omitted (which
 * would understate what's actually offered) or given an invented page (which would fabricate
 * content).
 */
const categories = [
  {
    title: 'cPanel Hosting',
    description: 'Everyday web hosting with the control panel administrators already know.',
    to: '/hosting/cpanel',
    available: true,
  },
  {
    title: 'VPS Hosting',
    description: 'Root-access virtual private servers with cPanel included.',
    to: '/hosting/vps',
    available: true,
  },
  {
    title: 'Shared Hosting',
    description: 'Entry-level hosting for smaller sites, sharing server resources.',
    available: false,
  },
  {
    title: 'Dedicated Hosting',
    description: 'An entire physical server for maximum performance and isolation.',
    available: false,
  },
  {
    title: 'Cloud Hosting Solutions',
    description: 'Scalable, cloud-based hosting infrastructure.',
    available: false,
  },
  {
    title: 'Managed Server Support',
    description: 'Hands-on server administration and maintenance.',
    available: false,
  },
  {
    title: 'Email Hosting',
    description: 'Send and receive mail on your own domain.',
    available: false,
  },
];

export default function HostingPage() {
  usePageMeta('Hosting', 'CloudHost247 hosting plans and services.');

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
          <div className="ch247-index-grid">
            {categories.map((category) => (
              <div className="ch247-index-card" key={category.title}>
                <span
                  className={`ch247-index-card__status ${
                    category.available ? 'ch247-index-card__status--available' : 'ch247-index-card__status--pending'
                  }`}
                >
                  {category.available ? 'Available here' : 'On the current site'}
                </span>
                <h3>{category.title}</h3>
                <p>{category.description}</p>
                {category.available && category.to ? (
                  <NavLink to={category.to}>View details →</NavLink>
                ) : (
                  <p className="ch247-page__hint">
                    <em>Not yet built on this platform — see the current CloudHost247 site or contact us for details.</em>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
