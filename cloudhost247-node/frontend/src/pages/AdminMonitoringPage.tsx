import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import InfrastructureNav from '../components/InfrastructureNav';
import StatusBadge from '../components/StatusBadge';
import { usePageMeta } from '../lib/usePageMeta';

interface AdminServerItem {
  id: string;
  name: string;
  hostname: string;
  ip_address: string | null;
  server_type: string;
  provider: string | null;
  region: string | null;
  status: string;
  cpu_cores: number;
  memory_mb: number;
  storage_mb: number;
  customer_id?: string;
  customer_email?: string;
  panel_name?: string;
  panel_slug?: string;
  agent_last_seen_at?: string | null;
  last_reconciled_at?: string | null;
}

export default function AdminMonitoringPage() {
  usePageMeta('Infrastructure Monitoring', 'Admin — Centralized fleet monitoring, health metrics, and services status.');
  const [servers, setServers] = useState<AdminServerItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  async function load() {
    try {
      const data = await apiFetch<{ servers: AdminServerItem[] }>('/api/v1/admin/servers');
      setServers(data.servers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load servers');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredServers = servers
    ? servers.filter((s) => !filter || s.status.toLowerCase() === filter.toLowerCase())
    : [];

  const counts = servers
    ? {
        total: servers.length,
        active: servers.filter((s) => s.status.toLowerCase() === 'active').length,
        offline: servers.filter((s) => s.status.toLowerCase() === 'offline' || s.status.toLowerCase() === 'error').length,
        provisioning: servers.filter((s) => s.status.toLowerCase() === 'provisioning' || s.status.toLowerCase() === 'installing').length,
      }
    : { total: 0, active: 0, offline: 0, provisioning: 0 };

  return (
    <div className="ch247-stack">
      <section className="ch247-card ch247-section-heading">
        <div>
          <span className="ch247-eyebrow">Admin · Infrastructure</span>
          <h1>Fleet Health &amp; Monitoring</h1>
          <p className="ch247-page__hint">
            Aggregated telemetry, server availability, control panel status, and automated health checks.
          </p>
        </div>
        <label className="ch247-field">
          Status
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">ACTIVE</option>
            <option value="provisioning">PROVISIONING</option>
            <option value="stopped">STOPPED</option>
            <option value="offline">OFFLINE</option>
            <option value="error">ERROR</option>
          </select>
        </label>
      </section>

      <InfrastructureNav active="monitoring" />

      {servers && (
        <section className="ch247-metric-grid">
          <article>
            <small>Total Fleet Servers</small>
            <strong>{counts.total}</strong>
          </article>
          <article>
            <small>Active &amp; Healthy</small>
            <strong style={{ color: '#16a34a' }}>{counts.active}</strong>
          </article>
          <article>
            <small>Provisioning</small>
            <strong style={{ color: '#0284c7' }}>{counts.provisioning}</strong>
          </article>
          <article>
            <small>Unhealthy / Degraded</small>
            <strong style={{ color: counts.offline > 0 ? '#dc2626' : undefined }}>{counts.offline}</strong>
          </article>
        </section>
      )}

      {error && <div className="ch247-banner ch247-banner--error">{error}</div>}

      {!servers && !error && <div className="ch247-loading">Loading fleet telemetry…</div>}

      {servers && (
        <section className="ch247-card">
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Server &amp; Hostname</th>
                  <th>IP Address</th>
                  <th>Control Panel</th>
                  <th>Specs (vCPU / RAM / Disk)</th>
                  <th>Fleet Status</th>
                  <th>Agent Telemetry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredServers.map((server) => {
                  const agentRecent =
                    server.agent_last_seen_at &&
                    Date.now() - new Date(server.agent_last_seen_at).getTime() < 5 * 60 * 1000;

                  return (
                    <tr key={server.id}>
                      <td>
                        <strong>{server.name}</strong>
                        <div className="ch247-text-muted" style={{ fontSize: '0.85rem' }}>
                          {server.hostname}
                        </div>
                      </td>
                      <td>
                        <code>{server.ip_address ?? 'Pending'}</code>
                      </td>
                      <td>
                        {server.panel_name ? (
                          <span className="ch247-tag">{server.panel_name}</span>
                        ) : (
                          <span className="ch247-text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {server.cpu_cores} vCPU · {Math.round(server.memory_mb / 1024)} GB RAM · {Math.round(server.storage_mb / 1024)} GB
                      </td>
                      <td>
                        <StatusBadge status={server.status} />
                      </td>
                      <td>
                        {server.agent_last_seen_at ? (
                          <span style={{ color: agentRecent ? '#16a34a' : '#d97706', fontSize: '0.85rem' }}>
                            ● {agentRecent ? 'Reporting' : 'Stale'} ({new Date(server.agent_last_seen_at).toLocaleTimeString()})
                          </span>
                        ) : (
                          <span className="ch247-text-muted" style={{ fontSize: '0.85rem' }}>
                            ○ Not connected
                          </span>
                        )}
                      </td>
                      <td>
                        <Link
                          to={`/dashboard/servers/${server.id}`}
                          className="ch247-btn ch247-btn--sm ch247-btn--secondary"
                        >
                          View Metrics
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
