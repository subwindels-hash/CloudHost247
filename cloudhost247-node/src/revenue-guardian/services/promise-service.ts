/**
 * Payment promises (spec §10, §36, §52).
 *
 * A promise is a recorded commitment; its outcome is decided EXCLUSIVELY by the billing ledger:
 * reconcilePromise() compares 'payment' ledger entries recorded on the invoice since the promise
 * was created against the promised amount. There is no endpoint that lets a staff member mark a
 * promise fulfilled directly.
 */
import type { Queryable } from '../../db/types';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { fromCents, toCents } from '../../lib/money';
import type { PaymentPromiseRow } from '../types';
import {
  findPromiseById,
  insertPromise,
  updatePromise,
  type CreatePromiseInput,
  type PromiseWithContext,
} from '../repositories/promises-repo';
import { getInvoiceFinancials, getPaymentsSince } from '../repositories/billing-facts';
import { recordActivity } from '../repositories/automation-repo';
import { updateCase, findOpenCaseByInvoice } from '../repositories/cases-repo';
import type { Actor } from './case-service';
import { toIsoDateString } from '../utils/dates';

export async function createPaymentPromise(
  db: Queryable,
  input: Omit<CreatePromiseInput, 'currency'>,
  actor: Actor
): Promise<PaymentPromiseRow> {
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
    throw new ValidationError('A payment promise can only be recorded against an unpaid invoice');
  }
  const promisedCents = toCents(input.promisedAmount);
  if (promisedCents <= 0) throw new ValidationError('Promised amount must be positive');
  if (promisedCents > invoice.outstandingCents) {
    throw new ValidationError(
      `Promised amount exceeds the invoice's outstanding balance of ${fromCents(invoice.outstandingCents)} ${invoice.currency}`
    );
  }
  const promisedDate = new Date(`${input.promisedDate}T00:00:00Z`);
  if (Number.isNaN(promisedDate.getTime())) throw new ValidationError('Invalid promised date');

  const row = await insertPromise(db, { ...input, currency: invoice.currency, createdBy: actor.userId });

  // Reflect the commitment on the linked/open case.
  const openCase = input.caseId
    ? null
    : await findOpenCaseByInvoice(db, input.invoiceId);
  const caseId = input.caseId ?? openCase?.id ?? null;
  if (caseId) {
    await updateCase(db, caseId, { status: undefined, nextFollowUpAt: promisedDate });
  }

  await recordActivity(db, {
    customerId: row.customer_id,
    caseId,
    invoiceId: row.invoice_id,
    promiseId: row.id,
    actorId: actor.userId,
    actorType: actor.actorType ?? 'staff',
    eventType: 'promise_created',
    description: `Payment promise recorded: ${row.promised_amount} ${row.currency} by ${toIsoDateString(row.promised_date)}`,
    metadata: { promisedAmount: row.promised_amount, promisedDate: toIsoDateString(row.promised_date) },
  });
  return row;
}

export interface PromiseReconcileResult {
  promise: PaymentPromiseRow;
  changed: boolean;
}

/**
 * Ledger-driven promise resolution:
 *  - payments since creation ≥ promised amount → fulfilled;
 *  - past the promised date with partial payment → partially_fulfilled... then broken when
 *    nothing further arrives? No: partial by the deadline = partially_fulfilled (kept, honest),
 *    zero by the deadline = broken. Before the deadline nothing changes except full fulfillment.
 */
export async function reconcilePromise(db: Queryable, promise: PaymentPromiseRow, now = new Date()): Promise<PromiseReconcileResult> {
  if (promise.status !== 'pending') return { promise, changed: false };
  const paidCents = await getPaymentsSince(db, promise.invoice_id, new Date(promise.created_at));
  const promisedCents = toCents(promise.promised_amount);
  const promiseDeadline = new Date(`${toIsoDateString(promise.promised_date)}T23:59:59Z`);

  if (paidCents >= promisedCents) {
    const updated = await updatePromise(db, promise.id, {
      status: 'fulfilled',
      fulfilledAmount: fromCents(paidCents),
      fulfilledAt: now,
    });
    if (updated) {
      await recordActivity(db, {
        customerId: promise.customer_id,
        caseId: promise.case_id,
        invoiceId: promise.invoice_id,
        promiseId: promise.id,
        actorType: 'system',
        eventType: 'promise_fulfilled',
        description: `Payment promise fulfilled: ${fromCents(paidCents)} ${promise.currency} received (ledger-confirmed)`,
        metadata: { promisedAmount: promise.promised_amount, paidAmount: fromCents(paidCents) },
      });
    }
    return { promise: updated ?? promise, changed: true };
  }

  if (now > promiseDeadline) {
    const isPartial = paidCents > 0;
    const updated = await updatePromise(db, promise.id, {
      status: isPartial ? 'partially_fulfilled' : 'broken',
      fulfilledAmount: fromCents(paidCents),
      brokenAt: isPartial ? null : now,
    });
    if (updated) {
      await recordActivity(db, {
        customerId: promise.customer_id,
        caseId: promise.case_id,
        invoiceId: promise.invoice_id,
        promiseId: promise.id,
        actorType: 'system',
        eventType: isPartial ? 'promise_partially_fulfilled' : 'promise_broken',
        description: isPartial
          ? `Payment promise partially fulfilled: ${fromCents(paidCents)} of ${promise.promised_amount} ${promise.currency}`
          : `Payment promise broken: no ledger payment by ${toIsoDateString(promise.promised_date)}`,
        metadata: { promisedAmount: promise.promised_amount, paidAmount: fromCents(paidCents) },
      });
    }
    return { promise: updated ?? promise, changed: true };
  }

  return { promise, changed: false };
}

/** Staff may cancel a pending promise (with note) — never mark it fulfilled. */
export async function cancelPromise(db: Queryable, promiseId: string, reason: string, actor: Actor): Promise<PromiseWithContext> {
  const promise = await findPromiseById(db, promiseId);
  if (!promise) throw new NotFoundError('Payment promise not found');
  if (promise.status !== 'pending') {
    throw new ValidationError(`Only pending promises can be cancelled (current: ${promise.status})`);
  }
  if (!reason.trim()) throw new ValidationError('A cancellation reason is required');
  await updatePromise(db, promiseId, { status: 'cancelled', notes: `${promise.notes ? `${promise.notes}\n` : ''}Cancelled: ${reason.trim()}` });
  await recordActivity(db, {
    customerId: promise.customer_id,
    caseId: promise.case_id,
    invoiceId: promise.invoice_id,
    promiseId: promise.id,
    actorId: actor.userId,
    actorType: 'staff',
    eventType: 'promise_cancelled',
    description: `Payment promise cancelled: ${reason.trim()}`,
  });
  const updated = await findPromiseById(db, promiseId);
  if (!updated) throw new NotFoundError('Payment promise not found');
  return updated;
}
