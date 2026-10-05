import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { billingApi, describeError } from '../lib/api.js';
import {
  formatDate, formatMoney, humanizeStatus, invoiceBalance, statusClass,
} from '../lib/format.js';

/**
 * One invoice: what it is for, what is left to pay, and how to pay it.
 *
 * The gateway list is the server's, including the gateways it refuses to start (with the reason), so
 * a customer sees "Stripe — not configured on this deployment" instead of a button that would fail.
 * Paying runs through the real payment route; the sandbox gateway completes through the genuine
 * webhook receiver rather than a shortcut, so the invoice is settled by production code.
 */
export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [methods, setMethods] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState('');
  const [sandbox, setSandbox] = useState(null); // { paymentId, sandboxToken }

  const load = useCallback(async () => {
    setError('');
    const [detail, gateways] = await Promise.allSettled([
      billingApi.invoice(id),
      billingApi.paymentMethods(id),
    ]);
    if (detail.status === 'fulfilled') setData(detail.value);
    else setError(describeError(detail.reason));
    setMethods(gateways.status === 'fulfilled' ? gateways.value : null);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const pay = async (gateway) => {
    setError('');
    setMessage('');
    setPending(gateway.id);
    try {
      const res = await billingApi.startPayment(id, gateway.id);
      if (res.instructions) {
        // Manual gateway: the server's instructions are the whole outcome.
        setMessage(res.instructions);
      } else if (res.sandboxToken) {
        setSandbox({ paymentId: res.paymentId, sandboxToken: res.sandboxToken });
        setMessage('Sandbox payment created. Simulate the provider result below to settle the invoice.');
      } else {
        setMessage('Payment started. Complete it with the provider.');
      }
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending('');
    }
  };

  const completeSandbox = async () => {
    if (!sandbox) return;
    setError('');
    setPending('sandbox');
    try {
      const res = await billingApi.completeSandboxPayment(sandbox.paymentId);
      setMessage(res.applied
        ? 'Sandbox payment applied — this invoice is now settled.'
        : 'The provider result was recorded but nothing was applied.');
      setSandbox(null);
      await load();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setPending('');
    }
  };

  if (data === null) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Invoice</h1></div></div>
        {error ? <div className="alert alert-error" role="alert">{error}</div> : <p className="muted">Loading invoice…</p>}
        <Link className="linklike" to="/billing">Back to billing</Link>
      </div>
    );
  }

  const { invoice, ledger } = data;
  const balance = invoiceBalance(invoice);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Invoice {invoice.number}</h1>
          <p className="muted">Issued {formatDate(invoice.issuedAt)} · due {formatDate(invoice.dueAt)}</p>
        </div>
        <span className={statusClass(invoice.status)}>{humanizeStatus(invoice.status)}</span>
      </div>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}

      <div className="grid-2">
        <section className="card">
          <h2>Amount</h2>
          <dl className="detail">
            <div><dt>Subtotal</dt><dd>{formatMoney(invoice.subtotal, invoice.currency)}</dd></div>
            {(invoice.discountTotal ?? 0) > 0 && (
              <div><dt>Discount</dt><dd>−{formatMoney(invoice.discountTotal, invoice.currency)}</dd></div>
            )}
            {(invoice.taxTotal ?? 0) > 0 && (
              <div><dt>Tax</dt><dd>{formatMoney(invoice.taxTotal, invoice.currency)}</dd></div>
            )}
            <div><dt>Total</dt><dd>{formatMoney(invoice.total, invoice.currency)}</dd></div>
            <div><dt>Paid</dt><dd>{formatMoney(invoice.amountPaid, invoice.currency)}</dd></div>
            <div className="detail-total"><dt>Balance</dt><dd>{formatMoney(balance, invoice.currency)}</dd></div>
          </dl>

          {balance > 0 && (
            <>
              <h3>Pay this invoice</h3>
              {methods === null ? <p className="muted">Loading payment methods…</p> : (
                <ul className="list">
                  {methods.gateways.map((gateway) => (
                    <li key={gateway.id}>
                      <span>
                        <strong>{gateway.label}</strong>
                        {!gateway.available && <span className="muted"> — {gateway.reason}</span>}
                      </span>
                      {gateway.available && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={pending === gateway.id || pending === 'sandbox'}
                          onClick={() => pay(gateway)}
                        >
                          {pending === gateway.id ? 'Starting…' : 'Pay'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {sandbox && (
                <div className="row row-wrap">
                  <p className="muted">
                    Sandbox token <code className="code-inline">{sandbox.sandboxToken.slice(0, 12)}…</code>
                  </p>
                  <button type="button" className="btn" onClick={completeSandbox} disabled={pending === 'sandbox'}>
                    {pending === 'sandbox' ? 'Completing…' : 'Simulate provider success'}
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        <section className="card">
          <h2>Ledger</h2>
          {ledger.length === 0 ? <p className="muted">No entries for this invoice.</p> : (
            <ul className="list">
              {ledger.map((entry) => (
                <li key={entry.id}>
                  <span>
                    <strong>{humanizeStatus(entry.entryType)}</strong>
                    <span className="muted"> {entry.description}</span>
                  </span>
                  <span>
                    {formatMoney(entry.amount, entry.currency)}
                    <span className="muted"> · {formatDate(entry.createdAt, { withTime: true })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link className="btn btn-ghost" to="/billing">Back to billing</Link>
        </section>
      </div>
    </div>
  );
}
