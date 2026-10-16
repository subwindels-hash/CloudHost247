import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { serversApi, describeError } from '../lib/api.js';
import { statusClass, humanizeStatus } from '../lib/format.js';

const EMPTY = { name: '', hostname: '', planId: '', regionId: '', osId: '' };

/**
 * Customer server inventory (VPS / dedicated instances).
 *
 * Creating queues a provisioning job — the row starts `provisioning` and the detail screen shows
 * the job's progress. Deployment targets (platform machines) are shown read-only, as scheduling
 * metadata the app wizard needs before sign-in.
 */
export default function ServersPage() {
  const [servers, setServers] = useState(null);
  const [targets, setTargets] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await serversApi.list();
      setServers(res.servers ?? []);
      setTargets(res.deploymentTargets ?? []);
    } catch (e) {
      setServers([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const field = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await serversApi.create({
        name: form.name.trim(),
        ...(form.hostname.trim() ? { hostname: form.hostname.trim() } : {}),
        ...(form.planId ? { planId: form.planId } : {}),
        ...(form.regionId ? { regionId: form.regionId } : {}),
        ...(form.osId ? { osId: form.osId } : {}),
      });
      setNotice(`Server “${res.server.name}” created — provisioning is queued.`);
      setShowForm(false);
      setForm(EMPTY);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Servers</h1>
          <p className="muted">Virtual and dedicated machines on your account.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Cancel' : 'New server'}
        </button>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {showForm && (
        <form className="card" onSubmit={create}>
          <h2>New server</h2>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="srv-name">Name</label>
              <input id="srv-name" value={form.name} onChange={field('name')} required />
            </div>
            <div className="field">
              <label htmlFor="srv-host">Hostname (optional)</label>
              <input id="srv-host" value={form.hostname} onChange={field('hostname')} placeholder="web1.example.com" />
            </div>
            <div className="field">
              <label htmlFor="srv-plan">Plan id (optional)</label>
              <input id="srv-plan" value={form.planId} onChange={field('planId')} />
            </div>
            <div className="field">
              <label htmlFor="srv-region">Region id (optional)</label>
              <input id="srv-region" value={form.regionId} onChange={field('regionId')} />
            </div>
            <div className="field">
              <label htmlFor="srv-os">Operating system id (optional)</label>
              <input id="srv-os" value={form.osId} onChange={field('osId')} />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create server'}</button>
        </form>
      )}

      <section className="card">
        <h2>Your servers</h2>
        {servers === null ? (
          <p className="muted">Loading servers…</p>
        ) : servers.length === 0 ? (
          <p className="muted">No servers yet. Create one to get started.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Host</th>
                  <th scope="col">IP</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.name}</strong></td>
                    <td>{s.hostname ?? '—'}</td>
                    <td>{s.ip ?? '—'}</td>
                    <td>{s.provider ?? '—'}</td>
                    <td><span className={statusClass(s.status)}>{humanizeStatus(s.status)}</span></td>
                    <td><Link className="btn btn-ghost" to={`/servers/${s.id}`}>Manage</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {targets.length > 0 && (
        <section className="card">
          <h2>Deployment targets</h2>
          <p className="muted">Platform machines used for scheduling — read-only.</p>
          <ul className="list">
            {targets.map((s) => (
              <li key={s.id} className="row row-wrap">
                <strong>{s.name}</strong>
                <span className="muted">{s.hostname ?? s.ip ?? s.id}</span>
                <span className={statusClass(s.status)}>{humanizeStatus(s.status)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
