import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { useAuth } from '../lib/useAuth.jsx';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';
import { begin as beginSupportSession } from '../lib/support-session.js';

const SERVICE_STATUSES = ['active', 'suspended', 'cancelled', 'pending_migration'];
const DOMAIN_STATUSES = ['active', 'expired', 'pending_transfer', 'pending_migration'];
const ACCOUNT_STATUSES = ['active', 'suspended', 'disabled'];
const ROLES = ['customer', 'staff', 'admin', 'super_admin'];

/**
 * One customer, as staff see them.
 *
 * What this page may do is decided entirely by the signed-in admin's role, and the page says so
 * instead of hiding the controls: super_admins get status/role changes (never on themselves — the
 * server refuses, and that refusal is shown), everyone at staff level gets the passive service and
 * domain records, and admins additionally get "switch to customer", which parks their own session
 * and continues as the customer in this tab.
 */
export default function AdminCustomerDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [products, setProducts] = useState([]);
  const [plans, setPlans] = useState({});
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [switchReason, setSwitchReason] = useState('');

  const isSuperAdmin = user?.role === 'super_admin';
  const isAdmin = user?.role === 'admin' || isSuperAdmin;

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await adminApi.customer(id));
    } catch (err) {
      setError(describeError(err));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // The admin catalog is admin-only on the server, so only admins get the product picker.
  useEffect(() => {
    if (!isAdmin) return;
    adminApi.catalogProducts()
      .then((res) => setProducts(res.products))
      .catch(() => setProducts([]));
  }, [isAdmin]);

  const loadPlans = async (productId) => {
    if (!productId || plans[productId]) return;
    try {
      const res = await adminApi.catalogProduct(productId);
      setPlans((p) => ({ ...p, [productId]: res.plans }));
    } catch {
      setPlans((p) => ({ ...p, [productId]: [] }));
    }
  };

  const run = async (key, fn, okMessage) => {
    setError('');
    setMessage('');
    setBusy(key);
    try {
      await fn();
      if (okMessage) setMessage(okMessage);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  };

  const addService = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { label: String(form.get('label') ?? '').trim() };
    const status = String(form.get('serviceStatus') ?? '');
    if (status) payload.status = status;
    const productId = String(form.get('productId') ?? '');
    if (productId) payload.productId = productId;
    const planId = String(form.get('planId') ?? '');
    if (planId) payload.planId = planId;
    const notes = String(form.get('notes') ?? '').trim();
    if (notes) payload.notes = notes;
    run('add-service', async () => {
      await adminApi.createCustomerService(id, payload);
      event.currentTarget.reset();
    }, 'Service record added.');
  };

  const addDomain = (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { domainName: String(form.get('domainName') ?? '').trim() };
    const registrar = String(form.get('registrar') ?? '').trim();
    if (registrar) payload.registrar = registrar;
    const status = String(form.get('domainStatus') ?? '');
    if (status) payload.status = status;
    const expiresAt = String(form.get('expiresAt') ?? '').trim();
    if (expiresAt) payload.expiresAt = new Date(expiresAt).toISOString();
    run('add-domain', async () => {
      await adminApi.createCustomerDomain(id, payload);
      event.currentTarget.reset();
    }, 'Domain record added.');
  };

  const switchToCustomer = async () => {
    setError('');
    setMessage('');
    setBusy('switch');
    try {
      const session = await adminApi.switchToCustomer(id, switchReason.trim() || undefined);
      beginSupportSession({
        delegatedAccessToken: session.accessToken,
        customer: session.customer,
        sessionId: session.supportSessionId,
      });
      // A full reload is deliberate: every page re-reads its data as the customer, and the banner
      // in App.jsx picks up the parked admin session from sessionStorage.
      window.location.assign('/app/account');
    } catch (err) {
      setError(describeError(err));
      setBusy('');
    }
  };

  if (data === null) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Customer</h1></div></div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : <p className="muted">Loading customer…</p>}
        <Link className="linklike" to="/admin/customers">Back to customers</Link>
      </div>
    );
  }

  const { customer, services, domains, tickets } = data;
  const isSelf = user?.id === customer.id;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{customer.fullName}</h1>
          <p className="muted">
            {customer.email} · customer ID <code>{customer.customerId ?? '—'}</code> · joined {formatDate(customer.createdAt)}
          </p>
        </div>
        <div className="row">
          <span className={statusClass(customer.status)}>{humanizeStatus(customer.status)}</span>
          <span className="pill">{humanizeStatus(customer.role)}</span>
        </div>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}

      <div className="grid-2">
        <section className="card">
          <h2>Account integrity</h2>
          {isSuperAdmin ? (
            <>
              <div className="field">
                <label htmlFor="account-status">Status</label>
                <select
                  id="account-status"
                  value={customer.status}
                  disabled={busy === 'status'}
                  onChange={(event) => run('status', () => adminApi.setCustomerStatus(id, event.target.value), 'Status updated.')}
                >
                  {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="account-role">Role</label>
                <select
                  id="account-role"
                  value={customer.role}
                  disabled={busy === 'role' || isSelf}
                  onChange={(event) => run('role', () => adminApi.setCustomerRole(id, event.target.value), 'Role updated.')}
                >
                  {ROLES.map((r) => <option key={r} value={r}>{humanizeStatus(r)}</option>)}
                </select>
                {isSelf && <p className="muted">You cannot change your own role — ask another super admin if you need it changed.</p>}
              </div>
              <p className="muted">
                Suspending or disabling an account blocks sign-in immediately; both actions are audited.
              </p>
            </>
          ) : (
            <p className="muted">
              Status and role changes are limited to super admins. Service and domain records below are yours to maintain.
            </p>
          )}
        </section>

        <section className="card">
          <h2>Act as this customer</h2>
          {isAdmin ? (
            <>
              <p className="muted">
                Starts a one-hour delegated session. Your own session is parked in this tab and the
                banner at the top brings you back; the customer session cannot refresh your identity.
              </p>
              <div className="field">
                <label htmlFor="reason">Reason (recorded with the session)</label>
                <input id="reason" value={switchReason} onChange={(e) => setSwitchReason(e.target.value)} placeholder="Ticket #1234" />
              </div>
              <button type="button" className="btn btn-primary" disabled={busy === 'switch'} onClick={switchToCustomer}>
                {busy === 'switch' ? 'Switching…' : 'Switch to customer'}
              </button>
            </>
          ) : (
            <p className="muted">Only admins and super admins may delegate into a customer session.</p>
          )}
        </section>
      </div>

      <section className="card">
        <h2>Services</h2>
        {services.length === 0 ? <p className="muted">No service records.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Label</th>
                  <th scope="col">Product / plan</th>
                  <th scope="col">Domain</th>
                  <th scope="col">Next due</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td>{service.label ?? '—'}</td>
                    <td>
                      {service.productName ?? '—'}
                      {service.planName ? ` · ${service.planName}` : ''}
                    </td>
                    <td>{service.domain ?? service.hostname ?? '—'}</td>
                    <td>{formatDate(service.nextDueDate)}</td>
                    <td>
                      <select
                        aria-label={`Status for ${service.label ?? service.id}`}
                        value={service.status}
                        disabled={busy === service.id}
                        onChange={(event) => run(service.id, () => adminApi.updateCustomerService(id, service.id, { status: event.target.value }), 'Service updated.')}
                      >
                        {SERVICE_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3>Add a service record</h3>
        <form onSubmit={addService}>
          <div className="row row-wrap">
            <div className="field">
              <label htmlFor="label">Label</label>
              <input id="label" name="label" required maxLength={255} placeholder="Starter hosting" />
            </div>
            <div className="field">
              <label htmlFor="serviceStatus">Status</label>
              <select id="serviceStatus" name="serviceStatus" defaultValue="active">
                {SERVICE_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
              </select>
            </div>
            {isAdmin && (
              <div className="field">
                <label htmlFor="productId">Product (optional)</label>
                <select id="productId" name="productId" onChange={(event) => loadPlans(event.target.value)}>
                  <option value="">None</option>
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
              </div>
            )}
            {isAdmin && (
              <div className="field">
                <label htmlFor="planId">Plan (optional)</label>
                <select id="planId" name="planId">
                  <option value="">None</option>
                  {Object.values(plans).flat().map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <input id="notes" name="notes" maxLength={4000} />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy === 'add-service'}>Add service</button>
        </form>
      </section>

      <section className="card">
        <h2>Domains</h2>
        {domains.length === 0 ? <p className="muted">No domain records.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Domain</th>
                  <th scope="col">Registrar</th>
                  <th scope="col">Expires</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((domain) => (
                  <tr key={domain.id}>
                    <td>{domain.domainName}</td>
                    <td>{domain.registrar ?? '—'}</td>
                    <td>{formatDate(domain.expiresAt)}</td>
                    <td>
                      <select
                        aria-label={`Status for ${domain.domainName}`}
                        value={domain.status}
                        disabled={busy === domain.id}
                        onChange={(event) => run(domain.id, () => adminApi.updateCustomerDomain(id, domain.id, { status: event.target.value }), 'Domain updated.')}
                      >
                        {DOMAIN_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3>Add a domain record</h3>
        <form onSubmit={addDomain}>
          <div className="row row-wrap">
            <div className="field">
              <label htmlFor="domainName">Domain</label>
              <input id="domainName" name="domainName" required placeholder="example.com" />
            </div>
            <div className="field">
              <label htmlFor="registrar">Registrar</label>
              <input id="registrar" name="registrar" placeholder="CloudHost247" />
            </div>
            <div className="field">
              <label htmlFor="domainStatus">Status</label>
              <select id="domainStatus" name="domainStatus" defaultValue="active">
                {DOMAIN_STATUSES.map((s) => <option key={s} value={s}>{humanizeStatus(s)}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="expiresAt">Expires</label>
              <input id="expiresAt" name="expiresAt" type="date" />
            </div>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy === 'add-domain'}>Add domain</button>
        </form>
      </section>

      <section className="card">
        <h2>Support tickets</h2>
        {tickets.length === 0 ? <p className="muted">No tickets from this customer.</p> : (
          <ul className="list">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <span>
                  <Link to={`/admin/tickets/${encodeURIComponent(ticket.id)}`}>{ticket.subject}</Link>
                  <span className="muted"> {ticket.reference ?? ''}</span>
                </span>
                <span className={statusClass(ticket.status)}>{humanizeStatus(ticket.status)}</span>
              </li>
            ))}
          </ul>
        )}
        <Link className="linklike" to="/admin/tickets">Open the ticket queue</Link>
      </section>
    </div>
  );
}
