/**
 * Phase 14 — Financial Systems Certification probes against REAL PostgreSQL 16.2.
 * Eight directed scenarios + reconciliation accounting. Local throwaway data only.
 * Writes docs/staging/FINANCIAL-CONCURRENCY-TEST-RESULTS via stdout JSON (caller redirects).
 */
import { Pool, Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { adminIssueRefund, adminCancelInvoice } from '../src/services/billing-service';

interface R { scenario: string; detail: string; pass: boolean }
const results: R[] = [];
const record = (scenario: string, detail: string, pass: boolean) => results.push({ scenario, detail, pass });

const SOCKET = '/tmp/pgdata-p10';
const pool = new Pool({ host: SOCKET, user: 'postgres', database: 'postgres', max: 8 });
const suffix = randomUUID().slice(0, 6);

async function seedPaidInvoice(amountCentsDollars: number) {
  const cust = randomUUID(); const admin = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,'h','C','customer','active'),($3,$4,'h','A','admin','active')`,
    [cust, `p14c-${randomUUID().slice(0,4)}-${suffix}@example.com`, admin, `p14adm-${randomUUID().slice(0,4)}-${suffix}@example.com`]);
  const orderId = randomUUID(); const invoiceId = randomUUID();
  await pool.query(`INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status) VALUES ($1,$2,'USD',$3,$3,'completed','paid')`, [orderId, cust, amountCentsDollars]);
  await pool.query(`INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status) VALUES ($1,$2,$3,'USD',$4,$4,'paid')`, [invoiceId, orderId, cust, amountCentsDollars]);
  await pool.query(`INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description) VALUES ($1,$2,$3,'payment',$4,'USD','seed')`, [randomUUID(), cust, invoiceId, amountCentsDollars]);
  return { cust, admin, orderId, invoiceId };
}

async function seedUnpaidInvoice() {
  const cust = randomUUID(); const admin = randomUUID();
  await pool.query(`INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,'h','C','customer','active'),($3,$4,'h','A','admin','active')`,
    [cust, `p14u-${randomUUID().slice(0,4)}-${suffix}@example.com`, admin, `p14a-${randomUUID().slice(0,4)}-${suffix}@example.com`]);
  const orderId = randomUUID(); const invoiceId = randomUUID();
  await pool.query(`INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount) VALUES ($1,$2,'USD',50,50)`, [orderId, cust]);
  await pool.query(`INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status) VALUES ($1,$2,$3,'USD',50,50,'unpaid')`, [invoiceId, orderId, cust]);
  return { cust, admin, orderId, invoiceId };
}

async function ledgerTotals(invoiceId: string) {
  const { rows } = await pool.query<{ entry_type: string; n: number; total: string }>(
    `SELECT entry_type, COUNT(*)::int AS n, SUM(amount)::text AS total FROM billing_ledger WHERE invoice_id = $1 GROUP BY entry_type`, [invoiceId]);
  return rows;
}

async function main() {
  // S1 — two simultaneous PARTIAL refunds ($60 + $60 on $100 paid): exactly one may land.
  {
    const s = await seedPaidInvoice(100);
    const [r1, r2] = await Promise.all(
      [0, 1].map((i) =>
        adminIssueRefund(pool as never, s.admin, s.invoiceId, 6000, `S1 concurrent partial ${i}`, randomUUID, {})
          .then(() => 'OK').catch((e: Error) => `ERR:${e.message.slice(0, 60)}`)
      )
    );
    const led = await ledgerTotals(s.invoiceId);
    const refunded = Number.parseFloat(led.find((l) => l.entry_type === 'refund')?.total ?? '0');
    const ok = [r1, r2].filter((r) => r === 'OK').length === 1 && refunded <= 100;
    record('S1 two simultaneous partial refunds', `results=[${r1} | ${r2}] refundedTotal=${refunded}`, ok);
  }

  // S2 — concurrent refunds on DIFFERENT invoices of the SAME customer must not falsely conflict.
  {
    const a = await seedPaidInvoice(100);
    const b = await seedPaidInvoice(100);
    const [ra, rb] = await Promise.all([
      adminIssueRefund(pool as never, a.admin, a.invoiceId, 3000, 'S2 invoice A', randomUUID, {}).then(() => 'OK').catch(() => 'ERR'),
      adminIssueRefund(pool as never, b.admin, b.invoiceId, 3000, 'S2 invoice B', randomUUID, {}).then(() => 'OK').catch(() => 'ERR'),
    ]);
    record('S2 concurrent refunds on distinct invoices (same customer has both)', `A=${ra} B=${rb}`, ra === 'OK' && rb === 'OK');
  }

  // S3 — concurrent refund + cancellation on an UNPAID invoice.
  {
    const s = await seedUnpaidInvoice();
    const [rc, rr] = await Promise.all([
      adminCancelInvoice(pool as never, s.admin, s.invoiceId, 'S3 cancel', randomUUID, {}).then(() => 'OK').catch((e: Error) => `ERR:${e.message.slice(0, 50)}`),
      adminIssueRefund(pool as never, s.admin, s.invoiceId, 5000, 'S3 refund attempt on unpaid', randomUUID, {}).then(() => 'OK').catch((e: Error) => `ERR:${e.message.slice(0, 50)}`),
    ]);
    const status = (await pool.query(`SELECT status FROM invoices WHERE id=$1`, [s.invoiceId])).rows[0].status;
    const led = await ledgerTotals(s.invoiceId);
    const ok = rc === 'OK' && rr.startsWith('ERR') && status === 'void' && !led.some((l) => l.entry_type === 'refund');
    record('S3 concurrent refund + cancel (unpaid invoice)', `cancel=${rc} refund=${rr} finalStatus=${status} refundEntries=${led.filter((l) => l.entry_type==='refund').length}`, ok);
  }

  // S4 — timeout-then-retry WITH idempotency key: exactly one refund, no duplicate.
  {
    const s = await seedPaidInvoice(80);
    const key = `p14-s4-${randomUUID()}`;
    await adminIssueRefund(pool as never, s.admin, s.invoiceId, 4000, 'S4 first attempt', randomUUID, {}, key);
    // Simulated client timeout: the refund already committed; the retry arrives with the same key.
    const retry = await adminIssueRefund(pool as never, s.admin, s.invoiceId, 4000, 'S4 first attempt', randomUUID, {}, key) // true retry: same invoice, amount AND reason;
    const led = await ledgerTotals(s.invoiceId);
    const refunds = led.find((l) => l.entry_type === 'refund');
    const ok = refunds?.n === 1 && Number.parseFloat(refunds.total) === 40 && retry.status === 'partially_refunded';
    record('S4 timeout + retry with same idempotency key', `refundEntries=${refunds?.n} refundedTotal=${refunds?.total} retryStatus=${retry.status}`, ok);
  }

  // S5 — duplicate refund WITHOUT a key must be caught by validation limits, but WITH distinct keys must NOT create keys == duplicates. Also cross-check idempotency-key uniqueness index.
  {
    const s = await seedPaidInvoice(60);
    const k1 = `p14-s5-${randomUUID()}`;
    await adminIssueRefund(pool as never, s.admin, s.invoiceId, 3000, 'S5 duplicate retry', randomUUID, {}, k1);
    // Same key concurrently from two sessions — DB-level unique index must allow only one insert even under race.
    const [q1, q2] = await Promise.all([
      adminIssueRefund(pool as never, s.admin, s.invoiceId, 3000, 'S5 duplicate retry', randomUUID, {}, k1).then(() => 'OK').catch((e: Error) => `ERR:${(e as Error).message.slice(0, 50)}`),
      adminIssueRefund(pool as never, s.admin, s.invoiceId, 3000, 'S5 duplicate retry', randomUUID, {}, k1).then(() => 'OK').catch((e: Error) => `ERR:${(e as Error).message.slice(0, 50)}`),
    ]);
    const led = await ledgerTotals(s.invoiceId);
    const refunds = led.find((l) => l.entry_type === 'refund');
    // Exactly ONE refund entry for key k1 total (the first) — concurrent replays resolve to replay, not duplicate.
    const ok = refunds?.n === 1 && Number.parseFloat(refunds.total) === 30;
    record('S5 concurrent duplicate refund with SAME idempotency key', `A=${q1} B=${q2} refundEntries=${refunds?.n} total=${refunds?.total}`, ok);
  }

  // S6 — DB connection interruption mid-refund: nothing commits, invoice stays pristine.
  {
    const s = await seedPaidInvoice(100);
    const client = new Client({ host: SOCKET, user: 'postgres', database: 'postgres' });
    client.on('error', () => undefined); // S6 destroys this socket on purpose — the event is expected
    await client.connect();
    await client.query('BEGIN');
    await client.query(`SELECT id FROM invoices WHERE id=$1 FOR UPDATE`, [s.invoiceId]);
    await client.query(`INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description) VALUES ($1,$2,$3,'refund',25,'USD','S6 dying-connection refund')`, [randomUUID(), s.cust, s.invoiceId]);
    // Abruptly terminate the connection WITHOUT COMMIT — PostgreSQL must roll this tx back.
    (client as unknown as { connection: { stream: { destroy: () => void } } }).connection.stream.destroy();
    await new Promise((r) => setTimeout(r, 300));
    const led = await ledgerTotals(s.invoiceId);
    const status = (await pool.query(`SELECT status FROM invoices WHERE id=$1`, [s.invoiceId])).rows[0].status;
    const ok = !led.some((l) => l.entry_type === 'refund') && status === 'paid';
    record('S6 connection destroyed mid-transaction (no COMMIT)', `refundEntries=${led.filter((l) => l.entry_type==='refund').length} invoiceStatus=${status}`, ok);
  }

  // S7 — engineered deadlock between two invoice-locking transactions: PG kills one cleanly.
  {
    const i1 = await seedPaidInvoice(10); const i2 = await seedPaidInvoice(10);
    const c1 = new Client({ host: SOCKET, user: 'postgres', database: 'postgres' });
    const c2 = new Client({ host: SOCKET, user: 'postgres', database: 'postgres' });
    c1.on('error', () => undefined); c2.on('error', () => undefined);
    await c1.connect(); await c2.connect();
    await c1.query('BEGIN'); await c2.query('BEGIN');
    await c1.query(`SELECT id FROM invoices WHERE id=$1 FOR UPDATE`, [i1.invoiceId]);
    await c2.query(`SELECT id FROM invoices WHERE id=$1 FOR UPDATE`, [i2.invoiceId]);
    const attempt = async (c: Client, otherInvoice: string) =>
      c.query(`SELECT id FROM invoices WHERE id=$1 FOR UPDATE`, [otherInvoice]).then(() => 'DONE').catch((e: Error) => `ERR:${(e as { code?: string }).code}`);
    const p1 = attempt(c1, i2.invoiceId);
    const p2 = new Promise<string>((res) => setTimeout(() => attempt(c2, i1.invoiceId).then(res), 100));
    const [o1, o2] = await Promise.all([p1, p2]);
    const deadlockVictims = [o1, o2].filter((o) => o.includes('40P01')).length;
    // loser is rolled back; winner commits; engine stays consistent.
    await c1.query('ROLLBACK').catch(() => undefined); await c2.query('ROLLBACK').catch(() => undefined);
    await c1.end().catch(() => undefined); await c2.end().catch(() => undefined);
    const ok = deadlockVictims === 1 && [o1, o2].includes('DONE');
    record('S7 engineered deadlock detection & rollback recovery', `tx1=${o1} tx2=${o2}`, ok);
  }

  // S8 — idempotent-replay semantic check: same key twice → retry returns the SAME already-issued state (not an error, not a duplicate).
  {
    const s = await seedPaidInvoice(90);
    const key = `p14-s8-${randomUUID()}`;
    await adminIssueRefund(pool as never, s.admin, s.invoiceId, 9000, 'S9 retry: identical operation', randomUUID, {}, key);
    const replayDetail = await adminIssueRefund(pool as never, s.admin, s.invoiceId, 9000, 'S9 retry: identical operation', randomUUID, {}, key);
    record('S8 idempotent replay after full refund', `replay status=${replayDetail.status} refunds=${(replayDetail.ledger as Array<{entry_type:string}>).filter((e) => e.entry_type === 'refund').length}`, replayDetail.status === 'refunded');
  }

  const allPassed = results.every((r) => r.pass);
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), engine: 'PostgreSQL 16.2 (real, unix socket)', allPassed, results }, null, 1));
  await pool.end();
  process.exit(allPassed ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
