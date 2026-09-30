/**
 * Customer revenue profile (spec §16) — one consolidated, read-only view over the customer's
 * REAL billing footprint: invoices, ledger payments, services, domains, orders, subscriptions,
 * plus their Revenue Guardian workflow rows. No data is duplicated; everything is queried live
 * from the owning tables.
 */
import type { Queryable } from '../../db/types';
import type { AssignmentWithContext } from './assignments-repo';
import { listActiveAssignmentsForCustomer } from './assignments-repo';

export interface CustomerProfile {
  customer: {
    id: string;
    email: string;
    fullName: string;
    status: string;
    role: string;
    country: string | null;
    customerId: string | null;
    createdAt: string;
    isNewCustomer: boolean;
  };
  financials: Array<{
    currency: string;
    totalBilled: string;
    totalPaid: string;
    totalRefunded: string;
    outstanding: string;
    overdue: string;
  }>;
  recurringRevenue: Array<{ currency: string; amount: string }>;
  assignments: AssignmentWithContext[];
  invoices: Array<Record<string, unknown>>;
  payments: Array<Record<string, unknown>>;
  services: Array<Record<string, unknown>>;
  domains: Array<Record<string, unknown>>;
  orders: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
  cases: Array<Record<string, unknown>>;
  followUps: Array<Record<string, unknown>>;
  promises: Array<Record<string, unknown>>;
}

