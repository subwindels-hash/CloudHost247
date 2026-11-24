import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchControlPanel, type ControlPanelDetail } from '../lib/control-panels-api';
import PlatformLogo, { isWidePlatformLogo } from '../components/PlatformLogo';

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

  const hasLiveReadiness = [
    panel.hasPublishedMarketplaceApp,
    panel.hasValidatedManifest,
    panel.hasPanelBootstrapAdapter,
    panel.panelBootstrapProviderVerified,
    panel.panelManagementAvailable,
    panel.panelManagementProviderVerified,
    panel.operationallySupported,
  ].every((value) => typeof value === 'boolean');
  const canInstallMarketplace = hasLiveReadiness && panel.hasPublishedMarketplaceApp === true;
  const canConfigureVps = panel.catalogSource === 'configured'
    && panel.status === 'ACTIVE'
    && panel.operationallySupported === true;
  const hasConfiguredPrice = panel.catalogSource === 'configured'
    && panel.planCount > 0
    && panel.startingPrice !== null;
  const startingPriceLabel = hasConfiguredPrice
    ? Number(panel.startingPrice) === 0
      ? 'No charge listed'
      : `$${panel.startingPrice} / ${panel.billingCycle}`
    : panel.hasPublishedMarketplaceApp
      ? 'See app listing'
      : panel.catalogSource === 'directory'
        ? 'Not configured'
        : 'No active plan';
  const readinessMessage = !hasLiveReadiness
    ? 'This directory entry is shown without live readiness metadata. Marketplace publication, adapter support, and installation capability are unknown; no order or install is enabled.'
    : panel.hasPublishedMarketplaceApp
      ? 'A published application and version appear in the app marketplace. This is catalogue visibility only—not proof of a successful install. Check target compatibility and operation support; the installation record reports the actual deployment and verification outcome.'
      : panel.catalogSource === 'configured'
        ? panel.operationallySupported
          ? 'Bootstrap, per-server verification, and lifecycle operations have provider-backed acceptance records. This still does not prove an individual server installation; follow its deployment and verification record.'
          : panel.hasPanelBootstrapAdapter && !panel.panelBootstrapProviderVerified
            ? 'A bootstrap template exists, but provider-backed installation acceptance and per-server verification are not recorded. This listing is not orderable.'
            : panel.panelManagementAvailable && !panel.panelManagementProviderVerified
              ? 'Management methods exist, but provider-backed lifecycle acceptance is not recorded. This listing is not orderable.'
              : 'This entry is configured, but control-panel lifecycle/verification operations are not implemented in this build. A bootstrap template alone is not proof of installation.'
        : panel.hasValidatedManifest
          ? 'A validated application manifest exists in the repository, but this is not yet an active offer. It still needs publication and provider-backed verification.'
          : panel.hasPanelBootstrapAdapter
            ? 'An installation bootstrap template exists, but lifecycle/API management is not implemented or verified.'
            : 'This is directory information only. No validated install manifest or control-panel bootstrap is available yet.';

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
        <div className={`ch247-panel-detail-header__logo-wrap${isWidePlatformLogo(panel.slug) ? ' ch247-panel-detail-header__logo-wrap--wide' : ''}`}>
          <PlatformLogo slug={panel.slug} name={panel.name} className="ch247-panel-detail-header__logo" />
        </div>
        <div className="ch247-panel-detail-header__info">
          <div className="ch247-badge-row">
            <span className="ch247-badge ch247-badge--category">{panel.category}</span>
            {panel.requiresLicense ? (
              <span className="ch247-tag ch247-tag--license">Commercial license listed</span>
            ) : (
              <span className="ch247-tag ch247-tag--free">No commercial license listed</span>
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
            <span>{hasConfiguredPrice ? 'Configured price' : 'Availability'}</span>
            <strong>{startingPriceLabel}</strong>
          </div>
          {canInstallMarketplace ? (
            <Link to={`/apps/${panel.slug}`} className="ch247-btn ch247-btn--primary ch247-btn--lg">
              View install options
            </Link>
          ) : canConfigureVps ? (
            <Link to={`/servers/new?panel=${panel.slug}`} className="ch247-btn ch247-btn--primary ch247-btn--lg">
              Configure VPS
            </Link>
          ) : (
            <button type="button" className="ch247-btn ch247-btn--primary ch247-btn--lg" disabled title={readinessMessage}>
              Not orderable yet
            </button>
          )}
        </div>
      </header>

      <div className="ch247-banner ch247-banner--warning" role="status">
        {readinessMessage}
      </div>

      <div className="ch247-panel-detail-grid">
        <section className="ch247-card ch247-panel-section">
          <h2>Listed Software Capabilities</h2>
          <p className="ch247-page__hint">Reference directory metadata only. These feature flags are not evidence of a CloudHost247 integration or provider-backed test.</p>
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
          <h2>Reported System Requirements</h2>
          <p className="ch247-page__hint">Directory reference values only; confirm the provider image, architecture, and licensing prerequisites for a real deployment.</p>
          <div className="ch247-requirements-grid">
            <div className="ch247-req-card">
              <span className="ch247-req-label">Minimum RAM</span>
              <strong>{(panel.minimumRequirements.ramMb / 1024).toFixed(panel.minimumRequirements.ramMb % 1024 ? 1 : 0)} GB</strong>
              <small>({panel.minimumRequirements.ramMb} MB)</small>
            </div>
            <div className="ch247-req-card">
              <span className="ch247-req-label">Minimum CPU</span>
              <strong>{panel.minimumRequirements.cpuCores} {panel.minimumRequirements.cpuCores === 1 ? 'Core' : 'Cores'}</strong>
              <small>Verify supported architecture with the software vendor.</small>
            </div>
            <div className="ch247-req-card">
              <span className="ch247-req-label">Minimum Storage</span>
              <strong>{panel.minimumRequirements.diskGb} GB</strong>
              <small>NVMe / SSD</small>
            </div>
            <div className="ch247-req-card">
              <span className="ch247-req-label">Install Method</span>
              <strong>{panel.installationMethod}</strong>
              <small>Listed method; execution and acceptance are not confirmed.</small>
            </div>
          </div>

          <h3 className="ch247-subheading">Listed OS compatibility (reference)</h3>
          <div className="ch247-pill-wrap">
            {panel.supportedOs.map((os) => (
              <span key={os} className="ch247-pill ch247-pill--lg">{os}</span>
            ))}
          </div>
        </section>
      </div>

      {panel.panelOperations && (
        <section className="ch247-card">
          <h2>CloudHost247 Control-Panel Operations</h2>
          <p className="ch247-page__hint">
            The list distinguishes local adapter method presence from provider acceptance. A generated bootstrap script is not evidence that these operations ran successfully.
          </p>
          <details>
            <summary>
              {panel.panelOperations.filter((operation) => operation.implemented).length} of {panel.panelOperations.length} adapter methods implemented; provider verification not recorded
            </summary>
            <ul className="ch247-plainlist">
              {panel.panelOperations.map((operation) => (
                <li key={operation.operation}>
                  <strong>{operation.operation}:</strong>{' '}
                  {operation.implemented ? 'Method implemented' : 'Unsupported'} ·{' '}
                  {operation.providerVerified ? 'provider-verified' : 'not provider-verified'}
                  {operation.reason ? <p className="ch247-page__hint">{operation.reason}</p> : null}
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}

      {panel.plans.length > 0 && (
        <section className="ch247-card ch247-plans-section">
          <h2>Configured Software Plans &amp; Licenses</h2>
          <p className="ch247-page__hint">These active catalogue records are shown for reference. They are not connected to a license checkout flow on this page.</p>
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Plan Name</th>
                  <th>License Tier</th>
                  <th>Included Limits</th>
                  <th>Billing Cycle</th>
                  <th>Price</th>
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
                      {!p.includedDomains && !p.includedAccounts ? 'No numeric limit listed' : ''}
                    </td>
                    <td><span className="ch247-billing-cycle">{p.billingCycle}</span></td>
                    <td>
                      <strong>{Number(p.price) === 0 ? 'No charge listed' : `$${p.price}`}</strong>
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
