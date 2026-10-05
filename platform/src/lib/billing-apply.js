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

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} tx transaction-scoped store
 * @param {object} args
 * @param {string} args.paymentId
 * @param {string} [args.gatewayReference]
 * @returns {Promise<{ applied: boolean }>}
 */
async function applySuccessfulPayment(tx, { paymentId, gatewayReference }) {
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
      }
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
