import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';

/** Legacy page module kept for compatibility; the live route uses the shared marketing content. */
export default function HostingApplicationHostingPage() {
  usePageMeta(
    'Application & PaaS Hosting',
    'Explore published applications, container workflows and control panels configured for CloudHost247. Product features and Git support depend on the live catalogue.'
  );

  const features = [
    {
      title: 'Published application versions',
      body: 'The native deployment worker installs application versions that are published with a validated manifest and configured image.',
    },
    {
      title: 'Recorded deployment operations',
      body: 'Supported installs and updates produce a status record, step history and event log; recovery depends on the operation and provider.',
    },
    {
      title: 'Source builds when configured',
      body: 'Git builds and webhooks are capabilities of selected control-panel integrations, not the core deployment queue. Check the live catalogue before ordering.',
    },
  ];

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Application &amp; PaaS Hosting</h1>
          <p>
            Browse published application deployments, container workflows and the control panels
            available for CloudHost247 services. Capabilities vary by product and configuration.
          </p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-grid">
          {features.map((item) => (
            <article className="ch247-card ch247-feature-card" key={item.title}>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="ch247-section ch247-section--muted">
        <div className="ch247-page ch247-page--wide">
          <h2>Control panels and deployment products</h2>
          <p>
            The live catalogue lists panels and deployment products currently configured in
            CloudHost247. Their supported operating systems, integrations and features are shown
            on each product detail page.
          </p>
          <NavLink to="/hosting/control-panels" className="ch247-btn ch247-btn--secondary">
            Browse available control panels →
          </NavLink>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--cta">
          <h2>Check current product availability</h2>
          <p>Control-panel and deployment options follow the live catalogue and provider configuration.</p>
          <NavLink className="ch247-button" to="/hosting/control-panels">
            View Control Panels
          </NavLink>
        </div>
      </section>
    </div>
  );
}
