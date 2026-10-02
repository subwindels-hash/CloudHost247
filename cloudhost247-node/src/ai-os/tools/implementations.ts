/**
 * Tool implementations — the *only* way agents touch platform data (spec §19, §29).
 *
 * Read tools issue real, parameterized SELECTs against the existing CloudHost247 tables and
 * return exactly what is stored. Write tools either produce non-destructive work products
 * (drafts) or route through the platform's real mutation paths (support tickets, notification
 * outbox, deployment queue, agent registry) — and the destructive ones only ever run behind
 * the approval gate in runtime/executor.ts.
 *
 * If a backing table returns nothing, the tool says so. Nothing here fabricates.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { EvidenceRef } from '../types';
import { searchKnowledge } from '../repositories/memory-knowledge-repo';
import {
  createIncident as repoCreateIncident,
  appendIncidentTimeline,
} from '../repositories/findings-repo';
import { listIncidents } from '../repositories/findings-repo';
import { setAgentEnabled } from '../repositories/registry-repo';
import { insertEvaluation } from '../repositories/audit-repo';
import { createNotification } from '../../services/notification-service';
import { enqueueDeployment } from '../../db/deployments';
import { emitEvent } from '../repositories/events-repo';

export interface ToolContext {
  db: Queryable;
  /** Set inside a customer workspace: every customerUsable tool is forcibly scoped to this user
   *  server-side; any caller-supplied other userId is overridden. */
  customerScopeUserId?: string | null;
  /** Human user on whose behalf the call happens (audits). */
  actorUserId?: string | null;
  /** Deterministic nonce for idempotent writes (tool-call id or approval id). */
  executionId?: string;
  /** Calling agent id for self-referential tools (record_evaluation). */
  agentId?: string | null;
}

export type ToolResult =
  | { ok: true; data: unknown; evidence: EvidenceRef[] }
  | { ok: false; code: string; message: string };

const OK = (data: unknown, evidence: EvidenceRef[] = []): ToolResult => ({ ok: true, data, evidence });
const FAIL = (code: string, message: string): ToolResult => ({ ok: false, code, message });

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Hard customer scoping: inside a customer workspace the caller's userId arg means nothing. */
function resolveScopedUserId(ctx: ToolContext, args: Record<string, unknown>): string | null {
  if (ctx.customerScopeUserId) return ctx.customerScopeUserId;
  return typeof args.userId === 'string' ? args.userId : null;
}

function limitOf(args: Record<string, unknown>, fallback: number, max: number): number {
  return Math.min(Math.max(Number(args.limit ?? fallback) || fallback, 1), max);
}

// ==============================================================================================
// READS — platform / customer
// ==============================================================================================

async function toolGetPlatformOverview(ctx: ToolContext): Promise<ToolResult> {
  const { rows } = await ctx.db.query<Record<string, string>>(
    `SELECT
       (SELECT count(*)::text FROM users WHERE role = 'customer') AS customers,
       (SELECT count(*)::text FROM users WHERE role = 'customer' AND status = 'active') AS active_customers,
       (SELECT count(*)::text FROM support_tickets WHERE status <> 'closed') AS open_tickets,
       (SELECT count(*)::text FROM support_tickets WHERE status = 'open') AS new_tickets,
       (SELECT count(*)::text FROM invoices WHERE status = 'unpaid') AS unpaid_invoices,
       (SELECT count(*)::text FROM invoices WHERE status = 'unpaid' AND due_date < CURRENT_DATE) AS overdue_invoices,
       (SELECT COALESCE(sum(total_amount), 0)::text FROM invoices WHERE status = 'unpaid' AND due_date < CURRENT_DATE) AS overdue_amount_total,
       (SELECT count(*)::text FROM payments WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed_payments_24h,
       (SELECT count(*)::text FROM payments WHERE status = 'successful' AND completed_at > now() - interval '24 hours') AS successful_payments_24h,
       (SELECT count(*)::text FROM servers WHERE status = 'active') AS servers_active,
       (SELECT count(*)::text FROM servers WHERE status IN ('offline','maintenance')) AS servers_degraded,
       (SELECT count(*)::text FROM subscriptions WHERE status = 'active') AS subscriptions_active,
       (SELECT count(*)::text FROM subscriptions WHERE status IN ('past_due','grace_period','suspended')) AS subscriptions_at_risk,
       (SELECT count(*)::text FROM deployments WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed_deployments_24h,
       (SELECT count(*)::text FROM ssl_certificates WHERE expires_at IS NOT NULL AND expires_at < now() + interval '30 days' AND status IN ('ISSUED','PENDING','VALIDATING')) AS ssl_expiring_30d,
       (SELECT count(*)::text FROM customer_domains WHERE expires_at IS NOT NULL AND expires_at < CURRENT_DATE + 30 AND status = 'active') AS domains_expiring_30d`
  );
  const r = rows[0] ?? {};
  return OK(
    {
      asOf: new Date().toISOString(),
      customers: num(r.customers),
      activeCustomers: num(r.active_customers),
      openTickets: num(r.open_tickets),
      newTickets: num(r.new_tickets),
      unpaidInvoices: num(r.unpaid_invoices),
      overdueInvoices: num(r.overdue_invoices),
      overdueAmountTotal: r.overdue_amount_total ?? '0',
      failedPayments24h: num(r.failed_payments_24h),
      successfulPayments24h: num(r.successful_payments_24h),
      serversActive: num(r.servers_active),
      serversDegraded: num(r.servers_degraded),
      subscriptionsActive: num(r.subscriptions_active),
      subscriptionsAtRisk: num(r.subscriptions_at_risk),
      failedDeployments24h: num(r.failed_deployments_24h),
      sslExpiring30d: num(r.ssl_expiring_30d),
      domainsExpiring30d: num(r.domains_expiring_30d),
    },
    [
      { table: 'users', description: 'Customer counts' },
      { table: 'support_tickets', description: 'Support queue counts' },
      { table: 'invoices', description: 'Unpaid/overdue invoice counts and amounts' },
      { table: 'payments', description: '24h payment outcomes' },
      { table: 'servers', description: 'Server estate status counts' },
      { table: 'subscriptions', description: 'Subscription lifecycle counts' },
      { table: 'deployments', description: '24h failed deployments' },
    ]
  );
}

