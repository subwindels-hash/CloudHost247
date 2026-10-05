/**
 * Admin billing: global invoice/ledger views, reconciliation, and manual-payment confirmation.
 *
 * Ported from cloudhost247-node/src/routes/admin-billing.ts. Reconciliation is computed from the
 * append-only ledger (charges vs payments vs refunds), never from mutable invoice fields, so it
 * reflects the true money position. Manual confirmations and refunds are audited.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError, ConflictError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { asAdmin } = require('../lib/auth');
const { applySuccessfulPayment, round2 } = require('../lib/billing-apply');
const { paymentDto } = require('../lib/payments-dto');

const name = 'admin-billing';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** toInvoiceSummaryDTO — this schema names the columns number/subtotal/total/due_at. */
function invoiceSummaryDto(invoice, order) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.number,
    orderId: invoice.order_id,
    orderNumber: order?.reference ?? null,
    status: invoice.status,
    currency: invoice.currency,
    subtotalAmount: invoice.subtotal,
    discountAmount: invoice.discount_total ?? 0,
    taxAmount: invoice.tax_total ?? 0,
    totalAmount: invoice.total,
    dueDate: invoice.due_at,
    issuedAt: invoice.issued_at,
  };
}

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

  /**
   * loadManualPendingPaymentOrThrow in the original. An already-resolved payment is a 409 rather
   * than a 400 so staff tooling sees one deterministic answer whether the duplicate arrives a
   * millisecond or a day after the first.
   */
  const loadManualPendingPayment = async (ctx) => {
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const payment = await store.table('payments').findById(ctx.params.id);
    if (!payment) throw new NotFoundError('No payment was found with that id');
    if (payment.gateway !== 'manual') {
      throw new ValidationError('Only payments made through the manual/offline gateway can be confirmed or rejected here');
    }
    if (payment.status !== 'pending') {
      throw new ConflictError(`This payment has already been resolved (status "${payment.status}")`);
    }
    return payment;
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

  /**
   * Invoice detail for staff: the summary, the order's line items, the ledger entries against it
   * and every payment attempt — toAdminInvoiceDetailDTO in the original.
   */
  router.get('/api/v1/admin/invoices/:id', admin(async (ctx) => {
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const invoice = await store.table('invoices').findById(ctx.params.id);
    if (!invoice) throw new NotFoundError('No invoice was found with that id');

    const [{ rows: items }, { rows: ledger }, { rows: payments }] = await Promise.all([
      store.table('order_items').find({ order_id: invoice.order_id }),
      store.table('billing_ledger').find({ invoice_id: invoice.id }, { orderBy: 'created_at' }),
      store.table('payments').find({ invoice_id: invoice.id }, { orderBy: 'created_at' }),
    ]);
    const [order, customer] = await Promise.all([
      store.table('orders').findById(invoice.order_id),
      store.table('users').findById(invoice.user_id),
    ]);

    ctx.json({
      invoice: {
        ...invoiceSummaryDto(invoice, order),
        userId: invoice.user_id,
        userEmail: customer?.email ?? null,
        userFullName: customer?.full_name ?? null,
        items: items.map((i) => ({
          id: i.id,
          productName: i.description ?? null,
          planName: i.description ?? null,
          billingPeriod: i.billing_cycle,
          quantity: i.quantity,
          unitPriceAmount: i.unit_price,
          lineTotalAmount: i.line_total,
          currency: invoice.currency,
        })),
        ledger: ledger.map((l) => ({
          id: l.id, entryType: l.entry_type, amount: l.amount, currency: l.currency,
          description: l.description, createdAt: l.created_at,
        })),
        payments: payments.map(paymentDto),
      },
    });
  }));

  /**
   * Void an unpaid invoice: cancel any pending payment attempts, mark the invoice void and its
   * order cancelled, and record why. A reason is mandatory for audit compliance, and an invoice
   * that is no longer unpaid cannot be cancelled.
   */
  router.post('/api/v1/admin/invoices/:id/cancel', admin(async (ctx) => {
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const body = await ctx.validate(v.object({ reason: v.string().trim().min(1).max(2000) }));

    const invoice = await store.table('invoices').findById(ctx.params.id);
    if (!invoice) throw new NotFoundError('No invoice was found with that id');
    if (invoice.status !== 'unpaid') {
      throw new ValidationError(`Cannot cancel an invoice with status '${invoice.status}'`);
    }

    await store.transaction(async (tx) => {
      const { rows: pending } = await tx.table('payments').find({ invoice_id: invoice.id, status: 'pending' });
      for (const payment of pending) {
        await tx.table('payments').updateById(payment.id, {
          status: 'failed',
          rejection_reason: `Invoice cancelled: ${body.reason}`,
          confirmed_by: ctx.user.id,
        });
      }
      await tx.table('invoices').updateById(invoice.id, { status: 'void' });
      if (invoice.order_id) {
        await tx.table('orders').updateById(invoice.order_id, { status: 'cancelled' });
      }
    });

    await deps.store.table('audit_logs').insert({
      id: uuidv7(),
      actor_id: ctx.user.id,
      actor_role: ctx.user.role,
      action: 'admin_invoice_cancelled',
      entity_type: 'invoice',
      entity_id: invoice.id,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      after: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        customerId: invoice.user_id,
        reason: body.reason,
      },
    });

    const cancelled = await store.table('invoices').findById(invoice.id);
    const order = cancelled.order_id ? await store.table('orders').findById(cancelled.order_id) : null;
    const customer = await store.table('users').findById(cancelled.user_id);
    ctx.json({
      invoice: {
        ...invoiceSummaryDto(cancelled, order),
        userId: cancelled.user_id,
        userEmail: customer?.email ?? null,
        userFullName: customer?.full_name ?? null,
      },
    });
  }));

  /**
   * The manual/offline gateway's staff confirmation flow (admin-billing.ts). Same state rules as
   * the original: an already-resolved payment is a 409 whatever the timing, so staff tooling sees
   * one deterministic "already processed" answer.
   */
  router.post('/api/v1/admin/payments/:id/confirm-manual', admin(async (ctx) => {
    const payment = await loadManualPendingPayment(ctx);
    await store.transaction(async (tx) => {
      await tx.table('payments').updateById(payment.id, {
        confirmed_by: ctx.user.id,
        confirmed_at: new Date().toISOString(),
      });
      await applySuccessfulPayment(tx, { paymentId: payment.id });
    });
    await audit(deps, ctx, 'manual_payment_confirmed', { type: 'payment', id: payment.id });
    ctx.json({ payment: paymentDto(await store.table('payments').findById(payment.id)) });
  }));

  router.post('/api/v1/admin/payments/:id/reject-manual', admin(async (ctx) => {
    const body = await ctx.validate(v.object({ reason: v.string().trim().min(1).max(2000) }));
    const payment = await loadManualPendingPayment(ctx);

    await store.table('payments').updateById(payment.id, {
      status: 'failed',
      rejection_reason: body.reason,
      confirmed_by: ctx.user.id,
    });
    await audit(deps, ctx, 'manual_payment_rejected', { type: 'payment', id: payment.id });
    ctx.json({ payment: paymentDto(await store.table('payments').findById(payment.id)) });
  }));
}

module.exports = { name, register };
