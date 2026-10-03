import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { toolsApi, type MonitorEntry, type MonitorEvent } from '../lib/tools-api';

const KIND_LABEL: Record<MonitorEntry['kind'], string> = {
  SSL_EXPIRY: 'SSL certificate expiry',
  DNS_RECORD: 'DNS record value',
  EMAIL_CONFIG: 'E-mail configuration (SPF/DMARC/DKIM)',
};

/**
 * Continuous monitoring for the three things that most often break quietly: certificate expiry,
 * a changed DNS record, and e-mail authentication configuration. Checks run from the platform's own
 * worker; a notification is delivered through the existing notification bell, never by e-mail spam.
 */
export default function ToolsMonitorsPage() {
  usePageMeta('Monitoring', 'Watch SSL expiry, DNS records and e-mail authentication configuration for changes.');
  const [monitors, setMonitors] = useState<MonitorEntry[]>([]);
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<MonitorEntry['kind']>('SSL_EXPIRY');
  const [target, setTarget] = useState('');
  const [recordType, setRecordType] = useState('A');
  const [expectedValue, setExpectedValue] = useState('');
  const [matchMode, setMatchMode] = useState('contains');

  function load() {
    setLoading(true);
    toolsApi
      .monitors()
      .then((result) => {
        setMonitors(result.monitors);
        setEvents(result.events);
        setError(null);
      })
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy('create');
    setError(null);
    setNote(null);
    try {
      await toolsApi.createMonitor({
        kind,
        target: target.trim(),
        ...(kind === 'DNS_RECORD' ? { recordType } : {}),
        ...(expectedValue.trim() ? { expectedValue: expectedValue.trim(), matchMode } : {}),
      });
      setTarget('');
      setExpectedValue('');
      setNote('Monitor created. The platform worker checks it on its next sweep.');
      load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'The monitor could not be created.');
    } finally {
      setBusy(null);
    }
  }

  async function toggle(monitor: MonitorEntry) {
    try {
      await toolsApi.updateMonitor(monitor.id, { enabled: !monitor.enabled });
      load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'The monitor could not be updated.');
    }
  }

  async function remove(monitor: MonitorEntry) {
    if (!window.confirm(`Stop monitoring ${monitor.target}?`)) return;
    try {
      await toolsApi.deleteMonitor(monitor.id);
      load();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'The monitor could not be deleted.');
    }
  }

  async function checkNow(monitor: MonitorEntry) {
    setBusy(monitor.id);
    setError(null);
    setNote(null);
    try {
      const result = await toolsApi.checkMonitor(monitor.id);
      setNote(
        `${monitor.target}: ${result.evaluation.status} — ${result.evaluation.detail}` +
          (result.notification ? ` Notification sent (${result.notification.title}).` : ' No notification needed.')
      );
      load();
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : 'The check failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tools-center">
      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        <span aria-current="page">Monitoring</span>
      </nav>
      <h1>Monitoring</h1>
      <p className="tools-muted">
        Checks run from this platform’s own worker on a schedule and record every result. A notification is raised when a certificate
        crosses the warning threshold, a DNS answer changes, or e-mail authentication stops validating — the conditions that most often
        break a website or mailbox without any visible warning.
      </p>

      {error ? <div className="tools-notice tools-notice--error" role="alert">{error}</div> : null}
      {note ? <div className="tools-notice" role="status">{note}</div> : null}

      <form className="tools-monitor-form" onSubmit={create}>
        <h2>New monitor</h2>
        <div className="tools-fields tools-fields--inline">
          <label className="tools-field">
            <span>What to watch</span>
            <select value={kind} onChange={(event) => setKind(event.target.value as MonitorEntry['kind'])}>
              <option value="SSL_EXPIRY">SSL certificate expiry</option>
              <option value="DNS_RECORD">DNS record value</option>
              <option value="EMAIL_CONFIG">E-mail configuration</option>
            </select>
          </label>
          <label className="tools-field">
            <span>{kind === 'SSL_EXPIRY' ? 'Hostname' : 'Domain'}</span>
            <input type="text" value={target} required placeholder={kind === 'SSL_EXPIRY' ? 'example.com' : 'example.com'} onChange={(event) => setTarget(event.target.value)} />
          </label>
          {kind === 'DNS_RECORD' ? (
            <label className="tools-field">
              <span>Record type</span>
              <select value={recordType} onChange={(event) => setRecordType(event.target.value)}>
                {['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'].map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
          ) : null}
          <label className="tools-field">
            <span>Expected value (optional)</span>
            <input type="text" value={expectedValue} placeholder="alert only when this stops matching" onChange={(event) => setExpectedValue(event.target.value)} />
          </label>
          {expectedValue.trim() ? (
            <label className="tools-field">
              <span>Match mode</span>
              <select value={matchMode} onChange={(event) => setMatchMode(event.target.value)}>
                <option value="contains">contains</option>
                <option value="exact">exact</option>
                <option value="regex">regex</option>
              </select>
            </label>
          ) : null}
          <button type="submit" className="ch247-button" disabled={busy === 'create'}>{busy === 'create' ? 'Creating…' : 'Create monitor'}</button>
        </div>
      </form>

      {loading ? <p className="tools-loading">Loading…</p> : null}
      {!loading && monitors.length === 0 ? <p className="tools-empty">No monitors yet. Create one above — for example the certificate on your main domain.</p> : null}

      {monitors.length > 0 ? (
        <div className="tools-table-wrap">
          <table className="tools-table">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Target</th>
                <th scope="col">Last result</th>
                <th scope="col">Checked</th>
                <th scope="col">State</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((monitor) => (
                <tr key={monitor.id}>
                  <td>{KIND_LABEL[monitor.kind]}</td>
                  <td className="tools-cell--mono">{monitor.target}{monitor.record_type ? ` (${monitor.record_type})` : ''}</td>
                  <td>
                    <span className={`tools-badge tools-badge--${monitor.last_status.toLowerCase()}`}>{monitor.last_status}</span>
                    {monitor.last_detail ? <div className="tools-cell--summary">{monitor.last_detail}</div> : null}
                  </td>
                  <td>{monitor.last_checked_at ? new Date(monitor.last_checked_at).toLocaleString() : 'never'}</td>
                  <td>{monitor.enabled ? 'enabled' : 'paused'}</td>
                  <td className="tools-row-actions">
                    <button type="button" className="ch247-button ch247-button--ghost" disabled={busy === monitor.id} onClick={() => void checkNow(monitor)}>Check now</button>
                    <button type="button" className="ch247-button ch247-button--ghost" onClick={() => void toggle(monitor)}>{monitor.enabled ? 'Pause' : 'Resume'}</button>
                    <button type="button" className="ch247-button ch247-button--ghost" onClick={() => void remove(monitor)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {events.length > 0 ? (
        <section aria-labelledby="tools-monitor-events">
          <h2 id="tools-monitor-events">Recent changes</h2>
          <ul className="tools-events">
            {events.map((event) => (
              <li key={event.id}>
                <span className={`tools-badge tools-badge--${event.status.toLowerCase()}`}>{event.status}</span>
                <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
                <span>{event.detail}</span>
                {event.previous_value !== null || event.current_value !== null ? (
                  <code>{event.previous_value ?? '∅'} → {event.current_value ?? '∅'}</code>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
