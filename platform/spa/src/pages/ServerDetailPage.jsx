import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { serversApi, describeError } from '../lib/api.js';
import { statusClass, humanizeStatus, formatDate } from '../lib/format.js';

/**
 * One customer server.
 *
 * Every lifecycle control queues a provisioning job and reports the job id — durable work that runs
 * in the provisioning worker, never a result the panel invented. The console button asks the
 * provider for a real session; when an adapter documents no console, the server refuses with that
 * reason and the screen shows it.
 */
export default function ServerDetailPage() {
  const { id } = useParams();
  const [server, setServer] = useState(null);
  const [health, setHealth] = useState(null);
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState(null);
  const [snapshots, setSnapshots] = useState(null);
  const [resize, setResize] = useState(null);
  const [snapDescription, setSnapDescription] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [consoleSession, setConsoleSession] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const [s, h, p, l, sn, r] = await Promise.allSettled([
        serversApi.server(id),
        serversApi.health(id),
        serversApi.provisioningStatus(id),
        serversApi.logs(id),
        serversApi.snapshots(id),
        serversApi.resizeOptions(id),
      ]);
      if (s.status === 'fulfilled') setServer(s.value.server);
      else { setError(describeError(s.reason)); return; }
      if (h.status === 'fulfilled') setHealth(h.value);
      if (p.status === 'fulfilled') setJob(p.value.latestJob);
      if (l.status === 'fulfilled') setLogs(l.value.logs ?? []);
      if (sn.status === 'fulfilled') setSnapshots(sn.value.snapshots ?? []);
      if (r.status === 'fulfilled') setResize(r.value);
    } catch (e) {
      setError(describeError(e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const run = async (action, message) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await action();
      if (message) setNotice(message);
      return result;
    } catch (e) {
      setError(describeError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const power = (action) => run(async () => {
    const res = await serversApi.power(id, action);
    setNotice(`${action} queued — job ${res.jobId} is ${res.status}.`);
    await load();
  });

  const requestConsole = () => run(async () => {
    const res = await serversApi.console(id);
    setConsoleSession(res);
    setNotice(`Console session issued by ${res.provider}.`);
  });

  const createSnapshot = async (e) => {
    e.preventDefault();
    await run(async () => {
      const res = await serversApi.createSnapshot(id, snapDescription.trim() || undefined);
      setSnapDescription('');
      setNotice(`Snapshot queued — job ${res.jobId}.`);
      await load();
    });
  };

  const doResize = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await run(async () => {
      const res = await serversApi.resize(id, { targetPlanId: form.get('planId') });
      setNotice(`Resize queued — job ${res.jobId}.`);
      await load();
    });
  };

  const reinstall = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await run(async () => {
      const res = await serversApi.reinstall(id, form.get('osId') || undefined);
      setNotice(`Reinstall queued — job ${res.jobId}.`);
      await load();
    });
  };

  const requestCancel = async (e) => {
    e.preventDefault();
    if (!window.confirm('Request cancellation of this server?')) return;
    await run(async () => {
      await serversApi.cancel(id, cancelReason.trim() || undefined);
      setCancelReason('');
      setNotice('Cancellation requested.');
      await load();
    });
  };

  if (!id) return <div className="page"><p className="muted">No server selected.</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{server ? server.name : 'Server'}</h1>
          <p className="muted">
            {server ? (
              <>
                <span className={statusClass(server.status)}>{humanizeStatus(server.status)}</span>
                {server.hostname ? ` · ${server.hostname}` : ''}
                {server.ip ? ` · ${server.ip}` : ''}
                {server.provider ? ` · ${server.provider}` : ''}
              </>
            ) : 'Loading server…'}
          </p>
        </div>
        <Link className="btn btn-ghost" to="/servers">All servers</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <section className="card">
        <h2>Power</h2>
        <div className="row row-wrap">
          {['start', 'stop', 'shutdown', 'reboot'].map((action) => (
            <button key={action} className="btn btn-ghost" type="button" disabled={busy} onClick={() => power(action)}>
              {action}
            </button>
          ))}
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              await serversApi.rescueOn(id);
              setNotice('Rescue mode enabled.');
              await load();
            })}
          >
            enable rescue
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              await serversApi.rescueOff(id);
              setNotice('Rescue mode disabled.');
              await load();
            })}
          >
            disable rescue
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={requestConsole}>Open console</button>
        </div>
        {consoleSession && (
          <div style={{ marginTop: 12 }}>
            <p className="muted">Console session via {consoleSession.provider}:</p>
            <pre className="mono">{JSON.stringify(consoleSession.console, null, 2)}</pre>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Health</h2>
        {health === null ? (
          <p className="muted">Loading health…</p>
        ) : (
          <dl className="detail-list">
            <dt>Online</dt><dd>{health.online ? 'yes' : 'no'}</dd>
            <dt>CPU</dt><dd>{health.cpuPercent === null ? 'no datapoints' : `${health.cpuPercent}%`}</dd>
            <dt>Memory</dt><dd>{health.memoryPercent === null ? 'no datapoints' : `${health.memoryPercent}%`}</dd>
            <dt>Disk</dt><dd>{health.diskPercent === null ? 'no datapoints' : `${health.diskPercent}%`}</dd>
            <dt>Latest job</dt>
            <dd>{job ? `${job.kind} — ${job.status} (${formatDate(job.createdAt, { withTime: true })})` : 'none yet'}</dd>
          </dl>
        )}
      </section>

      <section className="card">
        <h2>Snapshots</h2>
        <form onSubmit={createSnapshot}>
          <div className="row row-wrap">
            <div className="field" style={{ flex: 1 }}>
              <label htmlFor="snap-desc">Description</label>
              <input id="snap-desc" value={snapDescription} onChange={(e) => setSnapDescription(e.target.value)} placeholder="before upgrade" />
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>Take snapshot</button>
          </div>
        </form>
        {snapshots !== null && snapshots.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table className="table">
              <thead>
                <tr><th scope="col">Description</th><th scope="col">Status</th><th scope="col">Created</th><th scope="col">Actions</th></tr>
              </thead>
              <tbody>
                {snapshots.map((snap) => (
                  <tr key={snap.id}>
                    <td>{snap.description ?? '—'}</td>
                    <td><span className={statusClass(snap.status)}>{humanizeStatus(snap.status)}</span></td>
                    <td>{formatDate(snap.createdAt, { withTime: true })}</td>
                    <td>
                      <div className="row row-wrap">
                        <button
                          className="btn btn-ghost"
                          type="button"
                          disabled={busy}
                          onClick={() => run(async () => {
                            const res = await serversApi.restoreSnapshot(id, snap.id);
                            setNotice(`Restore queued — job ${res.jobId}.`);
                            await load();
                          })}
                        >restore</button>
                        <button
                          className="btn btn-ghost"
                          type="button"
                          disabled={busy}
                          onClick={() => run(async () => {
                            const res = await serversApi.deleteSnapshot(id, snap.id);
                            setNotice(`Snapshot delete queued — job ${res.jobId}.`);
                            await load();
                          })}
                        >delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {resize && (resize.options ?? []).length > 0 && (
        <section className="card">
          <h2>Resize</h2>
          <form onSubmit={doResize}>
            <div className="field">
              <label htmlFor="resize-plan">Target plan</label>
              <select id="resize-plan" name="planId" required>
                {(resize.options ?? []).map((p) => (
                  <option key={p.planId} value={p.planId}>{p.name ?? p.planId}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Queueing…' : 'Resize'}</button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Reinstall</h2>
        <form onSubmit={reinstall}>
          <div className="field">
            <label htmlFor="reinstall-os">Operating system id (optional)</label>
            <input id="reinstall-os" name="osId" placeholder={server?.osId ?? 'keep current'} />
          </div>
          <button className="btn btn-ghost" type="submit" disabled={busy}>Queue reinstall</button>
        </form>
      </section>

      <section className="card">
        <h2>Provisioning log</h2>
        {logs === null ? (
          <p className="muted">Loading log…</p>
        ) : logs.length === 0 ? (
          <p className="muted">No provisioning jobs recorded for this server yet.</p>
        ) : (
          <ul className="list">
            {logs.map((entry) => (
              <li key={entry.jobId}>
                <strong>{entry.kind}</strong>
                <span className={statusClass(entry.status)}> {humanizeStatus(entry.status)}</span>
                <span className="muted"> · {formatDate(entry.at, { withTime: true })}</span>
                {entry.error && <span className="muted"> · {entry.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {server && server.status !== 'cancellation_requested' ? (
        <section className="card">
          <h2>Cancel server</h2>
          <form onSubmit={requestCancel}>
            <div className="field">
              <label htmlFor="cancel-reason">Reason (optional)</label>
              <input id="cancel-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </div>
            <button className="btn btn-ghost" type="submit" disabled={busy}>Request cancellation</button>
          </form>
        </section>
      ) : server && (
        <section className="card">
          <h2>Cancellation requested</h2>
          <p className="muted">This server is marked for cancellation.</p>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              await serversApi.uncancel(id);
              setNotice('Cancellation withdrawn.');
              await load();
            })}
          >
            Withdraw cancellation
          </button>
        </section>
      )}
    </div>
  );
}
