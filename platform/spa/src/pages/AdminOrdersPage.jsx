import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { formatMoney, formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const STATUSES = ['', 'pending', 'paid', 'cancelled', 'failed', 'refunded'];

/**
 * Admin orders: every order across accounts, with the invoice and payment position per row.
 *
 * The filters map to the list route's own query parameters, so search and date narrowing happen in
 * the store rather than in the browser.
 */
export default function AdminOrdersPage() {
  const [orders, setOrders] = useState(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (filters) => {
    setError('');
    try {
      const res = await adminApi.adminOrders(filters ?? {});
      setOrders(res.orders ?? []);
      setTotal(res.total ?? 0);
    } catch (e) {
      setOrders([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const applyFilters = async (e) => {
    e.preventDefault();
    await load({ ...(status ? { status } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}) });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Orders</h1>
          <p className="muted">Customer orders with their invoice and payment position.</p>
        </div>
        <Link className="btn btn-ghost" to="/admin/billing">Billing</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      <form className="card" onSubmit={applyFilters}>
        <div className="grid-2">
          <div className="field">
            <label htmlFor="ord-status">Status</label>
            <select id="ord-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUSES.map((s) => <option key={s || 'all'} value={s}>{s || 'all'}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ord-ref">Reference contains</label>
            <input id="ord-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ORD-…" />
          </div>
        </div>
        <button className="btn btn-primary" type="submit">Apply filters</button>
      </form>

      <section className="card">
        <h2>Orders ({total})</h2>
        {orders === null ? (
          <p className="muted">Loading orders…</p>
        ) : orders.length === 0 ? (
          <p className="muted">No orders match.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Total</th>
                  <th scope="col">Invoice</th>
                  <th scope="col">Payment</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td><strong>{order.reference}</strong></td>
                    <td>{order.userEmail ?? order.userId ?? '—'}</td>
                    <td>{formatMoney(order.total, order.currency)}</td>
                    <td>
                      {order.invoiceId
                        ? <Link to={`/admin/billing/invoices/${order.invoiceId}`}>{order.invoiceNumber ?? order.invoiceId}</Link>
                        : '—'}
                    </td>
                    <td>{order.paymentStatus}</td>
                    <td><span className={statusClass(order.status)}>{humanizeStatus(order.status)}</span></td>
                    <td>{formatDate(order.createdAt, { withTime: true })}</td>
                    <td><Link className="btn btn-ghost" to={`/admin/orders/${order.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
