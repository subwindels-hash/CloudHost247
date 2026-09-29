import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { findInvoiceById, setInvoiceStatus } from '../db/invoices';
import { setOrderPaymentStatus } from '../db/orders';
import { recordLedgerEntry } from '../db/billing-ledger';
import {
  cancelOtherPendingPayments,
  createPayment,
  findPaymentById,
  updatePaymentStatus,
  type PaymentRow,
} from '../db/payments';
import { getGateway } from '../payments/gateway-registry';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors';
import { toPaymentDTO, type PaymentDTO } from '../dto/payments';
import { recordAuthEvent } from '../db/users';

/**
 * Phase 5C payment business logic: initiating a payment attempt through a gateway
 * (src/payments/*), and the manual gateway's own resolution path (a staff member directly
 * confirming or rejecting one). Nothing in this file ever marks a `sandbox` (or any future
 * non-manual) payment `successful`/`failed` — the only way a payment reaches a terminal state here
 * is `confirmManualPayment`/`rejectManualPayment`, and both refuse to act on anything but a
 * `provider = 'manual'` payment. Automated confirmation via a verified webhook is Phase 5D's job.
 */

/**
 * Initiates a new payment attempt for one of the caller's own invoices through the named gateway.
 * Requires the invoice to still be `unpaid` — an invoice that is already `paid`/`void`/`refunded`
 * has nothing left to pay. Any other payment attempt for the same invoice still sitting in
 * `pending` is cancelled first, so a customer can always abandon a stale attempt and start a fresh
 * one without staff intervention.
 */
export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function initiatePaymentForInvoice(
  pool: Queryable,
  env: Env,
  userId: string,
  invoiceId: string,
  gatewayId: string,
  genId: () => string,
  audit: AuditContext = {}
): Promise<PaymentDTO> {
  const invoice = await findInvoiceById(pool, invoiceId);
  if (!invoice || invoice.user_id !== userId) {
    // Same "never distinguish doesn't-exist from isn't-yours" rule as every other ownership check
    // in this codebase (src/services/billing-service.ts, src/services/commerce-service.ts).
    throw new NotFoundError('No invoice was found with that id');
  }

  if (invoice.status !== 'unpaid') {
    throw new ValidationError(`Cannot initiate a payment for an invoice with status "${invoice.status}"`);
  }

  const gateway = getGateway(gatewayId, env);
  const paymentId = genId();

  const result = await gateway.initiatePayment(
    {
      paymentId,
      invoiceNumber: invoice.invoice_number,
      amount: invoice.total_amount,
      currency: invoice.currency,
    },
    env
  );

  const payment = await withTransaction(pool, async (tx) => {
    await cancelOtherPendingPayments(tx, invoice.id, paymentId);

    const created = await createPayment(tx, {
      id: paymentId,
      invoiceId: invoice.id,
      userId: invoice.user_id,
      amount: invoice.total_amount,
      currency: invoice.currency,
      provider: gateway.id,
      providerReference: result.providerReference,
      method: result.method,
    });

    await recordAuthEvent(tx, {
      id: genId(),
      userId,
      eventType: 'payment_initiated',
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
      metadata: { paymentId: created.id, invoiceId: invoice.id, gateway: gateway.id },
    });

    return created;
  });

  return { ...toPaymentDTO(payment), instructions: result.instructions ?? null };
}

/** Ownership-checked read of a single payment — same "404, never 403" rule as everywhere else. */
export async function getMyPaymentDetail(pool: Queryable, userId: string, paymentId: string): Promise<PaymentDTO> {
  const payment = await findPaymentById(pool, paymentId);
  if (!payment || payment.user_id !== userId) {
    throw new NotFoundError('No payment was found with that id');
  }
  return toPaymentDTO(payment);
}

async function loadManualPendingPaymentOrThrow(pool: Queryable, paymentId: string): Promise<PaymentRow> {
  const payment = await findPaymentById(pool, paymentId);
  if (!payment) {
    throw new NotFoundError('No payment was found with that id');
  }
  if (payment.provider !== 'manual') {
    throw new ValidationError('Only payments made through the manual/offline gateway can be confirmed or rejected here');
  }
  if (payment.status !== 'pending') {
    // Already resolved. This is a state conflict, not a malformed request, so it is a 409 — the
    // SAME status the in-transaction guard returns when a concurrent request wins the race (see
    // updatePaymentStatus's `expectedCurrentStatus`). Staff tooling therefore sees one
    // deterministic "already processed" response whether the duplicate arrives a millisecond or
    // a day late, instead of a 400/409 coin flip decided by timing.
    throw new ConflictError(`This payment has already been resolved (status "${payment.status}")`);
  }
  return payment;
}

