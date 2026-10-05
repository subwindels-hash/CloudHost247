/**
 * Customer billing: read-only invoice and ledger views, caller-scoped.
 *
 * Ported from cloudhost247-node/src/routes/billing.ts. A customer only ever sees their own
 * invoices and ledger entries; the ledger is append-only elsewhere, so this module never writes.
 */
'use strict';

const { v } = require('../core/validate');
const { authenticate } = require('../lib/auth');
const { NotFoundError, ValidationError } = require('../core/errors');
const { uuidv7 } = require('../lib/ids');
const { subscriptionRow } = require('../lib/subscription-dto');

const name = 'billing';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  /**
   * Cancel the caller's own subscription. Cancellation takes effect at the end of the paid period
   * (cancel_at_period_end), and a subscription that is already cancelled/terminated/expired is
   * returned as-is with alreadyCancelled rather than erroring — the original's idempotent answer.
   */
  router.post('/api/v1/billing/subscriptions/:id/cancel', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');

    const subscription = await store.table('subscriptions').findById(ctx.params.id);
    if (!subscription || subscription.user_id !== auth.id) throw new NotFoundError('No subscription was found with that id');

    if (['cancelled', 'terminated', 'expired'].includes(subscription.status)) {
      ctx.json({ subscription: subscriptionRow(subscription), alreadyCancelled: true });
      return;
    }

    const updated = await store.table('subscriptions').updateById(subscription.id, {
      status: 'cancelled',
      cancel_at_period_end: true,
      cancelled_at: new Date().toISOString(),
    });
    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'subscription.cancelled', entity_type: 'subscription', entity_id: subscription.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
    });
    ctx.json({ subscription: subscriptionRow(updated) });
  });

  /**
   * Request a plan change. The subscription keeps its current period — the change is priced into
   * the next renewal — so this records the request and returns the target plan as pendingPlanId
   * rather than mutating plan_id, exactly as the original does.
   */
  router.post('/api/v1/billing/subscriptions/:id/change-plan', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const body = await ctx.validate(v.object({ planId: v.string().uuid() }));

    const subscription = await store.table('subscriptions').findById(ctx.params.id);
    if (!subscription || subscription.user_id !== auth.id) throw new NotFoundError('No subscription was found with that id');

    const plan = await store.table('catalog_product_plans').findById(body.planId);
    if (!plan || plan.status !== 'active') throw new NotFoundError('No purchasable plan was found with that id');
    if (subscription.status !== 'active') throw new ValidationError('Only active subscriptions can change plan');

    await store.table('audit_logs').insert({
      id: uuidv7(), actor_id: auth.id, actor_role: auth.role,
      action: 'subscription.plan_change_requested', entity_type: 'subscription', entity_id: subscription.id,
      ip_address: ctx.ip, user_agent: ctx.userAgent,
      after: { fromPlan: subscription.plan_id, toPlan: body.planId },
    });
    ctx.json({ subscription: subscriptionRow(subscription), pendingPlanId: body.planId });
  });
}

module.exports = { name, register };
