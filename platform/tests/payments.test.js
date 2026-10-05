/**
 * Integration tests for the invoice-scoped payment routes (payments.ts):
 * POST /invoices/:id/payments and GET /payments/:id.
 *
 * The ownership rule under test is the one the original states explicitly — a payment that exists
 * but belongs to another customer must be indistinguishable from one that does not (404, never 403).
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

async function createInvoice(base, token) {
  await jsonFetch(base, {
    path: '/api/v1/cart/items', method: 'POST',
    body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
  }, token);
  const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, token);
  assert.strictEqual(order.status, 201);
  return order.data.invoiceId;
}

test('integration: invoice-scoped payments', async (t) => {
  const { base, app, close } = await startServer({
    SANDBOX_PAYMENTS: 'true',
    SANDBOX_GATEWAY_WEBHOOK_SECRET: 'payments-test-secret-0123456789',
  });
  try {
    await seedCatalog(app.store);
    const owner = (await register(base, 'pay-owner@example.com')).data.accessToken;
    const other = (await register(base, 'pay-other@example.com')).data.accessToken;
    const invoiceId = await createInvoice(base, owner);

    let paymentId;
    await t.test('POST /invoices/:id/payments initiates a pending payment', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/invoices/${invoiceId}/payments`, method: 'POST', body: { gateway: 'sandbox' },
      }, owner);
      assert.strictEqual(res.status, 201);
      const payment = res.data.payment;
      paymentId = payment.id;

      // toPaymentDTO contract from the original.
      assert.strictEqual(payment.invoiceId, invoiceId);
      assert.strictEqual(payment.provider, 'sandbox', 'the gateway is exposed as provider');
      assert.strictEqual(payment.status, 'pending');
      assert.strictEqual(payment.currency, 'USD');
      assert.ok(Number(payment.amount) > 0);
      assert.strictEqual(payment.instructions, null);
      assert.ok(payment.initiatedAt, 'initiatedAt is stamped');
    });

    await t.test('the gateway is validated and the invoice must be the caller’s', async () => {
      const badGateway = await jsonFetch(base, {
        path: `/api/v1/invoices/${invoiceId}/payments`, method: 'POST', body: { gateway: 'paypal' },
      }, owner);
      assert.strictEqual(badGateway.status, 400);

      const notMine = await jsonFetch(base, {
        path: `/api/v1/invoices/${invoiceId}/payments`, method: 'POST', body: { gateway: 'sandbox' },
      }, other);
      assert.strictEqual(notMine.status, 404, "another customer's invoice is a 404, not a 403");

      const badId = await jsonFetch(base, {
        path: '/api/v1/invoices/not-a-uuid/payments', method: 'POST', body: { gateway: 'sandbox' },
      }, owner);
      assert.strictEqual(badId.status, 400, 'id must be a valid UUID');
    });

    await t.test('GET /payments/:id returns the DTO to its owner only', async () => {
      const mine = await jsonFetch(base, { path: `/api/v1/payments/${paymentId}` }, owner);
      assert.strictEqual(mine.status, 200);
      assert.strictEqual(mine.data.payment.id, paymentId);
      assert.strictEqual(mine.data.payment.provider, 'sandbox');
      assert.strictEqual(mine.data.payment.status, 'pending');

      const theirs = await jsonFetch(base, { path: `/api/v1/payments/${paymentId}` }, other);
      assert.strictEqual(theirs.status, 404, 'never a 403');

      const badId = await jsonFetch(base, { path: '/api/v1/payments/not-a-uuid' }, owner);
      assert.strictEqual(badId.status, 400);

      const missing = await jsonFetch(base, { path: '/api/v1/payments/00000000-0000-0000-0000-000000000099' }, owner);
      assert.strictEqual(missing.status, 404);
    });

    await t.test('the detail reflects a settled payment', async () => {
      const complete = await jsonFetch(base, {
        path: `/api/v1/payments/${paymentId}/sandbox/complete`, method: 'POST', body: {},
      }, owner);
      assert.strictEqual(complete.status, 200);
      assert.strictEqual(complete.data.applied, true);

      const after = await jsonFetch(base, { path: `/api/v1/payments/${paymentId}` }, owner);
      assert.notStrictEqual(after.data.payment.status, 'pending', 'the webhook moved it on');
      assert.ok(after.data.payment.providerReference, 'the gateway reference is recorded');
    });
  } finally {
    await close();
  }
});
