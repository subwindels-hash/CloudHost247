/**
 * Whole-database financial invariant sweep, against a real PostgreSQL server.
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
 * It is read-only with respect to the repository and to any real database: it creates its own
 * throwaway database, exercises the real repository and service code against it, sweeps, and
 * drops it. It never connects to production. See recovery/check-production-state.sql for the
 * read-only check intended to be run against a real deployment.
 *
 * Usage, with a PostgreSQL server reachable at the constants below:
 *   cd cloudhost247-node && LOG_LEVEL=silent npx tsx ../recovery/verify-financial-invariants.ts
 */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PgClient } from '../cloudhost247-node/database/db-client';
import { migrateUp } from '../cloudhost247-node/database/migrate';
import { createUser } from '../cloudhost247-node/src/db/users';
import { createOrder } from '../cloudhost247-node/src/db/orders';
import { createInvoice } from '../cloudhost247-node/src/db/invoices';
import { createPayment } from '../cloudhost247-node/src/db/payments';
import { recordLedgerEntry } from '../cloudhost247-node/src/db/billing-ledger';
import { withTransaction } from '../cloudhost247-node/src/db/transaction';
import { issueInvoiceForOrder } from '../cloudhost247-node/src/services/billing-service';
import { confirmManualPayment, getMyPaymentDetail } from '../cloudhost247-node/src/services/payment-service';
import { toCents } from '../cloudhost247-node/src/lib/money';

const CONN = { host: '127.0.0.1', port: 55432, user: 'ch', password: 'ch' };
const DB = 'probe_' + randomUUID().replace(/-/g, '').slice(0, 12);
const MIGRATIONS = new URL('../cloudhost247-node/database/migrations', import.meta.url).pathname;

let pass = 0;
const failures: string[] = [];

/**
 * Invoices this probe created by calling `createInvoice` directly, deliberately bypassing
 * `issueInvoiceForOrder`. They have no opening `charge` entry by construction, so the
 * "exactly one charge entry" sweep must exclude them — that sweep is a statement about the real
 * checkout path, and letting these count would make it fail for a reason that says nothing
 * about the product.
 */
const bareInvoices: string[] = [];

function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

async function rejects(fn: () => Promise<unknown>): Promise<Error | null> {
  try { await fn(); return null; } catch (e) { return e as Error; }
}

