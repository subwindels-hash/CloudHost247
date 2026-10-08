/**
 * End-to-end tests of the SPA's API client against the real server.
 *
 * The React pages are thin by design: they render what these methods return, so the highest-value
 * check without a browser is that the client the pages import actually speaks the server's
 * contract. This file therefore imports spa/src/lib/api.js *unmodified* (it is ESM, and
 * spa/package.json marks the directory as a module) and drives the whole customer journey:
 *
 *   catalog -> cart -> checkout -> invoice -> payment -> settled invoice
 *
 * plus the billing restrictions that matter (an already-paid invoice is refused; an empty cart
 * cannot be checked out; another customer's invoice is a 404) and the subscription actions behind
 * the Billing page, including the new plan-slug path.
 *
 * It also runs the shared client against a *seeded* store so the Services page's data paths are
 * exercised with real rows rather than empty arrays. What is deliberately NOT claimed here: no
 * browser has rendered these pages (no DOM in this environment) — the JSX itself is verified by the
 * production build.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const { startServer } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');
const { hashPassword } = require('../src/lib/password');

const CLIENT_PATH = path.join(__dirname, '..', 'spa/src/lib/api.js');

/**
 * Imports the SPA client with the browser globals it expects: localStorage (its token store) and a
 * fetch that resolves the client's relative paths against the test server.
 */
async function loadClient(base) {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => { memory.set(key, String(value)); },
    removeItem: (key) => { memory.delete(key); },
    clear: () => memory.clear(),
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => realFetch(String(url).startsWith('http') ? url : `${base}${url}`, options);

  const mod = await import(`${pathToFileURL(CLIENT_PATH).href}?v=${Date.now()}-${Math.random()}`);
  return { ...mod, restore: () => { globalThis.fetch = realFetch; delete globalThis.localStorage; } };
}

/** A published product with two plans and monthly pricing — the shape the seed script creates. */
async function seedCatalog(store) {
  const productId = uuidv7();
  await store.table('catalog_products').insert({
    id: productId, slug: 'web-hosting', name: 'Web Hosting', category: 'hosting',
    description: 'Shared hosting', status: 'active',
  });

  const plans = {};
  for (const [slug, name, price] of [['starter', 'Starter', 2.99], ['business', 'Business', 7.99]]) {
    const planId = uuidv7();
    plans[slug] = planId;
    await store.table('catalog_product_plans').insert({
      id: planId, product_id: productId, slug, name, status: 'active',
    });
    await store.table('catalog_plan_pricing').insert({
      id: uuidv7(), plan_id: planId, currency: 'USD', billing_cycle: 'monthly',
      price, setup_fee: 0, is_active: true,
    });
  }
  return { productId, plans };
}

