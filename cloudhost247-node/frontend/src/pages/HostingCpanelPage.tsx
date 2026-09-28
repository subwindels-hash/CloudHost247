import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { ProductPlansSection } from '../components/ProductPlansSection';

/**
 * The "what's included" copy below is general, static marketing content (unchanged from Phase 2)
 * — it doesn't depend on the catalog and stays visible even if the live plans/pricing fetch below
 * fails, since it's true regardless of catalog state.
 *
 * Phase 3 adds the "Plans & pricing" section beneath it, which is now real, live data from
 * GET /api/v1/catalog/products/cpanel-hosting/plans (see src/routes/catalog-public.ts) rather than
 * a "sign in to see pricing" placeholder — with an honest, distinct message for every possible
 * state of that data (see ProductPlansSection).
 */
const included = [
  { title: 'cPanel control panel', body: 'Manage files, databases, email, and domains from one familiar dashboard.' },
  { title: 'Free SSL', body: "Every hosting account includes a TLS certificate, kept renewed automatically." },
  { title: 'Daily backups', body: 'Automated daily backups so a bad deploy or accidental deletion is recoverable.' },
  { title: 'One-click apps', body: 'Install WordPress and other common applications without manual setup.' },
  { title: 'Email hosting included', body: 'Send and receive mail on your own domain without a separate email provider.' },
  { title: '24/7 support', body: "Reach support whenever something needs attention — see the Support page." },
];

export default function HostingCpanelPage() {
  usePageMeta('cPanel Hosting', "Everyday web hosting with the control panel administrators already know.");

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>cPanel Hosting</h1>
          <p>Everyday web hosting with the control panel administrators already know.</p>
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
          <ProductPlansSection slug="cpanel-hosting" />
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
