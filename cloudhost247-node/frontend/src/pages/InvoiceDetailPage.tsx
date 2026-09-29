import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchInvoiceDetail, type InvoiceDetail } from '../lib/billing-api';
import StatusBadge from '../components/StatusBadge';
import PaymentModal from '../components/PaymentModal';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  async function loadInvoice() {
    if (!id) return;
    try {
      setLoading(true);
      setError(null);
      const data = await fetchInvoiceDetail(id);
      setInvoice(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load invoice');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvoice();
  }, [id]);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center text-slate-500">
        Loading invoice details...
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-16 text-center">
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">Invoice Not Found</h2>
        <p className="mt-2 text-sm text-slate-500">{error || 'The requested invoice does not exist.'}</p>
        <Link
          to="/invoices"
          className="mt-6 inline-block rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Back to Invoices
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Top Navigation & Print Action */}
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link to="/invoices" className="text-sm font-medium text-slate-500 hover:text-slate-900 dark:hover:text-white">
          ← Back to Invoices
        </Link>
        <div className="flex gap-2">
          <button
            onClick={() => window.print()}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
          >
            🖨 Print / PDF
          </button>
          {invoice.status === 'unpaid' && (
            <button
              onClick={() => setShowPaymentModal(true)}
              className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
            >
              Pay Now
            </button>
          )}
        </div>
      </div>

      {/* Formal Invoice Card */}
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900 print:border-none print:shadow-none">
        {/* Header Branding & Metadata */}
        <div className="flex flex-col justify-between gap-6 border-b border-slate-100 pb-8 sm:flex-row dark:border-slate-800">
          <div>
            <div className="text-2xl font-black tracking-tight text-blue-600 dark:text-blue-400">CloudHost247</div>
            <div className="mt-1 text-xs text-slate-500">Cloud Hosting & Infrastructure Services</div>
          </div>
          <div className="text-left sm:text-right">
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">{invoice.invoiceNumber}</h1>
            <div className="mt-1 text-sm font-mono text-slate-500">Order: {invoice.orderNumber}</div>
            <div className="mt-2">
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </div>

        {/* Invoice Dates & Billing Summary */}
        <div className="mt-6 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-xs text-slate-400">Issue Date</div>
            <div className="mt-1 font-semibold">{new Date(invoice.issuedAt).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Due Date</div>
            <div className="mt-1 font-semibold">{new Date(invoice.dueDate).toLocaleDateString()}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Currency</div>
            <div className="mt-1 font-semibold">{invoice.currency}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Total Amount</div>
            <div className="mt-1 font-bold text-slate-900 dark:text-white">${invoice.totalAmount}</div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="mt-8">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Invoice Items</h3>
          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-semibold text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Cycle</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Unit Price</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoice.items.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                      {item.productName || 'Service'} — {item.planName || 'Plan'}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-500">{item.billingPeriod}</td>
                    <td className="px-4 py-3 text-right text-slate-500">{item.quantity}</td>
                    <td className="px-4 py-3 text-right text-slate-500">${item.unitPriceAmount}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 dark:text-white">
                      ${item.lineTotalAmount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Financial Breakdown Totaling */}
        <div className="mt-6 flex justify-end">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-slate-500">
              <span>Subtotal:</span>
              <span>${invoice.subtotalAmount}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Discount:</span>
              <span>-${invoice.discountAmount}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Tax (0%):</span>
              <span>${invoice.taxAmount}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900 dark:border-slate-800 dark:text-white">
              <span>Total:</span>
              <span>${invoice.totalAmount}</span>
            </div>
            <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300">
              <span>Status:</span>
              <span className="capitalize">{invoice.status}</span>
            </div>
          </div>
        </div>

        {/* Payment Attempts History */}
        {invoice.payments && invoice.payments.length > 0 && (
          <div className="mt-10 border-t border-slate-100 pt-6 dark:border-slate-800">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Payment Attempts</h3>
            <div className="mt-3 space-y-2">
              {invoice.payments.map((p) => (
                <div
                  key={p.id}
                  className="flex flex-col justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50/50 p-3 text-xs sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-800/30"
                >
                  <div>
                    <span className="font-semibold uppercase tracking-wider">{p.provider || 'offline'}</span> (
                    <span className="text-slate-500">{p.method || 'transfer'}</span>)
                    {p.providerReference && (
                      <span className="ml-2 font-mono text-slate-400">Ref: {p.providerReference}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500">
                      {new Date(p.initiatedAt).toLocaleDateString()}
                    </span>
                    <StatusBadge status={p.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {showPaymentModal && (
        <PaymentModal
          isOpen={true}
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          totalAmount={invoice.totalAmount}
          currency={invoice.currency}
          onClose={() => setShowPaymentModal(false)}
          onPaymentSuccess={() => {
            loadInvoice();
          }}
        />
      )}
    </div>
  );
}
