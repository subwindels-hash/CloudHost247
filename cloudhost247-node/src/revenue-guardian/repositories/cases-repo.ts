/**
 * Recovery-case data access. All queries are parameterized; list queries are paginated and
 * filtered at the database level (spec §58). When `scopeStaffId` is set (a staff account without
 * revenue_guardian.view_all_customers) results are limited to that staff member's portfolio:
 * cases assigned to them OR customers actively assigned to them (spec §25, §42).
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { CasePriority, CaseStatus, Paginated, RecoveryCaseRow, RiskLevel } from '../types';

export interface CaseWithContext extends RecoveryCaseRow {
  customer_email: string;
  customer_name: string;
  invoice_number: string | null;
  invoice_total: string | null;
  invoice_status: string | null;
  invoice_due_date: string | null;
  days_overdue: number | null;
  assigned_staff_email: string | null;
  assigned_staff_name: string | null;
  service_label: string | null;
  open_promise_count: number;
}

export interface ListCasesFilters {
  page?: number;
  limit?: number;
  status?: CaseStatus | 'open';
  riskLevel?: RiskLevel;
  priority?: CasePriority;
  customerId?: string;
  assignedStaffId?: string;
  invoiceId?: string;
  search?: string;
  scopeStaffId?: string | null;
  sortBy?: 'opened_at' | 'amount_outstanding' | 'next_follow_up_at' | 'risk_score' | 'days_overdue';
  sortDir?: 'asc' | 'desc';
}

const CASE_SELECT = `
  SELECT c.*,
         u.email AS customer_email,
         u.full_name AS customer_name,
         i.invoice_number,
         i.total_amount::text AS invoice_total,
         i.status AS invoice_status,
         i.due_date::text AS invoice_due_date,
         CASE WHEN i.id IS NOT NULL AND i.status = 'unpaid' AND i.due_date < CURRENT_DATE
              THEN (CURRENT_DATE - i.due_date)::int ELSE NULL END AS days_overdue,
         s.email AS assigned_staff_email,
         s.full_name AS assigned_staff_name,
         cs.label AS service_label,
         (SELECT count(*)::int FROM revenue_guardian_payment_promises p
           WHERE p.case_id = c.id AND p.status = 'pending') AS open_promise_count
    FROM revenue_guardian_recovery_cases c
    JOIN users u ON u.id = c.customer_id
    LEFT JOIN invoices i ON i.id = c.invoice_id
    LEFT JOIN users s ON s.id = c.assigned_staff_id
    LEFT JOIN customer_services cs ON cs.id = c.service_id
`;

/** SQL fragment limiting rows to a staff member's own portfolio. `$n` is the staff id param. */
export function staffScopeClause(customerColumn: string, staffColumn: string | null, paramIdx: number): string {
  const assignmentExists = `EXISTS (
    SELECT 1 FROM revenue_guardian_assignments sa
     WHERE sa.customer_id = ${customerColumn} AND sa.staff_user_id = $${paramIdx} AND sa.ended_at IS NULL)`;
  return staffColumn ? `(${staffColumn} = $${paramIdx} OR ${assignmentExists})` : assignmentExists;
}

export async function listCases(db: Queryable, filters: ListCasesFilters): Promise<Paginated<CaseWithContext>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where: string[] = [];
  const params: unknown[] = [];

  const push = (value: unknown): number => {
    params.push(value);
    return params.length;
  };

  if (filters.status === 'open') {
    where.push(`c.closed_at IS NULL`);
  } else if (filters.status) {
    where.push(`c.status = $${push(filters.status)}`);
  }
  if (filters.riskLevel) where.push(`c.risk_level = $${push(filters.riskLevel)}`);
  if (filters.priority) where.push(`c.priority = $${push(filters.priority)}`);
  if (filters.customerId) where.push(`c.customer_id = $${push(filters.customerId)}`);
  if (filters.assignedStaffId) where.push(`c.assigned_staff_id = $${push(filters.assignedStaffId)}`);
  if (filters.invoiceId) where.push(`c.invoice_id = $${push(filters.invoiceId)}`);
  if (filters.search) {
    const idx = push(`%${filters.search}%`);
    where.push(`(u.email ILIKE $${idx} OR u.full_name ILIKE $${idx} OR c.case_number ILIKE $${idx} OR i.invoice_number ILIKE $${idx})`);
  }
  if (filters.scopeStaffId) {
    where.push(staffScopeClause('c.customer_id', 'c.assigned_staff_id', push(filters.scopeStaffId)));
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sortColumn = {
    opened_at: 'c.opened_at',
    amount_outstanding: 'c.amount_outstanding',
    next_follow_up_at: 'c.next_follow_up_at',
    risk_score: 'c.risk_score',
    days_overdue: 'days_overdue',
  }[filters.sortBy ?? 'opened_at'];
  const sortDir = filters.sortDir === 'asc' ? 'ASC' : 'DESC';

  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total
       FROM revenue_guardian_recovery_cases c
       JOIN users u ON u.id = c.customer_id
       LEFT JOIN invoices i ON i.id = c.invoice_id
      ${whereSql}`,
    params
  );
  const total = Number(countResult.rows[0]?.total ?? 0);

  const { rows } = await db.query<CaseWithContext>(
    `${CASE_SELECT} ${whereSql} ORDER BY ${sortColumn} ${sortDir} NULLS LAST, c.created_at DESC
      LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total, page, limit };
}

