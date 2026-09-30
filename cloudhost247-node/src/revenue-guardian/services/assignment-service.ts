/**
 * Customer ↔ staff assignment (spec §5–§6). Manual assignment/reassignment plus database-stored
 * automatic rules (rules/rule-schemas.ts). Every ownership change lands in the module activity
 * log AND the platform audit log with previous owner, new owner, actor, and reason (spec §6).
 */
import type { Queryable } from '../../db/types';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { recordAudit } from '../../lib/audit';
import type { AssignmentRow, AssignmentType } from '../types';
import {
  endAssignment,
  findActiveAssignment,
  insertAssignment,
} from '../repositories/assignments-repo';
import { listAssignmentRules } from '../repositories/automation-repo';
import { recordActivity } from '../repositories/automation-repo';
import { getCustomerFinancialProfile } from '../repositories/billing-facts';
import { assignmentConditionsSchema, matchesAssignmentConditions } from '../rules/rule-schemas';
import { fromCents } from '../../lib/money';
import type { Actor } from './case-service';

export async function assignCustomer(
  db: Queryable,
  input: {
    customerId: string;
    staffUserId: string;
    assignmentType: AssignmentType;
    reason?: string | null;
    source?: string;
  },
  actor: Actor
): Promise<AssignmentRow> {
  const staff = await db.query<{ id: string; role: string; status: string }>(
    `SELECT id, role, status FROM users WHERE id = $1`,
    [input.staffUserId]
  );
  if (!staff.rows[0] || !['staff', 'admin', 'super_admin'].includes(staff.rows[0].role)) {
    throw new ValidationError('Assignee must be an active staff account');
  }
  if (staff.rows[0].status !== 'active') throw new ValidationError('Assignee account is not active');
  const customer = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [input.customerId]);
  if (!customer.rows[0]) throw new NotFoundError('Customer not found');

  const previous = await findActiveAssignment(db, input.customerId, input.assignmentType);
  if (previous && previous.staff_user_id === input.staffUserId) return previous; // idempotent

  if (previous) {
    await endAssignment(db, previous.id, actor.userId, input.reason ?? 'Reassigned');
  }
  const created = await insertAssignment(db, {
    customerId: input.customerId,
    staffUserId: input.staffUserId,
    assignmentType: input.assignmentType,
    assignedBy: actor.userId,
    reason: input.reason ?? null,
    source: input.source ?? 'manual',
  });
  if (!created) {
    // Concurrent assignment won the unique index — surface the winner.
    const winner = await findActiveAssignment(db, input.customerId, input.assignmentType);
    if (winner) return winner;
    throw new ValidationError('Assignment could not be created');
  }

  await recordActivity(db, {
    customerId: input.customerId,
    actorId: actor.userId,
    actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
    eventType: 'assignment_changed',
    description: previous
      ? `${input.assignmentType} reassigned`
      : `${input.assignmentType} assigned`,
    metadata: {
      assignmentType: input.assignmentType,
      previousStaffId: previous?.staff_user_id ?? null,
      newStaffId: input.staffUserId,
      reason: input.reason ?? null,
      source: input.source ?? 'manual',
    },
  });
  if (actor.userId) {
    await recordAudit(
      db,
      {
        actorId: actor.userId,
        action: 'revenue_guardian.assignment_changed',
        resourceType: 'rg_assignment',
        resourceId: created.id,
        metadata: {
          customerId: input.customerId,
          assignmentType: input.assignmentType,
          previousStaffId: previous?.staff_user_id ?? null,
          newStaffId: input.staffUserId,
          reason: input.reason ?? null,
        },
      },
      actor.audit ?? {}
    );
  }
  return created;
}

export async function unassignCustomer(
  db: Queryable,
  assignmentId: string,
  reason: string,
  actor: Actor
): Promise<AssignmentRow> {
  if (!reason.trim()) throw new ValidationError('A reason is required to end an assignment');
  const ended = await endAssignment(db, assignmentId, actor.userId, reason.trim());
  if (!ended) throw new NotFoundError('Active assignment not found');
  await recordActivity(db, {
    customerId: ended.customer_id,
    actorId: actor.userId,
    actorType: 'staff',
    eventType: 'assignment_ended',
    description: `${ended.assignment_type} assignment ended: ${reason.trim()}`,
    metadata: { staffId: ended.staff_user_id, reason: reason.trim() },
  });
  return ended;
}

export interface AssignmentRuleRunResult {
  evaluated: number;
  assigned: number;
  skipped: number;
  invalidRules: string[];
}

/**
 * Applies enabled assignment rules (priority order) to customers with no active assignment of
 * the rule's type. Deterministic and idempotent: the active-assignment unique index prevents
 * double assignment; re-running produces no change.
 */
export async function applyAssignmentRules(db: Queryable, limit = 200): Promise<AssignmentRuleRunResult> {
  const rules = await listAssignmentRules(db, true);
  const result: AssignmentRuleRunResult = { evaluated: 0, assigned: 0, skipped: 0, invalidRules: [] };
  if (rules.length === 0) return result;

  const { rows: customers } = await db.query<{ id: string; country: string | null; status: string }>(
    `SELECT u.id, u.country, u.status FROM users u
      WHERE u.role = 'customer'
      ORDER BY u.created_at DESC LIMIT $1`,
    [limit]
  );

  for (const customer of customers) {
    result.evaluated += 1;
    const profile = await getCustomerFinancialProfile(db, customer.id);
    for (const rule of rules) {
      const parsed = assignmentConditionsSchema.safeParse(rule.conditions_json);
      if (!parsed.success) {
        if (!result.invalidRules.includes(rule.id)) result.invalidRules.push(rule.id);
        continue;
      }
      const existing = await findActiveAssignment(db, customer.id, rule.assignment_type as AssignmentType);
      if (existing) {
        continue; // rules never override an existing owner (spec §5 'existing assignment')
      }
      const matches = matchesAssignmentConditions(
        {
          country: customer.country,
          currency: profile.currency,
          isNewCustomer: profile.isNewCustomer,
          recurringRevenue: Number(fromCents(profile.recurringRevenueCents)),
          lifetimeRevenue: Number(fromCents(profile.totalPaidCents)),
          activeServices: profile.activeServiceCount,
          accountStatus: customer.status,
          hasActiveAssignment: false,
        },
        parsed.data
      );
      if (!matches) continue;

      const created = await insertAssignment(db, {
        customerId: customer.id,
        staffUserId: rule.staff_user_id,
        assignmentType: rule.assignment_type as AssignmentType,
        assignedBy: null,
        reason: `Automatic rule: ${rule.name}`,
        source: `rule:${rule.id}`,
      });
      if (created) {
        result.assigned += 1;
        await recordActivity(db, {
          customerId: customer.id,
          actorType: 'system',
          eventType: 'assignment_changed',
          description: `${rule.assignment_type} assigned by rule "${rule.name}"`,
          metadata: { ruleId: rule.id, newStaffId: rule.staff_user_id },
        });
        break; // first matching rule per assignment type wins for this pass
      }
      result.skipped += 1;
    }
  }
  return result;
}
