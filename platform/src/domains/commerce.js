/**
 * Commerce: cart and order placement.
 *
 * Ported from cloudhost247-node/src/routes/commerce.ts. A cart is scoped to the authenticated
 * user (or an anonymous session token), items are priced from the *published* catalog at add time,
 * and checkout converts the cart into an order + invoice + billing-ledger charge in one
 * transaction so the financial invariants hold on both backends.
 */
'use strict';

const { v } = require('../core/validate');
const { NotFoundError, ValidationError, ConflictError } = require('../core/errors');
const { uuidv7, randomToken } = require('../lib/ids');
const { authenticate } = require('../lib/auth');

const name = 'commerce';

const round2 = (n) => Math.round(n * 100) / 100;

const addItemSchema = v.object({
  planSlug: v.string().min(1).max(160),
  billingCycle: v.enum(['monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'once']).default('monthly'),
  quantity: v.coerce.number().int().min(1).max(99).default(1),
  domain: v.string().trim().max(253).optional(),
});

async function getOrCreateCart(store, userId, sessionToken) {
  const predicate = userId ? { user_id: userId, status: 'open' } : { session_token: sessionToken, status: 'open' };
  let cart = await store.table('carts').findOne(predicate);
  if (!cart) {
    cart = await store.table('carts').insert({
      id: uuidv7(),
      user_id: userId ?? null,
      session_token: userId ? null : (sessionToken ?? randomToken(24)),
      status: 'open',
    });
  }
  return cart;
}

async function resolvePlan(store, planSlug, billingCycle) {
  const plan = await store.table('catalog_product_plans').findOne({ slug: planSlug, status: 'active' });
  if (!plan) throw new NotFoundError(`No plan found with slug ${planSlug}`);

  const pricing = await store.table('catalog_plan_pricing').findOne({
    plan_id: plan.id,
    billing_cycle: billingCycle,
    is_active: true,
  });
  if (!pricing) {
    throw new ValidationError(`Plan ${planSlug} has no published pricing for ${billingCycle}`);
  }
  return { plan, pricing };
}

function publicCart(cart, items) {
  const subtotal = round2(items.reduce((sum, i) => sum + i.unit_price * i.quantity + i.setup_fee, 0));
  return {
    id: cart.id,
    status: cart.status,
    currency: cart.currency,
    items: items.map((i) => ({
      id: i.id,
      planId: i.plan_id,
      billingCycle: i.billing_cycle,
      quantity: i.quantity,
      unitPrice: i.unit_price,
      setupFee: i.setup_fee,
      domain: i.domain,
    })),
    subtotal,
  };
}

function register(router, deps) {
  const { store } = deps;

  router.get('/api/v1/cart', async (ctx) => {
    let userId = null;
    let sessionToken = ctx.cookies.cart ?? ctx.query.session;
    try {
      const auth = await authenticate(ctx, { ...deps, allowMissing: true });
      userId = auth?.id ?? null;
    } catch {
      userId = null;
    }

    const cart = await getOrCreateCart(store, userId, sessionToken);
    const { rows } = await store.table('cart_items').find({ cart_id: cart.id });
    ctx.cookie('cart', cart.session_token ?? cart.id, { httpOnly: true });
    ctx.json(publicCart(cart, rows));
  });

  router.post('/api/v1/cart/items', async (ctx) => {
    const input = await ctx.validate(addItemSchema);

    let userId = null;
    try {
      const auth = await authenticate(ctx, { ...deps, allowMissing: true });
      userId = auth?.id ?? null;
    } catch {
      userId = null;
    }

    const cart = await getOrCreateCart(store, userId, ctx.cookies.cart);
    const { plan, pricing } = await resolvePlan(store, input.planSlug, input.billingCycle);

    const item = await store.table('cart_items').insert({
      id: uuidv7(),
      cart_id: cart.id,
      plan_id: plan.id,
      quantity: input.quantity,
      billing_cycle: input.billingCycle,
      currency: pricing.currency,
      unit_price: pricing.price,
      setup_fee: pricing.setup_fee,
      domain: input.domain ?? null,
    });

    const { rows } = await store.table('cart_items').find({ cart_id: cart.id });
    ctx.code(201).json(publicCart(cart, rows));
    return;
  });

  router.delete('/api/v1/cart/items/:id', async (ctx) => {
    const item = await store.table('cart_items').findById(ctx.params.id);
    if (!item) throw new NotFoundError('Cart item not found');
    await store.table('cart_items').deleteById(item.id);
    ctx.json({ ok: true });
  });

  /** Checkout: cart -> order + invoice + ledger charge, atomically. */
  router.post('/api/v1/orders', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const cart = await store.table('carts').findOne({ user_id: auth.id, status: 'open' });
    if (!cart) throw new NotFoundError('Your cart is empty');

    const { rows: items } = await store.table('cart_items').find({ cart_id: cart.id });
    if (items.length === 0) throw new ValidationError('Your cart has no items');

    await store.transaction(async (tx) => {
      const subtotal = round2(items.reduce((s, i) => s + i.unit_price * i.quantity + i.setup_fee, 0));

      const order = await tx.table('orders').insert({
        id: uuidv7(),
        user_id: auth.id,
        cart_id: cart.id,
        reference: `ORD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`,
        currency: cart.currency,
        subtotal,
        total: subtotal,
        status: 'pending',
      });

      for (const item of items) {
        await tx.table('order_items').insert({
          id: uuidv7(),
          order_id: order.id,
          plan_id: item.plan_id,
          quantity: item.quantity,
          billing_cycle: item.billing_cycle,
          unit_price: item.unit_price,
          line_total: round2(item.unit_price * item.quantity + item.setup_fee),
        });
      }

      const invoice = await tx.table('invoices').insert({
        id: uuidv7(),
        user_id: auth.id,
        order_id: order.id,
        number: `INV-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`,
        currency: cart.currency,
        subtotal,
        total: subtotal,
        status: 'unpaid',
        due_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
      });

      await tx.table('billing_ledger').insert({
        id: uuidv7(),
        user_id: auth.id,
        invoice_id: invoice.id,
        entry_type: 'charge',
        amount: subtotal,
        currency: cart.currency,
        description: `Order ${order.reference}`,
        idempotency_key: `charge:${order.id}`,
      });

      await tx.table('carts').updateById(cart.id, { status: 'converted' });
      ctx.locals.orderId = order.id;
      ctx.locals.invoiceId = invoice.id;
      ctx.locals.reference = order.reference;
    });

    ctx.code(201).json({
      orderId: ctx.locals.orderId,
      invoiceId: ctx.locals.invoiceId,
      reference: ctx.locals.reference,
    });
  });

  router.get('/api/v1/orders', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    const { rows, total } = await store.table('orders').find(
      { user_id: auth.id },
      { orderBy: '-created_at' }
    );
    ctx.json({
      orders: rows.map((o) => ({
        id: o.id,
        reference: o.reference,
        status: o.status,
        currency: o.currency,
        total: o.total,
        createdAt: o.created_at,
      })),
      total,
    });
  });
}

module.exports = { name, register };