(async () => {
  const bootstrap = new Pool({ ...CONN, database: 'cloudhost247' });
  await bootstrap.query(`CREATE DATABASE ${DB}`);
  await bootstrap.end();

  const pool = new Pool({ ...CONN, database: DB, max: 20 });
  await migrateUp(new PgClient(pool), { isProduction: false }, MIGRATIONS);
  const genId = () => randomUUID();

  async function makeUser() {
    return createUser(pool, { id: genId(), email: `${genId()}@example.com`, passwordHash: 'h', fullName: 'T' });
  }
  async function makeOrder(userId: string, total = '49.99', currency = 'USD') {
    const { order } = await createOrder(pool, {
      id: genId(), userId, currency,
      subtotalAmount: total, discountAmount: '0.00', taxAmount: '0.00', totalAmount: total, items: [],
    });
    return order;
  }
  async function makeInvoicedOrder(total = '49.99') {
    const user = await makeUser();
    const order = await makeOrder(user.id, total);
    const invoice = await withTransaction(pool, (tx) => issueInvoiceForOrder(tx, order, genId));
    return { user, order, invoice };
  }

  console.log('\n=== GROUP 1: the real checkout path (order -> invoice -> opening charge) ===');
  {
    const { order, invoice } = await makeInvoicedOrder('149.97');
    check('the invoice copies the order total exactly', invoice.total_amount === order.total_amount,
      `invoice=${invoice.total_amount} order=${order.total_amount}`);
    check('the invoice inherits the order owner', invoice.user_id === order.user_id);
    check('the invoice inherits the order currency', invoice.currency === order.currency);
    const led = await pool.query(`SELECT entry_type, amount, currency FROM billing_ledger WHERE invoice_id=$1`, [invoice.id]);
    check('exactly one opening charge entry is written', led.rowCount === 1, `rows=${led.rowCount}`);
    check('the charge entry equals the invoice total',
      led.rows[0]?.entry_type === 'charge' && led.rows[0]?.amount === invoice.total_amount,
      `${led.rows[0]?.entry_type} ${led.rows[0]?.amount}`);
  }

  console.log('\n=== GROUP 2: invoice/order cross-row invariants ===');
  {
    // Each case needs its OWN order. `invoices_order_id_unique_idx` allows one invoice per order,
    // so reusing an order after a successful insert makes every later case fail on the unique
    // index rather than on the invariant under test — which is exactly how an earlier run of this
    // probe reported two false PASSes here.
    const stranger = await makeUser();

    const o1 = await makeOrder((await makeUser()).id, '49.99', 'USD');
    check('an invoice cannot be attributed to someone other than the order owner',
      (await rejects(() => createInvoice(pool, {
        id: genId(), orderId: o1.id, userId: stranger.id, currency: 'USD',
        subtotalAmount: '49.99', discountAmount: '0.00', taxAmount: '0.00', totalAmount: '49.99',
      }))) !== null);

    const u2 = await makeUser();
    const o2 = await makeOrder(u2.id, '49.99', 'USD');
    check('an invoice cannot be denominated in a different currency from its order',
      (await rejects(() => createInvoice(pool, {
        id: genId(), orderId: o2.id, userId: u2.id, currency: 'EUR',
        subtotalAmount: '49.99', discountAmount: '0.00', taxAmount: '0.00', totalAmount: '49.99',
      }))) !== null);

    const u3 = await makeUser();
    const o3 = await makeOrder(u3.id, '49.99', 'USD');
    check('an invoice cannot bill a different total from its order',
      (await rejects(() => createInvoice(pool, {
        id: genId(), orderId: o3.id, userId: u3.id, currency: 'USD',
        subtotalAmount: '49.99', discountAmount: '0.00', taxAmount: '0.00', totalAmount: '9999.00',
      }))) !== null);

    const u4 = await makeUser();
    const o4 = await makeOrder(u4.id, '49.99', 'USD');
    check('an invoice cannot fabricate a discount its order never had',
      (await rejects(() => createInvoice(pool, {
        id: genId(), orderId: o4.id, userId: u4.id, currency: 'USD',
        subtotalAmount: '49.99', discountAmount: '40.00', taxAmount: '0.00', totalAmount: '49.99',
      }))) !== null);

    const u5 = await makeUser();
    const o5 = await makeOrder(u5.id, '49.99', 'USD');
    const bareId = genId();
    check('a legitimate invoice matching its order in every field is still accepted',
      (await rejects(() => createInvoice(pool, {
        id: bareId, orderId: o5.id, userId: u5.id, currency: 'USD',
        subtotalAmount: '49.99', discountAmount: '0.00', taxAmount: '0.00', totalAmount: '49.99',
      }))) === null);
    bareInvoices.push(bareId);
  }

  console.log('\n=== GROUP 3: concurrency on the real pg.Pool branch (not reachable under pglite) ===');
  {
    const staff = await makeUser();
    const { user, invoice } = await makeInvoicedOrder();
    const p = await createPayment(pool, {
      id: genId(), invoiceId: invoice.id, userId: user.id, amount: '49.99', currency: 'USD',
      provider: 'manual', method: 'bank_transfer', providerReference: genId(),
    });
    const res = await Promise.allSettled([
      confirmManualPayment(pool, staff.id, p.id, genId),
      confirmManualPayment(pool, staff.id, p.id, genId),
    ]);
    const ok = res.filter(r => r.status === 'fulfilled');
    const bad = res.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    check('exactly one concurrent confirmation succeeds', ok.length === 1, `fulfilled=${ok.length}`);
    check('the loser gets a deterministic 409, never a 500',
      bad.length === 1 && (bad[0]?.reason as { statusCode?: number })?.statusCode === 409);
    const n = await pool.query(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'`, [invoice.id]);
    check('exactly one payment ledger entry - no double credit', n.rows[0].n === 1, `n=${n.rows[0].n}`);

    let overCredits = 0; let wrongWinners = 0; let non409 = 0;
    for (let r = 0; r < 25; r++) {
      const f = await makeInvoicedOrder('12.34');
      const pay = await createPayment(pool, {
        id: genId(), invoiceId: f.invoice.id, userId: f.user.id, amount: '12.34', currency: 'USD',
        provider: 'manual', method: 'cash', providerReference: genId(),
      });
      const rr = await Promise.allSettled(Array.from({ length: 6 }, () => confirmManualPayment(pool, staff.id, pay.id, genId)));
      if (rr.filter(x => x.status === 'fulfilled').length !== 1) wrongWinners++;
      for (const x of rr) if (x.status === 'rejected' && (x.reason as { statusCode?: number })?.statusCode !== 409) non409++;
      const c = await pool.query(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='payment'`, [f.invoice.id]);
      if (c.rows[0].n !== 1) overCredits++;
    }
    check('stress 25x6: exactly one winner every round', wrongWinners === 0, `bad rounds=${wrongWinners}`);
    check('stress 25x6: never a second credit', overCredits === 0, `over-credited=${overCredits}`);
    check('stress 25x6: every loser is a 409', non409 === 0, `non-409=${non409}`);
  }

  console.log('\n=== GROUP 4: append-only ledger enforcement ===');
  {
    const { invoice } = await makeInvoicedOrder();
    const e = await pool.query(`SELECT id, amount FROM billing_ledger WHERE invoice_id=$1`, [invoice.id]);
    const id = e.rows[0].id;
    check('UPDATE against billing_ledger is refused by the database',
      (await rejects(() => pool.query(`UPDATE billing_ledger SET amount='0.01' WHERE id=$1`, [id]))) !== null);
    check('DELETE against billing_ledger is refused by the database',
      (await rejects(() => pool.query(`DELETE FROM billing_ledger WHERE id=$1`, [id]))) !== null);
    const after = await pool.query(`SELECT amount FROM billing_ledger WHERE id=$1`, [id]);
    check('the historical entry is unchanged', after.rows[0].amount === e.rows[0].amount);
  }

  console.log('\n=== GROUP 5: payment/ledger cross-row invariants, called WITHOUT a transaction ===');
  {
    const { user, invoice } = await makeInvoicedOrder();
    const stranger = await makeUser();

    check('payment exceeding the invoice total is rejected',
      (await rejects(() => createPayment(pool, { id: genId(), invoiceId: invoice.id, userId: user.id, amount: '99999.00', currency: 'USD', provider: 'manual', providerReference: genId() }))) !== null);
    check('a partial payment below the invoice total is permitted (documented design)',
      (await rejects(() => createPayment(pool, { id: genId(), invoiceId: invoice.id, userId: user.id, amount: '1.00', currency: 'USD', provider: 'manual', providerReference: genId() }))) === null);
    check('payment in the wrong currency is rejected',
      (await rejects(() => createPayment(pool, { id: genId(), invoiceId: invoice.id, userId: user.id, amount: '49.99', currency: 'EUR', provider: 'manual', providerReference: genId() }))) !== null);
    check('payment attributed to a non-owner is rejected',
      (await rejects(() => createPayment(pool, { id: genId(), invoiceId: invoice.id, userId: stranger.id, amount: '49.99', currency: 'USD', provider: 'manual', providerReference: genId() }))) !== null);
    check('negative payment amount is rejected',
      (await rejects(() => createPayment(pool, { id: genId(), invoiceId: invoice.id, userId: user.id, amount: '-49.99', currency: 'USD', provider: 'manual', providerReference: genId() }))) !== null);
    check('ledger entry misattributed to a non-owner is rejected',
      (await rejects(() => recordLedgerEntry(pool, { id: genId(), userId: stranger.id, invoiceId: invoice.id, entryType: 'payment', amount: '49.99', currency: 'USD', description: 'x' }))) !== null);
    check('ledger entry in the wrong currency is rejected',
      (await rejects(() => recordLedgerEntry(pool, { id: genId(), userId: user.id, invoiceId: invoice.id, entryType: 'payment', amount: '49.99', currency: 'GBP', description: 'x' }))) !== null);

    const ref = genId();
    await createPayment(pool, { id: genId(), invoiceId: invoice.id, userId: user.id, amount: '49.99', currency: 'USD', provider: 'manual', providerReference: ref });
    check('duplicate provider_reference for the same provider is rejected',
      (await rejects(() => createPayment(pool, { id: genId(), invoiceId: invoice.id, userId: user.id, amount: '49.99', currency: 'USD', provider: 'manual', providerReference: ref }))) !== null);
  }

  console.log('\n=== GROUP 6: transaction rollback, ownership isolation, money primitive ===');
  {
    const { user, invoice } = await makeInvoicedOrder();
    const before = await pool.query(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1`, [invoice.id]);
    check('a throwing transaction propagates its error',
      (await rejects(() => withTransaction(pool, async (tx) => {
        await recordLedgerEntry(tx, { id: genId(), userId: user.id, invoiceId: invoice.id, entryType: 'charge', amount: '49.99', currency: 'USD', description: 'rolls back' });
        throw new Error('forced failure after a financial write');
      }))) !== null);
    const after = await pool.query(`SELECT count(*)::int AS n FROM billing_ledger WHERE invoice_id=$1`, [invoice.id]);
    check('the ledger write was rolled back', after.rows[0].n === before.rows[0].n,
      `before=${before.rows[0].n} after=${after.rows[0].n}`);

    const stranger = await makeUser();
    const p = await createPayment(pool, { id: genId(), invoiceId: invoice.id, userId: user.id, amount: '49.99', currency: 'USD', provider: 'manual', providerReference: genId() });
    const e = await rejects(() => getMyPaymentDetail(pool, stranger.id, p.id));
    check('another user cannot read this payment', e !== null && (e as { statusCode?: number }).statusCode === 404);
    check('the owner can read their own payment', (await rejects(() => getMyPaymentDetail(pool, user.id, p.id))) === null);

    check('toCents rejects a negative amount at the primitive boundary',
      (await rejects(async () => toCents('-1.00'))) !== null);
    check('toCents accepts a legitimate amount', toCents('49.99') === 4999);
  }

  console.log('\n=== GROUP 7: WHOLE-DATABASE SWEEP (the check that caught the leftover-row defect) ===');
  {
    const sweeps: Array<[string, string]> = [
      ['no invoice has more than one payment ledger entry',
       `SELECT invoice_id FROM billing_ledger WHERE entry_type='payment' GROUP BY invoice_id HAVING count(*) > 1`],
      ['no invoice is credited beyond its total',
       `SELECT i.id FROM invoices i JOIN billing_ledger l ON l.invoice_id=i.id AND l.entry_type='payment'
        GROUP BY i.id, i.total_amount HAVING sum(l.amount) > i.total_amount`],
      ['every ledger row agrees with its invoice on owner and currency',
       `SELECT l.id FROM billing_ledger l JOIN invoices i ON i.id=l.invoice_id
        WHERE l.currency <> i.currency OR l.user_id <> i.user_id`],
      ['every payment agrees with its invoice on owner, currency and ceiling',
       `SELECT p.id FROM payments p JOIN invoices i ON i.id=p.invoice_id
        WHERE p.currency <> i.currency OR p.user_id <> i.user_id OR p.amount > i.total_amount`],
      ['every invoice agrees with its order on owner, currency and total',
       `SELECT i.id FROM invoices i JOIN orders o ON o.id=i.order_id
        WHERE i.user_id <> o.user_id OR i.currency <> o.currency OR i.total_amount <> o.total_amount`],
      // Scoped to invoices produced by the real checkout path; see `bareInvoices` above.
      ['every invoice issued through checkout has exactly one opening charge entry',
       `SELECT i.id FROM invoices i LEFT JOIN billing_ledger l ON l.invoice_id=i.id AND l.entry_type='charge'
        WHERE i.id <> ALL($1::uuid[])
        GROUP BY i.id HAVING count(l.id) <> 1`],
      ['no ledger entry carries a negative amount',
       `SELECT id FROM billing_ledger WHERE amount < 0`],
      ['no payment carries a negative amount',
       `SELECT id FROM payments WHERE amount < 0`],
      ['every invoice marked paid has a payment ledger entry',
       `SELECT i.id FROM invoices i WHERE i.status='paid'
        AND NOT EXISTS (SELECT 1 FROM billing_ledger l WHERE l.invoice_id=i.id AND l.entry_type='payment')`],
      ['no invoice marked unpaid has a payment ledger entry',
       `SELECT i.id FROM invoices i WHERE i.status='unpaid'
        AND EXISTS (SELECT 1 FROM billing_ledger l WHERE l.invoice_id=i.id AND l.entry_type='payment')`],
      ['no successful payment is missing its completion timestamp',
       `SELECT id FROM payments WHERE status='successful' AND completed_at IS NULL`],
      ['no payment is successful without a recorded confirming actor',
       `SELECT id FROM payments WHERE status='successful' AND confirmed_by_user_id IS NULL`],
      ['no order total disagrees with the sum of its line items',
       `SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id=o.id
        GROUP BY o.id, o.subtotal_amount HAVING sum(oi.line_total_amount) <> o.subtotal_amount`],
      ['no line item disagrees with unit price times quantity',
       `SELECT id FROM order_items WHERE line_total_amount <> unit_price_amount * quantity`],
      ['no order item has a non-positive quantity',
       `SELECT id FROM order_items WHERE quantity <= 0`],
      ['no orphaned invoice, payment or ledger row',
       `SELECT i.id FROM invoices i LEFT JOIN orders o ON o.id=i.order_id WHERE o.id IS NULL
        UNION ALL SELECT p.id FROM payments p LEFT JOIN invoices i2 ON i2.id=p.invoice_id WHERE i2.id IS NULL
        UNION ALL SELECT l.id FROM billing_ledger l WHERE l.invoice_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM invoices i3 WHERE i3.id=l.invoice_id)`],
    ];
    for (const [name, sql] of sweeps) {
      const r = sql.includes('$1') ? await pool.query(sql, [bareInvoices]) : await pool.query(sql);
      check(name, r.rowCount === 0, `violating rows=${r.rowCount}`);
    }
  }

  if (failures.length) {
    console.log('\n=== DIAGNOSTIC DUMP ===');
    const d = await pool.query(`SELECT i.id, i.invoice_number, i.status, i.total_amount, i.currency, i.user_id, o.total_amount AS order_total, o.user_id AS order_user
      FROM invoices i JOIN orders o ON o.id=i.order_id
      WHERE i.user_id <> o.user_id OR i.currency <> o.currency OR i.total_amount <> o.total_amount`);
    for (const row of d.rows) console.log('  INVOICE/ORDER MISMATCH', JSON.stringify(row));
  }

  await pool.end();
  const teardown = new Pool({ ...CONN, database: 'cloudhost247' });
  await teardown.query(`DROP DATABASE ${DB}`);
  await teardown.end();

  console.log(`\n================ ${pass}/${pass + failures.length} checks passed ================`);
  if (failures.length) console.log('FAILED:\n  - ' + failures.join('\n  - '));
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error('PROBE CRASHED:', e); process.exit(2); });
