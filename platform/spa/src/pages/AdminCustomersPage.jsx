import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const ROLES = ['', 'customer', 'staff', 'admin', 'super_admin'];
const PAGE_SIZE = 25;

/**
 * The customer directory: the page a support agent lives in.
 *
 * Search is server-side (email, full name or customer id) and the role filter narrows the list; the
 * page never fetches "all customers" and filters in the browser, because that would not scale and
 * would hide the server's own scoping rules.
 */
export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState(null);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(async (params) => {
    setError('');
    try {
      const data = await adminApi.customers({ ...params, limit: PAGE_SIZE });
      setCustomers(data.customers);
      setTotal(data.total);
    } catch (err) {
      setError(describeError(err));
      setCustomers([]);
    }
  }, []);

  useEffect(() => { load({ search, role, offset }); }, [load, search, role, offset]);

  const submit = (event) => {
    event.preventDefault();
    setOffset(0);
    load({ search, role, offset: 0 });
  };

  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + PAGE_SIZE, total);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Customers</h1>
          <p className="muted">Directory of every account, with the staff actions each role allows.</p>
        </div>
        <Link className="btn btn-ghost" to="/admin/tickets">Ticket queue</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <section className="card">
        <form className="row row-wrap" onSubmit={submit}>
          <div className="field">
            <label htmlFor="search">Search</label>
            <input
              id="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Email, name or customer ID"
            />
          </div>
          <div className="field">
            <label htmlFor="role">Role</label>
            <select id="role" value={role} onChange={(event) => { setRole(event.target.value); setOffset(0); }}>
              {ROLES.map((r) => <option key={r || 'any'} value={r}>{r || 'Any role'}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
      </section>

      <section className="card">
        <h2>{total} account{total === 1 ? '' : 's'}</h2>
        {customers === null ? <p className="muted">Loading customers…</p> : customers.length === 0 ? (
          <p className="muted">No customers match that search.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Customer</th>
                    <th scope="col">Email</th>
                    <th scope="col">Customer ID</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr key={customer.id}>
                      <td><Link to={`/admin/customers/${encodeURIComponent(customer.id)}`}>{customer.fullName}</Link></td>
                      <td>{customer.email}</td>
                      <td><code>{customer.customerId ?? '—'}</code></td>
                      <td>{humanizeStatus(customer.role)}</td>
                      <td><span className={statusClass(customer.status)}>{humanizeStatus(customer.status)}</span></td>
                      <td>{formatDate(customer.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row row-wrap" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <span className="muted">Showing {shownFrom}–{shownTo} of {total}</span>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={shownTo >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