export async function getCustomerProfile(db: Queryable, customerId: string): Promise<CustomerProfile | null> {
  const userResult = await db.query<{
    id: string;
    email: string;
    full_name: string;
    status: string;
    role: string;
    country: string | null;
    customer_id: string | null;
    created_at: string;
  }>(
    `SELECT id, email, full_name, status, role, country, customer_id, created_at::text
       FROM users WHERE id = $1`,
    [customerId]
  );
  const user = userResult.rows[0];
  if (!user) return null;

  const financials = await db.query<{
    currency: string;
    total_billed: string;
    total_paid: string;
    total_refunded: string;
    outstanding: string;
    overdue: string;
  }>(
    `SELECT i.currency,
            COALESCE(sum(i.total_amount) FILTER (WHERE i.status <> 'void'), 0)::text AS total_billed,
            COALESCE((SELECT sum(l.amount) FROM billing_ledger l
              WHERE l.user_id = $1 AND l.entry_type = 'payment' AND l.currency = i.currency), 0)::text AS total_paid,
            COALESCE((SELECT sum(l.amount) FROM billing_ledger l
              WHERE l.user_id = $1 AND l.entry_type = 'refund' AND l.currency = i.currency), 0)::text AS total_refunded,
            COALESCE(sum(i.total_amount) FILTER (WHERE i.status = 'unpaid'), 0)::text AS outstanding,
            COALESCE(sum(i.total_amount) FILTER (WHERE i.status = 'unpaid' AND i.due_date < CURRENT_DATE), 0)::text AS overdue
       FROM invoices i WHERE i.user_id = $1 GROUP BY i.currency`,
    [customerId]
  );

  const recurring = await db.query<{ currency: string; amount: string }>(
    `SELECT pp.currency, sum(pp.amount)::text AS amount
       FROM subscriptions s
       JOIN plan_pricing pp ON pp.plan_id = s.plan_id AND pp.billing_period = 'monthly'
      WHERE s.customer_id = $1 AND s.status IN ('active','trialing','past_due','grace_period')
      GROUP BY pp.currency`,
    [customerId]
  );

  const firstOrder = await db.query<{ first: string | null }>(
    `SELECT min(created_at)::text AS first FROM orders WHERE user_id = $1`,
    [customerId]
  );
  const firstOrderAt = firstOrder.rows[0]?.first ?? null;
  const isNewCustomer = !firstOrderAt || Date.now() - new Date(firstOrderAt).getTime() < 30 * 86_400_000;

  const [invoices, payments, services, domains, orders, subscriptions, cases, followUps, promises] = await Promise.all([
    db.query(
      `SELECT id, invoice_number, currency, total_amount::text, status, due_date::text, issued_at::text,
              (status = 'unpaid' AND due_date < CURRENT_DATE) AS is_overdue,
              GREATEST((CURRENT_DATE - due_date), 0)::int AS days_overdue
         FROM invoices WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 100`,
      [customerId]
    ),
    db.query(
      `SELECT p.id, p.amount::text, p.currency, p.status, p.provider, p.method, p.failure_reason,
              p.initiated_at::text, p.completed_at::text, i.invoice_number
         FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
        WHERE p.user_id = $1 ORDER BY p.initiated_at DESC LIMIT 100`,
      [customerId]
    ),
    db.query(
      `SELECT id, label, status, external_reference, created_at::text
         FROM customer_services WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [customerId]
    ),
    db.query(
      `SELECT id, domain_name, registrar, status, expires_at::text,
              CASE WHEN expires_at IS NOT NULL THEN (expires_at - CURRENT_DATE)::int END AS days_to_expiry
         FROM customer_domains WHERE user_id = $1 ORDER BY expires_at ASC NULLS LAST LIMIT 100`,
      [customerId]
    ),
    db.query(
      `SELECT o.id, o.order_number, o.currency, o.total_amount::text, o.status, o.payment_status, o.created_at::text,
              (SELECT string_agg(oi.product_name_snapshot, ', ') FROM order_items oi WHERE oi.order_id = o.id) AS products
         FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT 100`,
      [customerId]
    ),
    db.query(
      `SELECT s.id, s.status, s.current_period_end::text, s.past_due_since::text, s.suspended_at::text,
              s.cancel_at_period_end, pl.name AS plan_name, p.name AS product_name
         FROM subscriptions s
         JOIN product_plans pl ON pl.id = s.plan_id
         LEFT JOIN products p ON p.id = pl.product_id
        WHERE s.customer_id = $1 ORDER BY s.current_period_end ASC LIMIT 100`,
      [customerId]
    ),
    db.query(
      `SELECT c.id, c.case_number, c.status, c.priority, c.risk_level, c.risk_score, c.risk_reasons,
              c.currency, c.amount_outstanding::text, c.amount_recovered::text, c.opened_at::text,
              c.closed_at::text, c.next_follow_up_at::text, s.email AS assigned_staff_email,
              i.invoice_number
         FROM revenue_guardian_recovery_cases c
         LEFT JOIN users s ON s.id = c.assigned_staff_id
         LEFT JOIN invoices i ON i.id = c.invoice_id
        WHERE c.customer_id = $1 ORDER BY c.opened_at DESC LIMIT 100`,
      [customerId]
    ),
    db.query(
      `SELECT f.id, f.type, f.status, f.priority, f.channel, f.scheduled_at::text, f.completed_at::text,
              f.notes, f.outcome, s.email AS assigned_staff_email
         FROM revenue_guardian_follow_ups f
         LEFT JOIN users s ON s.id = f.assigned_staff_id
        WHERE f.customer_id = $1 ORDER BY f.scheduled_at DESC LIMIT 100`,
      [customerId]
    ),
    db.query(
      `SELECT p.id, p.promised_amount::text, p.currency, p.promised_date::text, p.status,
              p.fulfilled_amount::text, p.fulfilled_at::text, p.broken_at::text, i.invoice_number
         FROM revenue_guardian_payment_promises p
         JOIN invoices i ON i.id = p.invoice_id
        WHERE p.customer_id = $1 ORDER BY p.promised_date DESC LIMIT 100`,
      [customerId]
    ),
  ]);

  return {
    customer: {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      status: user.status,
      role: user.role,
      country: user.country,
      customerId: user.customer_id,
      createdAt: user.created_at,
      isNewCustomer,
    },
    financials: financials.rows.map((r) => ({
      currency: r.currency,
      totalBilled: r.total_billed,
      totalPaid: r.total_paid,
      totalRefunded: r.total_refunded,
      outstanding: r.outstanding,
      overdue: r.overdue,
    })),
    recurringRevenue: recurring.rows,
    assignments: await listActiveAssignmentsForCustomer(db, customerId),
    invoices: invoices.rows,
    payments: payments.rows,
    services: services.rows,
    domains: domains.rows,
    orders: orders.rows,
    subscriptions: subscriptions.rows,
    cases: cases.rows,
    followUps: followUps.rows,
    promises: promises.rows,
  };
}
