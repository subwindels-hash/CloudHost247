/**
 * Recovery-case lifecycle (spec §7–§8, §34, §52–§54, §60).
 *
 * Hard guarantees enforced here, server-side, for every caller (routes, jobs, kanban):
 *  - transitions must be valid per rules/transitions.ts;
 *  - 'recovered' / 'partially_recovered' are LEDGER-GUARDED: entered only when billing_ledger
 *    payments actually confirm the money (spec §52) — a staff click alone can never set them;
 *  - 'disputed' requires a dispute reason (spec §53);
 *  - 'written_off' requires the elevated permission (checked by the route) + reason, never
 *    deletes the invoice or payment history (spec §54);
 *  - every change is recorded in the module activity log AND the platform audit log (spec §60).
 */
import type { Queryable } from '../../db/types';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { recordAudit, type AuditContext } from '../../lib/audit';
import { fromCents } from '../../lib/money';
import type { CasePriority, CaseStatus, RecoveryCaseRow } from '../types';
import { isValidTransition, LEDGER_GUARDED_STATUSES, TERMINAL_STATUSES } from '../rules/transitions';
import { assessRisk } from '../rules/risk';
import { findCaseById, findOpenCaseByInvoice, insertCase, updateCase, type CaseWithContext, type CreateCaseInput } from '../repositories/cases-repo';
import { getCustomerFinancialProfile, getInvoiceFinancials, getPaymentsSince } from '../repositories/billing-facts';
import { recordActivity } from '../repositories/automation-repo';
import { getRgSetting } from '../utils/settings';

export interface Actor {
  userId: string | null;
  audit?: AuditContext;
  /** 'system' when a background job acts. */
  actorType?: 'staff' | 'system';
}

/**
 * Creates a case. Validates the invoice really belongs to the customer and is really unpaid —
 * a recovery case can never be fabricated for paid/void work (spec §62, §75).
 */