async function toolGetCustomer(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const userId = resolveScopedUserId(ctx, args);
  if (!userId) return FAIL('VALIDATION', 'userId is required');
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT id, email, full_name, role, status, customer_id, created_at FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) return FAIL('NOT_FOUND', 'Customer not found');
  const r = rows[0];
  return OK(
    { id: r.id, email: r.email, fullName: r.full_name, role: r.role, status: r.status, customerNumber: r.customer_id, createdAt: r.created_at },
    [{ table: 'users', id: String(r.id), description: 'Customer account row' }]
  );
}

async function toolGetCustomerProfile(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const userId = resolveScopedUserId(ctx, args);
  if (!userId) return FAIL('VALIDATION', 'userId is required');
  const customer = await toolGetCustomer(ctx, { userId });
  if (!customer.ok) return customer;

  const { rows } = await ctx.db.query<Record<string, string>>(
    `SELECT
       (SELECT count(*)::text FROM customer_services WHERE user_id = $1) AS services_total,
       (SELECT count(*)::text FROM customer_services WHERE user_id = $1 AND status = 'active') AS services_active,
       (SELECT count(*)::text FROM customer_domains WHERE user_id = $1) AS domains_total,
       (SELECT count(*)::text FROM orders WHERE user_id = $1) AS orders_total,
       (SELECT count(*)::text FROM invoices WHERE user_id = $1) AS invoices_total,
       (SELECT count(*)::text FROM invoices WHERE user_id = $1 AND status = 'unpaid') AS invoices_unpaid,
       (SELECT count(*)::text FROM invoices WHERE user_id = $1 AND status = 'unpaid' AND due_date < CURRENT_DATE) AS invoices_overdue,
       (SELECT COALESCE(sum(total_amount), 0)::text FROM invoices WHERE user_id = $1 AND status = 'unpaid') AS unpaid_amount_total,
       (SELECT COALESCE(sum(amount), 0)::text FROM payments WHERE user_id = $1 AND status = 'successful') AS paid_amount_lifetime,
       (SELECT count(*)::text FROM payments WHERE user_id = $1 AND status = 'failed' AND created_at > now() - interval '30 days') AS failed_payments_30d,
       (SELECT count(*)::text FROM subscriptions WHERE customer_id = $1 AND status IN ('active','trialing')) AS subscriptions_active,
       (SELECT count(*)::text FROM subscriptions WHERE customer_id = $1 AND status IN ('past_due','grace_period','suspended')) AS subscriptions_at_risk,
       (SELECT count(*)::text FROM support_tickets WHERE user_id = $1) AS tickets_total,
       (SELECT count(*)::text FROM support_tickets WHERE user_id = $1 AND status <> 'closed') AS tickets_open,
       (SELECT count(*)::text FROM ai_tasks WHERE customer_id = $1) AS ai_tasks_for_customer`,
    [userId]
  );
  const r = rows[0] ?? {};
  return OK(
    {
      customer: customer.data,
      metrics: {
        servicesTotal: num(r.services_total),
        servicesActive: num(r.services_active),
        domainsTotal: num(r.domains_total),
        ordersTotal: num(r.orders_total),
        invoicesTotal: num(r.invoices_total),
        invoicesUnpaid: num(r.invoices_unpaid),
        invoicesOverdue: num(r.invoices_overdue),
        unpaidAmountTotal: r.unpaid_amount_total ?? '0',
        paidAmountLifetime: r.paid_amount_lifetime ?? '0',
        failedPayments30d: num(r.failed_payments_30d),
        subscriptionsActive: num(r.subscriptions_active),
        subscriptionsAtRisk: num(r.subscriptions_at_risk),
        ticketsTotal: num(r.tickets_total),
        ticketsOpen: num(r.tickets_open),
        aiTasksForCustomer: num(r.ai_tasks_for_customer),
      },
      methodology: "Every metric is a live COUNT/SUM over the customer's own rows in the platform tables. Nothing is estimated.",
    },
    [
      ...customer.evidence,
      { table: 'customer_services', description: 'Service counts' },
      { table: 'invoices', description: 'Invoice counts and unpaid totals' },
      { table: 'payments', description: 'Payment totals' },
      { table: 'subscriptions', description: 'Subscription lifecycle counts' },
      { table: 'support_tickets', description: 'Ticket counts' },
    ]
  );
}

// ==============================================================================================
// READS — billing
// ==============================================================================================

async function toolListOverdueInvoices(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = limitOf(args, 25, 100);
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT i.id, i.invoice_number, i.user_id, u.email AS customer_email, i.currency, i.total_amount,
            i.status, i.due_date::text, i.issued_at::text, (CURRENT_DATE - i.due_date) AS days_overdue
     FROM invoices i JOIN users u ON u.id = i.user_id
     WHERE i.status = 'unpaid' AND i.due_date < CURRENT_DATE
     ORDER BY i.due_date ASC LIMIT $1`,
    [limit]
  );
  return OK(
    {
      count: rows.length,
      invoices: rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        customerId: r.user_id,
        customerEmail: r.customer_email,
        currency: r.currency,
        totalAmount: r.total_amount,
        status: r.status,
        dueDate: r.due_date,
        issuedAt: r.issued_at,
        daysOverdue: num(r.days_overdue),
      })),
    },
    [{ table: 'invoices', description: `${rows.length} unpaid invoice(s) past due date` }]
  );
}

const INVOICE_SELECT = `
  SELECT i.id, i.invoice_number, i.order_id, i.user_id, u.email AS customer_email, i.currency,
         i.subtotal_amount, i.discount_amount, i.tax_amount, i.total_amount, i.status,
         i.due_date::text, i.issued_at::text, i.created_at::text
  FROM invoices i JOIN users u ON u.id = i.user_id`;

async function toolGetInvoice(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const invoiceId = typeof args.invoiceId === 'string' ? args.invoiceId : null;
  if (!invoiceId) return FAIL('VALIDATION', 'invoiceId is required');
  const { rows } = await ctx.db.query<Record<string, unknown>>(`${INVOICE_SELECT} WHERE i.id = $1`, [invoiceId]);
  const invoice = rows[0];
  // Customer workspaces: never leak whether another customer's invoice exists — same NOT_FOUND.
  if (!invoice || (ctx.customerScopeUserId && invoice.user_id !== ctx.customerScopeUserId)) {
    return FAIL('NOT_FOUND', 'Invoice not found');
  }
  const { rows: payments } = await ctx.db.query<Record<string, unknown>>(
    `SELECT id, provider, method, amount, currency, status, failure_reason, initiated_at::text, completed_at::text
     FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC`,
    [invoiceId]
  );
  return OK(
    {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoice_number,
        orderId: invoice.order_id,
        customerId: invoice.user_id,
        customerEmail: invoice.customer_email,
        currency: invoice.currency,
        subtotalAmount: invoice.subtotal_amount,
        discountAmount: invoice.discount_amount,
        taxAmount: invoice.tax_amount,
        totalAmount: invoice.total_amount,
        status: invoice.status,
        dueDate: invoice.due_date,
        issuedAt: invoice.issued_at,
      },
      payments: payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        method: p.method,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        failureReason: p.failure_reason,
        initiatedAt: p.initiated_at,
        completedAt: p.completed_at,
      })),
    },
    [
      { table: 'invoices', id: String(invoice.id), description: `Invoice ${invoice.invoice_number} as stored` },
      { table: 'payments', description: `${payments.length} payment row(s) for the invoice` },
    ]
  );
}

async function toolListInvoices(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = limitOf(args, 25, 100);
  const userId = resolveScopedUserId(ctx, args);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (userId) {
    params.push(userId);
    conditions.push(`i.user_id = $${params.length}`);
  }
  if (typeof args.status === 'string' && ['unpaid', 'paid', 'void', 'refunded', 'partially_refunded'].includes(args.status)) {
    params.push(args.status);
    conditions.push(`i.status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `${INVOICE_SELECT} ${where} ORDER BY i.created_at DESC LIMIT $${params.length}`,
    params
  );
  return OK(
    {
      count: rows.length,
      invoices: rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoice_number,
        customerId: r.user_id,
        customerEmail: r.customer_email,
        currency: r.currency,
        totalAmount: r.total_amount,
        status: r.status,
        dueDate: r.due_date,
        issuedAt: r.issued_at,
      })),
    },
    [{ table: 'invoices', description: `${rows.length} invoice row(s) matching the filter` }]
  );
}

