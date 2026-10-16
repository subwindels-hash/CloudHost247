'use strict';

/**
 * Customer billing screen contracts (BillingPage + InvoiceDetailPage — Phase 5E).
 *
 * Walks the exact HTTP sequences those screens issue — the billing overview (invoices list with
 * status filter, subscriptions, ledger), the invoice detail (amount breakdown, gateway list with
 * the server's refusals, payment start, the bounded provider poll, sandbox completion), and the
 * print receipt path — over the real app. Pins the page sources to the features they render and
 * the styles to the @media print receipt rules. (Browser rendering itself is covered by
 * `npm run smoke`.)
 *
 * Money representation note: this platform stores fixed-point 2-decimal major units (round2 in
 * commerce.js) rather than integer cents; the guarantee is the same — no floating-point drift in
 * what the customer sees — and is pinned below via the served amounts.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, jsonFetch, register } = require('./helpers');

const DETAIL_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'InvoiceDetailPage.jsx'), 'utf8');
const LIST_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'pages', 'BillingPage.jsx'), 'utf8');
const STYLES_SRC = fs.readFileSync(path.join(__dirname, '..', 'spa', 'src', 'styles.css'), 'utf8');

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
  const add = await jsonFetch(base, {
    path: '/api/v1/cart/items', method: 'POST',
    body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
  }, token);
  assert.ok(add.status >= 200 && add.status < 300, JSON.stringify(add.data));
  const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, token);
  assert.strictEqual(order.status, 201, JSON.stringify(order.data));
  return order.data.invoiceId;
}

test('billing screens: overview + detail contracts over the real API', async (t) => {
  const harness = await startServer({
    SANDBOX_PAYMENTS: 'true',
    SANDBOX_GATEWAY_WEBHOOK_SECRET: 'billing-screen-secret-0123456789',
  });
  const { base, app, close } = harness;

  try {
    await seedCatalog(app.store);
    const owner = (await register(base, 'bill-screen-owner@example.com')).data.accessToken;
    const other = (await register(base, 'bill-screen-other@example.com')).data.accessToken;
    const invoiceId = await createInvoice(base, owner);

    await t.test('BillingPage load: invoices, subscriptions and ledger arrive as the page reads them', async () => {
      const list = await jsonFetch(base, { path: '/api/v1/invoices' }, owner);
      assert.strictEqual(list.status, 200, JSON.stringify(list.data));
      assert.ok(Array.isArray(list.data.invoices), 'invoices key feeds the table');
      assert.ok(list.data.invoices.some((row) => row.id === invoiceId), 'the seeded invoice lists');
      for (const key of ['id', 'number', 'status', 'issuedAt', 'dueAt', 'total', 'amountPaid', 'currency']) {
        assert.ok(key in list.data.invoices[0], `list row reads ${key}`);
      }

      const subs = await jsonFetch(base, { path: '/api/v1/billing/subscriptions' }, owner);
      assert.strictEqual(subs.status, 200, JSON.stringify(subs.data));
      assert.ok(Array.isArray(subs.data.subscriptions), 'subscriptions key feeds the subscriptions card');

      const ledger = await jsonFetch(base, { path: '/api/v1/billing/ledger' }, owner);
      assert.strictEqual(ledger.status, 200, JSON.stringify(ledger.data));
      assert.ok(Array.isArray(ledger.data.ledger), 'ledger key feeds the ledger card');
    });

    await t.test('InvoiceDetailPage load: amounts, payment methods with refusals, and the poll target', async () => {
      const detail = await jsonFetch(base, { path: `/api/v1/invoices/${invoiceId}` }, owner);
      assert.strictEqual(detail.status, 200, JSON.stringify(detail.data));
      const invoice = detail.data.invoice;
      for (const key of [
        'number', 'status', 'issuedAt', 'dueAt', 'subtotal', 'discountTotal', 'taxTotal',
        'total', 'amountPaid', 'currency',
      ]) {
        assert.ok(key in invoice, `detail reads ${key}`);
      }
      // Fixed-point money: amounts come back as 2-decimal values, never long float tails.
      for (const key of ['subtotal', 'total', 'amountPaid']) {
        assert.strictEqual(invoice[key], Math.round(invoice[key] * 100) / 100, `${key} is round2-fixed`);
      }
      assert.ok(Array.isArray(detail.data.ledger), 'detail carries the invoice ledger');

      const methods = await jsonFetch(base, {
        path: `/api/v1/billing/invoices/${invoiceId}/payment-methods`,
      }, owner);
      assert.strictEqual(methods.status, 200, JSON.stringify(methods.data));
      assert.ok(Array.isArray(methods.data.gateways), 'gateways list');
      for (const gateway of methods.data.gateways) {
        assert.ok('id' in gateway && 'label' in gateway && 'available' in gateway, 'gateway rows render label + availability');
        if (!gateway.available) assert.ok(gateway.reason, 'a refused gateway carries the reason the page prints');
      }

      const started = await jsonFetch(base, {
        path: '/api/v1/payments', method: 'POST', body: { invoiceId, gateway: 'sandbox' },
      }, owner);
      assert.strictEqual(started.status, 201, JSON.stringify(started.data));
      assert.ok(started.data.paymentId && started.data.sandboxToken, 'sandbox branch gets both the id and the token');

      const polled = await jsonFetch(base, { path: `/api/v1/payments/${started.data.paymentId}` }, owner);
      assert.strictEqual(polled.status, 200, JSON.stringify(polled.data));
      assert.strictEqual(polled.data.payment.status, 'pending', 'the poll target starts pending');
      assert.strictEqual(polled.data.payment.invoiceId, invoiceId, 'the poll target names its invoice');

      const done = await jsonFetch(base, {
        path: `/api/v1/payments/${started.data.paymentId}/sandbox/complete`, method: 'POST', body: {},
      }, owner);
      assert.strictEqual(done.status, 200, JSON.stringify(done.data));
      assert.strictEqual(done.data.applied, true, 'the genuine webhook path applies the payment');

      const after = await jsonFetch(base, { path: `/api/v1/invoices/${invoiceId}` }, owner);
      assert.strictEqual(after.data.invoice.status, 'paid', 'the settled invoice flips by server state alone');
    });

    await t.test('ownership boundary: another customer gets 404, never 403', async () => {
      const theirs = await jsonFetch(base, { path: `/api/v1/invoices/${invoiceId}` }, other);
      assert.strictEqual(theirs.status, 404, 'non-owned invoice is indistinguishable from missing');
    });
  } finally {
    await close();
  }
});

test('billing screens: page sources pin the Phase 5E surface features', () => {
  // InvoiceDetailPage — payment flow, bounded provider poll, print receipt.
  assert.ok(DETAIL_SRC.includes('billingApi.startPayment'), 'paying runs through the real payment route');
  assert.ok(DETAIL_SRC.includes('pollPayment'), 'webhook resolution is polled, never assumed');
  assert.ok(DETAIL_SRC.includes("payment.status !== 'pending'"), 'the poll stops on a settled status');
  assert.ok(DETAIL_SRC.includes('window.print()'), 'the receipt prints via the browser print path');
  assert.ok(DETAIL_SRC.includes('Print receipt'), 'the print action is reachable');
  assert.ok(DETAIL_SRC.includes('formatMoney'), 'money renders through the shared formatter');

  // BillingPage — the invoices table with a status filter.
  assert.ok(LIST_SRC.includes('invoice-status-filter'), 'the invoices list carries a status filter');
  assert.ok(LIST_SRC.includes('shownInvoices'), 'the filter selects rows for the table');
  assert.ok(LIST_SRC.includes('No invoices with that status'), 'an emptied filter says so');

  // Print stylesheet — receipt-grade output without chrome or actions.
  assert.ok(STYLES_SRC.includes('@media print'), 'print rules exist');
  assert.ok(STYLES_SRC.includes('.app-header'), 'print drops the app header');
  assert.ok(STYLES_SRC.includes('display: none !important'), 'print hides chrome decisively');
});
