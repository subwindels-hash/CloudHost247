import type { Queryable } from './types';

export interface InvoiceRow {
  id: string;
  invoice_number: string;
  order_id: string;
  user_id: string;
  currency: string;
  subtotal_amount: string;
  discount_amount: string;
  tax_amount: string;
  total_amount: string;
  status: string;
  due_date: string;
  issued_at: string;
  created_at: string;
  updated_at: string;
}

/** An invoice joined with its parent order's human-facing number — every display of an invoice
 * shows both, so this is the shape every read function below returns rather than a bare
 * `InvoiceRow`. */
export interface InvoiceWithOrderRow extends InvoiceRow {
  order_number: string;
}

export interface CreateInvoiceInput {
  id: string;
  orderId: string;
  userId: string;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
}

/**
 * Issues an invoice for an order. Callers (src/services/billing-service.ts) must always invoke
 * this inside the same `withTransaction` (src/db/transaction.ts) call as the order's own creation
 * and its `charge` ledger entry (src/db/billing-ledger.ts) — an order existing without its invoice,
 * or an invoice existing without its ledger entry, must never be observable.
 */
export async function createInvoice(tx: Queryable, input: CreateInvoiceInput): Promise<InvoiceRow> {
  const { rows } = await tx.query<InvoiceRow>(
    `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, discount_amount, tax_amount, total_amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [input.id, input.orderId, input.userId, input.currency, input.subtotalAmount, input.discountAmount, input.taxAmount, input.totalAmount]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create invoice');
  return row;
}

export async function findInvoiceById(pool: Queryable, id: string): Promise<InvoiceWithOrderRow | null> {
  const { rows } = await pool.query<InvoiceWithOrderRow>(
    `SELECT i.*, o.order_number FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function findInvoiceByOrderId(pool: Queryable, orderId: string): Promise<InvoiceWithOrderRow | null> {
  const { rows } = await pool.query<InvoiceWithOrderRow>(
    `SELECT i.*, o.order_number FROM invoices i JOIN orders o ON o.id = i.order_id WHERE i.order_id = $1 LIMIT 1`,
    [orderId]
  );
  return rows[0] ?? null;
}

export async function listInvoicesForUser(pool: Queryable, userId: string): Promise<InvoiceWithOrderRow[]> {
  const { rows } = await pool.query<InvoiceWithOrderRow>(
    `SELECT i.*, o.order_number FROM invoices i JOIN orders o ON o.id = i.order_id
     WHERE i.user_id = $1 ORDER BY i.created_at DESC`,
    [userId]
  );
  return rows;
}


/**
 * As of Phase 5C, called from exactly one place — `src/services/payment-service.ts#confirmManualPayment`
 * moving `unpaid` -> `paid` when a staff member confirms a manual/offline payment. Phase 5D's
 * verified-webhook processing will call this too (for gateway-confirmed payments, and eventually
 * `refunded`/`partially_refunded`), and a possible future staff `void` action (Phase 5F) may as
 * well. Never called with a client-supplied status value.
 */
export async function setInvoiceStatus(tx: Queryable, id: string, status: string): Promise<InvoiceRow | null> {
  const { rows } = await tx.query<InvoiceRow>(
    `UPDATE invoices SET status = $1, updated_at = now() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] ?? null;
}