async function toolListFailedPayments(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const days = Math.min(Math.max(Number(args.days ?? 1) || 1, 1), 90);
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT p.id, p.invoice_id, i.invoice_number, p.user_id, u.email AS customer_email, p.provider,
            p.method, p.amount, p.currency, p.status, p.failure_reason, p.created_at::text
     FROM payments p
     JOIN invoices i ON i.id = p.invoice_id
     JOIN users u ON u.id = p.user_id
     WHERE p.status = 'failed' AND p.created_at > now() - ($1 || ' days')::interval
     ORDER BY p.created_at DESC LIMIT 100`,
    [String(days)]
  );
  return OK(
    {
      windowDays: days,
      count: rows.length,
      payments: rows.map((r) => ({
        id: r.id,
        invoiceId: r.invoice_id,
        invoiceNumber: r.invoice_number,
        customerId: r.user_id,
        customerEmail: r.customer_email,
        provider: r.provider,
        method: r.method,
        amount: r.amount,
        currency: r.currency,
        failureReason: r.failure_reason,
        failedAt: r.created_at,
      })),
    },
    [{ table: 'payments', description: `${rows.length} failed payment row(s) in ${days}d` }]
  );
}

async function toolGetRevenueSnapshot(ctx: ToolContext): Promise<ToolResult> {
  const { rows } = await ctx.db.query<Record<string, string>>(
    `SELECT
       (SELECT COALESCE(sum(amount), 0)::text FROM payments WHERE status = 'successful' AND completed_at > now() - interval '1 day') AS paid_1d,
       (SELECT COALESCE(sum(amount), 0)::text FROM payments WHERE status = 'successful' AND completed_at > now() - interval '7 days') AS paid_7d,
       (SELECT COALESCE(sum(amount), 0)::text FROM payments WHERE status = 'successful' AND completed_at > now() - interval '30 days') AS paid_30d,
       (SELECT count(*)::text FROM payments WHERE status = 'successful' AND completed_at > now() - interval '30 days') AS paid_count_30d,
       (SELECT COALESCE(sum(amount), 0)::text FROM payments WHERE status = 'failed' AND created_at > now() - interval '30 days') AS failed_amount_30d,
       (SELECT count(*)::text FROM payments WHERE status = 'failed' AND created_at > now() - interval '30 days') AS failed_count_30d,
       (SELECT COALESCE(sum(amount), 0)::text FROM payments WHERE status IN ('refunded','partially_refunded') AND created_at > now() - interval '30 days') AS refunded_amount_30d,
       (SELECT count(*)::text FROM subscriptions WHERE status IN ('active','trialing')) AS subs_active,
       (SELECT count(*)::text FROM subscriptions WHERE status = 'cancelled' AND cancelled_at > now() - interval '30 days') AS subs_cancelled_30d,
       (SELECT count(*)::text FROM subscriptions WHERE cancel_at_period_end = true AND status = 'active') AS subs_pending_cancellation,
       (SELECT count(*)::text FROM subscriptions WHERE status IN ('past_due','grace_period','suspended')) AS subs_at_risk`
  );
  const r = rows[0] ?? {};
  return OK(
    {
      asOf: new Date().toISOString(),
      // Currency: amounts may span currencies in multi-currency deployments; sums are grouped
      // by the platform billing tables exactly as stored. Callers must not treat mixed-currency
      // totals as a single-currency figure.
      successfulPayments: { last1Day: r.paid_1d ?? '0', last7Days: r.paid_7d ?? '0', last30Days: r.paid_30d ?? '0', count30d: num(r.paid_count_30d) },
      failedPayments: { amount30d: r.failed_amount_30d ?? '0', count30d: num(r.failed_count_30d) },
      refunds: { amount30d: r.refunded_amount_30d ?? '0' },
      subscriptions: {
        active: num(r.subs_active),
        cancelledLast30d: num(r.subs_cancelled_30d),
        pendingCancellation: num(r.subs_pending_cancellation),
        atRisk: num(r.subs_at_risk),
      },
      methodology:
        'Sums come from payments.amount of real payment rows grouped by status and completed_at/created_at windows. Subscription counts come from the subscriptions table lifecycle columns. MRR is NOT estimated because catalog billing cycles vary; this is stated, not invented.',
    },
    [
      { table: 'payments', description: 'Successful/failed/refunded payment sums in 1/7/30-day windows' },
      { table: 'subscriptions', description: 'Subscription lifecycle counts' },
    ]
  );
}

async function toolListSubscriptions(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = limitOf(args, 25, 100);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (typeof args.status === 'string' && args.status.length > 0) {
    params.push(args.status);
    conditions.push(`s.status = $${params.length}`);
  }
  const scopedUser = resolveScopedUserId(ctx, args);
  if (scopedUser) {
    params.push(scopedUser);
    conditions.push(`s.customer_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT s.id, s.customer_id, u.email AS customer_email, s.plan_id, p.name AS plan_name,
            s.status, s.current_period_end::text, s.cancel_at_period_end, s.cancelled_at::text,
            s.past_due_since::text, s.suspended_at::text, s.created_at::text
     FROM subscriptions s
     JOIN users u ON u.id = s.customer_id
     LEFT JOIN product_plans p ON p.id = s.plan_id
     ${where}
     ORDER BY s.current_period_end ASC LIMIT $${params.length}`,
    params
  );
  return OK(
    {
      count: rows.length,
      subscriptions: rows.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        customerEmail: r.customer_email,
        planId: r.plan_id,
        planName: r.plan_name,
        status: r.status,
        currentPeriodEnd: r.current_period_end,
        cancelAtPeriodEnd: r.cancel_at_period_end,
        cancelledAt: r.cancelled_at,
        pastDueSince: r.past_due_since,
        suspendedAt: r.suspended_at,
      })),
    },
    [{ table: 'subscriptions', description: `${rows.length} subscription row(s)` }]
  );
}

// ==============================================================================================
// READS — support
// ==============================================================================================

async function toolListOpenTickets(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = limitOf(args, 25, 100);
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT t.id, t.user_id, u.email AS customer_email, t.subject, t.status, t.priority,
            t.created_at::text, t.updated_at::text,
            EXTRACT(EPOCH FROM (now() - t.created_at)) / 3600 AS age_hours
     FROM support_tickets t JOIN users u ON u.id = t.user_id
     WHERE t.status <> 'closed'
     ORDER BY t.created_at ASC LIMIT $1`,
    [limit]
  );
  return OK(
    {
      count: rows.length,
      tickets: rows.map((r) => ({
        id: r.id,
        customerId: r.user_id,
        customerEmail: r.customer_email,
        subject: r.subject,
        status: r.status,
        priority: r.priority,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        ageHours: Math.round(num(r.age_hours) * 10) / 10,
      })),
    },
    [{ table: 'support_tickets', description: `${rows.length} unclosed ticket(s)` }]
  );
}

