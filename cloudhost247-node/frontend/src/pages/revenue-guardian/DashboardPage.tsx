import { Link } from 'react-router-dom';
import RGLayout from '../../components/revenue-guardian/RGLayout';
import { MetricCard, MetricRow, MoneyList, RgLoad, useRgData } from '../../components/revenue-guardian/rg-widgets';
import type { CurrencyAmount } from '../../lib/revenue-guardian-api';

interface DashboardData {
  metrics: {
    revenue: {
      totalOutstanding: CurrencyAmount[];
      totalOverdue: CurrencyAmount[];
      revenueAtRisk: CurrencyAmount[];
      revenueRecovered: CurrencyAmount[];
      recoveredThisMonth: CurrencyAmount[];
      recoveredThisQuarter: CurrencyAmount[];
      recoveredThisYear: CurrencyAmount[];
      pendingPromises: CurrencyAmount[];
      failedPaymentAmount: CurrencyAmount[];
      upcomingRenewals30d: number;
      approachingSuspension: number;
      approachingTermination: number;
    };
    recovery: {
      openCases: number;
      newCases: number;
      followUpsDueToday: number;
      followUpsOverdue: number;
      promisesDueToday: number;
      promisesOverdue: number;
      recoveredCases: number;
      writtenOffCases: number;
      recoveryRate: number | null;
      avgRecoveryDays: number | null;
    };
    customers: {
      withOverdueInvoices: number;
      approachingSuspension: number;
      approachingTermination: number;
      withUpcomingRenewals: number;
      withRepeatedFailures: number;
    };
  };
}

export default function RGDashboardPage() {
  const { state } = useRgData<DashboardData>('/dashboard');

  return (
    <RGLayout title="Recovery Dashboard" hint="All figures are computed live from the billing ledger and recovery workflow — amounts are shown per currency and never blended.">
      <RgLoad state={state}>
        {({ metrics }) => (
          <div className="ch247-stack">
            <h3>Revenue</h3>
            <MetricRow>
              <MetricCard label="Outstanding (unpaid invoices)" value={<MoneyList amounts={metrics.revenue.totalOutstanding} />} />
              <MetricCard label="Overdue" value={<MoneyList amounts={metrics.revenue.totalOverdue} />} />
              <MetricCard label="At risk (open cases)" value={<MoneyList amounts={metrics.revenue.revenueAtRisk} />} />
              <MetricCard label="Recovered — all time" value={<MoneyList amounts={metrics.revenue.revenueRecovered} />} hint="Ledger payments received while a recovery case was open" />
            </MetricRow>
            <MetricRow>
              <MetricCard label="Recovered this month" value={<MoneyList amounts={metrics.revenue.recoveredThisMonth} />} />
              <MetricCard label="Recovered this quarter" value={<MoneyList amounts={metrics.revenue.recoveredThisQuarter} />} />
              <MetricCard label="Recovered this year" value={<MoneyList amounts={metrics.revenue.recoveredThisYear} />} />
              <MetricCard label="Promised (pending)" value={<MoneyList amounts={metrics.revenue.pendingPromises} />} hint="PROJECTED — not confirmed revenue" />
              <MetricCard label="Failed payments (90d)" value={<MoneyList amounts={metrics.revenue.failedPaymentAmount} />} />
            </MetricRow>

            <h3>Recovery pipeline</h3>
            <MetricRow>
              <MetricCard label="Open cases" value={<Link to="/admin/revenue-guardian/recovery">{metrics.recovery.openCases}</Link>} />
              <MetricCard label="New cases" value={metrics.recovery.newCases} />
              <MetricCard label="Follow-ups due today" value={<Link to="/admin/revenue-guardian/follow-ups?status=due_today">{metrics.recovery.followUpsDueToday}</Link>} />
              <MetricCard label="Follow-ups overdue" value={<Link to="/admin/revenue-guardian/follow-ups?status=overdue">{metrics.recovery.followUpsOverdue}</Link>} />
              <MetricCard label="Promises due today" value={metrics.recovery.promisesDueToday} />
              <MetricCard label="Promises overdue" value={metrics.recovery.promisesOverdue} />
            </MetricRow>
            <MetricRow>
              <MetricCard label="Recovered cases" value={metrics.recovery.recoveredCases} />
              <MetricCard label="Written off" value={metrics.recovery.writtenOffCases} />
              <MetricCard label="Recovery rate" value={metrics.recovery.recoveryRate === null ? 'n/a' : `${metrics.recovery.recoveryRate}%`} hint="Recovered ÷ closed cases" />
              <MetricCard label="Avg days to recover" value={metrics.recovery.avgRecoveryDays ?? 'n/a'} />
            </MetricRow>

            <h3>Customers</h3>
            <MetricRow>
              <MetricCard label="With overdue invoices" value={<Link to="/admin/revenue-guardian/revenue-at-risk">{metrics.customers.withOverdueInvoices}</Link>} />
              <MetricCard label="Approaching suspension" value={<Link to="/admin/revenue-guardian/pre-suspension">{metrics.customers.approachingSuspension}</Link>} />
              <MetricCard label="Approaching termination" value={<Link to="/admin/revenue-guardian/pre-termination">{metrics.customers.approachingTermination}</Link>} />
              <MetricCard label="Renewals in 30 days" value={<Link to="/admin/revenue-guardian/renewals">{metrics.customers.withUpcomingRenewals}</Link>} />
              <MetricCard label="Repeated payment failures" value={metrics.customers.withRepeatedFailures} />
            </MetricRow>
          </div>
        )}
      </RgLoad>
    </RGLayout>
  );
}
