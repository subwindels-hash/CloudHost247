/**
 * Applies a successful payment to the billing graph, idempotently, inside a transaction.
 *
 * Shared by the webhook receiver (webhooks.js), the sandbox completion path (payments.js) and
 * manual confirmation (admin-billing.js) so the money moves identically no matter which gateway
 * reported success. Double-entry: one 'payment' ledger row per applied payment, guarded by an
 * idempotency key so a retried webhook cannot double-credit.
 */
'use strict';

const { uuidv7 } = require('./ids');
const { provisionPaidOrder } = require('./order-provisioning');
const { fulfillPendingCloudflareActions } = require('./cloudflare-fulfilment');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} tx transaction-scoped store
 * @param {object} args
 * @param {string} args.paymentId
 * @param {string} [args.gatewayReference]
 * @param {object} [args.deps] `{ config, logger, store }` — what settling the payment's *provider-side*
 *   consequences needs (today: a Cloudflare action queued with `awaiting_payment`). Optional so a
 *   caller that only wants the ledger effect is unaffected; the domain call sites pass it.
 * @returns {Promise<{ applied: boolean }>}
 */
async function applySuccessfulPayment(tx, { paymentId, gatewayReference, deps }) {
  const payment = await tx.table('payments').findById(paymentId);
  if (!payment) return { applied: false };
  if (payment.status === 'succeeded') return { applied: false }; // idempotent

  const idempotencyKey = `payment:${payment.id}`;
  const existing = await tx.table('billing_ledger').findOne({ idempotency_key: idempotencyKey });
  if (existing) {
    await tx.table('payments').updateById(payment.id, { status: 'succeeded' });
    return { applied: false };
  }

  await tx.table('payments').updateById(payment.id, {
    status: 'succeeded',
    gateway_reference: gatewayReference ?? payment.gateway_reference,
    confirmed_at: new Date().toISOString(),
  });

  // Credit the invoice if there is one.
  if (payment.invoice_id) {
    const invoice = await tx.table('invoices').findById(payment.invoice_id);
    if (invoice) {
      const amountPaid = round2((invoice.amount_paid ?? 0) + payment.amount);
      const status = amountPaid >= invoice.total ? 'paid' : 'partially_paid';
      await tx.table('invoices').updateById(invoice.id, {
        amount_paid: amountPaid,
        status,
        paid_at: status === 'paid' ? new Date().toISOString() : invoice.paid_at,
      });

      if (invoice.order_id) {
        await tx.table('orders').updateById(invoice.order_id, { status: 'paid' });
        await provisionPaidOrder(tx, invoice.order_id);
      }
    }
  }

  // Provider-side actions the customer was promised at checkout and that were deliberately parked
  // until the money arrived (`cloudflare_jobs.status = 'awaiting_payment'`). Until this call existed,
  // "the service will be provisioned automatically after payment is confirmed" was a sentence with
  // nothing behind it. A failure here never fails the payment — the job records the failure and an
  // operator retries it — because failing the payment would be the worse lie.
  if (deps) {
    try {
      const outcome = await fulfillPendingCloudflareActions(tx, deps);
      if (outcome.failed.length > 0) {
        deps.logger?.warn?.({ failed: outcome.failed }, 'pending provider actions failed after payment');
      }
    } catch (error) {
      deps.logger?.warn?.({ reason: error.message }, 'post-payment provider fulfilment could not run');
    }
  }

  await tx.table('billing_ledger').insert({
    id: uuidv7(),
    user_id: payment.user_id,
    invoice_id: payment.invoice_id ?? null,
    payment_id: payment.id,
    entry_type: 'payment',
    amount: payment.amount,
    currency: payment.currency,
    description: `Payment via ${payment.gateway}`,
    idempotency_key: idempotencyKey,
  });

  return { applied: true };
}

module.exports = { applySuccessfulPayment, round2 };
