import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import { getToken } from '../../lib/auth';
import { bulkSearchDomains, type BulkSearchResponse, type SearchResultRow } from '../../lib/domain-services-api';
import { AvailabilityChip, formatPrice } from '../../components/domain-services/ui';

/**
 * Bulk domain search: paste a list or upload a TXT/CSV. The server caps the list size, batches
 * provider calls and throttles per user — this page never tries to work around those limits.
 */
export default function BulkSearchPage() {
  usePageMeta('Bulk Domain Search', 'Check many domains at once.');
  const token = getToken();
  const fileInput = useRef<HTMLInputElement>(null);

  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<BulkSearchResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportUrl, setExportUrl] = useState('');

  function toggleDomain(domainName: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(domainName)) next.delete(domainName);
      else next.add(domainName);
      return next;
    });
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 512_000) {
      setError('That file is too large — please keep bulk lists under 500 KB.');
      return;
    }
    const text = await file.text();
    setContent(text.slice(0, 100_000));
    setError('');
  }

  function buildExport() {
    if (!result) return;
    const lines = ['Domain,Status,Premium,Registration Price,Renewal Price,Transfer Price,Currency'];
    for (const row of result.results) {
      lines.push(
        [
          row.domainName,
          row.availabilityStatus,
          row.isPremium ? 'yes' : 'no',
          row.registrationPrice ?? '',
          row.renewalPrice ?? '',
          row.transferPrice ?? '',
          row.currency ?? '',
        ].join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    setExportUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
  }

  async function onSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    setSelected(new Set());
    try {
      const response = await bulkSearchDomains(content, 'text');
      setResult(response);
      setSelected(
        new Set(response.results.filter((row) => row.availabilityStatus === 'available').map((row) => row.domainName))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The bulk search could not be completed right now.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>Bulk Domain Search</h1>
          <p>Check up to 200 domains at once. Lists are batched and rate-limited to protect provider availability.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          {!token && (
            <p>
              <Link className="ch247-button" to="/login">Sign in to use bulk search</Link>
            </p>
          )}

          {token && (
            <form onSubmit={onSearch} className="ch247-card" style={{ display: 'grid', gap: '0.75rem' }}>
              <label htmlFor="bulk-input">
                Domains — one per line, comma-separated, or a CSV column (bare terms are checked against leading extensions)
              </label>
              <textarea
                id="bulk-input"
                rows={10}
                style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.9rem' }}
                placeholder={'example.com\nexample.net\nexample.org\nexample.ai'}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                maxLength={100_000}
              />
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="ch247-button" type="submit" disabled={busy || !content.trim()}>
                  {busy ? 'Searching…' : 'Search domains'}
                </button>
                <button
                  className="ch247-button ch247-button--outline"
                  type="button"
                  onClick={() => fileInput.current?.click()}
                >
                  Upload TXT/CSV
                </button>
                <input ref={fileInput} type="file" accept=".txt,.csv,text/plain,text/csv" hidden onChange={(event) => void onFile(event)} />
              </div>
              {error && <p className="ch247-banner ch247-banner--error" role="alert">{error}</p>}
            </form>
          )}

          {result?.status === 'provider_not_configured' && (
            <div className="ch247-dsvc-provider-missing" role="status" style={{ marginTop: '1rem' }}>
              <strong>Service Provider Not Configured</strong>
              <p style={{ margin: '0.4rem 0 0' }}>Bulk search needs a connected registrar provider.</p>
            </div>
          )}

          {result && result.status !== 'provider_not_configured' && result.message && (
            <p className="ch247-banner ch247-banner--warning" role="status" style={{ marginTop: '1rem' }}>{result.message}</p>
          )}

          {result?.status === 'completed' && (
            <>
              <p style={{ marginTop: '1rem' }}>
                {result.acceptedCount} domain{result.acceptedCount === 1 ? '' : 's'} checked
                {result.rejectedCount > 0 ? ` · ${result.rejectedCount} entr${result.rejectedCount === 1 ? 'y' : 'ies'} skipped (invalid or over the limit)` : ''}
              </p>
              <div className="ch247-dsvc-toolbar">
                <button className="ch247-button ch247-button--outline" type="button" onClick={buildExport}>
                  Export results (CSV)
                </button>
                {exportUrl && (
                  <a className="ch247-button ch247-button--outline" href={exportUrl} download="bulk-domain-search.csv">
                    Download CSV
                  </a>
                )}
                <span className="ch247-page__hint">{selected.size} selected — register them from the search page.</span>
              </div>
              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Status</th>
                      <th>Registration</th>
                      <th>Renewal</th>
                      <th>Transfer</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.results.map((row) => (
                      <tr key={row.domainName}>
                        <td style={{ wordBreak: 'break-all' }}>{row.domainName}</td>
                        <td><AvailabilityChip status={row.availabilityStatus} /></td>
                        <td>{formatPrice(row.registrationPrice, row.currency)}</td>
                        <td>{formatPrice(row.renewalPrice, row.currency)}</td>
                        <td>{formatPrice(row.transferPrice, row.currency)}</td>
                        <td>
                          {row.availabilityStatus === 'available' || row.availabilityStatus === 'premium' ? (
                            <Link to={`/domains/search?domain=${encodeURIComponent(row.domainName)}`}>Add</Link>
                          ) : row.availabilityStatus === 'registered' ? (
                            <Link to="/domains/whois">View</Link>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
