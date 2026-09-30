/**
 * Read-only financial facts computed from the EXISTING billing tables (invoices, billing_ledger,
 * payments, orders, subscriptions, plan pricing). This module never writes billing data — the
 * ledger remains the single source of financial truth (spec §1, §52, §78).
 *
 * All amounts are returned as integer cents (via src/lib/money.ts) so downstream arithmetic is
 * exact, and every helper works per-currency — amounts in different currencies are never summed
 * together (spec §47).
 */
import type { Queryable } from '../../db/types';
import { toCents } from '../../lib/money';

export interface InvoiceFinancials {
  invoiceId: string;
  currency: string;
  totalCents: number;
  paidCents: number;
  refundedCents: number;
  /** total - (paid - refunded), clamped at 0. */
  outstandingCents: number;
}

/** Ledger-derived money position of one invoice (identical math to billing-service refunds). */
export async function getInvoiceFinancials(db: Queryable, invoiceId: string): Promise<InvoiceFinancials | null> {
  const { rows } = await db.query<{
    id: string;
    currency: string;
    total_amount: string;
    paid: string | null;
    refunded: string | null;
  }>(
    `SELECT i.id, i.currency, i.total_amount,
            (SELECT COALESCE(sum(l.amount), 0)::text FROM billing_ledger l
              WHERE l.invoice_id = i.id AND l.entry_type = 'payment') AS paid,
            (SELECT COALESCE(sum(l.amount), 0)::text FROM billing_ledger l
              WHERE l.invoice_id = i.id AND l.entry_type = 'refund') AS refunded
       FROM invoices i WHERE i.id = $1`,
    [invoiceId]
  );
  const row = rows[0];
  if (!row) return null;
  const totalCents = toCents(row.total_amount);
  const paidCents = toCents(row.paid ?? '0');
  const refundedCents = toCents(row.refunded ?? '0');
  return {
    invoiceId: row.id,
    currency: row.currency,
    totalCents,
    paidCents,
    refundedCents,
    outstandingCents: Math.max(0, totalCents - Math.max(0, paidCents - refundedCents)),
  };
}

/** Sum of 'payment' ledger entries for an invoice recorded at/after a moment — promise proof. */
export async function getPaymentsSince(db: Queryable, invoiceId: string, since: Date): Promise<number> {
  const { rows } = await db.query<{ paid: string | null }>(
    `SELECT COALESCE(sum(amount), 0)::text AS paid FROM billing_ledger
      WHERE invoice_id = $1 AND entry_type = 'payment' AND created_at >= $2`,
    [invoiceId, since]
  );
  return toCents(rows[0]?.paid ?? '0');
}

export interface CustomerFinancialProfile {
  currency: string;
  totalBilledCents: number;
  totalPaidCents: number;
  totalRefundedCents: number;
  outstandingCents: number;
  overdueCents: number;
  overdueInvoiceCount: number;
  maxOverdueDays: number;
  failedPaymentCount: number;
  recurringRevenueCents: number;
  activeServiceCount: number;
  daysToNextRenewal: number | null;
  hasPastDueSubscription: boolean;
  hasSuspendedSubscription: boolean;
  brokenPromiseCount: number;
  isNewCustomer: boolean;
  accountStatus: string;
}

/**
 * One customer's complete financial + lifecycle profile, per currency-major values. Currencies
 * beyond the customer's dominant invoice currency are reported separately by callers that need
 * them; the risk inputs below use the per-currency dominant set to avoid mixing currencies.
 */
