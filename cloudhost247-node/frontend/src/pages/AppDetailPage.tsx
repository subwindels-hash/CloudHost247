import { toolsApiPath } from '../lib/tools-runtime';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  fetchMarketplaceApp,
  fetchPublicServers,
  fetchMyInstallations,
  requestInstallation,
  payInvoice,
  type MarketplaceAppDetail,
  type PublicServer,
  type MyInstallation,
} from '../lib/marketplace-api';
import AppTileDefault, { formatMemory, formatStorage } from '../components/AppTile';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import { getStoredUser } from '../lib/auth';

/**
 * Application detail + installation wizard (spec §42, §44):
 *  1. Choose a server (from the customer's own installations/servers the platform can place)
 *  2. Configure: version, app name, primary domain, and the manifest's required env vars
 *  3. Review requirements and estimated recurring cost, then request the installation.
 * The POST creates an order + invoice; the paid-order webhook queues deployment, so provisioning
 * still starts only after verified payment exactly like any hosting product.
 */
export default function AppDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [app, setApp] = useState<MarketplaceAppDetail | null>(null);
  const [error, setError] = useState('');
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [installations, setInstallations] = useState<MyInstallation[]>([]);

  // Wizard state
  const [step, setStep] = useState(1);
  const [serverId, setServerId] = useState('');
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [env, setEnv] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  usePageMeta(app ? `${app.name} — App Marketplace` : 'App Marketplace', app?.description);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setApp(null);
    setError('');
    fetchMarketplaceApp(slug)
      .then((result) => {
        if (cancelled) return;
        setApp(result.app);
        const stable = result.app.versions.find((v) => v.stable) ?? result.app.versions[0];
        setVersion(stable?.version ?? '');
        setName(`${result.app.name} on CloudHost247`);
        setEnv(Object.fromEntries(result.app.environment.required.map((item) => [item.key, ''])));
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Signed-in users see their server options + any existing installation of this app.
  useEffect(() => {
    const user = getStoredUser();
    if (!user || !slug) return;
    let cancelled = false;
    fetchPublicServers()
      .then((result) => !cancelled && setServers(result.servers))
      .catch(() => !cancelled && setServers([]));
    fetchMyInstallations()
      .then((result) => !cancelled && setInstallations(result.installations.filter((inst) => inst.application?.slug === slug)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const selectedServer = useMemo(() => servers.find((server) => server.id === serverId), [servers, serverId]);
  const selectedVersion = useMemo(() => app?.versions.find((v) => v.version === version), [app, version]);
  const requirementsMet =
    !selectedServer ||
    !selectedVersion ||
    (selectedServer.cpuCores >= selectedVersion.requirements.minCpu &&
      selectedServer.memoryMb >= selectedVersion.requirements.minMemoryMb &&
      selectedServer.storageMb >= selectedVersion.requirements.minStorageMb);
  const requiredCustomerEnv = (app?.environment.required ?? []).filter((item) => item.customerProvided);
  const missingEnv = requiredCustomerEnv.filter((item) => !env[item.key]?.trim());

  const canSubmit = Boolean(serverId && version && !missingEnv.length && requirementsMet && !submitting);

  function environmentHint(item: {
    generated?: boolean;
    defaultFromDomain?: boolean;
    defaultFromUrl?: boolean;
    default?: string | null;
    description?: string | null;
    customerProvided?: boolean;
  }) {
    const notes = [item.description].filter(Boolean) as string[];
    if (item.generated) notes.push('Leave blank to generate a strong secret server-side.');
    else if (item.defaultFromDomain) notes.push('Leave blank to use the primary domain.');
    else if (item.defaultFromUrl) notes.push('Leave blank to use the primary application URL.');
    else if (item.default !== null && item.default !== undefined) notes.push(`Leave blank to use default: ${item.default}.`);
    else if (item.customerProvided) notes.push('Required: enter a value before continuing.');
    return notes.join(' ');
  }

  async function submit() {
    if (!app || !slug) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await requestInstallation({
        applicationId: app.slug,
        versionId: selectedVersion?.id,
        serverId,
        name: name.trim() || undefined,
        domain: domain.trim() || null,
        environment: Object.fromEntries(Object.entries(env).filter(([, value]) => value.trim() !== '')),
      });
      // Pay the invoice in the sandbox flow; provisioning (the deployment job) starts only
      // from the paid-order webhook, so route to the installation to watch it appear.
      if (result.paymentRequired && result.invoiceId) {
        try {
          await payInvoice(result.invoiceId);
        } catch {
          // Invoice remains open; the deployment stays queued until payment.
        }
      }
      navigate(`/dashboard/apps/${result.installationId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Installation request failed');
      setSubmitting(false);
    }
  }

  if (error) return <CatalogErrorBanner message={error} />;
  if (!app) return <CatalogLoadingBanner label={`Loading ${slug}…`} />;

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <div className="ch247-appdetail__head">
          <AppTileDefault name={app.name} slug={app.slug} size={64} />
          <div>
            <h1>{app.name}</h1>
            <p className="ch247-market-card__cat">
              {app.category?.name ?? 'Application'}
              {app.featured ? <span className="ch247-badge ch247-badge--active">Featured</span> : null}
              {app.stableVersion ? <span className="ch247-badge">{`v${app.stableVersion}`}</span> : null}
            </p>
          </div>
        </div>
        {app.longDescription && <p className="ch247-appdetail__desc">{app.longDescription}</p>}
        <div className="ch247-appdetail__links">
          {app.websiteUrl && <a href={app.websiteUrl} target="_blank" rel="noreferrer">Website</a>}
          {app.documentationUrl && <a href={app.documentationUrl} target="_blank" rel="noreferrer">Documentation</a>}
          {app.repositoryUrl && <a href={app.repositoryUrl} target="_blank" rel="noreferrer">Source</a>}
          {app.license && <span>License: {app.license}</span>}
        </div>
      </div>

      {installations.length > 0 && (
        <div className="ch247-card">
          <h2>Your installations of {app.name}</h2>
          <ul className="ch247-plainlist">
            {installations.map((inst) => (
              <li key={inst.id}>
                <a href={`/dashboard/apps/${inst.id}`}>{inst.name}</a> — {inst.status} on {inst.server?.name ?? 'server'}
              </li>
            ))}
          </ul>
          <p className="ch247-page__hint">
            {installations.some((inst) => inst.status === 'active')
              ? 'One active installation per application is included; request another only if you need a second isolated copy.'
              : ''}
          </p>
        </div>
      )}

      <div className="ch247-card">
        <h2>Install {app.name}</h2>
        {!getStoredUser() ? (
          <p className="ch247-page__hint">
            <a href={toolsApiPath('/login')}>Sign in</a> or <a href={toolsApiPath('/register')}>create an account</a> to install this application.
          </p>
        ) : (
          <>
            <ol className="ch247-wizard__steps" aria-label="Installation steps">
              <li className={step === 1 ? 'is-active' : step > 1 ? 'is-done' : ''}>1. Server</li>
              <li className={step === 2 ? 'is-active' : step > 2 ? 'is-done' : ''}>2. Configure</li>
              <li className={step === 3 ? 'is-active' : ''}>3. Review &amp; order</li>
            </ol>

            {step === 1 && (
              <div className="ch247-wizard__panel">
                {servers.length === 0 && (
                  <p className="ch247-page__hint">
                    No deployment-capable servers are available to you yet. Order hosting first — your
                    dashboard lists your services and eligible servers.
                  </p>
                )}
                <div className="ch247-serverlist">
                  {servers.map((server) => (
                    <label key={server.id} className={`ch247-serverlist__item ${serverId === server.id ? 'is-selected' : ''}`}>
                      <input
                        type="radio"
                        name="server"
                        checked={serverId === server.id}
                        onChange={() => setServerId(server.id)}
                        disabled={server.status !== 'active'}
                      />
                      <span>
                        <strong>{server.name}</strong> ({server.serverType}, {server.region ?? '—'})
                        <br />
                        <small>
                          {server.cpuCores} CPU · {formatMemory(server.memoryMb)} RAM · {formatStorage(server.storageMb)}
                          {server.status !== 'active' ? ' — currently unavailable' : ''}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                <div className="ch247-wizard__nav">
                  <button type="button" className="ch247-btn ch247-btn--primary" disabled={!serverId} onClick={() => setStep(2)}>
                    Continue
                  </button>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="ch247-wizard__panel">
                <label className="ch247-field">
                  Version
                  <select value={version} onChange={(event) => setVersion(event.target.value)}>
                    {app.versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        {v.version}
                        {v.stable ? ' (stable)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ch247-field">
                  Installation name
                  <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
                </label>
                {app.domainRequired ? (
                  <label className="ch247-field">
                    Primary domain (required by {app.name})
                    <input
                      value={domain}
                      onChange={(event) => setDomain(event.target.value)}
                      placeholder="app.yourdomain.com"
                    />
                    <small>
                      Point the domain's DNS at your server before installing. Verify the domain under{' '}
                      <a href={toolsApiPath('/dashboard/domains')}>Dashboard → Domains</a> first if you want it pre-verified.
                    </small>
                  </label>
                ) : (
                  <label className="ch247-field">
                    Primary domain (optional — you can add one later)
                    <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="app.yourdomain.com" />
                  </label>
                )}

                {(app.environment.required.length > 0 || app.environment.optional.length > 0) && (
                  <div className="ch247-fieldset">
                    <h3>Configuration</h3>
                    {app.environment.required.map((item) => (
                      <label key={item.key} className="ch247-field">
                        {item.label ?? item.key}{' '}
                        {item.customerProvided ? <span aria-hidden="true">*</span> : <small>(auto)</small>}
                        <input
                          value={env[item.key] ?? ''}
                          onChange={(event) => setEnv({ ...env, [item.key]: event.target.value })}
                          placeholder={
                            item.generated
                              ? 'auto-generated if left blank'
                              : item.defaultFromDomain
                                ? 'uses primary domain if left blank'
                                : item.defaultFromUrl
                                  ? 'uses application URL if left blank'
                                  : item.default ?? ''
                          }
                          autoComplete="off"
                        />
                        <small>{environmentHint(item)}</small>
                      </label>
                    ))}
                    {app.environment.optional.map((item) => (
                      <label key={item.key} className="ch247-field">
                        {item.label ?? item.key} <small>(optional)</small>
                        <input
                          value={env[item.key] ?? ''}
                          onChange={(event) => setEnv({ ...env, [item.key]: event.target.value })}
                          placeholder={
                            item.defaultFromDomain
                              ? 'uses primary domain if left blank'
                              : item.defaultFromUrl
                                ? 'uses application URL if left blank'
                                : item.default ?? ''
                          }
                          autoComplete="off"
                        />
                        <small>{environmentHint(item)}</small>
                      </label>
                    ))}
                    <p className="ch247-page__hint">
                      Fields marked <strong>(auto)</strong> are generated or derived by CloudHost247 when left blank and stored encrypted where appropriate.
                    </p>
                  </div>
                )}

                <div className="ch247-wizard__nav">
                  <button type="button" className="ch247-btn" onClick={() => setStep(1)}>
                    Back
                  </button>
                  <button
                    type="button"
                    className="ch247-btn ch247-btn--primary"
                    disabled={Boolean(app.domainRequired && !domain.trim()) || missingEnv.length > 0}
                    onClick={() => setStep(3)}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="ch247-wizard__panel">
                <h3>Review</h3>
                <dl className="ch247-kv">
                  <dt>Application</dt>
                  <dd>{app.name}</dd>
                  <dt>Version</dt>
                  <dd>{version}</dd>
                  <dt>Server</dt>
                  <dd>{selectedServer ? `${selectedServer.name} (${selectedServer.serverType})` : '—'}</dd>
                  {domain.trim() && (
                    <>
                      <dt>Primary domain</dt>
                      <dd>{domain.trim()}</dd>
                    </>
                  )}
                  <dt>Requirements</dt>
                  <dd>
                    {selectedVersion
                      ? `${selectedVersion.requirements.minCpu} CPU · ${formatMemory(
                          selectedVersion.requirements.minMemoryMb
                        )} RAM · ${formatStorage(selectedVersion.requirements.minStorageMb)}`
                      : '—'}
                  </dd>
                </dl>
                {!requirementsMet && (
                  <p className="ch247-banner ch247-banner--warning">
                    The selected server does not meet this version's minimum requirements.
                  </p>
                )}
                {app.sslSupported && <p className="ch247-page__hint">SSL certificate issued automatically for the primary domain.</p>}
                {app.backupsSupported && <p className="ch247-page__hint">Nightly off-server backups included.</p>}
                <p className="ch247-page__hint">
                  Requesting the installation creates an order and invoice (billed pro-rata with your
                  hosting); provisioning begins once the invoice is paid, and you will be able to watch
                  the deployment live.
                </p>
                {submitError && <CatalogErrorBanner message={submitError} />}
                <div className="ch247-wizard__nav">
                  <button type="button" className="ch247-btn" onClick={() => setStep(2)} disabled={submitting}>
                    Back
                  </button>
                  <button type="button" className="ch247-btn ch247-btn--primary" disabled={!canSubmit} onClick={submit}>
                    {submitting ? 'Requesting…' : 'Request installation'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
