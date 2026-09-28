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
  const { rows } = await tx.query<LedgerEntryRow>(
    `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [input.id, input.userId, input.invoiceId, input.entryType, input.amount, input.currency, input.description]
  );
  const row = rows[0];
  if (!row) throw new Error('Failed to record ledger entry');
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
