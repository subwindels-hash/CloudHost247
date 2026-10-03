/**
 * Whole-database financial invariant sweep.
 *
 * WHY THIS EXISTS, AND WHY IT IS SHAPED THIS WAY
 *
 * The Phase 5 audit originally verified financial behaviour one call at a time: perform an
 * adversarial operation, assert that it was rejected, move on. That standard passed a defect.
 * `recordLedgerEntry`/`createPayment` enforced their cross-row invariants as an assertion made
 * *after* the INSERT, so a mismatched call wrote its row and only then threw. Inside a
 * transaction the rollback erased it and the per-call assertion looked correct; called with a
 * plain `pg.Pool` the row was committed for good, in an append-only table that forbids deletion.
 *
 * The lesson is that "every call behaved correctly" is a weaker claim than "the database is
 * consistent". This probe therefore always finishes by sweeping the *whole database* for
 * violations, so a write that slips through any individual check is still caught.
 *
 * HOW IT RUNS NOW (changed 2026-10-03)
 *
 * The probe shipped as a bare script that hardcoded a PostgreSQL server at 127.0.0.1:55432 and was
 * documented to run from `recovery/`, outside this package. That command could never work — module
 * resolution for a bare `pg` specifier starts at the *file's* directory, and `node_modules` lives
 * here, in `cloudhost247-node/` — so the strongest financial claim in the repository was
 * unreproducible by anyone following the documentation, and nothing else ran it either.
 *
 * The checks are now a function, `runFinancialInvariantChecks(db, options)`, which runs against any
 * `Queryable`: a real `pg.Pool` (the CLI below), or the embedded WASM PostgreSQL the test suite uses
 * (`tests/integration/financial-invariant-sweep.test.ts`), where it runs on every `npm test` so the
 * sweep cannot rot unnoticed again.
 *
 * It is read-only with respect to the repository and to any real database: it creates its own
 * throwaway database, exercises the real repository and service code against it, sweeps, and drops
 * it. It never connects to production. See recovery/check-production-state.sql for the read-only
 * check intended to be run against a real deployment.
 *
 * Usage:
 *   cd cloudhost247-node && npm run verify:financial
 *
 * Connection (defaults match the original hardcoded values; override to point at any server):
 *   CH247_PROBE_PG_HOST      default 127.0.0.1
 *   CH247_PROBE_PG_PORT      default 55432
 *   CH247_PROBE_PG_USER      default ch
 *   CH247_PROBE_PG_PASSWORD  default ch
 *   CH247_PROBE_PG_BOOTSTRAP default cloudhost247   (must exist; the probe creates its own inside it)
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgClient } from '../database/db-client';
import { migrateUp } from '../database/migrate';
import type { Queryable } from '../src/db/types';
import { createUser } from '../src/db/users';
import { createOrder } from '../src/db/orders';
import { createInvoice } from '../src/db/invoices';
import { createPayment } from '../src/db/payments';
import { recordLedgerEntry } from '../src/db/billing-ledger';
import { withTransaction } from '../src/db/transaction';
import { issueInvoiceForOrder } from '../src/services/billing-service';
import { confirmManualPayment, getMyPaymentDetail } from '../src/services/payment-service';
import { toCents } from '../src/lib/money';

export interface FinancialSweepResult {
  pass: number;
  failures: string[];
  /** Checks that could not be established on this client — never a failure, never silent. */
  unproven: string[];
  checks: number;
}

export interface FinancialSweepOptions {
  /** Concurrent-confirmation rounds. 25 by default, as the original probe ran. */
  concurrencyRounds?: number;
  /**
   * Whether the client can run statements in parallel. A real `pg.Pool` can; the embedded WASM
   * PostgreSQL holds one connection and serialises everything, so a "concurrent" confirmation there
   * proves only the sequential replay path. Stated as `unproven` rather than quietly counted as a
   * race that was tested.
   */
  canRunConcurrentQueries?: boolean;
  log?: (line: string) => void;
}

/** `pg.Pool.query` rejects with a `statusCode`; the service layer uses it for 409 vs 500. */
type StatusError = { statusCode?: number };

/**
 * Runs every financial check against `db`.
 *
 * Every fixture this probe writes goes in through the real service functions, and the one invoice it
 * creates for a negative-control check — by calling `createInvoice` directly, deliberately bypassing
 * `issueInvoiceForOrder` — is deleted again as soon as that check has run. Nothing is left behind
 * that the whole-database sweep would have to special-case, so the sweep is unconditional and a
 * second run against the same database reports the same result as the first.
 */
