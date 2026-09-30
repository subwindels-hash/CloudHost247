/**
 * Read models for dashboards, monitors, and reports (spec §3–§4, §11–§15, §24, §29–§33).
 *
 * Every number is an aggregate over REAL billing rows (invoices / billing_ledger / payments /
 * orders / subscriptions / customer_domains) or Revenue Guardian workflow rows — nothing is
 * fabricated (spec §62). Monetary aggregates are grouped per currency and never summed across
 * currencies (spec §47). All filtering happens at the database level (spec §58).
 */
import type { Queryable } from '../../db/types';
import { staffScopeClause } from './cases-repo';

export interface CurrencyAmount {
  currency: string;
  amount: string;
}

interface CurrencyRow {
  currency: string;
  amount: string | null;
}

async function perCurrency(db: Queryable, sql: string, params: unknown[] = []): Promise<CurrencyAmount[]> {
  const { rows } = await db.query<CurrencyRow>(sql, params);
  return rows.filter((r) => r.amount !== null && Number(r.amount) !== 0).map((r) => ({ currency: r.currency, amount: r.amount as string }));
}

// ---------------------------------------------------------------------------------------------
// Dashboard (spec §3)
// ---------------------------------------------------------------------------------------------

export interface DashboardMetrics {
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
    expiringServices30d: number;
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
}

/**
 * "Recovered" is defined strictly: 'payment' ledger entries recorded against an invoice while
 * that invoice had an open recovery case — money the recovery process actually brought back,
 * not all revenue (spec §3, §62).
 */
