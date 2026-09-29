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
  // The caller's asserted `userId`/`currency` are part of the WHERE clause, not a check performed
  // after the fact. This is deliberate and load-bearing: an earlier version of this function
  // INSERTed first and compared afterwards, which meant a mismatched call still wrote its row and
  // only then threw. Inside a transaction the rollback hid that, but `tx` is typed `Queryable` —
  // a plain `Pool` satisfies it, and under autocommit the "rejected" write was committed for
  // good. In an append-only table whose rows can never be deleted, the safety net was creating
  // exactly the corruption it existed to prevent. Now a mismatch matches no row, so nothing is
  // written at all and the throw below is the only outcome.
  const { rows } = input.invoiceId
    ? await tx.query<LedgerEntryRow>(
        `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
         SELECT $1, i.user_id, i.id, $3, $4::numeric(12,2), i.currency, $5
         FROM invoices i
         WHERE i.id = $2
           AND i.user_id = $6
           AND i.currency = $7
         RETURNING *`,
        [input.id, input.invoiceId, input.entryType, input.amount, input.description, input.userId, input.currency]
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
    if (!input.invoiceId) throw new Error('Failed to record ledger entry');
    // Nothing was written. Read the invoice back purely to say *why* — a missing invoice and a
    // mismatched owner/currency are different bugs and the message should not conflate them.
    const { rows: diag } = await tx.query<{ user_id: string; currency: string }>(
      `SELECT user_id, currency FROM invoices WHERE id = $1`,
      [input.invoiceId]
    );
    const invoice = diag[0];
    if (!invoice) {
      throw new Error(`Failed to record ledger entry: invoice ${input.invoiceId} does not exist`);
    }
    throw new Error(
      `Ledger/invoice mismatch for invoice ${input.invoiceId}: ` +
        `caller expected user=${input.userId} currency=${input.currency}, ` +
        `invoice has user=${invoice.user_id} currency=${invoice.currency}`
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

export interface AdminLedgerEntryRow extends LedgerEntryRow {
  user_email: string;
  user_full_name: string;
  invoice_number: string | null;
}

export interface ListAllLedgerOptions {
  page?: number;
  limit?: number;
  userId?: string;
  invoiceId?: string;
  entryType?: string;
}

export async function listAllLedgerEntriesAdmin(
  pool: Queryable,
  options: ListAllLedgerOptions = {}
): Promise<{ ledger: AdminLedgerEntryRow[]; total: number }> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(100, options.limit ?? 20));
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options.userId) {
    params.push(options.userId);
    conditions.push(`l.user_id = $${params.length}`);
  }

  if (options.invoiceId) {
    params.push(options.invoiceId);
    conditions.push(`l.invoice_id = $${params.length}`);
  }

  if (options.entryType) {
    params.push(options.entryType);
    conditions.push(`l.entry_type = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text as count
     FROM billing_ledger l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     ${whereClause}`,
    params
  );
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

  const queryParams = [...params, limit, offset];
  const limitPlaceholder = `$${queryParams.length - 1}`;
  const offsetPlaceholder = `$${queryParams.length}`;

  const { rows } = await pool.query<AdminLedgerEntryRow>(
    `SELECT l.*, u.email as user_email, u.full_name as user_full_name, i.invoice_number
     FROM billing_ledger l
     JOIN users u ON u.id = l.user_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     ${whereClause}
     ORDER BY l.created_at DESC
     LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}`,
    queryParams
  );

  return { ledger: rows, total };
}

