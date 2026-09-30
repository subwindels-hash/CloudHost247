/**
 * Customer ↔ staff assignment data access (spec §5–§6, §37). Reassignment never rewrites
 * history: the active row is ended (ended_at/ended_by) and a fresh row inserted, so ownership
 * history is complete and auditable.
 */
import { randomUUID } from 'node:crypto';
import type { Queryable } from '../../db/types';
import type { AssignmentRow, AssignmentType, Paginated } from '../types';

export interface AssignmentWithContext extends AssignmentRow {
  customer_email: string;
  customer_name: string;
  staff_email: string;
  staff_name: string;
  assigned_by_email: string | null;
}

const SELECT = `
  SELECT a.*,
         cu.email AS customer_email, cu.full_name AS customer_name,
         su.email AS staff_email, su.full_name AS staff_name,
         ab.email AS assigned_by_email
    FROM revenue_guardian_assignments a
    JOIN users cu ON cu.id = a.customer_id
    JOIN users su ON su.id = a.staff_user_id
    LEFT JOIN users ab ON ab.id = a.assigned_by
`;

export interface ListAssignmentsFilters {
  page?: number;
  limit?: number;
  customerId?: string;
  staffUserId?: string;
  assignmentType?: AssignmentType;
  includeEnded?: boolean;
}

export async function listAssignments(db: Queryable, filters: ListAssignmentsFilters): Promise<Paginated<AssignmentWithContext>> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 25));
  const where: string[] = [];
  const params: unknown[] = [];
  const push = (v: unknown): number => {
    params.push(v);
    return params.length;
  };
  if (!filters.includeEnded) where.push('a.ended_at IS NULL');
  if (filters.customerId) where.push(`a.customer_id = $${push(filters.customerId)}`);
  if (filters.staffUserId) where.push(`a.staff_user_id = $${push(filters.staffUserId)}`);
  if (filters.assignmentType) where.push(`a.assignment_type = $${push(filters.assignmentType)}`);

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const countResult = await db.query<{ total: string }>(
    `SELECT count(*)::text AS total FROM revenue_guardian_assignments a ${whereSql}`,
    params
  );
  const { rows } = await db.query<AssignmentWithContext>(
    `${SELECT} ${whereSql} ORDER BY a.assigned_at DESC LIMIT $${push(limit)} OFFSET $${push((page - 1) * limit)}`,
    params
  );
  return { items: rows, total: Number(countResult.rows[0]?.total ?? 0), page, limit };
}

export async function findActiveAssignment(
  db: Queryable,
  customerId: string,
  assignmentType: AssignmentType
): Promise<AssignmentRow | null> {
  const { rows } = await db.query<AssignmentRow>(
    `SELECT * FROM revenue_guardian_assignments
      WHERE customer_id = $1 AND assignment_type = $2 AND ended_at IS NULL`,
    [customerId, assignmentType]
  );
  return rows[0] ?? null;
}

export async function listActiveAssignmentsForCustomer(db: Queryable, customerId: string): Promise<AssignmentWithContext[]> {
  const { rows } = await db.query<AssignmentWithContext>(
    `${SELECT} WHERE a.customer_id = $1 AND a.ended_at IS NULL ORDER BY a.assignment_type ASC`,
    [customerId]
  );
  return rows;
}

export interface CreateAssignmentInput {
  customerId: string;
  staffUserId: string;
  assignmentType: AssignmentType;
  isPrimary?: boolean;
  assignedBy?: string | null;
  reason?: string | null;
  source?: string;
}

export async function insertAssignment(db: Queryable, input: CreateAssignmentInput): Promise<AssignmentRow | null> {
  const { rows } = await db.query<AssignmentRow>(
    `INSERT INTO revenue_guardian_assignments (
       id, customer_id, staff_user_id, assignment_type, is_primary, assigned_by, reason, source
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (customer_id, assignment_type) WHERE ended_at IS NULL DO NOTHING
     RETURNING *`,
    [
      randomUUID(),
      input.customerId,
      input.staffUserId,
      input.assignmentType,
      input.isPrimary ?? input.assignmentType === 'account_manager',
      input.assignedBy ?? null,
      input.reason ?? null,
      input.source ?? 'manual',
    ]
  );
  return rows[0] ?? null;
}

export async function endAssignment(
  db: Queryable,
  id: string,
  endedBy: string | null,
  reason: string | null
): Promise<AssignmentRow | null> {
  const { rows } = await db.query<AssignmentRow>(
    `UPDATE revenue_guardian_assignments
        SET ended_at = now(), ended_by = $2,
            reason = COALESCE($3, reason),
            updated_at = now()
      WHERE id = $1 AND ended_at IS NULL
      RETURNING *`,
    [id, endedBy, reason]
  );
  return rows[0] ?? null;
}
