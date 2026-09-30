import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchControlPanels, type ControlPanelSummary } from '../lib/control-panels-api';
import StatusBadge from '../components/StatusBadge';

export default function ControlPanelsPage() {
  const [panels, setPanels] = useState<ControlPanelSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [licenseFilter, setLicenseFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');

  useEffect(() => {
    fetchControlPanels()
      .then(setPanels)
      .catch((err) => setError(err.message));
  }, []);

  const filtered = useMemo(() => {
    if (!panels) return [];
    return panels.filter((p) => {
      if (categoryFilter !== 'ALL' && p.category !== categoryFilter) return false;
      if (licenseFilter === 'FREE' && p.requiresLicense) return false;
      if (licenseFilter === 'COMMERCIAL' && !p.requiresLicense) return false;
      if (search.trim()) {
        const query = search.toLowerCase();
        const matchesName = p.name.toLowerCase().includes(query);
        const matchesDesc = (p.description ?? '').toLowerCase().includes(query);
        const matchesOs = p.supportedOs.some((os) => os.toLowerCase().includes(query));
        if (!matchesName && !matchesDesc && !matchesOs) return false;
      }
      return true;
    });
  }, [panels, categoryFilter, licenseFilter, search]);

  const categoryCounts = useMemo(() => {
    if (!panels) return { ALL: 0, SERVER_PANEL: 0, APPLICATION_DEPLOYMENT_PLATFORM: 0, SERVER_MANAGEMENT: 0 };
    return {
      ALL: panels.length,
      SERVER_PANEL: panels.filter((p) => p.category === 'SERVER_PANEL').length,
      APPLICATION_DEPLOYMENT_PLATFORM: panels.filter((p) => p.category === 'APPLICATION_DEPLOYMENT_PLATFORM').length,
      SERVER_MANAGEMENT: panels.filter((p) => p.category === 'SERVER_MANAGEMENT').length,
    };
  }, [panels]);

  return (
    <div className="ch247-page">
      <header className="ch247-page__head ch247-page__head--banner">
        <div>
          <span className="ch247-eyebrow">CloudHost247 Platform Catalog</span>
          <h1>Control Panels & Application Platforms</h1>
          <p className="ch247-page__subtitle">
            Deploy production-ready hosting control panels, PaaS engines, and server management software directly onto high-performance CloudHost247 compute infrastructure.
          </p>
        </div>
      </header>

      {error && <div className="ch247-banner ch247-banner--error">{error}</div>}

      <div className="ch247-marketplace-controls">
        <div className="ch247-filter-tabs" role="tablist" aria-label="Control panel categories">
          {[
            { id: 'ALL', label: 'All Platforms', count: categoryCounts.ALL },
            { id: 'SERVER_PANEL', label: 'Web Hosting Panels', count: categoryCounts.SERVER_PANEL },
            { id: 'APPLICATION_DEPLOYMENT_PLATFORM', label: 'App Deployment & PaaS', count: categoryCounts.APPLICATION_DEPLOYMENT_PLATFORM },
            { id: 'SERVER_MANAGEMENT', label: 'Server Management', count: categoryCounts.SERVER_MANAGEMENT },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={categoryFilter === tab.id}
              className={`ch247-filter-tab ${categoryFilter === tab.id ? 'is-active' : ''}`}
              onClick={() => setCategoryFilter(tab.id)}
            >
              {tab.label} <span className="ch247-badge ch247-badge--muted">{tab.count}</span>
            </button>
          ))}
        </div>

        <div className="ch247-search-row">
          <label className="ch247-field ch247-search-field">
            <span className="sr-only">Search platforms</span>
            <input
              type="text"
              placeholder="Search by name, OS, or description (e.g. cPanel, Docker, Ubuntu)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            className="ch247-select-filter"
            value={licenseFilter}
            onChange={(e) => setLicenseFilter(e.target.value)}
            aria-label="Filter by licensing"
          >
            <option value="ALL">All Licenses</option>
            <option value="FREE">Free & Open Source</option>
            <option value="COMMERCIAL">Commercial Licenses</option>
          </select>
        </div>
      </div>

      {!panels && !error && (
        <div className="ch247-loading">Loading supported platforms from database...</div>
      )}

      {panels && filtered.length === 0 && (
        <div className="ch247-empty">
          <p>No control panels match the selected filters.</p>
          <button className="ch247-btn" onClick={() => { setCategoryFilter('ALL'); setLicenseFilter('ALL'); setSearch(''); }}>
            Reset Filters
          </button>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="ch247-panel-grid">
          {filtered.map((panel) => {
            const priceNum = Number(panel.startingPrice);
            const priceDisplay = priceNum === 0 ? 'Free' : `$${panel.startingPrice} / ${panel.billingCycle}`;
            return (
              <article key={panel.id} className="ch247-card ch247-panel-card">
                <div className="ch247-panel-card__header">
                  <div className="ch247-panel-card__logo-wrap">
                    {panel.logoUrl ? (
                      <img src={panel.logoUrl} alt={`${panel.name} logo`} className="ch247-panel-card__logo" />
                    ) : (
                      <span className="ch247-panel-card__logo-fallback">{panel.name.slice(0, 2).toUpperCase()}</span>
                    )}
                  </div>
                  <div>
                    <h2 className="ch247-panel-card__title">{panel.name}</h2>
                    <span className="ch247-badge ch247-badge--category">
                      {panel.category === 'APPLICATION_DEPLOYMENT_PLATFORM' ? 'App Deployment' : panel.category === 'SERVER_MANAGEMENT' ? 'Management' : 'Server Panel'}
                    </span>
                  </div>
                </div>

                <p className="ch247-panel-card__desc">{panel.description}</p>

                <div className="ch247-panel-card__specs">
                  <div className="ch247-spec-item">
                    <span className="ch247-spec-label">Min. Spec</span>
                    <span className="ch247-spec-value">
                      {panel.minimumRequirements.cpuCores} CPU · {(panel.minimumRequirements.ramMb / 1024).toFixed(panel.minimumRequirements.ramMb % 1024 ? 1 : 0)} GB RAM · {panel.minimumRequirements.diskGb} GB
                    </span>
                  </div>
                  <div className="ch247-spec-item">
                    <span className="ch247-spec-label">License</span>
                    <span className="ch247-spec-value">
                      {panel.requiresLicense ? (
                        <span className="ch247-tag ch247-tag--license">Commercial</span>
                      ) : (
                        <span className="ch247-tag ch247-tag--free">Free & Included</span>
                      )}
                    </span>
                  </div>
                  <div className="ch247-spec-item">
                    <span className="ch247-spec-label">Supported OS</span>
                    <span className="ch247-spec-value ch247-spec-os">
                      {panel.supportedOs.slice(0, 3).map((os) => (
                        <span key={os} className="ch247-pill">{os}</span>
                      ))}
                      {panel.supportedOs.length > 3 && (
                        <span className="ch247-pill ch247-pill--more">+{panel.supportedOs.length - 3}</span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="ch247-panel-card__footer">
                  <div className="ch247-panel-card__pricing">
                    <span className="ch247-panel-card__price-label">CloudHost247 Price</span>
                    <strong className="ch247-panel-card__price">{priceDisplay}</strong>
                  </div>
                  <div className="ch247-panel-card__actions">
                    <Link to={`/hosting/control-panels/${panel.slug}`} className="ch247-btn ch247-btn--secondary">
                      View Details
                    </Link>
                    <Link to={`/servers/new?panel=${panel.slug}`} className="ch247-btn ch247-btn--primary">
                      Deploy Now
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
