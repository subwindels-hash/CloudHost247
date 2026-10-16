import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { formatMoney, formatDate } from '../lib/format.js';

/**
 * The append-only billing ledger and the reconciliation computed from it.
 *
 * The ledger is the record of money events (charge / payment / refund / credit); reconciliation
 * sums those entries per currency. Other currencies are totalled separately and never folded into
 * the USD figures — a position stated in the wrong unit is not a position.
 */
export default function AdminLedgerPage() {
  const [entries, setEntries] = useState(null);
  const [recon, setRecon] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ entryType: '', userId: '', invoiceId: '', fromDate: '', toDate: '' });

  const load = useCallback(async (params = {}) => {
    setError('');
    try {
      const [ledger, rec] = await Promise.all([adminApi.adminLedger(params), adminApi.adminReconciliation()]);
      setEntries(ledger.ledger ?? []);
      setRecon(rec);
    } catch (e) {
      setEntries([]);
      setError(describeError(e));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const applyFilters = (e) => {
    e.preventDefault();
    const params = {};
    for (const [key, value] of Object.entries(filters)) {
      if (String(value).trim()) params[key] = String(value).trim();
    }
    load(params);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Ledger</h1>
          <p className="muted">Append-only money events and the position computed from them.</p>
        </div>
        <Link className="btn btn-ghost" to="/admin/billing">Invoices</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {recon && (
        <section className="card">
          <h2>Reconciliation</h2>
          <dl className="detail-list">
            <dt>Charges</dt><dd>{formatMoney(recon.charges)}</dd>
            <dt>Payments</dt><dd>{formatMoney(recon.payments)}</dd>
            <dt>Refunds</dt><dd>{formatMoney(recon.refunds)}</dd>
            <dt>Credits</dt><dd>{formatMoney(recon.credits)}</dd>
            <dt>Outstanding</dt><dd><strong>{formatMoney(recon.outstanding)}</strong></dd>
            <dt>Entries counted</dt><dd>{recon.entries}</dd>
          </dl>
          {Object.entries(recon.otherCurrencies ?? {}).map(([code, totals]) => (
            <div key={code}>
              <h3>{code} (separate)</h3>
              <dl className="detail-list">
                <dt>Charges</dt><dd>{totals.charges}</dd>
                <dt>Payments</dt><dd>{totals.payments}</dd>
                <dt>Refunds</dt><dd>{totals.refunds}</dd>
                <dt>Outstanding</dt><dd>{totals.outstanding}</dd>
              </dl>
            </div>
          ))}
          <p className="muted">{recon.note}</p>
        </section>
      )}

      <section className="card">
        <h2>Entries</h2>
        <form className="row row-wrap" onSubmit={applyFilters} aria-label="Ledger filters">
          <div className="field">
            <label htmlFor="led-type">Entry type</label>
            <select id="led-type" value={filters.entryType} onChange={(e) => setFilters((f) => ({ ...f, entryType: e.target.value }))}>
              <option value="">All</option>
              <option value="charge">charge</option>
              <option value="payment">payment</option>
              <option value="refund">refund</option>
              <option value="credit">credit</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="led-user">User ID</label>
            <input id="led-user" value={filters.userId} onChange={(e) => setFilters((f) => ({ ...f, userId: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="led-invoice">Invoice ID</label>
            <input id="led-invoice" value={filters.invoiceId} onChange={(e) => setFilters((f) => ({ ...f, invoiceId: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="led-from">From</label>
            <input id="led-from" type="date" value={filters.fromDate} onChange={(e) => setFilters((f) => ({ ...f, fromDate: e.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor="led-to">To</label>
            <input id="led-to" type="date" value={filters.toDate} onChange={(e) => setFilters((f) => ({ ...f, toDate: e.target.value }))} />
          </div>
          <button className="btn btn-ghost" type="submit">Apply filters</button>
        </form>
        {entries === null ? (
          <p className="muted">Loading ledger…</p>
        ) : entries.length === 0 ? (
          <p className="muted">No ledger entries yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Type</th>
                  <th scope="col">Amount</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Invoice</th>
                  <th scope="col">Description</th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td><strong>{entry.entryType}</strong></td>
                    <td>{formatMoney(entry.amount, entry.currency)}</td>
                    <td>{entry.userId ?? '—'}</td>
                    <td>
                      {entry.invoiceId
                        ? <Link to={`/admin/billing/invoices/${entry.invoiceId}`}>Open</Link>
                        : '—'}
                    </td>
                    <td>{entry.description ?? '—'}</td>
                    <td>{formatDate(entry.createdAt, { withTime: true })}</td>
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
