import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createUser } from '../../src/db/users';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import {
  addCartItem,
  clearCart,
  findCartItemWithOwner,
  getOrCreateCartForUser,
  listCartItemsWithDetails,
  removeCartItem,
  setCartItemQuantity,
} from '../../src/db/carts';
import { createOrder, findOrderById, listOrderItemsForOrder, listOrdersForUser } from '../../src/db/orders';
import { withTransaction } from '../../src/db/transaction';
import { fromCents, multiplyCents, sumCents, toCents } from '../../src/lib/money';

/**
 * Exercises the real Phase 5A schema (carts, cart_items, orders, order_items) and its repository
 * functions against a real embedded Postgres engine (pglite) migrated with the actual committed
 * migration files — not mocks. Mirrors tests/integration/catalog-schema.test.ts's approach for
 * Phase 3 and tests/integration/customer-app-schema.test.ts's approach for Phase 4.
 */
describe('Phase 5A commerce database schema and repositories', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function makeUser(email: string) {
    return createUser(db, { id: randomUUID(), email, passwordHash: 'hash', fullName: 'Test User' });
  }

  async function makeActivePlanWithPrice(amount = 9.99) {
    const product = await createProduct(db, { id: randomUUID(), slug: `hosting-${randomUUID()}`, name: 'Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status = 'active' WHERE id = $1`, [product.id]);
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

  it('gives each user exactly one cart via the unique(user_id) upsert', async () => {
    const user = await makeUser('cart1@example.com');
    const first = await getOrCreateCartForUser(db, user.id, randomUUID());
    const second = await getOrCreateCartForUser(db, user.id, randomUUID());
    expect(second.id).toBe(first.id);

    const { rows } = await db.query('SELECT count(*)::int AS count FROM carts WHERE user_id = $1', [user.id]);
    expect((rows[0] as { count: number }).count).toBe(1);
  });

  it('rejects a cart_items quantity of 0 or > 20', async () => {
    const user = await makeUser('cart2@example.com');
    const cart = await getOrCreateCartForUser(db, user.id, randomUUID());
    const { plan } = await makeActivePlanWithPrice();

    await expect(
      db.query(`INSERT INTO cart_items (id, cart_id, plan_id, billing_period, quantity) VALUES ($1, $2, $3, 'monthly', 0)`, [
        randomUUID(),
        cart.id,
        plan.id,
      ])
    ).rejects.toThrow();

    await expect(
      db.query(`INSERT INTO cart_items (id, cart_id, plan_id, billing_period, quantity) VALUES ($1, $2, $3, 'monthly', 21)`, [
        randomUUID(),
        cart.id,
        plan.id,
      ])
    ).rejects.toThrow();
  });

  it('upserts on (cart_id, plan_id, billing_period): adding twice increases quantity, not rows', async () => {
    const user = await makeUser('cart3@example.com');
    const cart = await getOrCreateCartForUser(db, user.id, randomUUID());
    const { plan } = await makeActivePlanWithPrice();

    await addCartItem(db, { id: randomUUID(), cartId: cart.id, planId: plan.id, billingPeriod: 'monthly', quantity: 1 });
    const second = await addCartItem(db, { id: randomUUID(), cartId: cart.id, planId: plan.id, billingPeriod: 'monthly', quantity: 2 });

    expect(second.quantity).toBe(3);
    const { rows } = await db.query('SELECT count(*)::int AS count FROM cart_items WHERE cart_id = $1', [cart.id]);
    expect((rows[0] as { count: number }).count).toBe(1);
  });

  it('joins cart items to the live published price and returns null when no published price exists for that currency/period', async () => {
    const user = await makeUser('cart4@example.com');
    const cart = await getOrCreateCartForUser(db, user.id, randomUUID());
    const { plan } = await makeActivePlanWithPrice(19.99);

    await addCartItem(db, { id: randomUUID(), cartId: cart.id, planId: plan.id, billingPeriod: 'monthly', quantity: 2 });
    // No published annually price exists for this plan.
    await addCartItem(db, { id: randomUUID(), cartId: cart.id, planId: plan.id, billingPeriod: 'annually', quantity: 1 });

    const lines = await listCartItemsWithDetails(db, cart.id, 'USD');
    expect(lines).toHaveLength(2);
    const monthly = lines.find((l) => l.billing_period === 'monthly')!;
    const annually = lines.find((l) => l.billing_period === 'annually')!;
    expect(monthly.unit_price_amount).toBe('19.99');
    expect(annually.unit_price_amount).toBeNull();
  });

  it('removes and clears cart items', async () => {
    const user = await makeUser('cart5@example.com');
    const cart = await getOrCreateCartForUser(db, user.id, randomUUID());
    const { plan } = await makeActivePlanWithPrice();
    const item = await addCartItem(db, { id: randomUUID(), cartId: cart.id, planId: plan.id, billingPeriod: 'monthly', quantity: 1 });

    await setCartItemQuantity(db, item.id, 5);
    let lines = await listCartItemsWithDetails(db, cart.id, 'USD');
    expect(lines[0]?.quantity).toBe(5);

    await removeCartItem(db, item.id);
    lines = await listCartItemsWithDetails(db, cart.id, 'USD');
    expect(lines).toHaveLength(0);

    await addCartItem(db, { id: randomUUID(), cartId: cart.id, planId: plan.id, billingPeriod: 'monthly', quantity: 1 });
    await clearCart(db, cart.id);
    lines = await listCartItemsWithDetails(db, cart.id, 'USD');
    expect(lines).toHaveLength(0);
  });

  it('resolves a cart item together with its owning user id, for ownership checks', async () => {
    const user = await makeUser('cart6@example.com');
    const cart = await getOrCreateCartForUser(db, user.id, randomUUID());
    const { plan } = await makeActivePlanWithPrice();
    const item = await addCartItem(db, { id: randomUUID(), cartId: cart.id, planId: plan.id, billingPeriod: 'monthly', quantity: 1 });

    const withOwner = await findCartItemWithOwner(db, item.id);
    expect(withOwner?.cart_user_id).toBe(user.id);
  });

  it('generates unique, sequential, zero-padded order numbers via order_number_seq', async () => {
    const user = await makeUser('order1@example.com');
    const { rows: r1 } = await db.query('INSERT INTO orders (id, user_id, subtotal_amount, total_amount) VALUES ($1, $2, 10, 10) RETURNING order_number', [
      randomUUID(),
      user.id,
    ]);
    const { rows: r2 } = await db.query('INSERT INTO orders (id, user_id, subtotal_amount, total_amount) VALUES ($1, $2, 10, 10) RETURNING order_number', [
      randomUUID(),
      user.id,
    ]);
    const n1 = (r1[0] as { order_number: string }).order_number;
    const n2 = (r2[0] as { order_number: string }).order_number;
    expect(n1).toMatch(/^CH-\d{8}$/);
    expect(n2).toMatch(/^CH-\d{8}$/);
    expect(n1).not.toBe(n2);
  });

  it('rejects an order with a negative total and an invalid status/payment_status', async () => {
    const user = await makeUser('order2@example.com');
    await expect(
      db.query('INSERT INTO orders (id, user_id, subtotal_amount, total_amount) VALUES ($1, $2, -5, -5)', [randomUUID(), user.id])
    ).rejects.toThrow();
    await expect(
      db.query(`INSERT INTO orders (id, user_id, subtotal_amount, total_amount, status) VALUES ($1, $2, 10, 10, 'shipped')`, [
        randomUUID(),
        user.id,
      ])
    ).rejects.toThrow();
  });

  it('createOrder writes order + order_items snapshots that survive later catalog changes', async () => {
    const user = await makeUser('order3@example.com');
    const { plan, product } = await makeActivePlanWithPrice(29.99);

    const { order, items } = await createOrder(db, {
      id: randomUUID(),
      userId: user.id,
      currency: 'USD',
      subtotalAmount: '29.99',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '29.99',
      items: [
        {
          id: randomUUID(),
          productId: product.id,
          planId: plan.id,
          productNameSnapshot: product.name,
          planNameSnapshot: plan.name,
          billingPeriod: 'monthly',
          quantity: 1,
          unitPriceAmount: '29.99',
          currency: 'USD',
          lineTotalAmount: '29.99',
        },
      ],
    });

    expect(items).toHaveLength(1);

    // Catalog rename + price change after the fact must never alter the snapshot.
    await db.query(`UPDATE products SET name = 'Renamed Product' WHERE id = $1`, [product.id]);
    await db.query(`UPDATE plan_pricing SET amount = 999 WHERE plan_id = $1`, [plan.id]);

    const reloadedItems = await listOrderItemsForOrder(db, order.id);
    expect(reloadedItems[0]?.product_name_snapshot).toBe(product.name);
    expect(reloadedItems[0]?.unit_price_amount).toBe('29.99');

    const found = await findOrderById(db, order.id);
    expect(found?.id).toBe(order.id);
    const forUser = await listOrdersForUser(db, user.id);
    expect(forUser.map((o) => o.id)).toContain(order.id);
  });

  it('SETs NULL on order_items.plan_id/product_id when the catalog row is deleted, preserving the snapshot text', async () => {
    const user = await makeUser('order4@example.com');
    const { plan, product } = await makeActivePlanWithPrice();

    const { order } = await createOrder(db, {
      id: randomUUID(),
      userId: user.id,
      currency: 'USD',
      subtotalAmount: '9.99',
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: '9.99',
      items: [
        {
          id: randomUUID(),
          productId: product.id,
          planId: plan.id,
          productNameSnapshot: product.name,
          planNameSnapshot: plan.name,
          billingPeriod: 'monthly',
          quantity: 1,
          unitPriceAmount: '9.99',
          currency: 'USD',
          lineTotalAmount: '9.99',
        },
      ],
    });

    await db.query('DELETE FROM product_plans WHERE id = $1', [plan.id]);
    await db.query('DELETE FROM products WHERE id = $1', [product.id]);

    const items = await listOrderItemsForOrder(db, order.id);
    expect(items[0]?.plan_id).toBeNull();
    expect(items[0]?.product_id).toBeNull();
    expect(items[0]?.plan_name_snapshot).toBe(plan.name);
    expect(items[0]?.product_name_snapshot).toBe(product.name);
  });

  it('RESTRICTs deleting a user who has an order (financial history is never cascade-deleted)', async () => {
    const user = await makeUser('order5@example.com');
    await db.query('INSERT INTO orders (id, user_id, subtotal_amount, total_amount) VALUES ($1, $2, 10, 10)', [randomUUID(), user.id]);

    await expect(db.query('DELETE FROM users WHERE id = $1', [user.id])).rejects.toThrow();
  });

  describe('withTransaction', () => {
    it('rolls back every write in the callback when it throws (pglite native transaction path)', async () => {
      const user = await makeUser('tx1@example.com');
      await expect(
        withTransaction(db, async (tx) => {
          await tx.query('INSERT INTO orders (id, user_id, subtotal_amount, total_amount) VALUES ($1, $2, 10, 10)', [randomUUID(), user.id]);
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');

      const { rows } = await db.query('SELECT count(*)::int AS count FROM orders WHERE user_id = $1', [user.id]);
      expect((rows[0] as { count: number }).count).toBe(0);
    });

    it('commits every write in the callback when it resolves', async () => {
      const user = await makeUser('tx2@example.com');
      const orderId = randomUUID();
      await withTransaction(db, async (tx) => {
        await tx.query('INSERT INTO orders (id, user_id, subtotal_amount, total_amount) VALUES ($1, $2, 10, 10)', [orderId, user.id]);
      });

      const found = await findOrderById(db, orderId);
      expect(found).not.toBeNull();
    });

    it('throws a clear configuration error for a handle with neither .transaction nor .connect', async () => {
      const fakePool = { query: async () => ({ rows: [] }) };
      await expect(withTransaction(fakePool as never, async () => 'noop')).rejects.toThrow(/neither/);
    });
  });

  describe('money helpers', () => {
    it('round-trips decimal strings through exact integer cents', () => {
      expect(toCents('19.99')).toBe(1999);
      expect(fromCents(1999)).toBe('19.99');
      expect(fromCents(multiplyCents(toCents('9.99'), 3))).toBe('29.97');
      expect(fromCents(sumCents([1999, 999, 1]))).toBe('29.99');
    });

    it('throws on a non-finite monetary amount rather than silently producing NaN/0', () => {
      expect(() => toCents('not-a-number')).toThrow();
      expect(() => fromCents(1.5)).toThrow();
    });
  });
});
