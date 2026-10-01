import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { listCustomers } from '../lib/account-api';
import { ApiRequestError } from '../lib/api';
import type { AdminCustomerSummary } from '../lib/account-types';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import StatusBadge from '../components/StatusBadge';

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; customers: AdminCustomerSummary[]; total: number };

/**
 * Customer directory for staff (admin + super_admin) — see docs/API_CUSTOMER_APP.md
 * "Authorization model". This is available to any signed-in admin/super_admin account; a plain
 * customer account reaching this route (client-side navigation only — the server independently
 * re-verifies role on every request) sees RequireRole's "not available" message instead of this
 * component at all (see App.tsx and components/RequireRole.tsx).
 */
export default function AdminPage() {
  usePageMeta('Admin', 'CloudHost247 customer management.');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    listCustomers({ search: search || undefined, role: role || undefined })
      .then((res) => {
        if (!cancelled) setState({ status: 'success', customers: res.customers, total: res.total });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message:
              err instanceof ApiRequestError && err.status === 403
                ? 'Your account does not have permission to view the customer directory.'
                : err instanceof Error
                  ? err.message
                  : 'Something went wrong loading the customer directory.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [search, role]);

  function onSubmitSearch(e: FormEvent) {
    e.preventDefault();
    // Search/role state already drives the effect above on every keystroke change; this only
    // exists so pressing Enter in the search box doesn't submit a form navigation.
  }

  return (
    <div className="ch247-stack">
      <div className="ch247-card">
        <h1>Admin — Customers</h1>
        <p className="ch247-page__hint" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <Link to="/admin/apps">Applications &amp; marketplace →</Link>
          <Link to="/admin/deployments">Deployments →</Link>
          <Link to="/admin/servers">Servers →</Link>
          <Link to="/admin/control-panels">Control panels &amp; software →</Link>
          <Link to="/admin/infrastructure/operating-systems">Infrastructure &amp; operating systems →</Link>
          <Link to="/admin/infrastructure/provisioning">Server provisioning →</Link>
          <Link to="/admin/settings">Platform settings →</Link>
          <Link to="/admin/audit">Audit log →</Link>
          <Link to="/admin/tickets">Manage support tickets →</Link>
          <Link to="/admin/ai-support">AI support &amp; human handoffs →</Link>
          <Link to="/admin/invoices">Manage invoices & refunds →</Link>
          <Link to="/admin/revenue-guardian">Revenue Guardian — revenue recovery →</Link>
          <Link to="/admin/cloudflare">Cloudflare — reseller & zones →</Link>
          <Link to="/admin/ledger">Financial audit ledger →</Link>
        </p>

        <form className="ch247-inline-actions" onSubmit={onSubmitSearch} style={{ marginTop: '1rem' }}>
          <input
            placeholder="Search by name, email, phone or Customer ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 240px', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={{ padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
          >
            <option value="">All roles</option>
            <option value="customer">Customer</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super admin</option>
          </select>
        </form>

        {state.status === 'loading' && <CatalogLoadingBanner label="Loading customers…" />}
        {state.status === 'error' && <CatalogErrorBanner message={state.message} />}

        {state.status === 'success' && state.customers.length === 0 && (
          <p className="ch247-page__hint">No customers match this search.</p>
        )}

        {state.status === 'success' && state.customers.length > 0 && (
          <div className="ch247-table-wrap">
            <table className="ch247-table">
              <thead>
                <tr>
                  <th>Customer ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.customers.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.customerId ?? '—'}</td>
                    <td>{customer.fullName}</td>
                    <td>{customer.email}</td>
                    <td>{customer.role}</td>
                    <td>
                      <StatusBadge status={customer.status} />
                    </td>
                    <td>
                      <Link to={`/admin/customers/${customer.id}`}>Manage →</Link>
                    </td>
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