export async function findCaseById(db: Queryable, id: string): Promise<CaseWithContext | null> {
  const { rows } = await db.query<CaseWithContext>(`${CASE_SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ?? null;
}

export interface CreateCaseInput {
  customerId: string;
  invoiceId?: string | null;
  orderId?: string | null;
  serviceId?: string | null;
  domainId?: string | null;
  subscriptionId?: string | null;
  assignedStaffId?: string | null;
  priority?: CasePriority;
  riskLevel?: RiskLevel;
  riskScore?: number;
  riskReasons?: string[];
  source?: string;
  currency?: string;
  amountAtRisk?: string;
  amountOutstanding?: string;
  createdBy?: string | null;
  nextFollowUpAt?: Date | null;
}

/**
 * Inserts a case. For invoice-linked cases the partial unique index
 * rg_cases_open_invoice_unique_idx makes this idempotent: a concurrent/duplicate insert for the
 * same open invoice conflicts and returns null (created = false), never a second case.
 */
export async function insertCase(db: Queryable, input: CreateCaseInput): Promise<RecoveryCaseRow | null> {
  const { rows } = await db.query<RecoveryCaseRow>(
    `INSERT INTO revenue_guardian_recovery_cases (
       id, customer_id, invoice_id, order_id, service_id, domain_id, subscription_id,
       assigned_staff_id, priority, risk_level, risk_score, risk_reasons, source, currency,
       amount_at_risk, amount_outstanding, created_by, next_follow_up_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (invoice_id) WHERE invoice_id IS NOT NULL AND closed_at IS NULL DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      input.customerId,
      input.invoiceId ?? null,
      input.orderId ?? null,
      input.serviceId ?? null,
      input.domainId ?? null,
      input.subscriptionId ?? null,
      input.assignedStaffId ?? null,
      input.priority ?? 'normal',
      input.riskLevel ?? 'medium',
      input.riskScore ?? 0,
      JSON.stringify(input.riskReasons ?? []),
      input.source ?? 'manual',
      (input.currency ?? 'USD').toUpperCase(),
      input.amountAtRisk ?? '0.00',
      input.amountOutstanding ?? input.amountAtRisk ?? '0.00',
      input.createdBy ?? null,
      input.nextFollowUpAt ?? null,
    ]
  );
  return rows[0] ?? null;
}

export interface UpdateCaseFields {
  status?: CaseStatus;
  priority?: CasePriority;
  riskLevel?: RiskLevel;
  riskScore?: number;
  riskReasons?: string[];
  escalationLevel?: number;
  assignedStaffId?: string | null;
  amountOutstanding?: string;
  amountRecovered?: string;
  disputeReason?: string | null;
  lastContactAt?: Date | null;
  nextFollowUpAt?: Date | null;
  closedAt?: Date | null;
  closedReason?: string | null;
}

export async function updateCase(db: Queryable, id: string, fields: UpdateCaseFields): Promise<RecoveryCaseRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  const push = (value: unknown): number => {
    params.push(value);
    return params.length;
  };
  if (fields.status !== undefined) sets.push(`status = $${push(fields.status)}`);
  if (fields.priority !== undefined) sets.push(`priority = $${push(fields.priority)}`);
  if (fields.riskLevel !== undefined) sets.push(`risk_level = $${push(fields.riskLevel)}`);
  if (fields.riskScore !== undefined) sets.push(`risk_score = $${push(fields.riskScore)}`);
  if (fields.riskReasons !== undefined) sets.push(`risk_reasons = $${push(JSON.stringify(fields.riskReasons))}::jsonb`);
  if (fields.escalationLevel !== undefined) sets.push(`escalation_level = $${push(fields.escalationLevel)}`);
  if (fields.assignedStaffId !== undefined) sets.push(`assigned_staff_id = $${push(fields.assignedStaffId)}`);
  if (fields.amountOutstanding !== undefined) sets.push(`amount_outstanding = $${push(fields.amountOutstanding)}`);
  if (fields.amountRecovered !== undefined) sets.push(`amount_recovered = $${push(fields.amountRecovered)}`);
  if (fields.disputeReason !== undefined) sets.push(`dispute_reason = $${push(fields.disputeReason)}`);
  if (fields.lastContactAt !== undefined) sets.push(`last_contact_at = $${push(fields.lastContactAt)}`);
  if (fields.nextFollowUpAt !== undefined) sets.push(`next_follow_up_at = $${push(fields.nextFollowUpAt)}`);
  if (fields.closedAt !== undefined) sets.push(`closed_at = $${push(fields.closedAt)}`);
  if (fields.closedReason !== undefined) sets.push(`closed_reason = $${push(fields.closedReason)}`);

  const { rows } = await db.query<RecoveryCaseRow>(
    `UPDATE revenue_guardian_recovery_cases SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

/** Open (not closed) case for an invoice, if any — used by payment reconciliation. */
export async function findOpenCaseByInvoice(db: Queryable, invoiceId: string): Promise<RecoveryCaseRow | null> {
  const { rows } = await db.query<RecoveryCaseRow>(
    `SELECT * FROM revenue_guardian_recovery_cases WHERE invoice_id = $1 AND closed_at IS NULL LIMIT 1`,
    [invoiceId]
  );
  return rows[0] ?? null;
}

/** All open invoice-linked cases — walked by the reconciliation job. */
export async function listOpenInvoiceCases(db: Queryable, limit = 500): Promise<RecoveryCaseRow[]> {
  const { rows } = await db.query<RecoveryCaseRow>(
    `SELECT * FROM revenue_guardian_recovery_cases
      WHERE invoice_id IS NOT NULL AND closed_at IS NULL
      ORDER BY opened_at ASC LIMIT $1`,
    [limit]
  );
  return rows;
}
