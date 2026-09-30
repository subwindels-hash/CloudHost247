import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
  RG_ASSIGNMENT_TYPES,
  rgGet,
  rgPatch,
  rgPost,
  type Paginated,
  type RgStaffMember,
} from '../../lib/revenue-guardian-api';

interface AssignmentRow {
  id: string;
  customer_id: string;
  customer_email: string;
  staff_email: string;
  assignment_type: string;
  is_primary: boolean;
  assigned_at: string;
  ended_at: string | null;
  reason: string | null;
  source: string;
  assigned_by_email: string | null;
}

interface AssignmentRule {
  id: string;
  name: string;
  conditions_json: Record<string, unknown>;
  staff_user_id: string;
  assignment_type: string;
  enabled: boolean;
  priority: number;
}

export default function AssignmentsPage() {
  const [page, setPage] = useState(1);
  const [includeEnded, setIncludeEnded] = useState(false);
  const [error, setError] = useState('');
  const [staff, setStaff] = useState<RgStaffMember[]>([]);
  const [rules, setRules] = useState<AssignmentRule[]>([]);
  const [form, setForm] = useState({ customerId: '', staffUserId: '', assignmentType: 'account_manager', reason: '' });
  const [ruleForm, setRuleForm] = useState({ name: '', staffUserId: '', assignmentType: 'account_manager', country: '', minRecurringRevenue: '' });

  const { state, reload } = useRgData<Paginated<AssignmentRow>>('/assignments', { page, limit: 25, includeEnded: includeEnded || undefined });

  async function loadRules() {
    try {
      const res = await rgGet<{ rules: AssignmentRule[] }>('/assignment-rules');
      setRules(res.rules);
    } catch {
      /* rules require assign permission; ignore for read-only viewers */
    }
  }

  useEffect(() => {
    fetchRgStaff().then((r) => setStaff(r.staff)).catch(() => undefined);
    void loadRules();
  }, []);

  async function assign() {
    setError('');
    try {
      await rgPost('/assignments', {
        customerIds: [form.customerId],
        staffUserId: form.staffUserId,
        assignmentType: form.assignmentType,
        reason: form.reason || undefined,
      });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Assignment failed');
    }
  }

  async function endAssignment(id: string) {
    const reason = window.prompt('Reason for ending this assignment:');
    if (!reason) return;
    setError('');
    try {
      await rgPatch(`/assignments/${id}`, { action: 'end', reason });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function createRule() {
    setError('');
    try {
      const conditions: Record<string, unknown> = {};
      if (ruleForm.country) conditions['country'] = ruleForm.country;
      if (ruleForm.minRecurringRevenue) conditions['minRecurringRevenue'] = Number(ruleForm.minRecurringRevenue);
      await rgPost('/assignment-rules', {
        name: ruleForm.name,
        conditions,
        staffUserId: ruleForm.staffUserId,
        assignmentType: ruleForm.assignmentType,
      });
      setRuleForm({ name: '', staffUserId: '', assignmentType: 'account_manager', country: '', minRecurringRevenue: '' });
      void loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rule creation failed');
    }
  }

  async function toggleRule(rule: AssignmentRule) {
    try {
      await rgPatch(`/assignment-rules/${rule.id}`, { enabled: !rule.enabled });
      void loadRules();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  return (
    <RGLayout title="Customer Assignments" hint="One active owner per customer per role. Reassignment ends the old row — the full ownership history is preserved and audited.">
      {error ? <p className="ch247-page__hint" role="alert">Error: {error}</p> : null}

      <div className="ch247-card" style={{ marginBottom: '0.75rem' }}>
        <h3>Assign a customer</h3>
        <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
          <input placeholder="Customer ID (uuid)" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} style={{ minWidth: '19rem' }} />
          <select value={form.staffUserId} onChange={(e) => setForm({ ...form, staffUserId: e.target.value })}>
            <option value="">Staff member…</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.role})</option>)}
          </select>
          <select value={form.assignmentType} onChange={(e) => setForm({ ...form, assignmentType: e.target.value })}>
            {RG_ASSIGNMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <button type="button" disabled={!form.customerId || !form.staffUserId} onClick={assign}>Assign</button>
        </div>
      </div>

      <label className="ch247-inline-actions" style={{ marginBottom: '0.5rem' }}>
        <input type="checkbox" checked={includeEnded} onChange={(e) => { setIncludeEnded(e.target.checked); setPage(1); }} />
        Show ended assignments (history)
      </label>

      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No assignments yet."
              columns={[
                { header: 'Customer', render: (a: AssignmentRow) => <Link to={`/admin/revenue-guardian/customers/${a.customer_id}`}>{a.customer_email}</Link> },
                { header: 'Staff', render: (a) => a.staff_email },
                { header: 'Role', render: (a) => a.assignment_type.replace(/_/g, ' ') },
                { header: 'Source', render: (a) => a.source },
                { header: 'Assigned', render: (a) => formatDateTime(a.assigned_at) },
                { header: 'Ended', render: (a) => (a.ended_at ? formatDateTime(a.ended_at) : <RgBadge value="active" />) },
                { header: 'Reason', render: (a) => a.reason ?? '—' },
                { header: 'By', render: (a) => a.assigned_by_email ?? 'system' },
                { header: 'Actions', render: (a) => (!a.ended_at ? <button type="button" onClick={() => endAssignment(a.id)}>End</button> : '—') },
              ]}
              rows={data.items}
            />
            <Paginator page={data.page} limit={data.limit} total={data.total} onPage={setPage} />
          </>
        )}
      </RgLoad>

      <h3 style={{ marginTop: '1rem' }}>Automatic assignment rules</h3>
      <p className="ch247-page__hint">Declarative conditions stored in the database (validated schema — never code). Applied by the run_assignment_rules automation; rules never override an existing owner.</p>
      <div className="ch247-inline-actions" style={{ flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <input placeholder="Rule name" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} />
        <input placeholder="Country (optional)" value={ruleForm.country} onChange={(e) => setRuleForm({ ...ruleForm, country: e.target.value })} />
        <input placeholder="Min monthly revenue (optional)" value={ruleForm.minRecurringRevenue} onChange={(e) => setRuleForm({ ...ruleForm, minRecurringRevenue: e.target.value })} />
        <select value={ruleForm.staffUserId} onChange={(e) => setRuleForm({ ...ruleForm, staffUserId: e.target.value })}>
          <option value="">Assign to…</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
        </select>
        <select value={ruleForm.assignmentType} onChange={(e) => setRuleForm({ ...ruleForm, assignmentType: e.target.value })}>
          {RG_ASSIGNMENT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
        <button type="button" disabled={!ruleForm.name || !ruleForm.staffUserId} onClick={createRule}>Add rule</button>
      </div>
      <RgTable
        empty="No automatic assignment rules configured."
        columns={[
          { header: 'Name', render: (r: AssignmentRule) => r.name },
          { header: 'Conditions', render: (r) => JSON.stringify(r.conditions_json) },
          { header: 'Assigns to', render: (r) => staff.find((s) => s.id === r.staff_user_id)?.full_name ?? r.staff_user_id },
          { header: 'Role', render: (r) => r.assignment_type.replace(/_/g, ' ') },
          { header: 'Priority', render: (r) => r.priority },
          { header: 'Enabled', render: (r) => <RgBadge value={r.enabled ? 'active' : 'cancelled'} /> },
          { header: 'Actions', render: (r) => <button type="button" onClick={() => toggleRule(r)}>{r.enabled ? 'Disable' : 'Enable'}</button> },
        ]}
        rows={rules}
      />
    </RGLayout>
  );
}
