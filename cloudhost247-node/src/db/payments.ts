import type { Queryable } from './types';

export interface PaymentRow {
  id: string;
  invoice_id: string;
  user_id: string;
  provider: string | null;
  provider_reference: string | null;
  method: string | null;
  amount: string;
  currency: string;
  status: string;
  failure_reason: string | null;
  initiated_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentStatus = 'pending' | 'successful' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded';

export interface CreatePaymentInput {
  id: string;
  invoiceId: string;
  userId: string;
  amount: string;
  currency: string;
  provider?: string | null;
  providerReference?: string | null;
  method?: string | null;
}

/**
 * Schema/repository foundation laid down in Phase 5B for Phase 5C's payment gateway abstraction —
 * **no route or service anywhere calls this yet**. There is no payment gateway wired up as of
 * Phase 5B, so nothing in the codebase has a legitimate reason to create a payment record; doing so
 * here without a real gateway behind it would be exactly the "simulated payment success" the
 * project's standing security rules forbid.
 */
export async function createPayment(tx: Queryable, input: CreatePaymentInput): Promise<PaymentRow> {
  const { rows } = await tx.query<PaymentRow>(
    `INSERT INTO payments (id, invoice_id, user_id, provider, provider_reference, method, amount, currency)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.id,
      input.invoiceId,
      input.userId,
      input.provider ?? null,
      input.providerReference ?? null,
      input.method ?? null,
      input.amount,
      input.currency,
    ]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to create payment');
  return row;
}

export async function findPaymentById(pool: Queryable, id: string): Promise<PaymentRow | null> {
  const { rows } = await pool.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 LIMIT 1', [id]);
  return rows[0] ?? null;
}

/** The exact lookup Phase 5D's webhook idempotency check will use: "have we already recorded this
 * provider's transaction?" before creating a new payment row for an incoming webhook event. */
export async function findPaymentByProviderReference(pool: Queryable, provider: string, providerReference: string): Promise<PaymentRow | null> {
  const { rows } = await pool.query<PaymentRow>(
    'SELECT * FROM payments WHERE provider = $1 AND provider_reference = $2 LIMIT 1',
    [provider, providerReference]
  );
  return rows[0] ?? null;
}

export async function listPaymentsForInvoice(pool: Queryable, invoiceId: string): Promise<PaymentRow[]> {
  const { rows } = await pool.query<PaymentRow>(
    'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY created_at ASC',
    [invoiceId]
  );
  return rows;
}

export async function updatePaymentStatus(
  tx: Queryable,
  id: string,
  status: PaymentStatus,
  extra: { failureReason?: string | null; completedAt?: string | null } = {}
): Promise<PaymentRow | null> {
  const { rows } = await tx.query<PaymentRow>(
    `UPDATE payments
     SET status = $1, failure_reason = $2, completed_at = $3, updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [status, extra.failureReason ?? null, extra.completedAt ?? null, id]
  );
  return rows[0] ?? null;
}
