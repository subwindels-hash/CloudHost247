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
const { authenticate, asAdmin, asStaff } = require('../lib/auth');
const { paymentDto } = require('../lib/payments-dto');

const name = 'commerce';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The order lifecycle as the rest of the platform actually writes it: `pending` at checkout,
 * `paid` when the invoice settles (`lib/billing-apply.js`), and `cancelled` when an admin voids the
 * invoice. The admin surface validates against this list rather than accepting any status string.
 */
const ORDER_STATUSES = ['pending', 'paid', 'cancelled', 'refunded'];

/** Resolve an order's line items into the snapshot names both the customer and staff views show. */
async function orderItemDtos(store, order, items) {
  const resolved = [];
  for (const item of items) {
    const plan = item.plan_id ? await store.table('catalog_product_plans').findById(item.plan_id) : null;
    const product = plan?.product_id ? await store.table('catalog_products').findById(plan.product_id) : null;
    resolved.push({
      id: item.id,
      productName: product?.name ?? item.description ?? null,
      planName: plan?.name ?? item.description ?? null,
      billingPeriod: item.billing_cycle,
      quantity: item.quantity,
      unitPriceAmount: item.unit_price,
      lineTotalAmount: item.line_total,
      currency: order.currency,
    });
  }
  return resolved;
}

