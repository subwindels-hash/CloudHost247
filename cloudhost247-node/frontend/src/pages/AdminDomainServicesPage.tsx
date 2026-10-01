import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { apiFetch } from '../lib/api';
import { SectionCard, StatusChip, formatDateTime, formatPrice } from '../components/domain-services/ui';
import type { AuctionDto, ClubPlanDto, ExtensionEntry, ReadinessResponse } from '../lib/domain-services-api';

/**
 * Super Admin control room for Domain Services.
 *
 * Providers tab: create provider instances (installed adapters only), write credentials —
 * encrypted server-side with the platform key ring and NEVER echoed back — and run a REAL
 * Test Connection, where the server performs a live authenticated call against the provider
 * (Namecheap balance check, GoDaddy shopper check, RDAP bootstrap, GoValue probe) and stores
 * the honest outcome. `connected` status is only ever set by a successful real test.
 *
 * Extensions tab: sync the TLD catalogue from the registrar and curate the AI Trending badge —
 * an editorial decision per extension, never automatic or hard-coded.
 *
 * Auctions tab: create and manage auctions (pause/resume/cancel/complete). Transfers tab:
 * oversight plus on-demand provider refresh. Club tab: plan lifecycle (draft → published →
 * disabled). Every mutation here is audit-logged server-side.
 */

interface ProviderDto {
  id: string;
  providerKey: string;
  name: string;
  adapterKey: string;
  providerType: 'registrar' | 'rdap' | 'appraisal' | 'auction';
  apiBaseUrl: string | null;
  environment: 'sandbox' | 'production';
  status: 'not_configured' | 'configured' | 'connected' | 'auth_failed' | 'unavailable' | 'disabled';
  capabilities: Record<string, unknown>;
  configuration: Record<string, unknown>;
  credentialNames: string[];
  credentialsConfigured: boolean;
  lastConnectionTestAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OverviewResponse {
  registrations: Record<string, number>;
  transfers: Record<string, number>;
  auctions: Record<string, number>;
  club: Record<string, number>;
  searchesLast24h: number;
  limits: { bulkSearchMaxDomains: number; bulkSearchMaxPerHour: number; whoisLookupsPerHour: number };
}

interface AdminTransferRow {
  id: string;
  domain_name: string;
  current_registrar: string | null;
  status: string;
  provider_status: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  customer_email: string;
  invoice_number: string | null;
  invoice_status: string | null;
}

/** UI-only hints about which credentials each installed adapter reads. The server is the enforcer. */
const ADAPTER_CREDENTIAL_HINTS: Record<string, Array<{ name: string; required: boolean }>> = {
  namecheap: [
    { name: 'apiUser', required: true },
    { name: 'apiKey', required: true },
    { name: 'userName', required: false },
    { name: 'clientIp', required: true },
  ],
  godaddy: [
    { name: 'apiKey', required: true },
    { name: 'apiSecret', required: true },
    { name: 'shopperId', required: false },
  ],
  'godaddy-govalue': [
    { name: 'apiKey', required: true },
    { name: 'apiSecret', required: true },
  ],
  rdap: [],
};

const ADAPTER_LABELS: Record<string, string> = {
  namecheap: 'Namecheap (registrar: search, register, transfer, TLD catalogue)',
  godaddy: 'GoDaddy (registrar: search, register, transfer)',
  rdap: 'RDAP / WHOIS (registry lookup, public bootstrap)',
  'godaddy-govalue': 'GoDaddy GoValue (domain appraisal)',
};

type TabId = 'overview' | 'providers' | 'extensions' | 'auctions' | 'transfers' | 'club';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'providers', label: 'Providers' },
  { id: 'extensions', label: 'Extensions' },
  { id: 'auctions', label: 'Auctions' },
  { id: 'transfers', label: 'Transfers' },
  { id: 'club', label: 'Domain Club' },
];

