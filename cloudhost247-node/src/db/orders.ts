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
  metadata: Record<string, unknown> | null;
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
  /** Phase 6: server-side provisioning metadata (installationId / hosting target). Never client-set. */
  metadata?: Record<string, unknown>;
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
          billing_period, quantity, unit_price_amount, currency, line_total_amount, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
        item.metadata ? JSON.stringify(item.metadata) : null,
      ]
    );
    const row = rows[0];
    if (!row) throw new Error('Failed to create order item');
    items.push(row);
  }

  return { order, items };
}

/** An order joined with its (Phase 5B+) invoice's id/number, if one has been issued for it — every
 * order created since migration 0018 has exactly one (see
 * src/services/billing-service.ts#issueInvoiceForOrder), but the join is a `LEFT JOIN` rather than
 * an assumed inner join so this never breaks if that invariant is ever relaxed. */
export interface OrderWithInvoiceRow extends OrderRow {
  invoice_id: string | null;
  invoice_number: string | null;
}

export async function findOrderById(pool: Queryable, id: string): Promise<OrderWithInvoiceRow | null> {
  const { rows } = await pool.query<OrderWithInvoiceRow>(
    `SELECT o.*, i.id AS invoice_id, i.invoice_number AS invoice_number
     FROM orders o
     LEFT JOIN invoices i ON i.order_id = o.id
     WHERE o.id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function listOrdersForUser(pool: Queryable, userId: string): Promise<OrderWithInvoiceRow[]> {
  const { rows } = await pool.query<OrderWithInvoiceRow>(
    `SELECT o.*, i.id AS invoice_id, i.invoice_number AS invoice_number
     FROM orders o
     LEFT JOIN invoices i ON i.order_id = o.id
     WHERE o.user_id = $1
     ORDER BY o.created_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * Reserved for the payment layer (Phase 5C's manual-payment confirmation, and Phase 5D's verified
 * webhook processing) — the only two legitimate ways an order's `payment_status` can ever change.
 * Never called with a client-supplied value; always called from inside the same transaction as the
 * corresponding payment/invoice update.
 */
export async function setOrderPaymentStatus(tx: Queryable, orderId: string, paymentStatus: string): Promise<OrderRow | null> {
  const { rows } = await tx.query<OrderRow>(
    `UPDATE orders SET payment_status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [paymentStatus, orderId]
  );
  return rows[0] ?? null;
}

export async function setOrderStatus(tx: Queryable, orderId: string, status: string): Promise<OrderRow | null> {
  const { rows } = await tx.query<OrderRow>(
    `UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, orderId]
  );
  return rows[0] ?? null;
}


export async function listOrderItemsForOrder(pool: Queryable, orderId: string): Promise<OrderItemRow[]> {
  const { rows } = await pool.query<OrderItemRow>(
    'SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at ASC',
    [orderId]
  );
  return rows;
}
