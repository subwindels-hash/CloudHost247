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
  confirmed_by_user_id: string | null;
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
 * Creates a payment *attempt* in `pending` status. As of Phase 5C this is called from exactly one
 * place — `src/services/payment-service.ts#initiatePaymentForInvoice`, itself only reachable via a
 * gateway from `src/payments/*` (never with a status other than `pending`, and never client-
 * supplied) — so "a payment row exists" always means "a real gateway (manual or sandbox) was asked
 * to initiate one," never a fabricated success.
 */
export async function createPayment(tx: Queryable, input: CreatePaymentInput): Promise<PaymentRow> {
  // `user_id` and `currency` are deliberately NOT taken from the caller's input — they are read
  // out of the `invoices` row by this same statement, and the amount is checked against that same
  // row. This makes three cross-row invariants structurally impossible to violate rather than
  // merely unlikely (independent audit findings B1, B2, B4):
  //
  //   B1  a payment can never carry a different currency from its invoice
  //   B2  a payment can never be attributed to a different user than its invoice
  //   B4  a payment can never exceed the invoice total
  //
  // Doing it as `INSERT ... SELECT ... FROM invoices` means the invoice is read inside the
  // caller's transaction, under the same snapshot and row locks as the rest of the write, so
  // there is no read-then-write window for the values to change underneath us. A separate
  // `SELECT` followed by an `INSERT` would reintroduce exactly the class of race that the
  // Phase 5C manual-confirmation defect was made of.
  //
  // `input.userId`/`input.currency` are still accepted so every caller keeps documenting what it
  // believes to be true; the assertion below fails loudly if that belief is ever wrong.
  const { rows } = await tx.query<PaymentRow>(
    `INSERT INTO payments (id, invoice_id, user_id, provider, provider_reference, method, amount, currency)
     SELECT $1, i.id, i.user_id, $3, $4, $5, $6::numeric(12,2), i.currency
     FROM invoices i
     WHERE i.id = $2
       AND $6::numeric(12,2) <= i.total_amount
     RETURNING *`,
    [
      input.id,
      input.invoiceId,
      input.provider ?? null,
      input.providerReference ?? null,
      input.method ?? null,
      input.amount,
    ]
  );
  const row = rows[0];
  if (!row) {
    // Zero rows means either the invoice does not exist or the amount exceeded its total. Both
    // are integrity violations rather than ordinary validation failures — the service layer has
    // already established that the invoice exists and is unpaid before calling this.
    throw new Error(
      `Failed to create payment: no invoice ${input.invoiceId} accepts an amount of ${input.amount}`
    );
  }
  if (row.user_id !== input.userId || row.currency !== input.currency) {
    // Unreachable unless a caller's assumptions have drifted from the invoice. Surface it rather
    // than silently recording a payment against the wrong customer or in the wrong currency.
    throw new Error(
      `Payment/invoice mismatch for invoice ${input.invoiceId}: ` +
        `caller expected user=${input.userId} currency=${input.currency}, ` +
        `invoice has user=${row.user_id} currency=${row.currency}`
    );
  }
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

/**
 * Marks every still-`pending` payment attempt for an invoice as `cancelled`, other than
 * `keepPaymentId` (the attempt just created). Called when a customer initiates a *new* attempt for
 * an invoice that already has an older, abandoned one sitting in `pending` — a courtesy cleanup so
 * stale attempts don't pile up, never a statement that anything was actually paid or failed.
 */
export async function cancelOtherPendingPayments(tx: Queryable, invoiceId: string, keepPaymentId: string): Promise<void> {
  await tx.query(
    `UPDATE payments SET status = 'cancelled', updated_at = now()
     WHERE invoice_id = $1 AND id <> $2 AND status = 'pending'`,
    [invoiceId, keepPaymentId]
  );
}

export async function updatePaymentStatus(
  tx: Queryable,
  id: string,
  status: PaymentStatus,
  extra: {
    failureReason?: string | null;
    completedAt?: string | null;
    confirmedByUserId?: string | null;
    /**
     * The status the caller believes the payment is currently in. When supplied it becomes part
     * of the `UPDATE`'s own `WHERE` clause, so the check and the write are a single atomic
     * statement rather than a read followed by a write.
     *
     * This closes a real double-credit race: `confirmManualPayment` reads the payment and checks
     * `status === 'pending'` *outside* its transaction, so two staff requests (or one
     * double-clicked button, or a retried request) could both pass that check before either
     * committed, and each would then append its own `payment` entry to `billing_ledger` — an
     * append-only table whose rows cannot be deleted, only offset by compensating entries. A
     * 25-round stress test reproduced six confirmations, and six ledger entries, for a single
     * invoice.
     *
     * With this guard the loser of the race updates zero rows and gets `null` back, which the
     * caller must treat as "someone else already resolved this payment".
     */
    expectedCurrentStatus?: PaymentStatus;
  } = {}
): Promise<PaymentRow | null> {
  const { rows } = await tx.query<PaymentRow>(
    `UPDATE payments
     SET status = $1, failure_reason = $2, completed_at = $3, confirmed_by_user_id = COALESCE($4, confirmed_by_user_id), updated_at = now()
     WHERE id = $5
       AND ($6::text IS NULL OR status = $6)
     RETURNING *`,
    [
      status,
      extra.failureReason ?? null,
      extra.completedAt ?? null,
      extra.confirmedByUserId ?? null,
      id,
      extra.expectedCurrentStatus ?? null,
    ]
  );
  return rows[0] ?? null;
}
