import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface AdminApplicationDetail {
  application: {
    id: string;
    slug: string;
    name: string;
    description: string;
    long_description: string | null;
    status: string;
    featured: boolean;
    popularity: number;
    deployment_type: string;
    min_cpu: number;
    min_memory_mb: number;
    min_storage_mb: number;
  };
  category: { slug: string; name: string } | null;
  versions: Array<{
    id: string;
    version: string;
    status: string;
    is_stable: boolean;
    release_notes: string | null;
    created_at: string;
  }>;
  installCount: number;
}

/**
 * Admin application detail (spec §43): version workflow (draft → published, one stable),
 * metadata editing, and the application's install count.
 */
export default function AdminAppDetailPage() {
  const { id } = useParams<{ id: string }>();
  usePageMeta('Application detail', 'Admin — versions and metadata');
  const [detail, setDetail] = useState<AdminApplicationDetail | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    let cancelled = false;
    apiFetch<AdminApplicationDetail>(`/api/v1/admin/apps/${id}`)
      .then((result) => !cancelled && setDetail(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => load(), [load]);

  /** Metadata via PATCH; status transitions via the dedicated POST /status endpoint. */
  async function patchApplication(body: Record<string, unknown>) {
    setBusy('app');
    setMessage('');
    try {
      if ('status' in body) {
        await apiFetch(`/api/v1/admin/apps/${id}/status`, { method: 'POST', body: JSON.stringify({ status: body.status }) });
      } else {
        await apiFetch(`/api/v1/admin/apps/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      }
      setMessage('Saved.');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy('');
    }
  }

  async function patchVersion(versionId: string, body: Record<string, unknown>) {
    setBusy(versionId);
    setMessage('');
    try {
      await apiFetch(`/api/v1/admin/apps/${id}/versions/${versionId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      setMessage('Saved.');
      load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy('');
    }
  }

  if (error && !detail) return <CatalogErrorBanner message={error} />;
  if (!detail) return <CatalogLoadingBanner label="Loading application…" />;
  const { application, versions } = detail;

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>{application.name}</h1>
        <p className="ch247-market-card__cat">
          <code>{application.slug}</code> · <span className="ch247-badge">{application.status}</span> ·{' '}
          {detail.category?.name ?? 'uncategorized'} · {application.deployment_type} ·{' '}
          {detail.installCount} installation{detail.installCount === 1 ? '' : 's'}
        </p>
        {message && <p className="ch247-banner ch247-banner--info">{message}</p>}
        {error && <CatalogErrorBanner message={error} />}
        <div className="ch247-actions">
          {application.status === 'published' ? (
            <button type="button" className="ch247-btn" disabled={busy !== ''} onClick={() => patchApplication({ status: 'suspended' })}>
              Suspend
            </button>
          ) : application.status === 'approved' ? (
            <button type="button" className="ch247-btn ch247-btn--primary" disabled={busy !== ''} onClick={() => patchApplication({ status: 'published' })}>
              Publish
            </button>
          ) : null}
          <button
            type="button"
            className="ch247-btn"
            disabled={busy !== ''}
            onClick={() => patchApplication({ featured: !application.featured })}
          >
            {application.featured ? 'Remove from featured' : 'Mark featured'}
          </button>
          <Link className="ch247-btn" to={`/apps/${application.slug}`}>
            Public page
          </Link>
        </div>
      </div>

      <div className="ch247-card">
        <h2>Versions</h2>
        <p className="ch247-page__hint">
          Exactly one version is stable — the marketplace installs it by default. Publishing a
          draft makes it available; marking one stable demotes the previous stable automatically.
        </p>
        {versions.length === 0 && <p className="ch247-page__hint">No versions yet — import a manifest to create one.</p>}
        <table className="ch247-table">
          <thead>
            <tr>
              <th>Version</th>
              <th>Status</th>
              <th>Stable</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((version) => (
              <tr key={version.id}>
                <td>{version.version}</td>
                <td>
                  <span className="ch247-badge">{version.status}</span>
                </td>
                <td>{version.is_stable ? '★ stable' : ''}</td>
                <td>{new Date(version.created_at).toLocaleDateString()}</td>
                <td className="ch247-actions">
                  {version.status === 'draft' && (
                    <button
                      type="button"
                      className="ch247-btn ch247-btn--primary"
                      disabled={busy !== ''}
                      onClick={() => patchVersion(version.id, { status: 'published' })}
                    >
                      Publish
                    </button>
                  )}
                  {!version.is_stable && version.status === 'published' && (
                    <button
                      type="button"
                      className="ch247-btn"
                      disabled={busy !== ''}
                      onClick={() => patchVersion(version.id, { isStable: true })}
                    >
                      Make stable
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="ch247-card">
        <h2>Requirements</h2>
        <dl className="ch247-kv">
          <dt>Minimum CPU</dt>
          <dd>{application.min_cpu} cores</dd>
          <dt>Minimum memory</dt>
          <dd>{application.min_memory_mb} MB</dd>
          <dt>Minimum storage</dt>
          <dd>{application.min_storage_mb} MB</dd>
          <dt>Popularity</dt>
          <dd>{application.popularity}</dd>
        </dl>
      </div>
    </div>
  );
}
