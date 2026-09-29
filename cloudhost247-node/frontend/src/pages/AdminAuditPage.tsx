import { useCallback, useEffect, useState } from 'react';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface AuditRow {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Admin audit log (spec §49): every security-relevant action, filterable by actor, action, and
 * resource. Records are append-only server-side; this page is a filtered reader.
 */
export default function AdminAuditPage() {
  usePageMeta('Audit log', 'Admin — security and action history');
  const [entries, setEntries] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState('');
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [resourceType, setResourceType] = useState('');
  const [offset, setOffset] = useState(0);

  usePageMeta('Audit log', 'Admin — security and action history');

  const load = useCallback(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    if (actorId.trim()) query.set('actorId', actorId.trim());
    if (action.trim()) query.set('action', action.trim());
    if (resourceType.trim()) query.set('resourceType', resourceType.trim());
    query.set('limit', '50');
    query.set('offset', String(offset));
    apiFetch<{ entries: AuditRow[]; total: number }>(`/api/v1/admin/audit?${query.toString()}`)
      .then((result) => !cancelled && setEntries(result.entries))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [actorId, action, resourceType, offset]);

  useEffect(() => load(), [load]);

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Audit log</h1>
        <p className="ch247-page__hint">
          Append-only record of authentication events, admin actions, deployment lifecycle
          changes, credential rotations, and billing events.
        </p>
        <div className="ch247-market-controls">
          <input placeholder="Actor id" value={actorId} onChange={(event) => { setOffset(0); setActorId(event.target.value); }} aria-label="Filter by actor id" />
          <input placeholder="Action (e.g. installation.start)" value={action} onChange={(event) => { setOffset(0); setAction(event.target.value); }} aria-label="Filter by action" />
          <input placeholder="Resource type" value={resourceType} onChange={(event) => { setOffset(0); setResourceType(event.target.value); }} aria-label="Filter by resource type" />
        </div>
        {error && <CatalogErrorBanner message={error} />}
      </div>

      {entries === null && !error && <CatalogLoadingBanner label="Loading audit log…" />}
      {entries !== null && (
        <div className="ch247-card">
          {entries.length === 0 && <p className="ch247-page__hint">No matching entries.</p>}
          {entries.length > 0 && (
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.created_at).toLocaleString()}</td>
                    <td>{entry.actor_email ?? entry.actor_id ?? 'system'}</td>
                    <td>
                      <code>{entry.action}</code>
                    </td>
                    <td>
                      {entry.resource_type ? `${entry.resource_type}:${(entry.resource_id ?? '').slice(0, 8)}` : '—'}
                    </td>
                    <td>
                      <code className="ch247-audit-meta">
                        {entry.metadata ? JSON.stringify(entry.metadata).slice(0, 120) : ''}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="ch247-actions">
            <button type="button" className="ch247-btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
              Newer
            </button>
            <button type="button" className="ch247-btn" disabled={entries.length < 50} onClick={() => setOffset(offset + 50)}>
              Older
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
