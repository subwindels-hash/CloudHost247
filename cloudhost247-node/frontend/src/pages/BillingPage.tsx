import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBillingLedger, fetchInvoices, type InvoiceSummary, type LedgerEntry } from '../lib/billing-api';
import StatusBadge from '../components/StatusBadge';

export default function BillingPage() {
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadBillingData() {
    try {
      setLoading(true);
      setError(null);
      const [ledgerData, invoiceData] = await Promise.all([
        fetchBillingLedger().catch(() => []),
        fetchInvoices().catch(() => []),
      ]);
      setLedger(ledgerData);
      setInvoices(invoiceData);
    } catch (err: any) {
      setError(err?.message || 'Failed to load billing details');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBillingData();
  }, []);

  const unpaidInvoices = invoices.filter((i) => i.status === 'unpaid');
  const outstandingBalance = unpaidInvoices
    .reduce((sum, i) => sum + parseFloat(i.totalAmount || '0'), 0)
    .toFixed(2);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">Billing & Ledger</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Review your account statement, financial ledger history, and invoices.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Account Balance Due</div>
          <div className={`mt-2 text-2xl font-bold ${parseFloat(outstandingBalance) > 0 ? 'text-amber-600' : 'text-green-600'}`}>
            ${outstandingBalance}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Unpaid Invoices</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{unpaidInvoices.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Invoices</div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">{invoices.length}</div>
        </div>
      </div>

      {/* Unpaid Invoice Alert Banner */}
      {unpaidInvoices.length > 0 && (
        <div className="mt-6 flex flex-col justify-between gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center dark:border-amber-900/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <div className="font-semibold text-amber-900 dark:text-amber-300">
                You have {unpaidInvoices.length} unpaid invoice{unpaidInvoices.length > 1 ? 's' : ''}
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-400">
                Total outstanding: ${outstandingBalance}. Pay now to ensure uninterrupted services.
              </div>
            </div>
          </div>
          <Link
            to="/invoices"
            className="inline-block rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow hover:bg-amber-700"
          >
            Review Invoices
          </Link>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/50 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Append-Only Ledger Table */}
      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Transaction Ledger</h2>
          <Link to="/invoices" className="text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400">
            View All Invoices →
          </Link>
        </div>

        {loading ? (
          <div className="mt-6 text-center text-sm text-slate-500">Loading ledger records...</div>
        ) : ledger.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center dark:border-slate-800 dark:bg-slate-900/50">
            <p className="text-sm text-slate-500">No ledger transactions recorded yet.</p>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                  <tr>
                    <th className="px-6 py-4">Date</th>
                    <th className="px-6 py-4">Type</th>
                    <th className="px-6 py-4">Description</th>
                    <th className="px-6 py-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ledger.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                      <td className="px-6 py-4 text-slate-600 dark:text-slate-400">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={entry.entryType} />
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900 dark:text-white">
                        {entry.description}
                      </td>
                      <td
                        className={`px-6 py-4 text-right font-mono font-semibold ${
                          entry.entryType === 'payment'
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {entry.entryType === 'payment' ? '-' : '+'}
                        {entry.currency} ${entry.amount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
