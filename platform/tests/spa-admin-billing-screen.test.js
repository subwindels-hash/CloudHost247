'use strict';

/**
 * Admin billing screen contract (AdminBillingPage + AdminInvoiceDetailPage + AdminLedgerPage).
 *
 * Walks the exact HTTP sequence the screens issue — invoice list + status filter, reconciliation,
 * ledger, invoice detail, manual payment confirm/reject, refund, void-with-reason — against the
 * real app, driving real orders through the cart like staff tooling would see them. Asserts every
 * response key the screens render and pins the page sources to the same keys.
 * (Browser rendering itself is covered by `npm run smoke` in spa/.)
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const BILLING_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminBillingPage.jsx'), 'utf8');
const DETAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminInvoiceDetailPage.jsx'), 'utf8');
const LEDGER_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'AdminLedgerPage.jsx'), 'utf8');
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

async function adminToken(base, app, email = 'bill-screen-admin@example.com') {
  await register(base, email, 'SuperSecret123!');
  const user = await app.store.table('users').findOne({ email });
  await app.store.table('users').updateById(user.id, { role: 'super_admin' });
  const login = await jsonFetch(base, {
    path: '/api/v1/auth/login', method: 'POST', body: { email, password: 'SuperSecret123!' },
  });
  return login.data.accessToken;
}

async function newInvoice(base, token) {
  await jsonFetch(base, {
    path: '/api/v1/cart/items', method: 'POST',
    body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
  }, token);
  const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, token);
  return order.data.invoiceId;
}

test('admin billing screens: endpoint sequence and response contract', async (t) => {
  const { base, app, close } = await startServer({ SANDBOX_PAYMENTS: 'true' });
  try {
    await seedCatalog(app.store);
    const customer = (await register(base, 'bill-screen-cust@example.com')).data.accessToken;
    const admin = await adminToken(base, app);

    const confirmId = await newInvoice(base, customer);
    const voidId = await newInvoice(base, customer);
    const refundId = await newInvoice(base, customer);

    // -- invoices list (AdminBillingPage) --
    const list = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/invoices' }, admin);
    assert.strictEqual(list.status, 200);
    assert.ok(Array.isArray(list.data.invoices) && list.data.invoices.length >= 3, 'list reads invoices');
    assert.ok(typeof list.data.total === 'number', 'list reads total');
    const row = list.data.invoices.find((r) => r.id === confirmId);
    for (const key of ['id', 'userId', 'number', 'status', 'currency', 'total', 'amountPaid', 'dueAt']) {
      assert.ok(row[key] !== undefined, `invoice row reads ${key}`);
    }

    // -- status filter --
    const filtered = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/invoices?status=unpaid' }, admin);
    assert.strictEqual(filtered.status, 200);
    assert.ok(filtered.data.invoices.every((r) => r.status === 'unpaid'), 'filter sends status');

    // -- reconciliation (money-position card) --
    const recon = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/billing/reconciliation' }, admin);
    assert.strictEqual(recon.status, 200);
    for (const key of ['charges', 'payments', 'refunds', 'credits', 'outstanding', 'entries', 'otherCurrencies', 'note']) {
      assert.ok(key in recon.data, `money position reads ${key}`);
    }

    // -- ledger (AdminLedgerPage) --
    const ledger = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/billing/ledger' }, admin);
    assert.strictEqual(ledger.status, 200);
    assert.ok(Array.isArray(ledger.data.ledger) && ledger.data.ledger.length >= 1, 'ledger reads entries');
    for (const key of ['id', 'userId', 'entryType', 'amount', 'currency', 'description', 'createdAt']) {
      assert.ok(ledger.data.ledger[0][key] !== undefined, `ledger row reads ${key}`);
    }

    // -- invoice detail (AdminInvoiceDetailPage) --
    const detail = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/invoices/${confirmId}` }, admin);
    assert.strictEqual(detail.status, 200);
    const inv = detail.data.invoice;
    for (const key of ['id', 'invoiceNumber', 'userId', 'userEmail', 'status', 'currency', 'subtotalAmount', 'taxAmount', 'totalAmount', 'dueDate', 'items', 'ledger', 'payments']) {
      assert.ok(inv[key] !== undefined, `detail reads invoice.${key}`);
    }

    // -- manual payment confirm (confirm button on a pending manual payment) --
    const pay1 = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/invoices/${confirmId}/payments`, body: { gateway: 'manual' },
    }, customer);
    assert.ok([200, 201].includes(pay1.status), JSON.stringify(pay1.data));
    const confirmed = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/payments/${pay1.data.payment.id}/confirm-manual`,
    }, admin);
    assert.strictEqual(confirmed.status, 200, JSON.stringify(confirmed.data));
    assert.ok(confirmed.data.payment, 'confirm result reads payment');
    for (const key of ['id', 'status', 'amount', 'provider']) {
      assert.ok(confirmed.data.payment[key] !== undefined, `payment reads ${key}`);
    }

    // -- manual payment reject (rejection reason is mandatory in the screen) --
    const pay2 = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/invoices/${voidId}/payments`, body: { gateway: 'manual' },
    }, customer);
    const rejected = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/payments/${pay2.data.payment.id}/reject-manual`,
      body: { reason: 'wrong amount' },
    }, admin);
    assert.strictEqual(rejected.status, 200);
    assert.ok(rejected.data.payment, 'reject result reads payment');

    // -- void unpaid invoice with mandatory reason (void form) --
    const voided = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/invoices/${voidId}/cancel`, body: { reason: 'duplicate order' },
    }, admin);
    assert.strictEqual(voided.status, 200, JSON.stringify(voided.data));
    assert.strictEqual(voided.data.invoice.status, 'void', 'void result reads invoice.status');

    // -- refund a captured payment (refund button; amount_paid set by a settled payment) --
    await app.store.table('invoices').updateById(refundId, { amount_paid: 9.99, status: 'paid' });
    const refunded = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/invoices/${refundId}/refund`,
    }, admin);
    assert.strictEqual(refunded.status, 200, JSON.stringify(refunded.data));
    const after = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/invoices/${refundId}` }, admin);
    assert.strictEqual(after.data.invoice.status, 'refunded');

    // -- staff gate: a customer cannot use any of it --
    const denied = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/billing/ledger' }, customer);
    assert.strictEqual(denied.status, 403);

    // -- pin the screens + client to this contract --
    for (const key of ['charges', 'outstanding', 'otherCurrencies']) {
      assert.ok(BILLING_SRC.includes(key), `AdminBillingPage renders response key '${key}'`);
    }
    for (const key of ['invoiceNumber', 'subtotalAmount', 'payments']) {
      assert.ok(DETAIL_SRC.includes(key), `AdminInvoiceDetailPage renders response key '${key}'`);
    }
    assert.ok(LEDGER_SRC.includes('otherCurrencies') && LEDGER_SRC.includes('entryType'), 'AdminLedgerPage renders its keys');
    assert.ok(API_CLIENT_SRC.includes('export const adminApi'), 'api client exports adminApi');
    for (const pathPart of ['/api/v1/admin/invoices', '/api/v1/admin/billing/ledger', '/api/v1/admin/billing/reconciliation', '/confirm-manual', '/reject-manual']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
