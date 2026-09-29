import type { Queryable } from './types';

export interface LedgerEntryRow {
  id: string;
  user_id: string;
  invoice_id: string | null;
  entry_type: string;
  amount: string;
  currency: string;
  description: string;
  created_at: string;
}

export type LedgerEntryType = 'charge' | 'payment' | 'refund' | 'credit';

export interface RecordLedgerEntryInput {
  id: string;
  userId: string;
  invoiceId: string | null;
  entryType: LedgerEntryType;
  amount: string;
  currency: string;
  description: string;
}

/**
 * Appends one immutable financial fact. There is deliberately no `updateLedgerEntry`/
 * `deleteLedgerEntry` function anywhere in this codebase — database/migrations/0019 also enforces
 * this at the database level (an `UPDATE`/`DELETE` against `billing_ledger` fails outright,
 * regardless of caller). Correcting a mistake means inserting a new, reversing entry, never editing
 * history.
 */
export async function recordLedgerEntry(tx: Queryable, input: RecordLedgerEntryInput): Promise<LedgerEntryRow> {
  // When the entry belongs to an invoice, `user_id` and `currency` are read out of that invoice
  // by this same statement rather than trusted from the caller — an entry attributed to the
  // wrong customer, or denominated in a different currency from the invoice it settles, becomes
  // structurally impossible (independent audit finding B3). The invoice is read inside the
  // caller's transaction, so there is no read-then-write window.
  //
  // This matters more here than anywhere else in the codebase: `billing_ledger` is append-only
  // and enforced as such by database triggers (0019_create_billing_ledger.sql), so a wrong row
  // written here can never be deleted or edited — only offset by a compensating entry. The
  // cheapest place to be correct is before the INSERT.
  const { rows } = input.invoiceId
    ? await tx.query<LedgerEntryRow>(
        `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
         SELECT $1, i.user_id, i.id, $3, $4::numeric(12,2), i.currency, $5
         FROM invoices i
         WHERE i.id = $2
         RETURNING *`,
        [input.id, input.invoiceId, input.entryType, input.amount, input.description]
      )
    : // A standalone entry with no invoice (e.g. an account-level credit) has no invoice to
      // derive from, so the caller's own values are used. No cross-row invariant applies.
      await tx.query<LedgerEntryRow>(
        `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
         VALUES ($1, $2, NULL, $3, $4, $5, $6)
         RETURNING *`,
        [input.id, input.userId, input.entryType, input.amount, input.currency, input.description]
      );

  const row = rows[0];
  if (!row) {
    throw new Error(
      input.invoiceId
        ? `Failed to record ledger entry: invoice ${input.invoiceId} does not exist`
        : 'Failed to record ledger entry'
    );
  }
  if (input.invoiceId && (row.user_id !== input.userId || row.currency !== input.currency)) {
    throw new Error(
      `Ledger/invoice mismatch for invoice ${input.invoiceId}: ` +
        `caller expected user=${input.userId} currency=${input.currency}, ` +
        `invoice has user=${row.user_id} currency=${row.currency}`
    );
  }
  return row;
}

export async function listLedgerEntriesForInvoice(pool: Queryable, invoiceId: string): Promise<LedgerEntryRow[]> {
  const { rows } = await pool.query<LedgerEntryRow>(
    'SELECT * FROM billing_ledger WHERE invoice_id = $1 ORDER BY created_at ASC',
    [invoiceId]
  );
  return rows;
}

export async function listLedgerEntriesForUser(pool: Queryable, userId: string): Promise<LedgerEntryRow[]> {
  const { rows } = await pool.query<LedgerEntryRow>(
    'SELECT * FROM billing_ledger WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
  return rows;
}
