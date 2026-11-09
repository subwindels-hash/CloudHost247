import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useMarketing } from '../lib/marketing';

const BASE = '/api/v1/admin/marketing-integrations/google-analytics';
interface Configuration {
  displayName: string; websiteDomain: string; enabled: boolean; measurementId: string | null;
  testMode: boolean; streamReviewed?: boolean; userDataReviewed?: boolean; revision: number; lastConfigurationUpdate: string | null;
  lastConfigurationTestAt: string | null; lastConfigurationTestStatus: string | null; lastSuccessfulLocalTestAt?: string | null;
  installationStatus: string; connectionStatus: string;
}

interface AuditEntry { id: string; action: string; actor_id: string | null; created_at: string }
const AUDIT_LABELS: Record<string, string> = {
  'marketing.google_analytics.configuration_saved': 'Settings saved',
  'marketing.google_analytics.configuration_reset': 'Settings reset',
  'marketing.google_analytics.configuration_tested': 'Local configuration tested',
};

/** Local status is diagnostic only; provider receipt requires Realtime/DebugView. */
export default function AdminGoogleAnalyticsSettings() {
  const snapshot = useMarketing();
  const [config, setConfig] = useState<Configuration | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditError, setAuditError] = useState('');
  const [auditLoading, setAuditLoading] = useState(true);
  const auditRequest = useRef(0);
  async function load() {
    try { setConfig((await apiFetch<{ configuration: Configuration }>(BASE)).configuration); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load settings'); }
  }
  async function loadAudit() {
    const request = ++auditRequest.current;
    setAuditLoading(true);
    try {
      const response = await apiFetch<{ entries: AuditEntry[] }>(`${BASE}/audit`);
      if (!Array.isArray(response.entries)) throw new Error('Invalid audit response');
      if (request === auditRequest.current) { setAudit(response.entries); setAuditError(''); }
    } catch { if (request === auditRequest.current) setAuditError('Audit history could not be loaded.'); }
    finally { if (request === auditRequest.current) setAuditLoading(false); }
  }
  useEffect(() => { void load(); void loadAudit(); }, []);
  function update(patch: Partial<Configuration>) { if (config) setConfig({ ...config, ...patch }); }
  async function save(event: FormEvent) {
    event.preventDefault(); if (!config) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const { configuration } = await apiFetch<{ configuration: Configuration }>(BASE, { method: 'PUT', body: JSON.stringify({ expectedRevision: config.revision, configuration: { displayName: config.displayName, websiteDomain: config.websiteDomain, measurementId: config.measurementId || null, enabled: config.enabled, testMode: config.testMode, streamReviewed: !!config.streamReviewed, userDataReviewed: !!config.userDataReviewed } }) });
      setConfig(configuration); setMessage('Settings saved. Google receipt is not verified.'); window.dispatchEvent(new Event('ch247:marketing-refresh')); void loadAudit();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiFetch<{ message: string }>(`${BASE}/test`, { method: 'POST', body: '{}' });
      setMessage(result.message); await Promise.all([load(), loadAudit()]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Test failed'); }
    finally { setBusy(false); }
  }
  async function reset() {
    if (!config) return; setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiFetch<{ configuration: Configuration }>(`${BASE}/reset`, { method: 'POST', body: JSON.stringify({ expectedRevision: config.revision, confirmation: 'RESET' }) });
      setConfig(result.configuration); setConfirm(false); setMessage('Configuration reset and disabled.'); window.dispatchEvent(new Event('ch247:marketing-refresh')); void loadAudit();
    } catch (e) { setError(e instanceof Error ? e.message : 'Reset failed'); }
    finally { setBusy(false); }
  }
  if (!config) return <section className="ch247-card"><p role={error ? 'alert' : 'status'}>{error || 'Loading Google Analytics configuration…'}</p>{error && <button onClick={() => void load()}>Retry</button>}</section>;
  return <>
    <section className="ch247-card"><h2>Google Analytics</h2><p role="status">Page-view tracking requires analytics consent and is restricted to supported public routes. Delivery to Google has not been verified; configure the Google stream as documented before enabling.</p></section>
    {error && <p className="ch247-card" role="alert">{error}</p>}{message && <p className="ch247-card" role="status">{message}</p>}
    <form className="ch247-card ch247-stack" onSubmit={save}>
      <label>Property name<input required maxLength={120} value={config.displayName} onChange={e => update({ displayName: e.target.value })} /></label>
      <label>Website domain<input placeholder="example.com" value={config.websiteDomain} onChange={e => update({ websiteDomain: e.target.value })} /></label>
      <label>GA4 Measurement ID<input placeholder="G-XXXXXXXXXX" pattern="G-[A-Z0-9]{10}" value={config.measurementId || ''} onChange={e => update({ measurementId: e.target.value || null })} /></label>
      <label><input type="checkbox" checked={!!config.streamReviewed} onChange={e => update({ streamReviewed: e.target.checked })} /> I reviewed the GA4 web stream: automatic enhanced measurements and history-based page views are disabled, and other tags are not duplicating this integration.</label>
      <label><input type="checkbox" checked={!!config.userDataReviewed} onChange={e => update({ userDataReviewed: e.target.checked })} /> I disabled user-provided data collection and automatic detection in the Google tag and property, and reviewed linked destinations.</label>
      <label><input type="checkbox" checked={config.enabled} onChange={e => update({ enabled: e.target.checked })} /> Enable Google Analytics for consented visitors</label>
      <label><input type="checkbox" checked={config.testMode} onChange={e => update({ testMode: e.target.checked })} /> Test mode (mark events for DebugView)</label>
      <div className="ch247-inline-actions"><button disabled={busy}>Save Changes</button><button type="button" disabled={busy} onClick={() => void test()}>Test configuration</button><button type="button" disabled={busy} onClick={() => setConfirm(true)}>Reset Configuration</button></div>
    </form>
    {confirm && <section className="ch247-card" role="alertdialog" aria-label="Confirm configuration reset"><p>Reset and disable Google Analytics?</p><button disabled={busy} onClick={() => void reset()}>Confirm reset</button><button onClick={() => setConfirm(false)}>Cancel</button></section>}
    <section className="ch247-card"><h2>Diagnostics</h2><dl>
      <dt>Measurement ID</dt><dd>{config.measurementId || 'Not configured'}</dd>
      <dt>Configuration state</dt><dd>{!config.measurementId ? 'Not configured' : config.enabled && (!config.streamReviewed || !config.userDataReviewed) ? 'Blocked: privacy review required' : config.enabled ? 'Awaiting verification' : 'Disabled'}</dd>
      <dt>Installation</dt><dd>Page-view code installed; deployed tag and CSP unverified</dd><dt>Connection verification</dt><dd>Not verified</dd>
      <dt>Consent</dt><dd>{snapshot.consent?.preferences.analytics && snapshot.consent.decided && snapshot.consent.policyVersion === 1 && Date.parse(snapshot.consent.expiresAt) > Date.now() ? 'Analytics permitted for this browser' : 'Consent restricted for this browser'}</dd>
      <dt>Current browser initialization</dt><dd>{snapshot.analytics?.status || 'Not started'}{snapshot.analytics?.error ? `: ${snapshot.analytics.error}` : ''}. Admin pages are not measured.</dd>
      <dt>Last configuration update</dt><dd>{config.lastConfigurationUpdate || 'Never'}</dd>
      <dt>Last local configuration test</dt><dd>{config.lastConfigurationTestAt || 'Never'} {config.lastConfigurationTestStatus || ''}</dd>
      <dt>Last successful local validation for this revision</dt><dd>{config.lastSuccessfulLocalTestAt || 'Never'} — format only; Google was not contacted.</dd>
      <dt>Last verified Google delivery</dt><dd>Never — this test does not contact Google.</dd>
      <dt>Duplicate tracking</dt><dd>Known existing Google tags are detected before initialization; audit deployed tags and GTM separately.</dd>
    </dl></section>
    <section className="ch247-card"><h2>Configuration audit history</h2>
      <p className="ch247-page__hint">The latest 50 administrative changes and local tests. No Google delivery is implied.</p>
      {auditLoading ? <p role="status">Loading audit history…</p> : auditError ? <p role="alert">{auditError} <button type="button" onClick={() => void loadAudit()}>Retry audit history</button></p> : audit.length === 0 ? <p>No configuration audit entries yet.</p> :
        <div className="ch247-table-scroll"><table><caption className="ch247-visually-hidden">Google Analytics configuration audit history</caption><thead><tr><th scope="col">Time</th><th scope="col">Action</th><th scope="col">Admin ID</th></tr></thead>
          <tbody>{audit.map(entry => <tr key={entry.id}><td>{entry.created_at}</td><td>{AUDIT_LABELS[entry.action] || 'Configuration action'}</td><td>{entry.actor_id || 'Unavailable'}</td></tr>)}</tbody>
        </table></div>}
    </section>
  </>;
}
