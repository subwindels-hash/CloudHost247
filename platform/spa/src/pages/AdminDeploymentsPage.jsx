import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];

/**
 * Admin deployments: the deployment queue with status/action filters, a detail view of the
 * ordered step pipeline and event log, queued-only Execute/Cancel (the server enforces the
 * guard and the refusal is shown verbatim), and the deployment worker cycle a scheduler hits.
 */
export default function AdminDeploymentsPage() {
  const [deployments, setDeployments] = useState(null);
  const [status, setStatus] = useState('');
  const [action, setAction] = useState('');
  const [selected, setSelected] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const params = {};
      if (status) params.status = status;
      if (action) params.action = action;
      const res = await adminApi.deployments(params);
      setDeployments(res.deployments ?? []);
    } catch (e) {
      setDeployments([]);
      setError(describeError(e));
    }
  }, [status, action]);

  useEffect(() => { load(); }, [load]);

  const open = async (deployment) => {
    setError(''); setNotice('');
    try {
      const res = await adminApi.deployment(deployment.id);
      setSelected(res);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const guard = async (fn, verb) => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(verb);
      if (selected) {
        const res = await adminApi.deployment(selected.deployment.id);
        setSelected(res);
      }
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Deployments</h1>
          <p className="muted">Deployment queue, step pipelines and the worker cycle.</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" type="button" onClick={() => guard(() => adminApi.sweepDeployments(), 'Deployment cycle run.')}
            title="POST /api/v1/admin/deployments/sweep">Run deployment cycle</button>
        </div>
      </div>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <h2>Queue</h2>
        <div className="form-row">
          <label>
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
            </select>
          </label>
          <label>
            <span>Action</span>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">All actions</option>
              {['install', 'start', 'stop', 'restart', 'upgrade', 'uninstall'].map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        {deployments === null ? (
          <p className="muted">Loading deployments…</p>
        ) : deployments.length === 0 ? (
          <p className="muted">No deployments match this filter.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Source ref</th>
                  <th scope="col">Status</th>
                  <th scope="col">Requested</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deployments.map((d) => (
                  <tr key={d.id}>
                    <td><strong>{d.action ?? '—'}</strong></td>
                    <td className="mono">{d.ref ?? '—'}</td>
                    <td><span className={statusClass(d.status)}>{humanizeStatus(d.status)}</span></td>
                    <td>{formatDate(d.createdAt ?? d.created_at, { withTime: true })}</td>
                    <td>
                      <div className="actions">
                        <button className="btn btn-ghost" type="button" onClick={() => open(d)}>Details</button>
                        {d.status === 'queued' && (
                          <>
                            <button className="btn btn-ghost" type="button"
                              onClick={() => guard(() => adminApi.executeDeployment(d.id), 'Deployment execution triggered.')}>Execute</button>
                            <button className="btn btn-ghost" type="button"
                              onClick={() => guard(() => adminApi.cancelDeployment(d.id), 'Deployment cancelled.')}>Cancel</button>
                          </>
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

      {selected && (
        <section className="card">
          <h2>Deployment detail</h2>
          <dl className="detail-list">
            <dt>Action</dt><dd>{selected.deployment.action ?? '—'}</dd>
            <dt>Source</dt><dd>{selected.deployment.source ?? '—'} {selected.deployment.ref ?? ''}</dd>
            <dt>Status</dt><dd><span className={statusClass(selected.deployment.status)}>{humanizeStatus(selected.deployment.status)}</span></dd>
            <dt>Error</dt><dd>{selected.deployment.errorMessage ?? selected.deployment.error_message ?? '—'}</dd>
          </dl>
          <h3>Steps</h3>
          {(selected.steps ?? []).length === 0 ? (
            <p className="muted">No steps recorded.</p>
          ) : (
            <ul className="list">
              {selected.steps.map((s) => (
                <li key={s.stepOrder ?? s.step_order} className="row row-wrap">
                  <span className="muted">{s.stepOrder ?? s.step_order}.</span>
                  <strong>{s.name}</strong>
                  <span>{s.status}</span>
                  {s.error && <span className="muted">{s.error}</span>}
                </li>
              ))}
            </ul>
          )}
          <h3>Events</h3>
          {(selected.events ?? []).length === 0 ? (
            <p className="muted">No events recorded.</p>
          ) : (
            <ul className="list">
              {selected.events.map((ev) => (
                <li key={ev.id ?? `${ev.created_at}-${ev.message}`} className="row row-wrap">
                  <span className="muted">{formatDate(ev.createdAt ?? ev.created_at, { withTime: true })}</span>
                  <span>{ev.level}</span>
                  <span>{ev.message}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
