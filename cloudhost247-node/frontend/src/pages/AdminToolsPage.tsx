import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  toolsApi,
  type AdminToolRow,
  type AdminToolsOverview,
  type ProviderView,
  type ResolverView,
  type ToolStatus,
} from '../lib/tools-api';

const STATUSES: ToolStatus[] = ['ACTIVE', 'DISABLED', 'MAINTENANCE', 'CONFIGURATION_REQUIRED', 'SERVICE_UNAVAILABLE'];

/**
 * Super-admin control center for the Tools Center (spec §83). Everything here writes to the
 * catalogue *overrides* table — the code catalogue stays the single source of truth for what a tool
 * is, and these rows only change how (or whether) it runs in this deployment.
 */
export default function AdminToolsPage() {
  usePageMeta('Tools Center control', 'Provider credentials, resolver registry, rate limits, tool status and health.');
  const [overview, setOverview] = useState<AdminToolsOverview | null>(null);
  const [tools, setTools] = useState<AdminToolRow[]>([]);
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [resolvers, setResolvers] = useState<ResolverView[]>([]);
  const [checks, setChecks] = useState<Array<{ id: string; subject_type: string; subject_slug: string; status: string; latency_ms: number | null; detail: string | null; checked_at: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<'overview' | 'tools' | 'providers' | 'resolvers'>('overview');
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, { apiKey: string; endpoint: string }>>({});

  const load = useCallback(async () => {
    try {
      const [board, toolList, providerList, resolverList, health] = await Promise.all([
        toolsApi.adminOverview(),
        toolsApi.adminTools(),
        toolsApi.adminProviders(),
        toolsApi.adminResolvers(),
        toolsApi.adminHealthChecks(),
      ]);
      setOverview(board);
      setTools(toolList.tools);
      setProviders(providerList.providers);
      setResolvers(resolverList.resolvers);
      setChecks(health.checks);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'The Tools Center state could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchTool(slug: string, patch: Record<string, unknown>, label: string) {
    setBusy(`${slug}:${label}`);
    setError(null);
    setNote(null);
    try {
      await toolsApi.adminPatchTool(slug, patch);
      setNote(`${slug}: ${label} saved.`);
      await load();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : 'The override could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function resetTool(slug: string) {
    setBusy(`${slug}:reset`);
    try {
      await toolsApi.adminResetTool(slug);
      setNote(`${slug}: override removed — the catalogue default applies again.`);
      await load();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'The override could not be reset.');
    } finally {
      setBusy(null);
    }
  }

  async function saveProvider(slug: string) {
    const draft = credentialDrafts[slug] ?? { apiKey: '', endpoint: '' };
    setBusy(`${slug}:save`);
    setError(null);
    setNote(null);
    try {
      await toolsApi.adminSaveProvider(slug, {
        ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        ...(draft.endpoint ? { endpoint: draft.endpoint } : {}),
        enabled: true,
      });
      setCredentialDrafts((current) => ({ ...current, [slug]: { apiKey: '', endpoint: '' } }));
      setNote(`${slug}: provider saved. Credentials are stored encrypted; the value is never shown again.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The provider could not be saved.');
    } finally {
      setBusy(null);
    }
  }

  async function testProvider(slug: string) {
    setBusy(`${slug}:test`);
    setError(null);
    setNote(null);
    try {
      const { result } = await toolsApi.adminTestProvider(slug);
      setNote(`${slug}: ${result.ok ? 'reachable' : result.status} — ${result.detail}${result.latencyMs === null ? '' : ` (${result.latencyMs} ms)`}`);
      await load();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'The provider test failed.');
    } finally {
      setBusy(null);
    }
  }

  async function testResolver(id: string) {
    setBusy(`${id}:test`);
    setError(null);
    setNote(null);
    try {
      const { result } = await toolsApi.adminTestResolver(id);
      setNote(`Resolver ${id}: ${result.status} — ${result.detail}`);
      await load();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'The resolver test failed.');
    } finally {
      setBusy(null);
    }
  }

  async function runSweep(kind: 'provider' | 'resolver' | 'monitor' | 'all') {
    setBusy(`sweep:${kind}`);
    setError(null);
    setNote(null);
    try {
      const result = await toolsApi.adminSweep();
      setNote(`Sweep (${kind}) finished: ${JSON.stringify(result[kind === 'all' ? 'provider' : kind] ?? result)}`.slice(0, 400));
      await load();
    } catch (sweepError) {
      setError(sweepError instanceof Error ? sweepError.message : 'The sweep failed.');
    } finally {
      setBusy(null);
    }
  }

  async function clearCache() {
    setBusy('cache');
    try {
      const result = await toolsApi.adminClearCache();
      setNote(`Cache cleared: ${result.removed} entries removed.`);
    } catch (cacheError) {
      setError(cacheError instanceof Error ? cacheError.message : 'The cache could not be cleared.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tools-center">
      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/admin">Admin</Link>
        <span aria-current="page">Tools Center</span>
      </nav>
      <h1>Tools Center control</h1>
      <p className="tools-muted">
        Tools ship in code; this page stores deployment-level overrides, provider credentials and the resolver registry. A tool that has
        no usable provider reports CONFIGURATION_REQUIRED to customers rather than returning an empty answer.
      </p>

      {error ? <div className="tools-notice tools-notice--error" role="alert">{error}</div> : null}
      {note ? <div className="tools-notice" role="status">{note}</div> : null}

      <div className="tools-chips" role="tablist" aria-label="Admin sections">
        {(['overview', 'tools', 'providers', 'resolvers'] as const).map((entry) => (
          <button key={entry} type="button" role="tab" aria-selected={tab === entry} className={`tools-chip${tab === entry ? ' is-active' : ''}`} onClick={() => setTab(entry)}>
            {entry}
          </button>
        ))}
        <button type="button" className="ch247-button ch247-button--ghost" disabled={busy === 'sweep:all'} onClick={() => void runSweep('all')}>Run all sweeps now</button>
        <button type="button" className="ch247-button ch247-button--ghost" disabled={busy === 'cache'} onClick={() => void clearCache()}>Clear tool cache</button>
      </div>

      {tab === 'overview' && overview ? (
        <>
          <section className="tools-metrics">
            <article><h2>{overview.metrics.totalExecutions}</h2><p>executions logged</p></article>
            <article><h2>{overview.metrics.executionsToday}</h2><p>today</p></article>
            <article><h2>{overview.metrics.failedExecutions}</h2><p>non-success</p></article>
            <article><h2>{overview.metrics.rateLimitEvents}</h2><p>rate-limited</p></article>
            <article><h2>{overview.metrics.blockedEvents}</h2><p>abuse-blocked</p></article>
            <article><h2>{overview.catalog.total}</h2><p>tools in catalogue</p></article>
            <article><h2>{overview.catalog.customised}</h2><p>overridden</p></article>
            <article><h2>{overview.abuse.blockedAddresses}</h2><p>blocked addresses (24 h)</p></article>
          </section>

          {overview.catalog.missingImplementations.length > 0 ? (
            <div className="tools-notice tools-notice--error" role="alert">
              Tools without a registered implementation: {overview.catalog.missingImplementations.join(', ')}. They will report
              SERVICE_UNAVAILABLE until that is fixed.
            </div>
          ) : null}

          <section aria-labelledby="admin-tools-status">
            <h2 id="admin-tools-status">Statuses</h2>
            <ul className="tools-inline-list">
              {Object.entries(overview.catalog.byStatus).map(([status, count]) => (
                <li key={status}><span className={`tools-badge tools-badge--${status.toLowerCase()}`}>{status}</span> {count}</li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="admin-tools-top">
            <h2 id="admin-tools-top">Most-used tools</h2>
            <div className="tools-table-wrap">
              <table className="tools-table">
                <thead><tr><th scope="col">Tool</th><th scope="col">Runs</th><th scope="col">Failures</th><th scope="col">Avg ms</th><th scope="col">Last run</th></tr></thead>
                <tbody>
                  {overview.metrics.perTool.slice(0, 15).map((row) => (
                    <tr key={row.slug}>
                      <td><Link to={`/tools/${row.slug}`}>{row.slug}</Link></td>
                      <td>{row.executions}</td>
                      <td>{row.failures}</td>
                      <td>{row.avgDurationMs ?? '—'}</td>
                      <td>{row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : 'never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="admin-tools-health">
            <h2 id="admin-tools-health">Recent health checks</h2>
            <div className="tools-table-wrap">
              <table className="tools-table">
                <thead><tr><th scope="col">Type</th><th scope="col">Subject</th><th scope="col">Status</th><th scope="col">Latency</th><th scope="col">Detail</th><th scope="col">Checked</th></tr></thead>
                <tbody>
                  {checks.slice(0, 25).map((check) => (
                    <tr key={check.id}>
                      <td>{check.subject_type}</td>
                      <td className="tools-cell--mono">{check.subject_slug}</td>
                      <td><span className={`tools-badge tools-badge--${check.status.toLowerCase()}`}>{check.status}</span></td>
                      <td>{check.latency_ms === null ? '—' : `${check.latency_ms} ms`}</td>
                      <td className="tools-cell--summary">{check.detail ?? '—'}</td>
                      <td>{new Date(check.checked_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {tab === 'tools' ? (
        <div className="tools-table-wrap">
          <table className="tools-table">
            <thead><tr><th scope="col">Tool</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Rate limit</th><th scope="col">Cache</th><th scope="col">Override</th></tr></thead>
            <tbody>
              {tools.map((tool) => (
                <tr key={tool.slug}>
                  <td><Link to={`/tools/${tool.slug}`}>{tool.name}</Link><div className="tools-cell--summary">{tool.slug}</div></td>
                  <td>{tool.category}</td>
                  <td>
                    <select
                      value={tool.status}
                      disabled={busy !== null}
                      onChange={(event) => void patchTool(tool.slug, { statusOverride: event.target.value }, `status → ${event.target.value}`)}
                    >
                      {STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                    {tool.statusMessage ? <div className="tools-cell--summary">{tool.statusMessage}</div> : null}
                  </td>
                  <td>
                    <select
                      value={tool.rateLimitProfile}
                      disabled={busy !== null}
                      onChange={(event) => void patchTool(tool.slug, { rateLimitProfile: event.target.value }, `rate limit → ${event.target.value}`)}
                    >
                      {['light', 'standard', 'heavy', 'restricted'].map((profile) => <option key={profile} value={profile}>{profile}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={86400}
                      defaultValue={tool.cacheSeconds}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value) && value !== tool.cacheSeconds) void patchTool(tool.slug, { cacheSeconds: value }, `cache → ${value}s`);
                      }}
                    />
                  </td>
                  <td>
                    {tool.hasOverride ? (
                      <button type="button" className="ch247-button ch247-button--ghost" disabled={busy !== null} onClick={() => void resetTool(tool.slug)}>Reset</button>
                    ) : (
                      <span className="tools-muted">catalogue default</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === 'providers' ? (
        <div className="tools-providers">
          {providers.map((provider) => (
            <article key={provider.slug} className="tools-card">
              <div className="tools-card__head">
                <h3>{provider.name}</h3>
                <span className={`tools-badge tools-badge--${provider.healthStatus.toLowerCase()}`}>{provider.healthStatus}</span>
              </div>
              <p>{provider.description}</p>
              <p className="tools-muted">
                {provider.kind} · {provider.enabled ? 'enabled' : 'disabled'} · {provider.hasCredentials ? 'credential stored' : 'no credential'} ·{' '}
                {provider.endpoint ? provider.endpoint : 'no endpoint'} · timeout {provider.timeoutMs} ms
              </p>
              {provider.requirement ? <div className="tools-notice tools-notice--warning" role="status">{provider.requirement}</div> : null}
              {provider.lastError ? <p className="tools-muted">Last error: {provider.lastError}</p> : null}
              <div className="tools-fields tools-fields--inline">
                <label className="tools-field">
                  <span>{provider.hasCredentials ? 'Replace credential (optional)' : 'Credential'}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={credentialDrafts[provider.slug]?.apiKey ?? ''}
                    onChange={(event) => setCredentialDrafts((current) => ({ ...current, [provider.slug]: { apiKey: event.target.value, endpoint: current[provider.slug]?.endpoint ?? '' } }))}
                  />
                </label>
                <label className="tools-field">
                  <span>Endpoint override</span>
                  <input
                    type="text"
                    placeholder={provider.endpoint ?? 'https://…'}
                    value={credentialDrafts[provider.slug]?.endpoint ?? ''}
                    onChange={(event) => setCredentialDrafts((current) => ({ ...current, [provider.slug]: { apiKey: current[provider.slug]?.apiKey ?? '', endpoint: event.target.value } }))}
                  />
                </label>
                <button type="button" className="ch247-button" disabled={busy !== null} onClick={() => void saveProvider(provider.slug)}>Save</button>
                <button type="button" className="ch247-button ch247-button--ghost" disabled={busy !== null} onClick={() => void testProvider(provider.slug)}>Test connection</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {tab === 'resolvers' ? (
        <div className="tools-table-wrap">
          <table className="tools-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Provider</th><th scope="col">Address</th><th scope="col">Protocol</th><th scope="col">Health</th><th scope="col">Latency</th><th scope="col">Actions</th></tr></thead>
            <tbody>
              {resolvers.map((resolver) => (
                <tr key={resolver.id}>
                  <td>{resolver.name}</td>
                  <td>{resolver.provider}{resolver.country ? ` (${resolver.country})` : ''}</td>
                  <td className="tools-cell--mono">{resolver.endpoint ?? resolver.ip_address}</td>
                  <td>{resolver.protocol}</td>
                  <td><span className={`tools-badge tools-badge--${resolver.health_status.toLowerCase()}`}>{resolver.health_status}</span></td>
                  <td>{resolver.last_latency_ms === null ? '—' : `${resolver.last_latency_ms} ms`}</td>
                  <td className="tools-row-actions">
                    <button type="button" className="ch247-button ch247-button--ghost" disabled={busy !== null} onClick={() => void testResolver(resolver.id)}>Test</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
