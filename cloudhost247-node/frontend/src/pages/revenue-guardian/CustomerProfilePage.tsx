import { useParams } from 'react-router-dom';
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

interface ProfileData {
  profile: {
    customer: { id: string; email: string; fullName: string; status: string; country: string | null; customerId: string | null; createdAt: string; isNewCustomer: boolean };
    financials: Array<{ currency: string; totalBilled: string; totalPaid: string; totalRefunded: string; outstanding: string; overdue: string }>;
    recurringRevenue: Array<{ currency: string; amount: string }>;
    assignments: Array<{ id: string; assignment_type: string; staff_email: string; assigned_at: string }>;
    invoices: Array<{ id: string; invoice_number: string; currency: string; total_amount: string; status: string; due_date: string; is_overdue: boolean; days_overdue: number }>;
    payments: Array<{ id: string; amount: string; currency: string; status: string; provider: string | null; invoice_number: string | null; initiated_at: string; failure_reason: string | null }>;
    services: Array<{ id: string; label: string; status: string }>;
    domains: Array<{ id: string; domain_name: string; status: string; expires_at: string | null; days_to_expiry: number | null }>;
    orders: Array<{ id: string; order_number: string; total_amount: string; currency: string; status: string; payment_status: string; products: string | null; created_at: string }>;
    subscriptions: Array<{ id: string; status: string; current_period_end: string; plan_name: string; product_name: string | null }>;
    cases: Array<{ id: string; case_number: string; status: string; risk_level: string; amount_outstanding: string; amount_recovered: string; currency: string; opened_at: string; assigned_staff_email: string | null }>;
    promises: Array<{ id: string; promised_amount: string; currency: string; promised_date: string; status: string; invoice_number: string }>;
  };
  timeline: Array<{ id: string; event_type: string; description: string; actor_email: string | null; actor_type: string; created_at: string }>;
  communications: Array<{ id: string; channel: string; template_key: string; subject: string; status: string; outbox_status: string | null; created_at: string; recipient: string }>;
}

