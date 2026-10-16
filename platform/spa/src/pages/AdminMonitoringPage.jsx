import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

/**
 * Admin monitoring: every server's latest telemetry in one table, with a drill-in that shows the
 * server's monitoring record as the API reports it (health status, current metrics, services and
 * containers). "No datapoints" is shown where the agent has not reported — never a zero.
 */
export default function AdminMonitoringPage() {
  const [servers, setServers] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await adminApi.adminServerHealth();
      setServers(res.servers ?? []);
    } catch (e) {
      setServers([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const open = async (server) => {
    setError('');
    try {
      const res = await adminApi.serverMonitoring(server.id);
      setSelected(res.monitoring);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Monitoring</h1>
          <p className="muted">Server health from the latest agent telemetry.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <h2>Servers</h2>
        {servers === null ? (
          <p className="muted">Loading server health…</p>
        ) : servers.length === 0 ? (
          <p className="muted">No servers registered.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Server</th>
                  <th scope="col">Status</th>
                  <th scope="col">CPU</th>
                  <th scope="col">Memory</th>
                  <th scope="col">Disk</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td><span className={statusClass(s.status)}>{humanizeStatus(s.status)}</span></td>
                    <td>{s.cpuPercent === null ? 'no datapoints' : `${s.cpuPercent}%`}</td>
                    <td>{s.memoryPercent === null ? 'no datapoints' : `${s.memoryPercent}%`}</td>
                    <td>{s.diskPercent === null ? 'no datapoints' : `${s.diskPercent}%`}</td>
                    <td><button className="btn btn-ghost" type="button" onClick={() => open(s)}>Details</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className="card">
          <h2>{selected.serverName}</h2>
          <dl className="detail-list">
            <dt>Health</dt><dd>{selected.healthStatus ?? '—'}</dd>
            <dt>Hostname</dt><dd>{selected.hostname ?? '—'}</dd>
            <dt>IP</dt><dd>{selected.ipAddress ?? '—'}</dd>
            <dt>Panel</dt><dd>{selected.panelHealth ?? '—'}</dd>
            <dt>Agent last seen</dt><dd>{formatDate(selected.agentLastSeenAt, { withTime: true })}</dd>
            <dt>Current CPU</dt><dd>{selected.metrics?.current?.cpuPercent ?? 'no datapoints'}</dd>
            <dt>Current memory</dt><dd>{selected.metrics?.current?.memoryPercent ?? 'no datapoints'}</dd>
            <dt>Current disk</dt><dd>{selected.metrics?.current?.diskPercent ?? 'no datapoints'}</dd>
          </dl>
          <h3>Services</h3>
          <ul className="list">
            {(selected.services ?? []).map((svc) => (
              <li key={svc.name} className="row row-wrap">
                <strong>{svc.name}</strong>
                <span className="muted">port {svc.port}</span>
                <span>{svc.status}</span>
              </li>
            ))}
          </ul>
          <h3>Containers</h3>
          {(selected.containers ?? []).length === 0 ? (
            <p className="muted">No installations on this server.</p>
          ) : (
            <ul className="list">
              {selected.containers.map((c) => (
                <li key={c.id} className="row row-wrap">
                  <strong>{c.name}</strong>
                  <span>{c.status}</span>
                  <span className="muted">{c.health}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
