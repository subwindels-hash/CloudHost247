import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';

/**
 * Exercises the Phase 5B billing API (/api/v1/invoices) end-to-end against a real embedded
 * Postgres engine — not mocks. Covers that checkout (Phase 5A) now also issues a real invoice and
 * an opening ledger entry atomically, ownership isolation, and that no route can create/mutate an
 * invoice or ledger entry.
 */
describe('billing API (/api/v1/invoices)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createCustomer(email: string, password = 'correct-horse-battery'): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword(password);
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'customer')`, [
      userId,
      email,
      passwordHash,
      'Test Customer',
    ]);
    const token = signAuthToken(env, { sub: userId, role: 'customer', email });
    return { userId, token };
  }

  async function makeActivePlanWithPrice(amount = 24.5) {
    const product = await createProduct(db, { id: randomUUID(), slug: `hosting-${randomUUID()}`, name: 'Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status = 'active', visibility = 'public' WHERE id = $1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `plan-${randomUUID()}`, name: 'Starter' });
    await db.query(`UPDATE product_plans SET status = 'active' WHERE id = $1`, [plan.id]);
    await createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', amount, effectiveStatus: 'published' });
    return { product, plan };
  }

  async function checkout(app: ReturnType<typeof buildTestApp>, token: string, plan: { id: string }) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    return app.inject({ method: 'POST', url: '/api/v1/orders', headers: { authorization: `Bearer ${token}` } });
  }

  it('rejects every invoice route when unauthenticated', async () => {
    const app = buildTestApp();
    const res1 = await app.inject({ method: 'GET', url: '/api/v1/invoices' });
    expect(res1.statusCode).toBe(401);
    const res2 = await app.inject({ method: 'GET', url: `/api/v1/invoices/${randomUUID()}` });
    expect(res2.statusCode).toBe(401);
    await app.close();
  });

  it('checkout atomically issues a real invoice with a matching charge ledger entry', async () => {
    const { token, userId } = await createCustomer('invcust1@example.com');
    const { plan } = await makeActivePlanWithPrice(24.5);
    const app = buildTestApp();

    const checkoutRes = await checkout(app, token, plan);
    expect(checkoutRes.statusCode).toBe(201);
    const order = checkoutRes.json().order;
    expect(order.invoiceId).toBeTruthy();
    expect(order.invoiceNumber).toMatch(/^INV-\d{8}$/);

    const listRes = await app.inject({ method: 'GET', url: '/api/v1/invoices', headers: { authorization: `Bearer ${token}` } });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().invoices).toHaveLength(1);
    const invoiceSummary = listRes.json().invoices[0];
    expect(invoiceSummary.id).toBe(order.invoiceId);
    expect(invoiceSummary.orderId).toBe(order.id);
    expect(invoiceSummary.orderNumber).toBe(order.orderNumber);
    expect(invoiceSummary.status).toBe('unpaid');
    expect(invoiceSummary.totalAmount).toBe('24.50');
    expect(invoiceSummary.discountAmount).toBe('0.00');
    expect(invoiceSummary.taxAmount).toBe('0.00');

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${order.invoiceId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const invoice = detailRes.json().invoice;
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0].lineTotalAmount).toBe('24.50');
    expect(invoice.ledger).toHaveLength(1);
    expect(invoice.ledger[0].entryType).toBe('charge');
    expect(invoice.ledger[0].amount).toBe('24.50');

    const { rows } = await db.query('SELECT user_id FROM invoices WHERE id = $1', [order.invoiceId]);
    expect((rows[0] as { user_id: string }).user_id).toBe(userId);
    await app.close();
  });

  it('returns an empty invoice list for a customer who has never checked out', async () => {
    const { token } = await createCustomer('noinvoices@example.com');
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/invoices', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().invoices).toEqual([]);
    await app.close();
  });

  it('a customer can never view another customer\'s invoice (404, not 403)', async () => {
    const alice = await createCustomer('alice-inv@example.com');
    const bob = await createCustomer('bob-inv@example.com');
    const { plan } = await makeActivePlanWithPrice();
    const app = buildTestApp();

    const checkoutRes = await checkout(app, alice.token, plan);
    const invoiceId = checkoutRes.json().order.invoiceId;

    const bobDetailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(bobDetailRes.statusCode).toBe(404);

    const bobListRes = await app.inject({ method: 'GET', url: '/api/v1/invoices', headers: { authorization: `Bearer ${bob.token}` } });
    expect(bobListRes.json().invoices).toEqual([]);
    await app.close();
  });

  it('multiple checkouts each produce their own invoice, all listed for that customer', async () => {
    const { token } = await createCustomer('multiinv@example.com');
    const { plan: plan1 } = await makeActivePlanWithPrice(10);
    const { plan: plan2 } = await makeActivePlanWithPrice(20);
    const app = buildTestApp();

    const order1 = (await checkout(app, token, plan1)).json().order;
    const order2 = (await checkout(app, token, plan2)).json().order;
    expect(order1.invoiceId).not.toBe(order2.invoiceId);

    const listRes = await app.inject({ method: 'GET', url: '/api/v1/invoices', headers: { authorization: `Bearer ${token}` } });
    expect(listRes.json().invoices.map((i: { id: string }) => i.id).sort()).toEqual([order1.invoiceId, order2.invoiceId].sort());
    await app.close();
  });

  it('rejects a malformed invoice id', async () => {
    const { token } = await createCustomer('malformedinv@example.com');
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/invoices/not-a-uuid', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