export async function runFinancialInvariantChecks(
  db: Queryable,
  options: FinancialSweepOptions = {}
): Promise<FinancialSweepResult> {
  const log = options.log ?? (() => {});
  const canRunConcurrent = options.canRunConcurrentQueries !== false;
  const concurrencyRounds = canRunConcurrent ? options.concurrencyRounds ?? 25 : 1;

  let pass = 0;
  const failures: string[] = [];
  const unproven: string[] = [];

  function check(name: string, ok: boolean, detail = '') {
    if (ok) {
      pass++;
      log(`  PASS  ${name}`);
    } else {
      failures.push(name);
      log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`);
    }
  }

  async function rejects(fn: () => Promise<unknown>): Promise<Error | null> {
    try {
      await fn();
      return null;
    } catch (e) {
      return e as Error;
    }
  }

  const genId = () => randomUUID();

  async function makeUser() {
    return createUser(db, { id: genId(), email: `${genId()}@example.com`, passwordHash: 'h', fullName: 'T' });
  }
  async function makeOrder(userId: string, total = '49.99', currency = 'USD') {
    const { order } = await createOrder(db, {
      id: genId(),
      userId,
      currency,
      subtotalAmount: total,
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount: total,
      items: [],
    });
    return order;
  }
  async function makeInvoicedOrder(total = '49.99') {
    const user = await makeUser();
    const order = await makeOrder(user.id, total);
    const invoice = await withTransaction(db, (tx) => issueInvoiceForOrder(tx, order, genId));
    return { user, order, invoice };
  }

  log('\n=== GROUP 1: the real checkout path (order -> invoice -> opening charge) ===');
  {
    const { order, invoice } = await makeInvoicedOrder('149.97');
    check(
      'the invoice copies the order total exactly',
      invoice.total_amount === order.total_amount,
      `invoice=${invoice.total_amount} order=${order.total_amount}`
    );
    check('the invoice inherits the order owner', invoice.user_id === order.user_id);
    check('the invoice inherits the order currency', invoice.currency === order.currency);
    const led = await db.query<{ entry_type: string; amount: string; currency: string }>(
      `SELECT entry_type, amount, currency FROM billing_ledger WHERE invoice_id=$1`,
      [invoice.id]
    );
    check('exactly one opening charge entry is written', led.rows.length === 1, `rows=${led.rows.length}`);
    check(
      'the charge entry equals the invoice total',
      led.rows[0]?.entry_type === 'charge' && led.rows[0]?.amount === invoice.total_amount,
      `${led.rows[0]?.entry_type} ${led.rows[0]?.amount}`
    );
  }

  log('\n=== GROUP 2: invoice/order cross-row invariants ===');
  {
    // Each case needs its OWN order. `invoices_order_id_unique_idx` allows one invoice per order,
    // so reusing an order after a successful insert makes every later case fail on the unique
    // index rather than on the invariant under test — which is exactly how an earlier run of this
    // probe reported two false PASSes here.
    const stranger = await makeUser();

    const o1 = await makeOrder((await makeUser()).id, '49.99', 'USD');
    check(
      'an invoice cannot be attributed to someone other than the order owner',
      (await rejects(() =>
        createInvoice(db, {
          id: genId(),
          orderId: o1.id,
          userId: stranger.id,
          currency: 'USD',
          subtotalAmount: '49.99',
          discountAmount: '0.00',
          taxAmount: '0.00',
          totalAmount: '49.99',
        })
      )) !== null
    );

    const u2 = await makeUser();
    const o2 = await makeOrder(u2.id, '49.99', 'USD');
    check(
      'an invoice cannot be denominated in a different currency from its order',
      (await rejects(() =>
        createInvoice(db, {
          id: genId(),
          orderId: o2.id,
          userId: u2.id,
          currency: 'EUR',
          subtotalAmount: '49.99',
          discountAmount: '0.00',
          taxAmount: '0.00',
          totalAmount: '49.99',
        })
      )) !== null
    );

    const u3 = await makeUser();
    const o3 = await makeOrder(u3.id, '49.99', 'USD');
    check(
      'an invoice cannot bill a different total from its order',
      (await rejects(() =>
        createInvoice(db, {
          id: genId(),
          orderId: o3.id,
          userId: u3.id,
          currency: 'USD',
          subtotalAmount: '49.99',
          discountAmount: '0.00',
          taxAmount: '0.00',
          totalAmount: '9999.00',
        })
      )) !== null
    );

    const u4 = await makeUser();
    const o4 = await makeOrder(u4.id, '49.99', 'USD');
    check(
      'an invoice cannot fabricate a discount its order never had',
      (await rejects(() =>
        createInvoice(db, {
          id: genId(),
          orderId: o4.id,
          userId: u4.id,
          currency: 'USD',
          subtotalAmount: '49.99',
          discountAmount: '40.00',
          taxAmount: '0.00',
          totalAmount: '49.99',
        })
      )) !== null
    );

    const u5 = await makeUser();
    const o5 = await makeOrder(u5.id, '49.99', 'USD');
    const bareId = genId();
    check(
      'a legitimate invoice matching its order in every field is still accepted',
      (await rejects(() =>
        createInvoice(db, {
          id: bareId,
          orderId: o5.id,
          userId: u5.id,
          currency: 'USD',
          subtotalAmount: '49.99',
          discountAmount: '0.00',
          taxAmount: '0.00',
          totalAmount: '49.99',
        })
      )) === null
    );
    // Created by `createInvoice` directly, so it has no opening `charge` entry — by construction,
    // not by defect. It exists only to prove a legitimate invoice is still accepted; the
    // whole-database sweep below is a statement about invoices the real checkout path issued. Remove
    // it now that its check has run, or the sweep would fail on this probe's own fixture and a
    // second run would report a violation that says nothing about the product.
    await db.query(`DELETE FROM invoices WHERE id=$1`, [bareId]);
  }

  log(
    `\n=== GROUP 3: confirmation of a manual payment (${canRunConcurrent ? 'concurrent' : 'single-connection client'}) ===`
  );
  {
    const staff = await makeUser();
    const { user, invoice } = await makeInvoicedOrder();
    const p = await createPayment(db, {
      id: genId(),
      invoiceId: invoice.id,
      userId: user.id,
      amount: '49.99',
      currency: 'USD',
      provider: 'manual',
      method: 'bank_transfer',
      providerReference: genId(),
    });
    const res = await Promise.allSettled([
      confirmManualPayment(db, staff.id, p.id, genId),
      confirmManualPayment(db, staff.id, p.id, genId),
    ]);
    const ok = res.filter((r) => r.status === 'fulfilled');
    const bad = res.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    check('exactly one confirmation succeeds', ok.length === 1, `fulfilled=${ok.length}`);
    check(
      'the loser gets a deterministic 409, never a 500',
      bad.length === 1 && (bad[0]?.reason as StatusError)?.statusCode === 409
    );
    const n = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'`,
      [invoice.id]
    );
    check('exactly one payment ledger entry - no double credit', n.rows[0].n === 1, `n=${n.rows[0].n}`);

    let overCredits = 0;
    let wrongWinners = 0;
    let non409 = 0;
    for (let r = 0; r < concurrencyRounds; r++) {
      const f = await makeInvoicedOrder('12.34');
      const pay = await createPayment(db, {
        id: genId(),
        invoiceId: f.invoice.id,
        userId: f.user.id,
        amount: '12.34',
        currency: 'USD',
        provider: 'manual',
        method: 'cash',
        providerReference: genId(),
      });
      const rr = await Promise.allSettled(
        Array.from({ length: 6 }, () => confirmManualPayment(db, staff.id, pay.id, genId))
      );
      if (rr.filter((x) => x.status === 'fulfilled').length !== 1) wrongWinners++;
      for (const x of rr) {
        if (x.status === 'rejected' && (x.reason as StatusError)?.statusCode !== 409) non409++;
      }
      const c = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'`,
        [f.invoice.id]
      );
      if (c.rows[0].n !== 1) overCredits++;
    }
    check(
      `stress ${concurrencyRounds}x6: exactly one winner every round`,
      wrongWinners === 0,
      `bad rounds=${wrongWinners}`
    );
    check(`stress ${concurrencyRounds}x6: never a second credit`, overCredits === 0, `over-credited=${overCredits}`);
    check(`stress ${concurrencyRounds}x6: every loser is a 409`, non409 === 0, `non-409=${non409}`);
    if (!canRunConcurrent) {
      unproven.push(
        'the concurrent double-confirmation race itself: this client holds a single connection, so the ' +
          'six confirmations are serialised and cannot interleave. What ran here is the sequential replay ' +
          'path (one winner, one ledger entry, 409 for the loser). Run `npm run verify:financial` against a ' +
          'real PostgreSQL server to exercise the race.'
      );
    }
  }

  log('\n=== GROUP 4: append-only ledger enforcement ===');
  {
    const { invoice } = await makeInvoicedOrder();
    const e = await db.query<{ id: string; amount: string }>(`SELECT id, amount FROM billing_ledger WHERE invoice_id=$1`, [
      invoice.id,
    ]);
    const id = e.rows[0].id;
    check(
      'UPDATE against billing_ledger is refused by the database',
      (await rejects(() => db.query(`UPDATE billing_ledger SET amount='0.01' WHERE id=$1`, [id]))) !== null
    );
    check(
      'DELETE against billing_ledger is refused by the database',
      (await rejects(() => db.query(`DELETE FROM billing_ledger WHERE id=$1`, [id]))) !== null
    );
    const after = await db.query<{ amount: string }>(`SELECT amount FROM billing_ledger WHERE id=$1`, [id]);
    check('the historical entry is unchanged', after.rows[0].amount === e.rows[0].amount);
  }

  log('\n=== GROUP 5: payment/ledger cross-row invariants, called WITHOUT a transaction ===');
  {
    const { user, invoice } = await makeInvoicedOrder();
    const stranger = await makeUser();

    check(
      'payment exceeding the invoice total is rejected',
      (await rejects(() =>
        createPayment(db, {
          id: genId(),
          invoiceId: invoice.id,
          userId: user.id,
          amount: '99999.00',
          currency: 'USD',
          provider: 'manual',
          providerReference: genId(),
        })
      )) !== null
    );
    check(
      'a partial payment below the invoice total is permitted (documented design)',
      (await rejects(() =>
        createPayment(db, {
          id: genId(),
          invoiceId: invoice.id,
          userId: user.id,
          amount: '1.00',
          currency: 'USD',
          provider: 'manual',
          providerReference: genId(),
        })
      )) === null
    );
    check(
      'payment in the wrong currency is rejected',
      (await rejects(() =>
        createPayment(db, {
          id: genId(),
          invoiceId: invoice.id,
          userId: user.id,
          amount: '49.99',
          currency: 'EUR',
          provider: 'manual',
          providerReference: genId(),
        })
      )) !== null
    );
    check(
      'payment attributed to a non-owner is rejected',
      (await rejects(() =>
        createPayment(db, {
          id: genId(),
          invoiceId: invoice.id,
          userId: stranger.id,
          amount: '49.99',
          currency: 'USD',
          provider: 'manual',
          providerReference: genId(),
        })
      )) !== null
    );
    check(
      'negative payment amount is rejected',
      (await rejects(() =>
        createPayment(db, {
          id: genId(),
          invoiceId: invoice.id,
          userId: user.id,
          amount: '-49.99',
          currency: 'USD',
          provider: 'manual',
          providerReference: genId(),
        })
      )) !== null
    );
    check(
      'ledger entry misattributed to a non-owner is rejected',
      (await rejects(() =>
        recordLedgerEntry(db, {
          id: genId(),
          userId: stranger.id,
          invoiceId: invoice.id,
          entryType: 'payment',
          amount: '49.99',
          currency: 'USD',
          description: 'x',
        })
      )) !== null
    );
    check(
      'ledger entry in the wrong currency is rejected',
      (await rejects(() =>
        recordLedgerEntry(db, {
          id: genId(),
          userId: user.id,
          invoiceId: invoice.id,
          entryType: 'payment',
          amount: '49.99',
          currency: 'GBP',
          description: 'x',
        })
      )) !== null
    );

    const ref = genId();
    await createPayment(db, {
      id: genId(),
      invoiceId: invoice.id,
      userId: user.id,
      amount: '49.99',
      currency: 'USD',
      provider: 'manual',
      providerReference: ref,
    });
    check(
      'duplicate provider_reference for the same provider is rejected',
      (await rejects(() =>
        createPayment(db, {
          id: genId(),
          invoiceId: invoice.id,
          userId: user.id,
          amount: '49.99',
          currency: 'USD',
          provider: 'manual',
          providerReference: ref,
        })
      )) !== null
    );
  }

  log('\n=== GROUP 6: transaction rollback, ownership isolation, money primitive ===');
  {
    const { user, invoice } = await makeInvoicedOrder();
    const before = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1`, [
      invoice.id,
    ]);
    check(
      'a throwing transaction propagates its error',
      (await rejects(() =>
        withTransaction(db, async (tx) => {
          await recordLedgerEntry(tx, {
            id: genId(),
            userId: user.id,
            invoiceId: invoice.id,
            entryType: 'charge',
            amount: '49.99',
            currency: 'USD',
            description: 'rolls back',
          });
          throw new Error('forced failure after a financial write');
        })
      )) !== null
    );
    const after = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1`, [
      invoice.id,
    ]);
    check('the ledger write was rolled back', after.rows[0].n === before.rows[0].n, `before=${before.rows[0].n} after=${after.rows[0].n}`);

    const stranger = await makeUser();
    const p = await createPayment(db, {
      id: genId(),
      invoiceId: invoice.id,
      userId: user.id,
      amount: '49.99',
      currency: 'USD',
      provider: 'manual',
      providerReference: genId(),
    });
    const e = await rejects(() => getMyPaymentDetail(db, stranger.id, p.id));
    check('another user cannot read this payment', e !== null && (e as StatusError).statusCode === 404);
    check('the owner can read their own payment', (await rejects(() => getMyPaymentDetail(db, user.id, p.id))) === null);

    check('toCents rejects a negative amount at the primitive boundary', (await rejects(async () => toCents('-1.00'))) !== null);
    check('toCents accepts a legitimate amount', toCents('49.99') === 4999);
  }

  log('\n=== GROUP 7: WHOLE-DATABASE SWEEP (the check that caught the leftover-row defect) ===');
  {
    const sweeps: Array<[string, string]> = [
      [
        'no invoice has more than one payment ledger entry',
        `SELECT invoice_id FROM billing_ledger WHERE entry_type='payment' GROUP BY invoice_id HAVING count(*) > 1`,
      ],
      [
        'no invoice is credited beyond its total',
        `SELECT i.id FROM invoices i JOIN billing_ledger l ON l.invoice_id=i.id AND l.entry_type='payment'
        GROUP BY i.id, i.total_amount HAVING sum(l.amount) > i.total_amount`,
      ],
      [
        'every ledger row agrees with its invoice on owner and currency',
        `SELECT l.id FROM billing_ledger l JOIN invoices i ON i.id=l.invoice_id
        WHERE l.currency <> i.currency OR l.user_id <> i.user_id`,
      ],
      [
        'every payment agrees with its invoice on owner, currency and ceiling',
        `SELECT p.id FROM payments p JOIN invoices i ON i.id=p.invoice_id
        WHERE p.currency <> i.currency OR p.user_id <> i.user_id OR p.amount > i.total_amount`,
      ],
      [
        'every invoice agrees with its order on owner, currency and total',
        `SELECT i.id FROM invoices i JOIN orders o ON o.id=i.order_id
        WHERE i.user_id <> o.user_id OR i.currency <> o.currency OR i.total_amount <> o.total_amount`,
      ],
      // Scoped to invoices produced by the real checkout path.
      [
        'every invoice issued through checkout has exactly one opening charge entry',
        `SELECT i.id FROM invoices i LEFT JOIN billing_ledger l ON l.invoice_id=i.id AND l.entry_type='charge'
        GROUP BY i.id HAVING count(l.id) <> 1`,
      ],
      ['no ledger entry carries a negative amount', `SELECT id FROM billing_ledger WHERE amount < 0`],
      ['no payment carries a negative amount', `SELECT id FROM payments WHERE amount < 0`],
      [
        'every invoice marked paid has a payment ledger entry',
        `SELECT i.id FROM invoices i WHERE i.status='paid'
        AND NOT EXISTS (SELECT 1 FROM billing_ledger l WHERE l.invoice_id=i.id AND l.entry_type='payment')`,
      ],
      [
        'no invoice marked unpaid has a payment ledger entry',
        `SELECT i.id FROM invoices i WHERE i.status='unpaid'
        AND EXISTS (SELECT 1 FROM billing_ledger l WHERE l.invoice_id=i.id AND l.entry_type='payment')`,
      ],
      [
        'no successful payment is missing its completion timestamp',
        `SELECT id FROM payments WHERE status='successful' AND completed_at IS NULL`,
      ],
      [
        'no payment is successful without a recorded confirming actor',
        `SELECT id FROM payments WHERE status='successful' AND confirmed_by_user_id IS NULL`,
      ],
      [
        'no order total disagrees with the sum of its line items',
        `SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id=o.id
        GROUP BY o.id, o.subtotal_amount HAVING sum(oi.line_total_amount) <> o.subtotal_amount`,
      ],
      ['no line item disagrees with unit price times quantity', `SELECT id FROM order_items WHERE line_total_amount <> unit_price_amount * quantity`],
      ['no order item has a non-positive quantity', `SELECT id FROM order_items WHERE quantity <= 0`],
      [
        'no orphaned invoice, payment or ledger row',
        `SELECT i.id FROM invoices i LEFT JOIN orders o ON o.id=i.order_id WHERE o.id IS NULL
        UNION ALL SELECT p.id FROM payments p LEFT JOIN invoices i2 ON i2.id=p.invoice_id WHERE i2.id IS NULL
        UNION ALL SELECT l.id FROM billing_ledger l WHERE l.invoice_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM invoices i3 WHERE i3.id=l.invoice_id)`,
      ],
    ];
    for (const [name, sql] of sweeps) {
      // `rows.length`, not pg's `rowCount`: the sweep must be runnable against any Queryable, and for
      // every statement above (all SELECTs) the two are the same number.
      const r = await db.query(sql);
      check(name, r.rows.length === 0, `violating rows=${r.rows.length}`);
    }
  }

  return { pass, failures, unproven, checks: pass + failures.length };
}

