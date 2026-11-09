import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { getMetaConfiguration, getMetaActivity, getMetaAudit, metaAdminSend, getTikTokConfiguration, getTikTokDiagnostics, getTikTokActivity, tiktokAdminSend, type MetaAdminConfiguration, type MetaActivity, type MetaAuditEntry, type TikTokAdminConfiguration, type TikTokDiagnostics } from '../lib/marketing-admin-api';
import { formatDateTime } from '../components/revenue-guardian/rg-widgets';

const TABS = [{ id: 'meta-pixel', label: 'Meta Pixel' }, { id: 'tiktok-pixel', label: 'TikTok Pixel' }, { id: 'activity', label: 'Event activity' }, { id: 'audit', label: 'Configuration history' }] as const;
const TIKTOK_EVENT_NAMES = ['PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'PlaceAnOrder', 'CompletePayment', 'SubmitForm', 'CompleteRegistration', 'Contact', 'Subscribe'] as const;
const statusLabel = (value: string | null) => value ? value.replace(/_/g, ' ') : 'Not tested';

/** Canonical marketing console. The legacy WHMCS key is an import source, never a second owner. */
export default function AdminMarketingIntegrationsPage() {
  usePageMeta('Marketing Integrations', 'Centrally manage consent-aware Meta Pixel and Conversions API settings.');
  const { provider } = useParams();
  const { pathname } = useLocation();
  const tab = pathname.includes('tiktok-pixel') ? 'tiktok-pixel' : TABS.some(t => t.id === provider) ? provider! : 'meta-pixel';
  return <div className="ch247-stack ch247-marketing-admin">
    <header className="ch247-card">
      <p className="ch247-page__hint"><Link to="/admin">Admin</Link> / Marketing Integrations</p>
      <h1>Marketing Integrations</h1>
      <p><Link to="/admin/integrations/google-ads">Google Ads conversion settings →</Link></p>
      <p className="ch247-page__hint">One configuration for the CloudHost247 website and client area. Marketing stays off until the visitor gives permission.</p>
      <nav className="ch247-inline-actions" aria-label="Marketing integration sections" style={{ flexWrap: 'wrap', marginTop: '1rem' }}>
        {TABS.map(t => <Link key={t.id} className={`ch247-button ${t.id === tab ? '' : 'ch247-button--outline'}`} aria-current={t.id === tab ? 'page' : undefined} to={`/admin/marketing-integrations/${t.id}`}>{t.label}</Link>)}
      </nav>
    </header>
    {tab === 'meta-pixel' ? <MetaPixelSettings /> : tab === 'tiktok-pixel' ? <TikTokPixelSettings /> : tab === 'activity' ? <EventActivity /> : <ConfigurationHistory />}
  </div>;
}

function MetaPixelSettings() {
  const [config, setConfig] = useState<MetaAdminConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [removeToken, setRemoveToken] = useState(false);
  const [legacyId, setLegacyId] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'import' | 'enable-capi' | null>(null);
  async function load() {
    setError('');
    try { setConfig((await getMetaConfiguration()).configuration); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load configuration'); }
  }
  useEffect(() => { void load(); }, []);
  function update(patch: Partial<MetaAdminConfiguration>) { if (config) setConfig({ ...config, ...patch }); }
  async function save(event?: FormEvent) {
    event?.preventDefault(); if (!config || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await metaAdminSend<{ configuration: MetaAdminConfiguration }>('PUT', '', {
        expectedRevision: config.revision,
        configuration: { displayName: config.displayName, websiteDomain: config.websiteDomain, enabled: config.enabled, pixelId: config.pixelId || null,
          testMode: config.testMode, testEventCode: config.testEventCode || null, consentPolicy: config.consentPolicy,
          capi: { enabled: config.capi.enabled, apiVersion: config.capi.apiVersion } },
        ...(token ? { capiAccessToken: token } : {}), ...(removeToken ? { removeCapiToken: true } : {}),
      });
      setConfig(result.configuration); setToken(''); setRemoveToken(false); setConfirm(null);
      setMessage('Configuration saved. This does not confirm Meta event receipt.');
      window.dispatchEvent(new Event('ch247:marketing-refresh'));
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); setConfirm(null); void load(); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError('');
    try { const result = await metaAdminSend<{ message: string }>('POST', '/test', {}); setMessage(result.message); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Test failed'); }
    finally { setBusy(false); }
  }
  async function reset() {
    if (!config) return; setBusy(true); setError('');
    try { const result = await metaAdminSend<{ configuration: MetaAdminConfiguration }>('POST', '/reset', { expectedRevision: config.revision, confirmation: 'RESET' }); setConfig(result.configuration); setToken(''); setConfirm(null); setMessage('Integration reset and disabled. Audit history is retained.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Reset failed'); await load(); }
    finally { setBusy(false); }
  }
  async function importLegacy() {
    if (!config) return; setBusy(true); setError('');
    try {
      const result = await metaAdminSend<{ configuration: MetaAdminConfiguration }>('POST', '/import-legacy', { pixelId: legacyId.trim(), websiteDomain: config.websiteDomain, expectedRevision: config.revision, confirmImport: true });
      setConfig(result.configuration); setLegacyId(''); setConfirm(null); setMessage('Legacy identifier imported with tracking disabled. Review the domain and consent settings before enabling.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed'); await load(); }
    finally { setBusy(false); }
  }
  if (!config) return <section className="ch247-card"><p role={error ? 'alert' : 'status'}>{error || 'Loading Meta Pixel configuration…'}</p>{error && <button onClick={() => void load()}>Retry</button>}</section>;
  return <>
    {message && <p className="ch247-card" role="status">{message}</p>}
    {error && <p className="ch247-card" role="alert">{error}</p>}
    <form className="ch247-card ch247-stack" onSubmit={save}>
      <div className="ch247-marketing-admin__heading"><div><h2>Meta Pixel</h2><p className="ch247-page__hint">Official browser Pixel · centrally managed · revision {config.revision}</p></div><span className="ch247-badge">{config.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <div className="ch247-marketing-admin__fields">
        <label>Integration name<input required maxLength={120} value={config.displayName} onChange={e => update({ displayName: e.target.value })} /></label>
        <label>Pixel ID<input required inputMode="numeric" pattern="[1-9][0-9]{4,31}" placeholder="Digits from Meta Events Manager" value={config.pixelId ?? ''} onChange={e => update({ pixelId: e.target.value })} /><small>A public identifier, not an access token.</small></label>
        <label>Website domain<input required placeholder="cloudhost247.com" value={config.websiteDomain} onChange={e => update({ websiteDomain: e.target.value })} /><small>Hostname only. The runtime refuses a domain mismatch.</small></label>
        <label>Consent policy<select value={config.consentPolicy} onChange={e => update({ consentPolicy: e.target.value as MetaAdminConfiguration['consentPolicy'] })}><option value="global_opt_in">Explicit opt-in worldwide (recommended)</option><option value="jurisdiction_opt_in">Jurisdiction-aware rules; unknown regions opt-in</option></select></label>
      </div>
      <label className="ch247-marketing-admin__check"><input type="checkbox" checked={config.enabled} onChange={e => update({ enabled: e.target.checked })} /> Enable Meta Pixel for consented visitors</label>
      <p className="ch247-page__hint">Enabling never bypasses cookie consent. Registration and checkout acceptance are not marketing consent.</p>
      <fieldset className="ch247-marketing-admin__fieldset"><legend>Test mode</legend>
        <label className="ch247-marketing-admin__check"><input type="checkbox" checked={config.testMode} onChange={e => update({ testMode: e.target.checked })} /> Enable test mode</label>
        <label>Test Event Code<input value={config.testEventCode ?? ''} placeholder="Code from Meta Test Events" autoComplete="off" onChange={e => update({ testEventCode: e.target.value })} /></label>
        <p className="ch247-page__hint">The code is attached to CAPI test deliveries only. Meta says test events still enter normal measurement; use a test dataset and turn test mode off afterwards. Browser verification uses the Test Events browser tab, not an undocumented fbq parameter.</p>
      </fieldset>
      <fieldset className="ch247-marketing-admin__fieldset"><legend>Conversions API (separate activation)</legend>
        <p className="ch247-page__hint">Credential: {config.capi.hasToken ? 'Stored encrypted; write-only' : 'Not configured'}. Requires a token authorized for this Pixel and the worker running.</p>
        <label className="ch247-marketing-admin__check"><input type="checkbox" checked={config.capi.enabled} onChange={e => { update({ capi: { ...config.capi, enabled: e.target.checked } }); if (e.target.checked) setConfirm('enable-capi'); }} /> Enable server-side delivery</label>
        <label>Meta access token<input type="password" autoComplete="new-password" value={token} placeholder={config.capi.hasToken ? 'Leave blank to keep the stored token' : 'Write-only authorized access token'} onChange={e => setToken(e.target.value)} /><small>Never returned by the API, logged, or sent to the browser.</small></label>
        <label>Graph API version<input value={config.capi.apiVersion} onChange={e => update({ capi: { ...config.capi, apiVersion: e.target.value } })} /></label>
        <label className="ch247-marketing-admin__check"><input type="checkbox" checked={removeToken} onChange={e => setRemoveToken(e.target.checked)} /> Remove stored token (disable CAPI first)</label>
      </fieldset>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}><button className="ch247-button" disabled={busy} type="submit">Save configuration</button><button type="button" disabled={busy} onClick={() => void test()}>Test configuration</button><button type="button" disabled={busy} onClick={() => void load()}>Reload</button><button type="button" className="ch247-button--danger" disabled={busy} onClick={() => setConfirm('reset')}>Reset integration</button></div>
    </form>
    <section className="ch247-card"><h2>Status & diagnostics</h2><dl className="ch247-marketing-admin__status"><div><dt>Last configuration update</dt><dd>{formatDateTime(config.lastConfigurationUpdate)}</dd></div><div><dt>Last configuration test</dt><dd>{formatDateTime(config.lastConfigurationTestAt)}</dd></div><div><dt>Configuration test status</dt><dd>{statusLabel(config.lastConfigurationTestStatus)}</dd></div><div><dt>Last delivery status</dt><dd><Link to="/admin/marketing-integrations/activity">View real event activity →</Link></dd></div><div><dt>Last error</dt><dd>{config.lastError || 'No configuration error recorded'}</dd></div></dl><p className="ch247-page__hint">“Delivered” means the Meta HTTP API accepted a request. Only Meta Test Events / Events Manager can verify provider-side receipt and deduplication.</p></section>
    <section className="ch247-card"><h2>Import legacy WHMCS Pixel</h2><p className="ch247-page__hint">Copy the existing <code>facebook_pixel_code</code> identifier from WHMCS → Marketing Integrations → Meta Pixel. The old database value is preserved. Import replaces this draft configuration and leaves tracking disabled; it does not install a second snippet.</p><div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}><label>Legacy Pixel ID<input value={legacyId} inputMode="numeric" onChange={e => setLegacyId(e.target.value)} /></label><button type="button" disabled={!legacyId || !config.websiteDomain || busy} onClick={() => setConfirm('import')}>Review legacy import</button></div></section>
    {confirm && <div className="ch247-card" role="alertdialog" aria-labelledby="marketing-confirm-title"><h2 id="marketing-confirm-title">{confirm === 'reset' ? 'Reset Meta Pixel?' : confirm === 'import' ? 'Replace configuration with legacy identifier?' : 'Confirm authorized CAPI activation'}</h2><p>{confirm === 'reset' ? 'This disables tracking, removes the stored token and cancels pending deliveries. Configuration audit history remains.' : confirm === 'import' ? 'The imported Pixel remains disabled until you review and save Enable. The legacy source setting is not deleted.' : 'Only continue with a token authorized for this Pixel. Save configuration to commit this choice; no credential is activated by opening this confirmation.'}</p><div className="ch247-inline-actions"><button disabled={busy} onClick={() => confirm === 'reset' ? void reset() : confirm === 'import' ? void importLegacy() : setConfirm(null)}>{confirm === 'reset' ? 'Confirm reset' : confirm === 'import' ? 'Import disabled configuration' : 'I have authorization — continue'}</button><button disabled={busy} onClick={() => { if (confirm === 'enable-capi') update({ capi: { ...config.capi, enabled: false } }); setConfirm(null); }}>Cancel</button></div></div>}
  </>;
}

function EventActivity() {
  const [events, setEvents] = useState<MetaActivity[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(true);
  async function load() { setLoading(true); try { setEvents((await getMetaActivity()).events); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Activity unavailable'); } finally { setLoading(false); } }
  useEffect(() => { void load(); }, []);
  return <section className="ch247-card"><h2>Event activity</h2><p className="ch247-page__hint">Browser dispatch and server API acceptance are different signals. No personal matching data is displayed.</p><button disabled={loading} onClick={() => void load()}>Refresh activity</button>{error && <p role="alert">{error}</p>}{loading ? <p role="status">Loading activity…</p> : events.length === 0 ? <p>No marketing events recorded. No delivery is implied.</p> : <div className="ch247-table-wrap"><table className="ch247-table"><thead><tr><th>Event / ID</th><th>Occurred</th><th>Channel</th><th>Server delivery</th><th>Consent now</th></tr></thead><tbody>{events.map(e => <tr key={e.id}><td><strong>{e.event_name}</strong><small className="ch247-marketing-admin__event-id">{e.event_id}</small></td><td>{formatDateTime(e.occurred_at)}</td><td>{e.channel}</td><td>{e.delivery_status ? `${statusLabel(e.delivery_status)} · ${e.attempts} attempt(s)${e.http_status ? ` · HTTP ${e.http_status}` : ''}${e.last_error ? ` · ${e.last_error}` : ''}` : 'Browser only / not queued'}</td><td>{e.marketing_consent_current ? 'Granted' : 'Not granted / expired'}</td></tr>)}</tbody></table></div>}</section>;
}
function ConfigurationHistory() {
  const [entries, setEntries] = useState<MetaAuditEntry[]>([]); const [error, setError] = useState('');
  useEffect(() => { getMetaAudit().then(r => setEntries(r.entries)).catch(e => setError(e instanceof Error ? e.message : 'History unavailable')); }, []);
  return <section className="ch247-card"><h2>Configuration history</h2><p className="ch247-page__hint">Audited saves, tests, imports and resets. Credentials are excluded.</p>{error && <p role="alert">{error}</p>}{!error && entries.length === 0 && <p>No configuration changes recorded.</p>}<div className="ch247-table-wrap"><table className="ch247-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th></tr></thead><tbody>{entries.map(e => <tr key={e.id}><td>{formatDateTime(e.created_at)}</td><td>{e.action}</td><td>{e.actor_id ?? 'System'}</td></tr>)}</tbody></table></div></section>;
}

function TikTokPixelSettings() {
  const [config, setConfig] = useState<TikTokAdminConfiguration | null>(null);
  const [diagnostics, setDiagnostics] = useState<TikTokDiagnostics | null>(null);
  const [activity, setActivity] = useState<MetaActivity[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [removeToken, setRemoveToken] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  async function load() {
    setError('');
    try {
      const [cfg, diag, act] = await Promise.all([getTikTokConfiguration(), getTikTokDiagnostics(), getTikTokActivity()]);
      setConfig(cfg.configuration); setDiagnostics(diag.diagnostics); setActivity(act.events);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load TikTok configuration'); }
  }
  useEffect(() => { void load(); }, []);
  function update(patch: Partial<TikTokAdminConfiguration>) { if (config) setConfig({ ...config, ...patch }); }
  function toggleEvent(name: string, on: boolean) {
    if (!config) return;
    const next = on ? [...new Set([...config.enabledEvents, name])] : config.enabledEvents.filter(e => e !== name);
    if (next.length > 0) update({ enabledEvents: next });
  }
  async function save(event?: FormEvent) {
    event?.preventDefault(); if (!config || busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await tiktokAdminSend<{ configuration: TikTokAdminConfiguration }>('PUT', '', {
        expectedRevision: config.revision,
        configuration: { displayName: config.displayName, websiteDomain: config.websiteDomain, enabled: config.enabled, pixelId: config.pixelId || null,
          testMode: config.testMode, testEventCode: config.testEventCode || null, remarketingEnabled: config.remarketingEnabled,
          enabledEvents: config.enabledEvents, eventsApi: { enabled: config.eventsApi.enabled } },
        ...(token ? { eventsApiAccessToken: token } : {}), ...(removeToken ? { removeEventsApiToken: true } : {}),
      });
      setConfig(result.configuration); setToken(''); setRemoveToken(false);
      setMessage('Configuration saved. This does not confirm TikTok event receipt — verify in TikTok Events Manager.');
      window.dispatchEvent(new Event('ch247:marketing-refresh'));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed'); void load(); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setError('');
    try { const result = await tiktokAdminSend<{ message: string }>('POST', '/test', {}); setMessage(result.message); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Test failed'); }
    finally { setBusy(false); }
  }
  async function reset() {
    if (!config) return; setBusy(true); setError('');
    try { const result = await tiktokAdminSend<{ configuration: TikTokAdminConfiguration }>('POST', '/reset', { expectedRevision: config.revision, confirmation: 'RESET' }); setConfig(result.configuration); setToken(''); setConfirmReset(false); setMessage('TikTok integration reset and disabled. Audit history is retained.'); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Reset failed'); await load(); }
    finally { setBusy(false); }
  }
  if (!config) return <section className="ch247-card"><p role={error ? 'alert' : 'status'}>{error || 'Loading TikTok Pixel configuration…'}</p>{error && <button onClick={() => void load()}>Retry</button>}</section>;
  return <>
    {message && <p className="ch247-card" role="status">{message}</p>}
    {error && <p className="ch247-card" role="alert">{error}</p>}
    <form className="ch247-card ch247-stack" onSubmit={save}>
      <div className="ch247-marketing-admin__heading"><div><h2>TikTok Pixel</h2><p className="ch247-page__hint">Official browser Pixel + optional Events API · centrally managed · revision {config.revision}</p></div><span className="ch247-badge">{config.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <div className="ch247-marketing-admin__fields">
        <label>Pixel name<input required maxLength={120} value={config.displayName} onChange={e => update({ displayName: e.target.value })} /></label>
        <label>TikTok Pixel ID<input required pattern="[A-Za-z0-9]{16,32}" placeholder="Pixel code from TikTok Events Manager" value={config.pixelId ?? ''} onChange={e => update({ pixelId: e.target.value })} /><small>Alphanumeric pixel code — a public identifier, not an access token. Arbitrary scripts cannot be entered here.</small></label>
        <label>Website domain<input required placeholder="cloudhost247.com" value={config.websiteDomain} onChange={e => update({ websiteDomain: e.target.value })} /><small>Hostname only. The runtime refuses a domain mismatch.</small></label>
      </div>
      <label className="ch247-marketing-admin__check"><input type="checkbox" checked={config.enabled} onChange={e => update({ enabled: e.target.checked })} /> Enable TikTok Pixel for consented visitors</label>
      <p className="ch247-page__hint">Enabling never bypasses cookie consent: TikTok loads only after the visitor grants the shared Advertising/Marketing consent category, independently of Meta Pixel and Google settings.</p>
      <label className="ch247-marketing-admin__check"><input type="checkbox" checked={config.remarketingEnabled} onChange={e => update({ remarketingEnabled: e.target.checked })} /> Enable remarketing / audience tracking (consent-aware)</label>
      <p className="ch247-page__hint">Remarketing uses product-interaction events for audience building in your TikTok Ads account. Dynamic product advertising additionally requires a verified TikTok catalog in Events Manager — it is not claimed active here.</p>
      <fieldset className="ch247-marketing-admin__fieldset"><legend>Standard & lead events</legend>
        {TIKTOK_EVENT_NAMES.map(name => <label key={name} className="ch247-marketing-admin__check"><input type="checkbox" checked={config.enabledEvents.includes(name)} onChange={e => toggleEvent(name, e.target.checked)} /> {name}{['Contact', 'SubmitForm', 'CompleteRegistration', 'Subscribe'].includes(name) ? ' (lead)' : ''}</label>)}
        <p className="ch247-page__hint">CompletePayment can only be created by verified payment confirmation, never by a browser claim. Disabling a lead event stops it immediately.</p>
      </fieldset>
      <fieldset className="ch247-marketing-admin__fieldset"><legend>Test mode</legend>
        <label className="ch247-marketing-admin__check"><input type="checkbox" checked={config.testMode} onChange={e => update({ testMode: e.target.checked })} /> Enable test mode</label>
        <label>Test Event Code<input value={config.testEventCode ?? ''} placeholder="Code from TikTok Events Manager Test Events" autoComplete="off" onChange={e => update({ testEventCode: e.target.value })} /></label>
        <p className="ch247-page__hint">Test traffic carries the test event code so it does not generate production conversions or distort campaign reporting.</p>
      </fieldset>
      <fieldset className="ch247-marketing-admin__fieldset"><legend>Events API (server-side, optional)</legend>
        <p className="ch247-page__hint">Credential: {config.eventsApi.hasToken ? 'Stored encrypted; write-only' : 'Not configured — Events API remains pending external TikTok account configuration until an authorized token is stored'}. Server events share the browser event_id for deduplication and are never sent without marketing consent.</p>
        <label className="ch247-marketing-admin__check"><input type="checkbox" checked={config.eventsApi.enabled} onChange={e => update({ eventsApi: { ...config.eventsApi, enabled: e.target.checked } })} /> Enable Events API delivery</label>
        <label>TikTok access token<input type="password" autoComplete="new-password" value={token} placeholder={config.eventsApi.hasToken ? 'Leave blank to keep the stored token' : 'Write-only authorized access token'} onChange={e => setToken(e.target.value)} /><small>Never returned by the API, logged, or sent to the browser.</small></label>
        <label className="ch247-marketing-admin__check"><input type="checkbox" checked={removeToken} onChange={e => setRemoveToken(e.target.checked)} /> Remove stored token (disable Events API first)</label>
      </fieldset>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}><button className="ch247-button" disabled={busy} type="submit">Save Changes</button><button type="button" disabled={busy} onClick={() => void test()}>Test configuration</button><button type="button" disabled={busy} onClick={() => void load()}>Reload</button><button type="button" className="ch247-button--danger" disabled={busy} onClick={() => setConfirmReset(true)}>Reset Configuration</button></div>
    </form>
    {diagnostics && <section className="ch247-card"><h2>Diagnostics</h2><dl className="ch247-marketing-admin__status">
      <div><dt>Pixel ID</dt><dd>{diagnostics.pixelId || 'Not configured'}</dd></div>
      <div><dt>Integration state</dt><dd>{diagnostics.enabled ? 'Enabled' : 'Disabled'}</dd></div>
      <div><dt>Installation status</dt><dd>{statusLabel(diagnostics.installationStatus)}</dd></div>
      <div><dt>Pixel initialization</dt><dd>Central runtime (bootstrap-driven, consent-gated, duplicate-init protected)</dd></div>
      <div><dt>Consent configuration</dt><dd>Shared marketing consent required before load</dd></div>
      <div><dt>Events API connection</dt><dd>{statusLabel(diagnostics.eventsApiConnection)}</dd></div>
      <div><dt>Enabled events</dt><dd>{diagnostics.enabledEvents.join(', ') || 'None'}</dd></div>
      <div><dt>Last successful test</dt><dd>{formatDateTime(diagnostics.lastSuccessfulTest)}</dd></div>
      <div><dt>Configuration test status</dt><dd>{statusLabel(config.lastConfigurationTestStatus)}</dd></div>
      <div><dt>Last configuration update</dt><dd>{formatDateTime(config.lastConfigurationUpdate)}</dd></div>
      <div><dt>Last server-side delivery</dt><dd>{diagnostics.lastServerDeliveryStatus ? `${statusLabel(diagnostics.lastServerDeliveryStatus)}${diagnostics.lastServerDeliveredAt ? ` · ${formatDateTime(diagnostics.lastServerDeliveredAt)}` : ''}` : 'No server delivery yet'}</dd></div>
      <div><dt>Events recorded</dt><dd>{diagnostics.eventsRecorded}</dd></div>
      <div><dt>Duplicate event warnings</dt><dd>{diagnostics.duplicateEventWarnings}</dd></div>
      <div><dt>Last error</dt><dd>{config.lastError || 'No configuration error recorded'}</dd></div>
    </dl><p className="ch247-page__hint">“Delivered” means the TikTok Events API accepted a request (code 0). Only TikTok Events Manager / Test Events can verify provider-side receipt and deduplication. No customer browsing history or token is shown here.</p></section>}
    <section className="ch247-card"><h2>Recent TikTok event activity</h2>{activity.length === 0 ? <p>No TikTok events recorded. No delivery is implied.</p> : <div className="ch247-table-wrap"><table className="ch247-table"><thead><tr><th>Event / ID</th><th>Occurred</th><th>Channel</th><th>Server delivery</th><th>Consent now</th></tr></thead><tbody>{activity.map(e => <tr key={e.id}><td><strong>{e.event_name}</strong><small className="ch247-marketing-admin__event-id">{e.event_id}</small></td><td>{formatDateTime(e.occurred_at)}</td><td>{e.channel}</td><td>{e.delivery_status ? `${statusLabel(e.delivery_status)} · ${e.attempts} attempt(s)${e.http_status ? ` · HTTP ${e.http_status}` : ''}${e.last_error ? ` · ${e.last_error}` : ''}` : 'Browser only / not queued'}</td><td>{e.marketing_consent_current ? 'Granted' : 'Not granted / expired'}</td></tr>)}</tbody></table></div>}</section>
    {confirmReset && <div className="ch247-card" role="alertdialog" aria-labelledby="tiktok-confirm-title"><h2 id="tiktok-confirm-title">Reset TikTok Pixel?</h2><p>This disables tracking, removes the stored Events API token and cancels pending TikTok deliveries. Configuration audit history remains.</p><div className="ch247-inline-actions"><button disabled={busy} onClick={() => void reset()}>Confirm reset</button><button disabled={busy} onClick={() => setConfirmReset(false)}>Cancel</button></div></div>}
  </>;
}
