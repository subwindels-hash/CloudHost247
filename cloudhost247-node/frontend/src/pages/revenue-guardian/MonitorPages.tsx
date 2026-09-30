/**
 * Revenue monitors (spec §11–§15): orders needing collection, renewals, renewal rescue,
 * expiring services, pre-suspension and pre-termination — all read live from billing tables.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import type { Paginated } from '../../lib/revenue-guardian-api';

interface OrderRow {
  order_id: string;
  order_number: string;
  customer_id: string;
  customer_email: string;
  created_at: string;
  currency: string;
  total_amount: string;
  status: string;
  payment_status: string;
  invoice_number: string | null;
  products: string | null;
  is_new_customer: boolean;
  assigned_staff_email: string | null;
  open_case_count: number;
  pending_follow_ups: number;
}

export function OrdersPage() {
  const [page, setPage] = useState(1);
  const [paymentStatus, setPaymentStatus] = useState('unpaid');
  const [customerType, setCustomerType] = useState('');
  const { state } = useRgData<Paginated<OrderRow>>('/orders', {
    page,
    limit: 25,
    paymentStatus: paymentStatus || undefined,
    customerType: customerType || undefined,
  });
  return (
    <RGLayout title="Orders — Collection View" hint="Orders with their payment state, follow-up presence, and staff ownership.">
      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem' }}>
        <select value={paymentStatus} onChange={(e) => { setPaymentStatus(e.target.value); setPage(1); }}>
          {['unpaid', 'pending', 'paid', 'failed', 'refunded', ''].map((s) => <option key={s} value={s}>{s === '' ? 'Any payment status' : s}</option>)}
        </select>
        <select value={customerType} onChange={(e) => { setCustomerType(e.target.value); setPage(1); }}>
          <option value="">All customers</option>
          <option value="new">New customers</option>
          <option value="existing">Existing customers</option>
        </select>
      </div>
      <RgLoad state={state}>
        {(data) => (
          <>
            <RgTable
              empty="No orders match the current filters."
              columns={[
                { header: 'Order', render: (o: OrderRow) => o.order_number },
                { header: 'Customer', render: (o) => <><Link to={`/admin/revenue-guardian/customers/${o.customer_id}`}>{o.customer_email}</Link> {o.is_new_customer ? <RgBadge value="new" /> : null}</> },
                { header: 'Products', render: (o) => o.products ?? '—' },
                { header: 'Total', render: (o) => `${o.total_amount} ${o.currency}` },
                { header: 'Order status', render: (o) => <RgBadge value={o.status} /> },
                { header: 'Payment', render: (o) => <RgBadge value={o.payment_status} /> },
                { header: 'Invoice', render: (o) => o.invoice_number ?? '—' },
                { header: 'Open cases', render: (o) => o.open_case_count },
                { header: 'Pending follow-ups', render: (o) => o.pending_follow_ups },
                { header: 'Assigned', render: (o) => o.assigned_staff_email ?? '—' },
                { header: 'Placed', render: (o) => formatDateTime(o.created_at) },
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

interface RenewalRow {
  kind: string;
  reference_id: string;
  customer_id: string;
  customer_email: string;
  label: string;
  expires_at: string;
  days_remaining: number;
  renewal_amount: string | null;
  currency: string | null;
  status: string;
  assigned_staff_email: string | null;
  open_case_count: number;
}

function RenewalTable({ items }: { items: RenewalRow[] }) {
  return (
    <RgTable
      empty="Nothing in this window."
      columns={[
        { header: 'Type', render: (r: RenewalRow) => r.kind },
        { header: 'Customer', render: (r) => <Link to={`/admin/revenue-guardian/customers/${r.customer_id}`}>{r.customer_email}</Link> },
        { header: 'Service / domain', render: (r) => r.label },
        { header: 'Expires', render: (r) => formatDate(r.expires_at) },
        { header: 'Days left', render: (r) => (r.days_remaining <= 7 ? <RgBadge value="overdue" /> : null) ?? r.days_remaining },
        { header: 'Renewal amount (PROJECTED)', render: (r) => (r.renewal_amount ? `${r.renewal_amount} ${r.currency}/mo` : '—') },
        { header: 'Status', render: (r) => <RgBadge value={r.status} /> },
        { header: 'Open cases', render: (r) => r.open_case_count },
        { header: 'Assigned', render: (r) => r.assigned_staff_email ?? '—' },
      ]}
      rows={items}
    />
  );
}

export function RenewalsPage() {
  const [withinDays, setWithinDays] = useState(60);
  const { state } = useRgData<{ items: RenewalRow[]; reminderWindows: number[] }>('/renewals', { withinDays });
  return (
    <RGLayout title="Upcoming Renewals" hint="Subscriptions (billing period end) and domains (expiry) side by side. Renewal amounts are PROJECTED, not booked revenue.">
      <div className="ch247-inline-actions" style={{ marginBottom: '0.75rem' }}>
        <label>Window:&nbsp;
          <select value={withinDays} onChange={(e) => setWithinDays(Number(e.target.value))}>
            {[14, 30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
      </div>
      <RgLoad state={state}>
        {(data) => (
          <>
            <p className="ch247-page__hint">Automatic reminder windows (configurable in Settings): {data.reminderWindows.join(', ')} days before expiry.</p>
            <RenewalTable items={data.items} />
          </>
        )}
      </RgLoad>
    </RGLayout>
  );
}

export function RenewalRescuePage() {
  const { state } = useRgData<{ items: RenewalRow[] }>('/renewals', { withinDays: 14 });
  return (
    <RGLayout title="Renewal Rescue" hint="Renewals inside 14 days — the save-window where a call or reminder still prevents churn. The process_renewals automation opens urgent follow-ups for these.">
      <RgLoad state={state}>{(data) => <RenewalTable items={data.items} />}</RgLoad>
    </RGLayout>
  );
}

export function ExpiringServicesPage() {
  const { state } = useRgData<{ items: RenewalRow[] }>('/expiring-services', { withinDays: 90 });
  return (
    <RGLayout title="Expiring Services" hint="Everything expiring within 90 days, including items that lapsed in the last 30 days.">
      <RgLoad state={state}>{(data) => <RenewalTable items={data.items} />}</RgLoad>
    </RGLayout>
  );
}

interface LifecycleRow {
  subscription_id: string;
  customer_id: string;
  customer_email: string;
  plan_label: string;
  status: string;
  projected_date: string | null;
  days_remaining: number | null;
  outstanding: string;
  currency: string;
  assigned_staff_email: string | null;
  open_case_count: number;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
}

function LifecyclePage({ phase, title, hint }: { phase: 'pre-suspension' | 'pre-termination'; title: string; hint: string }) {
  const { state } = useRgData<{ items: LifecycleRow[] }>(`/${phase}`);
  return (
    <RGLayout title={title} hint={hint}>
      <RgLoad state={state}>
        {(data) => (
          <RgTable
            empty="No services in this phase — good news."
            columns={[
              { header: 'Customer', render: (r: LifecycleRow) => <Link to={`/admin/revenue-guardian/customers/${r.customer_id}`}>{r.customer_email}</Link> },
              { header: 'Plan', render: (r) => r.plan_label },
              { header: 'Status', render: (r) => <RgBadge value={r.status} /> },
              { header: phase === 'pre-suspension' ? 'Projected suspension' : 'Projected termination', render: (r) => formatDate(r.projected_date) },
              { header: 'Days left', render: (r) => r.days_remaining ?? '—' },
              { header: 'Outstanding', render: (r) => `${r.outstanding} ${r.currency}` },
              { header: 'Open cases', render: (r) => r.open_case_count },
              { header: 'Last contact', render: (r) => formatDateTime(r.last_contact_at) },
              { header: 'Next follow-up', render: (r) => formatDateTime(r.next_follow_up_at) },
              { header: 'Assigned', render: (r) => r.assigned_staff_email ?? '—' },
            ]}
            rows={data.items}
          />
        )}
      </RgLoad>
    </RGLayout>
  );
}

export function PreSuspensionPage() {
  return (
    <LifecyclePage
      phase="pre-suspension"
      title="Pre-Suspension"
      hint="Past-due subscriptions with their projected suspension date, computed from the platform's real dunning configuration."
    />
  );
}

export function PreTerminationPage() {
  return (
    <LifecyclePage
      phase="pre-termination"
      title="Pre-Termination"
      hint="Suspended subscriptions approaching termination — last chance to save the revenue. The automation escalates open cases to level 3."
    />
  );
}
