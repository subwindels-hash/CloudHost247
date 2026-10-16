import React, { useState } from 'react';
import { adminApi, describeError } from '../lib/api.js';
import { formatMoney } from '../lib/format.js';

/**
 * AdminRefundModal (Phase 5F): the refund flow the audit trail demands. Shows the paid amount,
 * what has already been returned and the maximum refundable balance up front; the amount field
 * (major units, fixed-point like every money value here) defaults to the full balance, and the
 * reason is mandatory before the submit enables. The server re-checks the refund cap and refuses
 * over-refunds by name — this form only makes the numbers legible before staff commit.
 */
export default function AdminRefundModal({ invoice, onDone, onClose }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const paid = Number(invoice.amountPaid ?? 0);
  const refunded = Number(invoice.refundedAmount ?? 0);
  const maxRefundable = Math.round((paid - refunded) * 100) / 100;
  const value = amount.trim() === '' ? maxRefundable : Number(amount);
  const canSubmit = !busy && reason.trim().length > 0 && Number.isFinite(value) && value > 0 && value <= maxRefundable;

  const submit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError('');
    try {
      const res = await adminApi.adminRefundInvoice(invoice.id, { amount: value, reason: reason.trim() });
      onDone(res);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" role="dialog" aria-label="Issue refund">
      <h2>Issue refund</h2>
      <dl className="detail-list">
        <dt>Paid</dt><dd>{formatMoney(paid, invoice.currency)}</dd>
        <dt>Already refunded</dt><dd>{formatMoney(refunded, invoice.currency)}</dd>
        <dt>Maximum refundable</dt><dd><strong>{formatMoney(maxRefundable, invoice.currency)}</strong></dd>
      </dl>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      <form onSubmit={submit}>
        <p>
          <label htmlFor="refund-amount">Amount ({invoice.currency})</label>
          <input
            id="refund-amount"
            type="number"
            min="0.01"
            max={maxRefundable}
            step="0.01"
            value={amount}
            placeholder={maxRefundable.toFixed(2)}
            onChange={(e) => setAmount(e.target.value)}
          />
        </p>
        <p>
          <label htmlFor="refund-reason">Reason (required, for the audit trail)</label>
          <textarea
            id="refund-reason"
            value={reason}
            rows="2"
            required
            placeholder="Why this refund is being issued"
            onChange={(e) => setReason(e.target.value)}
          />
        </p>
        <div className="row row-wrap">
          <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
            {busy ? 'Refunding…' : `Refund ${formatMoney(value > 0 && Number.isFinite(value) ? value : 0, invoice.currency)}`}
          </button>
          <button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>Close</button>
        </div>
      </form>
    </div>
  );
}
