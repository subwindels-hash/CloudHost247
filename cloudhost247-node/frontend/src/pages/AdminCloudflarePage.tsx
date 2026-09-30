/**
 * Admin Cloudflare console (spec §28–§29, §51): Overview / Accounts / Products / Services /
 * Jobs & Logs, all against /api/v1/admin/cloudflare/*. API tokens are write-only fields.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { RgBadge, RgLoad, RgTable, Paginator, formatDateTime } from '../components/revenue-guardian/rg-widgets';
import { cfGet, cfSend, useCfData, CF_FEATURE_LABELS, type CloudflareServiceDTO } from '../lib/cloudflare-api';

const TABS = ['overview', 'accounts', 'products', 'services', 'logs'] as const;

export default function AdminCloudflarePage() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const activeTab = (TABS as readonly string[]).includes(tab ?? '') ? (tab as string) : 'overview';
  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Cloudflare</h1>
        <p className="ch247-page__hint">Reseller account, product mappings, zones and services. <Link to="/admin">← Admin</Link></p>
        <nav className="ch247-inline-actions" style={{ flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {TABS.map((t) => (
            <button key={t} type="button" style={{ fontWeight: activeTab === t ? 700 : 400 }} onClick={() => navigate(`/admin/cloudflare${t === 'overview' ? '' : `/${t}`}`)}>
              {t[0]!.toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </div>
      <div className="ch247-card">
        {activeTab === 'overview' ? <OverviewTab /> : null}
        {activeTab === 'accounts' ? <AccountsTab /> : null}
        {activeTab === 'products' ? <ProductsTab /> : null}
        {activeTab === 'services' ? <ServicesTab /> : null}
        {activeTab === 'logs' ? <LogsTab /> : null}
      </div>
    </div>
  );
}

function OverviewTab() {
  const { state } = useCfData<{ stats: Record<string, string>; planDistribution: Array<{ cloudflare_plan: string; count: string }>; accounts: Array<{ account_name: string; status: string; last_success_at: string | null; last_error: string | null }> }>('/api/v1/admin/cloudflare');
  return (
    <RgLoad state={state}>
      {({ stats, planDistribution, accounts }) => (
        <div className="ch247-stack">
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            {[
              ['Cloudflare services', stats['total_services']],
              ['Active services', stats['active_services']],
              ['Active zones', stats['active_zones']],
              ['Provisioning', stats['provisioning']],
              ['Suspended', stats['suspended']],
              ['Failed', stats['failed']],
              ['Jobs queued', stats['jobs_queued']],
              ['Job failures (7d)', stats['jobs_failed_7d']],
              ['API errors (24h)', stats['api_errors_24h']],
            ].map(([label, value]) => (
              <div key={String(label)} className="ch247-card" style={{ flex: '1 1 10rem' }}>
                <p className="ch247-page__hint">{label}</p>
                <p style={{ fontSize: '1.4rem', fontWeight: 700 }}>{value ?? 0}</p>
              </div>
            ))}
          </div>
          <p className="ch247-page__hint">Last zone sync: {formatDateTime(stats['last_sync'] ?? null)} · Paid Cloudflare revenue this month: {JSON.stringify(stats['monthly_revenue'] ?? {})}</p>
          <h3>Plan distribution</h3>
          <RgTable
            empty="No Cloudflare services yet."
            columns={[
              { header: 'Cloudflare plan', render: (r: { cloudflare_plan: string }) => r.cloudflare_plan },
              { header: 'Services', render: (r: { count: string }) => r.count },
            ]}
            rows={planDistribution}
          />
          <h3>Accounts</h3>
          <RgTable
            empty="No Cloudflare account configured — add one under Accounts."
            columns={[
              { header: 'Name', render: (a: (typeof accounts)[number]) => a.account_name },
              { header: 'Status', render: (a) => <RgBadge value={a.status} /> },
              { header: 'Last success', render: (a) => formatDateTime(a.last_success_at) },
              { header: 'Last error', render: (a) => a.last_error ?? '—' },
            ]}
            rows={accounts}
          />
        </div>
      )}
    </RgLoad>
  );
}

interface AccountDTO {
  id: string;
  account_name: string;
  cloudflare_account_id: string;
  api_base_url: string;
  status: string;
  has_token: boolean;
  last_connection_test_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

function AccountsTab() {
  const { state, reload } = useCfData<{ accounts: AccountDTO[] }>('/api/v1/admin/cloudflare/accounts');
  const [form, setForm] = useState({ accountName: '', cloudflareAccountId: '', apiToken: '' });
  const [message, setMessage] = useState('');
  const [testResult, setTestResult] = useState<Record<string, unknown> | null>(null);

  async function create() {
    setMessage('');
    try {
      await cfSend('POST', '/api/v1/admin/cloudflare/accounts', form);
      setForm({ accountName: '', cloudflareAccountId: '', apiToken: '' });
      setMessage('Account saved. The API token is encrypted at rest and never shown again.');
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function test(id: string) {
    setTestResult(null);
    try {
      setTestResult(await cfSend<Record<string, unknown>>('POST', `/api/v1/admin/cloudflare/accounts/${id}/test`));
    } catch (err) {
      setTestResult({ status: 'ERROR', error: err instanceof Error ? err.message : 'Test failed' });
    }
  }

  async function rotateToken(id: string) {
    const token = window.prompt('New Cloudflare API token (write-only, encrypted at rest):');
    if (!token) return;
    await cfSend('PATCH', `/api/v1/admin/cloudflare/accounts/${id}`, { apiToken: token });
    setMessage('Token rotated.');
    reload();
  }

  return (
    <div className="ch247-stack">
      <h2>Cloudflare accounts</h2>
      {message ? <p className="ch247-page__hint" role="status">{message}</p> : null}
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
        <input placeholder="Account name" value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} />
        <input placeholder="Cloudflare Account ID" value={form.cloudflareAccountId} onChange={(e) => setForm({ ...form, cloudflareAccountId: e.target.value })} style={{ minWidth: '18rem' }} />
        <input placeholder="API token" type="password" value={form.apiToken} onChange={(e) => setForm({ ...form, apiToken: e.target.value })} style={{ minWidth: '18rem' }} />
        <button type="button" disabled={!form.accountName || !form.cloudflareAccountId || !form.apiToken} onClick={create}>Add account</button>
      </div>
      <p className="ch247-page__hint">Required token permissions: Zone.Zone (Edit), Zone.DNS (Edit), Zone.Zone Settings (Edit), Zone.Cache Purge (Purge), Zone.Analytics (Read), Account.Account Settings (Read).</p>
      <RgLoad state={state}>
        {({ accounts }) => (
          <RgTable
            empty="No accounts configured."
            columns={[
              { header: 'Name', render: (a: AccountDTO) => a.account_name },
              { header: 'Account ID', render: (a) => a.cloudflare_account_id },
              { header: 'Status', render: (a) => <RgBadge value={a.status} /> },
              { header: 'Token', render: (a) => (a.has_token ? 'Stored (encrypted)' : 'Missing') },
              { header: 'Last test', render: (a) => formatDateTime(a.last_connection_test_at) },
              { header: 'Last success', render: (a) => formatDateTime(a.last_success_at) },
              { header: 'Last error', render: (a) => a.last_error ?? '—' },
              {
                header: 'Actions',
                render: (a) => (
                  <span className="ch247-inline-actions">
                    <button type="button" onClick={() => test(a.id)}>Test connection</button>
                    <button type="button" onClick={() => rotateToken(a.id)}>Rotate token</button>
                    <button type="button" onClick={() => cfSend('PATCH', `/api/v1/admin/cloudflare/accounts/${a.id}`, { status: a.status === 'active' ? 'disabled' : 'active' }).then(reload)}>
                      {a.status === 'active' ? 'Disable' : 'Enable'}
                    </button>
                  </span>
                ),
              },
            ]}
            rows={accounts}
          />
        )}
      </RgLoad>
      {testResult ? (
        <div className="ch247-card">
          <h3>Connection test</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(testResult, null, 2)}</pre>
        </div>
      ) : null}
    </div>
  );
}

interface MappingDTO {
  id: string;
  plan_id: string;
  plan_name: string;
  product_name: string | null;
  cloudflare_plan: string;
  entitlements: Record<string, boolean>;
  provisioning_mode: string;
}

function ProductsTab() {
  const { state, reload } = useCfData<{ mappings: MappingDTO[]; featureKeys: string[] }>('/api/v1/admin/cloudflare/plan-mappings');
  const [plans, setPlans] = useState<Array<{ id: string; name: string; product_name?: string }>>([]);
  const [form, setForm] = useState<{ planId: string; cloudflarePlan: string; entitlements: Record<string, boolean> }>({ planId: '', cloudflarePlan: 'free', entitlements: {} });
  const [message, setMessage] = useState('');

  useEffect(() => {
    cfGet<{ plans: Array<{ id: string; name: string; product_name?: string }> }>('/api/v1/admin/cloudflare/available-plans')
      .then((res) => setPlans(res.plans))
      .catch(() => setPlans([]));
  }, []);

  async function save() {
    setMessage('');
    try {
      await cfSend('PUT', '/api/v1/admin/cloudflare/plan-mappings', form);
      setMessage('Mapping saved.');
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Save failed');
    }
  }

  return (
    <div className="ch247-stack">
      <h2>Product ↔ Cloudflare plan mappings</h2>
      <p className="ch247-page__hint">Map an existing catalog plan (created under the normal catalog admin, with its own pricing) to a Cloudflare tier and choose exactly which features its customers get.</p>
      {message ? <p className="ch247-page__hint" role="status">{message}</p> : null}
      <RgLoad state={state}>
        {({ mappings, featureKeys }) => (
          <>
            <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
              {plans.length > 0 ? (
                <select value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
                  <option value="">Catalog plan…</option>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.product_name ? `${p.product_name} — ` : ''}{p.name}</option>)}
                </select>
              ) : (
                <input placeholder="Catalog plan ID (uuid)" value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })} style={{ minWidth: '19rem' }} />
              )}
              <select value={form.cloudflarePlan} onChange={(e) => setForm({ ...form, cloudflarePlan: e.target.value })}>
                {['free', 'pro', 'business', 'enterprise'].map((p) => <option key={p} value={p}>Cloudflare {p}</option>)}
              </select>
              <button type="button" disabled={!form.planId} onClick={save}>Save mapping</button>
            </div>
            <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
              {featureKeys.map((key) => (
                <label key={key} style={{ fontSize: '0.85rem' }}>
                  <input
                    type="checkbox"
                    checked={form.entitlements[key] ?? true}
                    onChange={(e) => setForm({ ...form, entitlements: { ...form.entitlements, [key]: e.target.checked } })}
                  />{' '}
                  {CF_FEATURE_LABELS[key] ?? key}
                </label>
              ))}
            </div>
            <RgTable
              empty="No Cloudflare plan mappings yet."
              columns={[
                { header: 'Catalog plan', render: (m: MappingDTO) => `${m.product_name ? `${m.product_name} — ` : ''}${m.plan_name}` },
                { header: 'Cloudflare plan', render: (m) => m.cloudflare_plan },
                { header: 'Provisioning', render: (m) => m.provisioning_mode },
                { header: 'Enabled features', render: (m) => Object.entries(m.entitlements).filter(([, v]) => v).map(([k]) => k).join(', ') || 'tier defaults' },
                { header: 'Disabled features', render: (m) => Object.entries(m.entitlements).filter(([, v]) => v === false).map(([k]) => k).join(', ') || '—' },
                { header: 'Actions', render: (m) => <button type="button" onClick={() => cfSend('DELETE', `/api/v1/admin/cloudflare/plan-mappings/${m.id}`).then(reload)}>Remove</button> },
              ]}
              rows={mappings}
            />
          </>
        )}
      </RgLoad>
    </div>
  );
}

function ServicesTab() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const { state, reload } = useCfData<{ items: CloudflareServiceDTO[]; total: number; page: number; limit: number }>('/api/v1/admin/cloudflare/services', { page, limit: 25, status: status || undefined, search: search || undefined });
  const [message, setMessage] = useState('');

  async function action(serviceId: string, name: string) {
    if ((name === 'terminate' || name === 'purge-cache') && !window.confirm(`Confirm ${name.replace('-', ' ')}?`)) return;
    setMessage('');
    try {
      await cfSend('POST', `/api/v1/admin/cloudflare/services/${serviceId}/${name}`);
      setMessage(`${name} requested.`);
      reload();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Action failed');
    }
  }

  return (
    <div className="ch247-stack">
      <h2>Cloudflare services &amp; zones</h2>
      {message ? <p className="ch247-page__hint" role="status">{message}</p> : null}
      <div className="ch247-inline-actions">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Any status</option>
          {['pending', 'provisioning', 'active', 'suspended', 'provisioning_failed', 'sync_failed', 'terminating', 'terminated'].map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <input placeholder="Search customer / zone" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No Cloudflare services."
              columns={[
                { header: 'Zone', render: (s: CloudflareServiceDTO) => <>{s.zone_name} <span className="ch247-page__hint">{s.zone_id ?? 'no zone yet'}</span></> },
                { header: 'Customer', render: (s) => s.customer_email ?? '—' },
                { header: 'Plan', render: (s) => `${s.plan_name} (${s.cloudflare_plan})` },
                { header: 'Status', render: (s) => <RgBadge value={s.status} /> },
                { header: 'Zone state', render: (s) => s.activation_status.replace(/_/g, ' ') },
                { header: 'Last synced', render: (s) => formatDateTime(s.last_synced_at) },
                { header: 'Last error', render: (s) => (s.last_error_code ? `${s.last_error_code}` : '—') },
                {
                  header: 'Actions',
                  render: (s) => (
                    <span className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                      {['pending', 'provisioning_failed'].includes(s.status) ? <button type="button" onClick={() => action(s.id, 'provision')}>Provision</button> : null}
                      {s.zone_id ? <button type="button" onClick={() => action(s.id, 'sync')}>Sync</button> : null}
                      {s.status === 'active' ? <button type="button" onClick={() => action(s.id, 'suspend')}>Suspend</button> : null}
                      {s.status === 'suspended' ? <button type="button" onClick={() => action(s.id, 'unsuspend')}>Unsuspend</button> : null}
                      {s.zone_id && s.status === 'active' ? <button type="button" onClick={() => action(s.id, 'purge-cache')}>Purge cache</button> : null}
                      {s.status !== 'terminated' ? <button type="button" onClick={() => action(s.id, 'terminate')}>Terminate</button> : null}
                    </span>
                  ),
                },
              ]}
              rows={data.items}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </RgLoad>
    </div>
  );
}

function LogsTab() {
  const [page, setPage] = useState(1);
  const jobs = useCfData<{ items: Array<{ id: string; job_type: string; status: string; attempts: number; last_error: string | null; created_at: string; finished_at: string | null }>; total: number; page: number; limit: number }>('/api/v1/admin/cloudflare/jobs', { page: 1, limit: 25 });
  const logs = useCfData<{ items: Array<{ operation: string; method: string; path: string; status_code: number | null; success: boolean; duration_ms: number | null; error_code: string | null; created_at: string }>; total: number; page: number; limit: number }>('/api/v1/admin/cloudflare/logs', { page, limit: 50 });
  return (
    <div className="ch247-stack">
      <h2>Background jobs</h2>
      <RgLoad state={jobs.state}>
        {(data) => (
          <RgTable
            empty="No Cloudflare jobs yet."
            columns={[
              { header: 'Type', render: (j: (typeof data.items)[number]) => j.job_type.replace(/_/g, ' ') },
              { header: 'Status', render: (j) => <RgBadge value={j.status === 'succeeded' ? 'completed' : j.status} /> },
              { header: 'Attempts', render: (j) => j.attempts },
              { header: 'Created', render: (j) => formatDateTime(j.created_at) },
              { header: 'Finished', render: (j) => formatDateTime(j.finished_at) },
              { header: 'Error', render: (j) => j.last_error ?? '—' },
            ]}
            rows={data.items}
          />
        )}
      </RgLoad>
      <h2>API log</h2>
      <RgLoad state={logs.state}>
        {(data) => (
          <>
            <RgTable
              empty="No Cloudflare API calls logged yet."
              columns={[
                { header: 'When', render: (l: (typeof data.items)[number]) => formatDateTime(l.created_at) },
                { header: 'Operation', render: (l) => l.operation },
                { header: 'Request', render: (l) => `${l.method} ${l.path}` },
                { header: 'Status', render: (l) => l.status_code ?? '—' },
                { header: 'OK', render: (l) => <RgBadge value={l.success ? 'active' : 'failed'} /> },
                { header: 'Duration', render: (l) => (l.duration_ms !== null ? `${l.duration_ms} ms` : '—') },
                { header: 'Error', render: (l) => l.error_code ?? '—' },
              ]}
              rows={data.items}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </RgLoad>
    </div>
  );
}
