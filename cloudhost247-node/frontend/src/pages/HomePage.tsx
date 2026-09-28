import { NavLink } from 'react-router-dom';

/**
 * Hero copy and tagline below are the real CloudHost247 brand defaults defined in
 * modules/addons/cloudhost247_theme/lib/ThemeRepository.php (the independent-rebuild PHP theme's
 * settings defaults) — reused here rather than inventing new marketing copy, so both the legacy
 * WHMCS site and this new app present the same brand voice while both stacks run side by side.
 * The supporting feature/highlight copy further down is new, original content written for this
 * page (there was no equivalent static content to reuse for it).
 */
const features = [
  {
    title: 'Fast provisioning',
    body: 'Get hosting resources ready quickly, with straightforward setup and no manual back-and-forth.',
  },
  {
    title: 'Straightforward billing',
    body: 'Clear invoices and predictable renewal cycles — no surprise line items.',
  },
  {
    title: 'Support around the clock',
    body: 'Reach a real person whenever something needs attention, day or night.',
  },
];

export default function HomePage() {
  return (
    <div>
      <section className="ch247-hero">
        <div className="ch247-hero__inner">
          <h1>Cloud infrastructure built for your next idea</h1>
          <p>Fast hosting, straightforward billing, and support whenever you need it.</p>
          <NavLink className="ch247-button" to="/hosting/cpanel">
            Explore hosting
          </NavLink>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-grid">
          {features.map((feature) => (
            <article className="ch247-card ch247-feature-card" key={feature.title}>
              <h2>{feature.title}</h2>
              <p>{feature.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ch247-section ch247-section--muted">
        <div className="ch247-page ch247-page--cta">
          <h2>Ready to get started?</h2>
          <p>Create an account to see plans, manage services, and reach support from one place.</p>
          <NavLink className="ch247-button" to="/register">
            Create your account
          </NavLink>
        </div>
      </section>
    </div>
  );
}
