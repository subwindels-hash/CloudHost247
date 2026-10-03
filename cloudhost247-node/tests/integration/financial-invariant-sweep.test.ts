import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateUp } from '../../database/migrate';
import { PgliteClient } from '../../database/db-client';
import { runFinancialInvariantChecks } from '../../tools/verify-financial-invariants';

/**
 * The whole-database financial invariant sweep, executed.
 *
 * `tools/verify-financial-invariants.ts` (then `recovery/verify-financial-invariants.ts`) was written
 * for the Phase 5 audit and is the source of the strongest financial claim in this repository — the
 * `PHASE_5_CHECKPOINT_REPORT.md` line "49/49 checks passed". It was also referenced by no test and
 * run by no gate, and the command its own header documented could not work: it hardcoded a PostgreSQL
 * server at 127.0.0.1:55432 and sat outside this package, where a bare `pg` specifier cannot resolve.
 * A verification script nobody executes is a claim that rots.
 *
 * So this suite runs it on every `npm test`, against the embedded WASM PostgreSQL the rest of the
 * integration suite already uses. It is not a re-implementation of the checks — it calls the same
 * function the CLI calls.
 */
describe('financial invariant sweep', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  /** The sweep needs `Queryable`, and PGlite's `.query()` matches that shape. */
  const sweep = (options: Parameters<typeof runFinancialInvariantChecks>[1] = {}) =>
    runFinancialInvariantChecks(db, { canRunConcurrentQueries: false, ...options });

  it('finds no violation on a freshly migrated database', async () => {
    const result = await sweep();

    expect(result.failures).toEqual([]);
    expect(result.pass).toBe(result.checks);
    // The sweep must actually consist of the checks it claims to run: a no-op would report 0/0.
    expect(result.checks).toBeGreaterThanOrEqual(40);
  });

  it('leaves the database as it found it, so a second run says the same thing as the first', async () => {
    // Every fixture goes in through the real service functions, and the one invoice the probe creates
    // by calling `createInvoice` directly — which therefore has no opening `charge` entry — is
    // deleted once its negative-control check has run. Without that, run two would report a violation
    // caused by run one's own fixture: a red that says nothing about the product.
    const first = await sweep();
    const second = await sweep();

    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(second.pass).toBe(first.pass);
    expect(second.checks).toBe(first.checks);
  });

  it('says which claim a single-connection client cannot establish, instead of implying it did', async () => {
    // PGlite holds one connection, so the six "concurrent" confirmations are serialised and cannot
    // interleave. The race itself is therefore not exercised here, and the sweep reports that rather
    // than letting a serialised run count as a proof of concurrency.
    const serialised = await sweep();
    expect(serialised.unproven).toHaveLength(1);
    expect(serialised.unproven[0]).toContain('single connection');
    expect(serialised.unproven[0]).toContain('verify:financial');

    // On a client that really can run statements in parallel, nothing is left unproven. (The same
    // database, deliberately: the sweep must be re-runnable.)
    const concurrent = await runFinancialInvariantChecks(db, { canRunConcurrentQueries: true });
    expect(concurrent.unproven).toEqual([]);
    expect(concurrent.failures).toEqual([]);
  });

  it('catches a double-credited invoice — the defect it was written for', async () => {
    // This is the historical failure: two `payment` entries against one invoice, which is what
    // concurrent staff confirmations produced before the atomic status check. Migration 0023's
    // triggers do not prevent it (they validate owner and currency, not cardinality), so it can be
    // injected — and a sweep that did not flag it would be worthless.
    expect((await sweep()).failures).toEqual([]);

    const credited = await db.query<{ invoice_id: string; user_id: string; currency: string; amount: string }>(
      `SELECT invoice_id, user_id, currency, amount FROM billing_ledger WHERE entry_type='payment' LIMIT 1`
    );
    expect(credited.rows).toHaveLength(1);
    const { invoice_id, user_id, currency, amount } = credited.rows[0];

    await db.query(
      `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
       VALUES ($1,$2,$3,'payment',$4,$5,'injected duplicate credit')`,
      [randomUUID(), user_id, invoice_id, amount, currency]
    );

    const dirty = await sweep();
    expect(dirty.failures).toEqual(
      expect.arrayContaining([
        'no invoice has more than one payment ledger entry',
        'no invoice is credited beyond its total',
      ])
    );
  });

  it('catches an invoice marked paid with no payment behind it, and goes quiet once it is undone', async () => {
    // The probe's own fixtures create the subject: an invoice issued but not yet paid.
    expect((await sweep()).failures).toEqual([]);
    const invoice = await db.query<{ id: string; status: string }>(
      `SELECT i.id, i.status FROM invoices i
       WHERE i.status <> 'paid'
       AND NOT EXISTS (SELECT 1 FROM billing_ledger l WHERE l.invoice_id=i.id AND l.entry_type='payment')
       LIMIT 1`
    );
    expect(invoice.rows).toHaveLength(1);
    const { id, status } = invoice.rows[0];

    await db.query(`UPDATE invoices SET status='paid' WHERE id=$1`, [id]);
    expect((await sweep()).failures).toContain('every invoice marked paid has a payment ledger entry');

    // …and the sweep is not simply "always red": undoing the write makes it clean again.
    await db.query(`UPDATE invoices SET status=$2 WHERE id=$1`, [id, status]);
    expect((await sweep()).failures).toEqual([]);
  });

  it('honours concurrencyRounds so a caller can bound the stress section', async () => {
    const result = await sweep({ concurrencyRounds: 2, canRunConcurrentQueries: true });
    expect(result.failures).toEqual([]);
    expect(result.checks).toBeGreaterThanOrEqual(40);
  });
});
