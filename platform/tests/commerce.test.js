/**
 * Integration tests for the two remaining commerce routes (commerce.ts):
 * PATCH /cart/items/:id and GET /orders/:id.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');

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

test('integration: cart quantity updates and order detail', async (t) => {
  const { base, app, close } = await startServer();
  try {
    await seedCatalog(app.store);
    const owner = (await register(base, 'com-owner@example.com')).data.accessToken;
    const other = (await register(base, 'com-other@example.com')).data.accessToken;

    const added = await jsonFetch(base, {
      path: '/api/v1/cart/items', method: 'POST',
      body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
    }, owner);
    assert.strictEqual(added.status, 201);
    const itemId = added.data.items[0].id;

    await t.test('PATCH /cart/items/:id updates the quantity and returns the cart', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/cart/items/${itemId}`, method: 'PATCH', body: { quantity: 3 },
      }, owner);
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.cart, 'the refreshed cart is returned');
      const line = res.data.cart.items.find((i) => i.id === itemId);
      assert.strictEqual(line.quantity, 3);
      assert.strictEqual(res.data.cart.subtotal, 29.97, 'subtotal recomputed');
    });

    await t.test('the quantity is bounded by MAX_CART_ITEM_QUANTITY', async () => {
      const tooMany = await jsonFetch(base, {
        path: `/api/v1/cart/items/${itemId}`, method: 'PATCH', body: { quantity: 21 },
      }, owner);
      assert.strictEqual(tooMany.status, 400, 'the original caps a line at 20');

      const zero = await jsonFetch(base, {
        path: `/api/v1/cart/items/${itemId}`, method: 'PATCH', body: { quantity: 0 },
      }, owner);
      assert.strictEqual(zero.status, 400);

      const badId = await jsonFetch(base, {
        path: '/api/v1/cart/items/not-a-uuid', method: 'PATCH', body: { quantity: 2 },
      }, owner);
      assert.strictEqual(badId.status, 400, 'id must be a valid UUID');
    });

    await t.test("another customer's cart line is a 404", async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/cart/items/${itemId}`, method: 'PATCH', body: { quantity: 5 },
      }, other);
      assert.strictEqual(res.status, 404);
    });

    let orderId;
    await t.test('checkout produces an order that GET /orders/:id can fetch', async () => {
      const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, owner);
      assert.strictEqual(order.status, 201);
      orderId = order.data.orderId;

      const detail = await jsonFetch(base, { path: `/api/v1/orders/${orderId}` }, owner);
      assert.strictEqual(detail.status, 200);
      const dto = detail.data.order;

      // toOrderSummaryDTO contract.
      assert.strictEqual(dto.id, orderId);
      assert.ok(dto.orderNumber, 'orderNumber is populated');
      assert.strictEqual(dto.currency, 'USD');
      assert.strictEqual(Number(dto.totalAmount), 29.97);
      assert.strictEqual(dto.paymentStatus, 'unpaid');
      assert.ok(dto.invoiceId && dto.invoiceNumber, 'the invoice is joined on');

      assert.strictEqual(dto.items.length, 1);
      assert.strictEqual(dto.items[0].quantity, 3);
      assert.strictEqual(dto.items[0].planName, 'Starter');
      assert.strictEqual(dto.items[0].productName, 'Web Hosting');
      assert.strictEqual(Number(dto.items[0].lineTotalAmount), 29.97);
      assert.strictEqual(dto.items[0].billingPeriod, 'monthly');
    });

    await t.test('order detail is owner-scoped and id-validated', async () => {
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/orders/${orderId}` }, other)).status, 404);
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/orders/not-a-uuid' }, owner)).status, 400);
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/orders/00000000-0000-0000-0000-000000000099' }, owner)).status,
        404,
      );
    });

    await t.test('paying the invoice is reflected in paymentStatus', async () => {
      const invoiceId = (await jsonFetch(base, { path: `/api/v1/orders/${orderId}` }, owner)).data.order.invoiceId;
      await app.store.table('invoices').updateById(invoiceId, { status: 'paid' });

      const after = await jsonFetch(base, { path: `/api/v1/orders/${orderId}` }, owner);
      assert.strictEqual(after.data.order.paymentStatus, 'paid');
    });
  } finally {
    await close();
  }
});
