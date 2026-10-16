import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, describeError } from '../lib/api.js';
import { formatMoney, formatDate, humanizeStatus, statusClass } from '../lib/format.js';

/**
 * Admin order detail: what the platform actually knows about one order, from the rows it created.
 *
 * The cancellation card mirrors the server's own guards: `cancellation.cancellable` decides whether
 * the button appears, and `cancellation.reason` is the server's named refusal (with the refund path
 * when money has moved) rather than a disabled button with no explanation.
 */
export default function AdminOrderDetailPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setError('');
    try {
      const res = await adminApi.adminOrder(id);
      setOrder(res.order);
    } catch (e) {
      setError(describeError(e));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const cancelOrder = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Cancel order ${order.reference}?`)) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await adminApi.adminCancelOrder(order.id, reason.trim());
      setNotice(`Order ${order.reference} cancelled.`);
      setReason('');
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (!id) return <div className="page"><p className="muted">No order selected.</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Order {order ? order.reference : ''}</h1>
          <p className="muted">
            {order ? (
              <>
                <span className={statusClass(order.status)}>{humanizeStatus(order.status)}</span>
                {order.customer?.email ? ` · ${order.customer.fullName ?? ''} (${order.customer.email})` : ''}
              </>
            ) : 'Loading order…'}
          </p>
        </div>
        <Link className="btn btn-ghost" to="/admin/orders">All orders</Link>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {notice && <div className="alert alert-success" role="status">{notice}</div>}

      {order && (
        <>
          <section className="card">
            <h2>Summary</h2>
            <dl className="detail-list">
              <dt>Subtotal</dt><dd>{formatMoney(order.subtotal, order.currency)}</dd>
              <dt>Tax</dt><dd>{formatMoney(order.taxTotal, order.currency)}</dd>
              <dt>Discount</dt><dd>{formatMoney(order.discountTotal, order.currency)}</dd>
              <dt>Total</dt><dd><strong>{formatMoney(order.total, order.currency)}</strong></dd>
              <dt>Created</dt><dd>{formatDate(order.createdAt, { withTime: true })}</dd>
              <dt>Updated</dt><dd>{formatDate(order.updatedAt, { withTime: true })}</dd>
            </dl>
          </section>

          <section className="card">
            <h2>Items</h2>
            {(order.items ?? []).length === 0 ? (
              <p className="muted">No items recorded.</p>
            ) : (
              <ul className="list">
                {order.items.map((item) => (
                  <li key={item.id ?? item.description}>
                    <strong>{item.productName ?? item.description ?? 'Item'}</strong>
                    {item.planName && item.planName !== item.productName ? ` · ${item.planName}` : ''}
                    <span className="muted"> · qty {item.quantity ?? 1} · {formatMoney(item.lineTotalAmount ?? item.total ?? 0, order.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Billing</h2>
            {(order.billing ?? []).length === 0 ? (
              <p className="muted">No invoices against this order.</p>
            ) : (
              order.billing.map((entry) => (
                <div key={entry.invoice.id} style={{ marginBottom: 16 }}>
                  <h3>
                    <Link to={`/admin/billing/invoices/${entry.invoice.id}`}>{entry.invoice.number}</Link>
                    {' '}
                    <span className={statusClass(entry.invoice.status)}>{humanizeStatus(entry.invoice.status)}</span>
                  </h3>
                  <p className="muted">
                    {formatMoney(entry.invoice.totalAmount, entry.invoice.currency)}
                    {' · paid '}{formatMoney(entry.invoice.amountPaid ?? 0, entry.invoice.currency)}
                  </p>
                  {(entry.payments ?? []).length > 0 && (
                    <ul className="list">
                      {entry.payments.map((payment) => (
                        <li key={payment.id}>
                          {payment.provider} {formatMoney(payment.amount, payment.currency)}
                          <span className={statusClass(payment.status)}> {humanizeStatus(payment.status)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </section>

          <section className="card">
            <h2>Fulfilment</h2>
            <h3>Installations</h3>
            {(order.fulfilment?.installations ?? []).length === 0 ? (
              <p className="muted">No installations.</p>
            ) : (
              <ul className="list">
                {order.fulfilment.installations.map((inst) => (
                  <li key={inst.id}>
                    <strong>{inst.name ?? inst.id}</strong>
                    <span className={statusClass(inst.status)}> {humanizeStatus(inst.status)}</span>
                    {inst.domain && <span className="muted"> · {inst.domain}</span>}
                    {(inst.deployments ?? []).length > 0 && (
                      <div className="muted small">
                        deployments: {inst.deployments.map((d) => `${d.action ?? 'deploy'} ${d.status}`).join(', ')}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <h3>Services</h3>
            {(order.fulfilment?.services ?? []).length === 0 ? (
              <p className="muted">No services.</p>
            ) : (
              <ul className="list">
                {order.fulfilment.services.map((svc) => (
                  <li key={svc.id}>
                    <strong>{svc.label ?? svc.id}</strong>
                    <span className={statusClass(svc.status)}> {humanizeStatus(svc.status)}</span>
                    {svc.domain && <span className="muted"> · {svc.domain}</span>}
                  </li>
                ))}
              </ul>
            )}
            <h3>Provisioning jobs</h3>
            {(order.fulfilment?.provisioningJobs ?? []).length === 0 ? (
              <p className="muted">No provisioning jobs.</p>
            ) : (
              <ul className="list">
                {order.fulfilment.provisioningJobs.map((job) => (
                  <li key={job.id}>
                    <strong>{job.kind}</strong>
                    <span className={statusClass(job.status)}> {humanizeStatus(job.status)}</span>
                    <span className="muted"> · attempts {job.attempts}{job.error ? ` · ${job.error}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Cancellation</h2>
            {order.cancellation?.cancellable ? (
              <form onSubmit={cancelOrder}>
                <p className="muted">This order is pending with no settled payment, so it can be cancelled. The reason is recorded in the audit log.</p>
                <div className="field">
                  <label htmlFor="cancel-order-reason">Reason (required)</label>
                  <input id="cancel-order-reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={1} />
                </div>
                <button className="btn btn-ghost" type="submit" disabled={busy}>Cancel order</button>
              </form>
            ) : (
              <>
                <p className="muted">{order.cancellation?.reason ?? 'This order cannot be cancelled.'}</p>
                {order.cancellation?.refundPath && (
                  <p className="muted">
                    Refund via the{' '}
                    <Link to={`/admin/billing/invoices/${(order.billing ?? []).find((b) => ['paid', 'unpaid'].includes(b.invoice.status))?.invoice.id ?? ''}`}>
                      invoice
                    </Link>{' '}
                    instead.
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
