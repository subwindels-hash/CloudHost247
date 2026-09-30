import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import {
  formatDate,
  formatDateTime,
  Paginator,
  RgBadge,
  RgLoad,
  RgTable,
  useRgData,
} from '../../components/revenue-guardian/rg-widgets';
import { RG_CASE_STATUSES, type Paginated } from '../../lib/revenue-guardian-api';

export interface CaseRow {
  id: string;
  case_number: string;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  status: string;
  priority: string;
  risk_level: string;
  risk_score: number;
  escalation_level: number;
  currency: string;
  amount_outstanding: string;
  amount_recovered: string;
  invoice_number: string | null;
  invoice_due_date: string | null;
  days_overdue: number | null;
  assigned_staff_email: string | null;
  next_follow_up_at: string | null;
  opened_at: string;
}

export default function RecoveryQueuePage() {
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(searchParams.get('status') ?? 'open');
  const [riskLevel, setRiskLevel] = useState('');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('opened_at');

  const { state } = useRgData<Paginated<CaseRow>>('/recovery-cases', {
    page,
    limit: 25,
    status: status || undefined,
    riskLevel: riskLevel || undefined,
    search: search || undefined,
    sortBy,
  });

  return (
    <RGLayout title="Recovery Queue" hint="Prioritized list of open recovery cases. Amounts come from the billing ledger.">
      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="open">All open</option>
          <option value="">Any status</option>
          {RG_CASE_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select value={riskLevel} onChange={(e) => { setRiskLevel(e.target.value); setPage(1); }}>
          <option value="">Any risk</option>
          {['low', 'medium', 'high', 'critical'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="opened_at">Newest first</option>
          <option value="amount_outstanding">Largest outstanding</option>
          <option value="risk_score">Highest risk</option>
          <option value="days_overdue">Most overdue</option>
          <option value="next_follow_up_at">Next follow-up</option>
        </select>
        <input placeholder="Search customer / case / invoice" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No recovery cases match the current filters."
              columns={[
                { header: 'Case', render: (c: CaseRow) => <Link to={`/admin/revenue-guardian/recovery/${c.id}`}>{c.case_number}</Link> },
                { header: 'Customer', render: (c) => <Link to={`/admin/revenue-guardian/customers/${c.customer_id}`}>{c.customer_email}</Link> },
                { header: 'Invoice', render: (c) => c.invoice_number ?? '—' },
                { header: 'Days overdue', render: (c) => (c.days_overdue !== null ? c.days_overdue : '—') },
                { header: 'Outstanding', render: (c) => `${c.amount_outstanding} ${c.currency}` },
                { header: 'Recovered', render: (c) => `${c.amount_recovered} ${c.currency}` },
                { header: 'Status', render: (c) => <RgBadge value={c.status} /> },
                { header: 'Risk', render: (c) => <><RgBadge value={c.risk_level} /> <span className="ch247-page__hint">{c.risk_score}</span></> },
                { header: 'Esc.', render: (c) => (c.escalation_level > 0 ? `L${c.escalation_level}` : '—') },
                { header: 'Assigned', render: (c) => c.assigned_staff_email ?? '—' },
                { header: 'Next follow-up', render: (c) => formatDateTime(c.next_follow_up_at) },
                { header: 'Opened', render: (c) => formatDate(c.opened_at) },
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
