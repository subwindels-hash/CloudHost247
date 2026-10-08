import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { toolsApi, type DomainHealthResult } from '../lib/tools-api';

const SECTION_LABEL: Record<string, string> = {
  dns: 'DNS records',
  'email-auth': 'E-mail authentication',
  dnssec: 'DNSSEC',
  tls: 'TLS / certificate',
  hosting: 'CloudHost247 hosting',
  monitoring: 'Continuous monitoring',
};

/**
 * Domain Health Center — one honest verdict per section, built from the same checks the individual
 * tools run, plus this platform's own hosting context (which zone/site the domain belongs to here).
 */
export default function DomainHealthPage() {
  const { domain = '' } = useParams();
  const [result, setResult] = useState<DomainHealthResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  usePageMeta(`${domain} health`, `DNS, e-mail, TLS and DNSSEC health for ${domain} — measured, not guessed.`);

  const load = useCallback(() => {
    if (!domain) return;
    setLoading(true);
    setError(null);
    toolsApi
      .domainHealth(domain)
      .then((envelope) => {
        if (envelope.success) setResult(envelope.data);
        else setError(`${envelope.code}: ${envelope.message}`);
      })
      .catch((loadError: Error) => setError(loadError.message))
      .finally(() => setLoading(false));
  }, [domain]);

  useEffect(load, [load]);

  return (
    <div className="tools-center">
      <nav className="tools-breadcrumb" aria-label="Breadcrumb">
        <Link to="/tools">Tools Center</Link>
        <Link to="/tools/domain-health">Domain Health</Link>
        <span aria-current="page">{domain}</span>
      </nav>
      <div className="tools-tool__head">
        <h1>{domain} — health center</h1>
        <div className="tools-runner__actions">
          <button type="button" className="ch247-button" onClick={load}>Re-check</button>
          {/* The published path is the one the PHP tools shell serves too; /tools/dns-health is a
              retained alias, and linking an alias publishes a second URL for one page. */}
          <Link className="ch247-button ch247-button--ghost" to={`/tools/domain-dns-health`}>Detailed DNS health</Link>
        </div>
      </div>

      {error ? <div className="tools-notice tools-notice--error" role="alert">{error}</div> : null}
      {loading ? <p className="tools-loading">Running the checks — DNS, e-mail authentication, TLS and DNSSEC…</p> : null}

      {result ? (
        <>
          <div className={`tools-verdict tools-verdict--${result.verdict.status.toLowerCase()}`}>
            <h2>{result.verdict.status}</h2>
            <p>{result.verdict.summary}</p>
            <p className="tools-muted">
              {result.verdict.sectionsChecked - result.verdict.sectionsFailed} of {result.verdict.sectionsChecked} sections passed · checked in {result.durationMs} ms
            </p>
          </div>

          {result.hostingContext.owned ? (
            <div className="tools-notice">
              <strong>This domain is hosted with CloudHost247.</strong>{' '}
              {result.hostingContext.serverName ? <>It resolves to {result.hostingContext.serverName}{result.hostingContext.serverIp ? ` (${result.hostingContext.serverIp})` : ''}. </> : null}
              {result.hostingContext.actions.map((action) => (
                <Link key={action.href} className="ch247-button ch247-button--ghost" to={action.href}>{action.label}</Link>
              ))}
            </div>
          ) : (
            <p className="tools-muted">This domain is not in your CloudHost247 account, so the checks are read-only from the public DNS and a live TLS handshake.</p>
          )}

          <div className="tools-sections">
            {result.sections.map((section) => (
              <section key={section.id} className={`tools-section tools-section--${section.status.toLowerCase()}`}>
                <div className="tools-section__head">
                  <h3>{SECTION_LABEL[section.id] ?? section.label ?? section.id}</h3>
                  <span className={`tools-badge tools-badge--${section.status.toLowerCase()}`}>{section.status}</span>
                </div>
                <p>{section.summary}</p>
                {section.detail ? <p className="tools-muted">{section.detail}</p> : null}
                {section.evidence ? (
                  <>
                    <button type="button" className="ch247-button ch247-button--ghost" onClick={() => setExpanded(expanded === section.id ? null : section.id)}>
                      {expanded === section.id ? 'Hide evidence' : 'Show evidence'}
                    </button>
                    {expanded === section.id ? <pre className="tools-json tools-json--small">{JSON.stringify(section.evidence, null, 2)}</pre> : null}
                  </>
                ) : null}
                {section.durationMs !== null ? <p className="tools-muted">{section.durationMs} ms</p> : null}
              </section>
            ))}
          </div>

          {result.recommendations.length > 0 ? (
            <section aria-labelledby="tools-recommendations">
              <h2 id="tools-recommendations">Recommended next steps</h2>
              <ul>{result.recommendations.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          ) : null}

          {result.notes.length > 0 ? (
            <section aria-labelledby="tools-health-notes">
              <h2 id="tools-health-notes">What was and was not checked</h2>
              <ul>{result.notes.map((item) => <li key={item}>{item}</li>)}</ul>
            </section>
          ) : null}

          <section aria-labelledby="tools-health-monitors">
            <h2 id="tools-health-monitors">Monitoring for this domain</h2>
            {result.monitors.length === 0 ? (
              <p className="tools-muted">
                Nothing is being watched yet. <Link to="/tools/monitors">Create a monitor</Link> to be told when the certificate approaches
                expiry or a record changes.
              </p>
            ) : (
              <ul>
                {result.monitors.map((monitor) => (
                  <li key={monitor.id}>
                    {monitor.kind} · {monitor.target} — {monitor.lastStatus} ({monitor.lastCheckedAt ? new Date(monitor.lastCheckedAt).toLocaleString() : 'never checked'})
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
