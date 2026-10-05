/**
 * Customer billing: read-only invoice and ledger views, caller-scoped.
 *
 * Ported from cloudhost247-node/src/routes/billing.ts. A customer only ever sees their own
 * invoices and ledger entries; the ledger is append-only elsewhere, so this module never writes.
 */
'use strict';

const { authenticate } = require('../lib/auth');
const { NotFoundError } = require('../core/errors');

const name = 'billing';

function publicInvoice(row) {
  return {
    id: row.id,
    number: row.number,
    currency: row.currency,
    subtotal: row.subtotal,
    taxTotal: row.tax_total,
    discountTotal: row.discount_total,
    total: row.total,
    amountPaid: row.amount_paid,
    status: row.status,
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    paidAt: row.paid_at,
  };
}

function publicLedger(row) {
  return {
    id: row.id,
    entryType: row.entry_type,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    createdAt: row.created_at,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/invoices', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('invoices').find(
      { user_id: auth.id },
      { orderBy: '-created_at' }
    );
    ctx.json({ invoices: rows.map(publicInvoice), total });
  });

  router.get('/api/v1/invoices/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    // Scoped: someone else's invoice is a 404, never a 403.
    const invoice = await store.table('invoices').findOne({ id: ctx.params.id, user_id: auth.id });
    if (!invoice) throw new NotFoundError('Invoice not found');

    const { rows } = await store.table('billing_ledger').find({ invoice_id: invoice.id }, { orderBy: 'created_at' });
    ctx.json({ invoice: publicInvoice(invoice), ledger: rows.map(publicLedger) });
  });

  router.get('/api/v1/billing/ledger', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('billing_ledger').find(
      { user_id: auth.id },
      { orderBy: '-created_at', limit: 200 }
    );
    ctx.json({ ledger: rows.map(publicLedger), total });
  });

  router.get('/api/v1/billing/subscriptions', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows } = await store.table('subscriptions').find({ user_id: auth.id }, { orderBy: '-created_at' });
    ctx.json({
      subscriptions: rows.map((s) => ({
        id: s.id,
        status: s.status,
        billingCycle: s.billing_cycle,
        renewsAt: s.renews_at,
        currentPeriodEnd: s.current_period_end,
      })),
    });
  });
}

module.exports = { name, register };