export async function createRecoveryCase(
  db: Queryable,
  input: CreateCaseInput,
  actor: Actor
): Promise<{ recoveryCase: RecoveryCaseRow; created: boolean }> {
  if (input.invoiceId) {
    const invoice = await getInvoiceFinancials(db, input.invoiceId);
    if (!invoice) throw new NotFoundError('Invoice not found');
    const owner = await db.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM invoices WHERE id = $1`,
      [input.invoiceId]
    );
    if (owner.rows[0]?.user_id !== input.customerId) {
      throw new ValidationError('Invoice does not belong to this customer');
    }
    if (owner.rows[0]?.status !== 'unpaid') {
      throw new ValidationError(`Cannot open a recovery case for an invoice in '${owner.rows[0]?.status}' status`);
    }
    const existing = await findOpenCaseByInvoice(db, input.invoiceId);
    if (existing) return { recoveryCase: existing, created: false };

    input = {
      ...input,
      currency: invoice.currency,
      amountAtRisk: fromCents(invoice.outstandingCents),
      amountOutstanding: fromCents(invoice.outstandingCents),
    };
  }

  // Risk assessed from real stored data at open time (spec §4).
  const thresholds = await getRgSetting(db, 'riskThresholds');
  const profile = await getCustomerFinancialProfile(db, input.customerId);
  const risk = assessRisk(
    {
      maxOverdueDays: profile.maxOverdueDays,
      overdueInvoiceCount: profile.overdueInvoiceCount,
      outstandingCents: profile.outstandingCents,
      failedPaymentCount: profile.failedPaymentCount,
      brokenPromiseCount: profile.brokenPromiseCount,
      hasPastDueSubscription: profile.hasPastDueSubscription,
      hasSuspendedSubscription: profile.hasSuspendedSubscription,
      daysToNextRenewal: profile.daysToNextRenewal,
      recurringRevenueCents: profile.recurringRevenueCents,
    },
    thresholds
  );

  const row = await insertCase(db, {
    ...input,
    riskScore: risk.score,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    createdBy: actor.userId,
  });
  if (!row) {
    // Unique-index conflict from a concurrent create: return the existing open case.
    const existing = input.invoiceId ? await findOpenCaseByInvoice(db, input.invoiceId) : null;
    if (existing) return { recoveryCase: existing, created: false };
    throw new ValidationError('Recovery case could not be created');
  }

  await recordActivity(db, {
    customerId: row.customer_id,
    caseId: row.id,
    invoiceId: row.invoice_id,
    actorId: actor.userId,
    actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
    eventType: 'case_created',
    description: `Recovery case ${row.case_number} opened (source: ${row.source})`,
    metadata: { status: row.status, amountOutstanding: row.amount_outstanding, riskLevel: row.risk_level },
  });
  if (actor.userId) {
    await recordAudit(
      db,
      { actorId: actor.userId, action: 'revenue_guardian.case_created', resourceType: 'rg_recovery_case', resourceId: row.id },
      actor.audit ?? {}
    );
  }
  return { recoveryCase: row, created: true };
}

export interface TransitionOptions {
  reason?: string | null;
  /** Only routes that verified revenue_guardian.write_off may pass true. */
  writeOffPermitted?: boolean;
}

/**
 * Applies a status transition with full validation. Returns the updated case.
 */
export async function transitionCase(
  db: Queryable,
  caseId: string,
  toStatus: CaseStatus,
  actor: Actor,
  options: TransitionOptions = {}
): Promise<RecoveryCaseRow> {
  const current = await findCaseById(db, caseId);
  if (!current) throw new NotFoundError('Recovery case not found');

  if (!isValidTransition(current.status, toStatus)) {
    throw new ValidationError(`Invalid status transition: ${current.status} → ${toStatus}`);
  }
  if (toStatus === 'disputed' && (!options.reason || options.reason.trim().length === 0)) {
    throw new ValidationError('A dispute reason is required');
  }
  if (toStatus === 'written_off') {
    if (!options.writeOffPermitted) {
      throw new ValidationError('Write-off requires the revenue_guardian.write_off permission');
    }
    if (!options.reason || options.reason.trim().length === 0) {
      throw new ValidationError('A write-off reason is required');
    }
  }
  if (toStatus === 'closed' && (!options.reason || options.reason.trim().length === 0)) {
    throw new ValidationError('A closure reason is required');
  }

  const fields: Parameters<typeof updateCase>[2] = { status: toStatus };

  // Ledger guard (spec §52): recovered/partially_recovered must be proven by the ledger.
  if (LEDGER_GUARDED_STATUSES.includes(toStatus)) {
    if (!current.invoice_id) {
      throw new ValidationError('Recovery can only be confirmed for invoice-linked cases');
    }
    const financials = await getInvoiceFinancials(db, current.invoice_id);
    if (!financials) throw new NotFoundError('Linked invoice not found');
    const paidSinceOpen = await getPaymentsSince(db, current.invoice_id, new Date(current.opened_at));
    if (toStatus === 'recovered' && financials.outstandingCents > 0) {
      throw new ValidationError(
        `Cannot mark recovered: invoice still has ${fromCents(financials.outstandingCents)} ${financials.currency} outstanding`
      );
    }
    if (toStatus === 'partially_recovered' && paidSinceOpen <= 0) {
      throw new ValidationError('Cannot mark partially recovered: no payment has been recorded in the ledger since the case opened');
    }
    fields.amountRecovered = fromCents(paidSinceOpen);
    fields.amountOutstanding = fromCents(financials.outstandingCents);
  }

  if (TERMINAL_STATUSES.includes(toStatus)) {
    fields.closedAt = new Date();
    fields.closedReason = options.reason ?? (toStatus === 'recovered' ? 'Invoice fully paid' : null);
  }
  if (toStatus === 'disputed') fields.disputeReason = options.reason ?? null;
  if (toStatus === 'contacted') fields.lastContactAt = new Date();

  const updated = await updateCase(db, caseId, fields);
  if (!updated) throw new NotFoundError('Recovery case not found');

  await recordActivity(db, {
    customerId: updated.customer_id,
    caseId: updated.id,
    invoiceId: updated.invoice_id,
    actorId: actor.userId,
    actorType: actor.actorType ?? (actor.userId ? 'staff' : 'system'),
    eventType: 'status_changed',
    description: `Case ${updated.case_number}: ${current.status} → ${toStatus}${options.reason ? ` (${options.reason})` : ''}`,
    metadata: { from: current.status, to: toStatus, reason: options.reason ?? null },
  });
  if (actor.userId) {
    await recordAudit(
      db,
      {
        actorId: actor.userId,
        action: `revenue_guardian.case_${toStatus}`,
        resourceType: 'rg_recovery_case',
        resourceId: updated.id,
        metadata: { from: current.status, to: toStatus, reason: options.reason ?? null },
      },
      actor.audit ?? {}
    );
  }
  return updated;
}

/**
 * Re-syncs an open invoice-linked case against the ledger (called by payment reconciliation and
 * the automation cycle). Auto-advances to partially_recovered / recovered when payments arrive.
 */
export async function reconcileCaseWithLedger(db: Queryable, recoveryCase: RecoveryCaseRow): Promise<RecoveryCaseRow | null> {
  if (!recoveryCase.invoice_id || recoveryCase.closed_at) return null;
  const financials = await getInvoiceFinancials(db, recoveryCase.invoice_id);
  if (!financials) return null;
  const paidSinceOpen = await getPaymentsSince(db, recoveryCase.invoice_id, new Date(recoveryCase.opened_at));

  const invoiceStatus = await db.query<{ status: string }>(`SELECT status FROM invoices WHERE id = $1`, [
    recoveryCase.invoice_id,
  ]);
  const isPaid = invoiceStatus.rows[0]?.status === 'paid' || financials.outstandingCents === 0;
  const isVoid = invoiceStatus.rows[0]?.status === 'void';

  if (isVoid) {
    // Invoice cancelled by staff — close the case honestly rather than chasing dead revenue.
    const updated = await updateCase(db, recoveryCase.id, {
      status: 'closed',
      closedAt: new Date(),
      closedReason: 'Invoice was voided',
      amountOutstanding: '0.00',
    });
    if (updated) {
      await recordActivity(db, {
        customerId: recoveryCase.customer_id,
        caseId: recoveryCase.id,
        invoiceId: recoveryCase.invoice_id,
        actorType: 'system',
        eventType: 'case_closed',
        description: `Case ${recoveryCase.case_number} closed: invoice voided`,
      });
    }
    return updated;
  }

  if (isPaid && isValidTransition(recoveryCase.status, 'recovered')) {
    const updated = await updateCase(db, recoveryCase.id, {
      status: 'recovered',
      amountRecovered: fromCents(paidSinceOpen),
      amountOutstanding: '0.00',
      closedAt: new Date(),
      closedReason: 'Invoice fully paid (ledger-confirmed)',
    });
    if (updated) {
      await recordActivity(db, {
        customerId: recoveryCase.customer_id,
        caseId: recoveryCase.id,
        invoiceId: recoveryCase.invoice_id,
        actorType: 'system',
        eventType: 'invoice_recovered',
        description: `Case ${recoveryCase.case_number} recovered: invoice fully paid`,
        metadata: { amountRecovered: fromCents(paidSinceOpen) },
      });
    }
    return updated;
  }

  if (!isPaid && paidSinceOpen > 0 && recoveryCase.status !== 'partially_recovered' && isValidTransition(recoveryCase.status, 'partially_recovered')) {
    const updated = await updateCase(db, recoveryCase.id, {
      status: 'partially_recovered',
      amountRecovered: fromCents(paidSinceOpen),
      amountOutstanding: fromCents(financials.outstandingCents),
    });
    if (updated) {
      await recordActivity(db, {
        customerId: recoveryCase.customer_id,
        caseId: recoveryCase.id,
        invoiceId: recoveryCase.invoice_id,
        actorType: 'system',
        eventType: 'partial_recovery',
        description: `Case ${recoveryCase.case_number}: partial payment recorded`,
        metadata: { amountRecovered: fromCents(paidSinceOpen), amountOutstanding: fromCents(financials.outstandingCents) },
      });
    }
    return updated;
  }

  // Keep cached amounts fresh even when the status doesn't move.
  const outstanding = fromCents(financials.outstandingCents);
  if (outstanding !== recoveryCase.amount_outstanding) {
    return updateCase(db, recoveryCase.id, { amountOutstanding: outstanding, amountRecovered: fromCents(paidSinceOpen) });
  }
  return null;
}

/** Updates non-status case fields (assignment, priority, follow-up pointers, notes). */
export async function updateCaseDetails(
  db: Queryable,
  caseId: string,
  fields: {
    assignedStaffId?: string | null;
    priority?: CasePriority;
    nextFollowUpAt?: Date | null;
    lastContactAt?: Date | null;
    escalationLevel?: number;
  },
  actor: Actor
): Promise<CaseWithContext> {
  const current = await findCaseById(db, caseId);
  if (!current) throw new NotFoundError('Recovery case not found');
  await updateCase(db, caseId, fields);

  const changes: string[] = [];
  if (fields.assignedStaffId !== undefined && fields.assignedStaffId !== current.assigned_staff_id) {
    changes.push('assignment changed');
  }
  if (fields.priority !== undefined && fields.priority !== current.priority) changes.push(`priority → ${fields.priority}`);
  if (fields.escalationLevel !== undefined && fields.escalationLevel !== current.escalation_level) {
    changes.push(`escalation level → ${fields.escalationLevel}`);
  }
  if (changes.length > 0) {
    await recordActivity(db, {
      customerId: current.customer_id,
      caseId,
      actorId: actor.userId,
      actorType: actor.actorType ?? 'staff',
      eventType: fields.escalationLevel !== undefined ? 'escalation' : 'case_updated',
      description: `Case ${current.case_number}: ${changes.join(', ')}`,
      metadata: { previousStaff: current.assigned_staff_id, ...fields },
    });
  }
  const updated = await findCaseById(db, caseId);
  if (!updated) throw new NotFoundError('Recovery case not found');
  return updated;
}

/** Adds an internal note to a case (activity-log backed, spec §73). */
export async function addCaseNote(db: Queryable, caseId: string, note: string, actor: Actor): Promise<void> {
  const current = await findCaseById(db, caseId);
  if (!current) throw new NotFoundError('Recovery case not found');
  if (!note.trim()) throw new ValidationError('Note cannot be empty');
  await recordActivity(db, {
    customerId: current.customer_id,
    caseId,
    invoiceId: current.invoice_id,
    actorId: actor.userId,
    actorType: 'staff',
    eventType: 'note_added',
    description: note.trim().slice(0, 4000),
  });
}