async function toolGetTicket(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const ticketId = typeof args.ticketId === 'string' ? args.ticketId : null;
  if (!ticketId) return FAIL('VALIDATION', 'ticketId is required');
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT t.id, t.user_id, u.email AS customer_email, t.subject, t.status, t.priority,
            t.created_at::text, t.updated_at::text, t.closed_at::text
     FROM support_tickets t JOIN users u ON u.id = t.user_id WHERE t.id = $1`,
    [ticketId]
  );
  const ticket = rows[0];
  if (!ticket || (ctx.customerScopeUserId && ticket.user_id !== ctx.customerScopeUserId)) {
    return FAIL('NOT_FOUND', 'Ticket not found');
  }
  const { rows: messages } = await ctx.db.query<Record<string, unknown>>(
    `SELECT id, author_id, author_role, body, created_at::text FROM support_ticket_messages WHERE ticket_id = $1 ORDER BY created_at ASC LIMIT 50`,
    [ticketId]
  );
  return OK(
    {
      ticket: {
        id: ticket.id,
        customerId: ticket.user_id,
        customerEmail: ticket.customer_email,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        createdAt: ticket.created_at,
        updatedAt: ticket.updated_at,
        closedAt: ticket.closed_at,
      },
      messages: messages.map((m) => ({ id: m.id, authorId: m.author_id, authorRole: m.author_role, body: m.body, createdAt: m.created_at })),
    },
    [
      { table: 'support_tickets', id: String(ticket.id), description: `Ticket "${ticket.subject}"` },
      { table: 'support_ticket_messages', description: `${messages.length} message(s) in thread` },
    ]
  );
}

// ==============================================================================================
// READS — infrastructure / security
// ==============================================================================================

async function toolListServerHealth(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = limitOf(args, 50, 100);
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT s.id, s.name, s.hostname, s.server_type, s.provider, s.region, s.status,
            s.agent_last_seen_at::text, s.cpu_cores, s.memory_mb, s.storage_mb,
            m.captured_at::text AS metrics_captured_at, m.cpu_percent, m.memory_used_mb, m.memory_total_mb,
            m.disk_used_mb, m.disk_total_mb, m.load_1, m.uptime_seconds,
            m.docker_containers, m.docker_containers_healthy
     FROM servers s
     LEFT JOIN LATERAL (
       SELECT * FROM server_metrics sm WHERE sm.server_id = s.id ORDER BY sm.captured_at DESC LIMIT 1
     ) m ON true
     WHERE s.status <> 'retired'
     ORDER BY s.created_at ASC LIMIT $1`,
    [limit]
  );
  const servers = rows.map((r) => {
    const flags: string[] = [];
    if (r.status !== 'active') flags.push(`status:${r.status}`);
    if (r.metrics_captured_at === null || r.metrics_captured_at === undefined) flags.push('no_telemetry');
    if (r.cpu_percent !== null && num(r.cpu_percent) >= 90) flags.push('cpu_saturated');
    if (r.memory_used_mb !== null && r.memory_total_mb !== null && num(r.memory_total_mb) > 0 && (num(r.memory_used_mb) / num(r.memory_total_mb)) >= 0.9) flags.push('memory_pressure');
    if (r.disk_used_mb !== null && r.disk_total_mb !== null && num(r.disk_total_mb) > 0 && (num(r.disk_used_mb) / num(r.disk_total_mb)) >= 0.9) flags.push('disk_pressure');
    if (r.docker_containers !== null && r.docker_containers_healthy !== null && num(r.docker_containers) > num(r.docker_containers_healthy)) flags.push('unhealthy_containers');
    return {
      id: r.id,
      name: r.name,
      hostname: r.hostname,
      serverType: r.server_type,
      provider: r.provider,
      region: r.region,
      status: r.status,
      agentLastSeenAt: r.agent_last_seen_at,
      capacity: { cpuCores: num(r.cpu_cores), memoryMb: num(r.memory_mb), storageMb: num(r.storage_mb) },
      latestMetrics: r.metrics_captured_at
        ? {
            capturedAt: r.metrics_captured_at,
            cpuPercent: r.cpu_percent === null ? null : num(r.cpu_percent),
            memoryUsedMb: r.memory_used_mb === null ? null : num(r.memory_used_mb),
            memoryTotalMb: r.memory_total_mb === null ? null : num(r.memory_total_mb),
            diskUsedMb: r.disk_used_mb === null ? null : num(r.disk_used_mb),
            diskTotalMb: r.disk_total_mb === null ? null : num(r.disk_total_mb),
            load1: r.load_1 === null ? null : num(r.load_1),
            uptimeSeconds: r.uptime_seconds === null ? null : num(r.uptime_seconds),
            dockerContainers: r.docker_containers === null ? null : num(r.docker_containers),
            dockerContainersHealthy: r.docker_containers_healthy === null ? null : num(r.docker_containers_healthy),
          }
        : null,
      flags,
    };
  });
  return OK(
    {
      count: servers.length,
      flaggedCount: servers.filter((s) => s.flags.length > 0).length,
      thresholds: 'cpu>=90%, memory>=90%, disk>=90%, any unhealthy container, non-active status, or missing telemetry — evaluated on the latest server_metrics row for each server.',
      servers,
    },
    [{ table: 'servers', description: `${servers.length} server row(s)` }, { table: 'server_metrics', description: 'Latest telemetry row per server' }]
  );
}

