import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface DeploymentRow {
  id: string;
  installation_id: string | null;
  server_id: string | null;
  action: string;
  status: string;
  attempts: number;
  max_attempts: number;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Admin deployments (spec §24): the full platform-wide deployment queue — every action, every
 * status, every retry — with per-deployment detail and cancel for queued jobs.
 */
export default function AdminDeploymentsPage() {
  const { id } = useParams<{ id?: string }>();
  const [deployments, setDeployments] = useState<DeploymentRow[] | null>(null);
  const [selected, setSelected] = useState<{ deployment: DeploymentRow; steps: Array<{ id: string; order: number; name: string; status: string; error: string | null }>; events: Array<{ id: string; level: string; message: string; created_at: string }> } | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  usePageMeta('Deployments', 'Admin — deployment queue and history');

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ deployments: DeploymentRow[] }>('/api/v1/admin/deployments')
      .then((result) => !cancelled && setDeployments(result.deployments))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!id) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    apiFetch<{ deployment: DeploymentRow; steps: Array<{ id: string; order: number; name: string; status: string; error: string | null }>; events: Array<{ id: string; level: string; message: string; created_at: string }> }>(
      `/api/v1/admin/deployments/${id}`
    )
      .then((result) => !cancelled && setSelected(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function cancel(deploymentId: string) {
    setMessage('');
    try {
      await apiFetch(`/api/v1/deployments/${deploymentId}/cancel`, { method: 'POST' });
      setMessage('Deployment cancelled.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Cancel failed');
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Deployments</h1>
        <p className="ch247-page__hint">
          The platform-wide async job queue: installations, updates, backups, restores, and
          uninstalls all run here. Jobs retry with backoff up to their max attempts; only queued
          jobs can be cancelled.
        </p>
        {message && <p className="ch247-banner ch247-banner--info">{message}</p>}
        {error && <CatalogErrorBanner message={error} />}
      </div>

      {selected && (
        <div className="ch247-card">
          <h2>
            {selected.deployment.action} — {selected.deployment.status}
          </h2>
          {selected.deployment.error_message && (
            <p className="ch247-banner ch247-banner--error">
              {selected.deployment.error_code ? `${selected.deployment.error_code}: ` : ''}
              {selected.deployment.error_message}
            </p>
          )}
          <ol className="ch247-pipeline">
            {selected.steps.map((step) => (
              <li key={step.id} className={`is-${step.status}`}>
                <span className="ch247-pipeline__dot" aria-hidden="true" />
                {step.name}
                {step.error ? <small>{step.error}</small> : null}
              </li>
            ))}
          </ol>
          <div className="ch247-console">
            {selected.events.map((event) => (
              <div key={event.id} className={`ch247-console__line is-${event.level}`}>
                <span className="ch247-console__time">{new Date(event.created_at).toLocaleTimeString()}</span>
                {event.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {deployments === null && !error && <CatalogLoadingBanner label="Loading deployments…" />}
      {deployments !== null && (
        <div className="ch247-card">
          <table className="ch247-table">
            <thead>
              <tr>
                <th>Created</th>
                <th>Action</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Error</th>
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
                  <td>{deployment.error_code ?? ''}</td>
                  <td className="ch247-actions">
                    <Link className="ch247-btn" to={`/admin/deployments/${deployment.id}`}>
                      Detail
                    </Link>
                    {deployment.status === 'queued' && (
                      <button type="button" className="ch247-btn ch247-btn--danger" onClick={() => cancel(deployment.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
