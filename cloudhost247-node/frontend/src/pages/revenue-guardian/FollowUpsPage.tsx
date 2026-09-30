import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import {
  formatDateTime,
  Paginator,
  RgBadge,
  RgLoad,
  RgTable,
  useRgData,
} from '../../components/revenue-guardian/rg-widgets';
import {
  fetchRgStaff,
  RG_FOLLOW_UP_TYPES,
  rgPatch,
  rgPost,
  type Paginated,
  type RgStaffMember,
} from '../../lib/revenue-guardian-api';

interface FollowUpRow {
  id: string;
  customer_id: string;
  customer_email: string;
  case_number: string | null;
  invoice_number: string | null;
  type: string;
  priority: string;
  status: string;
  channel: string;
  scheduled_at: string;
  snoozed_until: string | null;
  assigned_staff_email: string | null;
  notes: string | null;
  outcome: string | null;
  is_overdue: boolean;
}

export default function FollowUpsPage() {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(searchParams.get('status') ?? 'pending');
  const [type, setType] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [staff, setStaff] = useState<RgStaffMember[]>([]);
  const [form, setForm] = useState({ customerEmail: '', customerId: '', type: 'customer_check_in', channel: 'email', priority: 'normal', scheduledAt: new Date().toISOString().slice(0, 10), notes: '', assignedStaffId: '' });

  useEffect(() => {
    fetchRgStaff().then((r) => setStaff(r.staff)).catch(() => undefined);
  }, []);

  const { state, reload } = useRgData<Paginated<FollowUpRow>>('/follow-ups', {
    page,
    limit: 25,
    status: status || undefined,
    type: type || undefined,
  });

  async function act(id: string, changes: Record<string, unknown>) {
    setError('');
    try {
      await rgPatch(`/follow-ups/${id}`, changes);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function complete(id: string) {
    const outcome = window.prompt('Outcome of this follow-up (what happened)?');
    if (outcome === null) return;
    await act(id, { status: 'completed', outcome });
  }

  async function snooze(id: string) {
    const until = window.prompt('Snooze until (YYYY-MM-DD):', new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10));
    if (!until) return;
    await act(id, { status: 'snoozed', snoozedUntil: `${until}T09:00:00.000Z` });
  }

  async function createFollowUp() {
    setError('');
    try {
      await rgPost('/follow-ups', {
        customerId: form.customerId,
        type: form.type,
        channel: form.channel,
        priority: form.priority,
        scheduledAt: `${form.scheduledAt}T09:00:00.000Z`,
        notes: form.notes || undefined,
        assignedStaffId: form.assignedStaffId || undefined,
      });
      setShowCreate(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <RGLayout
      title="Follow-ups"
      hint='"Overdue" is derived live: pending tasks whose scheduled time has passed.'
      actions={<button type="button" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Cancel' : '+ New follow-up'}</button>}
    >
      {error ? <p className="ch247-page__hint" role="alert">Error: {error}</p> : null}
      {showCreate ? (
        <div className="ch247-card" style={{ marginBottom: '0.75rem' }}>
          <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
            <input placeholder="Customer ID (uuid)" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} style={{ minWidth: '20rem' }} />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {RG_FOLLOW_UP_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              {['email', 'phone', 'whatsapp', 'sms', 'in_person', 'other'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              {['low', 'normal', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="date" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
            <select value={form.assignedStaffId} onChange={(e) => setForm({ ...form, assignedStaffId: e.target.value })}>
              <option value="">Assign to me</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select>
            <input placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ minWidth: '18rem' }} />
            <button type="button" disabled={!form.customerId} onClick={createFollowUp}>Create</button>
          </div>
          <p className="ch247-page__hint">Tip: open a customer profile and copy the ID, or create follow-ups directly from a recovery case.</p>
        </div>
      ) : null}

      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem' }}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          {['pending', 'overdue', 'due_today', 'in_progress', 'snoozed', 'completed', 'cancelled', ''].map((s) => (
            <option key={s} value={s}>{s === '' ? 'Any status' : s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">Any type</option>
          {RG_FOLLOW_UP_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No follow-ups match the current filters."
              columns={[
                { header: 'Customer', render: (f: FollowUpRow) => <Link to={`/admin/revenue-guardian/customers/${f.customer_id}`}>{f.customer_email}</Link> },
                { header: 'Type', render: (f) => f.type.replace(/_/g, ' ') },
                { header: 'Case', render: (f) => f.case_number ?? '—' },
                { header: 'Channel', render: (f) => f.channel },
                { header: 'Priority', render: (f) => <RgBadge value={f.priority} /> },
                { header: 'Status', render: (f) => <>{f.is_overdue ? <RgBadge value="overdue" /> : <RgBadge value={f.status} />}</> },
                { header: 'Scheduled', render: (f) => formatDateTime(f.snoozed_until ?? f.scheduled_at) },
                { header: 'Assigned', render: (f) => f.assigned_staff_email ?? '—' },
                { header: 'Notes / outcome', render: (f) => f.outcome ?? f.notes ?? '—' },
                {
                  header: 'Actions',
                  render: (f) =>
                    ['pending', 'in_progress', 'snoozed'].includes(f.status) ? (
                      <span className="ch247-inline-actions">
                        <button type="button" onClick={() => complete(f.id)}>Complete</button>
                        <button type="button" onClick={() => snooze(f.id)}>Snooze</button>
                        <button type="button" onClick={() => act(f.id, { status: 'cancelled' })}>Cancel</button>
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
