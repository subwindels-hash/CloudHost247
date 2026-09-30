/**
 * My Work (spec §25) and Staff Performance (spec §24 — managers/admins only, enforced
 * server-side by revenue_guardian.staff_performance).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import {
  MetricCard,
  MetricRow,
  RgBadge,
  RgLoad,
  RgTable,
  formatDate,
  formatDateTime,
  useRgData,
} from '../../components/revenue-guardian/rg-widgets';

interface MyWorkData {
  cases: Array<{ id: string; case_number: string; customer_id: string; customer_email: string; status: string; amount_outstanding: string; currency: string; next_follow_up_at: string | null }>;
  followUpsToday: Array<{ id: string; customer_email: string; type: string; scheduled_at: string; priority: string }>;
  followUpsOverdue: Array<{ id: string; customer_email: string; type: string; scheduled_at: string; priority: string }>;
  promises: Array<{ id: string; customer_email: string; promised_amount: string; currency: string; promised_date: string; is_overdue: boolean }>;
  customers: Array<{ id: string; customer_id: string; customer_email: string; assignment_type: string }>;
  performance: { recovered_cases: number; closed_cases: number; followups_completed: number; promises_fulfilled: number; promises_broken: number } | null;
}

export function MyWorkPage() {
  const { state } = useRgData<MyWorkData>('/my-work');
  return (
    <RGLayout title="My Work" hint="Your assigned customers, cases, today's and overdue follow-ups, and pending promises.">
      <RgLoad state={state}>
        {(data) => (
          <div className="ch247-stack">
            <MetricRow>
              <MetricCard label="My open cases" value={data.cases.length} />
              <MetricCard label="Follow-ups today" value={data.followUpsToday.length} />
              <MetricCard label="Follow-ups overdue" value={data.followUpsOverdue.length} />
              <MetricCard label="Pending promises" value={data.promises.length} />
              <MetricCard label="My customers" value={data.customers.length} />
            </MetricRow>

            <h3>Overdue follow-ups</h3>
            <RgTable
              empty="Nothing overdue — well done."
              columns={[
                { header: 'Customer', render: (f: MyWorkData['followUpsOverdue'][number]) => f.customer_email },
                { header: 'Type', render: (f) => f.type.replace(/_/g, ' ') },
                { header: 'Was due', render: (f) => formatDateTime(f.scheduled_at) },
                { header: 'Priority', render: (f) => <RgBadge value={f.priority} /> },
              ]}
              rows={data.followUpsOverdue}
            />

            <h3>Due today</h3>
            <RgTable
              empty="No follow-ups due today."
              columns={[
                { header: 'Customer', render: (f: MyWorkData['followUpsToday'][number]) => f.customer_email },
                { header: 'Type', render: (f) => f.type.replace(/_/g, ' ') },
                { header: 'Priority', render: (f) => <RgBadge value={f.priority} /> },
              ]}
              rows={data.followUpsToday}
            />

            <h3>My open cases</h3>
            <RgTable
              empty="No cases assigned to you."
              columns={[
                { header: 'Case', render: (c: MyWorkData['cases'][number]) => <Link to={`/admin/revenue-guardian/recovery/${c.id}`}>{c.case_number}</Link> },
                { header: 'Customer', render: (c) => <Link to={`/admin/revenue-guardian/customers/${c.customer_id}`}>{c.customer_email}</Link> },
                { header: 'Status', render: (c) => <RgBadge value={c.status} /> },
                { header: 'Outstanding', render: (c) => `${c.amount_outstanding} ${c.currency}` },
                { header: 'Next follow-up', render: (c) => formatDateTime(c.next_follow_up_at) },
              ]}
              rows={data.cases}
            />

            <h3>Pending promises</h3>
            <RgTable
              empty="No pending promises."
              columns={[
                { header: 'Customer', render: (p: MyWorkData['promises'][number]) => p.customer_email },
                { header: 'Amount', render: (p) => `${p.promised_amount} ${p.currency}` },
                { header: 'Due', render: (p) => <>{formatDate(p.promised_date)} {p.is_overdue ? <RgBadge value="overdue" /> : null}</> },
              ]}
              rows={data.promises}
            />
          </div>
        )}
      </RgLoad>
    </RGLayout>
  );
}

interface StaffPerfRow {
  staff_user_id: string;
  staff_email: string;
  staff_name: string;
  assigned_customers: number;
  open_cases: number;
  recovered_cases: number;
  closed_cases: number;
  followups_completed: number;
  followups_overdue: number;
  promises_total: number;
  promises_fulfilled: number;
  promises_broken: number;
  revenue_recovered: Record<string, string>;
}

export function StaffPerformancePage() {
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { state } = useRgData<{ items: StaffPerfRow[] }>('/staff-performance', {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  return (
    <RGLayout title="Staff Performance" hint="Visible to managers/administrators only. Recovered revenue = ledger payments received on cases owned by the staff member, per currency.">
      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem' }}>
        <label>From <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} /></label>
        <label>To <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} /></label>
      </div>
      <RgLoad state={state}>
        {(data) => (
          <RgTable
            empty="No staff accounts."
            columns={[
              { header: 'Staff', render: (r: StaffPerfRow) => `${r.staff_name} (${r.staff_email})` },
              { header: 'Customers', render: (r) => r.assigned_customers },
              { header: 'Open cases', render: (r) => r.open_cases },
              { header: 'Recovered', render: (r) => r.recovered_cases },
              { header: 'Closed', render: (r) => r.closed_cases },
              { header: 'Recovery rate', render: (r) => (r.closed_cases > 0 ? `${Math.round((r.recovered_cases / r.closed_cases) * 100)}%` : 'n/a') },
              { header: 'Follow-ups done', render: (r) => r.followups_completed },
              { header: 'Follow-ups overdue', render: (r) => r.followups_overdue },
              { header: 'Promises kept/broken', render: (r) => `${r.promises_fulfilled}/${r.promises_broken}` },
              {
                header: 'Revenue recovered',
                render: (r) => {
                  const entries = Object.entries(r.revenue_recovered ?? {});
                  return entries.length === 0 ? '0.00' : entries.map(([cur, amt]) => `${amt} ${cur}`).join(', ');
                },
              },
            ]}
            rows={data.items}
          />
        )}
      </RgLoad>
    </RGLayout>
  );
}
