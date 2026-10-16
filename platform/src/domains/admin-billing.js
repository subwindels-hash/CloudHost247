/**
 * Admin billing: global invoice/ledger views, reconciliation, and manual-payment confirmation.
 *
 * Ported from cloudhost247-node/src/routes/admin-billing.ts. Reconciliation is computed from the
 * append-only ledger (charges vs payments vs refunds), never from mutable invoice fields, so it
 * reflects the true money position. Manual confirmations and refunds are audited.
 */
'use strict';

const { v } = require('../core/validate');
const { HttpError, NotFoundError, ValidationError, ConflictError } = require('../core/errors');
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
    amountPaid: invoice.amount_paid ?? 0,
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

  /**
   * The invoices directory (spec: search + status filter + pagination, rows joined with the
   * customer). `search` matches the invoice number or the customer's email, case-insensitively;
   * `page` is accepted alongside `offset` — offset wins when both are sent.
   */
  router.get('/api/v1/admin/invoices', admin(async (ctx) => {
    const limit = Math.min(Number(ctx.query.limit) || 100, 500);
    const offset = Number(ctx.query.offset)
      || Math.max(0, (Math.max(1, Number(ctx.query.page) || 1) - 1) * limit);
    const search = String(ctx.query.search ?? '').trim().toLowerCase();

    let match = (ctx.query.status ? { status: ctx.query.status } : {});
    if (search) {
      const { rows: users } = await store.table('users').find({});
      const byEmail = new Set(
        users
          .filter((u) => String(u.email ?? '').toLowerCase().includes(search))
          .map((u) => u.id),
      );
      const wantedStatus = ctx.query.status ?? null;
      match = (row) => {
        if (wantedStatus && row.status !== wantedStatus) return false;
        return String(row.number ?? '').toLowerCase().includes(search) || byEmail.has(row.user_id);
      };
    }

    const { rows, total } = await store.table('invoices').find(match, { orderBy: '-created_at', limit, offset });
    const customers = new Map();
    for (const row of rows) {
      if (!customers.has(row.user_id)) {
        customers.set(row.user_id, await store.table('users').findById(row.user_id));
      }
    }
    ctx.json({
      invoices: rows.map((r) => {
        const customer = customers.get(r.user_id);
        return {
          id: r.id, userId: r.user_id, number: r.number, status: r.status,
          currency: r.currency, total: r.total, amountPaid: r.amount_paid,
          dueAt: r.due_at, createdAt: r.created_at,
          userEmail: customer?.email ?? null,
          userFullName: customer?.full_name ?? null,
        };
      }),
      total,
    });
  }));

  /**
   * The global ledger (spec: queryable by userId, invoiceId, entryType, fromDate, toDate). The
   * entry type vocabulary is the ledger's own: charge | payment | refund | credit. Dates compare on
   * the UTC day and are inclusive at both ends.
   */
  router.get('/api/v1/admin/billing/ledger', admin(async (ctx) => {
    const { userId, invoiceId, entryType, fromDate, toDate } = ctx.query;
    const from = String(fromDate ?? '').slice(0, 10);
    const to = String(toDate ?? '').slice(0, 10);
    const match = (row) => {
      if (userId && row.user_id !== userId) return false;
      if (invoiceId && row.invoice_id !== invoiceId) return false;
      if (entryType && row.entry_type !== entryType) return false;
      const day = String(row.created_at ?? '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    };
    const { rows, total } = await store.table('billing_ledger').find(match, { orderBy: '-created_at', limit: 500 });
    ctx.json({
      ledger: rows.map((r) => ({
        id: r.id, userId: r.user_id, invoiceId: r.invoice_id ?? null, paymentId: r.payment_id ?? null,
        entryType: r.entry_type, amount: r.amount,
        currency: r.currency, description: r.description, createdAt: r.created_at,
      })),
      total,
    });
  }));

  /**
   * The money position, per currency.
   *
   * The headline figures are the platform's unit of account (USD). Entries in any other currency are
   * totalled separately rather than added into the dollar numbers — a BTC ledger row is 0.00042, and
   * a summary that folded it into "charges" would report a position that is not true in any
   * currency. (The ledger's two-decimal money columns are why a BTC row loses that precision long
   * before this endpoint sees it; see `src/lib/money.js`.)
   */
  router.get('/api/v1/admin/billing/reconciliation', admin(async (ctx) => {
    const rows = (await store.table('billing_ledger').find({})).rows;
    const codeOf = (row) => String(row.currency ?? 'USD').toUpperCase();
    const totalsFor = (entries) => {
      // Summed as stored. `amount` is already what the money column holds (two decimals, the ledger's
      // precision); re-rounding it to the currency's own scale here would only hide the difference.
      const sum = (type) => {
        const list = entries.filter((r) => r.entry_type === type);
        return list.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      };
      const charges = sum('charge');
      const payments = sum('payment');
      const refunds = sum('refund');
      const credits = sum('credit');
      return {
        charges, payments, refunds, credits,
        outstanding: round2(charges - payments - refunds - credits),
        entries: entries.length,
      };
    };

    const usd = totalsFor(rows.filter((row) => codeOf(row) === 'USD'));
    const byCurrency = {};
    for (const currency of [...new Set(rows.map(codeOf))].filter((code) => code !== 'USD').sort()) {
      byCurrency[currency] = totalsFor(rows.filter((row) => codeOf(row) === currency));
    }

    ctx.json({
      currency: 'USD',
      ...usd,
      otherCurrencies: byCurrency, // reported as stored: the ledger's precision, not a currency's ideal
      note: 'USD totals only. Entries in other currencies are reported under otherCurrencies; they are never added into these figures.',
    });
  }));

  router.post('/api/v1/admin/payments/:id/confirm', admin(async (ctx) => {
    const payment = await store.table('payments').findById(ctx.params.id);
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.gateway !== 'manual') throw new ValidationError('Only manual payments need confirmation');
    if (payment.status === 'succeeded') throw new ValidationError('Payment already confirmed');

    await store.transaction(async (tx) => {
      await tx.table('payments').updateById(payment.id, { confirmed_by: ctx.user.id });
      await applySuccessfulPayment(tx, { paymentId: payment.id, deps });
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

  /**
   * Refund a captured payment (spec: POST /admin/invoices/:id/refund). The reason is mandatory
   * for audit compliance; the amount is optional and defaults to the whole refundable balance.
   * Money is the platform's fixed-point major units (round2), consistent with every other amount
   * on these routes.
   *
   * The cap invariant is the one that protects the money: SUM(refunds) + amount must not exceed
   * the settled payments on the invoice (amount_paid). An over-refund is refused by name as
   * INVALID_REFUND_AMOUNT before anything is written; refunds are append-only ledger rows, and the
   * invoice walks paid -> partially_refunded -> refunded as the cumulative refund grows. (The
   * spec's parent-order payment_status sync has no column to write here — orders carry no
   * payment_status on this platform — so refund state lives on the invoice and the ledger.)
   */
  router.post('/api/v1/admin/invoices/:id/refund', admin(async (ctx) => {
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const body = await ctx.validate(v.object({
      amount: v.number().optional(),
      reason: v.string().trim().min(1).max(2000),
    }));

    const invoice = await store.table('invoices').findById(ctx.params.id);
    if (!invoice) throw new NotFoundError('Invoice not found');
    if (!['paid', 'partially_refunded'].includes(invoice.status)) {
      throw new ValidationError(`Cannot refund an invoice with status '${invoice.status}'`);
    }

    const { rows: prior } = await store.table('billing_ledger').find({
      invoice_id: invoice.id,
      entry_type: 'refund',
    });
    const alreadyRefunded = round2(prior.reduce((sum, r) => sum + Number(r.amount ?? 0), 0));
    const refundable = round2((invoice.amount_paid ?? 0) - alreadyRefunded);
    const amount = round2(body.amount ?? refundable);
    if (!(amount > 0)) throw new ValidationError('Refund amount must be positive');
    if (amount > refundable) {
      throw new HttpError(
        400,
        `Refund of ${amount} ${invoice.currency} exceeds the refundable balance of ${refundable} ${invoice.currency}`,
        'INVALID_REFUND_AMOUNT',
      );
    }

    const cumulative = round2(alreadyRefunded + amount);
    const nextStatus = cumulative >= round2(invoice.amount_paid ?? 0) ? 'refunded' : 'partially_refunded';
    await store.transaction(async (tx) => {
      await tx.table('billing_ledger').insert({
        id: uuidv7(),
        user_id: invoice.user_id,
        invoice_id: invoice.id,
        entry_type: 'refund',
        amount,
        currency: invoice.currency,
        description: `Refund of ${invoice.number}: ${body.reason}`,
        idempotency_key: `refund:${invoice.id}:${uuidv7()}`,
      });
      await tx.table('invoices').updateById(invoice.id, { status: nextStatus });
    });

    await deps.store.table('audit_logs').insert({
      id: uuidv7(),
      actor_id: ctx.user.id,
      actor_role: ctx.user.role,
      action: 'admin_invoice_refunded',
      entity_type: 'invoice',
      entity_id: invoice.id,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      after: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        customerId: invoice.user_id,
        amount,
        currency: invoice.currency,
        reason: body.reason,
        status: nextStatus,
      },
    });

    ctx.json({ ok: true, refunded: amount, status: nextStatus });
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
    const refundedAmount = round2(
      ledger.filter((l) => l.entry_type === 'refund').reduce((sum, l) => sum + Number(l.amount ?? 0), 0),
    );

    ctx.json({
      invoice: {
        ...invoiceSummaryDto(invoice, order),
        refundedAmount,
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
      await applySuccessfulPayment(tx, { paymentId: payment.id, deps });
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