// MAX_CART_ITEM_QUANTITY in the original (src/config/billing.ts).
const MAX_CART_ITEM_QUANTITY = 20;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const addItemSchema = v.object({
  planSlug: v.string().min(1).max(160),
  billingCycle: v.enum(['monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'once']).default('monthly'),
  quantity: v.coerce.number().int().min(1).max(MAX_CART_ITEM_QUANTITY).default(1),
  domain: v.string().trim().max(253).optional(),
});

const updateCartItemSchema = v.object({
  quantity: v.coerce.number().int().min(1).max(MAX_CART_ITEM_QUANTITY),
});

/**
 * Mirrors toOrderSummaryDTO in the original (src/dto/commerce.ts). This schema names the columns
 * reference/subtotal/discount_total/tax_total/total and keeps no payment_status on the order, so
 * those are mapped — payment status is derived from the order's invoice.
 */
function orderSummaryDto(order, invoice) {
  return {
    id: order.id,
    orderNumber: order.reference,
    status: order.status,
    paymentStatus: invoice ? (invoice.status === 'paid' ? 'paid' : 'unpaid') : 'unpaid',
    currency: order.currency,
    subtotalAmount: order.subtotal,
    discountAmount: order.discount_total ?? 0,
    taxAmount: order.tax_total ?? 0,
    totalAmount: order.total,
    createdAt: order.created_at,
    invoiceId: invoice?.id ?? null,
    invoiceNumber: invoice?.number ?? null,
  };
}

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

/**
 * Resolves the catalog names behind cart item plan ids.
 *
 * The cart row stores only a plan id, which no public catalog endpoint exposes (the catalog is
 * keyed by slug), so without this a cart UI can only render a UUID. Additive fields: the ids stay
 * exactly where they were for the checkout path.
 */
async function planDetailsFor(store, items) {
  const planIds = [...new Set(items.map((i) => i.plan_id).filter(Boolean))];
  if (planIds.length === 0) return new Map();

  const { rows: plans } = await store.table('catalog_product_plans').find({ id: { $in: planIds } });
  const productIds = [...new Set(plans.map((p) => p.product_id).filter(Boolean))];
  const { rows: products } = productIds.length
    ? await store.table('catalog_products').find({ id: { $in: productIds } })
    : { rows: [] };
  const productById = new Map(products.map((p) => [String(p.id), p]));

  const details = new Map();
  for (const plan of plans) {
    details.set(String(plan.id), {
      planName: plan.name,
      planSlug: plan.slug,
      productName: productById.get(String(plan.product_id))?.name ?? null,
    });
  }
  return details;
}

function publicCart(cart, items, details = new Map()) {
  const subtotal = round2(items.reduce((sum, i) => sum + i.unit_price * i.quantity + i.setup_fee, 0));
  return {
    id: cart.id,
    status: cart.status,
    currency: cart.currency,
    items: items.map((i) => ({
      id: i.id,
      planId: i.plan_id,
      ...(details.get(String(i.plan_id)) ?? {}),
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
    ctx.json(publicCart(cart, rows, await planDetailsFor(store, rows)));
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
    ctx.code(201).json(publicCart(cart, rows, await planDetailsFor(store, rows)));
    return;
  });

  /** Change a line's quantity. Answers with the refreshed cart, as the original does. */
  router.patch('/api/v1/cart/items/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const { quantity } = await ctx.validate(updateCartItemSchema);

    const item = await store.table('cart_items').findById(ctx.params.id);
    if (!item) throw new NotFoundError('Cart item not found');

    // The item must belong to a cart this caller owns — updateCartItemQuantity is user-scoped.
    const cart = await store.table('carts').findById(item.cart_id);
    if (!cart || (auth.id ? cart.user_id !== auth.id : cart.session_token !== ctx.cookies.cart)) {
      throw new NotFoundError('Cart item not found');
    }

    await store.table('cart_items').updateById(item.id, { quantity });
    const { rows } = await store.table('cart_items').find({ cart_id: cart.id });
    ctx.json({ cart: publicCart(cart, rows, await planDetailsFor(store, rows)) });
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

  /** Order detail with its line items (commerce.ts getMyOrderDetail). */
  router.get('/api/v1/orders/:id', async (ctx) => {
    const auth = await authenticate(ctx, deps);
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');

    const order = await store.table('orders').findById(ctx.params.id);
    if (!order || order.user_id !== auth.id) throw new NotFoundError('No order was found with that id');

    const { rows: items } = await store.table('order_items').find({ order_id: order.id });
    const invoice = order.invoice_id
      ? await store.table('invoices').findById(order.invoice_id)
      : await store.table('invoices').findOne({ order_id: order.id });

    // order_items stores a plan_id, so resolve the snapshot names the DTO exposes.
    const resolved = await orderItemDtos(store, order, items);
    ctx.json({ order: { ...orderSummaryDto(order, invoice), items: resolved } });
  });

  // ===========================================================================
  // Admin / staff order surface.
  //
  // commerce.ts deferred these to Phase 5F and the port inherited the gap: staff could see an
  // invoice and its order number, but not the order itself, its line items, or what the order turned
  // into. Reading is `asStaff` (the same guard the rest of the staff console uses); the single
  // mutation is `asAdmin`, because cancelling an order moves money.
  // ===========================================================================
  const staff = (handler) => async (ctx) => {
    await asStaff(ctx, deps);
    return handler(ctx);
  };

  router.get('/api/v1/admin/orders', staff(async (ctx) => {
    const query = await ctx.validateQuery(v.object({
      status: v.enum(ORDER_STATUSES).optional(),
      userId: v.string().trim().optional(),
      reference: v.string().trim().max(120).optional(),
      from: v.string().trim().optional(),
      to: v.string().trim().optional(),
      limit: v.coerce.number().int().min(1).max(500).default(50),
      offset: v.coerce.number().int().min(0).default(0),
    }));

    const predicate = {};
    if (query.status) predicate.status = query.status;
    if (query.userId) predicate.user_id = query.userId;
    // Both stores support the same operator set, so the reference search and the date window are
    // applied by the store rather than by fetching everything and filtering in memory.
    if (query.reference) predicate.reference = { $like: `%${query.reference}%` };
    if (query.from || query.to) {
      predicate.created_at = {};
      if (query.from) predicate.created_at.$gte = query.from;
      if (query.to) predicate.created_at.$lte = query.to;
    }

    const { rows, total } = await store.table('orders').find(predicate, {
      orderBy: '-created_at', limit: query.limit, offset: query.offset,
    });

    const customers = new Map((await store.table('users').all()).map((u) => [u.id, u]));
    const invoices = await store.table('invoices').all();
    const payments = await store.table('payments').all();
    const items = await store.table('order_items').all();

    ctx.json({
      orders: rows.map((order) => {
        const customer = customers.get(order.user_id);
        const invoice = invoices.find((i) => i.order_id === order.id) ?? null;
        const orderPayments = payments.filter((p) => p.order_id === order.id || (invoice && p.invoice_id === invoice.id));
        return {
          id: order.id,
          reference: order.reference,
          status: order.status,
          currency: order.currency,
          subtotal: order.subtotal,
          taxTotal: order.tax_total ?? 0,
          discountTotal: order.discount_total ?? 0,
          total: order.total,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
          userId: order.user_id,
          userEmail: customer?.email ?? null,
          userFullName: customer?.full_name ?? null,
          itemCount: items.filter((i) => i.order_id === order.id).length,
          invoiceId: invoice?.id ?? null,
          invoiceNumber: invoice?.number ?? null,
          invoiceStatus: invoice?.status ?? null,
          paymentStatus: orderPayments.some((p) => p.status === 'succeeded') ? 'paid'
            : orderPayments.some((p) => p.status === 'pending') ? 'pending'
              : orderPayments.length > 0 ? 'failed' : 'none',
        };
      }),
      total,
      limit: query.limit,
      offset: query.offset,
      filters: {
        status: query.status ?? null, userId: query.userId ?? null, reference: query.reference ?? null,
        from: query.from ?? null, to: query.to ?? null,
      },
    });
  }));

  /** Everything the platform actually knows about one order, from the rows it created for it. */
  router.get('/api/v1/admin/orders/:id', staff(async (ctx) => {
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const order = await store.table('orders').findById(ctx.params.id);
    if (!order) throw new NotFoundError('No order was found with that id');

    const customer = order.user_id ? await store.table('users').findById(order.user_id) : null;
    const { rows: items } = await store.table('order_items').find({ order_id: order.id });
    const { rows: invoices } = await store.table('invoices').find({ order_id: order.id }, { orderBy: '-created_at' });

    const billing = [];
    for (const invoice of invoices) {
      const [{ rows: ledger }, { rows: payments }] = await Promise.all([
        store.table('billing_ledger').find({ invoice_id: invoice.id }, { orderBy: 'created_at' }),
        store.table('payments').find({ invoice_id: invoice.id }, { orderBy: 'created_at' }),
      ]);
      billing.push({
        invoice: {
          id: invoice.id, number: invoice.number, status: invoice.status, currency: invoice.currency,
          subtotalAmount: invoice.subtotal, discountAmount: invoice.discount_total ?? 0, taxAmount: invoice.tax_total ?? 0,
          totalAmount: invoice.total, amountPaid: invoice.amount_paid, dueDate: invoice.due_at,
          issuedAt: invoice.issued_at, paidAt: invoice.paid_at ?? null,
        },
        ledger: ledger.map((l) => ({
          id: l.id, entryType: l.entry_type, amount: l.amount, currency: l.currency,
          description: l.description, createdAt: l.created_at,
        })),
        payments: payments.map(paymentDto),
      });
    }

    // What the order turned into. Installations carry a real `order_id`; services are matched on the
    // same link `lib/order-provisioning.js` uses, so this is the same join the provisioner performs.
    const installations = (await store.table('application_installations').all()).filter((row) => row.order_id === order.id);
    const services = (await store.table('customer_services').all()).filter((row) => row.order_id === order.id);
    const serviceIds = new Set(services.map((row) => row.id));
    const jobs = (await store.table('provisioning_jobs').all())
      .filter((row) => (row.resource_type === 'order' && row.resource_id === order.id) || serviceIds.has(row.service_id));
    const deployments = (await store.table('deployments').all())
      .filter((row) => installations.some((inst) => inst.id === row.installation_id));

    const orderPayments = await store.table('payments').find({ order_id: order.id });
    const settled = orderPayments.rows.some((p) => p.status === 'succeeded');
    // The invoice a refund would run through, when the order has one that is refundable at all.
    const refundInvoice = invoices.find((i) => ['paid', 'unpaid'].includes(i.status)) ?? null;

    ctx.json({
      order: {
        id: order.id,
        reference: order.reference,
        status: order.status,
        currency: order.currency,
        subtotal: order.subtotal,
        taxTotal: order.tax_total ?? 0,
        discountTotal: order.discount_total ?? 0,
        total: order.total,
        cartId: order.cart_id ?? null,
        createdAt: order.created_at,
        updatedAt: order.updated_at,
        customer: {
          id: order.user_id ?? null,
          email: customer?.email ?? null,
          fullName: customer?.full_name ?? null,
          status: customer?.status ?? null,
        },
        items: await orderItemDtos(store, order, items),
        billing,
        fulfilment: {
          installations: installations.map((row) => ({
            id: row.id, name: row.name, status: row.status, domain: row.domain ?? null,
            healthStatus: row.health_status ?? null, serverId: row.server_id ?? null,
            deployments: deployments.filter((d) => d.installation_id === row.id).map((d) => ({
              id: d.id, action: d.action, status: d.status, errorCode: d.error_code ?? null, createdAt: d.created_at,
            })),
          })),
          services: services.map((row) => ({
            id: row.id, label: row.label ?? null, status: row.status, domain: row.domain ?? null, serverId: row.server_id ?? null,
          })),
          provisioningJobs: jobs.map((row) => ({
            id: row.id, kind: row.kind, status: row.status, attempts: row.attempts,
            error: row.error ?? null, createdAt: row.created_at, finishedAt: row.finished_at ?? null,
          })),
        },
        // The guards the cancel route enforces, reported up front so staff tooling does not have to
        // discover them by trying: only a pending order that never settled can be cancelled, and when
        // money has moved the honest next step is named rather than implied.
        cancellation: {
          cancellable: order.status === 'pending' && !settled,
          reason: order.status === 'pending' && !settled
            ? null
            : settled
              ? 'This order has a settled payment; refund its invoice instead.'
              : `Order status is '${order.status}'; only pending orders can be cancelled.`,
          refundPath: refundInvoice ? `/api/v1/admin/invoices/${refundInvoice.id}/refund` : null,
        },
      },
    });
  }));

  /**
   * Cancel a pending order.
   *
   * Refused with a named reason when money has already moved: a paid order is not cancellable here,
   * because "cancelled" would hide a settled payment — the refund route is the honest path and the
   * refusal says so. Cancelling voids the order's unpaid invoice, fails its pending payment attempts
   * with the reason attached, and records who did it and why.
   */
  const admin = (handler) => async (ctx) => {
    await asAdmin(ctx, deps);
    return handler(ctx);
  };

  router.post('/api/v1/admin/orders/:id/cancel', admin(async (ctx) => {
    if (!UUID_RE.test(String(ctx.params.id ?? ''))) throw new ValidationError('id must be a valid UUID');
    const body = await ctx.validate(v.object({ reason: v.string().trim().min(1).max(2000) }));

    const order = await store.table('orders').findById(ctx.params.id);
    if (!order) throw new NotFoundError('No order was found with that id');
    if (order.status !== 'pending') {
      throw new ValidationError(`Cannot cancel an order with status '${order.status}' — a settled order is refunded instead (POST /api/v1/admin/invoices/:id/refund)`);
    }

    const { rows: orderPayments } = await store.table('payments').find({ order_id: order.id });
    if (orderPayments.some((p) => p.status === 'succeeded')) {
      throw new ValidationError('This order has a settled payment — refund the invoice instead of cancelling the order');
    }

    const { rows: invoices } = await store.table('invoices').find({ order_id: order.id });
    await store.transaction(async (tx) => {
      for (const invoice of invoices) {
        const { rows: pending } = await tx.table('payments').find({ invoice_id: invoice.id, status: 'pending' });
        for (const payment of pending) {
          await tx.table('payments').updateById(payment.id, {
            status: 'failed',
            rejection_reason: `Order cancelled: ${body.reason}`,
            confirmed_by: ctx.user.id,
          });
        }
        if (invoice.status === 'unpaid') await tx.table('invoices').updateById(invoice.id, { status: 'void' });
      }
      await tx.table('orders').updateById(order.id, { status: 'cancelled', updated_at: new Date().toISOString() });
    });

    await store.table('audit_logs').insert({
      id: uuidv7(),
      actor_id: ctx.user.id,
      actor_role: ctx.user.role,
      action: 'admin_order_cancelled',
      entity_type: 'order',
      entity_id: order.id,
      ip_address: ctx.ip,
      user_agent: ctx.userAgent,
      after: {
        orderId: order.id, orderNumber: order.reference, customerId: order.user_id,
        total: order.total, currency: order.currency,
        voidedInvoices: invoices.filter((i) => i.status === 'unpaid').map((i) => i.number),
        reason: body.reason,
      },
    });

    const updated = await store.table('orders').findById(order.id);
    const { rows: after } = await store.table('invoices').find({ order_id: order.id });
    ctx.json({
      order: {
        id: updated.id, reference: updated.reference, status: updated.status,
        currency: updated.currency, total: updated.total, updatedAt: updated.updated_at,
      },
      voidedInvoices: after.filter((i) => i.status === 'void').map((i) => ({ id: i.id, number: i.number })),
    });
  }));
}

module.exports = { name, register };
