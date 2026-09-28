import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { ProductPlansSection } from '../components/ProductPlansSection';

/**
 * Feature copy is adapted from the real, currently-published VPS hosting page content
 * (lang/overrides/english.php: vpsfullaccess*, vpsintegratedcpanel*, vpsinstantprovision* keys,
 * rendered by templates/cloudhost247_legacy/includes/blocks/why_choose_vps_hosting.tpl and served
 * today at vps-hosting.php) — lightly reworded for this app's brand voice, not invented. It stays
 * static because it's true regardless of catalog state.
 *
 * The "Plans & pricing" section below is now real, live data from
 * GET /api/v1/catalog/products/vps-hosting/plans (see src/routes/catalog-public.ts), with an
 * honest, distinct message for every possible state of that data (see ProductPlansSection) — no
 * fabricated specs (CPU/RAM/storage) or prices are ever shown.
 */
const included = [
  {
    title: 'Full root access',
    body: 'Administrator-level access to your virtual server, with the ability to install custom software without restriction, plus a server management panel to start, stop, and rebuild your server.',
  },
  {
    title: 'Integrated cPanel',
    body: 'Every VPS plan comes with cPanel pre-installed, so you manage the server the same way you would shared hosting — including the Softaculous one-click installer for WordPress and other common apps.',
  },
  {
    title: 'Fast provisioning',
    body: 'VPS servers are provisioned in minutes rather than hours or days, with no separate setup fee.',
  },
];

export default function HostingVpsPage() {
  usePageMeta('VPS Hosting', 'Root-access virtual private servers with cPanel included.');

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>VPS Hosting</h1>
          <p>Root-access virtual private servers with cPanel included, for sites that have outgrown shared hosting.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-grid">
          {included.map((item) => (
            <article className="ch247-card ch247-feature-card" key={item.title}>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ch247-section ch247-section--muted">
        <div className="ch247-page ch247-page--wide">
          <h2>Plans &amp; pricing</h2>
          <ProductPlansSection slug="vps-hosting" />
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--cta">
          <h2>Ready to get started?</h2>
          <p>Create an account and we&apos;ll help you pick the right plan.</p>
          <NavLink className="ch247-button" to="/register">
            Create your account
          </NavLink>
        </div>
      </section>
    </div>
  );
}
