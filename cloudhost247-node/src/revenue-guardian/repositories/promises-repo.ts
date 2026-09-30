/**
 * Payment-promise data access (spec §10, §36). Fulfillment state is written ONLY by
 * promise-service.ts after comparing against billing_ledger payments — never directly by a
 * route handler.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { Paginated, PaymentPromiseRow, PromiseStatus } from '../types';
import { staffScopeClause } from './cases-repo';

export interface PromiseWithContext extends PaymentPromiseRow {
  customer_email: string;
  customer_name: string;
  invoice_number: string;
  invoice_status: string;
  invoice_total: string;
  assigned_staff_email: string | null;
  assigned_staff_name: string | null;
  case_number: string | null;
  is_due_today: boolean;
  is_overdue: boolean;
}

const SELECT = `
  SELECT p.*,
         u.email AS customer_email, u.full_name AS customer_name,
         i.invoice_number, i.status AS invoice_status, i.total_amount::text AS invoice_total,
         s.email AS assigned_staff_email, s.full_name AS assigned_staff_name,
         c.case_number,
         (p.status = 'pending' AND p.promised_date = CURRENT_DATE) AS is_due_today,
         (p.status = 'pending' AND p.promised_date < CURRENT_DATE) AS is_overdue
    FROM revenue_guardian_payment_promises p
    JOIN users u ON u.id = p.customer_id
    JOIN invoices i ON i.id = p.invoice_id
    LEFT JOIN users s ON s.id = p.assigned_staff_id
    LEFT JOIN revenue_guardian_recovery_cases c ON c.id = p.case_id
`;

export interface ListPromisesFilters {
  page?: number;
  limit?: number;
  status?: PromiseStatus | 'due_today' | 'overdue';
  customerId?: string;
  caseId?: string;
  invoiceId?: string;
  assignedStaffId?: string;
  scopeStaffId?: string | null;
}

export async function listPromises(db: Queryable, filters: ListPromisesFilters): Promise<Paginated<PromiseWithContext>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };

  if (filters.status === 'due_today') {
    where.push(`p.status = 'pending' AND p.promised_date = CURRENT_DATE`);
  } else if (filters.status === 'overdue') {
    where.push(`p.status = 'pending' AND p.promised_date < CURRENT_DATE`);
  } else if (filters.status) {
    where.push(`p.status = $${push(filters.status)}`);
  }
  if (filters.customerId) where.push(`p.customer_id = $${push(filters.customerId)}`);
  if (filters.caseId) where.push(`p.case_id = $${push(filters.caseId)}`);
  if (filters.invoiceId) where.push(`p.invoice_id = $${push(filters.invoiceId)}`);
  if (filters.assignedStaffId) where.push(`p.assigned_staff_id = $${push(filters.assignedStaffId)}`);
  if (filters.scopeStaffId) {
    where.push(staffScopeClause('p.customer_id', 'p.assigned_staff_id', push(filters.scopeStaffId)));
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM revenue_guardian_payment_promises p ${whereSql}`,
    params
  );
  const { rows } = await db.query<PromiseWithContext>(
    `${SELECT} ${whereSql} ORDER BY p.promised_date ASC, p.created_at DESC
      LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}

export async function findPromiseById(db: Queryable, id: string): Promise<PromiseWithContext | null> {
  const { rows } = await db.query<PromiseWithContext>(`${SELECT} WHERE p.id = $1`, [id]);
  return rows[0] ?? null;
}

export interface CreatePromiseInput {
  customerId: string;
  invoiceId: string;
  caseId?: string | null;
  promisedAmount: string;
  currency: string;
  promisedDate: string;
  assignedStaffId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
}

export async function insertPromise(db: Queryable, input: CreatePromiseInput): Promise<PaymentPromiseRow> {
  const { rows } = await db.query<PaymentPromiseRow>(
    `INSERT INTO revenue_guardian_payment_promises (
       id, customer_id, invoice_id, case_id, promised_amount, currency, promised_date,
       assigned_staff_id, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      randomUUID(),
      input.customerId,
      input.invoiceId,
      input.caseId ?? null,
      input.promisedAmount,
      input.currency.toUpperCase(),
      input.promisedDate,
      input.assignedStaffId ?? null,
      input.notes ?? null,
      input.createdBy ?? null,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to insert payment promise');
  return row;
}

export interface UpdatePromiseFields {
  status?: PromiseStatus;
  fulfilledAmount?: string;
  fulfilledAt?: Date | null;
  brokenAt?: Date | null;
  paymentReference?: string | null;
  assignedStaffId?: string | null;
  notes?: string | null;
}

export async function updatePromise(db: Queryable, id: string, fields: UpdatePromiseFields): Promise<PaymentPromiseRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (fields.status !== undefined) sets.push(`status = $${push(fields.status)}`);
  if (fields.fulfilledAmount !== undefined) sets.push(`fulfilled_amount = $${push(fields.fulfilledAmount)}`);
  if (fields.fulfilledAt !== undefined) sets.push(`fulfilled_at = $${push(fields.fulfilledAt)}`);
  if (fields.brokenAt !== undefined) sets.push(`broken_at = $${push(fields.brokenAt)}`);
  if (fields.paymentReference !== undefined) sets.push(`payment_reference = $${push(fields.paymentReference)}`);
  if (fields.assignedStaffId !== undefined) sets.push(`assigned_staff_id = $${push(fields.assignedStaffId)}`);
  if (fields.notes !== undefined) sets.push(`notes = $${push(fields.notes)}`);
  const { rows } = await db.query<PaymentPromiseRow>(
    `UPDATE revenue_guardian_payment_promises SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ?? null;
}

/** Pending promises whose date has arrived/passed — feed for the promise automation job. */
export async function listDuePromises(db: Queryable, limit = 500): Promise<PaymentPromiseRow[]> {
  const { rows } = await db.query<PaymentPromiseRow>(
    `SELECT * FROM revenue_guardian_payment_promises
      WHERE status = 'pending' AND promised_date <= CURRENT_DATE
      ORDER BY promised_date ASC LIMIT $1`,
    [limit]
  );
  return rows;
}
