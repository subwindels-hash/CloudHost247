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
const REFUND_MODAL_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'components', 'AdminRefundModal.jsx'), 'utf8');
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

    // -- refund lifecycle (refund modal: mandatory reason, partial -> full, cap refuses over-refund) --
    await app.store.table('invoices').updateById(refundId, { amount_paid: 9.99, status: 'paid' });
    const noReason = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/invoices/${refundId}/refund`, body: { amount: 5 },
    }, admin);
    assert.strictEqual(noReason.status, 400, 'the audit reason is mandatory');

    const partial = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/invoices/${refundId}/refund`,
      body: { amount: 3.5, reason: 'partial goodwill' },
    }, admin);
    assert.strictEqual(partial.status, 200, JSON.stringify(partial.data));
    assert.strictEqual(partial.data.refunded, 3.5, 'refund result reads the refunded amount');
    assert.strictEqual(partial.data.status, 'partially_refunded', 'a partial refund says so');
    const mid = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/invoices/${refundId}` }, admin);
    assert.strictEqual(mid.data.invoice.status, 'partially_refunded');
    assert.strictEqual(mid.data.invoice.refundedAmount, 3.5, 'detail reports the refunded total');

    const over = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/invoices/${refundId}/refund`,
      body: { amount: 100, reason: 'way too much' },
    }, admin);
    assert.strictEqual(over.status, 400, 'over-refunding is refused');
    assert.strictEqual(over.data.error, 'INVALID_REFUND_AMOUNT', 'refused by name');

    const rest = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/invoices/${refundId}/refund`, body: { reason: 'return the rest' },
    }, admin);
    assert.strictEqual(rest.status, 200, JSON.stringify(rest.data));
    assert.strictEqual(rest.data.refunded, 6.49, 'an omitted amount refunds the remaining balance');
    assert.strictEqual(rest.data.status, 'refunded');
    const after = await jsonFetch(base, { method: 'GET', path: `/api/v1/admin/invoices/${refundId}` }, admin);
    assert.strictEqual(after.data.invoice.status, 'refunded');

    const again = await jsonFetch(base, {
      method: 'POST', path: `/api/v1/admin/invoices/${refundId}/refund`, body: { reason: 'one more' },
    }, admin);
    assert.strictEqual(again.status, 400, 'a fully refunded invoice has nothing left to refund');

    // -- invoices directory search: customer email or invoice number --
    const byEmail = await jsonFetch(base, {
      method: 'GET', path: '/api/v1/admin/invoices?search=bill-screen-cust',
    }, admin);
    assert.strictEqual(byEmail.status, 200, JSON.stringify(byEmail.data));
    assert.ok(byEmail.data.invoices.length >= 3, 'email search finds the customer invoices');
    for (const row of byEmail.data.invoices) {
      assert.match(String(row.userEmail ?? ''), /bill-screen-cust/, 'rows join the customer email');
    }
    const numberTerm = after.data.invoice.invoiceNumber;
    const byNumber = await jsonFetch(base, {
      method: 'GET', path: `/api/v1/admin/invoices?search=${encodeURIComponent(numberTerm)}`,
    }, admin);
    assert.ok(
      byNumber.data.invoices.some((row) => row.number === numberTerm),
      'number search finds its invoice',
    );
    const noMatch = await jsonFetch(base, {
      method: 'GET', path: '/api/v1/admin/invoices?search=nothing-matches-this',
    }, admin);
    assert.strictEqual(noMatch.data.invoices.length, 0, 'a miss returns an empty page');

    // -- global ledger filters --
    const refunds = await jsonFetch(base, {
      method: 'GET', path: '/api/v1/admin/billing/ledger?entryType=refund',
    }, admin);
    assert.ok(refunds.data.ledger.length >= 2, 'the refund rows are in the ledger');
    for (const row of refunds.data.ledger) {
      assert.strictEqual(row.entryType, 'refund', 'the entry-type filter is exact');
    }
    const forInvoice = await jsonFetch(base, {
      method: 'GET', path: `/api/v1/admin/billing/ledger?invoiceId=${refundId}`,
    }, admin);
    assert.ok(forInvoice.data.ledger.length >= 3, 'charge + refunds for the refunded invoice');
    for (const row of forInvoice.data.ledger) {
      assert.strictEqual(row.invoiceId, refundId, 'the invoice filter is exact');
    }
    const today = new Date().toISOString().slice(0, 10);
    const dated = await jsonFetch(base, {
      method: 'GET', path: `/api/v1/admin/billing/ledger?fromDate=${today}&toDate=${today}`,
    }, admin);
    assert.ok(dated.data.ledger.length > 0, 'today range includes today');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const future = await jsonFetch(base, {
      method: 'GET', path: `/api/v1/admin/billing/ledger?fromDate=${tomorrow}&toDate=${tomorrow}`,
    }, admin);
    assert.strictEqual(future.data.ledger.length, 0, 'a future date range is empty');

    // -- staff gate: a customer cannot use any of it --
    const denied = await jsonFetch(base, { method: 'GET', path: '/api/v1/admin/billing/ledger' }, customer);
    assert.strictEqual(denied.status, 403);

    // -- pin the screens + client to this contract --
    for (const key of ['charges', 'outstanding', 'otherCurrencies']) {
      assert.ok(BILLING_SRC.includes(key), `AdminBillingPage renders response key '${key}'`);
    }
    assert.ok(BILLING_SRC.includes('inv-search') && BILLING_SRC.includes('search'), 'AdminBillingPage carries the search bar');
    assert.ok(BILLING_SRC.includes('userEmail'), 'AdminBillingPage renders the joined customer email');
    for (const key of ['invoiceNumber', 'subtotalAmount', 'payments']) {
      assert.ok(DETAIL_SRC.includes(key), `AdminInvoiceDetailPage renders response key '${key}'`);
    }
    assert.ok(DETAIL_SRC.includes('AdminRefundModal'), 'the detail page opens the refund modal');
    assert.ok(DETAIL_SRC.includes('amountPaid'), 'the detail page gates the refund button on the paid amount');
    // The refund modal itself: the numbers the auditor needs and the mandatory reason.
    for (const key of ['Maximum refundable', 'Already refunded', 'refundedAmount', 'adminApi.adminRefundInvoice', 'required']) {
      assert.ok(REFUND_MODAL_SRC.includes(key), `AdminRefundModal shows/collects '${key}'`);
    }
    assert.ok(LEDGER_SRC.includes('otherCurrencies') && LEDGER_SRC.includes('entryType'), 'AdminLedgerPage renders its keys');
    for (const key of ['led-type', 'led-user', 'led-invoice', 'led-from', 'led-to']) {
      assert.ok(LEDGER_SRC.includes(key), `AdminLedgerPage carries filter '${key}'`);
    }
    assert.ok(API_CLIENT_SRC.includes('export const adminApi'), 'api client exports adminApi');
    for (const pathPart of ['/api/v1/admin/invoices', '/api/v1/admin/billing/ledger', '/api/v1/admin/billing/reconciliation', '/confirm-manual', '/reject-manual']) {
      assert.ok(API_CLIENT_SRC.includes(pathPart), `adminApi covers ${pathPart}`);
    }
  } finally {
    await close();
  }
});