// --- CLI: a real PostgreSQL server, its own throwaway database -----------------------------------

const CONN = {
  host: process.env.CH247_PROBE_PG_HOST ?? '127.0.0.1',
  port: Number(process.env.CH247_PROBE_PG_PORT ?? 55432),
  user: process.env.CH247_PROBE_PG_USER ?? 'ch',
  password: process.env.CH247_PROBE_PG_PASSWORD ?? 'ch',
  bootstrapDb: process.env.CH247_PROBE_PG_BOOTSTRAP ?? 'cloudhost247',
};
const MIGRATIONS = new URL('../database/migrations', import.meta.url).pathname;

async function main(): Promise<number> {
  const DB = 'probe_' + randomUUID().replace(/-/g, '').slice(0, 12);

  const bootstrap = new Pool({ ...CONN, database: CONN.bootstrapDb });
  await bootstrap.query(`CREATE DATABASE ${DB}`);
  await bootstrap.end();

  const pool = new Pool({ ...CONN, database: DB, max: 20 });
  try {
    await migrateUp(new PgClient(pool), { isProduction: false }, MIGRATIONS);
    const result = await runFinancialInvariantChecks(pool, {
      log: (line) => console.log(line),
      canRunConcurrentQueries: true,
    });

    if (result.failures.length) {
      console.log('\n=== DIAGNOSTIC DUMP ===');
      const d = await pool.query(
        `SELECT i.id, i.invoice_number, i.status, i.total_amount, i.currency, i.user_id, o.total_amount AS order_total, o.user_id AS order_user
         FROM invoices i JOIN orders o ON o.id=i.order_id
         WHERE i.user_id <> o.user_id OR i.currency <> o.currency OR i.total_amount <> o.total_amount`
      );
      for (const row of d.rows) console.log('  INVOICE/ORDER MISMATCH', JSON.stringify(row));
    }

    console.log(`\n================ ${result.pass}/${result.checks} checks passed ================`);
    if (result.unproven.length) {
      console.log('NOT PROVEN HERE:\n  - ' + result.unproven.join('\n  - '));
    }
    if (result.failures.length) console.log('FAILED:\n  - ' + result.failures.join('\n  - '));
    return result.failures.length ? 1 : 0;
  } finally {
    await pool.end();
    const teardown = new Pool({ ...CONN, database: CONN.bootstrapDb });
    await teardown.query(`DROP DATABASE ${DB}`);
    await teardown.end();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('PROBE CRASHED:', e);
      process.exit(2);
    });
}
