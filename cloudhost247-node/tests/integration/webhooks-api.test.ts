import { createHmac, createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { createUser } from '../../src/db/users';
import { createPayment } from '../../src/db/payments';
import { tryTakeoverExpiredLease } from '../../src/db/webhook-events';
import { computeCrc32, clearPayPalCertCache, setCustomDnsLookup } from '../../src/payments/paypal-gateway';

describe('Phase 5D Webhook Pipeline API (POST /api/v1/webhooks/:gateway)', () => {
  let db: PGlite;
  const STRIPE_SECRET = 'whsec_test_secret_for_stripe_webhooks_12345';
  const PAYPAL_WEBHOOK_ID = 'WH-TEST-PAYPAL-ID-12345';
  const PAYSTACK_SECRET = 'sk_test_secret_for_paystack_webhooks_12345';
  const SANDBOX_SECRET = 'sandbox_test_webhook_secret_12345';

  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'w'.repeat(32),
    STRIPE_WEBHOOK_SECRET: STRIPE_SECRET,
    PAYPAL_WEBHOOK_ID: PAYPAL_WEBHOOK_ID,
    PAYSTACK_SECRET_KEY: PAYSTACK_SECRET,
    SANDBOX_GATEWAY_WEBHOOK_SECRET: SANDBOX_SECRET,
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    clearPayPalCertCache();
    setCustomDnsLookup(null);
  });

  afterEach(async () => {
    setCustomDnsLookup(null);
    await db.close();
  });

  const buildTestApp = () => buildApp(env, { serveFrontend: false, pool: db });

  // Helpers to set up catalog, user, order, invoice, and payment attempt
  async function createFixture(gateway: string, amount = '49.99', currency = 'USD') {
    const user = await createUser(db, {
      id: randomUUID(),
      email: `customer-${randomUUID()}@example.com`,
      passwordHash: 'hash',
      fullName: 'Webhook Customer',
    });

    const product = await createProduct(db, {
      id: randomUUID(),
      slug: `prod-${randomUUID()}`,
      name: 'Cloud VPS',
      productType: 'hosting',
    });
    await db.query(`UPDATE products SET status='active', visibility='public' WHERE id=$1`, [product.id]);

    const plan = await createPlan(db, {
      id: randomUUID(),
      productId: product.id,
      slug: `plan-${randomUUID()}`,
      name: 'Starter Plan',
    });
    await db.query(`UPDATE product_plans SET status='active' WHERE id=$1`, [plan.id]);

    await createPricing(db, {
      id: randomUUID(),
      planId: plan.id,
      billingPeriod: 'monthly',
      currency,
      amount: parseFloat(amount),
      effectiveStatus: 'published',
    });

    const orderId = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, order_number, status, payment_status, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
       VALUES ($1, $2, 'CH-99999999', 'pending', 'unpaid', $3, $4, '0.00', '0.00', $4)`,
      [orderId, user.id, currency, amount]
    );

    const invoiceId = randomUUID();
    await db.query(
      `INSERT INTO invoices (id, order_id, user_id, invoice_number, status, currency, subtotal_amount, discount_amount, tax_amount, total_amount, due_date)
       VALUES ($1, $2, $3, 'INV-99999999', 'unpaid', $4, $5, '0.00', '0.00', $5, CURRENT_DATE)`,
      [invoiceId, orderId, user.id, currency, amount]
    );

    // Initial charge in ledger
    await db.query(
      `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
       VALUES ($1, $2, $3, 'charge', $4, $5, 'Opening charge')`,
      [randomUUID(), user.id, invoiceId, amount, currency]
    );

    const providerReference = `${gateway}_ref_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const payment = await createPayment(db, {
      id: randomUUID(),
      invoiceId,
      userId: user.id,
      amount,
      currency,
      provider: gateway,
      providerReference,
      method: `${gateway}_test`,
    });

    return { user, orderId, invoiceId, payment, providerReference };
  }

  // --- 1. STRIPE WEBHOOK PROVIDER ---
  describe('Stripe Webhook Provider (/api/v1/webhooks/stripe)', () => {
    it('1. successfully processes payment_intent.succeeded with valid signature', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_stripe_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 4999,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('processed');

      // Verify DB mutations
      const paymentRow = (await db.query('SELECT status, completed_at FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string; completed_at: string };
      expect(paymentRow.status).toBe('successful');
      expect(paymentRow.completed_at).not.toBeNull();

      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('paid');

      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(1);

      await app.close();
    });

    it('2. rejects Stripe webhook with invalid signature (401)', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_stripe_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        data: { object: { id: payment.provider_reference, amount: 4999, currency: 'usd' } },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=bad_signature_hex`,
        },
        payload: JSON.stringify(payload),
      });

      expect(res.statusCode).toBe(401);
      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('pending');
      await app.close();
    });

    it('3. rejects Stripe webhook with missing signature header (401)', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_stripe_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        data: { object: { id: payment.provider_reference, amount: 4999, currency: 'usd' } },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
        },
        payload: JSON.stringify(payload),
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('4. rejects Stripe timestamp replay older than 300 seconds (401)', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_stripe_stale_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        data: { object: { id: payment.provider_reference, amount: 4999, currency: 'usd' } },
      };

      const rawBody = JSON.stringify(payload);
      const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${staleTimestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${staleTimestamp},v1=${signature}`,
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('5. handles payment_intent.payment_failed by marking payment failed with reason', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_stripe_fail_${randomUUID()}`,
        type: 'payment_intent.payment_failed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 4999,
            currency: 'usd',
            last_payment_error: { message: 'Insufficient funds' },
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('failed');

      const paymentRow = (await db.query('SELECT status, failure_reason FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string; failure_reason: string };
      expect(paymentRow.status).toBe('failed');
      expect(paymentRow.failure_reason).toBe('Insufficient funds');

      // Invoice remains unpaid, zero payment ledger entries
      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('unpaid');
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(0);

      await app.close();
    });

    it('6. handles payment_intent.canceled by marking payment cancelled', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_stripe_cancel_${randomUUID()}`,
        type: 'payment_intent.canceled',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 4999,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('failed');

      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('cancelled');
      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('unpaid');

      await app.close();
    });

    it('7. acknowledges checkout.session.completed without duplicate ledger credit', async () => {
      const app = buildTestApp();
      const { invoiceId, payment } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_stripe_session_${randomUUID()}`,
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_123', amount_total: 4999, currency: 'usd' } },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ignored');

      // Payment remains pending, 0 payment ledger entries
      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('pending');
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(0);
      await app.close();
    });

    it('8. rejects transition attempt on already successful payment (state machine terminal protection)', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '49.99', 'USD');

      // Pre-set payment to successful
      await db.query(`UPDATE payments SET status='successful', completed_at=NOW() WHERE id=$1`, [payment.id]);
      await db.query(`UPDATE invoices SET status='paid' WHERE id=$1`, [invoiceId]);

      // Attempt to send a payment failure event on a settled payment
      const payload = {
        id: `evt_terminal_guard_${randomUUID()}`,
        type: 'payment_intent.payment_failed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 4999,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('failed');

      // Payment status remains successful (not reverted to failed)
      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('successful');

      await app.close();
    });
  });

  // --- 2. PAYPAL WEBHOOK PROVIDER & ANTI-SSRF ---
  describe('PayPal Webhook Provider (/api/v1/webhooks/paypal)', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const certPem = publicKey;

    it('9. rejects PayPal webhook attempting SSRF on private/loopback/cloud-metadata IP (401)', async () => {
      const app = buildTestApp();
      const payload = { id: 'WH-TEST', event_type: 'PAYMENT.CAPTURE.COMPLETED' };

      let networkEgressCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        networkEgressCount++;
        return new Response('Mock cert', { status: 200 });
      };

      try {
        const ssrfUrls = [
          'http://169.254.169.254/latest/meta-data',
          'https://127.0.0.1/cert.pem',
          'https://localhost/cert.pem',
          'https://10.0.0.1/cert.pem',
          'https://172.16.0.1/cert.pem',
          'https://192.168.1.1/cert.pem',
          'https://[::1]/cert.pem',
          'http://api.paypal.com/v1/notifications/certs/CERT-1', // Non-HTTPS
          'https://evil-attacker.com/v1/notifications/certs/CERT-1', // Untrusted domain
          'https://evil.paypal.com/v1/notifications/certs/CERT-1', // Wildcard subdomain attack
          'https://attacker.paypal.com/v1/notifications/certs/CERT-1', // Wildcard subdomain attack
          'https://paypal.com.evil-attacker.com/v1/notifications/certs/CERT-1', // Suffix attack
          'https://api.sandbox.paypal.com:8443/v1/notifications/certs/CERT-1', // Non-default port
          'https://api.paypal.com@evil-attacker.com/v1/notifications/certs/CERT-1', // Userinfo spoofing
        ];

        for (const badUrl of ssrfUrls) {
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/webhooks/paypal',
            headers: {
              'content-type': 'application/json',
              'paypal-transmission-id': randomUUID(),
              'paypal-transmission-time': new Date().toISOString(),
              'paypal-transmission-sig': 'bad-sig',
              'paypal-cert-url': badUrl,
              'paypal-auth-algo': 'SHA256withRSA',
            },
            payload: JSON.stringify(payload),
          });
          expect(res.statusCode).toBe(401);
        }

        // DNS-based SSRF: Hostname matches allowlist but DNS resolves to prohibited IPs
        const badDnsScenarios = [
          [{ address: '127.0.0.1', family: 4 }], // Loopback
          [{ address: '::1', family: 6 }], // IPv6 Loopback
          [{ address: '10.254.1.1', family: 4 }], // RFC1918 Private
          [{ address: '172.16.0.1', family: 4 }], // RFC1918 Private
          [{ address: '192.168.1.1', family: 4 }], // RFC1918 Private
          [{ address: '169.254.169.254', family: 4 }], // AWS/GCP Cloud Metadata
          [{ address: 'fc00::1', family: 6 }], // IPv6 Unique Local
          [{ address: 'fe80::1', family: 6 }], // IPv6 Link-Local
          [{ address: '::ffff:127.0.0.1', family: 6 }], // IPv4-mapped loopback
          [{ address: '173.0.93.242', family: 4 }, { address: '10.0.0.1', family: 4 }], // DNS rebinding / mixed public-private
        ];

        for (const dnsRecords of badDnsScenarios) {
          setCustomDnsLookup(async () => dnsRecords);
          const res = await app.inject({
            method: 'POST',
            url: '/api/v1/webhooks/paypal',
            headers: {
              'content-type': 'application/json',
              'paypal-transmission-id': randomUUID(),
              'paypal-transmission-time': new Date().toISOString(),
              'paypal-transmission-sig': 'bad-sig',
              'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-123',
              'paypal-auth-algo': 'SHA256withRSA',
            },
            payload: JSON.stringify(payload),
          });
          expect(res.statusCode).toBe(401);
        }

        // PROOF: Zero network egress occurred during all rejected attempts
        expect(networkEgressCount).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
        setCustomDnsLookup(null);
        await app.close();
      }
    });

    it('10. handles certificate caching and rotation safely', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('paypal', '49.99', 'USD');

      const payload = {
        id: `WH-EVT-CACHE-${randomUUID()}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        create_time: new Date().toISOString(),
        resource: {
          id: payment.provider_reference,
          custom_id: payment.id,
          amount: { value: '49.99', currency_code: 'USD' },
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
      const transmissionId = randomUUID();
      const transmissionTime = new Date().toISOString();
      const crc = computeCrc32(rawBody);
      const verificationString = `${transmissionId}|${transmissionTime}|${PAYPAL_WEBHOOK_ID}|${crc}`;

      const signer = createSign('RSA-SHA256');
      signer.update(verificationString, 'utf8');
      const signature = signer.sign(privateKey, 'base64');

      let fetchCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url: string | URL | Request) => {
        fetchCount++;
        if (String(url).includes('api.sandbox.paypal.com')) {
          return new Response(certPem, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      try {
        const certUrl = 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-ROTATION-1';
        // Request 1: fetches certificate
        const res1 = await app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/paypal',
          headers: {
            'content-type': 'application/json',
            'paypal-transmission-id': transmissionId,
            'paypal-transmission-time': transmissionTime,
            'paypal-transmission-sig': signature,
            'paypal-cert-url': certUrl,
            'paypal-auth-algo': 'SHA256withRSA',
          },
          payload: rawBody,
        });
        expect(res1.statusCode).toBe(200);
        expect(fetchCount).toBe(1);

        // Request 2 (duplicate with new event id but same cert url): hits in-memory cache, 0 extra network fetches
        const payload2 = { ...payload, id: `WH-EVT-CACHE-2-${randomUUID()}` };
        const rawBody2 = Buffer.from(JSON.stringify(payload2), 'utf8');
        const crc2 = computeCrc32(rawBody2);
        const trans2 = randomUUID();
        const signer2 = createSign('RSA-SHA256');
        signer2.update(`${trans2}|${transmissionTime}|${PAYPAL_WEBHOOK_ID}|${crc2}`, 'utf8');
        const sig2 = signer2.sign(privateKey, 'base64');

        const res2 = await app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/paypal',
          headers: {
            'content-type': 'application/json',
            'paypal-transmission-id': trans2,
            'paypal-transmission-time': transmissionTime,
            'paypal-transmission-sig': sig2,
            'paypal-cert-url': certUrl,
            'paypal-auth-algo': 'SHA256withRSA',
          },
          payload: rawBody2,
        });
        expect(res2.statusCode).toBe(200);
        expect(fetchCount).toBe(1); // Cached!
      } finally {
        globalThis.fetch = originalFetch;
        await app.close();
      }
    });

    it('11. rejects malformed RSA signatures (401)', async () => {
      const app = buildTestApp();
      const payload = {
        id: `WH-EVT-${randomUUID()}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        resource: { id: 'ref_123', amount: { value: '49.99', currency_code: 'USD' } },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/paypal',
        headers: {
          'content-type': 'application/json',
          'paypal-transmission-id': randomUUID(),
          'paypal-transmission-time': new Date().toISOString(),
          'paypal-transmission-sig': 'not-a-valid-base64-signature!@#$',
          'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234',
          'paypal-auth-algo': 'SHA256withRSA',
        },
        payload: JSON.stringify(payload),
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('12. does NOT mark invoice paid on approval-only event (CHECKOUT.ORDER.APPROVED)', async () => {
      const app = buildTestApp();
      const { invoiceId, payment } = await createFixture('paypal', '49.99', 'USD');

      const payload = {
        id: `WH-EVT-${randomUUID()}`,
        event_type: 'CHECKOUT.ORDER.APPROVED',
        create_time: new Date().toISOString(),
        resource: {
          id: payment.provider_reference,
          custom_id: payment.id,
          amount: { value: '49.99', currency_code: 'USD' },
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
      const transmissionId = randomUUID();
      const transmissionTime = new Date().toISOString();
      const crc = computeCrc32(rawBody);
      const verificationString = `${transmissionId}|${transmissionTime}|${PAYPAL_WEBHOOK_ID}|${crc}`;

      const signer = createSign('RSA-SHA256');
      signer.update(verificationString, 'utf8');
      const signature = signer.sign(privateKey, 'base64');

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url: string | URL | Request) => {
        if (String(url).includes('api.sandbox.paypal.com')) {
          return new Response(certPem, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/paypal',
          headers: {
            'content-type': 'application/json',
            'paypal-transmission-id': transmissionId,
            'paypal-transmission-time': transmissionTime,
            'paypal-transmission-sig': signature,
            'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234',
            'paypal-auth-algo': 'SHA256withRSA',
          },
          payload: rawBody,
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('ignored');

        // Invoice and payment must remain unpaid/pending
        const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
        expect(invoiceRow.status).toBe('unpaid');
        const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
        expect(paymentRow.status).toBe('pending');
        const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
        expect(ledgerRows).toHaveLength(0);
      } finally {
        globalThis.fetch = originalFetch;
        await app.close();
      }
    });

    it('13. settles payment and writes ledger on PAYMENT.CAPTURE.COMPLETED', async () => {
      const app = buildTestApp();
      const { invoiceId, payment } = await createFixture('paypal', '49.99', 'USD');

      const payload = {
        id: `WH-EVT-CAPTURE-${randomUUID()}`,
        event_type: 'PAYMENT.CAPTURE.COMPLETED',
        create_time: new Date().toISOString(),
        resource: {
          id: payment.provider_reference,
          custom_id: payment.id,
          amount: { value: '49.99', currency_code: 'USD' },
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
      const transmissionId = randomUUID();
      const transmissionTime = new Date().toISOString();
      const crc = computeCrc32(rawBody);
      const verificationString = `${transmissionId}|${transmissionTime}|${PAYPAL_WEBHOOK_ID}|${crc}`;

      const signer = createSign('RSA-SHA256');
      signer.update(verificationString, 'utf8');
      const signature = signer.sign(privateKey, 'base64');

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (url: string | URL | Request) => {
        if (String(url).includes('api.sandbox.paypal.com')) {
          return new Response(certPem, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      };

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/v1/webhooks/paypal',
          headers: {
            'content-type': 'application/json',
            'paypal-transmission-id': transmissionId,
            'paypal-transmission-time': transmissionTime,
            'paypal-transmission-sig': signature,
            'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1234',
            'paypal-auth-algo': 'SHA256withRSA',
          },
          payload: rawBody,
        });

        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe('processed');

        const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
        expect(invoiceRow.status).toBe('paid');
        const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
        expect(paymentRow.status).toBe('successful');
        const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
        expect(ledgerRows).toHaveLength(1);
      } finally {
        globalThis.fetch = originalFetch;
        await app.close();
      }
    });
  });

  // --- 3. PAYSTACK WEBHOOK PROVIDER ---
  describe('Paystack Webhook Provider (/api/v1/webhooks/paystack)', () => {
    it('14. successfully processes charge.success with HMAC-SHA512 signature', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('paystack', '25.00', 'USD');

      const payload = {
        event: 'charge.success',
        data: {
          id: 12345678,
          reference: providerReference,
          amount: 2500,
          currency: 'USD',
          paid_at: new Date().toISOString(),
          metadata: { payment_id: payment.id },
        },
      };

      const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
      const signature = createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/paystack',
        headers: {
          'content-type': 'application/json',
          'x-paystack-signature': signature,
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('processed');

      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('paid');
      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('successful');
      await app.close();
    });

    it('15. rejects Paystack webhook with mutated signature (401)', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('paystack', '25.00', 'USD');

      const payload = {
        event: 'charge.success',
        data: { reference: payment.provider_reference, amount: 2500, currency: 'USD' },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/paystack',
        headers: {
          'content-type': 'application/json',
          'x-paystack-signature': 'bad_paystack_sig_12345',
        },
        payload: JSON.stringify(payload),
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });

  // --- 4. SANDBOX SIMULATED WEBHOOK PROVIDER ---
  describe('Sandbox Webhook Provider (/api/v1/webhooks/sandbox)', () => {
    it('16. processes simulated successful sandbox webhook', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('sandbox', '10.00', 'USD');

      const payload = {
        provider: 'sandbox',
        providerReference,
        paymentId: payment.id,
        outcome: 'successful',
        amount: '10.00',
        currency: 'USD',
        occurredAt: new Date().toISOString(),
      };

      const rawBody = JSON.stringify(payload);
      const signature = createHmac('sha256', SANDBOX_SECRET).update(rawBody, 'utf8').digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/sandbox',
        headers: {
          'content-type': 'application/json',
          'x-cloudhost-signature': signature,
        },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('processed');

      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('paid');
      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('successful');
      await app.close();
    });
  });

  // --- 5. IDEMPOTENCY, CONCURRENCY & LEASE CRASH RECOVERY ---
  describe('Idempotency, Concurrency & Lease Recovery', () => {
    it('17. handles duplicate sequential events idempotently without double-crediting', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '19.99', 'USD');

      const payload = {
        id: `evt_dup_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 1999,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      // First delivery
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().status).toBe('processed');

      // Second duplicate delivery
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().status).toBe('already_processed');

      // Real check: exactly 1 payment ledger row in total
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(1);
      await app.close();
    });

    it('18. commits exactly one transition under concurrent 8-way burst delivery', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '39.99', 'USD');

      const payload = {
        id: `evt_burst_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 3999,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          app.inject({
            method: 'POST',
            url: '/api/v1/webhooks/stripe',
            headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
            payload: rawBody,
          })
        )
      );

      const statusCodes = results.map((r) => r.statusCode);
      expect(statusCodes.every((s) => s === 200)).toBe(true);

      const statuses = results.map((r) => r.json().status);
      expect(statuses.filter((s) => s === 'processed')).toHaveLength(1);

      // Invariant: Exactly 1 payment ledger row
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(1);
      await app.close();
    });

    it('19. recovers from abandoned processing lease after crash timeout', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '15.00', 'USD');

      const eventId = `evt_abandoned_${randomUUID()}`;
      const payload = {
        id: eventId,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 1500,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      // Simulate a crashed worker: insert row in 'processing' status with an expired lease
      await db.query(
        `INSERT INTO webhook_events (id, gateway, event_id, event_type, status, payload_hash, lease_expires_at, received_at)
         VALUES ($1, 'stripe', $2, 'payment_intent.succeeded', 'processing', 'hash', NOW() - INTERVAL '10 seconds', NOW() - INTERVAL '70 seconds')`,
        [randomUUID(), eventId]
      );

      // Retry arrives after lease expired
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('processed');

      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('paid');
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(1);
      await app.close();
    });

    it('20. concurrent lease takeover allows only one claimant to succeed', async () => {
      const eventId = `evt_lease_race_${randomUUID()}`;
      await db.query(
        `INSERT INTO webhook_events (id, gateway, event_id, event_type, status, payload_hash, lease_expires_at, received_at)
         VALUES ($1, 'stripe', $2, 'payment_intent.succeeded', 'processing', 'hash', NOW() - INTERVAL '10 seconds', NOW() - INTERVAL '70 seconds')`,
        [randomUUID(), eventId]
      );

      const newLease = new Date(Date.now() + 60000);
      // Run two concurrent takeover attempts against the same expired event
      const [res1, res2] = await Promise.all([
        tryTakeoverExpiredLease(db, 'stripe', eventId, newLease, 'node-1'),
        tryTakeoverExpiredLease(db, 'stripe', eventId, newLease, 'node-2'),
      ]);

      // Exactly one succeeds, one fails
      expect([res1, res2].filter(Boolean)).toHaveLength(1);
    });
  });

  // --- 6. RAW-BODY BYTE DEPENDENCE TESTS ---
  describe('Raw-Body Byte Dependence & Signature Invariance', () => {
    it('21. rejects signature when body whitespace is modified', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('stripe', '49.99', 'USD');

      const canonicalJson = `{"id":"evt_ws_1","type":"payment_intent.succeeded","data":{"object":{"id":"${payment.provider_reference}","amount":4999,"currency":"usd"}}}`;
      const prettyJson = JSON.stringify(JSON.parse(canonicalJson), null, 2); // Added indentation/whitespace

      const timestamp = Math.floor(Date.now() / 1000);
      // Signature is signed over canonicalJson
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${canonicalJson}`).digest('hex');

      // Send prettyJson with signature from canonicalJson
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: prettyJson,
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('22. rejects signature when JSON key order is modified', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('stripe', '49.99', 'USD');

      const originalJson = `{"type":"payment_intent.succeeded","id":"evt_order_1","data":{"object":{"id":"${payment.provider_reference}","amount":4999,"currency":"usd"}}}`;
      const reorderedJson = `{"id":"evt_order_1","type":"payment_intent.succeeded","data":{"object":{"id":"${payment.provider_reference}","amount":4999,"currency":"usd"}}}`;

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${originalJson}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: reorderedJson,
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('23. rejects signature when unicode escaping is modified', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('stripe', '49.99', 'USD');

      const rawUnicode = `{"id":"evt_u_1","type":"payment_intent.succeeded","desc":"\\u0043loud\\u0048ost","data":{"object":{"id":"${payment.provider_reference}","amount":4999,"currency":"usd"}}}`;
      const literalUnicode = `{"id":"evt_u_1","type":"payment_intent.succeeded","desc":"CloudHost","data":{"object":{"id":"${payment.provider_reference}","amount":4999,"currency":"usd"}}}`;

      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawUnicode}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: literalUnicode,
      });

      expect(res.statusCode).toBe(401);
      await app.close();
    });
  });

  // --- 7. INVARIANT DEFENSE & ZERO-TRUST TAMPERING ---
  describe('Zero-Trust Invariant Checks (B1, B2, B4, B5)', () => {
    it('24. rejects currency tampering (B1) with 400 and mutates no financial state', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_tamper_curr_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 4999,
            currency: 'eur', // Mismatched currency
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(400);

      // Invariant: payment remains pending, invoice remains unpaid, 0 ledger rows
      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('pending');
      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('unpaid');
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(0);
      await app.close();
    });

    it('25. rejects cross-customer ownership mismatch (B2) and mutates no financial state', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '49.99', 'USD');

      // Create another customer and tamper with payment user_id to simulate attribution mismatch
      const otherUser = await createUser(db, {
        id: randomUUID(),
        email: `other-owner-${randomUUID()}@example.com`,
        passwordHash: 'hash',
        fullName: 'Other Owner',
      });

      // Temporarily disable DB trigger to simulate legacy/corrupted state and test application-level B2 defense
      await db.query(`ALTER TABLE payments DISABLE TRIGGER payments_validate_invariants`);
      await db.query(`UPDATE payments SET user_id=$1 WHERE id=$2`, [otherUser.id, payment.id]);
      await db.query(`ALTER TABLE payments ENABLE TRIGGER payments_validate_invariants`);

      const payload = {
        id: `evt_tamper_b2_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 4999,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(400);

      // Invoice remains unpaid, payment remains pending, zero payment ledger entries
      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('pending');
      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('unpaid');
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(0);
      await app.close();
    });

    it('26. rejects amount tampering (B4) with 400 and mutates no financial state', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_tamper_amt_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 99999, // Mismatched excessive amount
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(400);

      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('pending');
      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('unpaid');
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(0);
      await app.close();
    });

    it('27. rejects order/invoice total mismatch (B5) and mutates no financial state', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference, orderId } = await createFixture('stripe', '49.99', 'USD');

      // Temporarily disable DB trigger to simulate order modification and test application-level B5 defense
      await db.query(`ALTER TABLE invoices DISABLE TRIGGER invoices_validate_invariants`);
      await db.query(`UPDATE orders SET total_amount='99.99' WHERE id=$1`, [orderId]);
      await db.query(`ALTER TABLE invoices ENABLE TRIGGER invoices_validate_invariants`);

      const payload = {
        id: `evt_tamper_b5_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 4999,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(400);

      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('unpaid');
      const ledgerRows = (await db.query("SELECT * FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'", [invoiceId])).rows;
      expect(ledgerRows).toHaveLength(0);
      await app.close();
    });

    it('28. rejects unknown payment reference (404)', async () => {
      const app = buildTestApp();
      const payload = {
        id: `evt_unknown_pay_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'non_existent_ref_123',
            amount: 4999,
            currency: 'usd',
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });

    it('29. rejects browser-originated request lacking signature (401)', async () => {
      const app = buildTestApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        payload: { action: 'simulate' },
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('30. rejects malformed unparsable JSON payload (400)', async () => {
      const app = buildTestApp();
      const rawBody = '{invalid_json: true,';
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it('31. rolls back all state cleanly when ledger insertion fails', async () => {
      const app = buildTestApp();
      const { invoiceId, payment, providerReference } = await createFixture('stripe', '49.99', 'USD');

      // Install a failing trigger on billing_ledger
      await db.query(`
        CREATE OR REPLACE FUNCTION test_fail_webhook_ledger() RETURNS TRIGGER AS $$
        BEGIN
          RAISE EXCEPTION 'simulated webhook ledger failure';
        END;
        $$ LANGUAGE plpgsql;
      `);
      await db.query(`
        CREATE TRIGGER test_trigger_fail_webhook_ledger
        BEFORE INSERT ON billing_ledger
        FOR EACH ROW EXECUTE FUNCTION test_fail_webhook_ledger();
      `);

      const payload = {
        id: `evt_ledger_fail_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: providerReference,
            amount: 4999,
            currency: 'usd',
            metadata: { payment_id: payment.id },
          },
        },
      };

      const rawBody = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', STRIPE_SECRET).update(`${timestamp}.${rawBody}`).digest('hex');

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${signature}` },
        payload: rawBody,
      });

      expect(res.statusCode).toBe(500);

      // Invariant: payment status remains pending, invoice remains unpaid
      const paymentRow = (await db.query('SELECT status FROM payments WHERE id=$1', [payment.id])).rows[0] as { status: string };
      expect(paymentRow.status).toBe('pending');
      const invoiceRow = (await db.query('SELECT status FROM invoices WHERE id=$1', [invoiceId])).rows[0] as { status: string };
      expect(invoiceRow.status).toBe('unpaid');

      await app.close();
    });

    it('32. never leaks webhook secrets or database credentials in error responses', async () => {
      const app = buildTestApp();
      const { payment } = await createFixture('stripe', '49.99', 'USD');

      const payload = {
        id: `evt_sec_${randomUUID()}`,
        type: 'payment_intent.succeeded',
        data: { object: { id: payment.provider_reference, amount: 4999, currency: 'usd' } },
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/webhooks/stripe',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=invalid` },
        payload: JSON.stringify(payload),
      });

      const bodyText = res.body;
      expect(bodyText).not.toContain(STRIPE_SECRET);
      expect(bodyText).not.toContain(PAYPAL_WEBHOOK_ID);
      expect(bodyText).not.toContain(PAYSTACK_SECRET);
      expect(bodyText).not.toContain('postgresql://');
      expect(bodyText).not.toContain('pass@localhost');

      await app.close();
    });
  });
});
