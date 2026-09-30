/**
 * Follow-up tasks (spec §9, §35, §73).
 */
import type { Queryable } from '../../db/types';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { FollowUpRow, FollowUpStatus } from '../types';
import {
  findFollowUpById,
  insertFollowUp,
  updateFollowUp,
  type CreateFollowUpInput,
} from '../repositories/follow-ups-repo';
import { recordActivity } from '../repositories/automation-repo';
import { updateCase } from '../repositories/cases-repo';
import type { Actor } from './case-service';

export async function createFollowUp(db: Queryable, input: CreateFollowUpInput, actor: Actor): Promise<FollowUpRow> {
  const customer = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [input.customerId]);
  if (!customer.rows[0]) throw new NotFoundError('Customer not found');
  const row = await insertFollowUp(db, { ...input, createdBy: actor.userId });
  if (!row) throw new ValidationError('An identical automated follow-up already exists');

  if (input.caseId) {
    await updateCase(db, input.caseId, { nextFollowUpAt: input.scheduledAt });
  }
  await recordActivity(db, {
    customerId: row.customer_id,
    caseId: row.case_id,
    invoiceId: row.invoice_id,
    followUpId: row.id,
    actorId: actor.userId,
    actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
    eventType: 'follow_up_created',
    description: `Follow-up (${row.type}) scheduled for ${new Date(row.scheduled_at).toISOString().slice(0, 10)}`,
    metadata: { type: row.type, channel: row.channel, priority: row.priority },
  });
  return row;
}

const FOLLOW_UP_TRANSITIONS: Record<FollowUpStatus, readonly FollowUpStatus[]> = {
  pending: ['in_progress', 'completed', 'snoozed', 'cancelled'],
  in_progress: ['completed', 'snoozed', 'cancelled', 'pending'],
  snoozed: ['pending', 'in_progress', 'completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export async function changeFollowUp(
  db: Queryable,
  followUpId: string,
  changes: {
    status?: FollowUpStatus;
    snoozedUntil?: Date | null;
    scheduledAt?: Date;
    assignedStaffId?: string | null;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    outcome?: string | null;
    notes?: string | null;
  },
  actor: Actor
): Promise<FollowUpRow> {
  const current = await findFollowUpById(db, followUpId);
  if (!current) throw new NotFoundError('Follow-up not found');

  if (changes.status && changes.status !== current.status) {
    if (!FOLLOW_UP_TRANSITIONS[current.status]?.includes(changes.status)) {
      throw new ValidationError(`Invalid follow-up transition: ${current.status} → ${changes.status}`);
    }
    if (changes.status === 'snoozed' && !changes.snoozedUntil) {
      throw new ValidationError('Snoozing requires a snoozed-until date');
    }
  }

  const updated = await updateFollowUp(db, followUpId, {
    status: changes.status,
    snoozedUntil: changes.snoozedUntil,
    scheduledAt: changes.scheduledAt,
    assignedStaffId: changes.assignedStaffId,
    priority: changes.priority,
    outcome: changes.outcome,
    notes: changes.notes,
    completedAt: changes.status === 'completed' ? new Date() : undefined,
  });
  if (!updated) throw new NotFoundError('Follow-up not found');

  if (changes.status === 'completed' && current.case_id) {
    // Completing a follow-up is a real customer contact.
    await updateCase(db, current.case_id, { lastContactAt: new Date() });
  }

  if (changes.status && changes.status !== current.status) {
    await recordActivity(db, {
      customerId: updated.customer_id,
      caseId: updated.case_id,
      followUpId: updated.id,
      actorId: actor.userId,
      actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
      eventType: changes.status === 'completed' ? 'follow_up_completed' : 'follow_up_updated',
      description: `Follow-up (${updated.type}): ${current.status} → ${changes.status}${changes.outcome ? ` — ${changes.outcome}` : ''}`,
      metadata: { from: current.status, to: changes.status },
    });
  }
  return updated;
}
