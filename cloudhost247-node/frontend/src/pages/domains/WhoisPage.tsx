import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { whoisLookup, type WhoisResponse } from '../../lib/domain-services-api';
import { formatDateTime } from '../../components/domain-services/ui';

/**
 * WHOIS / RDAP owner lookup. RDAP-first with classic WHOIS fallback (both inside the RDAP
 * provider adapter). Privacy-protected registrants are reported exactly as protected.
 */
export default function WhoisPage() {
  usePageMeta('WHOIS / RDAP Lookup', 'Find public registration data for a domain.');
  const token = getToken();

  const [domainName, setDomainName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<WhoisResponse | null>(null);

  async function onLookup(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = domainName.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await whoisLookup(trimmed);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The lookup could not be completed right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Find a Domain Owner</h1>
          <p>Public registration data via modern RDAP, with classic WHOIS where a registry has no RDAP service.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <form className="ch247-dsvc-search" onSubmit={onLookup} role="search">
            <label className="sr-only" htmlFor="whois-domain">Domain name</label>
            <input
              id="whois-domain"
              type="search"
              placeholder="example.com"
              value={domainName}
              onChange={(event) => setDomainName(event.target.value)}
              maxLength={253}
            />
            <button className="ch247-button" type="submit" disabled={busy || !domainName.trim()}>
              {busy ? 'Looking up…' : 'Look up'}
            </button>
          </form>

          {error && <p className="ch247-banner ch247-banner--error" role="alert" style={{ marginTop: '1rem' }}>{error}</p>}

          {result?.status === 'provider_not_configured' && (
            <div className="ch247-dsvc-provider-missing" role="status" style={{ marginTop: '1rem' }}>
              <strong>Service Provider Not Configured</strong>
              <p style={{ margin: '0.4rem 0 0' }}>
                The RDAP/WHOIS lookup service needs its provider enabled by a Super Admin before lookups can run.
              </p>
            </div>
          )}

          {result?.status === 'rate_limited' && result.message && (
            <p className="ch247-banner ch247-banner--warning" role="status" style={{ marginTop: '1rem' }}>{result.message}</p>
          )}

          {result?.status === 'not_found' && (
            <p className="ch247-banner ch247-banner--info" role="status" style={{ marginTop: '1rem' }}>
              {result.message}
            </p>
          )}

          {result?.status === 'provider_error' && (
            <p className="ch247-banner ch247-banner--warning" role="status" style={{ marginTop: '1rem' }}>
              Domain provider temporarily unavailable. Please try again.
            </p>
          )}

          {result?.status === 'completed' && result.result && (
            <section className="ch247-card" style={{ marginTop: '1.25rem' }}>
              <h2>{result.result.domainName}</h2>
              <p className="ch247-page__hint">Source: {result.result.source.toUpperCase()}</p>
              <dl className="ch247-dsvc-kv">
                <dt>Registrar</dt>
                <dd>{result.result.registrar ?? 'Not published'}</dd>
                <dt>Creation date</dt>
                <dd>{formatDateTime(result.result.createdAt)}</dd>
                <dt>Updated date</dt>
                <dd>{formatDateTime(result.result.updatedAt)}</dd>
                <dt>Expiration date</dt>
                <dd>{formatDateTime(result.result.expiresAt)}</dd>
                <dt>Domain status</dt>
                <dd>{result.result.statuses.length > 0 ? result.result.statuses.join(', ') : 'Not published'}</dd>
                <dt>Name servers</dt>
                <dd>{result.result.nameservers.length > 0 ? result.result.nameservers.join(', ') : 'Not published'}</dd>
                <dt>Registry</dt>
                <dd>{result.result.registry ?? 'Not published'}</dd>
                <dt>Registrant</dt>
                <dd>{result.result.registrant}</dd>
              </dl>
              {result.result.privacyProtected && (
                <p className="ch247-banner ch247-banner--info" role="status">
                  Registrant information is privacy protected or unavailable. Privacy protection is respected — no
                  attempt is made to bypass it.
                </p>
              )}
              {token && (
                <p className="ch247-page__hint">
                  Your lookups are saved to <Link to="/dashboard/domains">your dashboard</Link>.
                </p>
              )}
            </section>
          )}

          <p className="ch247-page__hint" style={{ marginTop: '1.5rem' }}>
            Lookups return only publicly available registry data. Privacy-protected records are shown as protected,
            and this tool never attempts to reveal private personal information.
          </p>
        </div>
      </section>
    </div>
  );
}