export default function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useRgData<ProfileData>(`/customers/${id}`);

  return (
    <RGLayout title="Customer Revenue Profile" hint="Complete revenue picture read live from the billing tables — nothing here is duplicated data.">
      <RgLoad state={state}>
        {({ profile, timeline, communications }) => (
          <div className="ch247-stack">
            <div className="ch247-inline-actions" style={{ flexWrap: 'wrap' }}>
              <strong>{profile.customer.fullName}</strong>
              <span>{profile.customer.email}</span>
              <RgBadge value={profile.customer.status} />
              {profile.customer.isNewCustomer ? <RgBadge value="new" /> : null}
              {profile.customer.country ? <span className="ch247-page__hint">{profile.customer.country}</span> : null}
              {profile.customer.customerId ? <span className="ch247-page__hint">ID {profile.customer.customerId}</span> : null}
              <span className="ch247-page__hint">since {formatDate(profile.customer.createdAt)}</span>
            </div>

            <MetricRow>
              {profile.financials.map((f) => (
                <MetricCard
                  key={f.currency}
                  label={`Financials (${f.currency})`}
                  value={<span>Outstanding {f.outstanding}</span>}
                  hint={`Billed ${f.totalBilled} · Paid ${f.totalPaid} · Refunded ${f.totalRefunded} · Overdue ${f.overdue}`}
                />
              ))}
              <MetricCard
                label="Monthly recurring"
                value={profile.recurringRevenue.length === 0 ? '0.00' : profile.recurringRevenue.map((r) => `${r.amount} ${r.currency}`).join(', ')}
              />
              <MetricCard label="Assigned staff" value={profile.assignments.length === 0 ? 'Unassigned' : profile.assignments.map((a) => `${a.staff_email} (${a.assignment_type.replace(/_/g, ' ')})`).join(', ')} />
            </MetricRow>

            <h3>Recovery cases</h3>
            <RgTable
              empty="No recovery cases."
              columns={[
                { header: 'Case', render: (c: ProfileData['profile']['cases'][number]) => <a href={`/admin/revenue-guardian/recovery/${c.id}`}>{c.case_number}</a> },
                { header: 'Status', render: (c) => <RgBadge value={c.status} /> },
                { header: 'Risk', render: (c) => <RgBadge value={c.risk_level} /> },
                { header: 'Outstanding', render: (c) => `${c.amount_outstanding} ${c.currency}` },
                { header: 'Recovered', render: (c) => `${c.amount_recovered} ${c.currency}` },
                { header: 'Opened', render: (c) => formatDate(c.opened_at) },
                { header: 'Assigned', render: (c) => c.assigned_staff_email ?? '—' },
              ]}
              rows={profile.cases}
            />

            <h3>Invoices</h3>
            <RgTable
              empty="No invoices."
              columns={[
                { header: 'Invoice', render: (i: ProfileData['profile']['invoices'][number]) => i.invoice_number },
                { header: 'Amount', render: (i) => `${i.total_amount} ${i.currency}` },
                { header: 'Status', render: (i) => <>{i.is_overdue ? <RgBadge value="overdue" /> : <RgBadge value={i.status} />}</> },
                { header: 'Due', render: (i) => `${formatDate(i.due_date)}${i.days_overdue > 0 ? ` (${i.days_overdue}d overdue)` : ''}` },
              ]}
              rows={profile.invoices}
            />

            <h3>Payments</h3>
            <RgTable
              empty="No payment attempts."
              columns={[
                { header: 'When', render: (p: ProfileData['profile']['payments'][number]) => formatDateTime(p.initiated_at) },
                { header: 'Amount', render: (p) => `${p.amount} ${p.currency}` },
                { header: 'Status', render: (p) => <RgBadge value={p.status} /> },
                { header: 'Provider', render: (p) => p.provider ?? '—' },
                { header: 'Invoice', render: (p) => p.invoice_number ?? '—' },
                { header: 'Failure reason', render: (p) => p.failure_reason ?? '—' },
              ]}
              rows={profile.payments}
            />

            <h3>Payment promises</h3>
            <RgTable
              empty="No payment promises."
              columns={[
                { header: 'Invoice', render: (p: ProfileData['profile']['promises'][number]) => p.invoice_number },
                { header: 'Promised', render: (p) => `${p.promised_amount} ${p.currency}` },
                { header: 'By', render: (p) => formatDate(p.promised_date) },
                { header: 'Status', render: (p) => <RgBadge value={p.status} /> },
              ]}
              rows={profile.promises}
            />

            <h3>Subscriptions, services, domains & orders</h3>
            <RgTable
              empty="No subscriptions."
              columns={[
                { header: 'Subscription', render: (s: ProfileData['profile']['subscriptions'][number]) => `${s.product_name ?? ''} ${s.plan_name}`.trim() },
                { header: 'Status', render: (s) => <RgBadge value={s.status} /> },
                { header: 'Period ends', render: (s) => formatDate(s.current_period_end) },
              ]}
              rows={profile.subscriptions}
            />
            <RgTable
              empty="No services."
              columns={[
                { header: 'Service', render: (s: ProfileData['profile']['services'][number]) => s.label },
                { header: 'Status', render: (s) => <RgBadge value={s.status} /> },
              ]}
              rows={profile.services}
            />
            <RgTable
              empty="No domains."
              columns={[
                { header: 'Domain', render: (d: ProfileData['profile']['domains'][number]) => d.domain_name },
                { header: 'Status', render: (d) => <RgBadge value={d.status} /> },
                { header: 'Expires', render: (d) => `${formatDate(d.expires_at)}${d.days_to_expiry !== null ? ` (${d.days_to_expiry}d)` : ''}` },
              ]}
              rows={profile.domains}
            />
            <RgTable
              empty="No orders."
              columns={[
                { header: 'Order', render: (o: ProfileData['profile']['orders'][number]) => o.order_number },
                { header: 'Products', render: (o) => o.products ?? '—' },
                { header: 'Total', render: (o) => `${o.total_amount} ${o.currency}` },
                { header: 'Status', render: (o) => <RgBadge value={o.status} /> },
                { header: 'Payment', render: (o) => <RgBadge value={o.payment_status} /> },
                { header: 'Placed', render: (o) => formatDate(o.created_at) },
              ]}
              rows={profile.orders}
            />

            <h3>Communication timeline</h3>
            <RgTable
              empty="No communications logged."
              columns={[
                { header: 'When', render: (m: ProfileData['communications'][number]) => formatDateTime(m.created_at) },
                { header: 'Channel', render: (m) => m.channel },
                { header: 'Template', render: (m) => m.template_key },
                { header: 'Subject', render: (m) => m.subject },
                { header: 'To', render: (m) => m.recipient },
                { header: 'Status', render: (m) => <RgBadge value={m.outbox_status === 'DELIVERED' ? 'completed' : m.status} /> },
              ]}
              rows={communications}
            />

            <h3>Activity timeline</h3>
            <RgTable
              empty="No recovery activity."
              columns={[
                { header: 'When', render: (a: ProfileData['timeline'][number]) => formatDateTime(a.created_at) },
                { header: 'Event', render: (a) => a.event_type.replace(/_/g, ' ') },
                { header: 'Actor', render: (a) => a.actor_email ?? a.actor_type },
                { header: 'Description', render: (a) => a.description },
              ]}
              rows={timeline}
            />
          </div>
        )}
      </RgLoad>
    </RGLayout>
  );
}
