/**
 * Analytical views (spec §4, §29–§32): revenue at risk, customer health, high value, aging
 * risk analysis, and forecast (ACTUAL vs PROJECTED clearly separated).
 */
import { Link } from 'react-router-dom';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import {
  MetricCard,
  MetricRow,
  MoneyList,
  RgBadge,
  RgLoad,
  RgTable,
  formatDate,
  useRgData,
} from '../../components/revenue-guardian/rg-widgets';
import type { CurrencyAmount } from '../../lib/revenue-guardian-api';

interface AtRiskRow {
  customer_id: string;
  customer_email: string;
  customer_name: string;
  currency: string;
  outstanding: string;
  overdue: string;
  overdue_invoice_count: number;
  max_overdue_days: number;
  failed_payments: number;
  broken_promises: number;
  recurring_revenue: string;
  active_services: number;
  assigned_staff_email: string | null;
  open_case_count: number;
  risk_score: number;
  risk_level: string;
  risk_reasons?: string[];
  reasons?: string[];
  health?: string;
}

function AtRiskTable({ items, showHealth }: { items: AtRiskRow[]; showHealth?: boolean }) {
  return (
    <RgTable
      empty="No customers with unpaid invoices."
      columns={[
        { header: 'Customer', render: (r: AtRiskRow) => <Link to={`/admin/revenue-guardian/customers/${r.customer_id}`}>{r.customer_email}</Link> },
        ...(showHealth ? [{ header: 'Health', render: (r: AtRiskRow) => <RgBadge value={r.health} /> }] : []),
        { header: 'Risk', render: (r) => <><RgBadge value={r.risk_level} /> <span className="ch247-page__hint">{r.risk_score}/100</span></> },
        { header: 'Outstanding', render: (r) => `${r.outstanding} ${r.currency}` },
        { header: 'Overdue', render: (r) => `${r.overdue} ${r.currency} (${r.overdue_invoice_count} inv.)` },
        { header: 'Oldest overdue', render: (r) => `${r.max_overdue_days} d` },
        { header: 'Failed payments', render: (r) => r.failed_payments },
        { header: 'Broken promises', render: (r) => r.broken_promises },
        { header: 'Monthly revenue', render: (r) => `${r.recurring_revenue} ${r.currency}` },
        { header: 'Open cases', render: (r) => r.open_case_count },
        { header: 'Assigned', render: (r) => r.assigned_staff_email ?? '—' },
        { header: 'Why', render: (r) => <span className="ch247-page__hint">{(r.risk_reasons ?? r.reasons ?? []).join('; ') || '—'}</span> },
      ]}
      rows={items}
    />
  );
}

export function RevenueAtRiskPage() {
  const { state } = useRgData<{ items: AtRiskRow[] }>('/revenue-at-risk');
  return (
    <RGLayout title="Revenue at Risk" hint="Every risk score is computed from stored billing data with its reasons shown — nothing is estimated or invented.">
      <RgLoad state={state}>{(data) => <AtRiskTable items={data.items} />}</RgLoad>
    </RGLayout>
  );
}

export function CustomerHealthPage() {
  const { state } = useRgData<{ items: AtRiskRow[] }>('/customer-health');
  return (
    <RGLayout title="Customer Health" hint="HEALTHY / WATCH / AT RISK / CRITICAL derived from the same documented risk rules.">
      <RgLoad state={state}>{(data) => <AtRiskTable items={data.items} showHealth />}</RgLoad>
    </RGLayout>
  );
}

interface HighValueRow {
  customer_id: string;
  customer_email: string;
  currency: string;
  lifetime_revenue: string;
  recurring_revenue: string;
  active_services: number;
  outstanding: string;
  open_case_count: number;
  assigned_staff_email: string | null;
  next_renewal: string | null;
}

