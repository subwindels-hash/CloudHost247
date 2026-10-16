import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { formatMoney, formatDate, humanizeStatus, statusClass } from '../lib/format.js';

const STATUSES = ['', 'unpaid', 'paid', 'refunded', 'void', 'cancelled'];

/**
 * Admin billing: global invoices with the money position beside them.
 *
 * Reconciliation is the ledger's own arithmetic (charges vs payments vs refunds vs credits per
 * currency) — never a restatement of mutable invoice fields.
 */
export default function AdminBillingPage() {
  const [invoices, setInvoices] = useState(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [recon, setRecon] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async (statusFilter) => {
    setError('');
    try {
      const [list, rec] = await Promise.all([
        adminApi.adminInvoices(statusFilter ? { status: statusFilter } : {}),
        adminApi.adminReconciliation(),
      ]);
      setInvoices(list.invoices ?? []);
      setTotal(list.total ?? 0);
      setRecon(rec);
    } catch (e) {
      setInvoices([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Billing</h1>
          <p className="muted">Invoices across all accounts, with the ledger's money position.</p>
        </div>
        <Link className="btn btn-ghost" to="/admin/billing/ledger">Ledger</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {recon && (
        <section className="card">
          <h2>Money position (USD)</h2>
          <dl className="detail-list">
            <dt>Charges</dt><dd>{formatMoney(recon.charges)}</dd>
            <dt>Payments</dt><dd>{formatMoney(recon.payments)}</dd>
            <dt>Refunds</dt><dd>{formatMoney(recon.refunds)}</dd>
            <dt>Credits</dt><dd>{formatMoney(recon.credits)}</dd>
            <dt>Outstanding</dt><dd><strong>{formatMoney(recon.outstanding)}</strong></dd>
          </dl>
          {Object.keys(recon.otherCurrencies ?? {}).length > 0 && (
            <p className="muted">Other currencies: {Object.entries(recon.otherCurrencies).map(([code, t]) => `${code} outstanding ${t.outstanding}`).join(' · ')}</p>
          )}
          <p className="muted">{recon.note}</p>
        </section>
      )}

      <section className="card">
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h2>Invoices ({total})</h2>
          <div className="field" style={{ minWidth: 180 }}>
            <label htmlFor="inv-status">Status</label>
            <select id="inv-status" value={status} onChange={(e) => { setStatus(e.target.value); load(e.target.value); }}>
              {STATUSES.map((s) => <option key={s || 'all'} value={s}>{s || 'all'}</option>)}
            </select>
          </div>
        </div>
        {invoices === null ? (
          <p className="muted">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <p className="muted">No invoices match.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Number</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Total</th>
                  <th scope="col">Paid</th>
                  <th scope="col">Due</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td><strong>{inv.number}</strong></td>
                    <td>{inv.userId}</td>
                    <td>{formatMoney(inv.total, inv.currency)}</td>
                    <td>{formatMoney(inv.amountPaid ?? 0, inv.currency)}</td>
                    <td>{formatDate(inv.dueAt)}</td>
                    <td><span className={statusClass(inv.status)}>{humanizeStatus(inv.status)}</span></td>
                    <td><Link className="btn btn-ghost" to={`/admin/billing/invoices/${inv.id}`}>Open</Link></td>
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
