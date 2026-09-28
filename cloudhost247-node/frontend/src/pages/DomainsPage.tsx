import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import type { CustomerDomain } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';

/**
 * Real, API-backed list of the signed-in customer's `customer_domains` records (Phase 4) — the
 * account view of domains staff say you own. This has no connection to a domain registrar: no
 * live availability check, registration, renewal, or transfer happens through this page. See the
 * public /domains page for general domain information, and docs/API_CUSTOMER_APP.md for the full
 * contract.
 */
export default function DomainsPage() {
  usePageMeta('My Domains', 'The domains on your CloudHost247 account.');
  const domains = useApiResource<{ domains: CustomerDomain[] }>('/api/v1/account/domains');

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>My Domains</h1>
        <p className="ch247-page__hint">
          Domains shown here are entered and maintained by CloudHost247 staff as an informational
          record of what you own — this page has no live connection to a domain registrar.
        </p>

        {domains.status === 'loading' && <CatalogLoadingBanner label="Loading your domains…" />}
        {domains.status === 'error' && <CatalogErrorBanner message={domains.message} />}

        {domains.status === 'success' && domains.data.domains.length === 0 && (
          <p className="ch247-page__hint">No domains have been added to your account yet.</p>
        )}

        {domains.status === 'success' && domains.data.domains.length > 0 && (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Registrar</th>
                  <th>Status</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                {domains.data.domains.map((domain) => (
                  <tr key={domain.id}>
                    <td>{domain.domainName}</td>
                    <td>{domain.registrar ?? '—'}</td>
                    <td>
                      <StatusBadge status={domain.status} />
                    </td>
                    <td>{domain.expiresAt ? new Date(domain.expiresAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
