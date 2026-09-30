import { useState } from 'react';
import { Link } from 'react-router-dom';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import {
  formatDate,
  Paginator,
  RgBadge,
  RgLoad,
  RgTable,
  useRgData,
} from '../../components/revenue-guardian/rg-widgets';
import { rgPatch, rgPost, type Paginated } from '../../lib/revenue-guardian-api';

interface PromiseRow {
  id: string;
  customer_id: string;
  customer_email: string;
  invoice_id: string;
  invoice_number: string;
  invoice_status: string;
  case_number: string | null;
  promised_amount: string;
  currency: string;
  promised_date: string;
  status: string;
  fulfilled_amount: string;
  assigned_staff_email: string | null;
  is_due_today: boolean;
  is_overdue: boolean;
}

export default function PromisesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('pending');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ customerId: '', invoiceId: '', promisedAmount: '', promisedDate: new Date().toISOString().slice(0, 10), notes: '' });

  const { state, reload } = useRgData<Paginated<PromiseRow>>('/payment-promises', {
    page,
    limit: 25,
    status: status || undefined,
  });

  async function reconcile(id: string) {
    setError('');
    try {
      await rgPatch(`/payment-promises/${id}`, { action: 'reconcile' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconcile failed');
    }
  }

  async function cancel(id: string) {
    const reason = window.prompt('Reason for cancelling this promise:');
    if (!reason) return;
    setError('');
    try {
      await rgPatch(`/payment-promises/${id}`, { action: 'cancel', reason });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed');
    }
  }

  async function create() {
    setError('');
    try {
      await rgPost('/payment-promises', {
        customerId: form.customerId,
        invoiceId: form.invoiceId,
        promisedAmount: form.promisedAmount,
        promisedDate: form.promisedDate,
        notes: form.notes || undefined,
      });
      setShowCreate(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <RGLayout
      title="Payment Promises"
      hint="Fulfillment is decided only by the billing ledger — there is no 'mark fulfilled' button. 'Reconcile' re-checks the ledger on demand."
      actions={<button type="button" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ Record promise'}</button>}
    >
      {error ? <p className="ch247-page__hint" role="alert">Error: {error}</p> : null}
      {showCreate ? (
        <div className="ch247-card" style={{ marginBottom: '0.75rem' }}>
          <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
            <input placeholder="Customer ID (uuid)" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} style={{ minWidth: '19rem' }} />
            <input placeholder="Invoice ID (uuid)" value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })} style={{ minWidth: '19rem' }} />
            <input placeholder="Amount e.g. 49.99" value={form.promisedAmount} onChange={(e) => setForm({ ...form, promisedAmount: e.target.value })} />
            <input type="date" value={form.promisedDate} onChange={(e) => setForm({ ...form, promisedDate: e.target.value })} />
            <input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <button type="button" disabled={!form.customerId || !form.invoiceId || !form.promisedAmount} onClick={create}>Record</button>
          </div>
          <p className="ch247-page__hint">The promise must reference the customer's own unpaid invoice and cannot exceed its outstanding balance.</p>
        </div>
      ) : null}

      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem' }}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          {['pending', 'due_today', 'overdue', 'fulfilled', 'partially_fulfilled', 'broken', 'cancelled', ''].map((s) => (
            <option key={s} value={s}>{s === '' ? 'Any status' : s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>

      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No payment promises match the current filters."
              columns={[
                { header: 'Customer', render: (p: PromiseRow) => <Link to={`/admin/revenue-guardian/customers/${p.customer_id}`}>{p.customer_email}</Link> },
                { header: 'Invoice', render: (p) => <>{p.invoice_number} <RgBadge value={p.invoice_status} /></> },
                { header: 'Case', render: (p) => p.case_number ?? '—' },
                { header: 'Promised', render: (p) => `${p.promised_amount} ${p.currency}` },
                { header: 'By', render: (p) => <>{formatDate(p.promised_date)} {p.is_due_today ? <RgBadge value="watch" /> : null}{p.is_overdue ? <RgBadge value="overdue" /> : null}</> },
                { header: 'Status', render: (p) => <RgBadge value={p.status} /> },
                { header: 'Paid (ledger)', render: (p) => `${p.fulfilled_amount} ${p.currency}` },
                { header: 'Assigned', render: (p) => p.assigned_staff_email ?? '—' },
                {
                  header: 'Actions',
                  render: (p) =>
                    p.status === 'pending' ? (
                      <span className="ch247-inline-actions">
                        <button type="button" onClick={() => reconcile(p.id)}>Reconcile</button>
                        <button type="button" onClick={() => cancel(p.id)}>Cancel</button>
                      </span>
                    ) : ('—'),
                },
              ]}
              rows={data.items}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </RgLoad>
    </RGLayout>
  );
}
