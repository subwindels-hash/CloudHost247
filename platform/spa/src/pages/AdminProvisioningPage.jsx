import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const STATUSES = ['', 'queued', 'running', 'succeeded', 'failed', 'dead_letter', 'cancelled'];

/**
 * Admin provisioning console.
 *
 * The queue as it actually is, plus the two operator triggers: one worker cycle (the same route a
 * cron would hit) and reconciliation, which fails only jobs whose leases the worker's own rule
 * agrees expired — queued backlog is left alone. Retry and cancel mirror the server's guards and
 * show its named refusals.
 */
export default function AdminProvisioningPage() {
  const [jobs, setJobs] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [workerLimit, setWorkerLimit] = useState('');

  const load = useCallback(async (statusFilter) => {
    setError('');
    try {
      const [list, m] = await Promise.all([
        adminApi.provisioningJobs(statusFilter ? { status: statusFilter } : {}),
        adminApi.provisioningMetrics(),
      ]);
      setJobs(list.jobs ?? []);
      setMetrics(m);
    } catch (e) {
      setJobs([]);
      setError(describeError(e));
    }
  }, []);

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

  const openJob = async (job) => {
    setError('');
    try {
      setSelected(await adminApi.provisioningJob(job.id));
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Provisioning</h1>
          <p className="muted">The queued work the infrastructure workers execute.</p>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {metrics && (
        <section className="card">
          <h2>Queue</h2>
          <p className="muted">{metrics.total} job(s) total</p>
          <ul className="list">
            {Object.entries(metrics.byStatus ?? {}).map(([s, count]) => (
              <li key={s} className="row row-wrap">
                <span className={statusClass(s)}>{humanizeStatus(s)}</span>
                <strong>{count}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Worker</h2>
        <p className="muted">
          Running a cycle executes queued jobs now — the same route a scheduler hits. Reconcile fails
          only jobs whose leases expired; queued backlog is left for the worker.
        </p>
        <div className="row row-wrap">
          <div className="field" style={{ width: 120 }}>
            <label htmlFor="worker-limit">Cycle limit</label>
            <input id="worker-limit" type="number" min="1" max="200" value={workerLimit} onChange={(e) => setWorkerLimit(e.target.value)} />
          </div>
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              const res = await adminApi.runProvisioningWorker(workerLimit ? Number(workerLimit) : undefined);
              setNotice(`Worker cycle: claimed ${res.claimed}, completed ${res.completed}, failed ${res.failed}, requeued ${res.requeued}, dead-lettered ${res.deadLettered}.`);
              await load();
            })}
          >
            Run one worker cycle
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy}
            onClick={() => run(async () => {
              const res = await adminApi.reconcileProvisioning();
              setNotice(`Reconciled ${res.reconciled} expired job(s); ${res.leftQueued} queued left as backlog.`);
              await load();
            })}
          >
            Reconcile
          </button>
        </div>
      </section>

      <section className="card">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2>Jobs</h2>
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor="job-status">Status</label>
            <select id="job-status" value={status} onChange={(e) => { setStatus(e.target.value); load(e.target.value); }}>
              {STATUSES.map((s) => <option key={s || 'all'} value={s}>{s || 'all'}</option>)}
            </select>
          </div>
        </div>
        {jobs === null ? (
          <p className="muted">Loading jobs…</p>
        ) : jobs.length === 0 ? (
          <p className="muted">No provisioning jobs match.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Resource</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <button className="linklike" type="button" onClick={() => openJob(job)}><strong>{job.kind}</strong></button>
                      <div className="muted small">{job.id}</div>
                    </td>
                    <td>{job.resourceType ?? '—'}{job.resourceId ? <div className="muted small">{job.resourceId}</div> : null}</td>
                    <td>
                      <span className={statusClass(job.status)}>{humanizeStatus(job.status)}</span>
                      {job.error && <div className="muted small">{job.error}</div>}
                    </td>
                    <td>{formatDate(job.createdAt, { withTime: true })}</td>
                    <td>
                      <div className="row row-wrap">
                        {job.status === 'failed' && (
                          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                            await adminApi.retryProvisioningJob(job.id);
                            setNotice('Job re-queued.');
                            await load();
                          })}>retry</button>
                        )}
                        {job.status === 'queued' && (
                          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                            await adminApi.cancelProvisioningJob(job.id);
                            setNotice('Job cancelled.');
                            await load();
                          })}>cancel</button>
                        )}
                        {['queued', 'running'].includes(job.status) && (
                          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => run(async () => {
                            await adminApi.cancelAnyProvisioningJob(job.id);
                            setNotice('Job cancelled.');
                            await load();
                          })}>force cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected?.job && (
        <section className="card">
          <h2>{selected.job.kind}</h2>
          <dl className="detail-list">
            <dt>Status</dt><dd><span className={statusClass(selected.job.status)}>{humanizeStatus(selected.job.status)}</span></dd>
            <dt>Attempts</dt><dd>{selected.job.attempts}</dd>
            <dt>Resource</dt><dd>{selected.job.resourceType ?? '—'} {selected.job.resourceId ?? ''}</dd>
            <dt>Server</dt><dd>{selected.job.serverId ?? '—'}</dd>
            <dt>Started</dt><dd>{formatDate(selected.job.startedAt, { withTime: true })}</dd>
            <dt>Finished</dt><dd>{formatDate(selected.job.finishedAt, { withTime: true })}</dd>
            {selected.job.error && (<><dt>Error</dt><dd>{selected.job.error}</dd></>)}
          </dl>
          {selected.job.result && (
            <pre className="mono">{JSON.stringify(selected.job.result, null, 2)}</pre>
          )}
        </section>
      )}
    </div>
  );
}
