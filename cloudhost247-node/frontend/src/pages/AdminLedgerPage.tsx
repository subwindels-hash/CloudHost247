import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchAdminLedger, type AdminLedgerEntry } from '../lib/admin-billing-api';

export function AdminLedgerPage() {
  const [ledger, setLedger] = useState<AdminLedgerEntry[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [entryTypeFilter, setEntryTypeFilter] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const limit = 20;

  const loadLedger = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAdminLedger({
        page,
        limit,
        entryType: entryTypeFilter || undefined,
      });
      setLedger(res.ledger);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || 'Failed to load ledger transactions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLedger();
  }, [page, entryTypeFilter]);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <Link
            to="/admin/invoices"
            className="text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            ← Invoices Directory
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Global Financial Audit Ledger
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Append-only double-entry financial record across all platform transactions and customer accounts.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-6 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Filter Entry Type:</label>
          <select
            value={entryTypeFilter}
            onChange={(e) => {
              setEntryTypeFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-brand-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-white"
          >
            <option value="">All Entry Types</option>
            <option value="charge">Charges</option>
            <option value="payment">Payments</option>
            <option value="refund">Refunds</option>
            <option value="credit">Credits</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg bg-rose-50 p-4 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Ledger Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {loading ? (
          <div className="p-12 text-center text-slate-500">Loading ledger entries...</div>
        ) : ledger.length === 0 ? (
          <div className="p-12 text-center text-slate-500">No transactions recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-900/50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Timestamp
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Invoice #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Description
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-700 dark:bg-slate-800">
                {ledger.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-50 dark:hover:bg-slate-700/40">
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">
                      {new Date(entry.createdAt).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <div className="text-sm font-medium text-slate-900 dark:text-white">{entry.userFullName}</div>
                      <div className="text-xs text-slate-500">{entry.userEmail}</div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 font-mono text-sm text-brand-600 dark:text-brand-400">
                      {entry.invoiceId ? (
                        <Link to={`/admin/invoices/${entry.invoiceId}`} className="hover:underline">
                          {entry.invoiceNumber || 'View Invoice'}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                        entry.entryType === 'charge' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300' :
                        entry.entryType === 'payment' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300' :
                        entry.entryType === 'refund' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {entry.entryType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-700 dark:text-slate-300">{entry.description}</td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-semibold text-slate-900 dark:text-white">
                      ${parseFloat(entry.amount).toFixed(2)} {entry.currency}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Bar */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-700 dark:bg-slate-900/50">
          <div className="text-sm text-slate-500">
            Showing <span className="font-medium text-slate-900 dark:text-white">{ledger.length}</span> of{' '}
            <span className="font-medium text-slate-900 dark:text-white">{total}</span> total entries
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              Previous
            </button>
            <span className="flex items-center px-2 text-sm text-slate-600 dark:text-slate-300">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
