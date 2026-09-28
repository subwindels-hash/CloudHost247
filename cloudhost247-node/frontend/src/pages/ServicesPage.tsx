import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import type { CustomerService } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';

/**
 * Real, API-backed list of the signed-in customer's `customer_services` records (Phase 4). These
 * are passive, staff-entered informational records only — see docs/API_CUSTOMER_APP.md — never
 * evidence that CloudHost247 automatically provisioned or verified anything, and there is
 * deliberately no "create"/"edit" control here: only staff (admin/super_admin) can add or change
 * a service record, from /admin.
 */
export default function ServicesPage() {
  usePageMeta('Services', 'The hosting and other services on your CloudHost247 account.');
  const services = useApiResource<{ services: CustomerService[] }>('/api/v1/account/services');

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Services</h1>
        <p className="ch247-page__hint">
          Services shown here are entered and maintained by CloudHost247 staff as an informational
          record of what you have — this page does not provision, activate, or verify anything
          automatically.
        </p>

        {services.status === 'loading' && <CatalogLoadingBanner label="Loading your services…" />}
        {services.status === 'error' && <CatalogErrorBanner message={services.message} />}

        {services.status === 'success' && services.data.services.length === 0 && (
          <p className="ch247-page__hint">No services have been added to your account yet.</p>
        )}

        {services.status === 'success' && services.data.services.length > 0 && (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Product / plan</th>
                  <th>Status</th>
                  <th>Reference</th>
                  <th>Added</th>
                </tr>
              </thead>
              <tbody>
                {services.data.services.map((service) => (
                  <tr key={service.id}>
                    <td>{service.label}</td>
                    <td>
                      {service.productName
                        ? `${service.productName}${service.planName ? ` — ${service.planName}` : ''}`
                        : '—'}
                    </td>
                    <td>
                      <StatusBadge status={service.status} />
                    </td>
                    <td>{service.externalReference ?? '—'}</td>
                    <td>{new Date(service.createdAt).toLocaleDateString()}</td>
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
