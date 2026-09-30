/**
 * Follow-up task data access (spec §9, §35). "overdue" is derived (pending + past scheduled_at)
 * so it can never go stale. Automation-created rows carry a deterministic dedupe_key enforced
 * unique by the database (spec §50).
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { CasePriority, FollowUpChannel, FollowUpRow, FollowUpStatus, FollowUpType, Paginated } from '../types';
import { staffScopeClause } from './cases-repo';

export interface FollowUpWithContext extends FollowUpRow {
  customer_email: string;
  customer_name: string;
  assigned_staff_email: string | null;
  assigned_staff_name: string | null;
  case_number: string | null;
  invoice_number: string | null;
  is_overdue: boolean;
}

export interface ListFollowUpsFilters {
  page?: number;
  limit?: number;
  status?: FollowUpStatus | 'overdue' | 'due_today';
  type?: FollowUpType;
  customerId?: string;
  caseId?: string;
  assignedStaffId?: string;
  scopeStaffId?: string | null;
  dateFrom?: string;
  dateTo?: string;
}

const SELECT = `
  SELECT f.*,
         u.email AS customer_email, u.full_name AS customer_name,
         s.email AS assigned_staff_email, s.full_name AS assigned_staff_name,
         c.case_number, i.invoice_number,
         (f.status IN ('pending', 'snoozed') AND COALESCE(f.snoozed_until, f.scheduled_at) < now()) AS is_overdue
    FROM revenue_guardian_follow_ups f
    JOIN users u ON u.id = f.customer_id
    LEFT JOIN users s ON s.id = f.assigned_staff_id
    LEFT JOIN revenue_guardian_recovery_cases c ON c.id = f.case_id
    LEFT JOIN invoices i ON i.id = f.invoice_id
`;

export async function listFollowUps(db: Queryable, filters: ListFollowUpsFilters): Promise<Paginated<FollowUpWithContext>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };

  if (filters.status === 'overdue') {
    where.push(`f.status IN ('pending', 'snoozed') AND COALESCE(f.snoozed_until, f.scheduled_at) < now()`);
  } else if (filters.status === 'due_today') {
    where.push(`f.status IN ('pending', 'snoozed') AND COALESCE(f.snoozed_until, f.scheduled_at)::date = CURRENT_DATE`);
  } else if (filters.status) {
    where.push(`f.status = $${push(filters.status)}`);
  }
  if (filters.type) where.push(`f.type = $${push(filters.type)}`);
  if (filters.customerId) where.push(`f.customer_id = $${push(filters.customerId)}`);
  if (filters.caseId) where.push(`f.case_id = $${push(filters.caseId)}`);
  if (filters.assignedStaffId) where.push(`f.assigned_staff_id = $${push(filters.assignedStaffId)}`);
  if (filters.dateFrom) where.push(`f.scheduled_at >= $${push(filters.dateFrom)}`);
  if (filters.dateTo) where.push(`f.scheduled_at <= $${push(filters.dateTo)}`);
  if (filters.scopeStaffId) {
    where.push(staffScopeClause('f.customer_id', 'f.assigned_staff_id', push(filters.scopeStaffId)));
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM revenue_guardian_follow_ups f ${whereSql}`,
    params
  );
  const { rows } = await db.query<FollowUpWithContext>(
    `${SELECT} ${whereSql} ORDER BY f.scheduled_at ASC LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}

export async function findFollowUpById(db: Queryable, id: string): Promise<FollowUpWithContext | null> {
  const { rows } = await db.query<FollowUpWithContext>(`${SELECT} WHERE f.id = $1`, [id]);
  return rows[0] ?? null;
}

export interface CreateFollowUpInput {
  caseId?: string | null;
  customerId: string;
  invoiceId?: string | null;
  serviceId?: string | null;
  assignedStaffId?: string | null;
  type: FollowUpType;
  priority?: CasePriority;
  channel?: FollowUpChannel;
  scheduledAt: Date;
  notes?: string | null;
  dedupeKey?: string | null;
  createdBy?: string | null;
}

/** Returns null when a dedupe_key conflict means the follow-up already exists (idempotent). */
export async function insertFollowUp(db: Queryable, input: CreateFollowUpInput): Promise<FollowUpRow | null> {
  const { rows } = await db.query<FollowUpRow>(
    `INSERT INTO revenue_guardian_follow_ups (
       id, case_id, customer_id, invoice_id, service_id, assigned_staff_id, type, priority,
       channel, scheduled_at, notes, dedupe_key, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      input.caseId ?? null,
      input.customerId,
      input.invoiceId ?? null,
      input.serviceId ?? null,
      input.assignedStaffId ?? null,
      input.type,
      input.priority ?? 'normal',
      input.channel ?? 'email',
      input.scheduledAt,
      input.notes ?? null,
      input.dedupeKey ?? null,
      input.createdBy ?? null,
    ]
  );
  return rows[0] ?? null;
}

export interface UpdateFollowUpFields {
  status?: FollowUpStatus;
  priority?: CasePriority;
  assignedStaffId?: string | null;
  scheduledAt?: Date;
  snoozedUntil?: Date | null;
  completedAt?: Date | null;
  outcome?: string | null;
  notes?: string | null;
}

export async function updateFollowUp(db: Queryable, id: string, fields: UpdateFollowUpFields): Promise<FollowUpRow | null> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [id];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (fields.status !== undefined) sets.push(`status = $${push(fields.status)}`);
  if (fields.priority !== undefined) sets.push(`priority = $${push(fields.priority)}`);
  if (fields.assignedStaffId !== undefined) sets.push(`assigned_staff_id = $${push(fields.assignedStaffId)}`);
  if (fields.scheduledAt !== undefined) sets.push(`scheduled_at = $${push(fields.scheduledAt)}`);
  if (fields.snoozedUntil !== undefined) sets.push(`snoozed_until = $${push(fields.snoozedUntil)}`);
  if (fields.completedAt !== undefined) sets.push(`completed_at = $${push(fields.completedAt)}`);
  if (fields.outcome !== undefined) sets.push(`outcome = $${push(fields.outcome)}`);
  if (fields.notes !== undefined) sets.push(`notes = $${push(fields.notes)}`);
  const { rows } = await db.query<FollowUpRow>(
    `UPDATE revenue_guardian_follow_ups SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    params
  );
  return rows[0] ?? null;
}