function toIsoUtc(localValue: string): string | null {
  if (!localValue) return null;
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export default function AdminDomainServicesPage() {
  usePageMeta('Domain Services Admin', 'Providers, extensions, auctions, transfers and club management');
  const [tab, setTab] = useState<TabId>('overview');

  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [providers, setProviders] = useState<ProviderDto[] | null>(null);
  const [installedAdapters, setInstalledAdapters] = useState<string[]>([]);
  const [extensions, setExtensions] = useState<ExtensionEntry[] | null>(null);
  const [auctions, setAuctions] = useState<AuctionDto[] | null>(null);
  const [transfers, setTransfers] = useState<AdminTransferRow[] | null>(null);
  const [plans, setPlans] = useState<ClubPlanDto[] | null>(null);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const loadProviders = useCallback(() => {
    apiFetch<{ providers: ProviderDto[]; installedAdapters: string[] }>('/api/v1/admin/domain-services/providers')
      .then((r) => {
        setProviders(r.providers);
        setInstalledAdapters(r.installedAdapters);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    apiFetch<ReadinessResponse>('/api/v1/domain-services/readiness')
      .then(setReadiness)
      .catch(() => undefined);
    apiFetch<OverviewResponse>('/api/v1/admin/domain-services/overview')
      .then(setOverview)
      .catch((err: Error) => setError(err.message));
    loadProviders();
  }, [loadProviders]);

  const loadExtensions = useCallback(() => {
    apiFetch<{ extensions: ExtensionEntry[] }>('/api/v1/admin/domain-services/extensions')
      .then((r) => setExtensions(r.extensions))
      .catch(() => setExtensions([]));
  }, []);

  const loadAuctions = useCallback(() => {
    apiFetch<{ auctions: AuctionDto[] }>('/api/v1/admin/domain-services/auctions?limit=50')
      .then((r) => setAuctions(r.auctions))
      .catch(() => setAuctions([]));
  }, []);

  const loadTransfers = useCallback(() => {
    apiFetch<{ transfers: AdminTransferRow[] }>('/api/v1/admin/domain-services/transfers?limit=50')
      .then((r) => setTransfers(r.transfers))
      .catch(() => setTransfers([]));
  }, []);

  const loadPlans = useCallback(() => {
    apiFetch<{ plans: ClubPlanDto[] }>('/api/v1/admin/domain-services/club/plans')
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    if (tab === 'extensions' && extensions === null) loadExtensions();
    if (tab === 'auctions' && auctions === null) loadAuctions();
    if (tab === 'transfers' && transfers === null) loadTransfers();
    if (tab === 'club' && plans === null) loadPlans();
  }, [tab, extensions, auctions, transfers, plans, loadExtensions, loadAuctions, loadTransfers, loadPlans]);

  async function runAction(key: string, action: () => Promise<unknown>, successMessage: string, after?: () => void) {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(successMessage);
      after?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The action could not be completed.');
    } finally {
      setBusy('');
    }
  }

  // ------------------------------------------------------------------ provider forms
  const [createProviderOpen, setCreateProviderOpen] = useState(false);
  const [providerForm, setProviderForm] = useState({
    providerKey: '',
    name: '',
    adapterKey: 'namecheap',
    providerType: 'registrar' as ProviderDto['providerType'],
    apiBaseUrl: '',
    environment: 'production' as 'sandbox' | 'production',
  });

  async function createProvider(event: React.FormEvent) {
    event.preventDefault();
    await runAction(
      'create-provider',
      () =>
        apiFetch('/api/v1/admin/domain-services/providers', {
          method: 'POST',
          body: JSON.stringify({
            providerKey: providerForm.providerKey.trim(),
            name: providerForm.name.trim(),
            adapterKey: providerForm.adapterKey,
            providerType: providerForm.providerType,
            apiBaseUrl: providerForm.apiBaseUrl.trim() || null,
            environment: providerForm.environment,
          }),
        }),
      'Provider created. Now write its credentials and run Test Connection.',
      () => {
        setCreateProviderOpen(false);
        setProviderForm({ providerKey: '', name: '', adapterKey: 'namecheap', providerType: 'registrar', apiBaseUrl: '', environment: 'production' });
        loadProviders();
      }
    );
  }

  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, Record<string, string>>>({});

  async function saveCredentials(provider: ProviderDto) {
    const draft = credentialDrafts[provider.id] ?? {};
    const entries = Object.entries(draft).filter(([, value]) => value.trim().length > 0);
    if (entries.length === 0) {
      setError('Enter at least one credential value to store.');
      return;
    }
    await runAction(
      `credentials:${provider.id}`,
      () =>
        apiFetch(`/api/v1/admin/domain-services/providers/${provider.id}/credentials`, {
          method: 'PUT',
          body: JSON.stringify({ credentials: Object.fromEntries(entries) }),
        }),
      'Credentials stored (encrypted). Run Test Connection to verify them against the provider.',
      () => {
        setCredentialDrafts((current) => ({ ...current, [provider.id]: {} }));
        loadProviders();
      }
    );
  }

  async function testConnection(provider: ProviderDto) {
    setBusy(`test:${provider.id}`);
    setError('');
    setNotice('');
    try {
      const response = await apiFetch<{ result: { status: string; message: string } }>(
        `/api/v1/admin/domain-services/providers/${provider.id}/test`,
        { method: 'POST' }
      );
      setNotice(
        response.result.status === 'connected'
          ? `Connection test SUCCEEDED for ${provider.name}: ${response.result.message}`
          : `Connection test FAILED for ${provider.name} (${response.result.status}): ${response.result.message}`
      );
      loadProviders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The connection test could not be run.');
    } finally {
      setBusy('');
    }
  }

  // ------------------------------------------------------------------ extensions
  async function toggleTrending(entry: ExtensionEntry) {
    await runAction(
      `trending:${entry.id}`,
      () =>
        apiFetch(`/api/v1/admin/domain-services/extensions/${entry.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ isTrending: !entry.isTrending }),
        }),
      `${entry.extension} is ${entry.isTrending ? 'no longer marked trending' : 'now marked trending'}.`,
      loadExtensions
    );
  }

  async function syncExtensions() {
    await runAction(
      'sync-extensions',
      () => apiFetch('/api/v1/admin/domain-services/extensions/sync', { method: 'POST' }),
      'Extension catalogue synchronized from the registrar provider.',
      loadExtensions
    );
  }

  // ------------------------------------------------------------------ auctions
  const [auctionForm, setAuctionForm] = useState({
    domainName: '',
    minimumBid: '',
    bidIncrement: '1.00',
    startsAt: '',
    endsAt: '',
  });

  async function createAuction(event: React.FormEvent) {
    event.preventDefault();
    const startsAt = toIsoUtc(auctionForm.startsAt);
    const endsAt = toIsoUtc(auctionForm.endsAt);
    if (!startsAt || !endsAt) {
      setError('Provide both a start and an end time for the auction.');
      return;
    }
    await runAction(
      'create-auction',
      () =>
        apiFetch('/api/v1/admin/domain-services/auctions', {
          method: 'POST',
          body: JSON.stringify({
            domainName: auctionForm.domainName.trim(),
            minimumBid: auctionForm.minimumBid,
            bidIncrement: auctionForm.bidIncrement,
            startsAt,
            endsAt,
          }),
        }),
      'Auction created.',
      () => {
        setAuctionForm({ domainName: '', minimumBid: '', bidIncrement: '1.00', startsAt: '', endsAt: '' });
        loadAuctions();
      }
    );
  }

  async function auctionAction(auctionId: string, action: 'pause' | 'resume' | 'cancel' | 'complete') {
    await runAction(
      `auction:${action}:${auctionId}`,
      () => apiFetch(`/api/v1/admin/domain-services/auctions/${auctionId}/${action}`, { method: 'POST' }),
      `Auction ${action} applied.`,
      loadAuctions
    );
  }

  // ------------------------------------------------------------------ transfers
  async function refreshTransfer(transferId: string) {
    await runAction(
      `refresh:${transferId}`,
      () => apiFetch(`/api/v1/admin/domain-services/transfers/${transferId}/refresh`, { method: 'POST' }),
      'Transfer refreshed from the provider.',
      loadTransfers
    );
  }

  // ------------------------------------------------------------------ club plans
  const [planForm, setPlanForm] = useState({
    name: '',
    description: '',
    billingPeriod: 'monthly' as 'monthly' | 'annually',
    priceAmount: '',
    discountType: 'percentage' as 'percentage' | 'fixed',
    discountValue: '',
    eligibleExtensions: '',
  });

  async function createPlan(event: React.FormEvent) {
    event.preventDefault();
    await runAction(
      'create-plan',
      () =>
        apiFetch('/api/v1/admin/domain-services/club/plans', {
          method: 'POST',
          body: JSON.stringify({
            name: planForm.name.trim(),
            description: planForm.description || null,
            billingPeriod: planForm.billingPeriod,
            priceAmount: planForm.priceAmount,
            discountType: planForm.discountType,
            discountValue: planForm.discountValue,
            eligibleExtensions: planForm.eligibleExtensions
              .split(',')
              .map((extension) => extension.trim().toLowerCase())
              .filter(Boolean),
          }),
        }),
      'Club plan created as a draft. Publish it when the pricing is final.',
      () => {
        setPlanForm({ name: '', description: '', billingPeriod: 'monthly', priceAmount: '', discountType: 'percentage', discountValue: '', eligibleExtensions: '' });
        loadPlans();
      }
    );
  }

  async function setPlanStatus(planId: string, status: 'draft' | 'published' | 'disabled') {
    await runAction(
      `plan:${status}:${planId}`,
      () =>
        apiFetch(`/api/v1/admin/domain-services/club/plans/${planId}`, {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }),
      `Plan set to ${status}.`,
      loadPlans
    );
  }

  const statusCount = (record: Record<string, number> | undefined, status: string) => record?.[status] ?? 0;
  const statusTotal = (record: Record<string, number> | undefined) =>
    Object.values(record ?? {}).reduce((sum, count) => sum + count, 0);

  return (
    <div>
      <div className="ch247-section-heading">
        <div>
          <h1>Domain Services</h1>
          <p className="ch247-page__hint">Providers, extensions, auctions, transfers and the Discount Domain Club.</p>
        </div>
      </div>

      <nav className="ch247-tabs" aria-label="Domain services admin sections">
        {TABS.map((entry) => (
          <button key={entry.id} type="button" className={tab === entry.id ? 'is-active' : ''} onClick={() => setTab(entry.id)}>
            {entry.label}
          </button>
        ))}
      </nav>

      {notice && <p className="ch247-banner ch247-banner--info" role="status">{notice}</p>}
      {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}

      {tab === 'overview' && (
        <>
          <SectionCard title="Provider readiness">
            {readiness && (
              <dl className="ch247-dsvc-facts">
                <div className="ch247-dsvc-fact">
                  <dt>Registrar (search, registrations, transfers)</dt>
                  <dd>
                    {readiness.registrar.configured ? (
                      <span className="ch247-dsvc-status ch247-dsvc-status--completed">Connected — {readiness.registrar.providerKey}</span>
                    ) : (
                      <span className="ch247-dsvc-status ch247-dsvc-status--not_configured">Not configured</span>
                    )}
                  </dd>
                </div>
                <div className="ch247-dsvc-fact">
                  <dt>RDAP / WHOIS lookup</dt>
                  <dd>
                    {readiness.rdap.configured ? (
                      <span className="ch247-dsvc-status ch247-dsvc-status--completed">Connected — {readiness.rdap.providerKey}</span>
                    ) : (
                      <span className="ch247-dsvc-status ch247-dsvc-status--not_configured">Not configured</span>
                    )}
                  </dd>
                </div>
                <div className="ch247-dsvc-fact">
                  <dt>Domain appraisal</dt>
                  <dd>
                    {readiness.appraisal.configured ? (
                      <span className="ch247-dsvc-status ch247-dsvc-status--completed">Connected — {readiness.appraisal.providerKey}</span>
                    ) : (
                      <span className="ch247-dsvc-status ch247-dsvc-status--not_configured">Not configured</span>
                    )}
                  </dd>
                </div>
                <div className="ch247-dsvc-fact">
                  <dt>Auctions</dt>
                  <dd><span className="ch247-dsvc-status ch247-dsvc-status--completed">Internal marketplace — always on</span></dd>
                </div>
              </dl>
            )}
            <p className="ch247-page__hint">
              Readiness reflects providers with stored credentials that passed a real connection test. Services
              without a connected provider show customers an honest &quot;Service Provider Not Configured&quot; notice —
              never placeholder data.
            </p>
          </SectionCard>

          {overview && (
            <SectionCard title="Activity" style={{ marginTop: '1rem' }}>
              <dl className="ch247-dsvc-facts">
                <div className="ch247-dsvc-fact"><dt>Registrations</dt><dd>{statusTotal(overview.registrations)} ({statusCount(overview.registrations, 'pending_payment')} pending payment, {statusCount(overview.registrations, 'confirmed')} confirmed)</dd></div>
                <div className="ch247-dsvc-fact"><dt>Transfers</dt><dd>{statusTotal(overview.transfers)} ({statusCount(overview.transfers, 'completed')} completed, {statusCount(overview.transfers, 'failed')} failed)</dd></div>
                <div className="ch247-dsvc-fact"><dt>Auctions</dt><dd>{statusTotal(overview.auctions)} ({statusCount(overview.auctions, 'live')} live, {statusCount(overview.auctions, 'ended')} ended)</dd></div>
                <div className="ch247-dsvc-fact"><dt>Club memberships</dt><dd>{statusTotal(overview.club)} ({statusCount(overview.club, 'active')} active)</dd></div>
                <div className="ch247-dsvc-fact"><dt>Searches (24h)</dt><dd>{overview.searchesLast24h}</dd></div>
              </dl>
              <p className="ch247-page__hint">
                Safety limits — bulk search: max {overview.limits.bulkSearchMaxDomains} domains per search,{' '}
                {overview.limits.bulkSearchMaxPerHour} searches/hour; WHOIS: {overview.limits.whoisLookupsPerHour} lookups/hour.
              </p>
            </SectionCard>
          )}
        </>
      )}

      {tab === 'providers' && (
        <SectionCard
          title="Domain providers"
          actions={
            <button className="ch247-button" type="button" onClick={() => setCreateProviderOpen((open) => !open)}>
              {createProviderOpen ? 'Close' : 'Add provider'}
            </button>
          }
        >
          <p className="ch247-page__hint">
            Credentials are encrypted with the platform key ring and are <strong>write-only</strong> — no API can read
            them back, so nothing sensitive can ever appear on this page. <strong>Test Connection</strong> performs a
            real authenticated call to the provider; the provider&apos;s actual response decides the outcome.
          </p>

          {createProviderOpen && (
            <form onSubmit={createProvider} style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', margin: '1rem 0' }}>
              <label>Provider key (slug)<input required style={{ width: '100%' }} placeholder="primary-registrar" value={providerForm.providerKey} onChange={(e) => setProviderForm({ ...providerForm, providerKey: e.target.value })} /></label>
              <label>Display name<input required style={{ width: '100%' }} placeholder="Namecheap Production" value={providerForm.name} onChange={(e) => setProviderForm({ ...providerForm, name: e.target.value })} /></label>
              <label>Adapter
                <select style={{ width: '100%' }} value={providerForm.adapterKey} onChange={(e) => setProviderForm({ ...providerForm, adapterKey: e.target.value })}>
                  {installedAdapters.map((adapter) => (
                    <option key={adapter} value={adapter}>{ADAPTER_LABELS[adapter] ?? adapter}</option>
                  ))}
                </select>
              </label>
              <label>Provider type
                <select style={{ width: '100%' }} value={providerForm.providerType} onChange={(e) => setProviderForm({ ...providerForm, providerType: e.target.value as ProviderDto['providerType'] })}>
                  <option value="registrar">registrar</option>
                  <option value="rdap">rdap</option>
                  <option value="appraisal">appraisal</option>
                  <option value="auction">auction</option>
                </select>
              </label>
              <label>API base URL (optional)<input style={{ width: '100%' }} placeholder="https://api.namecheap.com/xml.response" value={providerForm.apiBaseUrl} onChange={(e) => setProviderForm({ ...providerForm, apiBaseUrl: e.target.value })} /></label>
              <label>Environment
                <select style={{ width: '100%' }} value={providerForm.environment} onChange={(e) => setProviderForm({ ...providerForm, environment: e.target.value as 'sandbox' | 'production' })}>
                  <option value="production">production</option>
                  <option value="sandbox">sandbox</option>
                </select>
              </label>
              <div style={{ gridColumn: '1 / -1' }}>
                <button className="ch247-button" type="submit" disabled={busy === 'create-provider'}>
                  {busy === 'create-provider' ? 'Creating…' : 'Create provider'}
                </button>
              </div>
            </form>
          )}

          {providers === null && <p className="ch247-page__hint">Loading providers…</p>}
          {providers !== null && providers.length === 0 && (
            <p className="ch247-page__hint">
              No domain providers yet. Add one (e.g. the Namecheap or GoDaddy registrar adapter), write its credentials,
              then run Test Connection.
            </p>
          )}

          {providers !== null && providers.map((provider) => {
            const hintFields = ADAPTER_CREDENTIAL_HINTS[provider.adapterKey] ?? [];
            const draft = credentialDrafts[provider.id] ?? {};
            return (
              <div key={provider.id} style={{ borderTop: '1px solid var(--ch247-border)', paddingTop: '1rem', marginTop: '1rem' }}>
                <div className="ch247-dsvc-toolbar" style={{ justifyContent: 'space-between' }}>
                  <div>
                    <strong>{provider.name}</strong>{' '}
                    <StatusChip status={provider.status} />{' '}
                    <small>
                      {provider.providerType} · {provider.adapterKey} · {provider.environment}
                      {provider.apiBaseUrl ? ` · ${provider.apiBaseUrl}` : ''}
                    </small>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="ch247-button"
                      type="button"
                      onClick={() => void testConnection(provider)}
                      disabled={busy === `test:${provider.id}`}
                    >
                      {busy === `test:${provider.id}` ? 'Testing…' : 'Test Connection'}
                    </button>
                  </div>
                </div>

                <dl className="ch247-dsvc-kv">
                  <dt>Stored credentials</dt>
                  <dd>{provider.credentialNames.length > 0 ? provider.credentialNames.join(', ') : 'None stored'}</dd>
                  <dt>Last connection test</dt>
                  <dd>
                    {provider.lastConnectionTestAt
                      ? `${formatDateTime(provider.lastConnectionTestAt)} — ${provider.lastError ? `failed: ${provider.lastError}` : 'succeeded'}`
                      : 'Never tested'}
                  </dd>
                </dl>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveCredentials(provider);
                  }}
                  style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
                >
                  {(hintFields.length > 0 ? hintFields : [{ name: 'credentialName', required: true }]).map((field) => (
                    <label key={field.name}>
                      {field.name}
                      {field.required ? '' : ' (optional)'}
                      <input
                        style={{ width: '100%' }}
                        type="password"
                        autoComplete="off"
                        placeholder={draft[field.name] ? '•••• (value entered)' : 'value — never shown again'}
                        value={draft[field.name] ?? ''}
                        onChange={(event) =>
                          setCredentialDrafts((current) => ({
                            ...current,
                            [provider.id]: { ...(current[provider.id] ?? {}), [field.name]: event.target.value },
                          }))
                        }
                      />
                    </label>
                  ))}
                  <div style={{ gridColumn: '1 / -1' }}>
                    <button className="ch247-button ch247-button--outline" type="submit" disabled={busy === `credentials:${provider.id}`}>
                      {busy === `credentials:${provider.id}` ? 'Storing…' : 'Save credentials (encrypted)'}
                    </button>
                  </div>
                </form>
              </div>
            );
          })}
        </SectionCard>
      )}

      {tab === 'extensions' && (
        <SectionCard
          title="Extension catalogue"
          actions={
            <button className="ch247-button" type="button" onClick={() => void syncExtensions()} disabled={busy === 'sync-extensions'}>
              {busy === 'sync-extensions' ? 'Syncing…' : 'Sync from registrar'}
            </button>
          }
        >
          <p className="ch247-page__hint">
            Prices come from the registrar provider&apos;s TLD catalogue. The <strong>AI Trending</strong> badge is an
            editorial decision made here per extension — it is never applied automatically and never hard-coded.
          </p>
          {extensions === null && <p className="ch247-page__hint">Loading extensions…</p>}
          {extensions !== null && extensions.length === 0 && (
            <p className="ch247-page__hint">
              The catalogue is empty. Connect and test a registrar provider on the Providers tab, then click
              &quot;Sync from registrar&quot;.
            </p>
          )}
          {extensions !== null && extensions.length > 0 && (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead><tr><th>Extension</th><th>Registration</th><th>Renewal</th><th>Transfer</th><th>Status</th><th>Trending</th><th>Action</th></tr></thead>
                <tbody>
                  {extensions.map((entry) => (
                    <tr key={entry.id}>
                      <td><strong>{entry.extension}</strong></td>
                      <td>{formatPrice(entry.registrationPrice, entry.currency)}</td>
                      <td>{formatPrice(entry.renewalPrice, entry.currency)}</td>
                      <td>{formatPrice(entry.transferPrice, entry.currency)}</td>
                      <td><StatusChip status={entry.status} /></td>
                      <td>{entry.isTrending ? <span className="ch247-dsvc-trending">AI Trending</span> : '—'}</td>
                      <td>
                        <button
                          className="ch247-button ch247-button--small"
                          type="button"
                          onClick={() => void toggleTrending(entry)}
                          disabled={busy === `trending:${entry.id}`}
                        >
                          {entry.isTrending ? 'Remove trending' : 'Mark trending'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'auctions' && (
        <>
          <SectionCard title="Create auction">
            <form onSubmit={createAuction} style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              <label>Domain<input required style={{ width: '100%' }} value={auctionForm.domainName} onChange={(e) => setAuctionForm({ ...auctionForm, domainName: e.target.value })} /></label>
              <label>Minimum bid (USD)<input required type="number" min="0.01" step="0.01" style={{ width: '100%' }} value={auctionForm.minimumBid} onChange={(e) => setAuctionForm({ ...auctionForm, minimumBid: e.target.value })} /></label>
              <label>Bid increment (USD)<input required type="number" min="0.01" step="0.01" style={{ width: '100%' }} value={auctionForm.bidIncrement} onChange={(e) => setAuctionForm({ ...auctionForm, bidIncrement: e.target.value })} /></label>
              <label>Starts at<input type="datetime-local" style={{ width: '100%' }} value={auctionForm.startsAt} onChange={(e) => setAuctionForm({ ...auctionForm, startsAt: e.target.value })} /></label>
              <label>Ends at<input required type="datetime-local" style={{ width: '100%' }} value={auctionForm.endsAt} onChange={(e) => setAuctionForm({ ...auctionForm, endsAt: e.target.value })} /></label>
              <div style={{ gridColumn: '1 / -1' }}>
                <button className="ch247-button" type="submit" disabled={busy === 'create-auction'}>
                  {busy === 'create-auction' ? 'Creating…' : 'Create auction'}
                </button>
              </div>
            </form>
            <p className="ch247-page__hint">
              Leaving the start time empty opens the auction immediately. Auctions are for domains CloudHost247
              controls or is authorized to sell.
            </p>
          </SectionCard>

          <SectionCard title="Auctions" style={{ marginTop: '1rem' }}>
            {auctions === null && <p className="ch247-page__hint">Loading auctions…</p>}
            {auctions !== null && auctions.length === 0 && <p className="ch247-page__hint">No auctions yet.</p>}
            {auctions !== null && auctions.length > 0 && (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead><tr><th>Domain</th><th>Status</th><th>Min bid</th><th>Current bid</th><th>Bids</th><th>Ends</th><th>Actions</th></tr></thead>
                  <tbody>
                    {auctions.map((auction) => (
                      <tr key={auction.id}>
                        <td style={{ wordBreak: 'break-all' }}>{auction.domainName}</td>
                        <td><StatusChip status={auction.status} /></td>
                        <td>{formatPrice(auction.minimumBid, auction.currency)}</td>
                        <td>{auction.currentHighestBid ? formatPrice(auction.currentHighestBid, auction.currency) : '—'}</td>
                        <td>{auction.bidCount}</td>
                        <td>{formatDateTime(auction.endsAt)}</td>
                        <td>
                          {(auction.status === 'live' || auction.status === 'ending_soon') && (
                            <button className="ch247-button ch247-button--small" type="button" onClick={() => void auctionAction(auction.id, 'pause')} disabled={busy === `auction:pause:${auction.id}`}>Pause</button>
                          )}
                          {auction.status === 'paused' && (
                            <button className="ch247-button ch247-button--small" type="button" onClick={() => void auctionAction(auction.id, 'resume')} disabled={busy === `auction:resume:${auction.id}`}>Resume</button>
                          )}
                          {auction.status === 'ended' && (
                            <button className="ch247-button ch247-button--small" type="button" onClick={() => void auctionAction(auction.id, 'complete')} disabled={busy === `auction:complete:${auction.id}`}>Complete</button>
                          )}
                          {auction.status !== 'completed' && auction.status !== 'cancelled' && (
                            <button className="ch247-button ch247-button--small ch247-button--danger" type="button" onClick={() => void auctionAction(auction.id, 'cancel')} disabled={busy === `auction:cancel:${auction.id}`}>Cancel</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      )}

      {tab === 'transfers' && (
        <SectionCard title="Transfer oversight">
          <p className="ch247-page__hint">
            Transfers advance automatically through the background sweep. Use <strong>Refresh</strong> to poll the
            registrar for this transfer right now (rate-limited), or set a status manually when the provider reports
            something the sweep cannot detect.
          </p>
          {transfers === null && <p className="ch247-page__hint">Loading transfers…</p>}
          {transfers !== null && transfers.length === 0 && <p className="ch247-page__hint">No transfers yet.</p>}
          {transfers !== null && transfers.length > 0 && (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead><tr><th>Domain</th><th>Customer</th><th>Status</th><th>From</th><th>Invoice</th><th>Started</th><th>Action</th></tr></thead>
                <tbody>
                  {transfers.map((transfer) => (
                    <tr key={transfer.id}>
                      <td style={{ wordBreak: 'break-all' }}>{transfer.domain_name}</td>
                      <td>{transfer.customer_email}</td>
                      <td>
                        <StatusChip status={transfer.status} />
                        {transfer.error_message && <><br /><small>{transfer.error_message}</small></>}
                      </td>
                      <td>{transfer.current_registrar ?? '—'}</td>
                      <td>{transfer.invoice_number ?? '—'}</td>
                      <td>{formatDateTime(transfer.created_at)}</td>
                      <td>
                        <button className="ch247-button ch247-button--small" type="button" onClick={() => void refreshTransfer(transfer.id)} disabled={busy === `refresh:${transfer.id}`}>
                          {busy === `refresh:${transfer.id}` ? 'Refreshing…' : 'Refresh'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'club' && (
        <>
          <SectionCard title="Create club plan">
            <form onSubmit={createPlan} style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
              <label>Name<input required style={{ width: '100%' }} value={planForm.name} onChange={(e) => setPlanForm({ ...planForm, name: e.target.value })} /></label>
              <label>Price (USD)<input required type="number" min="0" step="0.01" style={{ width: '100%' }} value={planForm.priceAmount} onChange={(e) => setPlanForm({ ...planForm, priceAmount: e.target.value })} /></label>
              <label>Billing period
                <select style={{ width: '100%' }} value={planForm.billingPeriod} onChange={(e) => setPlanForm({ ...planForm, billingPeriod: e.target.value as 'monthly' | 'annually' })}>
                  <option value="monthly">Monthly</option>
                  <option value="annually">Annually</option>
                </select>
              </label>
              <label>Discount type
                <select style={{ width: '100%' }} value={planForm.discountType} onChange={(e) => setPlanForm({ ...planForm, discountType: e.target.value as 'percentage' | 'fixed' })}>
                  <option value="percentage">Percentage off</option>
                  <option value="fixed">Fixed amount off</option>
                </select>
              </label>
              <label>Discount value ({planForm.discountType === 'percentage' ? '%' : 'USD'})<input required type="number" min="0" step="0.01" style={{ width: '100%' }} value={planForm.discountValue} onChange={(e) => setPlanForm({ ...planForm, discountValue: e.target.value })} /></label>
              <label>Eligible extensions (comma-separated, empty = all)<input style={{ width: '100%' }} placeholder="com, net, io" value={planForm.eligibleExtensions} onChange={(e) => setPlanForm({ ...planForm, eligibleExtensions: e.target.value })} /></label>
              <label style={{ gridColumn: '1 / -1' }}>Description<textarea rows={2} style={{ width: '100%' }} value={planForm.description} onChange={(e) => setPlanForm({ ...planForm, description: e.target.value })} /></label>
              <div style={{ gridColumn: '1 / -1' }}>
                <button className="ch247-button" type="submit" disabled={busy === 'create-plan'}>
                  {busy === 'create-plan' ? 'Creating…' : 'Create plan (draft)'}
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Plans" style={{ marginTop: '1rem' }}>
            {plans === null && <p className="ch247-page__hint">Loading plans…</p>}
            {plans !== null && plans.length === 0 && <p className="ch247-page__hint">No plans yet.</p>}
            {plans !== null && plans.length > 0 && (
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead><tr><th>Name</th><th>Price</th><th>Period</th><th>Discount</th><th>Eligible</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {plans.map((plan) => (
                      <tr key={plan.id}>
                        <td>{plan.name}</td>
                        <td>{formatPrice(plan.priceAmount, plan.currency)}</td>
                        <td>{plan.billingPeriod}</td>
                        <td>{plan.discountType === 'percentage' ? `${Number(plan.discountValue).toFixed(0)}%` : formatPrice(plan.discountValue, plan.currency)}</td>
                        <td>{plan.eligibleExtensions.length === 0 ? 'All' : plan.eligibleExtensions.join(', ')}</td>
                        <td><StatusChip status={plan.status} /></td>
                        <td>
                          {plan.status !== 'published' && (
                            <button className="ch247-button ch247-button--small" type="button" onClick={() => void setPlanStatus(plan.id, 'published')} disabled={busy === `plan:published:${plan.id}`}>Publish</button>
                          )}
                          {plan.status === 'published' && (
                            <button className="ch247-button ch247-button--small" type="button" onClick={() => void setPlanStatus(plan.id, 'disabled')} disabled={busy === `plan:disabled:${plan.id}`}>Disable</button>
                          )}
                          {plan.status !== 'draft' && plan.status !== 'published' && (
                            <button className="ch247-button ch247-button--small" type="button" onClick={() => void setPlanStatus(plan.id, 'draft')} disabled={busy === `plan:draft:${plan.id}`}>Back to draft</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {overview && (
            <SectionCard title="Memberships by status" style={{ marginTop: '1rem' }}>
              <dl className="ch247-dsvc-facts">
                {Object.entries(overview.club).map(([status, count]) => (
                  <div className="ch247-dsvc-fact" key={status}><dt>{status.replace(/_/g, ' ')}</dt><dd>{count}</dd></div>
                ))}
                {Object.keys(overview.club).length === 0 && <p className="ch247-page__hint">No memberships yet.</p>}
              </dl>
            </SectionCard>
          )}
        </>
      )}

      <p style={{ marginTop: '1.5rem' }} className="ch247-page__hint">
        All provider, extension, auction, transfer and club actions on this page are audit-logged. See{' '}
        <Link to="/admin/audit">Audit Log</Link>.
      </p>
    </div>
  );
}
