import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import {
  createCustomerDomain,
  createCustomerService,
  getCustomerDetail,
  setCustomerRole,
  setCustomerStatus,
  updateCustomerDomain,
  updateCustomerService,
} from '../lib/account-api';
import { ApiRequestError } from '../lib/api';
import { useAuthState } from '../layout/useAuthState';
import type { AdminCustomerDetail, AdminCustomerDomain, AdminCustomerService } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';
import AdminCustomerIdentityPanel from '../components/AdminCustomerIdentityPanel';

type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'success'; detail: AdminCustomerDetail };

const SERVICE_STATUSES = ['active', 'suspended', 'cancelled', 'pending_migration'] as const;
const DOMAIN_STATUSES = ['active', 'expired', 'pending_transfer', 'pending_migration'] as const;

/**
 * Staff-side customer detail + management page (admin + super_admin) — see
 * docs/API_CUSTOMER_APP.md. Every mutation here (service/domain create-edit, status/role change)
 * only ever writes a passive, informational record: nothing on this page provisions a real
 * hosting service, registers/renews a domain, or touches billing.
 */
export default function AdminCustomerDetailPage() {
  const { id = '' } = useParams();
  const { user: viewer } = useAuthState();
  usePageMeta('Manage customer', 'Manage a CloudHost247 customer account.');
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [actionMessage, setActionMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getCustomerDetail(id)
      .then((detail) => setState({ status: 'success', detail }))
      .catch((err: unknown) =>
        setState({
          status: 'error',
          message:
            err instanceof ApiRequestError && err.status === 404
              ? 'No customer account was found with that id.'
              : err instanceof Error
                ? err.message
                : 'Something went wrong loading this customer.',
        })
      );
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const isSuperAdmin = viewer?.role === 'super_admin';
  const isSelf = viewer?.id === id;

  async function onSetStatus(status: 'active' | 'suspended' | 'disabled') {
    setActionMessage(null);
    try {
      await setCustomerStatus(id, status);
      setActionMessage({ kind: 'ok', text: `Account status set to ${status}.` });
      load();
    } catch (err) {
      setActionMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not change account status.' });
    }
  }

  async function onSetRole(role: 'customer' | 'admin' | 'super_admin') {
    setActionMessage(null);
    try {
      await setCustomerRole(id, role);
      setActionMessage({ kind: 'ok', text: `Role set to ${role}.` });
      load();
    } catch (err) {
      setActionMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not change the role.' });
    }
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <p>
          <Link to="/admin">← Back to Customers</Link>
        </p>

        {state.status === 'loading' && <CatalogLoadingBanner label="Loading customer…" />}
        {state.status === 'error' && <CatalogErrorBanner message={state.message} />}

        {state.status === 'success' && (
          <>
            <h1>{state.detail.customer.fullName}</h1>
            <dl className="ch247-definition-list">
              <dt>Customer ID</dt>
              <dd>{state.detail.customer.customerId ?? '—'}</dd>
              <dt>Email</dt>
              <dd>{state.detail.customer.email}</dd>
              <dt>Role</dt>
              <dd>{state.detail.customer.role}</dd>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={state.detail.customer.status} />
              </dd>
            </dl>

            {isSuperAdmin ? (
              <div className="ch247-inline-actions">
                <button
                  type="button"
                  className="ch247-button ch247-button--outline ch247-button--small"
                  onClick={() => onSetStatus('active')}
                >
                  Set active
                </button>
                <button
                  type="button"
                  className="ch247-button ch247-button--outline ch247-button--small"
                  onClick={() => onSetStatus('suspended')}
                >
                  Suspend
                </button>
                <button
                  type="button"
                  className="ch247-button ch247-button--danger ch247-button--small"
                  onClick={() => onSetStatus('disabled')}
                >
                  Disable
                </button>
                {!isSelf && (
                  <select
                    defaultValue=""
                    onChange={(e) => {
                      if (e.target.value) onSetRole(e.target.value as 'customer' | 'admin' | 'super_admin');
                      e.target.value = '';
                    }}
                    style={{ padding: '0.4rem 0.6rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                  >
                    <option value="" disabled>
                      Change role…
                    </option>
                    <option value="customer">customer</option>
                    <option value="admin">admin</option>
                    <option value="super_admin">super_admin</option>
                  </select>
                )}
                {isSelf && <span className="ch247-page__hint">You cannot change your own role.</span>}
              </div>
            ) : (
              <p className="ch247-page__hint">
                Account status and role changes are only available to super_admin accounts.
              </p>
            )}
            {actionMessage && (
              <p className={actionMessage.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{actionMessage.text}</p>
            )}
          </>
        )}
      </div>

      {state.status === 'success' && (
        <AdminCustomerIdentityPanel customer={state.detail.customer} isSuperAdmin={isSuperAdmin} />
      )}

      {state.status === 'success' && (
        <>
          <ServiceManager customerId={id} services={state.detail.services} onChanged={load} />
          <DomainManager customerId={id} domains={state.detail.domains} onChanged={load} />

          <div className="ch247-card">
            <h2>Tickets</h2>
            {state.detail.tickets.length === 0 && <p className="ch247-page__hint">No tickets from this customer yet.</p>}
            {state.detail.tickets.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {state.detail.tickets.map((ticket) => (
                  <li key={ticket.id}>
                    <Link to={`/admin/tickets/${ticket.id}`}>{ticket.subject}</Link> — <StatusBadge status={ticket.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ServiceManager({
  customerId,
  services,
  onChanged,
}: {
  customerId: string;
  services: AdminCustomerService[];
  onChanged: () => void;
}) {
  const [label, setLabel] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await createCustomerService(customerId, { label });
      setLabel('');
      setMessage({ kind: 'ok', text: 'Service record added.' });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not add service record.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function onChangeStatus(serviceId: string, status: (typeof SERVICE_STATUSES)[number]) {
    setMessage(null);
    try {
      await updateCustomerService(customerId, serviceId, { status });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not update service status.' });
    }
  }

  return (
    <div className="ch247-card">
      <h2>Services</h2>
      <p className="ch247-page__hint">
        Staff-entered informational record only — adding a service here never provisions or
        activates anything automatically.
      </p>
      {services.length > 0 && (
        <div className="ch247-table-wrap">
          <table className="ch247-table">
            <thead>
              <tr>
                <th>Service</th>
                <th>Status</th>
                <th>Change status</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => (
                <tr key={service.id}>
                  <td>{service.label}</td>
                  <td>
                    <StatusBadge status={service.status} />
                  </td>
                  <td>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) onChangeStatus(service.id, e.target.value as (typeof SERVICE_STATUSES)[number]);
                        e.target.value = '';
                      }}
                      style={{ padding: '0.35rem 0.5rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                    >
                      <option value="" disabled>
                        Set status…
                      </option>
                      {SERVICE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="ch247-inline-actions" onSubmit={onCreate} style={{ marginTop: '1rem' }}>
        <input
          placeholder="Service label (e.g. cPanel Hosting — Plan A)"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          required
          maxLength={255}
          style={{ flex: '1 1 260px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
        />
        <button type="submit" className="ch247-button ch247-button--small" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add service'}
        </button>
      </form>
      {message && <p className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{message.text}</p>}
    </div>
  );
}

function DomainManager({
  customerId,
  domains,
  onChanged,
}: {
  customerId: string;
  domains: AdminCustomerDomain[];
  onChanged: () => void;
}) {
  const [domainName, setDomainName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      await createCustomerDomain(customerId, { domainName });
      setDomainName('');
      setMessage({ kind: 'ok', text: 'Domain record added.' });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not add domain record.' });
    } finally {
      setSubmitting(false);
    }
  }

  async function onChangeStatus(domainId: string, status: (typeof DOMAIN_STATUSES)[number]) {
    setMessage(null);
    try {
      await updateCustomerDomain(customerId, domainId, { status });
      onChanged();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Could not update domain status.' });
    }
  }

  return (
    <div className="ch247-card">
      <h2>Domains</h2>
      <p className="ch247-page__hint">
        Staff-entered informational record only — this never registers, renews, or verifies a
        domain with any registrar.
      </p>
      {domains.length > 0 && (
        <div className="ch247-table-wrap">
          <table className="ch247-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Status</th>
                <th>Change status</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((domain) => (
                <tr key={domain.id}>
                  <td>{domain.domainName}</td>
                  <td>
                    <StatusBadge status={domain.status} />
                  </td>
                  <td>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) onChangeStatus(domain.id, e.target.value as (typeof DOMAIN_STATUSES)[number]);
                        e.target.value = '';
                      }}
                      style={{ padding: '0.35rem 0.5rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                    >
                      <option value="" disabled>
                        Set status…
                      </option>
                      {DOMAIN_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form className="ch247-inline-actions" onSubmit={onCreate} style={{ marginTop: '1rem' }}>
        <input
          placeholder="Domain name (e.g. example.com)"
          value={domainName}
          onChange={(e) => setDomainName(e.target.value)}
          required
          maxLength={255}
          style={{ flex: '1 1 260px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
        />
        <button type="submit" className="ch247-button ch247-button--small" disabled={submitting}>
          {submitting ? 'Adding…' : 'Add domain'}
        </button>
      </form>
      {message && <p className={message.kind === 'ok' ? 'ch247-status-ok' : 'ch247-status-error'}>{message.text}</p>}
    </div>
  );
}
