import { NavLink } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { ProductPlansSection } from '../components/ProductPlansSection';

export default function HostingApplicationHostingPage() {
  usePageMeta('Application & PaaS Hosting', 'Modern containerized PaaS platforms and application servers powered by Dokploy, Coolify, Easypanel, Cloudron, and Cosmos.');

  const features = [
    {
      title: 'Automated PaaS Stacks',
      body: 'Deploy full-stack platforms like Dokploy, Coolify, Easypanel, Cosmos, and Cloudron with Docker, Docker Compose, Traefik, and automatic SSL pre-configured.',
    },
    {
      title: 'Git Push & CI/CD Pipelines',
      body: 'Connect GitHub, GitLab, or raw Docker repositories to automatically build, test, and deploy applications on every push with zero manual server work.',
    },
    {
      title: 'Built-in SSL, Domains & Proxy',
      body: 'Every application platform automatically issues Let’s Encrypt TLS certificates, routes custom domains through Traefik, and monitors container health.',
    },
  ];

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Application &amp; PaaS Hosting</h1>
          <p>Self-host modern container platforms, full-stack microservices, and web applications on optimized CloudHost247 cloud servers.</p>
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
          <h2>Popular Application Platforms</h2>
          <div className="ch247-grid ch247-grid--3">
            <div className="ch247-card">
              <h3>Dokploy</h3>
              <p>Self-hosted alternative to Heroku &amp; Vercel. Native Docker Compose, Traefik routing, preview environments, and multi-user team workspaces.</p>
              <NavLink to="/hosting/control-panels/dokploy" className="ch247-btn ch247-btn--secondary">
                View Dokploy Specs →
              </NavLink>
            </div>
            <div className="ch247-card">
              <h3>Coolify</h3>
              <p>All-in-one PaaS engine with automatic Git deployments, S3 backups, webhooks, databases, and multi-server fleet management.</p>
              <NavLink to="/hosting/control-panels/coolify" className="ch247-btn ch247-btn--secondary">
                View Coolify Specs →
              </NavLink>
            </div>
            <div className="ch247-card">
              <h3>Easypanel</h3>
              <p>Clean visual Docker management panel with 1-click database templates, unified SSL termination, and project isolation.</p>
              <NavLink to="/hosting/control-panels/easypanel" className="ch247-btn ch247-btn--secondary">
                View Easypanel Specs →
              </NavLink>
            </div>
          </div>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--cta">
          <h2>Browse Complete Control Panel Marketplace</h2>
          <p>Explore all 18 supported hosting panels, deployment engines, and telemetry platforms.</p>
          <NavLink className="ch247-button" to="/hosting/control-panels">
            View All Control Panels
          </NavLink>
        </div>
      </section>
    </div>
  );
}
