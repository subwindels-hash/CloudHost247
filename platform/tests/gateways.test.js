/**
 * Tests for the real payment gateways (stripe / paypal / paystack) and the strict webhook receiver.
 *
 * Two layers, deliberately:
 *   - unit tests call the gateway modules directly with crafted signatures, including the negative
 *     cases a live provider will never send (stale timestamps, one valid v1 among decoys, a
 *     non-allowlisted certificate host)
 *   - integration tests drive the genuine HTTP pipeline end to end (raw body → signature → claim →
 *     invariants → settlement → ledger) and then read the database back
 *
 * The integration tests create the pending payment row exactly the way a provider-backed checkout
 * would have (via the store) because *initiation* with a real provider needs live provider egress,
 * which this build does not have and refuses on purpose. Everything downstream of that row — the
 * part that decides whether a delivery from the internet may move money — is the real code.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { startServer, jsonFetch, register } = require('./helpers');
const { uuidv7 } = require('../src/lib/ids');

const stripe = require('../src/lib/gateways/stripe');
const paypal = require('../src/lib/gateways/paypal');
const paystack = require('../src/lib/gateways/paystack');
const { computeCrc32 } = require('../src/lib/crc32');

const STRIPE_SECRET = 'whsec_platform_test_secret_0123456789';
const PAYSTACK_KEY = 'sk_test_platform_0123456789abcdef';
const PAYPAL_WEBHOOK_ID = 'WH-TEST-1234567890';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripeSignature(secret, body, { timestamp = Math.floor(Date.now() / 1000), decoys = [] } = {}) {
  const v1 = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const parts = [`t=${timestamp}`, ...decoys.map((d) => `v1=${d}`), `v1=${v1}`];
  return parts.join(',');
}

function paystackSignature(secret, body) {
  return crypto.createHmac('sha512', secret).update(body).digest('hex');
}

function paypalKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKey,
    certPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

function paypalHeaders({ keyPair, body, webhookId, transmissionTime, algo = 'SHA256withRSA',
  certUrl = 'https://api.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-1d93a270' }) {
  const transmissionId = crypto.randomUUID();
  const verificationString = `${transmissionId}|${transmissionTime}|${webhookId}|${computeCrc32(body)}`;
  const signature = crypto.createSign('RSA-SHA256').update(verificationString, 'utf8')
    .sign(keyPair.privateKey, 'base64');

  return {
    'paypal-transmission-id': transmissionId,
    'paypal-transmission-time': transmissionTime,
    'paypal-transmission-sig': signature,
    'paypal-cert-url': certUrl,
    'paypal-auth-algo': algo,
  };
}

/** A pending payment row for `invoiceId`, as a provider-backed checkout would have created it. */
async function seedProviderPayment(app, { invoiceId, gateway, amount, currency = 'USD', reference }) {
  const invoice = await app.store.table('invoices').findById(invoiceId);
  return app.store.table('payments').insert({
    id: uuidv7(),
    invoice_id: invoiceId,
    order_id: invoice.order_id,
    user_id: invoice.user_id,
    gateway,
    gateway_reference: reference ?? null,
    currency,
    amount,
    status: 'pending',
  });
}

async function seedCatalogAndInvoice(base, app, email) {
  await app.store.table('catalog_products').insert({
    slug: 'web-hosting', name: 'Web Hosting', category: 'hosting', status: 'active',
  });
  const plan = await app.store.table('catalog_product_plans').insert({
    product_id: (await app.store.table('catalog_products').findOne({ slug: 'web-hosting' })).id,
    slug: 'starter', name: 'Starter', status: 'active',
  });
  await app.store.table('catalog_plan_pricing').insert({
    plan_id: plan.id, currency: 'USD', billing_cycle: 'monthly',
    price: 9.99, setup_fee: 0, is_active: true,
  });

  const token = (await register(base, email)).data.accessToken;
  await jsonFetch(base, {
    path: '/api/v1/cart/items', method: 'POST',
    body: { planSlug: 'starter', billingCycle: 'monthly', quantity: 1 },
  }, token);
  const order = await jsonFetch(base, { path: '/api/v1/orders', method: 'POST', body: {} }, token);
  assert.strictEqual(order.status, 201, 'order created');

  return { token, invoiceId: order.data.invoiceId };
}

