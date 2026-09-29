import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  fetchAdminInvoiceDetail,
  cancelAdminInvoice,
  type AdminInvoiceDetail,
} from '../lib/admin-billing-api';
import { StatusBadge } from '../components/StatusBadge';
import { AdminRefundModal } from '../components/AdminRefundModal';

export function AdminInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [invoice, setInvoice] = useState<AdminInvoiceDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [refundModalOpen, setRefundModalOpen] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);

  const loadInvoice = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminInvoiceDetail(id);
      setInvoice(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoice();
  }, [id]);

  const handleCancelInvoice = async () => {
    if (!invoice) return;
    const reason = window.prompt('Please enter a cancellation reason for audit compliance:');
    if (!reason || !reason.trim()) return;

    setActionLoading(true);
    try {
      const updated = await cancelAdminInvoice(invoice.id, reason.trim());
      setInvoice(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to cancel invoice');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-slate-500">
        Loading invoice details...
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="rounded-xl bg-rose-50 p-6 text-center text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          <p className="font-semibold">{error || 'Invoice not found'}</p>
          <Link
            to="/admin/invoices"
            className="mt-4 inline-block font-medium text-brand-600 underline dark:text-brand-400"
          >
            ← Back to Invoices
          </Link>
        </div>
      </div>
    );
  }

  const canRefund = invoice.status === 'paid' || invoice.status === 'partially_refunded';
  const canCancel = invoice.status === 'unpaid';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header and Back Link */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <Link
            to="/admin/invoices"
            className="text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            ← Invoices Directory
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Invoice {invoice.invoiceNumber}
            </h1>
            <StatusBadge status={invoice.status} />
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex gap-3">
          {canRefund && (
            <button
              onClick={() => setRefundModalOpen(true)}
              className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500"
            >
              Issue Refund
            </button>
          )}

          {canCancel && (
            <button
              onClick={handleCancelInvoice}
              disabled={actionLoading}
              className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 shadow-sm hover:bg-rose-50 disabled:opacity-50 dark:border-rose-800 dark:bg-slate-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
            >
              {actionLoading ? 'Cancelling...' : 'Void / Cancel Invoice'}
            </button>
          )}
        </div>
      </div>

      {/* Customer & Order Snapshot */}
      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Customer Details</h3>
          <div className="mt-2 space-y-1 text-sm">
            <div className="font-semibold text-slate-900 dark:text-white">{invoice.userFullName}</div>
            <div className="text-slate-600 dark:text-slate-300">{invoice.userEmail}</div>
            <div className="font-mono text-xs text-slate-400">ID: {invoice.userId}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Invoice Information</h3>
          <div className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-200">Parent Order:</span>{' '}
              <span className="font-mono">{invoice.orderNumber}</span>
            </div>
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-200">Issue Date:</span>{' '}
              {new Date(invoice.issuedAt).toLocaleDateString()}
            </div>
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-200">Due Date:</span>{' '}
              {new Date(invoice.dueDate).toLocaleDateString()}
            </div>
          </div>
        </div>
      </div>

      {/* Line Items Table */}
      <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/50">
          <h3 className="font-semibold text-slate-900 dark:text-white">Line Items</h3>
        </div>
        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-900/50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Item
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Billing Cycle
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Qty
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Price
              </th>
              <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {invoice.items.map((item) => (
              <tr key={item.id}>
                <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">
                  {item.productName ? `${item.productName} — ${item.planName}` : 'Service Plan'}
                </td>
                <td className="px-6 py-4 text-sm capitalize text-slate-600 dark:text-slate-300">
                  {item.billingPeriod}
                </td>
                <td className="px-6 py-4 text-right text-sm text-slate-600 dark:text-slate-300">
                  {item.quantity}
                </td>
                <td className="px-6 py-4 text-right text-sm text-slate-600 dark:text-slate-300">
                  ${parseFloat(item.unitPriceAmount).toFixed(2)}
                </td>
                <td className="px-6 py-4 text-right text-sm font-semibold text-slate-900 dark:text-white">
                  ${parseFloat(item.lineTotalAmount).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Invoice Summary Section */}
        <div className="border-t border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="flex flex-col items-end space-y-1 text-sm text-slate-600 dark:text-slate-300">
            <div className="flex w-64 justify-between">
              <span>Subtotal:</span>
              <span>${parseFloat(invoice.subtotalAmount).toFixed(2)}</span>
            </div>
            <div className="flex w-64 justify-between">
              <span>Discounts:</span>
              <span>-${parseFloat(invoice.discountAmount).toFixed(2)}</span>
            </div>
            <div className="flex w-64 justify-between">
              <span>Tax:</span>
              <span>${parseFloat(invoice.taxAmount).toFixed(2)}</span>
            </div>
            <div className="flex w-64 justify-between border-t border-slate-300 pt-2 text-base font-bold text-slate-900 dark:border-slate-600 dark:text-white">
              <span>Total:</span>
              <span>${parseFloat(invoice.totalAmount).toFixed(2)} {invoice.currency}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Attempts History */}
      <div className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/50">
          <h3 className="font-semibold text-slate-900 dark:text-white">Payment Attempts</h3>
        </div>
        {invoice.payments.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">No payment attempts recorded.</div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Provider</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Reference</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {invoice.payments.map((p) => (
                <tr key={p.id}>
                  <td className="px-6 py-4 text-sm font-medium uppercase text-slate-900 dark:text-white">{p.provider || 'Direct'}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-500">{p.providerReference || '—'}</td>
                  <td className="px-6 py-4 text-sm font-semibold">${parseFloat(p.amount).toFixed(2)}</td>
                  <td className="px-6 py-4"><StatusBadge status={p.status} /></td>
                  <td className="px-6 py-4 text-right text-sm text-slate-500">{new Date(p.initiatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Append-Only Ledger Trail */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-4 dark:border-slate-700 dark:bg-slate-900/50">
          <h3 className="font-semibold text-slate-900 dark:text-white">Immutable Ledger Transactions</h3>
        </div>
        {invoice.ledger.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">No ledger entries for this invoice.</div>
        ) : (
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-900/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Type</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Description</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Amount</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {invoice.ledger.map((l) => (
                <tr key={l.id}>
                  <td className="px-6 py-4">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                      l.entryType === 'charge' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                      l.entryType === 'payment' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                      l.entryType === 'refund' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300' :
                      'bg-slate-100 text-slate-800'
                    }`}>
                      {l.entryType}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">{l.description}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">${parseFloat(l.amount).toFixed(2)}</td>
                  <td className="px-6 py-4 text-right text-sm text-slate-500">{new Date(l.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Refund Modal */}
      {refundModalOpen && (
        <AdminRefundModal
          isOpen={refundModalOpen}
          onClose={() => setRefundModalOpen(false)}
          invoice={invoice}
          onRefundSuccess={(updated) => setInvoice(updated)}
        />
      )}
    </div>
  );
}