export async function getCustomerFinancialProfile(db: Queryable, customerId: string): Promise<CustomerFinancialProfile> {
  const { rows } = await db.query<{
    currency: string | null;
    total_billed: string | null;
    total_paid: string | null;
    total_refunded: string | null;
    outstanding: string | null;
    overdue: string | null;
    overdue_count: string | null;
    max_overdue_days: number | null;
    failed_payments: string | null;
    recurring_revenue: string | null;
    active_services: string | null;
    days_to_renewal: number | null;
    past_due_subs: string | null;
    suspended_subs: string | null;
    broken_promises: string | null;
    first_order_days: number | null;
    account_status: string | null;
  }>(
    `SELECT
       (SELECT i.currency FROM invoices i WHERE i.user_id = $1
         GROUP BY i.currency ORDER BY count(*) DESC LIMIT 1) AS currency,
       (SELECT COALESCE(sum(total_amount), 0)::text FROM invoices
         WHERE user_id = $1 AND status <> 'void') AS total_billed,
       (SELECT COALESCE(sum(amount), 0)::text FROM billing_ledger
         WHERE user_id = $1 AND entry_type = 'payment') AS total_paid,
       (SELECT COALESCE(sum(amount), 0)::text FROM billing_ledger
         WHERE user_id = $1 AND entry_type = 'refund') AS total_refunded,
       (SELECT COALESCE(sum(total_amount), 0)::text FROM invoices
         WHERE user_id = $1 AND status = 'unpaid') AS outstanding,
       (SELECT COALESCE(sum(total_amount), 0)::text FROM invoices
         WHERE user_id = $1 AND status = 'unpaid' AND due_date < CURRENT_DATE) AS overdue,
       (SELECT count(*)::text FROM invoices
         WHERE user_id = $1 AND status = 'unpaid' AND due_date < CURRENT_DATE) AS overdue_count,
       (SELECT COALESCE(max(CURRENT_DATE - due_date), 0)::int FROM invoices
         WHERE user_id = $1 AND status = 'unpaid' AND due_date < CURRENT_DATE) AS max_overdue_days,
       (SELECT count(*)::text FROM payments
         WHERE user_id = $1 AND status = 'failed'
           AND created_at > now() - interval '180 days') AS failed_payments,
       (SELECT COALESCE(sum(pp.amount), 0)::text
          FROM subscriptions sub
          JOIN plan_pricing pp ON pp.plan_id = sub.plan_id AND pp.billing_period = 'monthly'
         WHERE sub.customer_id = $1
           AND sub.status IN ('active', 'trialing', 'past_due', 'grace_period')) AS recurring_revenue,
       (SELECT count(*)::text FROM customer_services
         WHERE user_id = $1 AND status = 'active') AS active_services,
       (SELECT LEAST(
           (SELECT min(current_period_end)::date - CURRENT_DATE FROM subscriptions
             WHERE customer_id = $1 AND status IN ('active', 'trialing') AND current_period_end >= now()),
           (SELECT min(expires_at) - CURRENT_DATE FROM customer_domains
             WHERE user_id = $1 AND expires_at IS NOT NULL AND expires_at >= CURRENT_DATE)
         )::int) AS days_to_renewal,
       (SELECT count(*)::text FROM subscriptions
         WHERE customer_id = $1 AND status IN ('past_due', 'grace_period')) AS past_due_subs,
       (SELECT count(*)::text FROM subscriptions
         WHERE customer_id = $1 AND status = 'suspended') AS suspended_subs,
       (SELECT count(*)::text FROM revenue_guardian_payment_promises
         WHERE customer_id = $1 AND status = 'broken') AS broken_promises,
       (SELECT (CURRENT_DATE - min(created_at)::date)::int FROM orders WHERE user_id = $1) AS first_order_days,
       (SELECT status FROM users WHERE id = $1) AS account_status`,
    [customerId]
  );
  const row = rows[0];
  return {
    currency: row?.currency ?? 'USD',
    totalBilledCents: toCents(row?.total_billed ?? '0'),
    totalPaidCents: toCents(row?.total_paid ?? '0'),
    totalRefundedCents: toCents(row?.total_refunded ?? '0'),
    outstandingCents: toCents(row?.outstanding ?? '0'),
    overdueCents: toCents(row?.overdue ?? '0'),
    overdueInvoiceCount: Number(row?.overdue_count ?? 0),
    maxOverdueDays: Number(row?.max_overdue_days ?? 0),
    failedPaymentCount: Number(row?.failed_payments ?? 0),
    recurringRevenueCents: toCents(row?.recurring_revenue ?? '0'),
    activeServiceCount: Number(row?.active_services ?? 0),
    daysToNextRenewal: row?.days_to_renewal ?? null,
    hasPastDueSubscription: Number(row?.past_due_subs ?? 0) > 0,
    hasSuspendedSubscription: Number(row?.suspended_subs ?? 0) > 0,
    brokenPromiseCount: Number(row?.broken_promises ?? 0),
    // "New customer" = first order within the last 30 days (or no orders at all yet).
    isNewCustomer: row?.first_order_days === null || row?.first_order_days === undefined || row.first_order_days <= 30,
    accountStatus: row?.account_status ?? 'active',
  };
}

export interface OverdueInvoiceRow {
  id: string;
  invoice_number: string;
  user_id: string;
  customer_email: string;
  customer_name: string;
  currency: string;
  total_amount: string;
  due_date: string;
  days_overdue: number;
  order_id: string;
}

/** Unpaid invoices at least `minDays` past due — feed for the overdue automation job. */
export async function listOverdueInvoices(db: Queryable, minDays: number, limit = 500): Promise<OverdueInvoiceRow[]> {
  const { rows } = await db.query<OverdueInvoiceRow>(
    `SELECT i.id, i.invoice_number, i.user_id, u.email AS customer_email, u.full_name AS customer_name,
            i.currency, i.total_amount, i.due_date::text, (CURRENT_DATE - i.due_date)::int AS days_overdue,
            i.order_id
       FROM invoices i
       JOIN users u ON u.id = i.user_id
      WHERE i.status = 'unpaid' AND i.due_date <= CURRENT_DATE - ($1::int)
      ORDER BY i.due_date ASC
      LIMIT $2`,
    [minDays, limit]
  );
  return rows;
}

/** Unpaid invoices due in exactly `daysAhead` days — feed for upcoming-invoice reminders. */
export async function listInvoicesDueIn(db: Queryable, daysAhead: number, limit = 500): Promise<OverdueInvoiceRow[]> {
  const { rows } = await db.query<OverdueInvoiceRow>(
    `SELECT i.id, i.invoice_number, i.user_id, u.email AS customer_email, u.full_name AS customer_name,
            i.currency, i.total_amount, i.due_date::text, 0 AS days_overdue, i.order_id
       FROM invoices i
       JOIN users u ON u.id = i.user_id
      WHERE i.status = 'unpaid' AND i.due_date = CURRENT_DATE + ($1::int)
      ORDER BY i.due_date ASC
      LIMIT $2`,
    [daysAhead, limit]
  );
  return rows;
}