async function toolGetServer(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const serverId = typeof args.serverId === 'string' ? args.serverId : null;
  if (!serverId) return FAIL('VALIDATION', 'serverId is required');
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT id, name, hostname, ip_address, server_type, provider, region, status, agent_version,
            agent_last_seen_at::text, cpu_cores, memory_mb, storage_mb, docker_enabled, kubernetes_enabled,
            cpanel_enabled, created_at::text
     FROM servers WHERE id = $1`,
    [serverId]
  );
  const server = rows[0];
  if (!server) return FAIL('NOT_FOUND', 'Server not found');
  const { rows: metrics } = await ctx.db.query<Record<string, unknown>>(
    `SELECT captured_at::text, cpu_percent, load_1, memory_used_mb, memory_total_mb, disk_used_mb, disk_total_mb,
            docker_containers, docker_containers_healthy
     FROM server_metrics WHERE server_id = $1 ORDER BY captured_at DESC LIMIT 5`,
    [serverId]
  );
  const { rows: deployments } = await ctx.db.query<Record<string, unknown>>(
    `SELECT id, action, status, error_code, error_message, attempts, created_at::text, completed_at::text
     FROM deployments WHERE server_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [serverId]
  );
  return OK(
    {
      server,
      recentMetrics: metrics,
      recentDeployments: deployments,
    },
    [
      { table: 'servers', id: serverId, description: `Server ${server.hostname}` },
      { table: 'server_metrics', description: `${metrics.length} recent telemetry row(s)` },
      { table: 'deployments', description: `${deployments.length} recent deployment(s)` },
    ]
  );
}

async function toolListStuckDeployments(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const minutes = Math.min(Math.max(Number(args.minutes ?? 60) || 60, 5), 24 * 60);
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT d.id, d.installation_id, d.server_id, d.order_id, d.action, d.status, d.attempts, d.max_attempts,
            d.error_code, d.error_message, d.run_after::text, d.created_at::text, d.started_at::text,
            EXTRACT(EPOCH FROM (now() - COALESCE(d.started_at, d.created_at))) / 60 AS age_minutes
     FROM deployments d
     WHERE d.status IN ('queued','running')
       AND COALESCE(d.started_at, d.created_at) < now() - ($1 || ' minutes')::interval
     ORDER BY d.created_at ASC LIMIT 100`,
    [String(minutes)]
  );
  return OK(
    {
      thresholdMinutes: minutes,
      count: rows.length,
      deployments: rows.map((r) => ({
        id: r.id,
        installationId: r.installation_id,
        serverId: r.server_id,
        orderId: r.order_id,
        action: r.action,
        status: r.status,
        attempts: num(r.attempts),
        maxAttempts: num(r.max_attempts),
        errorCode: r.error_code,
        errorMessage: r.error_message,
        ageMinutes: Math.round(num(r.age_minutes)),
        createdAt: r.created_at,
        startedAt: r.started_at,
      })),
    },
    [{ table: 'deployments', description: `${rows.length} queued/running deployment(s) older than ${minutes} minutes` }]
  );
}

async function toolListFailedDeployments(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const days = Math.min(Math.max(Number(args.days ?? 1) || 1, 1), 30);
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT d.id, d.installation_id, d.server_id, s.hostname AS server_hostname, d.order_id, d.action, d.status,
            d.attempts, d.error_code, d.error_message, d.created_at::text, d.completed_at::text
     FROM deployments d
     LEFT JOIN servers s ON s.id = d.server_id
     WHERE d.status = 'failed' AND d.created_at > now() - ($1 || ' days')::interval
     ORDER BY d.created_at DESC LIMIT 100`,
    [String(days)]
  );
  return OK(
    {
      windowDays: days,
      count: rows.length,
      deployments: rows.map((r) => ({
        id: r.id,
        installationId: r.installation_id,
        serverId: r.server_id,
        serverHostname: r.server_hostname,
        orderId: r.order_id,
        action: r.action,
        attempts: num(r.attempts),
        errorCode: r.error_code,
        errorMessage: r.error_message,
        createdAt: r.created_at,
        completedAt: r.completed_at,
      })),
    },
    [{ table: 'deployments', description: `${rows.length} failed deployment(s) in ${days}d with recorded error codes` }]
  );
}