export function HighValuePage() {
  const { state } = useRgData<{ items: HighValueRow[]; thresholds: { lifetimeRevenue: number; recurringRevenue: number; activeServices: number } }>('/high-value');
  return (
    <RGLayout title="High-Value Customers" hint="Qualification thresholds are configurable in Settings. Lifetime revenue = actual ledger payments.">
      <RgLoad state={state}>
        {(data) => (
          <>
            <p className="ch247-page__hint">
              Thresholds (any qualifies): lifetime ≥ {data.thresholds.lifetimeRevenue}, monthly ≥ {data.thresholds.recurringRevenue}, active services ≥ {data.thresholds.activeServices}.
            </p>
            <RgTable
              empty="No customers meet the high-value thresholds yet."
              columns={[
                { header: 'Customer', render: (r: HighValueRow) => <Link to={`/admin/revenue-guardian/customers/${r.customer_id}`}>{r.customer_email}</Link> },
                { header: 'Lifetime revenue (ACTUAL)', render: (r) => `${r.lifetime_revenue} ${r.currency}` },
                { header: 'Monthly recurring', render: (r) => `${r.recurring_revenue} ${r.currency}` },
                { header: 'Active services', render: (r) => r.active_services },
                { header: 'Outstanding', render: (r) => `${r.outstanding} ${r.currency}` },
                { header: 'Open cases', render: (r) => r.open_case_count },
                { header: 'Next renewal', render: (r) => formatDate(r.next_renewal) },
                { header: 'Assigned', render: (r) => r.assigned_staff_email ?? '—' },
              ]}
              rows={data.items}
            />
          </>
        )}
      </RgLoad>
    </RGLayout>
  );
}

interface AgingBucket {
  currency: string;
  bucket: string;
  invoice_count: number;
  amount: string;
}

export function RiskAnalysisPage() {
  const { state } = useRgData<{ buckets: AgingBucket[]; boundaries: number[] }>('/risk-analysis');
  return (
    <RGLayout title="Risk Analysis — Overdue Aging" hint="Unpaid invoices grouped into aging buckets per currency (bucket boundaries configurable in Settings).">
      <RgLoad state={state}>
        {(data) => (
          <>
            <p className="ch247-page__hint">Buckets: current, then {data.boundaries.join(' / ')} day boundaries, last bucket open-ended.</p>
            <RgTable
              empty="No unpaid invoices — nothing is aging."
              columns={[
                { header: 'Currency', render: (b: AgingBucket) => b.currency },
                { header: 'Bucket (days overdue)', render: (b) => b.bucket },
                { header: 'Invoices', render: (b) => b.invoice_count },
                { header: 'Amount (OUTSTANDING)', render: (b) => `${b.amount} ${b.currency}` },
              ]}
              rows={data.buckets}
            />
          </>
        )}
      </RgLoad>
    </RGLayout>
  );
}

interface ForecastData {
  actual: {
    collectedLast30d: CurrencyAmount[];
    collectedLast90d: CurrencyAmount[];
    outstanding: CurrencyAmount[];
    overdue: CurrencyAmount[];
  };
  projected: {
    renewalsNext30d: CurrencyAmount[];
    renewalsNext90d: CurrencyAmount[];
    atRisk: CurrencyAmount[];
    expectedRecovery: CurrencyAmount[];
    historicalRecoveryRate: number | null;
  };
}

export function ForecastPage() {
  const { state } = useRgData<ForecastData>('/forecast');
  return (
    <RGLayout title="Revenue Forecast" hint="ACTUAL figures come from the ledger and invoices. PROJECTED figures are estimates and are never presented as confirmed revenue.">
      <RgLoad state={state}>
        {(data) => (
          <div className="ch247-stack">
            <h3>ACTUAL (ledger-confirmed)</h3>
            <MetricRow>
              <MetricCard label="Collected — last 30 days" value={<MoneyList amounts={data.actual.collectedLast30d} />} />
              <MetricCard label="Collected — last 90 days" value={<MoneyList amounts={data.actual.collectedLast90d} />} />
              <MetricCard label="Outstanding" value={<MoneyList amounts={data.actual.outstanding} />} />
              <MetricCard label="Overdue" value={<MoneyList amounts={data.actual.overdue} />} />
            </MetricRow>
            <h3>PROJECTED (estimates — not confirmed revenue)</h3>
            <MetricRow>
              <MetricCard label="Renewals next 30 days" value={<MoneyList amounts={data.projected.renewalsNext30d} />} hint="If every subscription renews" />
              <MetricCard label="Renewals next 90 days" value={<MoneyList amounts={data.projected.renewalsNext90d} />} hint="If every subscription renews" />
              <MetricCard label="At risk (open cases)" value={<MoneyList amounts={data.projected.atRisk} />} />
              <MetricCard
                label="Expected recovery"
                value={<MoneyList amounts={data.projected.expectedRecovery} emptyLabel="n/a — no recovery history yet" />}
                hint={data.projected.historicalRecoveryRate === null ? 'Needs closed-case history' : `Based on your actual ${data.projected.historicalRecoveryRate}% historical recovery rate`}
              />
            </MetricRow>
          </div>
        )}
      </RgLoad>
    </RGLayout>
  );
}