async function postRaw(base, path, raw, headers) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: raw });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: response.status, data };
}

// ---------------------------------------------------------------------------
// Unit: Stripe signature scheme
// ---------------------------------------------------------------------------

test('unit: stripe signature verification', async (t) => {
  const body = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' }));

  await t.test('a correctly signed delivery is accepted', async () => {
    const header = stripeSignature(STRIPE_SECRET, body.toString('utf8'));
    assert.strictEqual(await stripe.verify(body, { 'stripe-signature': header }, { STRIPE_WEBHOOK_SECRET: STRIPE_SECRET }), true);
  });

  await t.test('a signature from a different secret is refused', async () => {
    const header = stripeSignature('whsec_a_completely_different_secret', body.toString('utf8'));
    assert.strictEqual(await stripe.verify(body, { 'stripe-signature': header }, { STRIPE_WEBHOOK_SECRET: STRIPE_SECRET }), false);
  });

  await t.test('a stale timestamp is refused even with a valid HMAC', async () => {
    const stale = Math.floor(Date.now() / 1000) - (stripe.MAX_SKEW_SECONDS + 60);
    const header = stripeSignature(STRIPE_SECRET, body.toString('utf8'), { timestamp: stale });
    assert.strictEqual(await stripe.verify(body, { 'stripe-signature': header }, { STRIPE_WEBHOOK_SECRET: STRIPE_SECRET }), false);
  });

  await t.test('a tampered body is refused', async () => {
    const header = stripeSignature(STRIPE_SECRET, body.toString('utf8'));
    const tampered = Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', amount: 999999 }));
    assert.strictEqual(await stripe.verify(tampered, { 'stripe-signature': header }, { STRIPE_WEBHOOK_SECRET: STRIPE_SECRET }), false);
  });

  await t.test('one valid v1 among rotating decoys is enough', async () => {
    const header = stripeSignature(STRIPE_SECRET, body.toString('utf8'), {
      decoys: ['a'.repeat(64), crypto.createHmac('sha256', 'wrong').update('nope').digest('hex')],
    });
    assert.strictEqual(await stripe.verify(body, { 'stripe-signature': header }, { STRIPE_WEBHOOK_SECRET: STRIPE_SECRET }), true);
  });

  await t.test('an unset secret refuses rather than accepting anything', async () => {
    const header = stripeSignature(STRIPE_SECRET, body.toString('utf8'));
    assert.strictEqual(await stripe.verify(body, { 'stripe-signature': header }, {}), false);
  });
});

// ---------------------------------------------------------------------------
// Unit: Paystack signature scheme + canonical mapping
// ---------------------------------------------------------------------------

test('unit: paystack verification and canonical events', async (t) => {
  const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 1, reference: 'ref_1', amount: 999, currency: 'USD', status: 'success' } }));

  await t.test('HMAC-SHA512 with the secret key is accepted; anything else is not', async () => {
    const good = paystackSignature(PAYSTACK_KEY, body.toString('utf8'));
    assert.strictEqual(await paystack.verify(body, { 'x-paystack-signature': good }, { PAYSTACK_SECRET_KEY: PAYSTACK_KEY }), true);
    assert.strictEqual(await paystack.verify(body, { 'x-paystack-signature': paystackSignature('sk_wrong', body.toString('utf8')) }, { PAYSTACK_SECRET_KEY: PAYSTACK_KEY }), false);
    assert.strictEqual(await paystack.verify(body, {}, { PAYSTACK_SECRET_KEY: PAYSTACK_KEY }), false);
  });

  await t.test('charge.success settles, charge.failed fails', async () => {
    const success = paystack.parseEvent(body, {}, 'hash');
    assert.strictEqual(success.canonicalEventType, 'payment.success');
    assert.strictEqual(success.amountCents, 999);
    assert.strictEqual(success.providerEventId, 'charge.success_1');

    const failed = paystack.parseEvent(
      Buffer.from(JSON.stringify({ event: 'charge.failed', data: { id: 2, reference: 'ref_2', amount: 999, currency: 'USD', gateway_response: 'Insufficient funds' } })),
      {}, 'hash',
    );
    assert.strictEqual(failed.canonicalEventType, 'payment.failed');
    assert.strictEqual(failed.failureReason, 'Insufficient funds');
  });

  await t.test('a charge.success whose own status disagrees never settles', async () => {
    const suspicious = paystack.parseEvent(
      Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 3, reference: 'ref_3', amount: 999, currency: 'USD', status: 'failed' } })),
      {}, 'hash',
    );
    assert.strictEqual(suspicious.canonicalEventType, 'unhandled');
    assert.strictEqual(suspicious.outcome, 'unhandled');
  });
});