async function toolListExpiringSsl(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const days = Math.min(Math.max(Number(args.days ?? 30) || 30, 1), 365);
  const conditions: string[] = [`c.expires_at IS NOT NULL`, `c.expires_at < now() + ($1 || ' days')::interval`, `c.status IN ('ISSUED','PENDING','VALIDATING','EXPIRED','FAILED')`];
  const params: unknown[] = [String(days)];
  const scopedUser = resolveScopedUserId(ctx, args);
  if (scopedUser) {
    params.push(scopedUser);
    conditions.push(`c.user_id = $${params.length}`);
  }
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT c.id, c.user_id, u.email AS customer_email, c.domain_name, c.issuer, c.status,
            c.expires_at::text, c.auto_renew,
            EXTRACT(DAY FROM (c.expires_at - now())) AS days_until_expiry
     FROM ssl_certificates c JOIN users u ON u.id = c.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY c.expires_at ASC LIMIT 100`,
    params
  );
  return OK(
    {
      windowDays: days,
      count: rows.length,
      certificates: rows.map((r) => ({
        id: r.id,
        customerId: r.user_id,
        customerEmail: r.customer_email,
        domainName: r.domain_name,
        issuer: r.issuer,
        status: r.status,
        expiresAt: r.expires_at,
        autoRenew: r.auto_renew,
        daysUntilExpiry: r.days_until_expiry === null ? null : num(r.days_until_expiry),
      })),
    },
    [{ table: 'ssl_certificates', description: `${rows.length} certificate(s) expiring within ${days}d or already expired/failed` }]
  );
}

async function toolListExpiringDomains(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const days = Math.min(Math.max(Number(args.days ?? 30) || 30, 1), 365);
  const conditions: string[] = [`d.expires_at IS NOT NULL`, `d.expires_at < CURRENT_DATE + $1::int`, `d.status IN ('active','expired','pending_transfer')`];
  const params: unknown[] = [days];
  const scopedUser = resolveScopedUserId(ctx, args);
  if (scopedUser) {
    params.push(scopedUser);
    conditions.push(`d.user_id = $${params.length}`);
  }
  const { rows } = await ctx.db.query<Record<string, unknown>>(
    `SELECT d.id, d.user_id, u.email AS customer_email, d.domain_name, d.registrar, d.status,
            d.expires_at::text, (d.expires_at - CURRENT_DATE) AS days_until_expiry
     FROM customer_domains d JOIN users u ON u.id = d.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY d.expires_at ASC LIMIT 100`,
    params
  );
  return OK(
    {
      windowDays: days,
      count: rows.length,
      domains: rows.map((r) => ({
        id: r.id,
        customerId: r.user_id,
        customerEmail: r.customer_email,
        domainName: r.domain_name,
        registrar: r.registrar,
        status: r.status,
        expiresAt: r.expires_at,
        daysUntilExpiry: num(r.days_until_expiry),
      })),
    },
    [{ table: 'customer_domains', description: `${rows.length} domain(s) expiring within ${days}d or already expired` }]
  );
}

async function toolListAuthAnomalies(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const hours = Math.min(Math.max(Number(args.hours ?? 24) || 24, 1), 168);
  const { rows: byIp } = await ctx.db.query<Record<string, unknown>>(
    `SELECT ip_address, count(*)::text AS failures, count(DISTINCT user_id)::text AS accounts_targeted,
            max(created_at)::text AS last_seen
     FROM auth_audit_log
     WHERE event_type = 'login_failure' AND created_at > now() - ($1 || ' hours')::interval AND ip_address IS NOT NULL
     GROUP BY ip_address HAVING count(*) >= 5
     ORDER BY count(*) DESC LIMIT 50`,
    [String(hours)]
  );
  const { rows: byAccount } = await ctx.db.query<Record<string, unknown>>(
    `SELECT a.user_id, u.email AS customer_email, count(*)::text AS failures,
            count(DISTINCT a.ip_address)::text AS distinct_ips, max(a.created_at)::text AS last_seen
     FROM auth_audit_log a JOIN users u ON u.id = a.user_id
     WHERE a.event_type = 'login_failure' AND a.created_at > now() - ($1 || ' hours')::interval AND a.user_id IS NOT NULL
     GROUP BY a.user_id, u.email HAVING count(*) >= 3
     ORDER BY count(*) DESC LIMIT 50`,
    [String(hours)]
  );
  return OK(
    {
      windowHours: hours,
      thresholds: 'IP clusters: >=5 failures from one IP; account clusters: >=3 failures on one account — from the real auth_audit_log. Clusters are facts, not verdicts: security staff assess intent.',
      ipClusters: byIp.map((r) => ({ ipAddress: r.ip_address, failures: num(r.failures), accountsTargeted: num(r.accounts_targeted), lastSeen: r.last_seen })),
      accountClusters: byAccount.map((r) => ({ customerId: r.user_id, customerEmail: r.customer_email, failures: num(r.failures), distinctIps: num(r.distinct_ips), lastSeen: r.last_seen })),
    },
    [{ table: 'auth_audit_log', description: `login_failure clusters in ${hours}h` }]
  );
}

async function toolSearchKnowledge(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query : '';
  const hits = await searchKnowledge(ctx.db, query, limitOf(args, 5, 10));
  if (hits.length === 0) {
    return OK(
      { query, count: 0, results: [], note: 'No registered knowledge chunk matches this query. This is stated plainly instead of improvising an answer (spec §24).' },
      []
    );
  }
  return OK(
    {
      query,
      count: hits.length,
      results: hits.map((h) => ({
        chunkId: h.chunk.id,
        title: h.chunk.title,
        content: h.chunk.content,
        score: h.score,
        citation: { sourceId: h.source.id, source: h.source.title, version: h.source.version, type: h.source.source_type, uri: h.source.uri },
      })),
    },
    hits.map((h) => ({ table: 'ai_knowledge_chunks', id: h.chunk.id, description: `Chunk from "${h.source.title}" v${h.source.version}` }))
  );
}

async function toolListIncidents(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const incidents = await listIncidents(ctx.db, { limit: limitOf(args, 25, 100) });
  return OK(
    {
      count: incidents.length,
      incidents: incidents.map((i) => ({
        id: i.id,
        incidentNumber: i.incident_number,
        title: i.title,
        severity: i.severity,
        status: i.status,
        summary: i.summary,
        affected: i.affected,
        resolvedAt: i.resolved_at,
        createdAt: i.created_at,
      })),
    },
    [{ table: 'ai_incidents', description: `${incidents.length} incident row(s)` }]
  );
}

async function toolGetAiActivity(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const userId = resolveScopedUserId(ctx, args);
  if (!userId) return FAIL('VALIDATION', 'userId is required');
  const limit = limitOf(args, 20, 100);
  const { rows: tasks } = await ctx.db.query<Record<string, unknown>>(
    `SELECT t.id, t.task_type, t.status, t.result_summary, t.created_at::text, t.completed_at::text,
            a.slug AS agent_slug, a.name AS agent_name
     FROM ai_tasks t JOIN ai_agents a ON a.id = t.agent_id
     WHERE t.customer_id = $1 ORDER BY t.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  const { rows: findings } = await ctx.db.query<Record<string, unknown>>(
    `SELECT f.id, f.finding_type, f.severity, f.title, f.summary, f.status, f.created_at::text, a.slug AS agent_slug
     FROM ai_findings f JOIN ai_agents a ON a.id = f.agent_id
     WHERE f.subject_type = 'customer' AND f.subject_id = $1 ORDER BY f.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  const { rows: approvals } = await ctx.db.query<Record<string, unknown>>(
    `SELECT ap.id, ap.tool, ap.action, ap.status, ap.risk_level, ap.created_at::text, a.slug AS agent_slug
     FROM ai_approvals ap JOIN ai_agents a ON a.id = ap.agent_id
     WHERE ap.affected_customer_id = $1 ORDER BY ap.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return OK(
    { customerId: userId, tasks, findings, approvals },
    [
      { table: 'ai_tasks', description: `${tasks.length} AI task(s) for this customer` },
      { table: 'ai_findings', description: `${findings.length} finding(s) about this customer` },
      { table: 'ai_approvals', description: `${approvals.length} approval(s) affecting this customer` },
    ]
  );
}

// ==============================================================================================
// WRITES — support / notifications / incidents / infrastructure / governance
// ==============================================================================================

async function toolCreateTicket(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const userId = resolveScopedUserId(ctx, args);
  if (!userId) return FAIL('VALIDATION', 'userId is required');
  const subject = String(args.subject);
  const body = String(args.body);
  const priority = ['low', 'normal', 'high'].includes(String(args.priority)) ? String(args.priority) : 'normal';
  // The owner must really exist — a ticket can never be fabricated for a non-customer.
  const { rows: owner } = await ctx.db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!owner[0]) return FAIL('NOT_FOUND', 'Ticket owner account not found');
  const ticketId = randomUUID();
  await ctx.db.query(
    `INSERT INTO support_tickets (id, user_id, subject, status, priority) VALUES ($1,$2,$3,'open',$4)`,
    [ticketId, userId, subject, priority]
  );
  const authorId = ctx.actorUserId ?? userId;
  await ctx.db.query(
    `INSERT INTO support_ticket_messages (id, ticket_id, author_id, author_role, body) VALUES ($1,$2,$3,$4,$5)`,
    [randomUUID(), ticketId, authorId, ctx.customerScopeUserId ? 'customer' : 'ai_agent', body]
  );
  await emitEvent(ctx.db, {
    eventType: 'ticket.created',
    source: 'agent',
    fingerprint: `ticket.created:${ticketId}`,
    payload: { ticketId, customerId: userId, by: 'ai' },
  });
  return OK(
    { ticketId, ownerId: userId, status: 'open', priority },
    [{ table: 'support_tickets', id: ticketId, description: 'Ticket created' }, { table: 'support_ticket_messages', description: 'First message written' }]
  );
}

