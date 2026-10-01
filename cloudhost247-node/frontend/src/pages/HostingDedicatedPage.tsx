import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { ProductPlansSection } from '../components/ProductPlansSection';

export default function HostingDedicatedPage() {
  usePageMeta('Dedicated Servers', 'High-performance bare-metal dedicated servers with complete resource isolation and custom control panel deployments.');

  const features = [
    {
      title: 'Dedicated Bare-Metal Compute',
      body: '100% dedicated enterprise hardware resources with no virtualization overhead or noisy neighbors, built for high-throughput enterprise applications.',
    },
    {
      title: 'Choice of Any Control Panel',
      body: 'Automate installation of cPanel, Plesk, Dokploy, Coolify, CyberPanel, DirectAdmin, CloudPanel, or run bare OS with our telemetry agent.',
    },
    {
      title: 'Enterprise Hardware SLA',
      body: 'Redundant power feeds, enterprise NVMe storage arrays, IPMI / KVM remote console, and 99.99% network uptime SLA backed by 24/7 monitoring.',
    },
  ];

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Dedicated Bare-Metal Servers</h1>
          <p>Enterprise physical servers engineered for uncompromising performance, isolation, and scale.</p>
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
          <h2>Server Configurations &amp; Plans</h2>
          <ProductPlansSection slug="dedicated-hosting" />
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--cta">
          <h2>Deploy Custom Enterprise Infrastructure</h2>
          <p>Need custom network routing, hardware RAID, or hybrid private clouds? Our engineering team is ready to assist.</p>
          <NavLink className="ch247-button" to="/servers/new">
            Configure Server Now
          </NavLink>
        </div>
      </section>
    </div>
  );
}
