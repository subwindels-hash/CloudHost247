import { useEffect, useState } from 'react';
import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import { getStatus, type StatusResponse } from '../lib/status-api';

/**
 * Public status page.
 *
 * Reads `GET /api/v1/public/status`: component states the deployment can verify, plus any
 * operator-declared incidents. `monitored: false` is permanent — there is no independent
 * monitor, so the page says "not monitored" rather than inventing an uptime percentage.
 * Incidents are declared by an operator, never auto-detected; the list is honest about being
 * empty when nothing is declared.
 */
export default function StatusPage() {
  usePageMeta('Status', 'Current status of CloudHost247 services and any declared incidents.');

  const state = useApiResource<StatusResponse>('/api/v1/public/status');

  if (state.status === 'loading') {
    return (
      <div className="ch247-page">
        <h1>Status</h1>
        <p>Loading status…</p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="ch247-page">
        <h1>Status</h1>
        <p>
          Status is unavailable right now ({state.message}). Try again in a moment.
        </p>
      </div>
    );
  }

  const data = state.data;

  return (
    <div className="ch247-page">
      <section className="ch247-section">
        <h1>Status</h1>
        <p>
          {data.monitored
            ? 'Continuously monitored by an independent status system.'
            : 'Not continuously monitored — this page reports what this deployment can verify about itself right now.'}
        </p>
        <p>
          Last checked: {new Date(data.checkedAt).toLocaleString()} ({data.latencyMs}ms response).
        </p>
      </section>

      <section className="ch247-section ch247-section--soft">
        <h2>Components</h2>
        <ul>
          {data.components.map((component) => (
            <li key={component.id}>
              <strong>{component.name}</strong> — {component.state}
              {component.detail ? ` ({component.detail})` : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="ch247-section">
        <h2>Active incidents</h2>
        {data.incidents.length === 0 ? (
          <p>No active incidents.</p>
        ) : (
          <ul>
            {data.incidents.map((incident) => (
              <li key={incident.incident_number}>
                <strong>{incident.incident_number}</strong> — {incident.title}
                <br />
                <span>
                  Status: {incident.status} · Severity: {incident.severity} · Started:{' '}
                  {new Date(incident.started_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
