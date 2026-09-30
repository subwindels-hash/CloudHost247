/**
 * Customer Cloudflare service dashboard (spec §27, §50): tabbed Overview / DNS / DNSSEC /
 * Analytics / SSL / Firewall / Speed / Caching / Scrape Shield / Plan / Activity. Tabs are
 * filtered by the plan's entitlements returned by the server (which enforces them again on
 * every call).
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RgBadge, RgLoad, RgTable, formatDateTime } from '../../components/revenue-guardian/rg-widgets';
import { cfSend, useCfData, type CfEntitlements, type CloudflareServiceDTO } from '../../lib/cloudflare-api';

const TABS: Array<{ id: string; label: string; feature: string | null }> = [
  { id: 'overview', label: 'Overview', feature: null },
  { id: 'dns', label: 'DNS', feature: 'dns' },
  { id: 'dnssec', label: 'DNSSEC', feature: 'dnssec' },
  { id: 'analytics', label: 'Analytics', feature: 'analytics' },
  { id: 'ssl', label: 'SSL / TLS', feature: 'ssl' },
  { id: 'firewall', label: 'Firewall', feature: 'firewall' },
  { id: 'speed', label: 'Speed', feature: 'speed' },
  { id: 'caching', label: 'Caching', feature: 'caching' },
  { id: 'scrape-shield', label: 'Scrape Shield', feature: 'scrape_shield' },
  { id: 'plan', label: 'Plan', feature: null },
  { id: 'activity', label: 'Activity', feature: null },
];

interface ServiceDetail {
  service: CloudflareServiceDTO;
  entitlements: CfEntitlements;
  nameservers: string[];
  nameserverNotice: string;
}

export default function CloudflareServicePage() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const activeTab = tab ?? 'overview';
  const { state, reload } = useCfData<ServiceDetail>(`/api/v1/cloudflare/services/${id}`);
  const [notice, setNotice] = useState('');

  async function act(fn: () => Promise<unknown>, successMessage: string) {
    setNotice('');
    try {
      await fn();
      setNotice(successMessage);
      reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Action failed');
    }
  }

  return (
    <div className="ch247-stack">
      <RgLoad state={state}>
        {({ service, entitlements, nameservers, nameserverNotice }) => {
          const visibleTabs = TABS.filter((t) => !t.feature || entitlements[t.feature]);
          return (
            <>
              <div className="ch247-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'baseline' }}>
                  <div>
                    <h1>{service.zone_name}</h1>
                    <p className="ch247-page__hint">
                      <Link to="/services/cloudflare">← Cloudflare services</Link> · {service.plan_name} · Cloudflare {service.cloudflare_plan}
                    </p>
                  </div>
                  <div className="ch247-inline-actions">
                    <RgBadge value={service.status} />
                    <RgBadge value={service.activation_status === 'active' ? 'active' : 'pending'} />
                    <button type="button" onClick={() => act(() => cfSend('POST', `/api/v1/cloudflare/services/${service.id}/sync`), 'Synchronization queued.')}>Sync</button>
                  </div>
                </div>
                <nav className="ch247-inline-actions" style={{ flexWrap: 'wrap', marginTop: '0.5rem' }}>
                  {visibleTabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      style={{ fontWeight: activeTab === t.id ? 700 : 400 }}
                      onClick={() => navigate(`/services/cloudflare/${service.id}${t.id === 'overview' ? '' : `/${t.id}`}`)}
                    >
                      {t.label}
                    </button>
                  ))}
                </nav>
                {notice ? <p className="ch247-page__hint" role="status">{notice}</p> : null}
              </div>

              <div className="ch247-card">
                {activeTab === 'overview' ? <OverviewTab service={service} nameservers={nameservers} notice={nameserverNotice} /> : null}
                {activeTab === 'dns' ? <DnsTab serviceId={service.id} zoneName={service.zone_name} /> : null}
                {activeTab === 'dnssec' ? <DnssecTab serviceId={service.id} /> : null}
                {activeTab === 'analytics' ? <AnalyticsTab serviceId={service.id} /> : null}
                {['ssl', 'firewall', 'speed', 'caching', 'scrape-shield'].includes(activeTab) ? (
                  <SettingsTab serviceId={service.id} tab={activeTab} zoneName={service.zone_name} entitlements={entitlements} />
                ) : null}
                {activeTab === 'plan' ? <PlanTab serviceId={service.id} /> : null}
                {activeTab === 'activity' ? <ActivityTab serviceId={service.id} /> : null}
              </div>
            </>
          );
        }}
      </RgLoad>
    </div>
  );
}

function OverviewTab({ service, nameservers, notice }: { service: CloudflareServiceDTO; nameservers: string[]; notice: string }) {
  return (
    <div className="ch247-stack">
      <h2>Overview</h2>
      <div className="ch247-table-wrap">
        <table className="ch247-table">
          <tbody>
            <tr><th>Status</th><td><RgBadge value={service.status} /></td><th>Zone activation</th><td>{service.activation_status.replace(/_/g, ' ')}</td></tr>
            <tr><th>Cloudflare plan</th><td>{service.cloudflare_plan}</td><th>SSL mode</th><td>{service.ssl_mode ?? '—'}</td></tr>
            <tr><th>DNS records</th><td>{service.dns_record_count}</td><th>Last synchronized</th><td>{formatDateTime(service.last_synced_at)}</td></tr>
            {service.last_error_code ? (
              <tr><th>Last error</th><td colSpan={3}>{service.last_error_code}: {service.last_error_message}</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <h3>Cloudflare nameservers</h3>
      {nameservers.length === 0 ? (
        <p className="ch247-page__hint">Nameservers will appear here once the zone has been provisioned.</p>
      ) : (
        <div className="ch247-stack">
          {nameservers.map((ns, i) => (
            <div key={ns} className="ch247-inline-actions">
              <span className="ch247-page__hint">Nameserver {i + 1}:</span>
              <code>{ns}</code>
              <button type="button" onClick={() => void navigator.clipboard.writeText(ns)}>Copy</button>
            </div>
          ))}
          <p className="ch247-page__hint">{notice}</p>
          <p className="ch247-page__hint">Nameserver status: <RgBadge value={service.activation_status === 'active' ? 'active' : 'pending'} /></p>
        </div>
      )}
    </div>
  );
}

interface DnsRecord {
  cloudflare_record_id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied: boolean;
  priority: number | null;
  comment: string | null;
  ownership: string;
  updated_at: string;
}

function DnsTab({ serviceId, zoneName }: { serviceId: string; zoneName: string }) {
  const { state, reload } = useCfData<{ records: DnsRecord[]; note: string }>(`/api/v1/cloudflare/services/${serviceId}/dns`);
  const [form, setForm] = useState({ type: 'A', name: zoneName, content: '', ttl: '1', proxied: true, priority: '' });
  const [error, setError] = useState('');

  async function createRecord() {
    setError('');
    try {
      await cfSend('POST', `/api/v1/cloudflare/services/${serviceId}/dns`, {
        type: form.type,
        name: form.name,
        content: form.content,
        ttl: Number(form.ttl),
        proxied: form.proxied,
        priority: form.priority ? Number(form.priority) : undefined,
      });
      setForm({ ...form, content: '' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function deleteRecord(record: DnsRecord) {
    if (!window.confirm(`Delete DNS record?\n\n${record.type} ${record.name} → ${record.content}\n\nThis action will remove the record from Cloudflare.`)) return;
    setError('');
    try {
      await cfSend('DELETE', `/api/v1/cloudflare/services/${serviceId}/dns/${record.cloudflare_record_id}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function editRecord(record: DnsRecord) {
    const content = window.prompt(`New content for ${record.type} ${record.name}:`, record.content);
    if (content === null || content === record.content) return;
    setError('');
    try {
      await cfSend('PATCH', `/api/v1/cloudflare/services/${serviceId}/dns/${record.cloudflare_record_id}`, { content });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  return (
    <div className="ch247-stack">
      <h2>DNS Records</h2>
      {error ? <p className="ch247-page__hint" role="alert">Error: {error}</p> : null}
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="Content" value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} style={{ minWidth: '16rem' }} />
        <select value={form.ttl} onChange={(e) => setForm({ ...form, ttl: e.target.value })}>
          <option value="1">TTL: Auto</option>
          {[300, 600, 1800, 3600, 86400].map((t) => <option key={t} value={String(t)}>TTL: {t}s</option>)}
        </select>
        {form.type === 'MX' || form.type === 'SRV' ? (
          <input placeholder="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} style={{ width: '5rem' }} />
        ) : null}
        <label><input type="checkbox" checked={form.proxied} onChange={(e) => setForm({ ...form, proxied: e.target.checked })} /> Proxied</label>
        <button type="button" disabled={!form.content} onClick={createRecord}>Add record</button>
      </div>
      <RgLoad state={state}>
        {({ records, note }) => (
          <>
            <p className="ch247-page__hint">{note}</p>
            <RgTable
              empty="No DNS records cached yet — run Sync after the zone is provisioned."
              columns={[
                { header: 'Type', render: (r: DnsRecord) => r.type },
                { header: 'Name', render: (r) => r.name },
                { header: 'Content', render: (r) => <code style={{ wordBreak: 'break-all' }}>{r.content}</code> },
                { header: 'TTL', render: (r) => (r.ttl === 1 ? 'Auto' : r.ttl) },
                { header: 'Proxy', render: (r) => (r.proxied ? 'Proxied' : 'DNS only') },
                { header: 'Priority', render: (r) => r.priority ?? '—' },
                { header: 'Managed by', render: (r) => (r.ownership === 'SYSTEM_MANAGED' ? 'CloudHost247' : 'You') },
                {
                  header: 'Actions',
                  render: (r) =>
                    r.ownership === 'SYSTEM_MANAGED' ? (
                      <span className="ch247-page__hint">locked</span>
                    ) : (
                      <span className="ch247-inline-actions">
                        <button type="button" onClick={() => editRecord(r)}>Edit</button>
                        <button type="button" onClick={() => deleteRecord(r)}>Delete</button>
                      </span>
                    ),
                },
              ]}
              rows={records}
            />
          </>
        )}
      </RgLoad>
    </div>
  );
}

function DnssecTab({ serviceId }: { serviceId: string }) {
  const { state, reload } = useCfData<{ dnssec: { status: string; ds?: string | null; key_tag?: number | null; algorithm?: string | null; digest?: string | null; digest_type?: string | null } }>(`/api/v1/cloudflare/services/${serviceId}/dnssec`);
  const [error, setError] = useState('');
  async function toggle(action: 'enable' | 'disable') {
    setError('');
    try {
      await cfSend('POST', `/api/v1/cloudflare/services/${serviceId}/dnssec/${action}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }
  return (
    <div className="ch247-stack">
      <h2>DNSSEC</h2>
      {error ? <p className="ch247-page__hint" role="alert">Error: {error}</p> : null}
      <RgLoad state={state}>
        {({ dnssec }) => (
          <>
            <p>Status: <RgBadge value={dnssec.status === 'active' ? 'active' : dnssec.status} /></p>
            {dnssec.ds ? (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <tbody>
                    <tr><th>DS record</th><td><code style={{ wordBreak: 'break-all' }}>{dnssec.ds}</code></td></tr>
                    <tr><th>Key tag</th><td>{dnssec.key_tag ?? '—'}</td><th>Algorithm</th><td>{dnssec.algorithm ?? '—'}</td></tr>
                    <tr><th>Digest type</th><td>{dnssec.digest_type ?? '—'}</td><th>Digest</th><td><code style={{ wordBreak: 'break-all' }}>{dnssec.digest ?? '—'}</code></td></tr>
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="ch247-inline-actions">
              {dnssec.status === 'active' ? (
                <button type="button" onClick={() => toggle('disable')}>Disable DNSSEC</button>
              ) : (
                <button type="button" onClick={() => toggle('enable')}>Enable DNSSEC</button>
              )}
            </div>
          </>
        )}
      </RgLoad>
    </div>
  );
}

function AnalyticsTab({ serviceId }: { serviceId: string }) {
  const [range, setRange] = useState(7);
  const { state } = useCfData<{ analytics: { totals: Record<string, number | null>; daily: Array<{ date: string; requests: number | null; bytes: number | null; threats: number | null; cachedRequests: number | null }> }; dataStatus: string }>(`/api/v1/cloudflare/services/${serviceId}/analytics`, { range });
  return (
    <div className="ch247-stack">
      <div className="ch247-inline-actions">
        <h2 style={{ marginRight: 'auto' }}>Analytics</h2>
        <select value={range} onChange={(e) => setRange(Number(e.target.value))}>
          <option value={1}>Last 24 hours</option>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      <RgLoad state={state}>
        {({ analytics, dataStatus }) =>
          dataStatus === 'DATA_UNAVAILABLE' ? (
            <p className="ch247-page__hint">DATA_UNAVAILABLE — Cloudflare could not provide analytics for this zone/range.</p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {[
                  ['Requests', analytics.totals['requests']],
                  ['Cached requests', analytics.totals['cachedRequests']],
                  ['Bandwidth (bytes)', analytics.totals['bytes']],
                  ['Cached bytes', analytics.totals['cachedBytes']],
                  ['Threats', analytics.totals['threats']],
                  ['Page views', analytics.totals['pageViews']],
                  ['Unique visitors', analytics.totals['uniques']],
                ].map(([label, value]) => (
                  <div key={String(label)} className="ch247-card" style={{ flex: '1 1 10rem' }}>
                    <p className="ch247-page__hint">{label}</p>
                    <p style={{ fontSize: '1.3rem', fontWeight: 700 }}>{value === null || value === undefined ? 'DATA_UNAVAILABLE' : Number(value).toLocaleString()}</p>
                  </div>
                ))}
              </div>
              <RgTable
                empty="No daily data in this range."
                columns={[
                  { header: 'Date', render: (d: (typeof analytics.daily)[number]) => d.date },
                  { header: 'Requests', render: (d) => d.requests ?? '—' },
                  { header: 'Cached', render: (d) => d.cachedRequests ?? '—' },
                  { header: 'Bytes', render: (d) => d.bytes ?? '—' },
                  { header: 'Threats', render: (d) => d.threats ?? '—' },
                ]}
                rows={analytics.daily}
              />
            </>
          )
        }
      </RgLoad>
    </div>
  );
}

const SETTING_CONTROLS: Record<string, Array<{ id: string; label: string; kind: 'toggle' | 'select' | 'number'; options?: string[] }>> = {
  ssl: [
    { id: 'ssl', label: 'SSL mode', kind: 'select', options: ['off', 'flexible', 'full', 'strict'] },
    { id: 'min_tls_version', label: 'Minimum TLS version', kind: 'select', options: ['1.0', '1.1', '1.2', '1.3'] },
    { id: 'tls_1_3', label: 'TLS 1.3', kind: 'toggle' },
    { id: 'always_use_https', label: 'Always use HTTPS', kind: 'toggle' },
    { id: 'automatic_https_rewrites', label: 'Automatic HTTPS rewrites', kind: 'toggle' },
  ],
  firewall: [
    { id: 'security_level', label: 'Security level', kind: 'select', options: ['essentially_off', 'low', 'medium', 'high', 'under_attack'] },
    { id: 'browser_check', label: 'Browser integrity check', kind: 'toggle' },
    { id: 'challenge_ttl', label: 'Challenge TTL (seconds)', kind: 'number' },
  ],
  speed: [
    { id: 'rocket_loader', label: 'Rocket Loader', kind: 'toggle' },
    { id: 'brotli', label: 'Brotli compression', kind: 'toggle' },
    { id: 'http3', label: 'HTTP/3 (QUIC)', kind: 'toggle' },
    { id: 'early_hints', label: 'Early Hints', kind: 'toggle' },
    { id: 'ip_geolocation', label: 'IP geolocation header', kind: 'toggle' },
  ],
  caching: [
    { id: 'cache_level', label: 'Cache level', kind: 'select', options: ['aggressive', 'basic', 'simplified'] },
    { id: 'browser_cache_ttl', label: 'Browser cache TTL (seconds)', kind: 'number' },
    { id: 'development_mode', label: 'Development mode', kind: 'toggle' },
  ],
  'scrape-shield': [
    { id: 'email_obfuscation', label: 'Email address obfuscation', kind: 'toggle' },
    { id: 'server_side_exclude', label: 'Server-side excludes', kind: 'toggle' },
    { id: 'hotlink_protection', label: 'Hotlink protection', kind: 'toggle' },
  ],
};

interface FirewallRule {
  id: string;
  mode: string;
  notes?: string;
  configuration: { target: string; value: string };
}

function SettingsTab({ serviceId, tab, zoneName, entitlements }: { serviceId: string; tab: string; zoneName: string; entitlements: CfEntitlements }) {
  const { state, reload } = useCfData<{ settings: Record<string, unknown>; rules?: FirewallRule[]; modes?: string[] }>(`/api/v1/cloudflare/services/${serviceId}/${tab}`);
  const [error, setError] = useState('');
  const [ruleForm, setRuleForm] = useState({ value: '', mode: 'block', notes: '' });
  const [purgeUrls, setPurgeUrls] = useState('');
  const controls = SETTING_CONTROLS[tab] ?? [];

  async function patch(settingId: string, value: unknown) {
    setError('');
    try {
      await cfSend('PATCH', `/api/v1/cloudflare/services/${serviceId}/${tab}`, { [settingId]: value });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function purge(everything: boolean) {
    if (everything && !window.confirm('Purge everything? All cached content for this zone will be removed from Cloudflare.')) return;
    setError('');
    try {
      const files = purgeUrls.split('\n').map((u) => u.trim()).filter(Boolean);
      await cfSend('POST', `/api/v1/cloudflare/services/${serviceId}/caching/purge`, everything ? { everything: true } : { files });
      setPurgeUrls('');
      setError(everything ? 'Cache fully purged.' : `${files.length} URL(s) purged.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purge failed');
    }
  }

  async function addRule() {
    setError('');
    try {
      await cfSend('POST', `/api/v1/cloudflare/services/${serviceId}/firewall/rules`, ruleForm);
      setRuleForm({ value: '', mode: 'block', notes: '' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rule failed');
    }
  }

  async function deleteRule(ruleId: string) {
    if (!window.confirm('Delete this firewall rule?')) return;
    try {
      await cfSend('DELETE', `/api/v1/cloudflare/services/${serviceId}/firewall/rules/${ruleId}`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <div className="ch247-stack">
      <h2>{TABS.find((t) => t.id === tab)?.label}</h2>
      {tab === 'caching' ? <p className="ch247-page__hint">Development Mode temporarily bypasses the Cloudflare cache (auto-expires after ~3 hours at Cloudflare).</p> : null}
      {error ? <p className="ch247-page__hint" role="status">{error}</p> : null}
      <RgLoad state={state}>
        {({ settings, rules }) => (
          <>
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <tbody>
                  {controls.map((control) => {
                    const value = settings[control.id];
                    return (
                      <tr key={control.id}>
                        <th>{control.label}</th>
                        <td>{value === null || value === undefined ? <span className="ch247-page__hint">FEATURE_NOT_SUPPORTED on this zone</span> : String(value)}</td>
                        <td>
                          {value === null || value === undefined ? null : control.kind === 'toggle' ? (
                            <button type="button" onClick={() => patch(control.id, value === 'on' ? 'off' : 'on')}>
                              Turn {value === 'on' ? 'off' : 'on'}
                            </button>
                          ) : control.kind === 'select' ? (
                            <select value={String(value)} onChange={(e) => patch(control.id, e.target.value)}>
                              {(control.options ?? []).map((o) => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
                            </select>
                          ) : (
                            <input
                              type="number"
                              defaultValue={Number(value)}
                              onBlur={(e) => Number(e.target.value) !== Number(value) && patch(control.id, Number(e.target.value))}
                              style={{ width: '8rem' }}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {tab === 'caching' && entitlements['cache_purge'] ? (
              <div className="ch247-stack">
                <h3>Purge cache</h3>
                <div className="ch247-inline-actions">
                  <button type="button" onClick={() => purge(true)}>Purge everything</button>
                </div>
                <textarea
                  placeholder={`https://${zoneName}/file.css\nhttps://${zoneName}/image.jpg`}
                  value={purgeUrls}
                  onChange={(e) => setPurgeUrls(e.target.value)}
                  rows={3}
                  style={{ maxWidth: '32rem' }}
                />
                <div className="ch247-inline-actions">
                  <button type="button" disabled={!purgeUrls.trim()} onClick={() => purge(false)}>Purge listed URLs</button>
                </div>
              </div>
            ) : null}

            {tab === 'firewall' && rules ? (
              <div className="ch247-stack">
                <h3>IP access rules</h3>
                <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                  <input placeholder="IP or CIDR (e.g. 198.51.100.0/24)" value={ruleForm.value} onChange={(e) => setRuleForm({ ...ruleForm, value: e.target.value })} style={{ minWidth: '16rem' }} />
                  <select value={ruleForm.mode} onChange={(e) => setRuleForm({ ...ruleForm, mode: e.target.value })}>
                    {['block', 'challenge', 'managed_challenge', 'js_challenge', 'whitelist'].map((m) => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                  </select>
                  <input placeholder="Description" value={ruleForm.notes} onChange={(e) => setRuleForm({ ...ruleForm, notes: e.target.value })} />
                  <button type="button" disabled={!ruleForm.value} onClick={addRule}>Add rule</button>
                </div>
                <RgTable
                  empty="No IP access rules."
                  columns={[
                    { header: 'Target', render: (r: FirewallRule) => `${r.configuration.target}: ${r.configuration.value}` },
                    { header: 'Action', render: (r) => r.mode.replace(/_/g, ' ') },
                    { header: 'Description', render: (r) => r.notes ?? '—' },
                    { header: 'Actions', render: (r) => <button type="button" onClick={() => deleteRule(r.id)}>Delete</button> },
                  ]}
                  rows={rules}
                />
              </div>
            ) : null}
          </>
        )}
      </RgLoad>
    </div>
  );
}

interface PlanInfo {
  current: { planId: string; planName: string; cloudflarePlan: string };
  planChangeAllowed: boolean;
  options: Array<{ planId: string; planName: string; cloudflarePlan: string; pricing: Array<{ billingPeriod: string; amount: string; currency: string }> }>;
}

function PlanTab({ serviceId }: { serviceId: string }) {
  const { state, reload } = useCfData<PlanInfo>(`/api/v1/cloudflare/services/${serviceId}/plan`);
  const [message, setMessage] = useState('');
  async function change(newPlanId: string, billingPeriod: string) {
    setMessage('');
    try {
      const res = await cfSend<{ message: string }>('POST', `/api/v1/cloudflare/services/${serviceId}/plan/change`, { newPlanId, billingPeriod });
      setMessage(res.message);
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Plan change failed');
    }
  }
  return (
    <div className="ch247-stack">
      <h2>Plan</h2>
      {message ? <p className="ch247-page__hint" role="status">{message}</p> : null}
      <RgLoad state={state}>
        {(data) => (
          <>
            <p>Current plan: <strong>{data.current.planName}</strong> (Cloudflare {data.current.cloudflarePlan})</p>
            {!data.planChangeAllowed ? <p className="ch247-page__hint">Plan changes are not available for this service.</p> : (
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {data.options.map((option) => (
                  <div key={option.planId} className="ch247-card" style={{ flex: '1 1 14rem' }}>
                    <h3>{option.planName}</h3>
                    <p className="ch247-page__hint">Cloudflare {option.cloudflarePlan}</p>
                    {option.pricing.map((p) => (
                      <div key={p.billingPeriod} className="ch247-inline-actions">
                        <span>{p.amount} {p.currency} / {p.billingPeriod.replace(/_/g, ' ')}</span>
                        <button type="button" onClick={() => change(option.planId, p.billingPeriod)}>Switch</button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <p className="ch247-page__hint">Upgrades are invoiced first; the Cloudflare plan changes only after payment is confirmed.</p>
          </>
        )}
      </RgLoad>
    </div>
  );
}

function ActivityTab({ serviceId }: { serviceId: string }) {
  const { state } = useCfData<{ activity: Array<{ action: string; created_at: string; metadata: Record<string, unknown> }> }>(`/api/v1/cloudflare/services/${serviceId}/activity`);
  return (
    <div className="ch247-stack">
      <h2>Activity</h2>
      <RgLoad state={state}>
        {({ activity }) => (
          <RgTable
            empty="No recorded activity yet."
            columns={[
              { header: 'When', render: (a: { created_at: string }) => formatDateTime(a.created_at) },
              { header: 'Action', render: (a: { action: string }) => a.action.replace('cloudflare.', '').replace(/_/g, ' ') },
              { header: 'Details', render: (a: { metadata: Record<string, unknown> }) => JSON.stringify(a.metadata ?? {}) },
            ]}
            rows={activity}
          />
        )}
      </RgLoad>
    </div>
  );
}
