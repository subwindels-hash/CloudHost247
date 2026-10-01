import { useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { apiFetch } from '../../lib/api';
import type { AppraisalOutcome } from '../../lib/domain-services-api';

/**
 * Domain appraisal. Valuations come only from the configured appraisal provider (GoValue); this
 * page never computes or invents a value, and always shows the estimate disclaimer.
 */
interface AppraisalResponse {
  appraisalId: string;
  orderId: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  amount: string;
  currency: string;
  appraisal: AppraisalOutcome | null;
  status: 'pending_payment' | 'completed' | 'provider_not_configured' | 'provider_error';
  message: string | null;
}

export default function AppraisalPage() {
  usePageMeta('Domain Appraisal', 'Estimate the value of a domain name.');
  const token = getToken();

  const [domainName, setDomainName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AppraisalResponse | null>(null);

  async function onAppraise(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = domainName.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await apiFetch<AppraisalResponse>('/api/v1/domain-services/appraisals', {
        method: 'POST',
        body: JSON.stringify({ domainName: trimmed }),
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The appraisal could not be requested right now.');
    } finally {
      setBusy(false);
    }
  }

  const outcome = result?.status === 'completed' ? result.appraisal : null;

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Appraise Domain Name Value</h1>
          <p>An automated valuation estimate powered by a real appraisal provider.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          {!token && <p><Link className="ch247-button" to="/login">Sign in to appraise a domain</Link></p>}

          {token && (
            <form className="ch247-dsvc-search" onSubmit={onAppraise}>
              <label className="sr-only" htmlFor="appraise-domain">Domain name</label>
              <input
                id="appraise-domain"
                type="search"
                placeholder="example.com"
                value={domainName}
                onChange={(event) => setDomainName(event.target.value)}
                maxLength={253}
              />
              <button className="ch247-button" type="submit" disabled={busy || !domainName.trim()}>
                {busy ? 'Appraising…' : 'Get estimate'}
              </button>
            </form>
          )}

          {error && <p className="ch247-banner ch247-banner--error" role="alert" style={{ marginTop: '1rem' }}>{error}</p>}

          {result?.status === 'provider_not_configured' && (
            <div className="ch247-dsvc-provider-missing" role="status" style={{ marginTop: '1rem' }}>
              <strong>Service Provider Not Configured</strong>
              <p style={{ margin: '0.4rem 0 0' }}>
                Appraisals require a connected valuation provider. Until then no estimates can be shown — a made-up
                number would be worse than none.
              </p>
            </div>
          )}

          {result?.status === 'provider_error' && (
            <p className="ch247-banner ch247-banner--warning" role="status" style={{ marginTop: '1rem' }}>
              {result.message ?? 'We could not complete this request right now. Please try again.'}
            </p>
          )}

          {result?.status === 'pending_payment' && (
            <div className="ch247-card" style={{ marginTop: '1rem' }}>
              <h2>Appraisal fee</h2>
              <p className="ch247-banner ch247-banner--info">
                An invoice for {result.currency === 'USD' ? '$' : ''}{result.amount} was issued. The appraisal runs as
                soon as payment is verified.
              </p>
              {result.invoiceId && (
                <p><Link className="ch247-button" to={`/invoices/${result.invoiceId}`}>Pay invoice {result.invoiceNumber}</Link></p>
              )}
            </div>
          )}

          {outcome && (
            <section className="ch247-card" style={{ marginTop: '1.25rem' }}>
              <h2>{outcome.domainName}</h2>
              <dl className="ch247-dsvc-facts">
                <div className="ch247-dsvc-fact">
                  <dt>Estimated value</dt>
                  <dd className="ch247-dsvc-appraisal-value">{outcome.currency === 'USD' ? '$' : ''}{outcome.estimatedValue}</dd>
                </div>
                <div className="ch247-dsvc-fact"><dt>Confidence</dt><dd>{outcome.confidence ? outcome.confidence.replace(/^./, (c) => c.toUpperCase()) : 'Not provided'}</dd></div>
                <div className="ch247-dsvc-fact"><dt>TLD</dt><dd>.{outcome.tld}</dd></div>
                <div className="ch247-dsvc-fact"><dt>Domain length</dt><dd>{outcome.domainLength} characters</dd></div>
                <div className="ch247-dsvc-fact"><dt>Brandability</dt><dd>{outcome.brandability ?? 'Not provided'}</dd></div>
                <div className="ch247-dsvc-fact"><dt>Keywords</dt><dd>{outcome.keywords.length > 0 ? outcome.keywords.join(', ') : 'Not provided'}</dd></div>
              </dl>

              {outcome.comparableSales.length > 0 && (
                <>
                  <h3>Comparable sales</h3>
                  <div className="ch247-table-wrap">
                    <table className="ch247-table">
                      <thead><tr><th>Domain</th><th>Price</th><th>Sold</th><th>Source</th></tr></thead>
                      <tbody>
                        {outcome.comparableSales.map((sale) => (
                          <tr key={sale.domainName}>
                            <td>{sale.domainName}</td>
                            <td>{sale.price}</td>
                            <td>{sale.soldAt ?? '—'}</td>
                            <td>{sale.source ?? 'Provider'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <h3>Valuation factors</h3>
              <dl className="ch247-dsvc-kv">
                {Object.entries(outcome.factors).map(([key, value]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <dt>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
                    <dd>{value === null || value === undefined ? '—' : String(value)}</dd>
                  </div>
                ))}
              </dl>

              <p className="ch247-banner ch247-banner--info" role="note" style={{ marginTop: '1rem' }}>
                {outcome.disclaimer}
              </p>
              <p className="ch247-page__hint">Saved to your <Link to="/dashboard/domains">dashboard</Link>.</p>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
