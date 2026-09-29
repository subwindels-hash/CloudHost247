import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { getStoredUser } from '../lib/auth';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';

interface PublicServer {
  id: string;
  name: string;
  serverType: string;
  region: string | null;
  status: string;
  dockerEnabled: boolean;
  kubernetesEnabled: boolean;
  cpanelEnabled: boolean;
  cpuCores: number;
  memoryMb: number;
  storageMb: number;
}

interface ServerMetricsSnapshot {
  captured_at: string;
  cpu_percent: string | null;
  memory_used_mb: number | null;
  memory_total_mb: number | null;
  disk_used_mb: number | null;
  disk_total_mb: number | null;
  load_1: string | null;
  uptime_seconds: number | null;
}

/**
 * Customer server view (spec §34, §48): public metadata for servers the customer can see
 * (their installations' servers) plus live metrics snapshots — never hostnames, credentials,
 * or other customers' data.
 */
export default function DashboardServersPage() {
  usePageMeta('Servers', 'Servers running your CloudHost247 applications');
  const [servers, setServers] = useState<PublicServer[] | null>(null);
  const [metrics, setMetrics] = useState<Record<string, ServerMetricsSnapshot>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ servers: PublicServer[] }>('/api/v1/servers')
      .then((result) => !cancelled && setServers(result.servers))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!servers) return;
    let cancelled = false;
    for (const server of servers) {
      apiFetch<{ metrics: ServerMetricsSnapshot[] }>(`/api/v1/servers/${server.id}/metrics`)
        .then((result) => {
          if (!cancelled && result.metrics.length > 0) {
            setMetrics((current) => ({ ...current, [server.id]: result.metrics[0] }));
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [servers]);

  const user = getStoredUser();

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Servers</h1>
        <p className="ch247-page__hint">
          The servers behind your hosting services and application installations, with their
          latest reported metrics. Application-level metrics live on each application's page.
        </p>
        {user?.role === 'admin' && (
          <p className="ch247-page__hint">
            Admins manage the full server registry (credentials, rotation, retirement) under{' '}
            <Link to="/admin/servers">Admin → Servers</Link>.
          </p>
        )}
      </div>

      {error && <CatalogErrorBanner message={error} />}
      {servers === null && !error && <CatalogLoadingBanner label="Loading servers…" />}
      {servers !== null && servers.length === 0 && (
        <div className="ch247-card">
          <p className="ch247-page__hint">
            No servers are visible to your account yet — order hosting or install an application
            and its server will appear here.
          </p>
        </div>
      )}

      {servers?.map((server) => {
        const snapshot = metrics[server.id];
        const diskPercent =
          snapshot?.disk_used_mb && snapshot?.disk_total_mb
            ? Math.round((Number(snapshot.disk_used_mb) / Number(snapshot.disk_total_mb)) * 100)
            : null;
        return (
          <div key={server.id} className="ch247-card ch247-instrow">
            <div className="ch247-instrow__main">
              <h2>{server.name}</h2>
              <p className="ch247-market-card__cat">
                {server.serverType}
                {server.region ? ` · ${server.region}` : ''} ·{' '}
                <span className="ch247-badge">{server.status}</span>
                {server.dockerEnabled ? ' · Docker' : ''}
                {server.kubernetesEnabled ? ' · Kubernetes' : ''}
                {server.cpanelEnabled ? ' · cPanel' : ''}
              </p>
              <p className="ch247-page__hint">
                {server.cpuCores} CPU · {Math.round(server.memoryMb / 1024)} GB RAM ·{' '}
                {Math.round(server.storageMb / 1024)} GB storage
              </p>
            </div>
            <div className="ch247-instrow__side">
              {snapshot ? (
                <p className="ch247-page__hint">
                  CPU {snapshot.cpu_percent ?? '—'}% · MEM{' '}
                  {snapshot.memory_used_mb && snapshot.memory_total_mb
                    ? `${Math.round((Number(snapshot.memory_used_mb) / Number(snapshot.memory_total_mb)) * 100)}%`
                    : '—'}
                  {diskPercent !== null ? ` · DISK ${diskPercent}%` : ''} · reported{' '}
                  {new Date(snapshot.captured_at).toLocaleTimeString()}
                </p>
              ) : (
                <p className="ch247-page__hint">No metrics reported yet.</p>
              )}
              <Link className="ch247-btn" to="/apps">
                Install an app here
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}