async function toolAcknowledgeTicket(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const ticketId = String(args.ticketId);
  const status = String(args.status);
  if (!['pending_staff', 'pending_customer', 'closed'].includes(status)) {
    return FAIL('VALIDATION', 'status must be pending_staff, pending_customer or closed');
  }
  const { rows } = await ctx.db.query<{ id: string; user_id: string }>(
    `UPDATE support_tickets SET status = $2, closed_at = CASE WHEN $2 = 'closed' THEN now() ELSE closed_at END, updated_at = now()
     WHERE id = $1 AND status <> $2 ${ctx.customerScopeUserId ? 'AND user_id = $3' : ''} RETURNING id, user_id`,
    ctx.customerScopeUserId ? [ticketId, status, ctx.customerScopeUserId] : [ticketId, status]
  );
  if (!rows[0]) return FAIL('NOT_FOUND', 'Ticket not found or already in the requested status');
  return OK({ ticketId, status }, [{ table: 'support_tickets', id: ticketId, description: `Status set to ${status}` }]);
}

async function toolSendNotification(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const userId = String(args.userId);
  const type = String(args.type);
  const title = String(args.title);
  const message = String(args.message);
  const resourceType = typeof args.resourceType === 'string' ? args.resourceType : null;
  const resourceId = typeof args.resourceId === 'string' ? args.resourceId : null;
  // Recipient must exist.
  const { rows: recipient } = await ctx.db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [userId]);
  if (!recipient[0]) return FAIL('NOT_FOUND', 'Recipient account not found');
  // Real platform path: durable in-app notification + queued email outbox row (idempotent per
  // type+resource). Receipt (notification id) is the only success claim allowed (§29).
  const notificationId = await createNotification(ctx.db, { userId, type, title, message, resourceType, resourceId });
  return OK(
    {
      notificationId,
      delivered: null,
      note: notificationId
        ? 'Notification record created and email delivery queued in notification_outbox. Delivery itself is reported by the outbox sweep — not claimed here.'
        : 'An identical notification for this type+resource already exists (idempotency) — no duplicate was created.',
    },
    [{ table: 'user_notifications', id: notificationId ?? undefined, description: 'In-app notification' }, { table: 'notification_outbox', description: 'Email delivery queued' }]
  );
}

async function toolCreateIncident(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const severity = ['low', 'medium', 'high', 'critical'].includes(String(args.severity)) ? String(args.severity) : 'medium';
  const incident = await repoCreateIncident(ctx.db, {
    severity,
    title: String(args.title),
    summary: String(args.summary),
    affected: [],
    commanderAgentId: ctx.agentId ?? null,
    openedBy: ctx.actorUserId ?? null,
    openedByType: ctx.actorUserId ? 'staff' : 'agent',
    timelineNote: 'Incident created by AI Incident workflow',
  });
  await emitEvent(ctx.db, {
    eventType: 'incident.created',
    source: 'agent',
    fingerprint: `incident.created:${incident.id}`,
    payload: { incidentId: incident.id, incidentNumber: incident.incident_number, severity },
  });
  return OK(
    { incidentId: incident.id, incidentNumber: incident.incident_number, status: incident.status, severity },
    [{ table: 'ai_incidents', id: incident.id, description: `Incident ${incident.incident_number} created` }]
  );
}

async function toolUpdateIncident(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const incidentId = String(args.incidentId);
  const note = String(args.note);
  const status = typeof args.status === 'string' && ['open', 'investigating', 'mitigated', 'resolved'].includes(args.status) ? args.status : undefined;
  const updated = await appendIncidentTimeline(ctx.db, incidentId, note, ctx.agentId ?? ctx.actorUserId ?? 'ai', status);
  if (!updated) return FAIL('NOT_FOUND', 'Incident not found');
  return OK({ incidentId, status: updated.status }, [{ table: 'ai_incidents', id: incidentId, description: 'Timeline appended' }]);
}