test('spa client: the whole purchase journey works through the client the pages import', async (t) => {
  const { base, close } = await startServer({
    seed: (ctx) => seedCatalog(ctx.store),
    // The sandbox gateway is the one payment path this environment can run for real; it needs the
    // same secret a deployment would set.
    SANDBOX_GATEWAY_WEBHOOK_SECRET: 'test-sandbox-webhook-secret',
  });
  const client = await loadClient(base);
  try {
    await t.test('register, then the catalog the Products page renders', async () => {
      const registered = await client.authApi.register({
        email: 'buyer@example.com', password: 'SuperSecret123!', fullName: 'Buyer Person',
      });
      client.store.save(registered);

      const catalog = await client.catalogApi.all();
      assert.strictEqual(catalog.products.length, 1);
      const [product] = catalog.products;
      assert.strictEqual(product.name, 'Web Hosting');
      assert.deepStrictEqual(product.plans.map((p) => p.slug).sort(), ['business', 'starter']);
      assert.ok(product.plans[0].pricing.some((p) => p.billingCycle === 'monthly'), 'pricing is published');
    });

    let invoiceId;
    let paymentId;

    await t.test('an empty cart cannot be checked out', async () => {
      await assert.rejects(
        () => client.cartApi.checkout(),
        (err) => err.status === 404 && /cart is empty/i.test(err.message),
      );
    });

    await t.test('adding to the cart returns names, not just ids', async () => {
      const cart = await client.cartApi.addItem('starter', { billingCycle: 'monthly' });
      assert.strictEqual(cart.items.length, 1);
      const [item] = cart.items;
      assert.strictEqual(item.planSlug, 'starter', 'the cart UI can label the line');
      assert.strictEqual(item.planName, 'Starter');
      assert.strictEqual(item.productName, 'Web Hosting');
      assert.strictEqual(item.quantity, 1);
      assert.strictEqual(cart.subtotal, 2.99);
      assert.ok(item.planId, 'the checkout path still gets its id');
    });

    await t.test('quantity is updateable and the totals come from the server', async () => {
      const cart = await client.cartApi.get();
      const updated = await client.cartApi.updateItem(cart.items[0].id, 2);
      assert.strictEqual(updated.items[0].quantity, 2);
      assert.strictEqual(updated.subtotal, 5.98);
    });

    await t.test('checkout creates an order and an invoice', async () => {
      const order = await client.cartApi.checkout();
      assert.match(order.reference, /^ORD-/);
      assert.ok(order.invoiceId, 'the invoice the customer must pay');
      invoiceId = order.invoiceId;

      const invoices = await client.billingApi.invoices();
      assert.strictEqual(invoices.total, 1);
      assert.strictEqual(invoices.invoices[0].id, invoiceId);
      assert.strictEqual(invoices.invoices[0].status, 'unpaid');
    });

    await t.test('invoice detail carries the ledger charge for the order', async () => {
      const detail = await client.billingApi.invoice(invoiceId);
      // The cart held two units of the $2.99 plan at checkout.
      assert.strictEqual(detail.invoice.total, 5.98);
      assert.strictEqual(detail.invoice.amountPaid, 0);
      assert.strictEqual(detail.ledger.length, 1);
      assert.strictEqual(detail.ledger[0].entryType, 'charge');
      assert.match(detail.ledger[0].description, /^Order ORD-/);
    });

    await t.test('payment methods list every gateway, with a reason when unusable', async () => {
      const methods = await client.billingApi.paymentMethods(invoiceId);
      assert.strictEqual(methods.balanceDue, 5.98);
      const ids = methods.gateways.map((g) => g.id);
      assert.deepStrictEqual(ids, ['sandbox', 'manual', 'stripe', 'paypal', 'paystack', 'blockonomics']);
      assert.strictEqual(methods.gateways.find((g) => g.id === 'sandbox').available, true);
      const stripe = methods.gateways.find((g) => g.id === 'stripe');
      assert.strictEqual(stripe.available, false, 'no credentials in this environment');
      assert.match(stripe.reason, /STRIPE_WEBHOOK_SECRET|egress/, 'the refusal names its reason');
      // Bitcoin is offered as a *callback* only: starting one would need the provider's
      // address-issuance call and a recorded BTC quote, and the customer sees that reason.
      const bitcoin = methods.gateways.find((g) => g.id === 'blockonomics');
      assert.strictEqual(bitcoin.available, false);
      assert.match(bitcoin.reason, /address-issuance|BLOCKONOMICS_CALLBACK_SECRET/);
    });

    await t.test('the manual gateway answers with instructions instead of a redirect', async () => {
      const started = await client.billingApi.startPayment(invoiceId, 'manual');
      assert.strictEqual(started.gateway, 'manual');
      assert.strictEqual(started.status, 'pending');
      assert.ok(started.instructions.length > 0);
      const payments = await client.billingApi.payments();
      assert.strictEqual(payments.total, 1);
      assert.strictEqual(payments.payments[0].gateway, 'manual');
    });

    await t.test('a sandbox payment settles the invoice through the real receiver', async () => {
      const started = await client.billingApi.startPayment(invoiceId, 'sandbox');
      assert.strictEqual(started.gateway, 'sandbox');
      assert.ok(started.sandboxToken);
      paymentId = started.paymentId;

      const detail = await client.billingApi.payment(paymentId);
      assert.strictEqual(detail.payment.status, 'pending');

      const completed = await client.billingApi.completeSandboxPayment(paymentId);
      assert.strictEqual(completed.applied, true);

      const after = await client.billingApi.invoice(invoiceId);
      assert.strictEqual(after.invoice.status, 'paid');
      assert.strictEqual(after.invoice.amountPaid, 5.98);
      assert.strictEqual(after.ledger.length, 2, 'charge + payment');
      assert.ok(after.ledger.some((entry) => entry.entryType === 'payment'));
    });

    await t.test('paying an already-paid invoice is refused, not silently repeated', async () => {
      await assert.rejects(
        () => client.billingApi.startPayment(invoiceId, 'sandbox'),
        (err) => err.status === 400 && /already paid/i.test(err.message),
      );
    });

    await t.test('the ledger page shows both entries', async () => {
      const ledger = await client.billingApi.ledger();
      assert.strictEqual(ledger.total, 2);
      assert.deepStrictEqual(
        ledger.ledger.map((e) => e.entryType).sort(),
        ['charge', 'payment'],
      );
    });

    await t.test('another customer cannot see or pay this invoice', async () => {
      const other = await client.authApi.register({
        email: 'other@example.com', password: 'SuperSecret123!', fullName: 'Other Person',
      });
      client.store.save(other);
      await assert.rejects(() => client.billingApi.invoice(invoiceId), (err) => err.status === 404);
      await assert.rejects(() => client.billingApi.paymentMethods(invoiceId), (err) => err.status === 404);
      await assert.rejects(
        () => client.billingApi.startPayment(invoiceId, 'sandbox'),
        (err) => err.status === 404,
      );
    });
  } finally {
    client.restore();
    await close();
  }
});

