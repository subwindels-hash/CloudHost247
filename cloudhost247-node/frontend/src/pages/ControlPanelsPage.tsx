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

  return (
    <div className="ch247-control-panels-page">
      <section className="ch247-hero ch247-hero--compact ch247-control-panels-hero ch247-hero--servers">
        <div className="ch247-hero__inner">
          <p className="ch247-control-panels-hero__eyebrow"><span aria-hidden="true">✦</span> CloudHost247 platform directory</p>
          <h1>Control Panels &amp; Application Platforms</h1>
          <p>
            Browse directory entries for control panels and application platforms. Catalogue presence, bootstrap templates, provider acceptance, installation verification, and lifecycle management are separate facts; only verified support is orderable.
          </p>
        </div>
      </section>

      <section className="ch247-section ch247-control-panels-section">
        <div className="ch247-control-panels__body">
          {error && <div className="ch247-banner ch247-banner--error">{error}</div>}
          <p className="ch247-logo-disclaimer">Logos identify software, not partnerships. Where original artwork has not been verified, the first two letters identify the app instead.</p>

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
            <div id="platform-results" className="ch247-panel-grid" aria-busy={loadingMore}>
              {panels.map((panel) => {
                const hasConfiguredPrice = panel.catalogSource === 'configured' && panel.planCount > 0 && panel.startingPrice !== null;
                const priceNum = hasConfiguredPrice ? Number(panel.startingPrice) : null;
                const priceDisplay = priceNum === null
                  ? 'Not configured'
                  : priceNum === 0 ? 'No charge listed' : `$${panel.startingPrice} / ${panel.billingCycle}`;
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
                const supportLabel = canInstallMarketplace
                  ? 'Published app listing'
                  : !hasLiveReadiness
                    ? 'Live readiness unknown'
                    : panel.catalogSource === 'configured'
                      ? panel.operationallySupported
                        ? 'Operational integration verified'
                        : panel.hasPanelBootstrapAdapter && !panel.panelBootstrapProviderVerified
                          ? 'Bootstrap not provider-verified'
                          : panel.panelManagementAvailable && !panel.panelManagementProviderVerified
                            ? 'Management not provider-verified'
                            : 'Panel management unavailable'
                      : panel.hasValidatedManifest
                        ? 'Manifest in source'
                        : panel.hasPanelBootstrapAdapter
                          ? 'Bootstrap template'
                          : 'Directory only';
                const supportTitle = !hasLiveReadiness
                  ? 'This directory entry is shown without live readiness metadata. Marketplace publication, adapter support, and installation capability are unknown; no order or install is enabled.'
                  : canInstallMarketplace
                    ? 'A published application and version appear in the app marketplace. This listing is not proof of a successful install; target compatibility, supported operations, and the resulting deployment/verification record determine the outcome.'
                    : panel.catalogSource === 'configured'
                      ? panel.operationallySupported
                        ? 'Bootstrap, verification, and lifecycle operations have provider-backed acceptance records; confirm current provider availability and license terms before ordering.'
                        : panel.hasPanelBootstrapAdapter && !panel.panelBootstrapProviderVerified
                          ? 'A bootstrap template exists, but provider-backed installation acceptance and per-server verification are not recorded. This listing is not orderable.'
                          : panel.panelManagementAvailable && !panel.panelManagementProviderVerified
                            ? 'Management adapter methods exist, but provider-backed lifecycle acceptance is not recorded. This listing is not orderable.'
                            : 'Configured listing, but control-panel lifecycle/verification operations are not implemented in this build. A bootstrap template alone is not proof of installation.'
                      : panel.hasValidatedManifest
                        ? 'A validated app manifest exists in the repository; it still needs publication and provider-backed verification before it is an orderable offer.'
                        : panel.hasPanelBootstrapAdapter
                          ? 'An installation bootstrap template exists, but this does not include a working lifecycle/API integration.'
                          : 'Directory metadata only; no validated install manifest or control-panel bootstrap is available yet.';
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
                        <span className="ch247-tag ch247-tag--readiness" title={supportTitle}>{supportLabel}</span>
                      </div>
                    </div>

                    <p className="ch247-panel-card__desc">{panel.description}</p>

                    <div className="ch247-panel-card__specs">
                      <div className="ch247-spec-item">
                        <span className="ch247-spec-label">Listed minimum spec</span>
                        <span className="ch247-spec-value">
                          {panel.minimumRequirements.cpuCores} CPU · {(panel.minimumRequirements.ramMb / 1024).toFixed(panel.minimumRequirements.ramMb % 1024 ? 1 : 0)} GB RAM · {panel.minimumRequirements.diskGb} GB
                        </span>
                      </div>
                      <div className="ch247-spec-item">
                        <span className="ch247-spec-label">License</span>
                        <span className="ch247-spec-value">
                          {panel.requiresLicense ? (
                            <span className="ch247-tag ch247-tag--license">Commercial license listed</span>
                          ) : (
                            <span className="ch247-tag ch247-tag--free">No commercial license listed</span>
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
                        <span className="ch247-panel-card__price-label">Configured price</span>
                        <strong className="ch247-panel-card__price">{priceDisplay}</strong>
                      </div>
                      <div className="ch247-panel-card__actions">
                        <Link to={`/hosting/control-panels/${panel.slug}`} className="ch247-btn ch247-btn--secondary">
                          View Details
                        </Link>
                        {canInstallMarketplace ? (
                          <Link to={`/apps/${panel.slug}`} className="ch247-btn ch247-btn--primary">
                            View app listing
                          </Link>
                        ) : canConfigureVps ? (
                          <Link to={`/servers/new?panel=${panel.slug}`} className="ch247-btn ch247-btn--primary">
                            Configure VPS
                          </Link>
                        ) : (
                          <button type="button" className="ch247-btn ch247-btn--primary" disabled title={supportTitle}>
                            Not orderable yet
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
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


