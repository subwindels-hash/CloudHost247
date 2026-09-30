import { useCallback, useEffect, useState } from 'react';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import InfrastructureNav from '../components/InfrastructureNav';
import { apiFetch } from '../lib/api';
import { usePageMeta } from '../lib/usePageMeta';

interface InfrastructureLog {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

const RESOURCE_TYPES = [
  'provider',
  'region',
  'datacenter',
  'os_image',
  'operating_system',
  'operating_system_version',
  'provisioning_job',
  'server',
];

/**
 * Infrastructure logs: a read-only view of the existing append-only audit trail, scoped to
 * infrastructure resources. Every provider, image, region, job and server action is recorded by
 * the API itself, so nothing here can be edited or deleted from the UI.
 */
export default function AdminInfrastructureLogsPage() {
  usePageMeta('Infrastructure logs', 'Admin — audit trail for providers, images and provisioning.');
  const [logs, setLogs] = useState<InfrastructureLog[] | null>(null);
  const [error, setError] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
      if (resourceType) params.set('resourceType', resourceType);
      if (action.trim()) params.set('action', action.trim());
      const result = await apiFetch<{ logs: InfrastructureLog[] }>(`/api/v1/admin/infrastructure-logs?${params.toString()}`);
      setLogs(result.logs);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load infrastructure logs');
    }
  }, [resourceType, action, page]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="ch247-stack">
      <section className="ch247-card ch247-section-heading">
        <div>
          <span className="ch247-eyebrow">Admin · Infrastructure</span>
          <h1>Infrastructure logs</h1>
          <p className="ch247-page__hint">
            Append-only audit records for provider, image, region, provisioning and server actions.
            Credential values are never recorded.
          </p>
        </div>
      </section>
      <InfrastructureNav active="logs" />
      <section className="ch247-card ch247-form">
        <div className="ch247-form-grid">
          <label className="ch247-field">
            Resource type
            <select value={resourceType} onChange={(event) => { setPage(0); setResourceType(event.target.value); }}>
              <option value="">All infrastructure resources</option>
              {RESOURCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="ch247-field">
            Action
            <input
              placeholder="e.g. OS_IMAGE_VERIFIED"
              value={action}
              onChange={(event) => { setPage(0); setAction(event.target.value.toUpperCase()); }}
            />
          </label>
        </div>
      </section>
      {error && <CatalogErrorBanner message={error} />}
      {!logs && !error && <CatalogLoadingBanner label="Loading infrastructure logs…" />}
      {logs && (
        <section className="ch247-card">
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr><th>When</th><th>Actor</th><th>Action</th><th>Resource</th><th>Details</th></tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td>{new Date(log.created_at).toLocaleString()}</td>
                    <td>{log.actor_email ?? 'system'}{log.ip_address && <><br /><small>{log.ip_address}</small></>}</td>
                    <td><strong>{log.action}</strong></td>
                    <td>{log.resource_type}<br /><small>{log.resource_id ?? '—'}</small></td>
                    <td><code className="ch247-log-meta">{JSON.stringify(log.metadata)}</code></td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan={5}>No infrastructure activity matches these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="ch247-actions">
            <button className="ch247-btn" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>Previous</button>
            <button className="ch247-btn" disabled={logs.length < pageSize} onClick={() => setPage((current) => current + 1)}>Next</button>
          </div>
        </section>
      )}
    </div>
  );
}
