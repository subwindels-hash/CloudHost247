/**
 * Integration tests for the inbound provider-webhook surface.
 *
 * These drive the genuine HTTP pipeline (routing, raw-body capture, signature verification,
 * idempotency, settlement) rather than calling the handler directly, because the two bugs this
 * suite guards against — an unread raw body and a dropped duplicate flag — only exist on the
 * request path.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, jsonFetch, register } = require('./helpers');
const { signWebhook } = require('../src/domains/payments');

const WEBHOOK_SECRET = 'integration-webhook-secret-0123456789';

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
  return { product, plan };
}

/** Create a fresh unpaid invoice plus a pending sandbox payment, and return both ids. */
async function createPendingPayment(base, token) {
  const add = await jsonFetch(base, {
    path: '/api/v1/cart/items', method: 'POST',
    body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
  }, token);
  assert.strictEqual(add.status, 201, 'cart item added');

  const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, token);
  assert.strictEqual(order.status, 201, 'order created');
  const invoiceId = order.data.invoiceId;
  assert.ok(invoiceId, 'invoice id returned');

  const payment = await jsonFetch(base, {
    path: '/api/v1/payments', method: 'POST', body: { invoiceId, gateway: 'sandbox' },
  }, token);
  assert.strictEqual(payment.status, 201, 'payment initiated');
  return { invoiceId, paymentId: payment.data.paymentId };
}

/** POST a raw, correctly-signed webhook body to `path`. */
async function sendWebhook(base, path, payload, { signature, sign } = {}) {
  const raw = JSON.stringify(payload);
  const sig = signature ?? signWebhook(WEBHOOK_SECRET, raw);
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-signature': sig },
    body: raw,
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data, raw };
}

test('integration: inbound provider webhooks', async (t) => {
  const { base, app, close } = await startServer({
    SANDBOX_GATEWAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    SANDBOX_PAYMENTS: 'true',
  });
  try {
    await seedCatalog(app.store);
    const reg = await register(base, 'webhook-customer@example.com');
    const token = reg.data.accessToken;
    assert.ok(token, 'customer registered');

    let eventId = 0;
    const nextId = () => `evt_it_${++eventId}`;

    // ---- canonical /webhooks/:gateway settles the invoice ------------------
    let replayRaw;
    let replayId;
    await t.test('POST /webhooks/:gateway verifies the signature and settles the payment', async () => {
      const { invoiceId, paymentId } = await createPendingPayment(base, token);
      replayId = nextId();

      const res = await sendWebhook(base, '/api/v1/webhooks/sandbox', {
        event_id: replayId,
        event_type: 'payment.succeeded',
        payment_id: paymentId,
        gateway_reference: 'gw_ref_1',
      });

      assert.strictEqual(res.status, 200, `expected 200, got ${res.status}: ${JSON.stringify(res.data)}`);
      assert.strictEqual(res.data.received, true, 'original { received } envelope');
      assert.strictEqual(res.data.status, 'processed', 'event processed');
      assert.strictEqual(res.data.applied, true, 'payment applied');
      replayRaw = res.raw;

      const invoices = await jsonFetch(base, { path: '/api/v1/invoices' }, token);
      const paid = invoices.data.invoices.find((i) => i.id === invoiceId);
      assert.strictEqual(paid.status, 'paid', 'invoice marked paid by the webhook');
    });

    // ---- idempotency -------------------------------------------------------
    await t.test('replaying the same event id is idempotent', async () => {
      const res = await sendWebhook(base, '/api/v1/webhooks/sandbox', JSON.parse(replayRaw));
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.received, true);
      assert.strictEqual(res.data.status, 'already_processed', 'duplicate flagged, not re-settled');
      assert.strictEqual(res.data.applied, false, 'duplicate is not applied twice');
    });

    // ---- signature enforcement --------------------------------------------
    await t.test('an unverifiable signature is rejected with 401', async () => {
      const payload = { event_id: nextId(), event_type: 'payment.succeeded' };
      const raw = JSON.stringify(payload);
      const res = await sendWebhook(base, '/api/v1/webhooks/sandbox', payload, {
        signature: signWebhook('a-completely-different-secret', raw),
      });
      assert.strictEqual(res.status, 401, 'bad signature is a 401');

      const recorded = await app.store.table('webhook_events').findOne({ event_id: payload.event_id });
      assert.ok(recorded, 'failed event is still recorded for audit');
      assert.strictEqual(recorded.status, 'failed');
      assert.strictEqual(recorded.signature_valid, false);
    });

    // ---- the explicit public contract route --------------------------------
    await t.test('POST /webhooks/payment/:provider behaves identically', async () => {
      const { invoiceId, paymentId } = await createPendingPayment(base, token);
      const res = await sendWebhook(base, '/api/v1/webhooks/payment/sandbox', {
        event_id: nextId(),
        event_type: 'payment.succeeded',
        payment_id: paymentId,
        gateway_reference: 'gw_ref_2',
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'processed');
      assert.strictEqual(res.data.applied, true);

      const invoices = await jsonFetch(base, { path: '/api/v1/invoices' }, token);
      assert.strictEqual(
        invoices.data.invoices.find((i) => i.id === invoiceId).status, 'paid',
        'singular route settles too',
      );
    });

    // ---- input guards -------------------------------------------------------
    await t.test('an empty body is refused without crashing', async () => {
      const response = await fetch(`${base}/api/v1/webhooks/sandbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      assert.strictEqual(response.status, 400);
      const data = await response.json();
      assert.match(data.message, /raw request body/i);
    });

    await t.test('GET on a webhook path is not allowed', async () => {
      const response = await fetch(`${base}/api/v1/webhooks/sandbox`);
      assert.ok([404, 405].includes(response.status), `got ${response.status}`);
    });

    // ---- unrecognised events are accepted but not applied -------------------
    await t.test('a signed but unrecognised event is recorded and ignored', async () => {
      const res = await sendWebhook(base, '/api/v1/webhooks/sandbox', {
        event_id: nextId(),
        event_type: 'customer.subscription.deleted',
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ignored');
      assert.strictEqual(res.data.applied, false);
    });
  } finally {
    await close();
  }
});
