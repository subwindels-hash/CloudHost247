import { useState } from 'react';
import { usePageMeta } from '../../lib/usePageMeta';
import { useApiResource } from '../../lib/useApiResource';
import { listExtensions, type ExtensionEntry } from '../../lib/domain-services-api';
import { formatPrice } from '../../components/domain-services/ui';

/**
 * gTLD extension directory — provider-sourced pricing, admin-curated copy and trending badges.
 * The trending badge is a Super Admin decision, never hard-coded per TLD.
 */
export default function ExtensionsPage() {
  usePageMeta('Domain Extensions', 'Browse domain extensions, prices and requirements.');
  const [search, setSearch] = useState('');
  const [onlyTrending, setOnlyTrending] = useState(false);
  const [query, setQuery] = useState('');

  const extensions = useApiResource<{ extensions: ExtensionEntry[] }>(
    `/api/v1/domain-services/extensions${query.trim() ? `?search=${encodeURIComponent(query.trim())}` : ''}`
  );

  const filtered =
    extensions.status === 'success'
      ? extensions.data.extensions.filter((entry) => (onlyTrending ? entry.isTrending : true))
      : [];

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <h1>gTLD Domain Extensions</h1>
          <p>Every extension we support, with live provider pricing and registration requirements.</p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page">
          <form
            className="ch247-dsvc-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              setQuery(search);
            }}
            role="search"
          >
            <label className="sr-only" htmlFor="extension-search">Search extensions</label>
            <input
              id="extension-search"
              type="search"
              placeholder="Search extensions, e.g. com or .ai"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className="ch247-button" type="submit">Search</button>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={onlyTrending} onChange={(event) => setOnlyTrending(event.target.checked)} />
              Trending only
            </label>
          </form>

          {extensions.status === 'loading' && <p className="ch247-page__hint">Loading the extension catalogue…</p>}
          {extensions.status === 'error' && <p className="ch247-banner ch247-banner--error" role="alert">{extensions.message}</p>}

          {extensions.status === 'success' && filtered.length === 0 && (
            <div className="ch247-dsvc-provider-missing" role="status">
              <strong>No extensions are available yet.</strong>
              <p style={{ margin: '0.4rem 0 0' }}>
                The extension catalogue is synchronized from the connected registrar provider. Until a Super Admin
                connects a registrar and syncs the catalogue, there are no provider-confirmed extensions or prices to
                show — and none are invented here.
              </p>
            </div>
          )}

          {extensions.status === 'success' && filtered.length > 0 && (
            <div className="ch247-table-wrap">
              <table className="ch247-table">
                <thead>
                  <tr>
                    <th>Extension</th>
                    <th>Registration</th>
                    <th>Renewal</th>
                    <th>Transfer</th>
                    <th>Premium</th>
                    <th>Restrictions &amp; requirements</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <tr key={entry.id}>
                      <td>
                        <strong>{entry.extension}</strong>
                        {entry.isTrending && (
                          <>
                            {' '}
                            <span className="ch247-dsvc-trending">AI Trending</span>
                          </>
                        )}
                        {entry.description && (
                          <>
                            <br />
                            <small>{entry.description}</small>
                          </>
                        )}
                      </td>
                      <td>{formatPrice(entry.registrationPrice, entry.currency)}</td>
                      <td>{formatPrice(entry.renewalPrice, entry.currency)}</td>
                      <td>{formatPrice(entry.transferPrice, entry.currency)}</td>
                      <td>{entry.premiumSupported ? 'Supported' : '—'}</td>
                      <td>
                        {entry.restrictions && <small>Restrictions: {entry.restrictions}</small>}
                        {entry.registrationRequirements && (
                          <>
                            <br />
                            <small>Requirements: {entry.registrationRequirements}</small>
                          </>
                        )}
                        {!entry.restrictions && !entry.registrationRequirements && <small>Standard registration rules apply.</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