/**
 * A staff member asserting that a manual/offline (e.g. bank transfer) payment was actually
 * received. Atomically: marks the payment `successful` (recording which staff member confirmed
 * it), records the matching `payment` ledger entry, marks the invoice `paid`, and marks the parent
 * order's `payment_status` `paid` — the order's own fulfillment `status` is deliberately left
 * untouched, preserving the Phase 5A/5B separation between order lifecycle and payment status.
 */
export async function confirmManualPayment(
  pool: Queryable,
  actingAdminId: string,
  paymentId: string,
  genId: () => string,
  audit: AuditContext = {}
): Promise<PaymentDTO> {
  const payment = await loadManualPendingPaymentOrThrow(pool, paymentId);

  const updated = await withTransaction(pool, async (tx) => {
    const confirmed = await updatePaymentStatus(tx, payment.id, 'successful', {
      completedAt: new Date().toISOString(),
      confirmedByUserId: actingAdminId,
      // Re-assert inside the transaction what was checked outside it. Without this, two
      // concurrent confirmations of the same payment would both proceed and both append a
      // `payment` ledger entry — recording the invoice as paid twice in an append-only ledger.
      expectedCurrentStatus: 'pending',
    });
    if (!confirmed) {
      // Zero rows updated means a concurrent request won the race and already moved this payment
      // out of `pending`. Respond with a deterministic 409 Conflict — never a success, never a
      // second financial credit, and never a 500. The transaction is abandoned here, so no
      // ledger entry, invoice update or order update from this attempt is ever committed.
      throw new ConflictError('This payment has already been resolved by another request');
    }

    const invoice = await findInvoiceById(tx, payment.invoice_id);
    if (!invoice) throw new NotFoundError('No invoice was found for this payment');

    await recordLedgerEntry(tx, {
      id: genId(),
      userId: invoice.user_id,
      invoiceId: invoice.id,
      entryType: 'payment',
      amount: confirmed.amount,
      currency: confirmed.currency,
      description: `Manual payment confirmed for invoice ${invoice.invoice_number}`,
    });

    await setInvoiceStatus(tx, invoice.id, 'paid');
    await setOrderPaymentStatus(tx, invoice.order_id, 'paid');

    await recordAuthEvent(tx, {
      id: genId(),
      userId: actingAdminId,
      eventType: 'manual_payment_confirmed',
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
      metadata: { paymentId: confirmed.id, invoiceId: invoice.id, targetUserId: invoice.user_id, amount: confirmed.amount, currency: confirmed.currency },
    });

    return confirmed;
  });

  return toPaymentDTO(updated);
}

/**
 * A staff member asserting that a manual/offline payment did *not* arrive (e.g. the expected
 * transfer never came, or was for the wrong amount). Marks the payment `failed` with the given
 * reason — no ledger entry is recorded, since nothing was actually charged; the invoice is left
 * `unpaid` so the customer can initiate a fresh attempt.
 */
export async function rejectManualPayment(
  pool: Queryable,
  actingAdminId: string,
  paymentId: string,
  reason: string,
  genId: () => string,
  audit: AuditContext = {}
): Promise<PaymentDTO> {
  const payment = await loadManualPendingPaymentOrThrow(pool, paymentId);

  const updated = await withTransaction(pool, async (tx) => {
    const rejected = await updatePaymentStatus(tx, payment.id, 'failed', {
      failureReason: reason,
      confirmedByUserId: actingAdminId,
      expectedCurrentStatus: 'pending',
    });
    if (!rejected) {
      throw new ConflictError('This payment has already been resolved by another request');
    }

    await recordAuthEvent(tx, {
      id: genId(),
      userId: actingAdminId,
      eventType: 'manual_payment_rejected',
      ipAddress: audit.ipAddress ?? null,
      userAgent: audit.userAgent ?? null,
      metadata: { paymentId: rejected.id, invoiceId: rejected.invoice_id, targetUserId: rejected.user_id, reason },
    });

    return rejected;
  });

  return toPaymentDTO(updated);
}

