import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  deleteInstallation,
  fetchMyInstallations,
  installationAction,
  type MyInstallation,
} from '../lib/marketplace-api';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { formatMemory } from '../components/AppTile';
import { subscribeToDeployment, type DeploymentSummary, type DeploymentEvent } from '../lib/marketplace-api';

interface InstallationDetailRow {
  id: string;
  name: string;
  status: string;
  health_status: string;
  domain: string | null;
  application_id: string;
  application_version_id: string;
  server_id: string | null;
  cpu_limit: number | null;
  memory_limit_mb: number | null;
  storage_limit_mb: number | null;
  restart_count: number;
  last_backup_at: string | null;
  created_at: string;
}

interface BackupRow {
  id: string;
  status: string;
  size_bytes: number | null;
  created_at: string;
  storage_provider: string | null;
  /** Recorded by the platform from the agent's report (0068). Absent on older rows. */
  database_dump?: { engine: string | null; reason?: string } | null;
}

/**
 * What a backup holds, from the agent's own report — the difference between an archive that can
 * restore a database and one that only restores files. "Not recorded" is a third state and is
 * printed as such: a backup taken before the platform stored this says nothing either way.
 */
function backupContents(backup: BackupRow): { label: string; title?: string } {
  const dump = backup.database_dump;
  if (!dump) return { label: 'not recorded' };
  if (dump.engine) return { label: `database (${dump.engine})` };
  return { label: 'no database dump', title: dump.reason };
}

interface EnvironmentKeyRow {
  key: string;
  is_secret: boolean;
  updated_at: string;
}

interface DomainRow {
  id: string;
  domain_name: string;
  is_primary: boolean;
  verification_status: string;
}

/**
 * Application instance management (spec §45–§48): overview + tabs for live status, logs,
 * backups, domains, configuration, and the deployment history. Every action (start/stop/
 * restart/update/backup/restore/uninstall) is an async job — the page links to the live
 * deployment console rather than pretending anything happened synchronously.
 */
