/**
 * Integration tests for the four admin-billing routes that were still missing:
 * GET /admin/invoices/:id, POST /admin/invoices/:id/cancel and the manual-payment
 * confirm/reject pair.
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

async function adminToken(base, app, email = 'bill-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

test('integration: admin billing invoice detail and cancellation', async (t) => {
  const { base, app, close } = await startServer({ SANDBOX_PAYMENTS: 'true' });
  try {
    await seedCatalog(app.store);
    const customer = (await register(base, 'bill-cust@example.com')).data.accessToken;
    const admin = await adminToken(base, app);

    await jsonFetch(base, {
      path: '/api/v1/cart/items', method: 'POST',
      body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
    }, customer);
    const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, customer);
    const invoiceId = order.data.invoiceId;

    await t.test('the staff surface is closed to customers', async () => {
      assert.strictEqual((await jsonFetch(base, { path: `/api/v1/admin/invoices/${invoiceId}` }, customer)).status, 403);
      assert.strictEqual(
        (await jsonFetch(base, { path: `/api/v1/admin/invoices/${invoiceId}/cancel`, method: 'POST', body: { reason: 'x' } }, customer)).status,
        403,
      );
    });

    await t.test('GET /admin/invoices/:id returns the full detail', async () => {
      // Give the invoice a payment attempt and a ledger entry to join on.
      await jsonFetch(base, {
        path: '/api/v1/invoices/' + invoiceId + '/payments', method: 'POST', body: { gateway: 'sandbox' },
      }, customer);

      const res = await jsonFetch(base, { path: `/api/v1/admin/invoices/${invoiceId}` }, admin);
      assert.strictEqual(res.status, 200);
      const inv = res.data.invoice;

      assert.strictEqual(inv.id, invoiceId);
      assert.ok(inv.invoiceNumber, 'invoiceNumber');
      assert.ok(inv.orderId && inv.orderNumber, 'the order is joined on');
      assert.strictEqual(inv.status, 'unpaid');
      assert.strictEqual(inv.currency, 'USD');
      assert.strictEqual(Number(inv.totalAmount), 9.99);
      assert.strictEqual(inv.userEmail, 'bill-cust@example.com', 'the customer is identified');
      assert.ok(inv.dueDate, 'dueDate');

      assert.strictEqual(inv.items.length, 1);
      assert.strictEqual(inv.items[0].quantity, 1);
      assert.ok(Array.isArray(inv.ledger) && inv.ledger.length >= 1, 'ledger entries are included');
      assert.strictEqual(inv.ledger[0].entryType, 'charge');
      assert.strictEqual(inv.payments.length, 1, 'payment attempts are included');
      assert.strictEqual(inv.payments[0].provider, 'sandbox');
    });

    await t.test('the id is validated and a missing invoice is a 404', async () => {
      assert.strictEqual((await jsonFetch(base, { path: '/api/v1/admin/invoices/not-a-uuid' }, admin)).status, 400);
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/invoices/00000000-0000-0000-0000-000000000099' }, admin)).status,
        404,
      );
    });

    await t.test('cancellation requires a reason', async () => {
      const empty = await jsonFetch(base, {
        path: `/api/v1/admin/invoices/${invoiceId}/cancel`, method: 'POST', body: { reason: '' },
      }, admin);
      assert.strictEqual(empty.status, 400, 'a reason is mandatory for audit compliance');

      const missing = await jsonFetch(base, {
        path: `/api/v1/admin/invoices/${invoiceId}/cancel`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(missing.status, 400);
    });

    await t.test('cancelling voids the invoice, cancels the order and kills pending payments', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/invoices/${invoiceId}/cancel`, method: 'POST', body: { reason: 'Customer asked to cancel' },
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.invoice.status, 'void', 'the invoice detail is returned');

      const stored = await app.store.table('invoices').findById(invoiceId);
      assert.strictEqual(stored.status, 'void');
      assert.strictEqual((await app.store.table('orders').findById(stored.order_id)).status, 'cancelled');

      const { rows: payments } = await app.store.table('payments').find({ invoice_id: invoiceId });
      assert.ok(payments.every((p) => p.status === 'failed'), 'pending attempts are cancelled');
      assert.match(payments[0].rejection_reason, /Invoice cancelled: Customer asked to cancel/);

      const auditRow = await app.store.table('audit_logs').findOne({ action: 'admin_invoice_cancelled', entity_id: invoiceId });
      assert.ok(auditRow, 'the cancellation is audited');
      assert.strictEqual(auditRow.after.reason, 'Customer asked to cancel', 'the reason is recorded');
      assert.strictEqual(auditRow.entity_type, 'invoice');
    });

    await t.test('a non-unpaid invoice cannot be cancelled again', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/invoices/${invoiceId}/cancel`, method: 'POST', body: { reason: 'again' },
      }, admin);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /Cannot cancel an invoice with status 'void'/);
    });

    await t.test('cancelling an unknown invoice is a 404', async () => {
      const res = await jsonFetch(base, {
        path: '/api/v1/admin/invoices/00000000-0000-0000-0000-000000000099/cancel',
        method: 'POST', body: { reason: 'nope' },
      }, admin);
      assert.strictEqual(res.status, 404);
      assert.match(res.data.message, /No invoice was found with that id/);
    });
  } finally {
    await close();
  }
});

test('integration: manual payment confirmation and rejection', async (t) => {
  const { base, app, close } = await startServer({ SANDBOX_PAYMENTS: 'true' });
  try {
    await seedCatalog(app.store);
    const customer = (await register(base, 'manual-cust@example.com')).data.accessToken;
    const admin = await adminToken(base, app, 'manual-admin@example.com');

    async function newInvoiceId() {
      await jsonFetch(base, {
        path: '/api/v1/cart/items', method: 'POST',
        body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
      }, customer);
      const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, customer);
      return order.data.invoiceId;
    }

    const payManual = async (invoiceId) => {
      const res = await jsonFetch(base, {
        path: `/api/v1/invoices/${invoiceId}/payments`, method: 'POST', body: { gateway: 'manual' },
      }, customer);
      assert.strictEqual(res.status, 201);
      return res.data.payment.id;
    };

    await t.test('confirming a manual payment settles the invoice', async () => {
      const invoiceId = await newInvoiceId();
      const paymentId = await payManual(invoiceId);

      const res = await jsonFetch(base, {
        path: `/api/v1/admin/payments/${paymentId}/confirm-manual`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.payment.id, paymentId);
      assert.strictEqual(res.data.payment.provider, 'manual', 'exposed as provider');
      assert.notStrictEqual(res.data.payment.status, 'pending');

      const invoice = await app.store.table('invoices').findById(invoiceId);
      assert.strictEqual(invoice.status, 'paid', 'the invoice is settled');
      assert.ok(invoice.amount_paid > 0);
    });

    await t.test('confirming twice is a 409, not a 400', async () => {
      const invoiceId = await newInvoiceId();
      const paymentId = await payManual(invoiceId);

      assert.strictEqual(
        (await jsonFetch(base, { path: `/api/v1/admin/payments/${paymentId}/confirm-manual`, method: 'POST', body: {} }, admin)).status,
        200,
      );
      const again = await jsonFetch(base, {
        path: `/api/v1/admin/payments/${paymentId}/confirm-manual`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(again.status, 409);
      assert.match(again.data.message, /already been resolved/);
    });

    await t.test('rejecting a manual payment fails it and records the reason', async () => {
      const invoiceId = await newInvoiceId();
      const paymentId = await payManual(invoiceId);

      const noReason = await jsonFetch(base, {
        path: `/api/v1/admin/payments/${paymentId}/reject-manual`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(noReason.status, 400);

      const res = await jsonFetch(base, {
        path: `/api/v1/admin/payments/${paymentId}/reject-manual`, method: 'POST',
        body: { reason: 'No funds received' },
      }, admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.payment.status, 'failed');
      assert.strictEqual(res.data.payment.failureReason, 'No funds received');

      assert.strictEqual((await app.store.table('invoices').findById(invoiceId)).status, 'unpaid', 'the invoice stays unpaid');
    });

    await t.test('only manual payments can be confirmed or rejected', async () => {
      const invoiceId = await newInvoiceId();
      const sandbox = await jsonFetch(base, {
        path: `/api/v1/invoices/${invoiceId}/payments`, method: 'POST', body: { gateway: 'sandbox' },
      }, customer);
      const res = await jsonFetch(base, {
        path: `/api/v1/admin/payments/${sandbox.data.payment.id}/confirm-manual`, method: 'POST', body: {},
      }, admin);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /manual\/offline gateway/);
    });

    await t.test('the id is validated and an unknown payment is a 404', async () => {
      assert.strictEqual(
        (await jsonFetch(base, { path: '/api/v1/admin/payments/not-a-uuid/confirm-manual', method: 'POST', body: {} }, admin)).status,
        400,
      );
      const unknown = await jsonFetch(base, {
        path: '/api/v1/admin/payments/00000000-0000-0000-0000-000000000099/confirm-manual', method: 'POST', body: {},
      }, admin);
      assert.strictEqual(unknown.status, 404);
      assert.match(unknown.data.message, /No payment was found with that id/);
    });
  } finally {
    await close();
  }
});