export async function getDashboardMetrics(db: Queryable, scopeStaffId: string | null): Promise<DashboardMetrics> {
  const scopeParams: unknown[] = scopeStaffId ? [scopeStaffId] : [];
  const invoiceScope = scopeStaffId ? `AND ${staffScopeClause('i.user_id', null, 1)}` : '';
  const caseScope = scopeStaffId ? `AND ${staffScopeClause('c.customer_id', 'c.assigned_staff_id', 1)}` : '';
  const followUpScope = scopeStaffId ? `AND ${staffScopeClause('f.customer_id', 'f.assigned_staff_id', 1)}` : '';
  const promiseScope = scopeStaffId ? `AND ${staffScopeClause('p.customer_id', 'p.assigned_staff_id', 1)}` : '';

  const totalOutstanding = await perCurrency(
    db,
    `SELECT i.currency, sum(i.total_amount)::text AS amount FROM invoices i
      WHERE i.status = 'unpaid' ${invoiceScope} GROUP BY i.currency`,
    scopeParams
  );
  const totalOverdue = await perCurrency(
    db,
    `SELECT i.currency, sum(i.total_amount)::text AS amount FROM invoices i
      WHERE i.status = 'unpaid' AND i.due_date < CURRENT_DATE ${invoiceScope} GROUP BY i.currency`,
    scopeParams
  );
  const revenueAtRisk = await perCurrency(
    db,
    `SELECT c.currency, sum(c.amount_outstanding)::text AS amount
       FROM revenue_guardian_recovery_cases c
      WHERE c.closed_at IS NULL ${caseScope} GROUP BY c.currency`,
    scopeParams
  );

  const recoveredSql = (period: string) => `
    SELECT l.currency, sum(l.amount)::text AS amount
      FROM billing_ledger l
      JOIN revenue_guardian_recovery_cases c
        ON c.invoice_id = l.invoice_id AND l.created_at >= c.opened_at
       AND (c.closed_at IS NULL OR l.created_at <= c.closed_at)
     WHERE l.entry_type = 'payment' ${period} ${caseScope}
     GROUP BY l.currency`;

  const revenueRecovered = await perCurrency(db, recoveredSql(''), scopeParams);
  const recoveredThisMonth = await perCurrency(db, recoveredSql(`AND l.created_at >= date_trunc('month', now())`), scopeParams);
  const recoveredThisQuarter = await perCurrency(db, recoveredSql(`AND l.created_at >= date_trunc('quarter', now())`), scopeParams);
  const recoveredThisYear = await perCurrency(db, recoveredSql(`AND l.created_at >= date_trunc('year', now())`), scopeParams);

  const pendingPromises = await perCurrency(
    db,
    `SELECT p.currency, sum(p.promised_amount)::text AS amount
       FROM revenue_guardian_payment_promises p
      WHERE p.status = 'pending' ${promiseScope} GROUP BY p.currency`,
    scopeParams
  );
  const failedPaymentAmount = await perCurrency(
    db,
    `SELECT pm.currency, sum(pm.amount)::text AS amount FROM payments pm
      WHERE pm.status = 'failed' AND pm.created_at > now() - interval '90 days'
      ${scopeStaffId ? `AND ${staffScopeClause('pm.user_id', null, 1)}` : ''}
      GROUP BY pm.currency`,
    scopeParams
  );

  const counts = await db.query<Record<string, string>>(
    `SELECT
       (SELECT count(*) FROM revenue_guardian_recovery_cases c WHERE c.closed_at IS NULL ${caseScope}) AS open_cases,
       (SELECT count(*) FROM revenue_guardian_recovery_cases c WHERE c.status = 'new' AND c.closed_at IS NULL ${caseScope}) AS new_cases,
       (SELECT count(*) FROM revenue_guardian_recovery_cases c WHERE c.status = 'recovered' ${caseScope}) AS recovered_cases,
       (SELECT count(*) FROM revenue_guardian_recovery_cases c WHERE c.status = 'written_off' ${caseScope}) AS written_off_cases,
       (SELECT count(*) FROM revenue_guardian_recovery_cases c WHERE c.closed_at IS NOT NULL ${caseScope}) AS closed_cases,
       (SELECT COALESCE(avg(EXTRACT(EPOCH FROM (c.closed_at - c.opened_at)) / 86400), NULL)
          FROM revenue_guardian_recovery_cases c WHERE c.status = 'recovered' ${caseScope}) AS avg_recovery_days,
       (SELECT count(*) FROM revenue_guardian_follow_ups f
         WHERE f.status IN ('pending','snoozed') AND COALESCE(f.snoozed_until, f.scheduled_at)::date = CURRENT_DATE ${followUpScope}) AS followups_today,
       (SELECT count(*) FROM revenue_guardian_follow_ups f
         WHERE f.status IN ('pending','snoozed') AND COALESCE(f.snoozed_until, f.scheduled_at) < now() ${followUpScope}) AS followups_overdue,
       (SELECT count(*) FROM revenue_guardian_payment_promises p
         WHERE p.status = 'pending' AND p.promised_date = CURRENT_DATE ${promiseScope}) AS promises_today,
       (SELECT count(*) FROM revenue_guardian_payment_promises p
         WHERE p.status = 'pending' AND p.promised_date < CURRENT_DATE ${promiseScope}) AS promises_overdue,
       (SELECT count(DISTINCT i.user_id) FROM invoices i
         WHERE i.status = 'unpaid' AND i.due_date < CURRENT_DATE ${invoiceScope}) AS customers_overdue,
       (SELECT count(*) FROM subscriptions s
         WHERE s.status IN ('active','trialing') AND s.current_period_end BETWEEN now() AND now() + interval '30 days'
         ${scopeStaffId ? `AND ${staffScopeClause('s.customer_id', null, 1)}` : ''}) AS upcoming_renewals,
       (SELECT count(*) FROM customer_domains d
         WHERE d.expires_at IS NOT NULL AND d.expires_at BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
         ${scopeStaffId ? `AND ${staffScopeClause('d.user_id', null, 1)}` : ''}) AS expiring_domains,
       (SELECT count(*) FROM subscriptions s WHERE s.status IN ('past_due','grace_period')
         ${scopeStaffId ? `AND ${staffScopeClause('s.customer_id', null, 1)}` : ''}) AS approaching_suspension,
       (SELECT count(*) FROM subscriptions s WHERE s.status = 'suspended'
         ${scopeStaffId ? `AND ${staffScopeClause('s.customer_id', null, 1)}` : ''}) AS approaching_termination,
       (SELECT count(DISTINCT s.customer_id) FROM subscriptions s
         WHERE s.status IN ('past_due','grace_period')
         ${scopeStaffId ? `AND ${staffScopeClause('s.customer_id', null, 1)}` : ''}) AS cust_pre_suspension,
       (SELECT count(DISTINCT s.customer_id) FROM subscriptions s WHERE s.status = 'suspended'
         ${scopeStaffId ? `AND ${staffScopeClause('s.customer_id', null, 1)}` : ''}) AS cust_pre_termination,
       (SELECT count(DISTINCT s.customer_id) FROM subscriptions s
         WHERE s.status IN ('active','trialing') AND s.current_period_end BETWEEN now() AND now() + interval '30 days'
         ${scopeStaffId ? `AND ${staffScopeClause('s.customer_id', null, 1)}` : ''}) AS cust_renewals,
       (SELECT count(*) FROM (
          SELECT pm.user_id FROM payments pm
           WHERE pm.status = 'failed' AND pm.created_at > now() - interval '180 days'
           ${scopeStaffId ? `AND ${staffScopeClause('pm.user_id', null, 1)}` : ''}
           GROUP BY pm.user_id HAVING count(*) >= 2) rf) AS repeated_failures`,
    scopeParams
  );
  const c = counts.rows[0] ?? {};
  const n = (key: string): number => Number(c[key] ?? 0);
  const recoveredCount = n('recovered_cases');
  const closedCount = n('closed_cases');

  return {
    revenue: {
      totalOutstanding,
      totalOverdue,
      revenueAtRisk,
      revenueRecovered,
      recoveredThisMonth,
      recoveredThisQuarter,
      recoveredThisYear,
      pendingPromises,
      failedPaymentAmount,
      upcomingRenewals30d: n('upcoming_renewals'),
      expiringServices30d: n('upcoming_renewals') + n('expiring_domains'),
      approachingSuspension: n('approaching_suspension'),
      approachingTermination: n('approaching_termination'),
    },
    recovery: {
      openCases: n('open_cases'),
      newCases: n('new_cases'),
      followUpsDueToday: n('followups_today'),
      followUpsOverdue: n('followups_overdue'),
      promisesDueToday: n('promises_today'),
      promisesOverdue: n('promises_overdue'),
      recoveredCases: recoveredCount,
      writtenOffCases: n('written_off_cases'),
      recoveryRate: closedCount > 0 ? Math.round((recoveredCount / closedCount) * 1000) / 10 : null,
      avgRecoveryDays: c['avg_recovery_days'] !== null && c['avg_recovery_days'] !== undefined
        ? Math.round(Number(c['avg_recovery_days']) * 10) / 10
        : null,
    },
    customers: {
      withOverdueInvoices: n('customers_overdue'),
      approachingSuspension: n('cust_pre_suspension'),
      approachingTermination: n('cust_pre_termination'),
      withUpcomingRenewals: n('cust_renewals'),
      withRepeatedFailures: n('repeated_failures'),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Revenue at risk / customer health list (spec §4, §29)
// ---------------------------------------------------------------------------------------------

export interface AtRiskCustomerRow {
  customer_id: string;
  customer_email: string;
  customer_name: string;
  country: string | null;
  account_status: string;
  currency: string;
  outstanding: string;
  overdue: string;
  overdue_invoice_count: number;
  max_overdue_days: number;
  failed_payments: number;
  broken_promises: number;
  recurring_revenue: string;
  active_services: number;
  suspended_subscriptions: number;
  past_due_subscriptions: number;
  days_to_renewal: number | null;
  assigned_staff_email: string | null;
  open_case_count: number;
  next_follow_up_at: string | null;
  last_contact_at: string | null;
  is_new_customer: boolean;
}

/**
 * One row per customer that has ANY unpaid invoice, with every stored fact the risk assessment
 * uses. Risk scoring itself happens in the service layer (rules/risk.ts) so it is unit-testable
 * and identical everywhere.
 */
export async function listAtRiskCustomers(
  db: Queryable,
  options: { scopeStaffId?: string | null; limit?: number; includeCurrentOnly?: boolean } = {}
): Promise<AtRiskCustomerRow[]> {
  const params: unknown[] = [];
  let scope = '';
  if (options.scopeStaffId) {
    params.push(options.scopeStaffId);
    scope = `AND ${staffScopeClause('u.id', null, 1)}`;
  }
  params.push(Math.min(500, options.limit ?? 200));
  const { rows } = await db.query<AtRiskCustomerRow>(
    `SELECT u.id AS customer_id, u.email AS customer_email, u.full_name AS customer_name,
            u.country, u.status AS account_status,
            base.currency, base.outstanding, base.overdue,
            base.overdue_invoice_count::int, base.max_overdue_days::int,
            (SELECT count(*)::int FROM payments pm WHERE pm.user_id = u.id AND pm.status = 'failed'
              AND pm.created_at > now() - interval '180 days') AS failed_payments,
            (SELECT count(*)::int FROM revenue_guardian_payment_promises pr
              WHERE pr.customer_id = u.id AND pr.status = 'broken') AS broken_promises,
            (SELECT COALESCE(sum(pp.amount), 0)::text FROM subscriptions sub
              JOIN plan_pricing pp ON pp.plan_id = sub.plan_id AND pp.billing_period = 'monthly'
             WHERE sub.customer_id = u.id AND sub.status IN ('active','trialing','past_due','grace_period')) AS recurring_revenue,
            (SELECT count(*)::int FROM customer_services cs WHERE cs.user_id = u.id AND cs.status = 'active') AS active_services,
            (SELECT count(*)::int FROM subscriptions s2 WHERE s2.customer_id = u.id AND s2.status = 'suspended') AS suspended_subscriptions,
            (SELECT count(*)::int FROM subscriptions s3 WHERE s3.customer_id = u.id AND s3.status IN ('past_due','grace_period')) AS past_due_subscriptions,
            (SELECT LEAST(
                (SELECT min(current_period_end)::date - CURRENT_DATE FROM subscriptions
                  WHERE customer_id = u.id AND status IN ('active','trialing') AND current_period_end >= now()),
                (SELECT min(expires_at) - CURRENT_DATE FROM customer_domains
                  WHERE user_id = u.id AND expires_at IS NOT NULL AND expires_at >= CURRENT_DATE)
              )::int) AS days_to_renewal,
            (SELECT su.email FROM revenue_guardian_assignments a JOIN users su ON su.id = a.staff_user_id
              WHERE a.customer_id = u.id AND a.ended_at IS NULL
              ORDER BY a.is_primary DESC, a.assigned_at DESC LIMIT 1) AS assigned_staff_email,
            (SELECT count(*)::int FROM revenue_guardian_recovery_cases rc
              WHERE rc.customer_id = u.id AND rc.closed_at IS NULL) AS open_case_count,
            (SELECT min(rc.next_follow_up_at)::text FROM revenue_guardian_recovery_cases rc
              WHERE rc.customer_id = u.id AND rc.closed_at IS NULL) AS next_follow_up_at,
            (SELECT max(rc.last_contact_at)::text FROM revenue_guardian_recovery_cases rc
              WHERE rc.customer_id = u.id) AS last_contact_at,
            (COALESCE((SELECT min(o.created_at) FROM orders o WHERE o.user_id = u.id), now()) > now() - interval '30 days') AS is_new_customer
       FROM users u
       JOIN LATERAL (
         SELECT i.currency,
                COALESCE(sum(i.total_amount), 0)::text AS outstanding,
                COALESCE(sum(i.total_amount) FILTER (WHERE i.due_date < CURRENT_DATE), 0)::text AS overdue,
                count(*) FILTER (WHERE i.due_date < CURRENT_DATE) AS overdue_invoice_count,
                COALESCE(max(CURRENT_DATE - i.due_date) FILTER (WHERE i.due_date < CURRENT_DATE), 0) AS max_overdue_days
           FROM invoices i
          WHERE i.user_id = u.id AND i.status = 'unpaid'
          GROUP BY i.currency
          ORDER BY sum(i.total_amount) DESC
          LIMIT 1
       ) base ON true
      WHERE u.role = 'customer' ${scope}
      ORDER BY base.max_overdue_days DESC, base.overdue DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Renewals / expiring services (spec §12, §15)
// ---------------------------------------------------------------------------------------------

export interface RenewalRow {
  kind: 'subscription' | 'domain';
  reference_id: string;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  label: string;
  expires_at: string;
  days_remaining: number;
  renewal_amount: string | null;
  currency: string | null;
  status: string;
  assigned_staff_email: string | null;
  open_case_count: number;
}

export async function listUpcomingRenewals(
  db: Queryable,
  options: { withinDays?: number; includePast?: boolean; scopeStaffId?: string | null; limit?: number } = {}
): Promise<RenewalRow[]> {
  const withinDays = Math.min(365, options.withinDays ?? 60);
  const params: unknown[] = [withinDays];
  let scopeSub = '';
  let scopeDom = '';
  if (options.scopeStaffId) {
    params.push(options.scopeStaffId);
    scopeSub = `AND ${staffScopeClause('s.customer_id', null, 2)}`;
    scopeDom = `AND ${staffScopeClause('d.user_id', null, 2)}`;
  }
  params.push(Math.min(500, options.limit ?? 200));
  const pastBound = options.includePast ? `- interval '30 days'` : '';
  const { rows } = await db.query<RenewalRow>(
    `SELECT * FROM (
       SELECT 'subscription'::text AS kind, s.id AS reference_id, s.customer_id,
              u.email AS customer_email, u.full_name AS customer_name,
              COALESCE(p.name || ' — ' || pl.name, pl.name, 'Subscription') AS label,
              s.current_period_end::text AS expires_at,
              (s.current_period_end::date - CURRENT_DATE)::int AS days_remaining,
              (SELECT pp.amount::text FROM plan_pricing pp
                WHERE pp.plan_id = s.plan_id ORDER BY (pp.billing_period = 'monthly') DESC LIMIT 1) AS renewal_amount,
              (SELECT pp.currency FROM plan_pricing pp
                WHERE pp.plan_id = s.plan_id ORDER BY (pp.billing_period = 'monthly') DESC LIMIT 1) AS currency,
              s.status,
              (SELECT su.email FROM revenue_guardian_assignments a JOIN users su ON su.id = a.staff_user_id
                WHERE a.customer_id = s.customer_id AND a.ended_at IS NULL
                ORDER BY a.is_primary DESC LIMIT 1) AS assigned_staff_email,
              (SELECT count(*)::int FROM revenue_guardian_recovery_cases rc
                WHERE rc.customer_id = s.customer_id AND rc.closed_at IS NULL) AS open_case_count
         FROM subscriptions s
         JOIN users u ON u.id = s.customer_id
         JOIN product_plans pl ON pl.id = s.plan_id
         LEFT JOIN products p ON p.id = pl.product_id
        WHERE s.status IN ('active','trialing','past_due','grace_period')
          AND s.current_period_end <= now() + ($1 || ' days')::interval
          AND s.current_period_end >= now() ${pastBound} ${scopeSub}
       UNION ALL
       SELECT 'domain'::text, d.id, d.user_id,
              u.email, u.full_name,
              d.domain_name,
              d.expires_at::text,
              (d.expires_at - CURRENT_DATE)::int,
              NULL, NULL, d.status,
              (SELECT su.email FROM revenue_guardian_assignments a JOIN users su ON su.id = a.staff_user_id
                WHERE a.customer_id = d.user_id AND a.ended_at IS NULL
                ORDER BY a.is_primary DESC LIMIT 1),
              (SELECT count(*)::int FROM revenue_guardian_recovery_cases rc
                WHERE rc.customer_id = d.user_id AND rc.closed_at IS NULL)
         FROM customer_domains d
         JOIN users u ON u.id = d.user_id
        WHERE d.expires_at IS NOT NULL
          AND d.expires_at <= CURRENT_DATE + ($1)::int
          AND d.expires_at >= CURRENT_DATE ${options.includePast ? '- 30' : ''} ${scopeDom}
     ) renewals
     ORDER BY days_remaining ASC
     LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Pre-suspension / pre-termination (spec §13–§14)
// ---------------------------------------------------------------------------------------------

export interface LifecycleRiskRow {
  subscription_id: string;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  plan_label: string;
  status: string;
  past_due_since: string | null;
  suspended_at: string | null;
  projected_date: string | null;
  days_remaining: number | null;
  outstanding: string;
  currency: string;
  assigned_staff_email: string | null;
  open_case_count: number;
  last_contact_at: string | null;
  next_follow_up_at: string | null;
}

/**
 * Subscriptions approaching suspension (past_due/grace_period) or termination (suspended),
 * with projected dates computed from the REAL dunning configuration (subscription.grace/
 * suspend settings + revenue_guardian.terminate_after_suspension_days).
 */
export async function listLifecycleRisk(
  db: Queryable,
  phase: 'pre_suspension' | 'pre_termination',
  config: { graceDays: number; suspendAfterDays: number; terminateAfterDays: number },
  scopeStaffId: string | null = null,
  limit = 200
): Promise<LifecycleRiskRow[]> {
  const params: unknown[] = [];
  let scope = '';
  if (scopeStaffId) {
    params.push(scopeStaffId);
    scope = `AND ${staffScopeClause('s.customer_id', null, 1)}`;
  }
  const statusFilter = phase === 'pre_suspension' ? `s.status IN ('past_due','grace_period')` : `s.status = 'suspended'`;
  const projected =
    phase === 'pre_suspension'
      ? `(COALESCE(s.past_due_since, s.current_period_end) + ($${params.length + 1} || ' days')::interval)`
      : `(COALESCE(s.suspended_at, now()) + ($${params.length + 1} || ' days')::interval)`;
  params.push(phase === 'pre_suspension' ? String(config.graceDays + config.suspendAfterDays) : String(config.terminateAfterDays));
  params.push(Math.min(500, limit));

  const { rows } = await db.query<LifecycleRiskRow>(
    `SELECT s.id AS subscription_id, s.customer_id, u.email AS customer_email, u.full_name AS customer_name,
            COALESCE(p.name || ' — ' || pl.name, pl.name, 'Subscription') AS plan_label,
            s.status, s.past_due_since::text, s.suspended_at::text,
            ${projected}::text AS projected_date,
            (${projected}::date - CURRENT_DATE)::int AS days_remaining,
            (SELECT COALESCE(sum(i.total_amount), 0)::text FROM invoices i
              WHERE i.user_id = s.customer_id AND i.status = 'unpaid') AS outstanding,
            (SELECT COALESCE((SELECT i2.currency FROM invoices i2 WHERE i2.user_id = s.customer_id
              GROUP BY i2.currency ORDER BY count(*) DESC LIMIT 1), 'USD')) AS currency,
            (SELECT su.email FROM revenue_guardian_assignments a JOIN users su ON su.id = a.staff_user_id
              WHERE a.customer_id = s.customer_id AND a.ended_at IS NULL
              ORDER BY a.is_primary DESC LIMIT 1) AS assigned_staff_email,
            (SELECT count(*)::int FROM revenue_guardian_recovery_cases rc
              WHERE rc.customer_id = s.customer_id AND rc.closed_at IS NULL) AS open_case_count,
            (SELECT max(rc.last_contact_at)::text FROM revenue_guardian_recovery_cases rc
              WHERE rc.customer_id = s.customer_id) AS last_contact_at,
            (SELECT min(rc.next_follow_up_at)::text FROM revenue_guardian_recovery_cases rc
              WHERE rc.customer_id = s.customer_id AND rc.closed_at IS NULL) AS next_follow_up_at
       FROM subscriptions s
       JOIN users u ON u.id = s.customer_id
       JOIN product_plans pl ON pl.id = s.plan_id
       LEFT JOIN products p ON p.id = pl.product_id
      WHERE ${statusFilter} ${scope}
      ORDER BY days_remaining ASC NULLS LAST
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Orders view (spec §11)
// ---------------------------------------------------------------------------------------------

export interface OrderCollectionRow {
  order_id: string;
  order_number: string;
  customer_id: string;
  customer_email: string;
  customer_name: string;
  created_at: string;
  currency: string;
  total_amount: string;
  status: string;
  payment_status: string;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_status: string | null;
  products: string | null;
  is_new_customer: boolean;
  assigned_staff_email: string | null;
  open_case_count: number;
  pending_follow_ups: number;
}

export async function listOrderCollections(
  db: Queryable,
  filters: {
    page?: number;
    limit?: number;
    paymentStatus?: string;
    orderStatus?: string;
    customerType?: 'new' | 'existing';
    scopeStaffId?: string | null;
    dateFrom?: string;
    dateTo?: string;
    search?: string;
  }
): Promise<{ items: OrderCollectionRow[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (filters.paymentStatus) where.push(`o.payment_status = $${push(filters.paymentStatus)}`);
  if (filters.orderStatus) where.push(`o.status = $${push(filters.orderStatus)}`);
  if (filters.dateFrom) where.push(`o.created_at >= $${push(filters.dateFrom)}`);
  if (filters.dateTo) where.push(`o.created_at <= $${push(filters.dateTo)}`);
  if (filters.search) {
    const idx = push(`%${filters.search}%`);
    where.push(`(u.email ILIKE $${idx} OR u.full_name ILIKE $${idx} OR o.order_number ILIKE $${idx})`);
  }
  if (filters.customerType === 'new') {
    where.push(`o.created_at = (SELECT min(o2.created_at) FROM orders o2 WHERE o2.user_id = o.user_id)`);
  } else if (filters.customerType === 'existing') {
    where.push(`o.created_at > (SELECT min(o2.created_at) FROM orders o2 WHERE o2.user_id = o.user_id)`);
  }
  if (filters.scopeStaffId) {
    where.push(staffScopeClause('o.user_id', null, push(filters.scopeStaffId)));
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM orders o JOIN users u ON u.id = o.user_id ${whereSql}`,
    params
  );
  const { rows } = await db.query<OrderCollectionRow>(
    `SELECT o.id AS order_id, o.order_number, o.user_id AS customer_id,
            u.email AS customer_email, u.full_name AS customer_name,
            o.created_at::text, o.currency, o.total_amount::text, o.status, o.payment_status,
            i.id AS invoice_id, i.invoice_number, i.status AS invoice_status,
            (SELECT string_agg(oi.product_name_snapshot || ' (' || oi.plan_name_snapshot || ')', ', ')
              FROM order_items oi WHERE oi.order_id = o.id) AS products,
            (o.created_at = (SELECT min(o2.created_at) FROM orders o2 WHERE o2.user_id = o.user_id)) AS is_new_customer,
            (SELECT su.email FROM revenue_guardian_assignments a JOIN users su ON su.id = a.staff_user_id
              WHERE a.customer_id = o.user_id AND a.ended_at IS NULL ORDER BY a.is_primary DESC LIMIT 1) AS assigned_staff_email,
            (SELECT count(*)::int FROM revenue_guardian_recovery_cases rc
              WHERE rc.customer_id = o.user_id AND rc.closed_at IS NULL) AS open_case_count,
            (SELECT count(*)::int FROM revenue_guardian_follow_ups f
              WHERE f.customer_id = o.user_id AND f.status IN ('pending','snoozed')) AS pending_follow_ups
       FROM orders o
       JOIN users u ON u.id = o.user_id
       LEFT JOIN invoices i ON i.order_id = o.id
      ${whereSql}
      ORDER BY o.created_at DESC
      LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}

// ---------------------------------------------------------------------------------------------
// Aging / risk analysis (spec §30)
// ---------------------------------------------------------------------------------------------

export interface AgingBucketRow {
  currency: string;
  bucket: string;
  invoice_count: number;
  amount: string;
}

export async function getAgingBuckets(db: Queryable, boundaries: number[], scopeStaffId: string | null): Promise<AgingBucketRow[]> {
  const sorted = [...boundaries].sort((a, b) => a - b);
  const cases: string[] = [`WHEN i.due_date >= CURRENT_DATE THEN 'current'`];
  let lower = 1;
  for (const bound of sorted) {
    cases.push(`WHEN (CURRENT_DATE - i.due_date) BETWEEN ${lower} AND ${bound} THEN '${lower}-${bound}'`);
    lower = bound + 1;
  }
  cases.push(`ELSE '${lower - 1}+'`);
  const params: unknown[] = [];
  let scope = '';
  if (scopeStaffId) {
    params.push(scopeStaffId);
    scope = `AND ${staffScopeClause('i.user_id', null, 1)}`;
  }
  const { rows } = await db.query<AgingBucketRow>(
    `SELECT i.currency,
            CASE ${cases.join(' ')} END AS bucket,
            count(*)::int AS invoice_count,
            sum(i.total_amount)::text AS amount
       FROM invoices i
      WHERE i.status = 'unpaid' ${scope}
      GROUP BY i.currency, bucket
      ORDER BY i.currency, bucket`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Forecast (spec §31) — every series labeled ACTUAL or PROJECTED, never mixed.
// ---------------------------------------------------------------------------------------------

export interface ForecastData {
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
    /** Projection derived from the historical recovery rate applied to open-case outstanding. */
    expectedRecovery: CurrencyAmount[];
    historicalRecoveryRate: number | null;
  };
}

export async function getForecast(db: Queryable, scopeStaffId: string | null): Promise<ForecastData> {
  const params: unknown[] = scopeStaffId ? [scopeStaffId] : [];
  const ledgerScope = scopeStaffId ? `AND ${staffScopeClause('l.user_id', null, 1)}` : '';
  const invoiceScope = scopeStaffId ? `AND ${staffScopeClause('i.user_id', null, 1)}` : '';
  const subScope = scopeStaffId ? `AND ${staffScopeClause('s.customer_id', null, 1)}` : '';
  const caseScope = scopeStaffId ? `AND ${staffScopeClause('c.customer_id', 'c.assigned_staff_id', 1)}` : '';

  const collected = (interval: string) =>
    perCurrency(
      db,
      `SELECT l.currency, sum(l.amount)::text AS amount FROM billing_ledger l
        WHERE l.entry_type = 'payment' AND l.created_at > now() - interval '${interval}' ${ledgerScope}
        GROUP BY l.currency`,
      params
    );
  const renewals = (days: number) =>
    perCurrency(
      db,
      `SELECT pp.currency, sum(pp.amount)::text AS amount
         FROM subscriptions s
         JOIN plan_pricing pp ON pp.plan_id = s.plan_id AND pp.billing_period = 'monthly'
        WHERE s.status IN ('active','trialing') AND s.current_period_end BETWEEN now() AND now() + interval '${days} days'
        ${subScope}
        GROUP BY pp.currency`,
      params
    );

  const outstanding = await perCurrency(
    db,
    `SELECT i.currency, sum(i.total_amount)::text AS amount FROM invoices i
      WHERE i.status = 'unpaid' ${invoiceScope} GROUP BY i.currency`,
    params
  );
  const overdue = await perCurrency(
    db,
    `SELECT i.currency, sum(i.total_amount)::text AS amount FROM invoices i
      WHERE i.status = 'unpaid' AND i.due_date < CURRENT_DATE ${invoiceScope} GROUP BY i.currency`,
    params
  );
  const atRisk = await perCurrency(
    db,
    `SELECT c.currency, sum(c.amount_outstanding)::text AS amount FROM revenue_guardian_recovery_cases c
      WHERE c.closed_at IS NULL ${caseScope} GROUP BY c.currency`,
    params
  );

  const rateResult = await db.query<{ recovered: string; closed: string }>(
    `SELECT count(*) FILTER (WHERE c.status = 'recovered')::text AS recovered,
            count(*) FILTER (WHERE c.closed_at IS NOT NULL)::text AS closed
       FROM revenue_guardian_recovery_cases c WHERE 1=1 ${caseScope}`,
    params
  );
  const recoveredN = Number(rateResult.rows[0]?.recovered ?? 0);
  const closedN = Number(rateResult.rows[0]?.closed ?? 0);
  const rate = closedN > 0 ? recoveredN / closedN : null;

  const expectedRecovery =
    rate === null
      ? []
      : atRisk.map((a) => ({ currency: a.currency, amount: (Number(a.amount) * rate).toFixed(2) }));

  return {
    actual: {
      collectedLast30d: await collected('30 days'),
      collectedLast90d: await collected('90 days'),
      outstanding,
      overdue,
    },
    projected: {
      renewalsNext30d: await renewals(30),
      renewalsNext90d: await renewals(90),
      atRisk,
      expectedRecovery,
      historicalRecoveryRate: rate === null ? null : Math.round(rate * 1000) / 10,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// High-value customers (spec §32)
// ---------------------------------------------------------------------------------------------

export interface HighValueCustomerRow {
  customer_id: string;
  customer_email: string;
  customer_name: string;
  currency: string;
  lifetime_revenue: string;
  recurring_revenue: string;
  active_services: number;
  outstanding: string;
  open_case_count: number;
  assigned_staff_email: string | null;
  next_renewal: string | null;
}

export async function listHighValueCustomers(
  db: Queryable,
  thresholds: { lifetimeRevenue: number; recurringRevenue: number; activeServices: number },
  scopeStaffId: string | null,
  limit = 200
): Promise<HighValueCustomerRow[]> {
  const params: unknown[] = [
    thresholds.lifetimeRevenue.toFixed(2),
    thresholds.recurringRevenue.toFixed(2),
    thresholds.activeServices,
  ];
  let scope = '';
  if (scopeStaffId) {
    params.push(scopeStaffId);
    scope = `AND ${staffScopeClause('u.id', null, 4)}`;
  }
  params.push(Math.min(500, limit));
  const { rows } = await db.query<HighValueCustomerRow>(
    `SELECT u.id AS customer_id, u.email AS customer_email, u.full_name AS customer_name,
            COALESCE((SELECT i.currency FROM invoices i WHERE i.user_id = u.id
              GROUP BY i.currency ORDER BY count(*) DESC LIMIT 1), 'USD') AS currency,
            metrics.lifetime_revenue, metrics.recurring_revenue, metrics.active_services,
            (SELECT COALESCE(sum(i.total_amount), 0)::text FROM invoices i
              WHERE i.user_id = u.id AND i.status = 'unpaid') AS outstanding,
            (SELECT count(*)::int FROM revenue_guardian_recovery_cases rc
              WHERE rc.customer_id = u.id AND rc.closed_at IS NULL) AS open_case_count,
            (SELECT su.email FROM revenue_guardian_assignments a JOIN users su ON su.id = a.staff_user_id
              WHERE a.customer_id = u.id AND a.ended_at IS NULL ORDER BY a.is_primary DESC LIMIT 1) AS assigned_staff_email,
            (SELECT min(s.current_period_end)::text FROM subscriptions s
              WHERE s.customer_id = u.id AND s.status IN ('active','trialing') AND s.current_period_end >= now()) AS next_renewal
       FROM users u
       JOIN LATERAL (
         SELECT
           (SELECT COALESCE(sum(l.amount), 0) FROM billing_ledger l
             WHERE l.user_id = u.id AND l.entry_type = 'payment')::text AS lifetime_revenue,
           (SELECT COALESCE(sum(pp.amount), 0) FROM subscriptions sub
             JOIN plan_pricing pp ON pp.plan_id = sub.plan_id AND pp.billing_period = 'monthly'
            WHERE sub.customer_id = u.id AND sub.status IN ('active','trialing','past_due','grace_period'))::text AS recurring_revenue,
           (SELECT count(*)::int FROM customer_services cs WHERE cs.user_id = u.id AND cs.status = 'active') AS active_services
       ) metrics ON true
      WHERE u.role = 'customer'
        AND (metrics.lifetime_revenue::numeric >= $1::numeric
             OR metrics.recurring_revenue::numeric >= $2::numeric
             OR metrics.active_services >= $3)
        ${scope}
      ORDER BY metrics.lifetime_revenue::numeric DESC
      LIMIT $${params.length}`,
    params
  );
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Staff performance (spec §24)
// ---------------------------------------------------------------------------------------------

export interface StaffPerformanceRow {
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
  /** Per-currency map (currency → amount) — never summed across currencies (spec §47). */
  revenue_recovered: Record<string, string>;
}

export async function getStaffPerformance(
  db: Queryable,
  filters: { dateFrom?: string; dateTo?: string; staffUserId?: string }
): Promise<StaffPerformanceRow[]> {
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  const from = filters.dateFrom ? `$${push(filters.dateFrom)}::timestamptz` : `'-infinity'::timestamptz`;
  const to = filters.dateTo ? `$${push(filters.dateTo)}::timestamptz` : `'infinity'::timestamptz`;
  let staffFilter = '';
  if (filters.staffUserId) staffFilter = `AND st.id = $${push(filters.staffUserId)}`;

  const { rows } = await db.query<StaffPerformanceRow>(
    `SELECT st.id AS staff_user_id, st.email AS staff_email, st.full_name AS staff_name,
            (SELECT count(DISTINCT a.customer_id)::int FROM revenue_guardian_assignments a
              WHERE a.staff_user_id = st.id AND a.ended_at IS NULL) AS assigned_customers,
            (SELECT count(*)::int FROM revenue_guardian_recovery_cases c
              WHERE c.assigned_staff_id = st.id AND c.closed_at IS NULL) AS open_cases,
            (SELECT count(*)::int FROM revenue_guardian_recovery_cases c
              WHERE c.assigned_staff_id = st.id AND c.status = 'recovered'
                AND c.closed_at BETWEEN ${from} AND ${to}) AS recovered_cases,
            (SELECT count(*)::int FROM revenue_guardian_recovery_cases c
              WHERE c.assigned_staff_id = st.id AND c.closed_at BETWEEN ${from} AND ${to}) AS closed_cases,
            (SELECT count(*)::int FROM revenue_guardian_follow_ups f
              WHERE f.assigned_staff_id = st.id AND f.status = 'completed'
                AND f.completed_at BETWEEN ${from} AND ${to}) AS followups_completed,
            (SELECT count(*)::int FROM revenue_guardian_follow_ups f
              WHERE f.assigned_staff_id = st.id AND f.status IN ('pending','snoozed')
                AND COALESCE(f.snoozed_until, f.scheduled_at) < now()) AS followups_overdue,
            (SELECT count(*)::int FROM revenue_guardian_payment_promises p
              WHERE p.assigned_staff_id = st.id AND p.created_at BETWEEN ${from} AND ${to}) AS promises_total,
            (SELECT count(*)::int FROM revenue_guardian_payment_promises p
              WHERE p.assigned_staff_id = st.id AND p.status IN ('fulfilled','partially_fulfilled')
                AND p.created_at BETWEEN ${from} AND ${to}) AS promises_fulfilled,
            (SELECT count(*)::int FROM revenue_guardian_payment_promises p
              WHERE p.assigned_staff_id = st.id AND p.status = 'broken'
                AND p.created_at BETWEEN ${from} AND ${to}) AS promises_broken,
            (SELECT COALESCE(jsonb_object_agg(x.cur, x.amt), '{}'::jsonb) FROM (
               SELECT l.currency AS cur, sum(l.amount)::text AS amt
                 FROM billing_ledger l
                 JOIN revenue_guardian_recovery_cases c ON c.invoice_id = l.invoice_id
                  AND l.created_at >= c.opened_at AND (c.closed_at IS NULL OR l.created_at <= c.closed_at)
                WHERE c.assigned_staff_id = st.id AND l.entry_type = 'payment'
                  AND l.created_at BETWEEN ${from} AND ${to}
                GROUP BY l.currency) x) AS revenue_recovered
       FROM users st
      WHERE st.role IN ('staff', 'admin', 'super_admin') AND st.status = 'active' ${staffFilter}
      ORDER BY st.full_name ASC`,
    params
  );
  return rows;
}