export default function AppInstancePage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  usePageMeta('Application', 'Manage your application installation');
  const [summary, setSummary] = useState<MyInstallation | null>(null);
  const [detail, setDetail] = useState<InstallationDetailRow | null>(null);
  const [tab, setTab] = useState<'overview' | 'logs' | 'backups' | 'domains' | 'config' | 'deployments'>(() => {
    if (location.pathname.endsWith('/logs')) return 'logs';
    if (location.pathname.endsWith('/backups')) return 'backups';
    if (location.pathname.endsWith('/settings')) return 'config';
    if (location.pathname.endsWith('/domains')) return 'domains';
    return 'overview';
  });
  const [error, setError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [busy, setBusy] = useState('');

  // Tab data
  const [logs, setLogs] = useState<string | null>(null);
  const [backups, setBackups] = useState<BackupRow[] | null>(null);
  const [envKeys, setEnvKeys] = useState<EnvironmentKeyRow[] | null>(null);
  const [domains, setDomains] = useState<DomainRow[] | null>(null);
  const [deployments, setDeployments] = useState<DeploymentSummary[] | null>(null);
  const [liveEvents, setLiveEvents] = useState<DeploymentEvent[]>([]);
  const [liveStatus, setLiveStatus] = useState('');

  const installationId = id ?? '';

  const loadCore = useCallback(() => {
    let cancelled = false;
    apiFetch<{ installation: InstallationDetailRow; application: { name: string; slug: string } | null }>(
      `/api/v1/app-installations/${installationId}`
    )
      .then((result) => !cancelled && setDetail(result.installation))
      .catch((err: Error) => !cancelled && setError(err.message));
    fetchMyInstallations()
      .then((result) => {
        if (cancelled) return;
        const match = result.installations.find((inst) => inst.id === installationId);
        if (match) setSummary(match);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [installationId]);

  useEffect(() => loadCore(), [loadCore]);

  // Tab loaders — each tab fetches its own sub-resource on first open.
  useEffect(() => {
    if (tab === 'logs' && logs === null) {
      apiFetch<{ logs: string }>(`/api/v1/app-installations/${installationId}/logs?tail=200`)
        .then((result) => setLogs(result.logs))
        .catch((err: Error) => setLogs(`Logs unavailable: ${err.message}`));
    }
    if (tab === 'backups' && backups === null) {
      apiFetch<{ backups: BackupRow[] }>(`/api/v1/app-installations/${installationId}/backups`)
        .then((result) => setBackups(result.backups))
        .catch(() => setBackups([]));
    }
    if (tab === 'domains' && domains === null) {
      apiFetch<{ domains: DomainRow[] }>(`/api/v1/app-installations/${installationId}/domains`)
        .then((result) => setDomains(result.domains))
        .catch(() => setDomains([]));
    }
    if (tab === 'config' && envKeys === null) {
      apiFetch<{ environment: EnvironmentKeyRow[] }>(`/api/v1/app-installations/${installationId}/environment`)
        .then((result) => setEnvKeys(result.environment))
        .catch(() => setEnvKeys([]));
    }
    if (tab === 'deployments' && deployments === null) {
      apiFetch<{ deployments: DeploymentSummary[] }>(`/api/v1/app-installations/${installationId}/deployments`)
        .then((result) => setDeployments(result.deployments))
        .catch(() => setDeployments([]));
    }
  }, [tab, installationId, logs, backups, domains, envKeys, deployments]);

  // Live status feed while a deployment is running for this installation.
  useEffect(() => {
    if (!deployments || deployments.length === 0) return;
    const active = deployments.find((deployment) => !['succeeded', 'failed', 'cancelled', 'rolled_back'].includes(deployment.status));
    if (!active) return;
    const unsubscribe = subscribeToDeployment(active.id, {
      onEvents: (incoming) => setLiveEvents((existing) => [...existing, ...incoming]),
      onState: (state) => setLiveStatus(state.status),
      onDone: () => {
        loadCore();
        apiFetch<{ deployments: DeploymentSummary[] }>(`/api/v1/app-installations/${installationId}/deployments`)
          .then((result) => setDeployments(result.deployments))
          .catch(() => undefined);
      },
    });
    return unsubscribe;
  }, [deployments, installationId, loadCore]);

  async function runAction(action: string, body?: unknown) {
    setBusy(action);
    setActionMessage('');
    try {
      const result = await installationAction(installationId, action, body);
      setActionMessage(
        result.queued
          ? `${action} queued — watch it run on the deployment console.`
          : `${action} job already active.`
      );
      // Follow the fresh deployment in the deployments tab.
      setTab('deployments');
      setDeployments(null);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : `${action} failed`);
    } finally {
      setBusy('');
    }
  }

  async function uninstall() {
    if (!window.confirm('Uninstall this application? Its data volumes will be removed after the final backup.')) return;
    setBusy('uninstall');
    try {
      const result = await deleteInstallation(installationId);
      setActionMessage(`Uninstall queued (deployment ${result.deploymentId}). A final backup runs first.`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Uninstall failed');
    } finally {
      setBusy('');
    }
  }

  if (error && !detail) return <CatalogErrorBanner message={error} />;
  if (!detail) return <CatalogLoadingBanner label="Loading application…" />;

  const status = liveStatus || detail.status;
  const runningDeployment = deployments?.find(
    (deployment) => !['succeeded', 'failed', 'cancelled', 'rolled_back'].includes(deployment.status)
  );

  const tabs: Array<[typeof tab, string]> = [
    ['overview', 'Overview'],
    ['logs', 'Logs'],
    ['backups', 'Backups'],
    ['domains', 'Domains'],
    ['config', 'Configuration'],
    ['deployments', 'Deployments'],
  ];

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>{detail.name}</h1>
        <p className="ch247-market-card__cat">
          {summary?.application?.name ?? 'Application'}
          {summary?.version ? ` · v${summary.version}` : ''} ·{' '}
          <span className="ch247-badge">{status}</span>{' '}
          <span
            className={`ch247-badge ${
              detail.health_status === 'healthy'
                ? 'ch247-badge--active'
                : detail.health_status === 'unhealthy'
                  ? 'ch247-badge--danger'
                  : 'ch247-badge--warning'
            }`}
          >
            {detail.health_status || 'unknown'} health
          </span>
          {detail.domain && (
            <>
              {' '}
              <a href={`https://${detail.domain}`} target="_blank" rel="noreferrer">
                {detail.domain}
              </a>
            </>
          )}
        </p>
        {actionMessage && <p className="ch247-banner ch247-banner--info">{actionMessage}</p>}
        {error && <CatalogErrorBanner message={error} />}
        {runningDeployment && (
          <p className="ch247-banner ch247-banner--info">
            A {runningDeployment.action} deployment is running —{' '}
            <Link to={`/dashboard/deployments/${runningDeployment.id}`}>watch it live</Link>.
          </p>
        )}

        <div className="ch247-actions">
          <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => runAction('start')}>
            Start
          </button>
          <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => runAction('stop')}>
            Stop
          </button>
          <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => runAction('restart')}>
            Restart
          </button>
          <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => runAction('update')}>
            Update
          </button>
          <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => runAction('backup')}>
            Back up now
          </button>
          <button type="button" className="ch247-btn ch247-btn--danger" disabled={busy !== ''} onClick={uninstall}>
            Uninstall
          </button>
        </div>

        <nav className="ch247-tabs" aria-label="Application sections">
          {tabs.map(([key, label]) => (
            <button key={key} type="button" className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'overview' && (
        <div className="ch247-card">
          <h2>Details</h2>
          <dl className="ch247-kv">
            <dt>Application</dt>
            <dd>{summary?.application?.name ?? detail.application_id}</dd>
            <dt>Status</dt>
            <dd>{status}</dd>
            <dt>Server</dt>
            <dd>{summary?.server ? `${summary.server.name} (${summary.server.type})` : 'Not assigned yet'}</dd>
            <dt>CPU limit</dt>
            <dd>{detail.cpu_limit ? `${detail.cpu_limit} cores` : '—'}</dd>
            <dt>Memory limit</dt>
            <dd>{detail.memory_limit_mb ? formatMemory(detail.memory_limit_mb) : '—'}</dd>
            <dt>Storage limit</dt>
            <dd>{detail.storage_limit_mb ? `${Math.round(detail.storage_limit_mb / 1024)} GB` : '—'}</dd>
            <dt>Restart count</dt>
            <dd>{detail.restart_count}</dd>
            <dt>Last backup</dt>
            <dd>{detail.last_backup_at ? new Date(detail.last_backup_at).toLocaleString() : 'never'}</dd>
            <dt>Created</dt>
            <dd>{new Date(detail.created_at).toLocaleString()}</dd>
          </dl>
        </div>
      )}

      {tab === 'logs' && (
        <div className="ch247-card">
          <h2>Recent logs</h2>
          {logs === null ? (
            <CatalogLoadingBanner label="Loading logs…" />
          ) : (
            <div className="ch247-console">
              {logs.split('\n').map((line, index) => (
                <div key={index} className="ch247-console__line">
                  {line}
                </div>
              ))}
            </div>
          )}
          <p className="ch247-page__hint">
            Read-only view of the last 200 lines from your application's containers, fetched live
            from your server.
          </p>
        </div>
      )}

      {tab === 'backups' && (
        <div className="ch247-card">
          <h2>Backups</h2>
          {backups === null ? (
            <CatalogLoadingBanner label="Loading backups…" />
          ) : backups.length === 0 ? (
            <p className="ch247-page__hint">
              No backups yet. Run "Back up now", or wait for the nightly schedule — archives are
              stored off-server with a recorded checksum.
            </p>
          ) : (
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Size</th>
                  <th>Contents</th>
                  <th>Storage</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id}>
                    <td>{new Date(backup.created_at).toLocaleString()}</td>
                    <td>
                      <span className="ch247-badge">{backup.status}</span>
                    </td>
                    <td>{backup.size_bytes ? `${(backup.size_bytes / 1024 / 1024).toFixed(1)} MB` : '—'}</td>
                    <td title={backupContents(backup).title}>{backupContents(backup).label}</td>
                    <td>{backup.storage_provider ?? 'local'}</td>
                    <td>
                      {backup.status === 'completed' && (
                        <button
                          type="button"
                          className="ch247-btn"
                          disabled={busy !== ''}
                          onClick={() => runAction('restore', { backupId: backup.id })}
                        >
                          Restore
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'domains' && (
        <div className="ch247-card">
          <h2>Domains</h2>
          {domains === null ? (
            <CatalogLoadingBanner label="Loading domains…" />
          ) : domains.length === 0 ? (
            <p className="ch247-page__hint">
              No domains attached. Verify a domain under{' '}
              <Link to="/dashboard/domains">Dashboard → Domains</Link>, then attach it here — SSL
              is issued automatically.
            </p>
          ) : (
            <ul className="ch247-plainlist">
              {domains.map((domain) => (
                <li key={domain.id}>
                  {domain.is_primary ? '★ ' : ''}
                  {domain.domain_name} <span className="ch247-badge">{domain.verification_status}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="ch247-page__hint">Attach domains from the Domains page of your dashboard.</p>
        </div>
      )}

      {tab === 'config' && (
        <div className="ch247-card">
          <h2>Configuration</h2>
          <p className="ch247-page__hint">
            Environment keys for this installation. Values are stored encrypted and never shown —
            not even to staff. Set a new value to override; blank keeps the existing one.
          </p>
          {envKeys === null ? (
            <CatalogLoadingBanner label="Loading configuration…" />
          ) : (
            <ul className="ch247-plainlist">
              {envKeys.map((item) => (
                <li key={item.key}>
                  <code>{item.key}</code> {item.is_secret ? <span className="ch247-badge">secret</span> : null}
                  <form
                    className="ch247-inlineform"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = event.currentTarget;
                      const value = new FormData(form).get('value');
                      if (typeof value !== 'string' || !value) return;
                      setBusy(`env:${item.key}`);
                      try {
                        await apiFetch(`/api/v1/app-installations/${installationId}/environment`, {
                          method: 'PUT',
                          body: JSON.stringify({ key: item.key, value, isSecret: item.is_secret }),
                        });
                        setActionMessage(`Updated ${item.key}. Restart the application to apply it.`);
                        form.reset();
                      } catch (err) {
                        setActionMessage(err instanceof Error ? err.message : 'Update failed');
                      } finally {
                        setBusy('');
                      }
                    }}
                  >
                    <input name="value" type="password" placeholder="new value" autoComplete="off" />
                    <button type="submit" className="ch247-btn" disabled={busy !== ''}>
                      Set
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'deployments' && (
        <div className="ch247-card">
          <h2>Deployment history</h2>
          {deployments === null ? (
            <CatalogLoadingBanner label="Loading deployments…" />
          ) : (
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Action</th>
                  <th>Status</th>
                  <th>Attempts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((deployment) => (
                  <tr key={deployment.id}>
                    <td>{new Date(deployment.created_at).toLocaleString()}</td>
                    <td>{deployment.action}</td>
                    <td>
                      <span className="ch247-badge">{deployment.status}</span>
                    </td>
                    <td>
                      {deployment.attempts}/{deployment.max_attempts}
                    </td>
                    <td>
                      <Link className="ch247-btn" to={`/dashboard/deployments/${deployment.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {liveEvents.length > 0 && (
            <div className="ch247-console">
              {liveEvents.map((event) => (
                <div key={event.id} className="ch247-console__line is-info">
                  {event.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
