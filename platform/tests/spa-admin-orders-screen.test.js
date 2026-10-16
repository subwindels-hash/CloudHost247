'use strict';

/**
 * Admin orders screen contract (AdminOrdersPage + AdminOrderDetailPage).
 *
 * Walks the exact HTTP sequence the screens issue — list + filters, detail (summary, items,
 * billing, fulfilment, the server's own cancellation guards), cancel with mandatory reason — over
 * the real app with orders created through the cart. Asserts every response key the screens render
 * and pins the page sources to the same keys. Also checks the settled-order honesty contract: the
 * detail names why cancellation is refused and where the refund runs instead.
 * (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const LIST_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminOrdersPage.jsx'), 'utf8');
const DETAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminOrderDetailPage.jsx'), 'utf8');
const API_CLIENT_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'lib', 'api.js'), 'utf8');

async function seedCatalog(store) {
  const product = await store.table('catalog_products').insert({
    slug: 'web-hosting', name: 'Web Hosting', category: 'hosting', status: 'active',
  });
  const plan = await store.table('catalog_product_plans').insert({
    product_id: product.id, slug: 'starter', name: 'Starter', status: 'active',
  });
  await store.table('catalog_plan_pricing').insert({
    plan_id: plan.id, currency: 'USD', billing_cycle: 'monthly',
    price: 9.99, setup_fee: 0, is_active: true,
  });
}

async function adminToken(base, app, email = 'orders-screen-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

async function newOrder(base, token) {
  await jsonFetch(base, {
    path: '/api/v1/cart/items', method: 'POST',
    body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
  }, token);
  const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, token);
  return order.data;
}

test('admin orders screens: endpoint sequence and response contract', async (t) => {
  const { base, app, close } = await startServer({ SANDBOX_PAYMENTS: 'true' });
  try {
    await seedCatalog(app.store);
    const customer = (await register(base, 'orders-screen-cust@example.com')).data.accessToken;
    const admin = await adminToken(base, app);

    const pendingOrder = await newOrder(base, customer);
    const settledOrder = await newOrder(base, customer);
    // Mark the second order as having settled money — the row state the detail's guards read.
    await app.store.table('payments').insert({
      id: '00000000-0000-7000-8000-0000000000f1',
      invoice_id: settledOrder.invoiceId,
      order_id: settledOrder.orderId,
      user_id: (await app.store.table('users').findOne({ email: 'orders-screen-cust@example.com' })).id,
      gateway: 'sandbox', currency: 'USD', amount: 9.99, status: 'succeeded',
    });

    // -- orders list (AdminOrdersPage) --
    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/orders' }, admin);
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.data.orders) && list.data.orders.length >= 2, 'list reads orders');
    assert.ok(typeof list.data.total === 'number' && list.data.filters, 'list reads total + filters');
    const row = list.data.orders.find((o) => o.id === pendingOrder.orderId);
    for (const key of ['id', 'reference', 'status', 'currency', 'total', 'userId', 'userEmail', 'itemCount', 'invoiceId', 'invoiceNumber', 'paymentStatus', 'createdAt']) {
      assert.ok(row[key] !== undefined, `order row reads ${key}`);
    }

    // -- filters the screen sends --
    const filtered = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/orders?status=pending' }, admin);
    assert.strictEqual(filtered.status, 200);
    assert.ok(filtered.data.orders.every((o) => o.status === 'pending'), 'status filter applied');

    // -- order detail (AdminOrderDetailPage) --
    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/orders/${pendingOrder.orderId}` }, admin);
    assert.strictEqual(detail.status, 200);
    const order = detail.data.order;
    for (const key of ['id', 'reference', 'status', 'currency', 'subtotal', 'taxTotal', 'discountTotal', 'total', 'customer', 'items', 'billing', 'fulfilment', 'cancellation']) {
      assert.ok(order[key] !== undefined, `detail reads order.${key}`);
    }
    assert.ok(order.customer && 'email' in order.customer, 'detail reads customer.email');
    assert.ok(Array.isArray(order.billing) && order.billing[0].invoice, 'billing block reads invoices');
    for (const key of ['id', 'number', 'status', 'totalAmount']) {
      assert.ok(order.billing[0].invoice[key] !== undefined, `billing invoice reads ${key}`);
    }
    assert.ok(order.fulfilment && Array.isArray(order.fulfilment.provisioningJobs), 'fulfilment reads provisioningJobs');
    assert.strictEqual(order.cancellation.cancellable, true, 'pending unsettled order reports cancellable');

    // -- cancel with mandatory reason (cancel form) --
    const cancelled = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/orders/${pendingOrder.orderId}/cancel`, body: { reason: 'customer request' },
    }, admin);
    assert.strictEqual(cancelled.status, 200, JSON.stringify(cancelled.data));
    assert.strictEqual(cancelled.data.order.status, 'cancelled', 'cancel result reads order.status');

    // -- settled-order honesty contract: refused up front, with the refund path named --
    const settledDetail = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/orders/${settledOrder.orderId}` }, admin);
    assert.strictEqual(settledDetail.data.order.cancellation.cancellable, false);
    assert.ok(settledDetail.data.order.cancellation.reason.includes('refund'), 'the refusal names the refund path');
    assert.ok(settledDetail.data.order.cancellation.refundPath, 'refundPath is reported');
    const refused = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/orders/${settledOrder.orderId}/cancel`, body: { reason: 'try anyway' },
    }, admin);
    assert.strictEqual(refused.status, 400, 'cancel is refused once money moved');

    // -- staff gate --
    const denied = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/orders' }, customer);
    assert.strictEqual(denied.status, 403);

    // -- pin the screens + client to this contract --
    for (const key of ['paymentStatus', 'invoiceNumber']) {
      assert.ok(LIST_SRC.includes(key), `AdminOrdersPage renders response key '${key}'`);
    }
    for (const key of ['fulfilment', 'cancellation', 'provisioningJobs', 'refundPath']) {
      assert.ok(DETAIL_SRC.includes(key), `AdminOrderDetailPage renders response key '${key}'`);
    }
    assert.ok(API_CLIENT_SRC.includes('export const adminApi'), 'api client exports adminApi');
    for (const pathPart of ['/api/v1/admin/orders', '/cancel']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
