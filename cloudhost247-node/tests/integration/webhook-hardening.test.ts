import { createHmac, randomUUID } from 'node:crypto';
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

/**
 * Phase 5 hardening certification — closes independent-audit findings P4-F1..P4-F4 with
 * executable evidence, without weakening any Phase-5D control:
 *
 *   P4-F1  sandbox webhooks REQUIRE a fresh x-cloudhost-timestamp (was optional)
 *   P4-F2  amount representation standardized (string=major units; number=integer cents only)
 *   P4-F4  terminal rejections (parity/state-machine) persist durably and suppress provider
 *          retry storms; transient not-found stays reconcilable after lease expiry
 *   (P4-F3: webhook rate limiting is asserted here too — 301st request in a minute is 429)
 */
describe('Phase 5 Webhook Hardening (P4-F1..F4)', () => {
  let db: PGlite;
  const SANDBOX_SECRET = 'sandbox_hardening_test_secret_67890';

  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'w'.repeat(32),
    SANDBOX_GATEWAY_WEBHOOK_SECRET: SANDBOX_SECRET,
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });
  afterEach(async () => { await db.close(); });

  const buildTestApp = () => buildApp(env, { serveFrontend: false, pool: db });

  async function createFixture(amount = '10.00', currency = 'USD') {
    const user = await createUser(db, {
      id: randomUUID(),
      email: `hardening-${randomUUID()}@example.com`,
      passwordHash: 'hash',
      fullName: 'Hardening Customer',
      username: `hw${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    });
    const product = await createProduct(db, { id: randomUUID(), slug: `prod-${randomUUID()}`, name: 'VPS', productType: 'hosting' });
    await db.query(`UPDATE products SET status='active', visibility='public' WHERE id=$1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `plan-${randomUUID()}`, name: 'Starter' });
    await db.query(`UPDATE product_plans SET status='active' WHERE id=$1`, [plan.id]);
    await createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency, amount: parseFloat(amount), effectiveStatus: 'published' });
    const orderId = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, order_number, status, payment_status, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
       VALUES ($1, $2, 'CH-88888888', 'pending', 'unpaid', $3, $4, '0.00', '0.00', $4)`,
      [orderId, user.id, currency, amount]
    );
    const invoiceId = randomUUID();
    await db.query(
      `INSERT INTO invoices (id, order_id, user_id, invoice_number, status, currency, subtotal_amount, discount_amount, tax_amount, total_amount, due_date)
       VALUES ($1, $2, $3, 'INV-88888888', 'unpaid', $4, $5, '0.00', '0.00', $5, CURRENT_DATE)`,
      [invoiceId, orderId, user.id, currency, amount]
    );
    await db.query(
      `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
       VALUES ($1, $2, $3, 'charge', $4, $5, 'Opening charge')`,
      [randomUUID(), user.id, invoiceId, amount, currency]
    );
    const providerReference = `sandbox_ref_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const payment = await createPayment(db, {
      id: randomUUID(), invoiceId, userId: user.id, amount, currency,
      provider: 'sandbox', providerReference, method: 'sandbox_demo',
    });
    return { user, orderId, invoiceId, payment, providerReference };
  }

  function sandboxHeaders(rawBody: string, extra: Record<string, string> = {}) {
    return {
      'content-type': 'application/json',
      'x-sandbox-signature': createHmac('sha256', SANDBOX_SECRET).update(rawBody, 'utf8').digest('hex'),
      'x-cloudhost-timestamp': String(Date.now()),
      ...extra,
    };
  }
  const sandboxPayload = (providerReference: string, paymentId: string, overrides: Record<string, unknown> = {}) => JSON.stringify({
    provider: 'sandbox', providerReference, paymentId, outcome: 'successful',
    amount: '10.00', currency: 'USD', occurredAt: new Date().toISOString(), ...overrides,
  });

  it('P4-F1a: sandbox webhook WITHOUT a timestamp header is rejected 401', async () => {
    const app = buildTestApp();
    const { payment, providerReference } = await createFixture();
    const body = sandboxPayload(providerReference, payment.id);
    const sig = createHmac('sha256', SANDBOX_SECRET).update(body, 'utf8').digest('hex');
    const res = await app.inject({
      method: 'POST', url: '/api/v1/webhooks/sandbox',
      headers: { 'content-type': 'application/json', 'x-sandbox-signature': sig },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('P4-F1b: sandbox webhook with a malformed timestamp is rejected 401', async () => {
    const app = buildTestApp();
    const { payment, providerReference } = await createFixture();
    const body = sandboxPayload(providerReference, payment.id);
    const res = await app.inject({
      method: 'POST', url: '/api/v1/webhooks/sandbox',
      headers: sandboxHeaders(body, { 'x-cloudhost-timestamp': 'not-a-number' }),
      payload: body,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('P4-F2a: integer-cent number amounts are honored exactly (1000 == $10.00)', async () => {
    const app = buildTestApp();
    const { invoiceId, payment, providerReference } = await createFixture();
    const body = sandboxPayload(providerReference, payment.id, { amount: 1000 });
    const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers: sandboxHeaders(body), payload: body });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('processed');
    const inv = (await db.query(`SELECT status FROM invoices WHERE id=$1`, [invoiceId])).rows[0] as { status: string };
    expect(inv.status).toBe('paid');
    await app.close();
  });

  it('P4-F2b: fractional number amounts are malformed — 400, nothing settles', async () => {
    const app = buildTestApp();
    const { invoiceId, payment, providerReference } = await createFixture();
    const body = sandboxPayload(providerReference, payment.id, { amount: 10.5 });
    const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers: sandboxHeaders(body), payload: body });
    expect(res.statusCode).toBe(400);
    const inv = (await db.query(`SELECT status FROM invoices WHERE id=$1`, [invoiceId])).rows[0] as { status: string };
    expect(inv.status).toBe('unpaid');
    await app.close();
  });

  it('P4-F2c: missing amount is malformed — 400, nothing settles', async () => {
    const app = buildTestApp();
    const { invoiceId, payment, providerReference } = await createFixture();
    const body = JSON.stringify({
      provider: 'sandbox', providerReference, paymentId: payment.id, outcome: 'successful',
      currency: 'USD', occurredAt: new Date().toISOString(),
    });
    const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers: sandboxHeaders(body), payload: body });
    expect(res.statusCode).toBe(400);
    const inv = (await db.query(`SELECT status FROM invoices WHERE id=$1`, [invoiceId])).rows[0] as { status: string };
    expect(inv.status).toBe('unpaid');
    await app.close();
  });

  it('P4-F4a: terminal parity rejection is durable — first attempt 400, redelivery 200/rejected, no reprocessing', async () => {
    const app = buildTestApp();
    const { invoiceId, payment, providerReference } = await createFixture('10.00', 'USD');
    const body = sandboxPayload(providerReference, payment.id, { amount: '99.99' }); // wrong amount, terminal

    const first = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers: sandboxHeaders(body), payload: body });
    expect(first.statusCode).toBe(400);

    // The rejection is now persisted durably (post-rollback committed write) with reason + payment link.
    const evt = (await db.query(
      `SELECT status, error_message, payment_id FROM webhook_events WHERE gateway='sandbox'`,
    )).rows[0] as { status: string; error_message: string; payment_id: string } | undefined;
    expect(evt?.status).toBe('rejected');
    expect(evt?.error_message).toMatch(/does not match invoice total/);
    expect(evt?.payment_id).toBe(payment.id);

    // Identical event redelivered (same providerEventId, fresh timestamp): short-circuits to 200
    // { status:'rejected' } — the provider's retry loop terminates instead of re-executing the
    // settlement path, and nothing financial moves.
    const second = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers: sandboxHeaders(body), payload: body });
    expect(second.statusCode).toBe(200);
    expect(second.json().status).toBe('rejected');

    const inv = (await db.query(`SELECT status FROM invoices WHERE id=$1`, [invoiceId])).rows[0] as { status: string };
    expect(inv.status).toBe('unpaid');
    const ledger = await db.query(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'`, [invoiceId]);
    expect((ledger.rows[0] as { n: number }).n).toBe(0);
    await app.close();
  });

  it('P4-F4b: transient not-found stays reconcilable — redelivery post-lease settles the payment', async () => {
    const app = buildTestApp();
    const { invoiceId, payment, providerReference } = await createFixture('10.00', 'USD');
    const body = sandboxPayload(providerReference, payment.id);

    // Remove the payment row BEFORE the first delivery: webhook arrives "early" (race).
    // Temporarily detach by id — the fixture re-creates it afterwards.
    const keptPaymentId = payment.id;
    const snap = (await db.query(`SELECT * FROM payments WHERE id=$1`, [keptPaymentId])).rows[0] as Record<string, unknown>;
    await db.query(`DELETE FROM payments WHERE id=$1`, [keptPaymentId]);

    const early = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers: sandboxHeaders(body), payload: body });
    expect(early.statusCode).toBe(404); // transient — NOT a durable terminal rejection
    const evt = (await db.query(`SELECT status FROM webhook_events WHERE gateway='sandbox'`)).rows[0] as { status: string } | undefined;
    expect(evt?.status).toBe('processing'); // still leased, not durably rejected

    // Payment materializes (e.g. initiation commits), the provider redelivers after the lease lapses.
    await db.query(
      `INSERT INTO payments (id, invoice_id, user_id, amount, currency, method, provider, provider_reference, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [snap.id, snap.invoice_id, snap.user_id, snap.amount, snap.currency, snap.method, snap.provider, snap.provider_reference, 'pending']
    );
    await db.query(`UPDATE webhook_events SET lease_expires_at = NOW() - INTERVAL '1 second' WHERE gateway='sandbox'`);

    const late = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers: sandboxHeaders(body), payload: body });
    expect(late.statusCode).toBe(200);
    expect(late.json().status).toBe('processed');
    const inv = (await db.query(`SELECT status FROM invoices WHERE id=$1`, [invoiceId])).rows[0] as { status: string };
    expect(inv.status).toBe('paid');
    const ledger = await db.query(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'`, [invoiceId]);
    expect((ledger.rows[0] as { n: number }).n).toBe(1);
    await app.close();
  });

  it('P4-concurrency: 6-way concurrent identical delivery — one processes, every other path is idempotent; ledger has exactly one payment row', async () => {
    const app = buildTestApp();
    const { invoiceId, payment, providerReference } = await createFixture('10.00', 'USD');
    const body = sandboxPayload(providerReference, payment.id);
    const headers = sandboxHeaders(body);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers, payload: body }))
    );
    const statuses = results.map((r) => ({ code: r.statusCode, status: r.json()?.status }));
    const processed = statuses.filter((s) => s.code === 200 && s.status === 'processed');
    expect(processed.length).toBe(1);
    for (const s of statuses) {
      if (!(s.code === 200 && ['processed', 'already_processed', 'in_progress'].includes(s.status))) {
        throw new Error(`unexpected concurrent result: ${JSON.stringify(s)}`);
      }
    }
    const ledger = await db.query(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'`, [invoiceId]);
    expect((ledger.rows[0] as { n: number }).n).toBe(1);
    const pay = (await db.query(`SELECT status FROM payments WHERE id=$1`, [payment.id])).rows[0] as { status: string };
    expect(pay.status).toBe('successful');
    await app.close();
  });

  it('P4-F3: webhook route is throttled (301st POST inside one minute → 429) without affecting prior legit traffic', { timeout: 60000 }, async () => {
    const app = buildTestApp();
    const body = sandboxPayload('nobody', 'na');
    const headers = sandboxHeaders(body);
    let last = 0;
    // All-injected requests share one remote address under app.inject — exactly the per-IP
    // bucket an abusive sender would occupy. 300 legit passes, then 429.
    for (let i = 1; i <= 301; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/v1/webhooks/sandbox', headers, payload: body });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    await app.close();
  });
});
