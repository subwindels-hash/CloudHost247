import { queueGa4PurchaseBestEffort } from '../marketing/ga4-purchase-delivery';
import { recordVerifiedPaymentBestEffort } from '../marketing/conversion-service';
import { recordVerifiedTikTokPaymentBestEffort } from '../tiktok/event-service';
import { createHash, randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import type { Queryable } from '../db/types';
import { withTransaction } from '../db/transaction';
import { recordLedgerEntry } from '../db/billing-ledger';
import { setInvoiceStatus, findInvoiceById } from '../db/invoices';
import { setOrderPaymentStatus, findOrderById } from '../db/orders';
import { findPaymentById, updatePaymentStatus, type PaymentRow } from '../db/payments';
import {
  tryInsertWebhookEvent,
  findWebhookEvent,
  tryTakeoverExpiredLease,
  updateWebhookEventStatus,
} from '../db/webhook-events';
import { getWebhookHandler } from '../payments/gateway-registry';
import { NotFoundError, UnauthorizedError, ValidationError, ConflictError } from '../lib/errors';
import { toCents } from '../lib/money';

/**
 * Phase 5 hardening (finding P4-F4): distinguishes TRANSIENT rejections from TERMINAL ones.
 *
 * Transient: the referenced payment/invoice/order doesn't exist yet (a provider can deliver a
 * webhook before the initiating request has committed). The receiver answers 404 and leaves the
 * durable event row in `processing` with its lease: after the 60 s lease expires, a redelivery
 * takes it over and reconciles. Nothing is lost.
 *
 * Terminal: parity mismatches (currency/owner/amount/order-agreement) and settled-state
 * violations can NEVER succeed, no matter how often retried. Their error carries
 * `webhookTerminalRejection`; after the settlement transaction has rolled back, the receiver
 * durably records the rejection (status `rejected` + reason + payment link) in a separate,
 * already-committed write. Redeliveries of the same event id then immediately answer 200 with
 * status `rejected` instead of re-executing — the provider retry storm stops, and the
 * audit-grade reason is preserved, without weakening any invariant.
 */
interface TerminalRejectionInfo { paymentId: string | null }
function markTerminal(err: Error, paymentId: string | null): never {
  (err as Error & { webhookTerminalRejection?: TerminalRejectionInfo }).webhookTerminalRejection = { paymentId };
  throw err;
}
function terminalInfo(err: unknown): TerminalRejectionInfo | null {
  const e = err as Error & { webhookTerminalRejection?: TerminalRejectionInfo };
  return e?.webhookTerminalRejection ?? null;
}

export interface WebhookProcessingResult {
  received: boolean;
  status: 'processed' | 'already_processed' | 'in_progress' | 'ignored' | 'failed' | 'rejected';
  message?: string;
}

export async function processIncomingWebhook(
  pool: Queryable,
  env: Env,
  gatewayId: string,
  rawBody: Buffer,
  headers: Record<string, string | string[] | undefined>,
  idGenerator: () => string = randomUUID
): Promise<WebhookProcessingResult> {
  const handler = getWebhookHandler(gatewayId);
  if (!handler) {
    throw new NotFoundError(`Unknown webhook gateway: ${gatewayId}`);
  }

  // 1. Signature Verification BEFORE parsing JSON or hitting the database
  const isValid = await handler.verifySignature(rawBody, headers, env);
  if (!isValid) {
    throw new UnauthorizedError('Invalid or unverified webhook signature');
  }

  // 2. Hash raw body
  const payloadHash = createHash('sha256').update(rawBody).digest('hex');

  // 3. Parse canonical event
  let event;
  try {
    event = handler.parseEvent(rawBody, headers, payloadHash);
  } catch (err) {
    throw new ValidationError(`Malformed webhook payload: ${(err as Error).message}`);
  }

  // 4. Acquire lease in webhook_events
  const leaseExpiresAt = new Date(Date.now() + 60 * 1000); // 60s lease
  const inserted = await tryInsertWebhookEvent(pool, {
    id: idGenerator(),
    gateway: gatewayId,
    eventId: event.providerEventId,
    transmissionId: event.providerTransmissionId,
    eventType: event.canonicalEventType,
    providerReference: event.providerPaymentReference,
    // Do NOT trust the provider-supplied cloudhostPaymentId into the FK column at insert time:
    // paymentId exists only once the payment row has actually been resolved&verified inside the
    // settlement transaction (linked then via updateWebhookEventStatus), which also keeps
    // genuinely-early deliveries (payment row not committed yet) a clean transient 404 instead
    // of an FK-violation 500 (found by the Phase 5 hardening suite, pre-existing).
    paymentId: null,
    payloadHash,
    leaseExpiresAt,
  });

  if (!inserted) {
    const existing = await findWebhookEvent(pool, gatewayId, event.providerEventId);
    if (!existing) {
      throw new ConflictError('Concurrent webhook event insert conflict');
    }

    if (existing.status === 'completed') {
      return { received: true, status: 'already_processed' };
    }

    if (existing.status === 'processing') {
      // Check if lease is expired (node crash recovery)
      const now = new Date();
      if (new Date(existing.lease_expires_at) <= now) {
        const claimed = await tryTakeoverExpiredLease(pool, gatewayId, event.providerEventId, leaseExpiresAt);
        if (!claimed) {
          return { received: true, status: 'in_progress' };
        }
        // Successfully took over expired lease, proceed to process
      } else {
        return { received: true, status: 'in_progress' };
      }
    } else if (existing.status === 'ignored' || existing.status === 'rejected' || existing.status === 'failed') {
      return { received: true, status: existing.status };
    }
  }

  // 5. Handle unhandled / ignored event types
  if (event.canonicalEventType === 'unhandled') {
    await updateWebhookEventStatus(pool, gatewayId, event.providerEventId, 'ignored');
    return { received: true, status: 'ignored' };
  }

  // 6. Execute atomic financial settlement inside withTransaction. Terminal rejections are
  // persisted AFTER the transaction has rolled back (see markTerminal comment at top).
  try {
    return await withTransaction(pool, async (tx) => {
    // A. Payment lookup: by cloudhostPaymentId if supplied, else by (provider, provider_reference)
    let payment: PaymentRow | null = null;
    if (event.cloudhostPaymentId) {
      payment = await findPaymentById(tx, event.cloudhostPaymentId);
    }
    if (!payment && event.providerPaymentReference) {
      const sql = `SELECT * FROM payments WHERE provider = $1 AND provider_reference = $2 FOR UPDATE`;
      const res = await tx.query<PaymentRow>(sql, [gatewayId, event.providerPaymentReference]);
      payment = res.rows[0] ?? null;
    }

    // Transient: the payment may simply not exist yet (delivered before initiation committed).
    // Leave the leased event row in place — a post-lease redelivery reconciles (P4-F4).
    if (!payment) {
      throw new NotFoundError(`No payment record matches webhook reference ${event.providerPaymentReference}`);
    }

    // B. Look up invoice and order (also transient: repairable data state, not a judgment).
    const invoice = await findInvoiceById(tx, payment.invoice_id);
    if (!invoice) {
      throw new NotFoundError(`Invoice not found for payment ${payment.id}`);
    }
    const order = await findOrderById(tx, invoice.order_id);
    if (!order) {
      throw new NotFoundError(`Order not found for invoice ${invoice.id}`);
    }

    // C. Zero-Trust Invariant Parity Checks (B1–B5) — all TERMINAL: no redelivery can ever
    // make a mismatched event valid, so the rejection is recorded durably after rollback.
    // B1: Currency parity
    if (payment.currency !== invoice.currency || event.currency !== invoice.currency) {
      markTerminal(new ValidationError(`Webhook currency ${event.currency} violates invoice currency ${invoice.currency}`), payment.id);
    }
    // B2: Payment owner parity
    if (payment.user_id !== invoice.user_id) {
      markTerminal(new ValidationError(`Payment user ${payment.user_id} does not match invoice owner ${invoice.user_id}`), payment.id);
    }
    // B4: Amount matching invoice ceiling
    const invoiceCents = toCents(invoice.total_amount);
    if (event.amountCents !== invoiceCents || toCents(payment.amount) !== invoiceCents) {
      markTerminal(new ValidationError(`Webhook amount ${event.amountCents} does not match invoice total ${invoiceCents}`), payment.id);
    }
    // B5: Invoice / Order agreement
    if (
      invoice.user_id !== order.user_id ||
      invoice.currency !== order.currency ||
      invoice.total_amount !== order.total_amount
    ) {
      markTerminal(new ValidationError('Invoice fields do not match parent order'), payment.id);
    }

    // D. State Machine Transitions
    if (event.canonicalEventType === 'payment.success') {
      if (payment.status === 'successful') {
        // Already successful (e.g. from prior race or webhook retry)
        await updateWebhookEventStatus(tx, gatewayId, event.providerEventId, 'completed', null, payment.id);
        return { received: true, status: 'already_processed' };
      }

      if (payment.status !== 'pending') {
        // Terminal: a payment already failed/cancelled/refunded can never legitimately become
        // successful via redelivery of the same event.
        markTerminal(new ConflictError(`Payment ${payment.id} has status ${payment.status} and cannot be marked successful`), payment.id);
      }

      // 1. Atomic payment update
      const updatedPayment = await updatePaymentStatus(tx, payment.id, 'successful', {
        completedAt: new Date().toISOString(),
        expectedCurrentStatus: 'pending',
      });
      if (!updatedPayment) {
        throw new ConflictError('Concurrent payment update conflict');
      }

      // 2. Append ledger entry (strictly insert-only)
      await recordLedgerEntry(tx, {
        id: idGenerator(),
        userId: invoice.user_id,
        invoiceId: invoice.id,
        entryType: 'payment',
        amount: invoice.total_amount,
        currency: invoice.currency,
        description: `Payment received via ${gatewayId} (${event.providerPaymentReference})`,
      });

      // 3. Mark invoice paid
      await setInvoiceStatus(tx, invoice.id, 'paid');

      // 4. Mark order payment_status paid
      await setOrderPaymentStatus(tx, invoice.order_id, 'paid');

      // 4b. Phase 6 provisioning hook (spec §20): the ONLY path from verified money to
      // infrastructure. Creates subscriptions and queues INSTALL/provision deployment jobs for
      // the items this order contains. Idempotent on (order, item), so duplicate webhook
      // deliveries cannot double-provision.
      await import('./provisioning-service').then(({ provisionPaidOrder }) =>
        provisionPaidOrder(tx, order, idGenerator)
      );

      // Consent-gated marketing outbox; no effect on payment verification or billing semantics.
      await recordVerifiedPaymentBestEffort(tx, payment.id);
      await queueGa4PurchaseBestEffort(tx, env, payment.id);
      await recordVerifiedTikTokPaymentBestEffort(tx, payment.id);

      // 5. Audit log
      const auditSql = `
        INSERT INTO auth_audit_log (id, user_id, event_type, metadata, created_at)
        VALUES ($1, $2, 'webhook_payment_succeeded', $3, NOW())
      `;
      await tx.query(auditSql, [
        idGenerator(),
        invoice.user_id,
        JSON.stringify({
          gateway: gatewayId,
          eventId: event.providerEventId,
          paymentId: payment.id,
          invoiceId: invoice.id,
        }),
      ]);

      // 6. Complete webhook event lease
      await updateWebhookEventStatus(tx, gatewayId, event.providerEventId, 'completed', null, payment.id);

      return { received: true, status: 'processed' };
    } else if (event.canonicalEventType === 'payment.failed') {
      if (payment.status === 'pending') {
        await updatePaymentStatus(tx, payment.id, 'failed', {
          failureReason: event.failureReason || 'Webhook reported payment failure',
          expectedCurrentStatus: 'pending',
        });
      }
      await updateWebhookEventStatus(tx, gatewayId, event.providerEventId, 'failed', event.failureReason, payment.id);
      return { received: true, status: 'failed' };
    } else if (event.canonicalEventType === 'payment.cancelled') {
      if (payment.status === 'pending') {
        await updatePaymentStatus(tx, payment.id, 'cancelled', {
          expectedCurrentStatus: 'pending',
        });
      }
      await updateWebhookEventStatus(tx, gatewayId, event.providerEventId, 'failed', 'Payment was cancelled', payment.id);
      return { received: true, status: 'failed' };
    }

    return { received: true, status: 'ignored' };
  });
  } catch (err) {
    // The settlement transaction has rolled back. If the rejection was terminal, record the
    // rejection durably NOW (separate committed write) so identical redeliveries short-circuit
    // at the durable-rejection branch above with 200/{rejected} instead of re-executing.
    const terminal = terminalInfo(err);
    if (terminal) {
      await updateWebhookEventStatus(
        pool,
        gatewayId,
        event.providerEventId,
        'rejected',
        (err as Error).message ?? 'Terminal webhook rejection',
        terminal.paymentId ?? undefined
      );
    }
    throw err;
  }
}
