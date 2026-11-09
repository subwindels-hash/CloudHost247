/**
 * Admin Email Forensics Dashboard (`/admin/email-forensics`).
 *
 * Operator view of the email forensics analyser: overall stats, per-status breakdown,
 * failed analyses, IP-intelligence database versions and update controls, recent audit
 * log entries, and a feature kill-switch. Every action is role-gated server-side;
 * this page only presents and requests — the backend re-verifies.
 *
 * Nothing here fabricates data: stats, versions and audit rows come from the API.
 */

import { useCallback, useEffect, useState } from 'react';
import { usePageMeta } from '../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import {
  fetchAdminAuditLogs,
  fetchAdminDatabaseVersions,
  fetchAdminStats,
  toggleFeature,
  updateDatabaseVersion,
  type AdminStats,
  type AuditLog,
  type DatabaseVersion,
} from '../lib/email-forensics-api';
import InfrastructureNav from '../components/InfrastructureNav';
import './email-forensics.css';

function formatTimestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : '—';
}

function statusCount(stats: AdminStats, status: string) {
  return stats.byStatus[status] ?? 0;
}

export default function AdminEmailForensicsPage() {
  usePageMeta(
    'Email Forensics — Admin',
    'Admin — forensics analyser stats, IP-intelligence database versions and audit log'
  );

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState('');
  const [versions, setVersions] = useState<DatabaseVersion[] | null>(null);
  const [versionsError, setVersionsError] = useState('');
  const [auditLogs, setAuditLogs] = useState<AuditLog[] | null>(null);
  const [auditError, setAuditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateNote, setUpdateNote] = useState('');
  const [toggleBusy, setToggleBusy] = useState(false);
  const [disabled, setDisabled] = useState(false);

  const loadStats = useCallback(async () => {
    setStatsError('');
    try {
      const data = await fetchAdminStats();
      setStats(data);
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : 'Could not load stats.');
    }
  }, []);

  const loadVersions = useCallback(async () => {
    setVersionsError('');
    try {
      const data = await fetchAdminDatabaseVersions();
      setVersions(data.versions);
    } catch (err) {
      setVersionsError(err instanceof Error ? err.message : 'Could not load database versions.');
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setAuditError('');
    try {
      const data = await fetchAdminAuditLogs({ limit: 25, offset: 0 });
      setAuditLogs(data.auditLogs);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Could not load audit log.');
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStats(), loadVersions(), loadAuditLogs()]).finally(() => setLoading(false));
  }, [loadStats, loadVersions, loadAuditLogs]);

  const handleDatabaseUpdate = useCallback(async (provider: string) => {
    setUpdateBusy(true);
    setUpdateNote('');
    try {
      const response = await updateDatabaseVersion({ provider });
      setUpdateNote(
        `${response.provider}: ${response.version} — ${response.lastUpdatedAt} (${response.note})`
      );
      await loadVersions();
    } catch (err) {
      setUpdateNote(err instanceof Error ? err.message : 'Database update failed.');
    } finally {
      setUpdateBusy(false);
    }
  }, [loadVersions]);

  const handleToggleFeature = useCallback(async (value: boolean) => {
    setToggleBusy(true);
    try {
      const response = await toggleFeature(value);
      setDisabled(response.disabled);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : 'Feature toggle failed.');
    } finally {
      setToggleBusy(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="ch247-stack">
        <InfrastructureNav />
        <CatalogLoadingBanner label="Loading forensics admin…" />
      </div>
    );
  }

  return (
    <div className="ch247-stack">
      <InfrastructureNav />
      <div className="ch247-card ef-card">
        <h1>Email Forensics Analyzer — Admin</h1>
        <p className="ch247-page__hint ef-hint">
          Operator controls for the header-based email forensics analyzer. All actions are
          re-verified server-side against the caller's role.
        </p>

        {statsError && <CatalogErrorBanner message={statsError} />}
        {versionsError && <CatalogErrorBanner message={versionsError} />}
        {auditError && <CatalogErrorBanner message={auditError} />}

        {/* Stats strip */}
        {stats && (
          <>
            <div className="ef-admin-strip">
              <div className="ef-admin-stat">
                <span className="ef-admin-stat__value">{stats.total}</span>
                <span className="ef-admin-stat__label">Total analyses</span>
              </div>
              <div className="ef-admin-stat">
                <span className="ef-admin-stat__value">{statusCount(stats, 'complete')}</span>
                <span className="ef-admin-stat__label">Complete</span>
              </div>
              <div className="ef-admin-stat">
                <span className="ef-admin-stat__value">{statusCount(stats, 'pending')}</span>
                <span className="ef-admin-stat__label">Pending</span>
              </div>
              <div className="ef-admin-stat">
                <span className="ef-admin-stat__value">{statusCount(stats, 'failed')}</span>
                <span className="ef-admin-stat__label">Failed</span>
              </div>
            </div>

            {stats.failed.length > 0 && (
              <div className="ef-card">
                <h2>Failed analyses</h2>
                <table className="ch247-table ef-table">
                  <thead>
                    <tr>
                      <th>ID</th><th>User</th><th>Created</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.failed.map((f) => (
                      <tr key={f.id}>
                        <td className="ef-mono">{f.id}</td>
                        <td className="ef-mono">{f.userId}</td>
                        <td>{formatTimestamp(f.createdAt)}</td>
                        <td>{f.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="ef-disclaimer">
                  Failed analyses retain no message content — only header-derived evidence and
                  the error that caused the failure.
                </p>
              </div>
            )}

            <p className="ef-admin-note">{stats.note}</p>
          </>
        )}

        {/* Database versions */}
        <div className="ef-card">
          <h2>IP Intelligence Database Versions</h2>
          {versions && (
            <table className="ch247-table ef-table">
              <thead>
                <tr>
                  <th>Provider</th><th>Database</th><th>Version</th><th>Last updated</th><th>Status</th><th>Update</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={`${v.provider}-${v.name}`}>
                    <td>{v.provider}</td>
                    <td>{v.name}</td>
                    <td className="ef-mono">{v.version ?? '—'}</td>
                    <td>{formatTimestamp(v.lastUpdatedAt)}</td>
                    <td>{v.status}</td>
                    <td>
                      <button
                        type="button"
                        className="ch247-btn ch247-button--small"
                        disabled={updateBusy}
                        onClick={() => handleDatabaseUpdate(v.provider)}
                      >
                        {updateBusy ? 'Updating…' : 'Update'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="ef-admin-note">
            Updates write only version metadata to the local administration table. The actual
            GeoLite2-style database files are managed by the operator on the server and are not
            downloaded by this page.
          </p>
          {updateNote && <p className="ef-note">{updateNote}</p>}
        </div>

        {/* Feature kill-switch */}
        <div className="ef-card">
          <h2>Feature availability</h2>
          <p className="ef-hint">
            Disable the forensics analyzer across the platform (customer API and admin API both
            return 503 while disabled). Re-enable to restore access.
          </p>
          <div className="ef-actions">
            <button
              type="button"
              className={`ch247-btn ${disabled ? 'ch247-btn--primary' : ''}`}
              disabled={toggleBusy}
              onClick={() => handleToggleFeature(false)}
            >
              {toggleBusy ? 'Toggling…' : 'Enable analyzer'}
            </button>
            <button
              type="button"
              className={`ch247-btn ${!disabled ? 'ch247-btn--primary' : ''}`}
              disabled={toggleBusy}
              onClick={() => handleToggleFeature(true)}
            >
              {toggleBusy ? 'Toggling…' : 'Disable analyzer'}
            </button>
          </div>
          <p className="ef-admin-note">
            Current state: {disabled ? 'disabled' : 'enabled'}. The kill-switch is an operational
            control only — it does not delete analyses or audit history.
          </p>
        </div>

        {/* Audit log */}
        <div className="ef-card ef-audit-table">
          <h2>Recent audit log</h2>
          {auditLogs && auditLogs.length > 0 ? (
            <table className="ch247-table ef-table">
              <thead>
                <tr>
                  <th>Time</th><th>User</th><th>Analysis</th><th>Action</th><th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="ef-mono">{formatTimestamp(log.createdAt)}</td>
                    <td className="ef-mono">{log.userId ?? '—'}</td>
                    <td className="ef-mono">{log.analysisId ?? '—'}</td>
                    <td>{log.action}</td>
                    <td className="ef-mono ef-small">
                      {JSON.stringify(log.metadata).slice(0, 120)}
                      {JSON.stringify(log.metadata).length > 120 ? '…' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No audit log entries yet.</p>
          )}
        </div>

        <p className="ef-disclaimer">
          The Email Trace & Forensics Analyzer produces indicative, header-derived findings only.
          IP geolocation is approximate and comes from a locally stored database. Reports are not
          legally certified, and an IP address cannot reliably identify a specific person or their
          precise physical location.
        </p>
      </div>
    </div>
  );
}
