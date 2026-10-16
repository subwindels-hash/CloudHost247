import React, { useCallback, useEffect, useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

/**
 * Admin free-tools console: moderation reads over every user's tool reports and uptime monitors,
 * plus the MRZ tool's settings. The privacy protections on the MRZ tool are mandatory — the server
 * refuses to disable them and the refusal is shown verbatim; the screen shows those rows as locked.
 */
export default function AdminToolsPage() {
  const [reports, setReports] = useState(null);
  const [monitors, setMonitors] = useState(null);
  const [settings, setSettings] = useState(null);
  const [patch, setPatch] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [repRes, monRes, setRes] = await Promise.all([
        adminApi.adminToolReports(), adminApi.adminToolMonitors(), adminApi.mrzSettings(),
      ]);
      setReports(repRes.reports ?? []);
      setMonitors(monRes.monitors ?? []);
      setSettings(setRes.settings ?? null);
      setPatch(null);
    } catch (e) {
      setReports([]);
      setMonitors([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const run = async (fn, message) => {
    setError(''); setNotice('');
    try {
      await fn();
      setNotice(message);
      await load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  const saveSettings = (event) => {
    event.preventDefault();
    return run(() => adminApi.updateMrzSettings(patch ?? {}), 'MRZ settings updated.');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Free tools</h1>
          <p className="muted">Tool reports and uptime monitors across all users, plus the MRZ tool's settings.</p>
        </div>
      </div>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <h2>Tool reports</h2>
        {reports === null ? (
          <p className="muted">Loading reports…</p>
        ) : reports.length === 0 ? (
          <p className="muted">No tool reports.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">Title</th>
                  <th scope="col">User</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.toolSlug}</td>
                    <td><strong>{r.title ?? '—'}</strong></td>
                    <td className="muted">{r.userId ?? '—'}</td>
                    <td>{formatDate(r.createdAt, { withTime: true })}</td>
                    <td>
                      <button className="btn btn-ghost" type="button"
                        onClick={() => run(() => adminApi.deleteToolReport(r.id), 'Report deleted.')}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Uptime monitors</h2>
        {monitors === null ? (
          <p className="muted">Loading monitors…</p>
        ) : monitors.length === 0 ? (
          <p className="muted">No uptime monitors.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">URL</th>
                  <th scope="col">Status</th>
                  <th scope="col">User</th>
                </tr>
              </thead>
              <tbody>
                {monitors.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{m.url}</td>
                    <td><span className={statusClass(m.status)}>{humanizeStatus(m.status)}</span></td>
                    <td className="muted">{m.userId ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {settings && (
        <section className="card">
          <h2>MRZ tool settings</h2>
          <form className="nested-form" onSubmit={saveSettings}>
            <div className="checks">
              <label><input type="checkbox" checked={patch?.calculatorEnabled ?? settings.calculatorEnabled}
                onChange={(e) => setPatch({ ...patch, calculatorEnabled: e.target.checked })} /> Calculator enabled</label>
              <label><input type="checkbox" checked={patch?.parserEnabled ?? settings.parserEnabled}
                onChange={(e) => setPatch({ ...patch, parserEnabled: e.target.checked })} /> Parser enabled</label>
              <label><input type="checkbox" checked={patch?.testDataEnabled ?? settings.testDataEnabled}
                onChange={(e) => setPatch({ ...patch, testDataEnabled: e.target.checked })} /> Test data enabled</label>
            </div>
            <div className="form-row">
              <label><span>Rate limit per minute</span>
                <input type="number" min="1" value={patch?.rateLimitPerMinute ?? settings.rateLimitPerMinute}
                  onChange={(e) => setPatch({ ...patch, rateLimitPerMinute: e.target.value })} /></label>
              <label><span>Logging level</span>
                <select value={patch?.loggingLevel ?? settings.loggingLevel}
                  onChange={(e) => setPatch({ ...patch, loggingLevel: e.target.value })}>
                  <option value="none">none</option>
                  <option value="errors">errors</option>
                  <option value="full">full</option>
                </select></label>
              <label><span>Availability</span>
                <select value={patch?.availability ?? settings.availability}
                  onChange={(e) => setPatch({ ...patch, availability: e.target.value })}>
                  <option value="public">public</option>
                  <option value="account">account</option>
                  <option value="disabled">disabled</option>
                </select></label>
            </div>
            <h3>Privacy protections (locked)</h3>
            <div className="checks">
              <label><input type="checkbox" checked={settings.privacyProtectionLocked === true} readOnly disabled /> Privacy protection locked</label>
              <label><input type="checkbox" checked={settings.persistSubmittedData === true} readOnly disabled /> Persist submitted data</label>
              <label><input type="checkbox" checked={settings.logSensitiveMrzData === true} readOnly disabled /> Log sensitive MRZ data</label>
            </div>
            <p className="muted small">Privacy protections for the MRZ tool are mandatory and cannot be disabled.</p>
            <button className="btn btn-primary" disabled={!patch}>Save settings</button>
          </form>
        </section>
      )}
    </div>
  );
}