test('spa client: subscriptions, services and domains with real rows', async (t) => {
  const SEED_EMAIL = 'existing@example.com';
  const SEED_PASSWORD = 'SeededPassword123!';
  const seeded = {};

  const { base, close } = await startServer({
    seed: async (ctx) => {
      const catalog = await seedCatalog(ctx.store);
      // A real scrypt hash, so the seeded customer can actually sign in through the client.
      const passwordHash = await hashPassword(SEED_PASSWORD);
      const userId = uuidv7();
      seeded.userId = userId;
      seeded.businessPlanId = catalog.plans.business;
      await ctx.store.table('users').insert({
        id: userId, email: SEED_EMAIL, password_hash: passwordHash, full_name: 'Existing Customer',
      });

      seeded.serviceId = uuidv7();
      await ctx.store.table('customer_services').insert({
        id: seeded.serviceId, user_id: userId, plan_id: catalog.plans.starter,
        label: 'Starter hosting', status: 'active', domain: 'example.com', username: 'example',
        package: 'starter', next_due_date: new Date(Date.now() + 20 * 86400_000).toISOString(),
      });

      seeded.domainId = uuidv7();
      await ctx.store.table('customer_domains').insert({
        id: seeded.domainId, user_id: userId, domain: 'example.com', registrar: 'CloudHost247',
        status: 'active', expires_at: new Date(Date.now() + 200 * 86400_000).toISOString(),
        auto_renew: true, nameservers: ['ns1.example.com', 'ns2.example.com'],
      });

      seeded.subscriptionId = uuidv7();
      await ctx.store.table('subscriptions').insert({
        id: seeded.subscriptionId, user_id: userId, plan_id: catalog.plans.starter,
        status: 'active', billing_cycle: 'monthly',
        current_period_end: new Date(Date.now() + 12 * 86400_000).toISOString(),
        renews_at: new Date(Date.now() + 12 * 86400_000).toISOString(),
      });
    },
  });

  const client = await loadClient(base);
  try {
    await t.test('signed-out callers are refused, not served', async () => {
      await assert.rejects(() => client.accountApi.services(), (err) => err.status === 401);
      await assert.rejects(() => client.billingApi.subscriptions(), (err) => err.status === 401);
    });

    await t.test('the Services page data is real: names, dates and nameservers', async () => {
      const session = await client.authApi.login({ email: SEED_EMAIL, password: SEED_PASSWORD });
      client.store.save(session);

      const services = await client.accountApi.services();
      assert.strictEqual(services.total, 1);
      const [service] = services.services;
      assert.strictEqual(service.label, 'Starter hosting');
      assert.strictEqual(service.domain, 'example.com');
      assert.strictEqual(service.username, 'example');
      assert.strictEqual(service.status, 'active');
      assert.ok(service.nextDueDate, 'the page shows a due date');

      const domains = await client.accountApi.domains();
      assert.strictEqual(domains.total, 1);
      const [domain] = domains.domains;
      assert.strictEqual(domain.domain, 'example.com');
      assert.strictEqual(domain.autoRenew, true);
      assert.deepStrictEqual(domain.nameservers, ['ns1.example.com', 'ns2.example.com']);
    });

    await t.test('a plan change is requested by slug and resolved to a plan id', async () => {
      const subscriptions = await client.billingApi.subscriptions();
      assert.strictEqual(subscriptions.subscriptions.length, 1);
      assert.strictEqual(subscriptions.subscriptions[0].status, 'active');

      const changed = await client.billingApi.changePlan(seeded.subscriptionId, { planSlug: 'business' });
      assert.strictEqual(changed.pendingPlanId, seeded.businessPlanId,
        'the slug the catalog publishes resolved to the plan the server recorded');
      assert.strictEqual(changed.subscription.status, 'active', 'a request, not an immediate switch');
      assert.strictEqual(changed.subscription.id, seeded.subscriptionId);
    });

    await t.test('an unknown slug is refused with a message about the slug', async () => {
      await assert.rejects(
        () => client.billingApi.changePlan(seeded.subscriptionId, { planSlug: 'no-such-plan' }),
        (err) => err.status === 404 && /slug/i.test(err.message),
      );
      await assert.rejects(
        () => client.billingApi.changePlan(seeded.subscriptionId, {}),
        (err) => err.status === 400,
      );
    });

    await t.test('cancelling is scoped, idempotent and takes effect at period end', async () => {
      const cancelled = await client.billingApi.cancelSubscription(seeded.subscriptionId);
      assert.strictEqual(cancelled.subscription.status, 'cancelled');
      assert.strictEqual(cancelled.subscription.cancel_at_period_end, true, 'access runs to period end');

      const again = await client.billingApi.cancelSubscription(seeded.subscriptionId);
      assert.strictEqual(again.alreadyCancelled, true, 'the second call answers, it does not error');

      await assert.rejects(
        () => client.billingApi.changePlan(seeded.subscriptionId, { planSlug: 'business' }),
        (err) => err.status === 400 && /only active subscriptions/i.test(err.message),
      );
    });

    await t.test('a different customer sees none of these rows', async () => {
      const fresh = await client.authApi.register({
        email: 'fresh@example.com', password: 'SuperSecret123!', fullName: 'Fresh Person',
      });
      client.store.save(fresh);
      assert.deepStrictEqual((await client.accountApi.services()).services, []);
      assert.deepStrictEqual((await client.accountApi.domains()).domains, []);
      assert.deepStrictEqual((await client.billingApi.subscriptions()).subscriptions, []);
      await assert.rejects(
        () => client.billingApi.cancelSubscription(seeded.subscriptionId),
        (err) => err.status === 404,
      );
    });
  } finally {
    client.restore();
    await close();
  }
});
