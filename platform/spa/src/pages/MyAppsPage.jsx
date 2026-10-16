import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { appsApi, describeError } from '../lib/api.js';
import { statusClass, humanizeStatus } from '../lib/format.js';

// The actions the /app-installations lifecycle route accepts, and the installation statuses each is
// valid from. The server enforces the same table and refuses with a named reason; this map only
// decides which buttons to show so the screen does not offer actions that cannot work.
const ACTIONS = {
  start: ['stopped', 'failed', 'healthy', 'running'],
  stop: ['healthy', 'running', 'unhealthy', 'starting', 'failed'],
  restart: ['healthy', 'running', 'unhealthy', 'stopped', 'starting', 'failed'],
  update: ['healthy', 'running', 'unhealthy', 'stopped'],
  reinstall: ['failed', 'stopped', 'unhealthy'],
};

/**
 * Installed marketplace applications on the account.
 *
 * Lifecycle actions enqueue a deployment and report its id — the screen never claims a result the
 * deployment has not produced yet. Uninstall goes through the same deployment pipeline.
 */
export default function MyAppsPage() {
  const [installations, setInstallations] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await appsApi.installations();
      setInstallations(res.installations ?? []);
    } catch (e) {
      setInstallations([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (action, message) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
      if (message) setNotice(message);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const doAction = (inst, action) => run(async () => {
    const res = await appsApi.action(inst.id, action);
    setNotice(`${action} requested for ${inst.name ?? 'installation'} — deployment ${res.deploymentId} is ${res.status}.`);
    await load();
  });

  const uninstall = (inst) => {
    if (!window.confirm(`Uninstall ${inst.name ?? 'this installation'}?`)) return;
    return run(async () => {
      await appsApi.remove(inst.id);
      setNotice(`Uninstall requested for ${inst.name ?? 'installation'}.`);
      await load();
    });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My apps</h1>
          <p className="muted">Marketplace applications installed on your hosting services.</p>
        </div>
        <Link className="btn btn-primary" to="/marketplace">Browse marketplace</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <section className="card">
        <h2>Installations</h2>
        {installations === null ? (
          <p className="muted">Loading installations…</p>
        ) : installations.length === 0 ? (
          <p className="muted">No applications installed yet. <Link to="/marketplace">Install one from the marketplace</Link>.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Application</th>
                  <th scope="col">Domain</th>
                  <th scope="col">Status</th>
                  <th scope="col">URL</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {installations.map((inst) => (
                  <tr key={inst.id}>
                    <td>
                      <strong>{inst.name ?? 'Installation'}</strong>
                      {inst.backupEnabled && <span className="muted"> · backups on</span>}
                    </td>
                    <td>{inst.domain ?? '—'}</td>
                    <td><span className={statusClass(inst.status)}>{humanizeStatus(inst.status)}</span></td>
                    <td>{inst.url ? <a href={inst.url} rel="noreferrer">{inst.url}</a> : '—'}</td>
                    <td>
                      <div className="row row-wrap">
                        {Object.entries(ACTIONS).map(([action, allowed]) => (
                          allowed.includes(inst.status) && (
                            <button
                              key={action}
                              className="btn btn-ghost"
                              type="button"
                              disabled={busy}
                              onClick={() => doAction(inst, action)}
                            >
                              {action}
                            </button>
                          )
                        ))}
                        {!['deleted', 'deleting'].includes(inst.status) && (
                          <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => uninstall(inst)}>
                            uninstall
                          </button>
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
    </div>
  );
}
