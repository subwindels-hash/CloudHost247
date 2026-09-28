import type { Queryable } from './types';

export interface OrderRow {
  id: string;
  order_number: string;
  user_id: string;
  currency: string;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  status: string;
  payment_status: string;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  plan_id: string | null;
  product_name_snapshot: string;
  plan_name_snapshot: string;
  billing_period: string;
  quantity: number;
  unit_price_amount: string;
  currency: string;
  line_total_amount: string;
  created_at: string;
}

export interface CreateOrderItemInput {
  id: string;
  productId: string | null;
  planId: string | null;
  productNameSnapshot: string;
  planNameSnapshot: string;
  billingPeriod: string;
  quantity: number;
  unitPriceAmount: string;
  currency: string;
  lineTotalAmount: string;
}

export interface CreateOrderInput {
  id: string;
  userId: string;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  items: CreateOrderItemInput[];
}

/**
 * Inserts an order and all of its items. Callers (src/services/commerce-service.ts) must always
 * invoke this inside `withTransaction` (src/db/transaction.ts) together with clearing the cart it
 * came from — an order existing without its items, or an order existing while the cart that
 * produced it was never emptied, must never be observable.
 */
export async function createOrder(tx: Queryable, input: CreateOrderInput): Promise<{ order: OrderRow; items: OrderItemRow[] }> {
  const { rows: orderRows } = await tx.query<OrderRow>(
    `INSERT INTO orders (id, user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.id, input.userId, input.currency, input.subtotalAmount, input.discountAmount, input.taxAmount, input.totalAmount]
  );
  const order = orderRows[0];
  if (!order) throw new Error('Failed to create order');

  const items: OrderItemRow[] = [];
  for (const item of input.items) {
    const { rows } = await tx.query<OrderItemRow>(
      `INSERT INTO order_items
         (id, order_id, product_id, plan_id, product_name_snapshot, plan_name_snapshot,
          billing_period, quantity, unit_price_amount, currency, line_total_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        item.id,
        order.id,
        item.productId,
        item.planId,
        item.productNameSnapshot,
        item.planNameSnapshot,
        item.billingPeriod,
        item.quantity,
        item.unitPriceAmount,
        item.currency,
        item.lineTotalAmount,
      ]
    );
    const row = rows[0];
    if (!row) throw new Error('Failed to create order item');
    items.push(row);
  }

  return { order, items };
}

export async function findOrderById(pool: Queryable, id: string): Promise<OrderRow | null> {
  const { rows } = await pool.query<OrderRow>('SELECT * FROM orders WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

export async function listOrdersForUser(pool: Queryable, userId: string): Promise<OrderRow[]> {
  const { rows } = await pool.query<OrderRow>(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
    [userId]
  );
  return rows;
}

export async function listOrderItemsForOrder(pool: Queryable, orderId: string): Promise<OrderItemRow[]> {
  const { rows } = await pool.query<OrderItemRow>(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC',
    [orderId]
  );
  return rows;
}
