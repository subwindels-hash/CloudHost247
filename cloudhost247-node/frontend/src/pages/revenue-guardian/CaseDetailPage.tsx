import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import {
  formatDate,
  formatDateTime,
  RgBadge,
  RgLoad,
  RgTable,
  useRgData,
} from '../../components/revenue-guardian/rg-widgets';
import { rgPatch, rgPost } from '../../lib/revenue-guardian-api';
import { useAuthState } from '../../layout/useAuthState';
import { rgPermissionsForRole } from '../../lib/revenue-guardian-api';
import type { CaseRow } from './RecoveryQueuePage';

interface CaseDetail {
  recoveryCase: CaseRow & {
    risk_reasons: string[];
    dispute_reason: string | null;
    closed_reason: string | null;
    source: string;
    last_contact_at: string | null;
    closed_at: string | null;
    invoice_status: string | null;
  };
  allowedTransitions: string[];
  followUps: Array<{ id: string; type: string; status: string; scheduled_at: string; assigned_staff_email: string | null; notes: string | null }>;
  promises: Array<{ id: string; promised_amount: string; currency: string; promised_date: string; status: string; fulfilled_amount: string }>;
  activities: Array<{ id: string; event_type: string; description: string; actor_email: string | null; actor_type: string; created_at: string }>;
}

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { state, reload } = useRgData<CaseDetail>(`/recovery-cases/${id}`);
  const { user } = useAuthState();
  const canWriteOff = rgPermissionsForRole(user?.role).includes('revenue_guardian.write_off');
  const [transition, setTransition] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function applyTransition() {
    if (!transition) return;
    setBusy(true);
    setError('');
    try {
      await rgPatch(`/recovery-cases/${id}`, { status: transition, reason: reason || undefined });
      setTransition('');
      setReason('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function addNote() {
    if (!note.trim()) return;
    setBusy(true);
    setError('');
    try {
      await rgPatch(`/recovery-cases/${id}`, { note });
      setNote('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Note failed');
    } finally {
      setBusy(false);
    }
  }

  async function reconcileNow() {
    setBusy(true);
    setError('');
    try {
      await rgPost(`/automation/jobs/reconcile_recovery_state/run`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reconciliation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <RGLayout title="Recovery Case" hint="Recovered / partially recovered can only be entered when the billing ledger confirms the money.">
      <RgLoad state={state}>
        {(data) => {
          const c = data.recoveryCase;
          const transitions = data.allowedTransitions.filter((t) => (t === 'written_off' ? canWriteOff : true));
          return (
            <div className="ch247-stack">
              <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                <strong>{c.case_number}</strong>
                <RgBadge value={c.status} />
                <RgBadge value={c.risk_level} />
                {c.escalation_level > 0 ? <span className="ch247-badge ch247-badge--danger">Escalation L{c.escalation_level}</span> : null}
                <span className="ch247-page__hint">source: {c.source}</span>
              </div>

              <div className="ch247-table-wrap">
                <table className="ch247-table">
                  <tbody>
                    <tr><th>Customer</th><td><Link to={`/admin/revenue-guardian/customers/${c.customer_id}`}>{c.customer_email}</Link></td>
                        <th>Invoice</th><td>{c.invoice_number ?? '—'} {c.invoice_status ? <RgBadge value={c.invoice_status} /> : null}</td></tr>
                    <tr><th>Outstanding</th><td>{c.amount_outstanding} {c.currency}</td>
                        <th>Recovered (ledger)</th><td>{c.amount_recovered} {c.currency}</td></tr>
                    <tr><th>Opened</th><td>{formatDateTime(c.opened_at)}</td>
                        <th>Closed</th><td>{c.closed_at ? `${formatDateTime(c.closed_at)} — ${c.closed_reason ?? ''}` : '—'}</td></tr>
                    <tr><th>Last contact</th><td>{formatDateTime(c.last_contact_at)}</td>
                        <th>Next follow-up</th><td>{formatDateTime(c.next_follow_up_at)}</td></tr>
                    <tr><th>Assigned to</th><td>{c.assigned_staff_email ?? 'Unassigned'}</td>
                        <th>Dispute reason</th><td>{c.dispute_reason ?? '—'}</td></tr>
                  </tbody>
                </table>
              </div>

              <div>
                <h3>Risk assessment (score {c.risk_score}/100)</h3>
                {c.risk_reasons.length === 0 ? <p className="ch247-page__hint">No risk factors recorded.</p> : (
                  <ul>{c.risk_reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
                )}
              </div>

              {error ? <p className="ch247-page__hint" role="alert">Error: {error}</p> : null}

              {!c.closed_at ? (
                <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
                  <select value={transition} onChange={(e) => setTransition(e.target.value)}>
                    <option value="">Change status…</option>
                    {transitions.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </select>
                  <input placeholder="Reason (required for dispute / write-off / close)" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: '20rem' }} />
                  <button type="button" disabled={busy || !transition} onClick={applyTransition}>Apply</button>
                  <button type="button" disabled={busy} onClick={reconcileNow} title="Runs the ledger reconciliation job">Reconcile with ledger</button>
                </div>
              ) : null}

              <div className="ch247-inline-actions">
                <input placeholder="Add internal note…" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: '24rem' }} />
                <button type="button" disabled={busy || !note.trim()} onClick={addNote}>Add note</button>
              </div>

              <h3>Follow-ups</h3>
              <RgTable
                empty="No follow-ups for this case."
                columns={[
                  { header: 'Type', render: (f: CaseDetail['followUps'][number]) => f.type.replace(/_/g, ' ') },
                  { header: 'Status', render: (f) => <RgBadge value={f.status} /> },
                  { header: 'Scheduled', render: (f) => formatDateTime(f.scheduled_at) },
                  { header: 'Assigned', render: (f) => f.assigned_staff_email ?? '—' },
                  { header: 'Notes', render: (f) => f.notes ?? '—' },
                ]}
                rows={data.followUps}
              />

              <h3>Payment promises</h3>
              <RgTable
                empty="No payment promises for this case."
                columns={[
                  { header: 'Promised', render: (p: CaseDetail['promises'][number]) => `${p.promised_amount} ${p.currency}` },
                  { header: 'By', render: (p) => formatDate(p.promised_date) },
                  { header: 'Status', render: (p) => <RgBadge value={p.status} /> },
                  { header: 'Paid (ledger)', render: (p) => `${p.fulfilled_amount} ${p.currency}` },
                ]}
                rows={data.promises}
              />

              <h3>Activity</h3>
              <RgTable
                empty="No activity recorded."
                columns={[
                  { header: 'When', render: (a: CaseDetail['activities'][number]) => formatDateTime(a.created_at) },
                  { header: 'Event', render: (a) => a.event_type.replace(/_/g, ' ') },
                  { header: 'Actor', render: (a) => a.actor_email ?? a.actor_type },
                  { header: 'Description', render: (a) => a.description },
                ]}
                rows={data.activities}
              />
            </div>
          );
        }}
      </RgLoad>
    </RGLayout>
  );
}
