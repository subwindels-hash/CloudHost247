import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchInvoices, type InvoiceSummary } from '../lib/billing-api';
import StatusBadge from '../components/StatusBadge';
import PaymentModal from '../components/PaymentModal';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceSummary | null>(null);

  async function loadInvoices() {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchInvoices();
      setInvoices(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInvoices();
  }, []);

  const unpaidCount = invoices.filter((i) => i.status === 'unpaid').length;
  const totalOutstanding = invoices
    .filter((i) => i.status === 'unpaid')
    .reduce((sum, i) => sum + parseFloat(i.totalAmount || '0'), 0)
    .toFixed(2);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Invoices</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            View your billing history, outstanding invoices, and printable receipts.
          </p>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Invoices</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{invoices.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Unpaid Invoices</div>
          <div className={`mt-2 text-2xl font-bold ${unpaidCount > 0 ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>
            {unpaidCount}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Outstanding Balance</div>
          <div className={`mt-2 text-2xl font-bold ${parseFloat(totalOutstanding) > 0 ? 'text-amber-600' : 'text-slate-900 dark:text-white'}`}>
            ${totalOutstanding}
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="mt-8 text-center text-sm text-slate-500">Loading invoices...</div>
      ) : invoices.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-12 text-center dark:border-slate-800 dark:bg-slate-900/50">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">No Invoices Found</h3>
          <p className="mt-1 text-sm text-slate-500">When you purchase hosting or domain services, your invoices will appear here.</p>
          <Link
            to="/hosting"
            className="mt-4 inline-block rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
          >
            Browse Products
          </Link>
        </div>
      ) : (
        <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-4">Invoice #</th>
                  <th className="px-6 py-4">Order #</th>
                  <th className="px-6 py-4">Issued Date</th>
                  <th className="px-6 py-4">Due Date</th>
                  <th className="px-6 py-4">Amount</th>
                  <th className="px-6 py-4">Status</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4 font-mono font-semibold text-slate-900 dark:text-white">
                      <Link to={`/invoices/${inv.id}`} className="hover:underline">
                        {inv.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-400">{inv.orderNumber}</td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                      {new Date(inv.issuedAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                      {new Date(inv.dueDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white">
                      {inv.currency} ${inv.totalAmount}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {inv.status === 'unpaid' && (
                          <button
                            onClick={() => setSelectedInvoice(inv)}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-blue-700"
                          >
                            Pay Now
                          </button>
                        )}
                        <Link
                          to={`/invoices/${inv.id}`}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <PaymentModal
          isOpen={true}
          invoiceId={selectedInvoice.id}
          invoiceNumber={selectedInvoice.invoiceNumber}
          totalAmount={selectedInvoice.totalAmount}
          currency={selectedInvoice.currency}
          onClose={() => setSelectedInvoice(null)}
          onPaymentSuccess={() => {
            loadInvoices();
          }}
        />
      )}
    </div>
  );
}
