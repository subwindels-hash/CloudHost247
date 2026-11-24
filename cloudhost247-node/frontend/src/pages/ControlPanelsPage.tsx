import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchControlPanelsPage, type ControlPanelPage, type ControlPanelSummary } from '../lib/control-panels-api';
import PlatformLogo, { isWidePlatformLogo } from '../components/PlatformLogo';
import './control-panels-page.css';

// Each click requests one more metadata page, and only mounted cards request
// their lazily loaded inline SVG group. Search and filters apply to all 1,091
// listings on the server, not just the cards already fetched into the browser.
const PAGE_SIZE = 24;
const EMPTY_COUNTS: ControlPanelPage['categoryCounts'] = {
  ALL: 0, OPERATING_SYSTEM: 0, SERVER_PANEL: 0,
  APPLICATION_DEPLOYMENT_PLATFORM: 0, SERVER_MANAGEMENT: 0,
};

export default function ControlPanelsPage() {
  const [panels, setPanels] = useState<ControlPanelSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [categoryCounts, setCategoryCounts] = useState(EMPTY_COUNTS);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [licenseFilter, setLicenseFilter] = useState<string>('ALL');
  const [search, setSearch] = useState<string>('');
  const requestId = useRef(0);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const id = ++requestId.current;
    const controller = new AbortController();
    moreController.current?.abort();
    moreController.current = null;
    setPanels(null);
    setTotal(0);
    setError(null);
    setLoadingMore(false);
    fetchControlPanelsPage({
      offset: 0, limit: PAGE_SIZE,
      category: categoryFilter === 'ALL' ? undefined : categoryFilter,
      license: licenseFilter === 'ALL' ? undefined : licenseFilter as 'FREE' | 'COMMERCIAL',
      search, signal: controller.signal,
    }).then((page) => {
      if (id !== requestId.current) return;
      setPanels(page.controlPanels);
      setTotal(page.total);
      setCategoryCounts(page.categoryCounts);
    }).catch((err: Error) => {
      if (id === requestId.current && !controller.signal.aborted) setError(err.message);
    });
    return () => { controller.abort(); moreController.current?.abort(); moreController.current = null; };
  }, [categoryFilter, licenseFilter, search]);

  const showMore = async () => {
    if (!panels || panels.length >= total || loadingMore || moreController.current) return;
    const id = requestId.current;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await fetchControlPanelsPage({
        offset: panels.length, limit: PAGE_SIZE,
        category: categoryFilter === 'ALL' ? undefined : categoryFilter,
        license: licenseFilter === 'ALL' ? undefined : licenseFilter as 'FREE' | 'COMMERCIAL',
        search, signal: controller.signal,
      });
      if (id !== requestId.current || controller.signal.aborted) return;
      setPanels((current) => current ? [...current, ...page.controlPanels] : current);
      setTotal(page.total);
      setCategoryCounts(page.categoryCounts);
    } catch (err) {
      if (id === requestId.current && !controller.signal.aborted) setError(`Could not load more platforms: ${(err as Error).message}`);
    } finally {
      if (id === requestId.current) setLoadingMore(false);
      if (moreController.current === controller) moreController.current = null;
    }
  };
  const remainingCount = total - (panels?.length ?? 0);
  const freePanels = panels?.filter((p) => !p.requiresLicense) ?? [];
  const paidPanels = panels?.filter((p) => p.requiresLicense) ?? [];

  const renderPanelCard = (panel: ControlPanelSummary) => {
    const priceNum = Number(panel.startingPrice);
    const priceDisplay = priceNum === 0
      ? (panel.requiresLicense ? `$0 / ${panel.billingCycle}` : 'Free')
      : `$${panel.startingPrice} / ${panel.billingCycle}`;
    return (
      <article key={panel.id} className="ch247-card ch247-panel-card">
        <div className="ch247-panel-card__header">
          <div className={`ch247-panel-card__logo-wrap${isWidePlatformLogo(panel.slug) ? ' ch247-panel-card__logo-wrap--wide' : ''}`}>
            <PlatformLogo slug={panel.slug} name={panel.name} className="ch247-panel-card__logo" />
          </div>
          <div>
            <h2 className="ch247-panel-card__title">{panel.name}</h2>
            <span className="ch247-badge ch247-badge--category">
              {panel.category === 'OPERATING_SYSTEM'
                ? 'Operating System'
                : panel.category === 'APPLICATION_DEPLOYMENT_PLATFORM'
                  ? 'App Deployment'
                  : panel.category === 'SERVER_MANAGEMENT'
                    ? 'Management'
                    : 'Server Panel'}
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
  };

  return (
    <div className="ch247-control-panels-page">
      <section className="ch247-hero ch247-hero--compact ch247-control-panels-hero ch247-hero--servers">
        <div className="ch247-hero__inner">
          <p className="ch247-control-panels-hero__eyebrow"><span aria-hidden="true">✦</span> CloudHost247 platform catalog</p>
          <h1>Control Panels &amp; Application Platforms</h1>
          <p>
            Browse the control panels and application platforms in CloudHost247’s live catalogue. Availability, operating systems and product features depend on the configured service.
          </p>
        </div>
      </section>

      <section className="ch247-section ch247-control-panels-section">
        <div className="ch247-control-panels__body">
          {error && <div className="ch247-banner ch247-banner--error">{error}</div>}
          <div className="ch247-marketplace-controls ch247-control-panels-controls">
            <div className="ch247-filter-tabs" role="tablist" aria-label="Control panel categories">
              {[
                { id: 'ALL', label: 'All Platforms', count: categoryCounts.ALL },
                { id: 'OPERATING_SYSTEM', label: 'Operating Systems', count: categoryCounts.OPERATING_SYSTEM },
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
                  maxLength={160}
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
            <div className="ch247-loading">Loading platform catalogue...</div>
          )}

          {panels && total === 0 && (
            <div className="ch247-empty">
              <p>No control panels match the selected filters.</p>
              <button type="button" className="ch247-btn" onClick={() => { setCategoryFilter('ALL'); setLicenseFilter('ALL'); setSearch(''); }}>
                Reset Filters
              </button>
            </div>
          )}

          {panels && total > 0 && (
            <>
            <p className="ch247-control-panels-count" role="status" aria-live="polite">
              Showing {panels.length} of {total} platforms
            </p>
            <div id="platform-results" aria-busy={loadingMore}>
              {freePanels.length > 0 && (
                <section className="ch247-panel-group" aria-labelledby="ch247-free-panels-heading">
                  <div className="ch247-panel-group__header">
                    <h2 id="ch247-free-panels-heading" className="ch247-panel-group__title">Free &amp; Included</h2>
                    <span className="ch247-badge ch247-badge--muted">{freePanels.length}</span>
                  </div>
                  <div className="ch247-panel-grid">
                    {freePanels.map(renderPanelCard)}
                  </div>
                </section>
              )}
              {paidPanels.length > 0 && (
                <section className="ch247-panel-group" aria-labelledby="ch247-paid-panels-heading">
                  <div className="ch247-panel-group__header">
                    <h2 id="ch247-paid-panels-heading" className="ch247-panel-group__title">Paid &amp; Commercial</h2>
                    <span className="ch247-badge ch247-badge--muted">{paidPanels.length}</span>
                  </div>
                  <div className="ch247-panel-grid">
                    {paidPanels.map(renderPanelCard)}
                  </div>
                </section>
              )}
            </div>
            {remainingCount > 0 && (
              <div className="ch247-control-panels-more">
                <button
                  type="button"
                  className="ch247-btn ch247-btn--secondary"
                  aria-controls="platform-results"
                  onClick={() => void showMore()}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading more…' : 'Show more'} <span aria-hidden="true">↓</span>
                  <span className="sr-only">({remainingCount} more platforms)</span>
                </button>
              </div>
            )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}


