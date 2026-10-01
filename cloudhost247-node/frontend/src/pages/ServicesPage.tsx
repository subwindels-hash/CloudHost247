import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { useApiResource } from '../lib/useApiResource';
import type { CustomerService } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';

export default function ServicesPage() {
  usePageMeta('My Services', 'Manage your CloudHost247 servers, control panels, and cloud hosting services.');
  const services = useApiResource<{ services: CustomerService[] }>('/api/v1/account/services');

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <div className="ch247-card__header-flex">
          <div>
            <h1>My Services</h1>
            <p className="ch247-page__hint">
              Active hosting instances, provisioned virtual servers, and deployed control panels connected to your account.
            </p>
          </div>
          <div className="ch247-card__actions">
            <Link to="/servers/new" className="ch247-button">
              + Deploy New Server
            </Link>
          </div>
        </div>

        {services.status === 'loading' && <CatalogLoadingBanner label="Loading your services…" />}
        {services.status === 'error' && <CatalogErrorBanner message={services.message} />}

        {services.status === 'success' && services.data.services.length === 0 && (
          <div className="ch247-empty">
            <p className="ch247-page__hint">No services have been added to your account yet. Active hosting instances, provisioned virtual servers, and deployed control panels will appear here.</p>
            <div style={{ marginTop: '1rem' }}>
              <Link to="/hosting/control-panels" className="ch247-button ch247-button--secondary" style={{ marginRight: '0.75rem' }}>
                Browse Control Panels
              </Link>
              <Link to="/servers/new" className="ch247-button">
                Deploy a Cloud Server
              </Link>
            </div>
          </div>
        )}

        {services.status === 'success' && services.data.services.length > 0 && (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Service &amp; Hostname</th>
                  <th>IP Address</th>
                  <th>Control Panel</th>
                  <th>Plan &amp; Cycle</th>
                  <th>Status</th>
                  <th>Next Due</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {services.data.services.map((service) => {
                  const targetId = service.serverId ?? service.id;
                  const panelPort = service.panelSlug === 'cpanel' ? 2087
                    : service.panelSlug === 'plesk' ? 8443
                    : service.panelSlug === 'directadmin' ? 2222
                    : service.panelSlug === 'cyberpanel' ? 8090
                    : service.panelSlug === 'hestiacp' ? 8083
                    : service.panelSlug === 'cloudpanel' ? 8443
                    : service.panelSlug === 'aapanel' ? 7800
                    : service.panelSlug === 'fastpanel' ? 8888
                    : service.panelSlug === 'dokploy' ? 3000
                    : service.panelSlug === 'coolify' ? 8000
                    : service.panelSlug === 'easypanel' ? 3000
                    : 8443;
                  const panelUrl = service.serverIp
                    ? `https://${service.serverIp}:${panelPort}`
                    : null;

                  return (
                    <tr key={service.id}>
                      <td>
                        <strong>{service.label}</strong>
                        {service.hostname && (
                          <div className="ch247-text-muted" style={{ fontSize: '0.85rem' }}>
                            {service.hostname}
                          </div>
                        )}
                        {service.domain && !service.hostname && (
                          <div className="ch247-text-muted" style={{ fontSize: '0.85rem' }}>
                            {service.domain}
                          </div>
                        )}
                      </td>
                      <td>
                        {service.serverIp ? (
                          <code>{service.serverIp}</code>
                        ) : (
                          <span className="ch247-text-muted">—</span>
                        )}
                      </td>
                      <td>
                        {service.panelName ? (
                          <span className="ch247-tag">{service.panelName}</span>
                        ) : (
                          <span className="ch247-text-muted">—</span>
                        )}
                      </td>
                      <td>
                        <div>
                          {service.productName && service.planName
                            ? `${service.productName} — ${service.planName}`
                            : (service.planName ?? service.productName ?? 'Custom Plan')}
                        </div>
                        {service.billingCycle && (
                          <span className="ch247-text-muted" style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>
                            {service.billingCycle}
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusBadge status={service.status} />
                      </td>
                      <td>
                        {service.nextDueDate
                          ? new Date(service.nextDueDate).toLocaleDateString()
                          : new Date(service.createdAt).toLocaleDateString()}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <Link
                            to={`/dashboard/servers/${targetId}`}
                            className="ch247-btn ch247-btn--sm ch247-btn--secondary"
                          >
                            Manage
                          </Link>
                          {panelUrl && service.status.toLowerCase() === 'active' && (
                            <a
                              href={panelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ch247-btn ch247-btn--sm ch247-btn--primary"
                            >
                              Open Panel ↗
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
