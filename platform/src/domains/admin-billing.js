/**
 * Admin billing: global invoice/ledger views, reconciliation, and manual-payment confirmation.
 *
 * Ported from cloudhost247-node/src/routes/admin-billing.ts. Reconciliation is computed from the
 * append-only ledger (charges vs payments vs refunds), never from mutable invoice fields, so it
 * reflects the true money position. Manual confirmations and refunds are audited.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');
const { applySuccessfulPayment, round2 } = require('../lib/billing-apply');

const name = 'admin-billing';

async function audit(deps, ctx, action, entity) {
  await deps.store.table('audit_logs').insert({
    id: uuidv7(),
    actor_id: ctx.user.id,
    actor_role: ctx.user.role,
    action,
    entity_type: entity.type,
    entity_id: entity.id,
    ip_address: ctx.ip,
    user_agent: ctx.userAgent,
  });
}

function register(router, deps) {
  const { store } = deps;
  const admin = (handler) => async (ctx) => {
    await asAdmin(ctx, deps);
    return handler(ctx);
  };

  router.get('/api/v1/admin/invoices', admin(async (ctx) => {
    const limit = Math.min(Number(ctx.query.limit) || 100, 500);
    const offset = Number(ctx.query.offset) || 0;
    const predicate = {};
    if (ctx.query.status) predicate.status = ctx.query.status;

    const { rows, total } = await store.table('invoices').find(predicate, { orderBy: '-created_at', limit, offset });
    ctx.json({
      invoices: rows.map((r) => ({
        id: r.id, userId: r.user_id, number: r.number, status: r.status,
        currency: r.currency, total: r.total, amountPaid: r.amount_paid,
        dueAt: r.due_at, createdAt: r.created_at,
      })),
      total,
    });
  }));

  router.get('/api/v1/admin/billing/ledger', admin(async (ctx) => {
    const { rows, total } = await store.table('billing_ledger').find({}, { orderBy: '-created_at', limit: 500 });
    ctx.json({
      ledger: rows.map((r) => ({
        id: r.id, userId: r.user_id, entryType: r.entry_type, amount: r.amount,
        currency: r.currency, description: r.description, createdAt: r.created_at,
      })),
      total,
    });
  }));

  router.get('/api/v1/admin/billing/reconciliation', admin(async (ctx) => {
    const { rows } = await store.table('billing_ledger').find({});
    const sum = (type) => round2(rows.filter((r) => r.entry_type === type).reduce((s, r) => s + r.amount, 0));

    const charges = sum('charge');
    const payments = sum('payment');
    const refunds = sum('refund');
    const credits = sum('credit');

    ctx.json({
      currency: 'USD',
      charges,
      payments,
      refunds,
      credits,
      outstanding: round2(charges - payments - refunds - credits),
      entries: rows.length,
    });
  }));

  router.post('/api/v1/admin/payments/:id/confirm', admin(async (ctx) => {
    const payment = await store.table('payments').findById(ctx.params.id);
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.gateway !== 'manual') throw new ValidationError('Only manual payments need confirmation');
    if (payment.status === 'succeeded') throw new ValidationError('Payment already confirmed');

    await store.transaction(async (tx) => {
      await tx.table('payments').updateById(payment.id, { confirmed_by: ctx.user.id });
      await applySuccessfulPayment(tx, { paymentId: payment.id });
    });
    await audit(deps, ctx, 'manual_payment_confirmed', { type: 'payment', id: payment.id });
    ctx.json({ ok: true });
  }));

  router.post('/api/v1/admin/payments/:id/reject', admin(async (ctx) => {
    const body = await ctx.validate(v.object({ reason: v.string().trim().max(300).optional() }));
    const payment = await store.table('payments').findById(ctx.params.id);
    if (!payment) throw new NotFoundError('Payment not found');

    await store.table('payments').updateById(payment.id, {
      status: 'failed',
      rejection_reason: body.reason ?? null,
      confirmed_by: ctx.user.id,
    });
    await audit(deps, ctx, 'manual_payment_rejected', { type: 'payment', id: payment.id });
    ctx.json({ ok: true });
  }));

  router.post('/api/v1/admin/invoices/:id/refund', admin(async (ctx) => {
    const invoice = await store.table('invoices').findById(ctx.params.id);
    if (!invoice) throw new NotFoundError('Invoice not found');
    if ((invoice.amount_paid ?? 0) <= 0) throw new ValidationError('Invoice has no captured payment to refund');

    await store.transaction(async (tx) => {
      await tx.table('invoices').updateById(invoice.id, { status: 'refunded' });
      await tx.table('billing_ledger').insert({
        id: uuidv7(),
        user_id: invoice.user_id,
        invoice_id: invoice.id,
        entry_type: 'refund',
        amount: invoice.amount_paid,
        currency: invoice.currency,
        description: `Refund of ${invoice.number}`,
        idempotency_key: `refund:${invoice.id}`,
      });
    });
    await audit(deps, ctx, 'admin_invoice_refunded', { type: 'invoice', id: invoice.id });
    ctx.json({ ok: true });
  }));
}

module.exports = { name, register };
