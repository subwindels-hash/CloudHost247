import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { formatMoney, formatDate, humanizeStatus, statusClass } from '../lib/format.js';

/**
 * Admin invoice detail: the summary, the order's line items, the ledger entries against it and
 * every payment attempt — plus the three staff actions: confirm/reject a pending manual payment,
 * refund a captured payment, and void an unpaid invoice (reason mandatory).
 */
export default function AdminInvoiceDetailPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const res = await adminApi.adminInvoice(id);
      setInvoice(res.invoice);
    } catch (e) {
      setError(describeError(e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const run = async (action, message) => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
      if (message) setNotice(message);
      await load();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmPayment = (payment) => run(async () => {
    await adminApi.confirmManualPayment(payment.id);
  }, `Payment ${payment.id} confirmed and applied.`);

  const rejectPayment = async (payment, e) => {
    e.preventDefault();
    await run(async () => {
      await adminApi.rejectManualPayment(payment.id, rejectReason.trim());
      setRejectReason('');
    }, `Payment ${payment.id} rejected.`);
  };

  const refund = () => {
    if (!window.confirm(`Refund invoice ${invoice.invoiceNumber}? The captured payment is reversed in the ledger.`)) return;
    return run(async () => {
      await adminApi.adminRefundInvoice(invoice.id);
    }, `Invoice ${invoice.invoiceNumber} refunded.`);
  };

  const cancelInvoice = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Void unpaid invoice ${invoice.invoiceNumber}?`)) return;
    await run(async () => {
      await adminApi.adminCancelInvoice(invoice.id, cancelReason.trim());
      setCancelReason('');
    }, `Invoice ${invoice.invoiceNumber} voided.`);
  };

  if (!id) return <div className="page"><p className="muted">No invoice selected.</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Invoice {invoice ? invoice.invoiceNumber : ''}</h1>
          <p className="muted">
            {invoice ? (
              <>
                <span className={statusClass(invoice.status)}>{humanizeStatus(invoice.status)}</span>
                {invoice.userEmail ? ` · ${invoice.userFullName ?? ''} (${invoice.userEmail})` : ` · ${invoice.userId}`}
              </>
            ) : 'Loading invoice…'}
          </p>
        </div>
        <Link className="btn btn-ghost" to="/admin/billing">All invoices</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {invoice && (
        <>
          <section className="card">
            <h2>Summary</h2>
            <dl className="detail-list">
              <dt>Subtotal</dt><dd>{formatMoney(invoice.subtotalAmount, invoice.currency)}</dd>
              <dt>Discount</dt><dd>{formatMoney(invoice.discountAmount, invoice.currency)}</dd>
              <dt>Tax</dt><dd>{formatMoney(invoice.taxAmount, invoice.currency)}</dd>
              <dt>Total</dt><dd><strong>{formatMoney(invoice.totalAmount, invoice.currency)}</strong></dd>
              <dt>Issued</dt><dd>{formatDate(invoice.issuedAt, { withTime: true })}</dd>
              <dt>Due</dt><dd>{formatDate(invoice.dueDate)}</dd>
              {invoice.orderNumber && (<><dt>Order</dt><dd>{invoice.orderNumber}</dd></>)}
            </dl>
            <div className="row row-wrap" style={{ marginTop: 16 }}>
              {(invoice.amountPaid ?? 0) > 0 && invoice.status !== 'refunded' && (
                <button className="btn btn-primary" type="button" disabled={busy} onClick={refund}>Refund captured payment</button>
              )}
            </div>
          </section>

          <section className="card">
            <h2>Line items</h2>
            {(invoice.items ?? []).length === 0 ? (
              <p className="muted">No line items recorded.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Period</th>
                      <th scope="col">Qty</th>
                      <th scope="col">Unit</th>
                      <th scope="col">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.productName ?? '—'}</td>
                        <td>{item.billingPeriod ?? '—'}</td>
                        <td>{item.quantity}</td>
                        <td>{formatMoney(item.unitPriceAmount, item.currency)}</td>
                        <td>{formatMoney(item.lineTotalAmount, item.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Ledger entries</h2>
            {(invoice.ledger ?? []).length === 0 ? (
              <p className="muted">No ledger entries against this invoice.</p>
            ) : (
              <ul className="list">
                {invoice.ledger.map((entry) => (
                  <li key={entry.id}>
                    <strong>{entry.entryType}</strong> {formatMoney(entry.amount, entry.currency)}
                    <span className="muted"> · {entry.description ?? '—'} · {formatDate(entry.createdAt, { withTime: true })}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Payment attempts</h2>
            {(invoice.payments ?? []).length === 0 ? (
              <p className="muted">No payments attempted.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Gateway</th>
                      <th scope="col">Amount</th>
                      <th scope="col">Status</th>
                      <th scope="col">Initiated</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.payments.map((payment) => (
                      <tr key={payment.id}>
                        <td>{payment.provider}{payment.providerReference ? <span className="muted"> · {payment.providerReference}</span> : null}</td>
                        <td>{formatMoney(payment.amount, payment.currency)}</td>
                        <td>
                          <span className={statusClass(payment.status)}>{humanizeStatus(payment.status)}</span>
                          {payment.failureReason && <div className="muted small">{payment.failureReason}</div>}
                        </td>
                        <td>{formatDate(payment.initiatedAt, { withTime: true })}</td>
                        <td>
                          {payment.provider === 'manual' && payment.status === 'pending' && (
                            <div className="stack">
                              <div className="row row-wrap">
                                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => confirmPayment(payment)}>
                                  Confirm
                                </button>
                              </div>
                              <form className="row row-wrap" onSubmit={(e) => rejectPayment(payment, e)}>
                                <input
                                  aria-label={`Rejection reason for payment ${payment.id}`}
                                  value={rejectReason}
                                  onChange={(e) => setRejectReason(e.target.value)}
                                  placeholder="Reason (required)"
                                  required
                                />
                                <button className="btn btn-ghost" type="submit" disabled={busy}>Reject</button>
                              </form>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {invoice.status === 'unpaid' && (
            <section className="card">
              <h2>Void invoice</h2>
              <p className="muted">Cancels pending payment attempts, voids the invoice and cancels its order. The reason is recorded in the audit log.</p>
              <form onSubmit={cancelInvoice}>
                <div className="field">
                  <label htmlFor="void-reason">Reason (required)</label>
                  <input id="void-reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} required minLength={1} />
                </div>
                <button className="btn btn-ghost" type="submit" disabled={busy}>Void invoice</button>
              </form>
            </section>
          )}
        </>
      )}
    </div>
  );
}