// ---------------------------------------------------------------------------
// Unit: PayPal — CRC32, SSRF guards, RSA verification
// ---------------------------------------------------------------------------

test('unit: paypal verification and SSRF guards', async (t) => {
  await t.test('CRC32 matches the IEEE 802.3 check value', () => {
    assert.strictEqual(computeCrc32(Buffer.from('123456789')), 0xcbf43926);
  });

  await t.test('private, loopback, metadata, CGNAT and reserved addresses are refused', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254',
      '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', 'ff02::1', '::ffff:127.0.0.1']) {
      assert.strictEqual(paypal.isPrivateOrReservedIp(ip), true, `${ip} must be refused`);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.10', '2606:4700::1111']) {
      assert.strictEqual(paypal.isPrivateOrReservedIp(ip), false, `${ip} must be allowed`);
    }
  });

  await t.test('a non-allowlisted certificate host is refused without any fetch', async () => {
    assert.strictEqual(
      await paypal.validateAndFetchPayPalCert('https://evil.example.com/v1/notifications/certs/x.pem'),
      null,
    );
    // Non-https, userinfo, non-default port, query strings and unexpected paths all fail closed.
    for (const url of [
      'http://api.paypal.com/v1/notifications/certs/x.pem',
      'https://user:pass@api.paypal.com/v1/notifications/certs/x.pem',
      'https://api.paypal.com:8443/v1/notifications/certs/x.pem',
      'https://api.paypal.com/v1/notifications/certs/x.pem?redirect=http://169.254.169.254/',
      'https://api.paypal.com/some/other/path.pem',
      'not-a-url',
    ]) {
      assert.strictEqual(await paypal.validateAndFetchPayPalCert(url), null, `${url} must be refused`);
    }
  });

  await t.test('a valid RSA-SHA256 transmission is accepted', async () => {
    const keyPair = paypalKeyPair();
    const body = Buffer.from(JSON.stringify({ id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1', amount: { value: '9.99', currency_code: 'USD' }, custom_id: 'pay_1' } }));
    const headers = paypalHeaders({
      keyPair, body, webhookId: PAYPAL_WEBHOOK_ID, transmissionTime: new Date().toISOString(),
    });

    paypal.setPayPalCertResolver(async () => keyPair.certPem);
    try {
      assert.strictEqual(
        await paypal.verify(body, headers, { PAYPAL_WEBHOOK_ID: PAYPAL_WEBHOOK_ID }),
        true,
      );
    } finally {
      paypal.setPayPalCertResolver(null);
    }
  });

  await t.test('a signature from a different key, a wrong webhook id, a stale time and a wrong algorithm are all refused', async () => {
    const keyPair = paypalKeyPair();
    const otherKeys = paypalKeyPair();
    const body = Buffer.from(JSON.stringify({ id: 'WH-2', event_type: 'PAYMENT.CAPTURE.COMPLETED' }));
    const now = new Date();

    paypal.setPayPalCertResolver(async () => keyPair.certPem);
    try {
      const good = paypalHeaders({ keyPair, body, webhookId: PAYPAL_WEBHOOK_ID, transmissionTime: now.toISOString() });
      // Signed by a different private key than the certificate claims.
      const forged = paypalHeaders({ keyPair: otherKeys, body, webhookId: PAYPAL_WEBHOOK_ID, transmissionTime: now.toISOString() });
      const wrongId = paypalHeaders({ keyPair, body, webhookId: 'WH-SOMEONE-ELSE-99', transmissionTime: now.toISOString() });
      const stale = paypalHeaders({ keyPair, body, webhookId: PAYPAL_WEBHOOK_ID, transmissionTime: new Date(Date.now() - 3600_000).toISOString() });
      const wrongAlgo = paypalHeaders({ keyPair, body, webhookId: PAYPAL_WEBHOOK_ID, transmissionTime: now.toISOString(), algo: 'SHA1withRSA' });

      const cfg = { PAYPAL_WEBHOOK_ID };
      assert.strictEqual(await paypal.verify(body, good, cfg), true);
      assert.strictEqual(await paypal.verify(body, forged, cfg), false, 'wrong signing key');
      assert.strictEqual(await paypal.verify(body, wrongId, cfg), false, 'wrong webhook id');
      assert.strictEqual(await paypal.verify(body, stale, cfg), false, 'stale transmission time');
      assert.strictEqual(await paypal.verify(body, wrongAlgo, cfg), false, 'algorithm downgrade');
    } finally {
      paypal.setPayPalCertResolver(null);
    }
  });

  await t.test('a non-allowlisted cert url is refused before the resolver runs', async () => {
    const keyPair = paypalKeyPair();
    const body = Buffer.from(JSON.stringify({ id: 'WH-3', event_type: 'PAYMENT.CAPTURE.COMPLETED' }));
    const headers = paypalHeaders({
      keyPair, body, webhookId: PAYPAL_WEBHOOK_ID, transmissionTime: new Date().toISOString(),
      certUrl: 'https://attacker.example.com/v1/notifications/certs/x.pem',
    });

    let resolverCalls = 0;
    paypal.setPayPalCertResolver(async () => { resolverCalls += 1; return keyPair.certPem; });
    try {
      assert.strictEqual(await paypal.verify(body, headers, { PAYPAL_WEBHOOK_ID }), false);
      assert.strictEqual(resolverCalls, 0, 'the resolver must not be reached for a non-allowlisted host');
    } finally {
      paypal.setPayPalCertResolver(null);
    }
  });

  await t.test('an approved order is not a captured payment', () => {
    const event = paypal.parseEvent(
      Buffer.from(JSON.stringify({ id: 'WH-4', event_type: 'CHECKOUT.ORDER.APPROVED', resource: { id: 'ORDER-1', amount: { value: '9.99', currency_code: 'USD' } } })),
      {}, 'hash',
    );
    assert.strictEqual(event.canonicalEventType, 'unhandled');
    assert.strictEqual(event.outcome, 'pending');
  });
});

// ---------------------------------------------------------------------------
// Integration: stripe delivery settles an invoice over real HTTP
// ---------------------------------------------------------------------------

test('integration: a verified stripe delivery settles an invoice once', async (t) => {
  const { base, app, close } = await startServer({
    STRIPE_WEBHOOK_SECRET: STRIPE_SECRET,
    SANDBOX_GATEWAY_WEBHOOK_SECRET: 'sandbox-secret-for-this-suite-01',
    SANDBOX_PAYMENTS: 'true',
  });

  try {
    const { token, invoiceId } = await seedCatalogAndInvoice(base, app, 'stripe-customer@example.com');
    const invoice = await app.store.table('invoices').findById(invoiceId);
    const payment = await seedProviderPayment(app, {
      invoiceId, gateway: 'stripe', amount: invoice.total, reference: 'pi_live_123',
    });

    const eventId = 'evt_platform_test_1';
    const body = JSON.stringify({
      id: eventId,
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: 'pi_live_123',
          amount: Math.round(invoice.total * 100),
          currency: invoice.currency,
          metadata: { payment_id: payment.id },
        },
      },
    });

    await t.test('a signed delivery is processed and settles the invoice', async () => {
      const res = await postRaw(base, '/api/v1/webhooks/stripe', body, {
        'Content-Type': 'application/json',
        'stripe-signature': stripeSignature(STRIPE_SECRET, body),
      });

      assert.strictEqual(res.status, 200, JSON.stringify(res.data));
      assert.deepStrictEqual(res.data, { received: true, status: 'processed', applied: true });

      const afterInvoice = await app.store.table('invoices').findById(invoiceId);
      assert.strictEqual(afterInvoice.status, 'paid');
      assert.strictEqual(Number(afterInvoice.amount_paid), Number(invoice.total));

      const afterPayment = await app.store.table('payments').findById(payment.id);
      assert.strictEqual(afterPayment.status, 'succeeded');
      assert.strictEqual(afterPayment.gateway_reference, 'pi_live_123');

      const order = await app.store.table('orders').findById(invoice.order_id);
      assert.strictEqual(order.status, 'paid');

      const ledger = await app.store.table('billing_ledger').find({ payment_id: payment.id });
      assert.strictEqual(ledger.rows.length, 1, 'exactly one ledger entry');
      assert.strictEqual(ledger.rows[0].entry_type, 'payment');
      assert.strictEqual(Number(ledger.rows[0].amount), Number(invoice.total));

      const event = await app.store.table('webhook_events').findOne({ provider: 'stripe', event_id: eventId });
      assert.strictEqual(event.status, 'processed');
      assert.strictEqual(event.signature_valid, true);
      assert.ok(event.payload.payload_hash, 'raw-body hash recorded for audit');
    });

    await t.test('replaying the same delivery is idempotent', async () => {
      const res = await postRaw(base, '/api/v1/webhooks/stripe', body, {
        'Content-Type': 'application/json',
        'stripe-signature': stripeSignature(STRIPE_SECRET, body),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'already_processed');
      assert.strictEqual(res.data.applied, false);

      const ledger = await app.store.table('billing_ledger').find({ payment_id: payment.id });
      assert.strictEqual(ledger.rows.length, 1, 'no double credit on replay');
    });

    await t.test('a bad signature is a 401 and writes nothing at all', async () => {
      const badBody = JSON.stringify({ id: 'evt_bad_sig', type: 'payment_intent.succeeded', data: { object: { id: 'pi_live_123', amount: 100, currency: 'USD' } } });
      const before = await app.store.table('webhook_events').count({});
      const res = await postRaw(base, '/api/v1/webhooks/stripe', badBody, {
        'Content-Type': 'application/json',
        'stripe-signature': stripeSignature('whsec_wrong_secret_here_000000', badBody),
      });
      assert.strictEqual(res.status, 401, JSON.stringify(res.data));
      assert.strictEqual(await app.store.table('webhook_events').count({}), before, 'no row written for an unverified caller');
    });

    await t.test('an unconfigured provider is a 401 naming the missing variable', async () => {
      const res = await postRaw(base, '/api/v1/webhooks/paypal', '{}', { 'Content-Type': 'application/json' });
      assert.strictEqual(res.status, 401);
      assert.match(res.data.message, /PAYPAL_WEBHOOK_ID/);
    });

    await t.test('an unknown provider is a 404, never the sandbox scheme', async () => {
      const res = await postRaw(base, '/api/v1/webhooks/acme', '{}', { 'Content-Type': 'application/json' });
      assert.strictEqual(res.status, 404);
      assert.match(res.data.message, /Unknown webhook gateway/);
    });

    await t.test('unsupported event types are recorded and ignored with a 200', async () => {
      const ignored = JSON.stringify({ id: 'evt_ignored_1', type: 'customer.subscription.deleted', data: { object: {} } });
      const res = await postRaw(base, '/api/v1/webhooks/stripe', ignored, {
        'Content-Type': 'application/json',
        'stripe-signature': stripeSignature(STRIPE_SECRET, ignored),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'ignored');
      assert.strictEqual(res.data.applied, false);
      assert.strictEqual((await app.store.table('webhook_events').findOne({ event_id: 'evt_ignored_1' })).status, 'ignored');
    });
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Integration: refusals that must not move money
// ---------------------------------------------------------------------------

test('integration: the zero-trust refusals', async (t) => {
  const { base, app, close } = await startServer({
    STRIPE_WEBHOOK_SECRET: STRIPE_SECRET,
    SANDBOX_GATEWAY_WEBHOOK_SECRET: 'sandbox-secret-for-this-suite-02',
    SANDBOX_PAYMENTS: 'true',
  });

  try {
    const { token, invoiceId } = await seedCatalogAndInvoice(base, app, 'refusal-customer@example.com');
    const invoice = await app.store.table('invoices').findById(invoiceId);

    const send = async (eventType, object, eventId) => {
      const body = JSON.stringify({
        id: eventId, type: eventType, created: Math.floor(Date.now() / 1000),
        data: { object },
      });
      return postRaw(base, '/api/v1/webhooks/stripe', body, {
        'Content-Type': 'application/json',
        'stripe-signature': stripeSignature(STRIPE_SECRET, body),
      });
    };

    await t.test('an underpayment is rejected, the invoice stays unpaid and the order is not paid', async () => {
      const payment = await seedProviderPayment(app, { invoiceId, gateway: 'stripe', amount: invoice.total, reference: 'pi_under' });
      const res = await send('payment_intent.succeeded', {
        id: 'pi_under', amount: Math.round(invoice.total * 100) - 500, currency: 'USD', metadata: { payment_id: payment.id },
      }, 'evt_under');

      assert.strictEqual(res.status, 400, JSON.stringify(res.data));
      assert.match(res.data.message, /does not match/i);

      const event = await app.store.table('webhook_events').findOne({ event_id: 'evt_under' });
      assert.strictEqual(event.status, 'rejected');
      assert.strictEqual((await app.store.table('invoices').findById(invoiceId)).status, 'unpaid');
      assert.strictEqual((await app.store.table('orders').findById(invoice.order_id)).status, 'pending');
      assert.strictEqual((await app.store.table('payments').findById(payment.id)).status, 'pending');
      assert.strictEqual((await app.store.table('billing_ledger').find({ payment_id: payment.id })).rows.length, 0);
    });

    await t.test('a payment row that only partly covers the invoice is refused, not applied', async () => {
      // A pending row smaller than the invoice total is a state the platform itself can produce
      // (initiation records the balance due at that moment). If a delivery matches *that* row
      // exactly, the payment-amount check passes — the full-settlement rule is what must still
      // refuse it, because applying it would mark the parent order paid for a partial payment.
      const partial = await seedProviderPayment(app, {
        invoiceId, gateway: 'stripe', amount: Math.round((invoice.total / 2) * 100) / 100, reference: 'pi_partial',
      });
      const res = await send('payment_intent.succeeded', {
        id: 'pi_partial',
        amount: Math.round(Number(partial.amount) * 100),
        currency: 'USD',
        metadata: { payment_id: partial.id },
      }, 'evt_partial');

      assert.strictEqual(res.status, 400, JSON.stringify(res.data));
      assert.match(res.data.message, /invoice total/i);
      assert.strictEqual((await app.store.table('webhook_events').findOne({ event_id: 'evt_partial' })).status, 'rejected');
      assert.strictEqual((await app.store.table('payments').findById(partial.id)).status, 'pending');
      assert.strictEqual((await app.store.table('invoices').findById(invoiceId)).status, 'unpaid');
      assert.strictEqual((await app.store.table('orders').findById(invoice.order_id)).status, 'pending');
      assert.strictEqual((await app.store.table('billing_ledger').find({ payment_id: partial.id })).rows.length, 0);
    });

    await t.test('a currency mismatch is rejected', async () => {
      const payment = await seedProviderPayment(app, { invoiceId, gateway: 'stripe', amount: invoice.total, reference: 'pi_currency', currency: 'USD' });
      const res = await send('payment_intent.succeeded', {
        id: 'pi_currency', amount: Math.round(invoice.total * 100), currency: 'EUR', metadata: { payment_id: payment.id },
      }, 'evt_currency');

      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /currency/i);
      assert.strictEqual((await app.store.table('webhook_events').findOne({ event_id: 'evt_currency' })).status, 'rejected');
      assert.strictEqual((await app.store.table('invoices').findById(invoiceId)).status, 'unpaid');
    });

    await t.test('an unknown payment reference is a 404 and is recorded as rejected', async () => {
      const res = await send('payment_intent.succeeded', {
        id: 'pi_nobody', amount: 100, currency: 'USD', metadata: {},
      }, 'evt_nobody');

      assert.strictEqual(res.status, 404);
      const event = await app.store.table('webhook_events').findOne({ event_id: 'evt_nobody' });
      assert.strictEqual(event.status, 'rejected');
      assert.match(event.error, /No payment record matches/i);
    });

    await t.test('a failed payment marks the payment failed without crediting anything', async () => {
      const payment = await seedProviderPayment(app, { invoiceId, gateway: 'stripe', amount: invoice.total, reference: 'pi_declined' });
      const res = await send('payment_intent.payment_failed', {
        id: 'pi_declined', amount: Math.round(invoice.total * 100), currency: 'USD',
        last_payment_error: { message: 'Your card was declined.' }, metadata: { payment_id: payment.id },
      }, 'evt_declined');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'failed');
      assert.strictEqual(res.data.applied, false);

      const after = await app.store.table('payments').findById(payment.id);
      assert.strictEqual(after.status, 'failed');
      assert.strictEqual(after.rejection_reason, 'Your card was declined.');
      assert.strictEqual((await app.store.table('invoices').findById(invoiceId)).status, 'unpaid');
      assert.strictEqual((await app.store.table('billing_ledger').find({ payment_id: payment.id })).rows.length, 0);
    });

    await t.test('the same event id delivered against a second payment settles nothing', async () => {
      // The event-id claim is what stops a captured delivery being re-pointed at another pending
      // payment: the body is signed by the same provider key, so only the id can refuse it.
      const first = await seedProviderPayment(app, { invoiceId, gateway: 'stripe', amount: invoice.total, reference: 'pi_dedupe_1' });
      const second = await seedProviderPayment(app, { invoiceId, gateway: 'stripe', amount: invoice.total, reference: 'pi_dedupe_2' });

      const sharedId = 'evt_shared_across_payments';
      const deliver = (paymentId, reference) => {
        const body = JSON.stringify({
          id: sharedId, type: 'payment_intent.succeeded', created: Math.floor(Date.now() / 1000),
          data: { object: { id: reference, amount: Math.round(invoice.total * 100), currency: 'USD', metadata: { payment_id: paymentId } } },
        });
        return postRaw(base, '/api/v1/webhooks/stripe', body, {
          'Content-Type': 'application/json',
          'stripe-signature': stripeSignature(STRIPE_SECRET, body),
        });
      };

      const firstRes = await deliver(first.id, 'pi_dedupe_1');
      assert.strictEqual(firstRes.status, 200, JSON.stringify(firstRes.data));
      assert.strictEqual(firstRes.data.status, 'processed');
      assert.strictEqual((await app.store.table('payments').findById(first.id)).status, 'succeeded');

      const replayRes = await deliver(second.id, 'pi_dedupe_2');
      assert.strictEqual(replayRes.status, 200);
      assert.strictEqual(replayRes.data.status, 'already_processed');
      assert.strictEqual(replayRes.data.applied, false);
      assert.strictEqual((await app.store.table('payments').findById(second.id)).status, 'pending', 'second payment untouched');
      assert.strictEqual((await app.store.table('billing_ledger').find({ payment_id: second.id })).rows.length, 0);
      assert.strictEqual((await app.store.table('billing_ledger').find({ payment_id: first.id })).rows.length, 1);
    });

    await t.test('a delivery whose lease is still live reports in_progress instead of racing', async () => {
      const eventId = 'evt_in_flight';
      await app.store.table('webhook_events').insert({
        id: uuidv7(), provider: 'stripe', event_id: eventId, event_type: 'payment.success',
        signature_valid: true, status: 'received',
        payload: { lease_expires_at: new Date(Date.now() + 60_000).toISOString() },
      });

      const res = await send('payment_intent.succeeded', {
        id: 'pi_in_flight', amount: 100, currency: 'USD', metadata: {},
      }, eventId);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.status, 'in_progress');
      assert.strictEqual(res.data.applied, false);
    });

    await t.test('an expired lease is taken over and the event completes', async () => {
      const expiredId = 'evt_expired_lease';
      await app.store.table('webhook_events').insert({
        id: uuidv7(), provider: 'stripe', event_id: expiredId, event_type: 'payment.success',
        signature_valid: true, status: 'received',
        payload: { lease_expires_at: new Date(Date.now() - 60_000).toISOString() },
      });

      const payment = await seedProviderPayment(app, { invoiceId, gateway: 'stripe', amount: invoice.total, reference: 'pi_takeover' });
      const res = await send('payment_intent.succeeded', {
        id: 'pi_takeover', amount: Math.round(invoice.total * 100), currency: 'USD', metadata: { payment_id: payment.id },
      }, expiredId);

      assert.strictEqual(res.status, 200, JSON.stringify(res.data));
      assert.strictEqual(res.data.status, 'processed');
      assert.strictEqual((await app.store.table('invoices').findById(invoiceId)).status, 'paid');
    });
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Integration: initiation guards and the gateway list
// ---------------------------------------------------------------------------

test('integration: gateway availability is reported honestly and initiation is refused with the reason', async (t) => {
  const { base, app, close } = await startServer({
    STRIPE_WEBHOOK_SECRET: STRIPE_SECRET,
    SANDBOX_GATEWAY_WEBHOOK_SECRET: 'sandbox-secret-for-this-suite-03',
    SANDBOX_PAYMENTS: 'true',
  });

  try {
    const { token, invoiceId } = await seedCatalogAndInvoice(base, app, 'gateway-list@example.com');

    await t.test('the invoice payment-methods list names every gateway and why it is unavailable', async () => {
      const res = await jsonFetch(base, { path: `/api/v1/billing/invoices/${invoiceId}/payment-methods` }, token);
      assert.strictEqual(res.status, 200);

      const byId = Object.fromEntries(res.data.gateways.map((g) => [g.id, g]));
      assert.deepStrictEqual(Object.keys(byId).sort(), ['manual', 'paypal', 'paystack', 'sandbox', 'stripe']);

      assert.strictEqual(byId.sandbox.available, true);
      assert.strictEqual(byId.manual.available, true);

      // Configured for webhooks, but checkout needs provider egress this build does not have.
      assert.strictEqual(byId.stripe.available, false);
      assert.match(byId.stripe.reason, /egress/i);
      // Not configured at all: the reason names the missing variable.
      assert.strictEqual(byId.paypal.available, false);
      assert.match(byId.paypal.reason, /PAYPAL_WEBHOOK_ID/);
      assert.strictEqual(byId.paystack.available, false);
      assert.match(byId.paystack.reason, /PAYSTACK_SECRET_KEY/);
    });

    await t.test('initiating a real-provider payment is refused with the reason, not a fabricated reference', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/invoices/${invoiceId}/payments`, method: 'POST', body: { gateway: 'stripe' },
      }, token);
      assert.strictEqual(res.status, 400);
      assert.match(res.data.message, /egress/i);
      assert.strictEqual((await app.store.table('payments').find({ invoice_id: invoiceId })).rows.length, 0, 'no dead payment row');
    });

    await t.test('an unknown gateway is still rejected', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/invoices/${invoiceId}/payments`, method: 'POST', body: { gateway: 'bitcoin' },
      }, token);
      assert.strictEqual(res.status, 400);
    });

    await t.test('the local gateways still work (regression)', async () => {
      const res = await jsonFetch(base, {
        path: `/api/v1/invoices/${invoiceId}/payments`, method: 'POST', body: { gateway: 'sandbox' },
      }, token);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.payment.provider, 'sandbox');
    });
  } finally {
    await close();
  }
});
