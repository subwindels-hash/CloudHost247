import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface AdminApplicationRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  status: string;
  category_id: string | null;
  featured: boolean;
  popularity: number;
  deployment_type: string;
  created_at: string;
  updated_at: string;
}

/**
 * Admin applications (spec §43): the catalog behind the marketplace. Review pending
 * submissions, publish/unpublish, and jump into per-app version management.
 */
export default function AdminAppsPage() {
  usePageMeta('Applications', 'Admin — application catalog and approval workflow');
  const [apps, setApps] = useState<AdminApplicationRow[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch<{ applications: AdminApplicationRow[]; total: number }>('/api/v1/admin/apps')
      .then((result) => !cancelled && setApps(result.applications))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => load(), [load]);

  /** Workflow transitions go through POST /status — the server enforces the graph. */
  async function setStatus(id: string, status: string) {
    setMessage('');
    try {
      await apiFetch(`/api/v1/admin/apps/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      setMessage(`Application moved to ${status}.`);
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    }
  }

  // Applications still in the review workflow (not yet publishable).
  const pending = (apps ?? []).filter((app) => ['draft', 'validating', 'testing', 'approved'].includes(app.status));
  const others = (apps ?? []).filter((app) => !['draft', 'validating', 'testing', 'approved'].includes(app.status));

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Applications</h1>
        <p className="ch247-page__hint">
          Every application in the catalog, including unpublished and pending ones (the public
          marketplace only ever shows <code>published</code>). Import manifests in bulk from the
          server's catalog directory to add or update apps without writing code.
        </p>
        {message && <p className="ch247-banner ch247-banner--info">{message}</p>}
        {error && <CatalogErrorBanner message={error} />}
      </div>

      {apps === null && !error && <CatalogLoadingBanner label="Loading applications…" />}

      {apps !== null && (
        <>
          {pending.length > 0 && (
            <div className="ch247-card">
              <h2>Awaiting review ({pending.length})</h2>
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Slug</th>
                    <th>Added</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map((app) => (
                    <tr key={app.id}>
                      <td>
                        <Link to={`/admin/apps/${app.id}`}>{app.name}</Link>
                      </td>
                      <td>
                        <code>{app.slug}</code>
                      </td>
                      <td>{new Date(app.created_at).toLocaleDateString()}</td>
                      <td className="ch247-actions">
                        {app.status === 'approved' && (
                          <button type="button" className="ch247-btn ch247-btn--primary" onClick={() => setStatus(app.id, 'published')}>
                            Publish
                          </button>
                        )}
                        {app.status !== 'approved' && (
                          <button type="button" className="ch247-btn ch247-btn--primary" onClick={() => setStatus(app.id, 'approved')}>
                            Approve
                          </button>
                        )}
                        <button type="button" className="ch247-btn" onClick={() => setStatus(app.id, 'deprecated')}>
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="ch247-card">
            <h2>Catalog ({others.length})</h2>
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Status</th>
                  <th>Engine</th>
                  <th>Popularity</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {others.map((app) => (
                  <tr key={app.id}>
                    <td>
                      <Link to={`/admin/apps/${app.id}`}>{app.name}</Link>{' '}
                      {app.featured ? <span className="ch247-badge ch247-badge--active">featured</span> : null}
                    </td>
                    <td>
                      <span className="ch247-badge">{app.status}</span>
                    </td>
                    <td>{app.deployment_type}</td>
                    <td>{app.popularity}</td>
                    <td className="ch247-actions">
                      {app.status === 'published' ? (
                        <button type="button" className="ch247-btn" onClick={() => setStatus(app.id, 'suspended')}>
                          Suspend
                        </button>
                      ) : app.status === 'suspended' ? (
                        <button type="button" className="ch247-btn ch247-btn--primary" onClick={() => setStatus(app.id, 'published')}>
                          Re-publish
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
