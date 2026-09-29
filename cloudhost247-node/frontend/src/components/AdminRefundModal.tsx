import React, { useState } from 'react';
import { issueAdminRefund, type AdminInvoiceDetail } from '../lib/admin-billing-api';

interface AdminRefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: AdminInvoiceDetail;
  onRefundSuccess: (updatedInvoice: AdminInvoiceDetail) => void;
}

export function AdminRefundModal({ isOpen, onClose, invoice, onRefundSuccess }: AdminRefundModalProps) {
  if (!isOpen) return null;

  const totalPaidCents = invoice.ledger
    .filter((e) => e.entryType === 'payment')
    .reduce((sum, e) => sum + Math.round(parseFloat(e.amount) * 100), 0);

  const totalRefundedCents = invoice.ledger
    .filter((e) => e.entryType === 'refund')
    .reduce((sum, e) => sum + Math.round(parseFloat(e.amount) * 100), 0);

  const maxRefundableCents = totalPaidCents - totalRefundedCents;
  const maxRefundableStr = (maxRefundableCents / 100).toFixed(2);

  const [amount, setAmount] = useState<string>(maxRefundableStr);
  const [reason, setReason] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid positive refund amount.');
      return;
    }

    const amountCents = Math.round(parsedAmount * 100);
    if (amountCents > maxRefundableCents) {
      setError(`Refund amount cannot exceed maximum refundable balance of $${maxRefundableStr}.`);
      return;
    }

    if (!reason.trim()) {
      setError('A reason is required for compliance and audit logging.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await issueAdminRefund(invoice.id, amountCents, reason.trim());
      onRefundSuccess(updated);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to issue refund.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-800">
        <div className="mb-4 flex items-center justify-between border-b pb-3 dark:border-slate-700">
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">
            Issue Refund — Invoice {invoice.invoiceNumber}
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <div className="mb-4 space-y-2 rounded-lg bg-slate-50 p-4 text-sm text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
          <div className="flex justify-between">
            <span>Customer:</span>
            <span className="font-medium text-slate-900 dark:text-white">{invoice.userEmail}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Invoice Amount:</span>
            <span>${parseFloat(invoice.totalAmount).toFixed(2)} {invoice.currency}</span>
          </div>
          <div className="flex justify-between">
            <span>Total Collected:</span>
            <span className="text-emerald-600 dark:text-emerald-400">
              ${(totalPaidCents / 100).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Previously Refunded:</span>
            <span className="text-amber-600 dark:text-amber-400">
              ${(totalRefundedCents / 100).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between border-t pt-2 font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
            <span>Max Refundable Balance:</span>
            <span>${maxRefundableStr} {invoice.currency}</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Refund Amount ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              max={maxRefundableStr}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              required
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Reason for Refund (Audit Log)
            </label>
            <textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer requested cancellation within 30-day money back guarantee"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-white"
              required
              disabled={submitting}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-rose-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500 disabled:opacity-50"
              disabled={submitting || maxRefundableCents <= 0}
            >
              {submitting ? 'Processing...' : 'Confirm Refund'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
