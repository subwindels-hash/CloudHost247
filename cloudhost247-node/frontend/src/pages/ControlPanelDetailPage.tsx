import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchControlPanel, type ControlPanelDetail } from '../lib/control-panels-api';

export default function ControlPanelDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [panel, setPanel] = useState<ControlPanelDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    fetchControlPanel(slug)
      .then(setPanel)
      .catch((err) => setError(err.message));
  }, [slug]);

  if (error) {
    return (
      <div className="ch247-page">
        <div className="ch247-banner ch247-banner--error">{error}</div>
        <Link to="/hosting/control-panels" className="ch247-btn ch247-btn--secondary">
          ← Back to Control Panels
        </Link>
      </div>
    );
  }

  if (!panel) {
    return <div className="ch247-page"><div className="ch247-loading">Loading platform specifications...</div></div>;
  }

  const capabilityLabels: Record<string, string> = {
    domains: 'Domain & VHost Management',
    databases: 'MySQL / MariaDB / PostgreSQL Databases',
    email: 'Full Mail Server & Webmail (IMAP/POP3/SMTP)',
    dns: 'Integrated DNS Zone Management',
    ssl: 'Automated Let’s Encrypt / Custom SSL Certificates',
    docker: 'Docker & Container Workloads',
    docker_compose: 'Docker Compose Project Support',
    traefik: 'Automated Traefik Reverse Proxy Routing',
    git_deploy: 'Git Push & Webhook Automated Deployments',
    reseller: 'Multi-Tier Reseller Account Administration',
    multi_user: 'Multi-User & Customer Account Permissions',
    backups: 'Automated Local & Remote Backup Engines',
    file_manager: 'Web-Based Visual File Manager',
    php_version_switch: 'Multi-PHP Version Selector per Domain',
    wordpress_toolkit: 'WordPress Toolkit & 1-Click Staging',
    nodejs: 'Native Node.js Application Support',
    python: 'Native Python WSGI Application Support',
    softaculous: '1-Click Softaculous App Installer Suite',
    system_monitoring: 'Real-Time Server Health & Load Monitoring',
    remote_management: 'Centralized Remote Fleet Management',
    app_templates: '1-Click Curated Open-Source App Marketplace',
  };

  return (
    <div className="ch247-page">
      <nav className="ch247-breadcrumbs" aria-label="Breadcrumbs">
        <Link to="/">Home</Link>
        <span aria-hidden="true">/</span>
        <Link to="/hosting/control-panels">Control Panels</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{panel.name}</span>
      </nav>

      <header className="ch247-panel-detail-header">
        <div className="ch247-panel-detail-header__logo-wrap">
          {panel.logoUrl ? (
            <img src={panel.logoUrl} alt={`${panel.name} logo`} className="ch247-panel-detail-header__logo" />
          ) : (
            <span className="ch247-panel-card__logo-fallback">{panel.name.slice(0, 2).toUpperCase()}</span>
          )}
        </div>
        <div className="ch247-panel-detail-header__info">
          <div className="ch247-badge-row">
            <span className="ch247-badge ch247-badge--category">{panel.category}</span>
            {panel.requiresLicense ? (
              <span className="ch247-tag ch247-tag--license">Commercial License Required</span>
            ) : (
              <span className="ch247-tag ch247-tag--free">Free & Open Source</span>
            )}
          </div>
          <h1>{panel.name}</h1>
          <p className="ch247-panel-detail-header__desc">{panel.description}</p>
          <div className="ch247-panel-detail-header__links">
            {panel.websiteUrl && (
              <a href={panel.websiteUrl} target="_blank" rel="noopener noreferrer" className="ch247-link">
                Official Website ↗
              </a>
            )}
            {panel.documentationUrl && (
              <a href={panel.documentationUrl} target="_blank" rel="noopener noreferrer" className="ch247-link">
                Documentation ↗
              </a>
            )}
          </div>
        </div>
        <div className="ch247-panel-detail-header__cta">
          <div className="ch247-panel-detail-header__price-box">
            <span>Starting at</span>
            <strong>{Number(panel.startingPrice) === 0 ? 'Free' : `$${panel.startingPrice} / ${panel.billingCycle}`}</strong>
          </div>
          <Link to={`/servers/new?panel=${panel.slug}`} className="ch247-btn ch247-btn--primary ch247-btn--lg">
            Deploy on CloudHost247 VPS
          </Link>
        </div>
      </header>

      <div className="ch247-panel-detail-grid">
        <section className="ch247-card ch247-panel-section">
          <h2>Platform Capabilities</h2>
          <p className="ch247-page__hint">Native feature support validated for this platform.</p>
          <ul className="ch247-capability-list">
            {Object.entries(panel.capabilities).map(([key, enabled]) => (
              <li key={key} className={`ch247-capability-item ${enabled ? 'is-supported' : 'is-unsupported'}`}>
                <span className="ch247-capability-icon" aria-hidden="true">{enabled ? '✓' : '✗'}</span>
                <span>{capabilityLabels[key] ?? key}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="ch247-card ch247-panel-section">
          <h2>System Requirements & Compatibility</h2>
          <div className="ch247-requirements-grid">
            <div className="ch247-req-card">
              <span className="ch247-req-label">Minimum RAM</span>
              <strong>{(panel.minimumRequirements.ramMb / 1024).toFixed(panel.minimumRequirements.ramMb % 1024 ? 1 : 0)} GB</strong>
              <small>({panel.minimumRequirements.ramMb} MB)</small>
            </div>
            <div className="ch247-req-card">
              <span className="ch247-req-label">Minimum CPU</span>
              <strong>{panel.minimumRequirements.cpuCores} {panel.minimumRequirements.cpuCores === 1 ? 'Core' : 'Cores'}</strong>
              <small>x86_64 or ARM64</small>
            </div>
            <div className="ch247-req-card">
              <span className="ch247-req-label">Minimum Storage</span>
              <strong>{panel.minimumRequirements.diskGb} GB</strong>
              <small>NVMe / SSD</small>
            </div>
            <div className="ch247-req-card">
              <span className="ch247-req-label">Install Method</span>
              <strong>{panel.installationMethod}</strong>
              <small>Automated via Cloud-Init</small>
            </div>
          </div>

          <h3 className="ch247-subheading">Compatible Operating Systems</h3>
          <div className="ch247-pill-wrap">
            {panel.supportedOs.map((os) => (
              <span key={os} className="ch247-pill ch247-pill--lg">{os}</span>
            ))}
          </div>
        </section>
      </div>

      {panel.plans.length > 0 && (
        <section className="ch247-card ch247-plans-section">
          <h2>Available Software Plans & Licenses</h2>
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Plan Name</th>
                  <th>License Tier</th>
                  <th>Included Limits</th>
                  <th>Billing Cycle</th>
                  <th>Price</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {panel.plans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      {p.description && <p className="ch247-table-sub">{p.description}</p>}
                    </td>
                    <td><span className="ch247-badge">{p.licenseType}</span></td>
                    <td>
                      {p.includedDomains ? `${p.includedDomains} Domains` : ''}
                      {p.includedDomains && p.includedAccounts ? ' · ' : ''}
                      {p.includedAccounts ? `${p.includedAccounts} Accounts` : ''}
                      {!p.includedDomains && !p.includedAccounts ? 'Unlimited / Full Server' : ''}
                    </td>
                    <td><span className="ch247-billing-cycle">{p.billingCycle}</span></td>
                    <td>
                      <strong>{Number(p.price) === 0 ? 'Free' : `$${p.price}`}</strong>
                    </td>
                    <td>
                      <Link
                        to={`/servers/new?panel=${panel.slug}&plan=${p.id}`}
                        className="ch247-btn ch247-btn--primary ch247-btn--sm"
                      >
                        Select & Deploy
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