async function toolEnqueueInstallationAction(ctx: ToolContext, args: Record<string, unknown>, action: 'restart' | 'suspend'): Promise<ToolResult> {
  const installationId = String(args.installationId);
  const reason = String(args.reason);
  // The installation must really exist and be in a state where the action is meaningful — the
  // queue is real, so the preconditions are real too (fail closed otherwise).
  const { rows: inst } = await ctx.db.query<{ id: string; status: string; name: string; server_id: string | null; customer_id: string }>(
    `SELECT id, status, name, server_id, customer_id FROM application_installations WHERE id = $1`,
    [installationId]
  );
  const installation = inst[0];
  if (!installation) return FAIL('NOT_FOUND', 'Installation not found');
  if (action === 'restart' && !['active', 'running', 'stopped', 'failed'].includes(installation.status)) {
    return FAIL('INVALID_STATE', `Cannot restart an installation in '${installation.status}' status`);
  }
  if (action === 'suspend' && ['suspended', 'terminated', 'deleted'].includes(installation.status)) {
    return FAIL('INVALID_STATE', `Installation is already '${installation.status}'`);
  }
  const idempotencyKey = `ai:${action}:${ctx.executionId ?? randomUUID()}`;
  const { deployment, created } = await enqueueDeployment(ctx.db, {
    installationId,
    serverId: installation.server_id,
    action,
    idempotencyKey,
    requestedBy: ctx.actorUserId ?? null,
    payload: { requestedByAgent: true, reason },
    maxAttempts: 2,
  });
  return OK(
    {
      deploymentId: deployment.id,
      action,
      created,
      status: deployment.status,
      note: 'The deployment is QUEUED, not completed. Success may only be claimed after the deployment row reports completion — verification is the deployment engine\'s job, not this tool\'s.',
    },
    [{ table: 'application_installations', id: installationId, description: `Installation ${installation.name} (${installation.status})` }, { table: 'deployments', id: deployment.id, description: `${action} deployment ${created ? 'enqueued' : 'already existed (idempotent)'}` }]
  );
}

async function toolDraftCustomerMessage(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const purpose = String(args.purpose);
  const facts = String(args.facts);
  const tone = String(args.tone ?? 'friendly');
  const greeting = tone === 'formal' ? 'Dear customer,' : 'Hello,';
  const subject = `[DRAFT] ${purpose}`.slice(0, 255);
  const body = [
    greeting,
    '',
    `This message concerns: ${purpose}.`,
    '',
    'Details from your CloudHost247 account:',
    facts,
    '',
    'If you have any questions, reply to this message or open a support ticket from your CloudHost247 dashboard.',
    '',
    '— CloudHost247',
  ].join('\n');
  return OK(
    {
      draft: { subject, body },
      status: 'draft_only',
      note: 'This is a draft work product stored with the task output. Nothing was sent. Sending requires the send_notification tool with its human approval gate.',
    },
    [{ table: '(task output)', description: 'Draft derived from the caller-supplied facts — caller must supply facts from real records' }]
  );
}

async function toolSetAgentEnabled(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const slug = String(args.agentSlug);
  const enabled = Boolean(args.enabled);
  const updated = await setAgentEnabled(ctx.db, slug, enabled);
  if (!updated) return FAIL('NOT_FOUND', `Agent '${slug}' not found`);
  return OK({ slug, enabled: updated.enabled, status: updated.status }, [{ table: 'ai_agents', id: updated.id, description: `Agent ${slug} ${enabled ? 'enabled' : 'disabled'}` }]);
}

async function toolRecordEvaluation(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  if (!ctx.agentId) return FAIL('VALIDATION', 'record_evaluation requires an agent context');
  const id = await insertEvaluation(ctx.db, {
    agentId: ctx.agentId,
    metric: String(args.metric).slice(0, 40),
    value: num(args.value),
    raterId: ctx.actorUserId ?? null,
    notes: typeof args.notes === 'string' ? args.notes : null,
  });
  return OK({ evaluationId: id }, [{ table: 'ai_evaluations', id, description: `Evaluation metric ${args.metric}` }]);
}

// ==============================================================================================
// Dispatcher
// ==============================================================================================

export async function executeToolImplementation(
  ctx: ToolContext,
  name: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  switch (name) {
    case 'get_platform_overview': return toolGetPlatformOverview(ctx);
    case 'get_customer': return toolGetCustomer(ctx, args);
    case 'get_customer_profile': return toolGetCustomerProfile(ctx, args);
    case 'list_overdue_invoices': return toolListOverdueInvoices(ctx, args);
    case 'get_invoice': return toolGetInvoice(ctx, args);
    case 'list_invoices': return toolListInvoices(ctx, args);
    case 'list_failed_payments': return toolListFailedPayments(ctx, args);
    case 'get_revenue_snapshot': return toolGetRevenueSnapshot(ctx);
    case 'list_subscriptions': return toolListSubscriptions(ctx, args);
    case 'list_open_tickets': return toolListOpenTickets(ctx, args);
    case 'get_ticket': return toolGetTicket(ctx, args);
    case 'list_server_health': return toolListServerHealth(ctx, args);
    case 'get_server': return toolGetServer(ctx, args);
    case 'list_stuck_deployments': return toolListStuckDeployments(ctx, args);
    case 'list_failed_deployments': return toolListFailedDeployments(ctx, args);
    case 'list_expiring_ssl': return toolListExpiringSsl(ctx, args);
    case 'list_expiring_domains': return toolListExpiringDomains(ctx, args);
    case 'list_auth_anomalies': return toolListAuthAnomalies(ctx, args);
    case 'search_knowledge': return toolSearchKnowledge(ctx, args);
    case 'list_incidents': return toolListIncidents(ctx, args);
    case 'get_ai_activity': return toolGetAiActivity(ctx, args);
    case 'create_ticket': return toolCreateTicket(ctx, args);
    case 'acknowledge_ticket': return toolAcknowledgeTicket(ctx, args);
    case 'send_notification': return toolSendNotification(ctx, args);
    case 'create_incident': return toolCreateIncident(ctx, args);
    case 'update_incident': return toolUpdateIncident(ctx, args);
    case 'restart_installation': return toolEnqueueInstallationAction(ctx, args, 'restart');
    case 'suspend_installation': return toolEnqueueInstallationAction(ctx, args, 'suspend');
    case 'draft_customer_message': return toolDraftCustomerMessage(ctx, args);
    case 'set_agent_enabled': return toolSetAgentEnabled(ctx, args);
    case 'record_evaluation': return toolRecordEvaluation(ctx, args);
    default:
      return FAIL('UNKNOWN_TOOL', `Tool '${name}' is not implemented`);
  }
}
