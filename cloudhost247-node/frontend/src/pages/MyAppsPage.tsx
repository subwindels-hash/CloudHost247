import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { fetchMyInstallations, type MyInstallation } from '../lib/marketplace-api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { formatMemory } from '../components/AppTile';

/** Health badge mapping — every status gets an explicit visual state (spec §47). */
function HealthBadge({ status }: { status: string }) {
  const cls =
    status === 'healthy'
      ? 'ch247-badge ch247-badge--active'
      : status === 'unhealthy' || status === 'failed'
        ? 'ch247-badge ch247-badge--danger'
        : 'ch247-badge ch247-badge--warning';
  return <span className={cls}>{status || 'unknown'}</span>;
}

/**
 * "My Applications" (spec §44): every installation this customer owns, its app, version,
 * server, status, health, resources, and last backup — straight from
 * GET /api/v1/app-installations.
 */
export default function MyAppsPage() {
  usePageMeta('My Applications', 'Manage your installed CloudHost247 applications.');
  const [installations, setInstallations] = useState<MyInstallation[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchMyInstallations()
      .then((result) => !cancelled && setInstallations(result.installations))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>My Applications</h1>
        <p className="ch247-page__hint">
          Applications you have installed on CloudHost247 hosting. Open one to manage its
          lifecycle, logs, backups, domains, and configuration.
        </p>
      </div>

      {error && <CatalogErrorBanner message={error} />}
      {installations === null && !error && <CatalogLoadingBanner label="Loading your applications…" />}

      {installations !== null && installations.length === 0 && (
        <div className="ch247-card">
          <p className="ch247-page__hint">
            You have not installed any applications yet. Browse the{' '}
            <Link to="/apps">App Marketplace</Link> to deploy your first one.
          </p>
        </div>
      )}

      {installations !== null &&
        installations.map((installation) => (
          <div key={installation.id} className="ch247-card ch247-instrow">
            <div className="ch247-instrow__main">
              <h2>
                <Link to={`/dashboard/apps/${installation.id}`}>{installation.name}</Link>
              </h2>
              <p className="ch247-market-card__cat">
                {installation.application?.name ?? 'Application'}
                {installation.version ? ` · v${installation.version}` : ''}
                {installation.server ? ` · ${installation.server.name} (${installation.server.type})` : ''}
              </p>
              {installation.domain && (
                <p>
                  <a href={`https://${installation.domain}`} target="_blank" rel="noreferrer">
                    {installation.domain}
                  </a>
                </p>
              )}
            </div>
            <div className="ch247-instrow__side">
              <p>
                <span className="ch247-badge">{installation.status}</span> <HealthBadge status={installation.health} />
              </p>
              <p className="ch247-page__hint">
                {installation.cpuLimit ? `${installation.cpuLimit} CPU · ` : ''}
                {installation.memoryLimitMb ? `${formatMemory(installation.memoryLimitMb)} · ` : ''}
                {installation.restartCount > 0 ? `${installation.restartCount} restarts · ` : ''}
                {installation.lastBackupAt
                  ? `last backup ${new Date(installation.lastBackupAt).toLocaleString()}`
                  : 'no backup yet'}
              </p>
              <Link className="ch247-btn" to={`/dashboard/apps/${installation.id}`}>
                Manage
              </Link>
            </div>
          </div>
        ))}
    </div>
  );
}
