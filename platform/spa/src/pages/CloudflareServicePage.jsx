import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { cloudflareApi, describeError } from '../lib/api.js';
import { statusClass, humanizeStatus } from '../lib/format.js';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA', 'PTR'];
const PRIORITY_TYPES = new Set(['MX', 'SRV']);
const EMPTY_RECORD = { name: '@', type: 'A', content: '', ttl: 1, proxied: false, priority: '' };

const TABS = [
  ['overview', 'Overview', null],
  ['dns', 'DNS', 'dns'],
  ['ssl', 'SSL/TLS', 'ssl'],
  ['firewall', 'Firewall', 'firewall'],
  ['speed', 'Speed', 'speed'],
  ['caching', 'Caching', 'caching'],
  ['scrape-shield', 'Scrape shield', 'scrape_shield'],
  ['dnssec', 'DNSSEC', 'dnssec'],
  ['analytics', 'Analytics', 'analytics'],
  ['plan', 'Plan', null],
  ['activity', 'Activity', null],
];

function SettingSelect({ id, label, value, options, onChange }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function SettingNumber({ id, label, value, onChange, min, max }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="number" min={min} max={max} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * One Cloudflare service (zone) on the account.
 *
 * Reads of DNS and settings-backed tabs come from the local cache and say so (with `lastSyncedAt`);
 * every write goes to Cloudflare live inside the request and is refused with a neutral reason when
 * Cloudflare rejects it. The UI mirrors that contract: cached sections show the sync state, and the
 * Sync button reports what actually changed.
 */
export default function CloudflareServicePage() {
  const { id } = useParams();
  const [tab, setTab] = useState('overview');
  const [service, setService] = useState(null);
  const [entitlements, setEntitlements] = useState(null);
  const [capabilities, setCapabilities] = useState(null);
  const [nameservers, setNameservers] = useState([]);
  const [nameserverNotice, setNameserverNotice] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [dns, setDns] = useState(null);
  const [recordForm, setRecordForm] = useState(EMPTY_RECORD);
  const [editingRecordId, setEditingRecordId] = useState(null);
  const [showRecordForm, setShowRecordForm] = useState(false);

  const [settings, setSettings] = useState({});
  const [firewall, setFirewall] = useState(null);
  const [ruleForm, setRuleForm] = useState({ value: '', mode: 'block', notes: '' });
  const [purgeUrls, setPurgeUrls] = useState('');

  const [dnssec, setDnssec] = useState(null);
  const [registrarNotice, setRegistrarNotice] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [plan, setPlan] = useState(null);
  const [activity, setActivity] = useState(null);

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

  const loadService = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const res = await cloudflareApi.service(id);
      setService(res.service);
      setEntitlements(res.entitlements ?? null);
      setCapabilities(res.capabilities ?? null);
      setNameservers(res.nameservers ?? []);
      setNameserverNotice(res.nameserverNotice ?? '');
    } catch (e) {
      setError(describeError(e));
    }
  }, [id]);

  useEffect(() => { loadService(); }, [loadService]);

  const loadTab = useCallback(async (active) => {
    if (!id) return;
    setError('');
    try {
      if (active === 'dns') {
        const res = await cloudflareApi.dns(id);
        setDns(res);
      } else if (active === 'firewall') {
        const res = await cloudflareApi.settings(id, 'firewall');
        setSettings(res.settings ?? {});
        setFirewall(res);
      } else if (['ssl', 'speed', 'caching', 'scrape-shield'].includes(active)) {
        const res = await cloudflareApi.settings(id, active);
        setSettings(res.settings ?? {});
      } else if (active === 'dnssec') {
        try {
          const res = await cloudflareApi.dnssec(id);
          setDnssec(res.dnssec);
          setRegistrarNotice(res.registrarNotice ?? null);
        } catch (e) {
          // The API answers 404 when Cloudflare has no DNSSEC for the zone — an honest "not
          // enabled" state, not a failure of the screen.
          if (e && typeof e.status === 'number' && e.status === 404) {
            setDnssec({ status: 'disabled', dsRecord: null, keyTag: null, algorithm: null });
            setRegistrarNotice(null);
          } else {
            throw e;
          }
        }
      } else if (active === 'analytics') {
        const res = await cloudflareApi.analytics(id);
        setAnalytics(res);
      } else if (active === 'plan') {
        setPlan(await cloudflareApi.plan(id));
      } else if (active === 'activity') {
        const res = await cloudflareApi.activity(id);
        setActivity(res.activity ?? []);
      }
    } catch (e) {
      setError(describeError(e));
    }
  }, [id]);

  useEffect(() => { loadTab(tab); }, [tab, loadTab]);

  const sync = async () => {
    await run(async () => {
      const res = await cloudflareApi.sync(id);
      setNotice(`Synced from Cloudflare: ${JSON.stringify(res.records ?? res.summary ?? {})}`);
      await loadTab(tab);
    });
  };

  const recordField = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setRecordForm((f) => ({ ...f, [key]: value }));
  };

  const submitRecord = async (e) => {
    e.preventDefault();
    const payload = {
      name: recordForm.name.trim() || '@',
      type: recordForm.type,
      content: recordForm.content.trim(),
      ttl: Number(recordForm.ttl) || 1,
      proxied: !!recordForm.proxied,
    };
    if (PRIORITY_TYPES.has(payload.type)) payload.priority = recordForm.priority === '' ? undefined : Number(recordForm.priority);
    await run(async () => {
      if (editingRecordId) await cloudflareApi.updateDns(id, editingRecordId, payload);
      else await cloudflareApi.createDns(id, payload);
      setRecordForm(EMPTY_RECORD);
      setEditingRecordId(null);
      setShowRecordForm(false);
      await loadTab('dns');
    }, editingRecordId ? 'Record updated at Cloudflare.' : 'Record created at Cloudflare.');
  };

  const deleteRecord = async (record) => {
    await run(async () => {
      await cloudflareApi.deleteDns(id, record.id);
      await loadTab('dns');
    }, 'Record deleted at Cloudflare.');
  };

  const settingsField = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));

  const saveSettings = async (tabName) => {
    const current = settings;
    await run(async () => {
      const patch = {};
      for (const [key, val] of Object.entries(current)) {
        if (val !== '' && val !== null && val !== undefined) {
          patch[key] = tabName === 'firewall' && key === 'challenge_ttl' ? Number(val) : val;
        }
      }
      const res = await cloudflareApi.updateSettings(id, tabName, patch);
      setSettings((s) => ({ ...s, ...(res.settings ?? {}) }));
    }, 'Settings applied at Cloudflare.');
  };

  const submitRule = async (e) => {
    e.preventDefault();
    await run(async () => {
      await cloudflareApi.createFirewallRule(id, {
        value: ruleForm.value.trim(),
        mode: ruleForm.mode,
        ...(ruleForm.notes.trim() ? { notes: ruleForm.notes.trim() } : {}),
      });
      setRuleForm({ value: '', mode: 'block', notes: '' });
      await loadTab('firewall');
    }, 'Firewall rule created at Cloudflare.');
  };

  const deleteRule = async (rule) => {
    await run(async () => {
      await cloudflareApi.deleteFirewallRule(id, rule.id);
      await loadTab('firewall');
    }, 'Firewall rule deleted at Cloudflare.');
  };

  const purge = async (everything) => {
    const files = purgeUrls.split('\n').map((s) => s.trim()).filter(Boolean);
    await run(async () => {
      const res = await cloudflareApi.purge(id, everything ? { everything: true } : { files });
      setNotice(`Cache purged (${res.files ?? 0} URL(s)).`);
      setPurgeUrls('');
    });
  };

  const dnssecAction = async (action) => {
    await run(async () => {
      await cloudflareApi.dnssecAction(id, action);
      await loadTab('dnssec');
    }, `DNSSEC ${action}d.`);
  };

  const changePlan = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await run(async () => {
      const res = await cloudflareApi.changePlan(id, {
        newPlanId: form.get('newPlanId'),
        billingPeriod: form.get('billingPeriod'),
      });
      setNotice(res.applied ? 'Plan change applied.' : 'Plan change billed — it applies when the invoice settles.');
      await loadTab('plan');
    });
  };

  if (!id) return <div className="page"><p className="muted">No Cloudflare service selected.</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Cloudflare{service ? ` — ${service.zoneName}` : ''}</h1>
          <p className="muted">
            {service ? (
              <>
                <span className={statusClass(service.status)}>{humanizeStatus(service.status)}</span>
                {service.cloudflarePlan ? ` · ${service.cloudflarePlan} plan` : ''}
                {service.sslMode ? ` · SSL ${service.sslMode}` : ''}
              </>
            ) : 'Loading service…'}
          </p>
        </div>
        <div className="row row-wrap">
          <Link className="btn btn-ghost" to="/cloudflare">All zones</Link>
          <button className="btn btn-primary" type="button" onClick={sync} disabled={busy}>Sync from Cloudflare</button>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      <nav className="row row-wrap" aria-label="Cloudflare sections">
        {TABS.map(([key, label, feature]) => {
          const included = !feature || !entitlements || entitlements[feature];
          return (
            <button
              key={key}
              type="button"
              className={tab === key ? 'btn btn-primary' : 'btn btn-ghost'}
              disabled={!included}
              title={included ? undefined : 'Your Cloudflare plan does not include this feature'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          );
        })}
      </nav>
      {tab && entitlements && (() => {
        const entry = TABS.find(([key]) => key === tab);
        const feature = entry?.[2];
        if (feature && !entitlements[feature]) {
          return <div className="alert alert-error" role="alert">Your Cloudflare plan does not include {entry[1]}.</div>;
        }
        return null;
      })()}

      {tab === 'overview' && (
        <section className="card">
          <h2>Overview</h2>
          <dl className="detail-list">
            <dt>Zone</dt><dd>{service?.zoneName ?? '—'}</dd>
            <dt>Nameservers</dt><dd>{nameservers.length ? nameservers.join(', ') : 'Assigned on activation'}</dd>
            <dt>Notice</dt><dd>{nameserverNotice}</dd>
            <dt>Entitlements</dt>
            <dd>{entitlements ? Object.entries(entitlements).filter(([, on]) => on).map(([k]) => k).join(', ') || 'None recorded' : '—'}</dd>
            <dt>Capabilities</dt>
            <dd>{capabilities ? Object.entries(capabilities).filter(([, on]) => on).map(([k]) => k).join(', ') || 'None recorded' : '—'}</dd>
          </dl>
        </section>
      )}

      {tab === 'dns' && (
        <>
          <section className="card">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <div>
                <h2>DNS records</h2>
                <p className="muted">
                  {dns?.note ?? 'Records are a synchronized view of the zone; Cloudflare is the source of truth.'}
                  {dns?.lastSyncedAt ? ` Last synced ${new Date(dns.lastSyncedAt).toLocaleString()}.` : ''}
                </p>
              </div>
              <button className="btn btn-primary" type="button" onClick={() => { setShowRecordForm((s) => !s); setEditingRecordId(null); setRecordForm(EMPTY_RECORD); }}>
                {showRecordForm && !editingRecordId ? 'Cancel' : 'Add record'}
              </button>
            </div>
          </section>

          {showRecordForm && (
            <form className="card" onSubmit={submitRecord}>
              <h2>{editingRecordId ? 'Edit record' : 'Add record'}</h2>
              <p className="muted">The write goes to Cloudflare now; the record appears here from Cloudflare's answer.</p>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="cf-rec-name">Name</label>
                  <input id="cf-rec-name" value={recordForm.name} onChange={recordField('name')} required />
                </div>
                <div className="field">
                  <label htmlFor="cf-rec-type">Type</label>
                  <select id="cf-rec-type" value={recordForm.type} onChange={recordField('type')}>
                    {RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cf-rec-content">Content</label>
                  <input id="cf-rec-content" value={recordForm.content} onChange={recordField('content')} required />
                </div>
                <div className="field">
                  <label htmlFor="cf-rec-ttl">TTL (seconds, 1 = automatic)</label>
                  <input id="cf-rec-ttl" type="number" min="1" value={recordForm.ttl} onChange={recordField('ttl')} required />
                </div>
                {PRIORITY_TYPES.has(recordForm.type) && (
                  <div className="field">
                    <label htmlFor="cf-rec-priority">Priority</label>
                    <input id="cf-rec-priority" type="number" min="0" max="65535" value={recordForm.priority} onChange={recordField('priority')} />
                  </div>
                )}
              </div>
              <div className="row row-wrap">
                <label><input type="checkbox" checked={recordForm.proxied} onChange={recordField('proxied')} /> Proxied through Cloudflare</label>
              </div>
              <div className="row row-wrap" style={{ marginTop: 16 }}>
                <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save record'}</button>
                <button className="btn btn-ghost" type="button" onClick={() => { setShowRecordForm(false); setEditingRecordId(null); setRecordForm(EMPTY_RECORD); }}>Cancel</button>
              </div>
            </form>
          )}

          <section className="card">
            {dns === null ? <p className="muted">Loading records…</p> : (dns.records ?? []).length === 0 ? (
              <p className="muted">No cached records yet — use Sync to pull the zone from Cloudflare.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Type</th><th scope="col">Name</th><th scope="col">Content</th>
                      <th scope="col">TTL</th><th scope="col">Flags</th><th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dns.records.map((record) => (
                      <tr key={record.id}>
                        <td><strong>{record.type}</strong></td>
                        <td>{record.name}</td>
                        <td>
                          <span className="mono">{record.content}</span>
                          {record.priority !== null && record.priority !== undefined && <span className="muted"> · priority {record.priority}</span>}
                        </td>
                        <td>{record.ttl === 1 ? 'auto' : record.ttl}</td>
                        <td>{record.proxied ? 'proxied' : '—'}{record.ownership ? ` · ${record.ownership}` : ''}</td>
                        <td>
                          <div className="row row-wrap">
                            <button
                              className="btn btn-ghost"
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setEditingRecordId(record.id);
                                setShowRecordForm(true);
                                setRecordForm({
                                  name: record.name, type: record.type, content: record.content,
                                  ttl: record.ttl ?? 1, proxied: !!record.proxied, priority: record.priority ?? '',
                                });
                              }}
                            >Edit</button>
                            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => deleteRecord(record)}>Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {['ssl', 'speed', 'caching', 'scrape-shield'].includes(tab) && (
        <section className="card">
          <h2>{tab === 'ssl' ? 'SSL/TLS settings' : tab === 'speed' ? 'Speed settings' : tab === 'caching' ? 'Caching settings' : 'Scrape shield settings'}</h2>
          <p className="muted">Settings are read from the cache and written to Cloudflare when you save.</p>
          <div className="grid-2">
            {tab === 'ssl' && (
              <>
                <SettingSelect id="ssl-mode" label="SSL mode" value={settings.ssl} options={['off', 'flexible', 'full', 'strict']} onChange={settingsField('ssl')} />
                <SettingSelect id="min-tls" label="Minimum TLS version" value={settings.min_tls_version} options={['1.0', '1.1', '1.2', '1.3']} onChange={settingsField('min_tls_version')} />
                <SettingSelect id="tls-1-3" label="TLS 1.3" value={settings.tls_1_3} options={['on', 'off']} onChange={settingsField('tls_1_3')} />
                <SettingSelect id="always-https" label="Always use HTTPS" value={settings.always_use_https} options={['on', 'off']} onChange={settingsField('always_use_https')} />
                <SettingSelect id="https-rewrites" label="Automatic HTTPS rewrites" value={settings.automatic_https_rewrites} options={['on', 'off']} onChange={settingsField('automatic_https_rewrites')} />
              </>
            )}
            {tab === 'speed' && (
              <>
                <SettingSelect id="rocket" label="Rocket Loader" value={settings.rocket_loader} options={['on', 'off']} onChange={settingsField('rocket_loader')} />
                <SettingSelect id="brotli" label="Brotli" value={settings.brotli} options={['on', 'off']} onChange={settingsField('brotli')} />
                <SettingSelect id="http3" label="HTTP/3" value={settings.http3} options={['on', 'off']} onChange={settingsField('http3')} />
                <SettingSelect id="early-hints" label="Early hints" value={settings.early_hints} options={['on', 'off']} onChange={settingsField('early_hints')} />
                <SettingSelect id="ip-geo" label="IP geolocation" value={settings.ip_geolocation} options={['on', 'off']} onChange={settingsField('ip_geolocation')} />
              </>
            )}
            {tab === 'caching' && (
              <>
                <SettingSelect id="cache-level" label="Cache level" value={settings.cache_level} options={['aggressive', 'basic', 'simplified']} onChange={settingsField('cache_level')} />
                <SettingNumber id="browser-cache-ttl" label="Browser cache TTL (seconds)" value={settings.browser_cache_ttl} onChange={settingsField('browser_cache_ttl')} min={0} max={31536000} />
                <SettingSelect id="dev-mode" label="Development mode (3 hours)" value={settings.development_mode} options={['on', 'off']} onChange={settingsField('development_mode')} />
              </>
            )}
            {tab === 'scrape-shield' && (
              <>
                <SettingSelect id="email-obf" label="Email obfuscation" value={settings.email_obfuscation} options={['on', 'off']} onChange={settingsField('email_obfuscation')} />
                <SettingSelect id="server-exclude" label="Server side exclude" value={settings.server_side_exclude} options={['on', 'off']} onChange={settingsField('server_side_exclude')} />
                <SettingSelect id="hotlink" label="Hotlink protection" value={settings.hotlink_protection} options={['on', 'off']} onChange={settingsField('hotlink_protection')} />
              </>
            )}
          </div>
          <button className="btn btn-primary" type="button" style={{ marginTop: 16 }} disabled={busy} onClick={() => saveSettings(tab)}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </section>
      )}

      {tab === 'firewall' && (
        <>
          <section className="card">
            <h2>Firewall settings</h2>
            <div className="grid-2">
              <SettingSelect id="sec-level" label="Security level" value={settings.security_level} options={['essentially_off', 'low', 'medium', 'high', 'under_attack']} onChange={settingsField('security_level')} />
              <SettingSelect id="browser-check" label="Browser check" value={settings.browser_check} options={['on', 'off']} onChange={settingsField('browser_check')} />
              <SettingNumber id="challenge-ttl" label="Challenge TTL (seconds)" value={settings.challenge_ttl} onChange={settingsField('challenge_ttl')} min={300} max={31536000} />
            </div>
            <button className="btn btn-primary" type="button" style={{ marginTop: 16 }} disabled={busy} onClick={() => saveSettings('firewall')}>
              {busy ? 'Saving…' : 'Save settings'}
            </button>
          </section>

          <section className="card">
            <h2>Access rules</h2>
            <form onSubmit={submitRule}>
              <div className="grid-2">
                <div className="field">
                  <label htmlFor="rule-value">IP or CIDR</label>
                  <input id="rule-value" value={ruleForm.value} onChange={(e) => setRuleForm((f) => ({ ...f, value: e.target.value }))} placeholder="203.0.113.7 or 203.0.113.0/24" required />
                </div>
                <div className="field">
                  <label htmlFor="rule-mode">Mode</label>
                  <select id="rule-mode" value={ruleForm.mode} onChange={(e) => setRuleForm((f) => ({ ...f, mode: e.target.value }))}>
                    {(firewall?.modes ?? ['block', 'challenge', 'whitelist', 'js_challenge', 'managed_challenge']).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="rule-notes">Notes</label>
                  <input id="rule-notes" value={ruleForm.notes} onChange={(e) => setRuleForm((f) => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Add rule'}</button>
            </form>
            {firewall && (firewall.rules ?? []).length > 0 && (
              <div className="table-wrap" style={{ marginTop: 16 }}>
                <table className="table">
                  <thead>
                    <tr><th scope="col">Target</th><th scope="col">Value</th><th scope="col">Mode</th><th scope="col">Notes</th><th scope="col">Actions</th></tr>
                  </thead>
                  <tbody>
                    {firewall.rules.map((rule) => (
                      <tr key={rule.id}>
                        <td>{rule.target}</td>
                        <td className="mono">{rule.value}</td>
                        <td>{rule.mode}</td>
                        <td>{rule.notes ?? '—'}</td>
                        <td><button className="btn btn-ghost" type="button" disabled={busy} onClick={() => deleteRule(rule)}>Delete</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'caching' && (
        <section className="card">
          <h2>Cache purge</h2>
          <div className="field">
            <label htmlFor="purge-urls">URLs to purge (one per line)</label>
            <textarea id="purge-urls" rows={3} value={purgeUrls} onChange={(e) => setPurgeUrls(e.target.value)} placeholder={`https://${service?.zoneName ?? 'zone.example'}/page`} />
          </div>
          <div className="row row-wrap">
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => purge(true)}>Purge everything</button>
            <button className="btn btn-ghost" type="button" disabled={busy || !purgeUrls.trim()} onClick={() => purge(false)}>Purge listed URLs</button>
          </div>
        </section>
      )}

      {tab === 'dnssec' && (
        <section className="card">
          <h2>DNSSEC</h2>
          {dnssec === null ? <p className="muted">Loading DNSSEC state…</p> : (
            <dl className="detail-list">
              <dt>Status</dt><dd>{dnssec.status ?? '—'}</dd>
              <dt>DS record</dt><dd className="mono">{dnssec.dsRecord ?? 'Not issued yet'}</dd>
              <dt>Key tag</dt><dd>{dnssec.keyTag ?? '—'}</dd>
              <dt>Algorithm</dt><dd>{dnssec.algorithm ?? '—'}</dd>
              {registrarNotice && (<><dt>Registrar</dt><dd>{registrarNotice}</dd></>)}
            </dl>
          )}
          <div className="row row-wrap" style={{ marginTop: 16 }}>
            <button className="btn btn-primary" type="button" disabled={busy} onClick={() => dnssecAction('enable')}>Enable DNSSEC</button>
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => dnssecAction('disable')}>Disable DNSSEC</button>
          </div>
        </section>
      )}

      {tab === 'analytics' && (
        <section className="card">
          <h2>Zone analytics</h2>
          {analytics === null ? <p className="muted">Loading analytics…</p> : (
            <>
              <p className="muted">
                {analytics.range}-day range · data status {analytics.dataStatus}
                {analytics.missingDays ? ` · ${analytics.missingDays} day(s) with no recorded datapoints` : ''}
              </p>
              <dl className="detail-list">
                {Object.entries(analytics.analytics?.totals ?? {}).map(([key, value]) => (
                  <React.Fragment key={key}>
                    <dt>{key}</dt><dd>{value === null ? 'no datapoints' : String(value)}</dd>
                  </React.Fragment>
                ))}
              </dl>
            </>
          )}
        </section>
      )}

      {tab === 'plan' && (
        <section className="card">
          <h2>Plan</h2>
          {plan === null ? <p className="muted">Loading plan…</p> : (
            <>
              <p className="muted">
                Current: {plan.current.planName ?? plan.current.cloudflarePlan ?? 'unknown'}
                {' · '}changes {plan.planChangeAllowed ? 'allowed' : 'not allowed on this plan'}
              </p>
              {(plan.options ?? []).length === 0 ? (
                <p className="muted">No other plans available.</p>
              ) : (
                <form onSubmit={changePlan}>
                  <div className="grid-2">
                    <div className="field">
                      <label htmlFor="new-plan">New plan</label>
                      <select id="new-plan" name="newPlanId" required>
                        {plan.options.map((o) => <option key={o.planId} value={o.planId}>{o.planName ?? o.cloudflarePlan}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="billing-period">Billing period</label>
                      <select id="billing-period" name="billingPeriod" required>
                        {['one_time', 'monthly', 'quarterly', 'semi_annually', 'annually'].map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={busy || !plan.planChangeAllowed}>
                    {busy ? 'Changing…' : 'Change plan'}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'activity' && (
        <section className="card">
          <h2>Activity</h2>
          {activity === null ? <p className="muted">Loading activity…</p> : activity.length === 0 ? (
            <p className="muted">No recorded activity for this service yet.</p>
          ) : (
            <ul className="list">
              {activity.map((entry, i) => (
                <li key={`${entry.action}-${i}`}>
                  <strong>{entry.action}</strong>
                  <span className="muted"> · {entry.created_at ? new Date(entry.created_at).toLocaleString() : '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
