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
import { createPricing, updatePricing } from '../../src/db/catalog-pricing';

/**
 * Exercises the Phase 5A commerce API (/api/v1/cart, /api/v1/orders) end-to-end against a real
 * embedded Postgres engine — not mocks. Covers ownership isolation, that no client-supplied price
 * is ever trusted, that an unavailable/inactive line blocks checkout without partially creating an
 * order, and that a placed order's price snapshot survives a later catalog price change.
 */
describe('commerce API (/api/v1/cart, /api/v1/orders)', () => {
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

  async function makeActivePlanWithPrice(amount = 9.99) {
    const product = await createProduct(db, { id: randomUUID(), slug: `hosting-${randomUUID()}`, name: 'Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status = 'active', visibility = 'public' WHERE id = $1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `plan-${randomUUID()}`, name: 'Starter' });
    await db.query(`UPDATE product_plans SET status = 'active' WHERE id = $1`, [plan.id]);
    const pricing = await createPricing(db, {
      id: randomUUID(),
      planId: plan.id,
      billingPeriod: 'monthly',
      currency: 'USD',
      amount,
      effectiveStatus: 'published',
    });
    return { product, plan, pricing };
  }

  it('rejects every cart/order route when unauthenticated', async () => {
    const app = buildTestApp();
    const routes: Array<{ method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string }> = [
      { method: 'GET', url: '/api/v1/cart' },
      { method: 'POST', url: '/api/v1/cart/items' },
      { method: 'PATCH', url: `/api/v1/cart/items/${randomUUID()}` },
      { method: 'DELETE', url: `/api/v1/cart/items/${randomUUID()}` },
      { method: 'POST', url: '/api/v1/orders' },
      { method: 'GET', url: '/api/v1/orders' },
      { method: 'GET', url: `/api/v1/orders/${randomUUID()}` },
    ];
    for (const route of routes) {
      const res = await app.inject({ method: route.method, url: route.url, payload: {} });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });

  it('returns an empty cart for a brand-new customer', async () => {
    const { token } = await createCustomer('newcart@example.com');
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/cart', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().cart).toMatchObject({ items: [], subtotalAmount: '0.00', itemCount: 0, hasUnavailableItems: false });
    await app.close();
  });

  it('adds an item to the cart and computes the subtotal server-side from the live price', async () => {
    const { token } = await createCustomer('addcart@example.com');
    const { plan } = await makeActivePlanWithPrice(19.99);
    const app = buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 2 },
    });
    expect(res.statusCode).toBe(201);
    const cart = res.json().cart;
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].unitPriceAmount).toBe('19.99');
    expect(cart.items[0].lineTotalAmount).toBe('39.98');
    expect(cart.subtotalAmount).toBe('39.98');
    await app.close();
  });

  it('ignores any client-supplied price/subtotal/currency field in the add-to-cart request body', async () => {
    const { token } = await createCustomer('priceattack@example.com');
    const { plan } = await makeActivePlanWithPrice(19.99);
    const app = buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1, unitPriceAmount: '0.01', currency: 'ZZZ', subtotalAmount: '0.01' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().cart.items[0].unitPriceAmount).toBe('19.99');
    expect(res.json().cart.currency).toBe('USD');
    await app.close();
  });

  it('rejects adding a plan with no published price for the requested billing period', async () => {
    const { token } = await createCustomer('nopricebilling@example.com');
    const { plan } = await makeActivePlanWithPrice(19.99); // only 'monthly' is published
    const app = buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'annually', quantity: 1 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects adding an inactive plan or a plan on a non-public product (never leaking existence via a different status code)', async () => {
    const { token } = await createCustomer('inactiveplan@example.com');
    const { plan, product } = await makeActivePlanWithPrice();
    await db.query(`UPDATE product_plans SET status = 'disabled' WHERE id = $1`, [plan.id]);
    const app = buildTestApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    expect(res.statusCode).toBe(404);

    await db.query(`UPDATE product_plans SET status = 'active' WHERE id = $1`, [plan.id]);
    await db.query(`UPDATE products SET visibility = 'private' WHERE id = $1`, [product.id]);
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    expect(res2.statusCode).toBe(404);
    await app.close();
  });

  it('a customer can never update or remove another customer\'s cart item (404, not 403)', async () => {
    const alice = await createCustomer('alice-cart@example.com');
    const bob = await createCustomer('bob-cart@example.com');
    const { plan } = await makeActivePlanWithPrice();
    const app = buildTestApp();

    const addRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    const itemId = addRes.json().cart.items[0].id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { quantity: 5 },
    });
    expect(patchRes.statusCode).toBe(404);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/cart/items/${itemId}`,
      headers: { authorization: `Bearer ${bob.token}` },
    });
    expect(deleteRes.statusCode).toBe(404);

    // Alice's item must be untouched by Bob's failed attempts.
    const cartRes = await app.inject({ method: 'GET', url: '/api/v1/cart', headers: { authorization: `Bearer ${alice.token}` } });
    expect(cartRes.json().cart.items[0].quantity).toBe(1);
    await app.close();
  });

  it('rejects checkout of an empty cart', async () => {
    const { token } = await createCustomer('emptycheckout@example.com');
    const app = buildTestApp();
    const res = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('checks out a cart into a real order, empties the cart, and snapshots the price permanently', async () => {
    const { token, userId } = await createCustomer('checkout1@example.com');
    const { plan, pricing } = await makeActivePlanWithPrice(49.5);
    const app = buildTestApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 2 },
    });

    const checkoutRes = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { authorization: `Bearer ${token}` } });
    expect(checkoutRes.statusCode).toBe(201);
    const order = checkoutRes.json().order;
    expect(order.orderNumber).toMatch(/^CH-\d{8}$/);
    expect(order.status).toBe('pending');
    expect(order.paymentStatus).toBe('unpaid');
    expect(order.subtotalAmount).toBe('99.00');
    expect(order.totalAmount).toBe('99.00');
    expect(order.items).toHaveLength(1);
    expect(order.items[0].unitPriceAmount).toBe('49.50');

    // Cart is now empty.
    const cartRes = await app.inject({ method: 'GET', url: '/api/v1/cart', headers: { authorization: `Bearer ${token}` } });
    expect(cartRes.json().cart.items).toHaveLength(0);

    // Changing the catalog price afterward must never change the placed order.
    await updatePricing(db, pricing.id, { amount: 999 });
    const detailRes = await app.inject({ method: 'GET', url: `/api/v1/orders/${order.id}`, headers: { authorization: `Bearer ${token}` } });
    expect(detailRes.json().order.items[0].unitPriceAmount).toBe('49.50');
    expect(detailRes.json().order.subtotalAmount).toBe('99.00');

    // Order shows up in the customer's own order list.
    const listRes = await app.inject({ method: 'GET', url: '/api/v1/orders', headers: { authorization: `Bearer ${token}` } });
    expect(listRes.json().orders.map((o: { id: string }) => o.id)).toEqual([order.id]);

    const { rows } = await db.query('SELECT user_id FROM orders WHERE id = $1', [order.id]);
    expect((rows[0] as { user_id: string }).user_id).toBe(userId);
    await app.close();
  });

  it('refuses to checkout (and creates no order at all) when a cart line became unavailable after being added', async () => {
    const { token } = await createCustomer('racecondition@example.com');
    const { plan } = await makeActivePlanWithPrice();
    const app = buildTestApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });

    // Simulate staff disabling the plan after it was added to the cart but before checkout.
    await db.query(`UPDATE product_plans SET status = 'disabled' WHERE id = $1`, [plan.id]);

    const checkoutRes = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { authorization: `Bearer ${token}` } });
    expect(checkoutRes.statusCode).toBe(400);

    const { rows } = await db.query('SELECT count(*)::int AS count FROM orders');
    expect((rows[0] as { count: number }).count).toBe(0);
    // The cart line must still be there — a rejected checkout must not silently clear the cart.
    const cartRes = await app.inject({ method: 'GET', url: '/api/v1/cart', headers: { authorization: `Bearer ${token}` } });
    expect(cartRes.json().cart.items).toHaveLength(1);
    await app.close();
  });

  it('a customer can never view another customer\'s order (404, not 403)', async () => {
    const alice = await createCustomer('alice-order@example.com');
    const bob = await createCustomer('bob-order@example.com');
    const { plan } = await makeActivePlanWithPrice();
    const app = buildTestApp();

    await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    const orderRes = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { authorization: `Bearer ${alice.token}` } });
    const orderId = orderRes.json().order.id;

    const bobRes = await app.inject({ method: 'GET', url: `/api/v1/orders/${orderId}`, headers: { authorization: `Bearer ${bob.token}` } });
    expect(bobRes.statusCode).toBe(404);

    const bobListRes = await app.inject({ method: 'GET', url: '/api/v1/orders', headers: { authorization: `Bearer ${bob.token}` } });
    expect(bobListRes.json().orders).toEqual([]);
    await app.close();
  });

  it('rejects a cumulative add that would push a line past the per-line quantity cap (400, not 500)', async () => {
    const { token } = await createCustomer('cumulativeqty@example.com');
    const { plan } = await makeActivePlanWithPrice(19.99);
    const app = buildTestApp();

    // Fill the line right up to the cap — this must succeed.
    const atCap = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 20 },
    });
    expect(atCap.statusCode).toBe(201);
    expect(atCap.json().cart.items[0].quantity).toBe(20);

    // Adding *any* more must be refused honestly. `addCartItem` upserts additively
    // (quantity = existing + requested), so 20 + 1 would violate
    // cart_items_quantity_positive_check at the database level — that must surface as a clean
    // client error, never as an unhandled 500.
    const overflow = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    expect(overflow.statusCode).toBe(400);
    expect(overflow.json().message).toMatch(/20/);

    // The existing line must be completely unchanged by the rejected attempt.
    const cartRes = await app.inject({ method: 'GET', url: '/api/v1/cart', headers: { authorization: `Bearer ${token}` } });
    expect(cartRes.json().cart.items).toHaveLength(1);
    expect(cartRes.json().cart.items[0].quantity).toBe(20);
    await app.close();
  });

  it('rejects an out-of-range quantity on both add-to-cart and quantity-update', async () => {
    const { token } = await createCustomer('badqty@example.com');
    const { plan } = await makeActivePlanWithPrice();
    const app = buildTestApp();

    const addRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 21 },
    });
    expect(addRes.statusCode).toBe(400);

    const okAddRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    const itemId = okAddRes.json().cart.items[0].id;

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/cart/items/${itemId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { quantity: 0 },
    });
    expect(patchRes.statusCode).toBe(400);
    await app.close();
  });
});
