/** Phase 13 adversarial probe: can two CONCURRENT staff refunds over-refund one paid invoice? */
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { adminIssueRefund } from '../src/services/billing-service';

async function main() {
  const pool = new Pool({ host: '/tmp/pgdata-p10', user: 'postgres', database: 'postgres', max: 6 });
  const suffix = randomUUID().slice(0, 6);
  const uid = randomUUID();
  const adminId = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,'h','C','customer','active'),($3,$4,'h','A','admin','active')`,
    [uid, `p13a-${suffix}@example.com`, adminId, `p13adm-${suffix}@example.com`]
  );
  const orderId = randomUUID();
  const invoiceId = randomUUID();
  await pool.query(
    `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status) VALUES ($1,$2,'USD',100,100,'completed','paid')`,
    [orderId, uid]
  );
  await pool.query(
    `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status) VALUES ($1,$2,$3,'USD',100,100,'paid')`,
    [invoiceId, orderId, uid]
  );
  await pool.query(
    `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description) VALUES ($1,$2,$3,'payment',100,'USD','p')`,
    [randomUUID(), uid, invoiceId]
  );

  const fire = (tag: string) =>
    adminIssueRefund(pool as unknown as never, adminId, invoiceId, 10000, `race ${tag}`, randomUUID, {})
      .then(() => `${tag}:OK`)
      .catch((e: Error) => `${tag}:ERR:${e.message.slice(0, 90)}`);
  const [a, b, c] = await Promise.all([fire('X'), fire('Y'), fire('Z')]);
  const { rows } = await pool.query(
    `SELECT entry_type, COUNT(*)::int AS n, SUM(amount)::text AS total FROM billing_ledger WHERE invoice_id = $1 GROUP BY entry_type`,
    [invoiceId]
  );
  const inv = (await pool.query(`SELECT status FROM invoices WHERE id = $1`, [invoiceId])).rows[0];
  const okCount=[a,b,c].filter(r=>r.endsWith(':OK')).length; const errCount=[a,b,c].filter(r=>r.includes('ERR')).length; const refundedTotal=(rows.find((r:{entry_type:string})=>r.entry_type==='refund')||{total:'0'}).total; const overRefund=Number.parseFloat(refundedTotal)>100; const verdict = okCount===1 && errCount===2 && !overRefund ? 'SAFE (exactly one refund won)' : `UNSAFE (OK=${okCount}, ERR=${errCount}, refundedTotal=${refundedTotal})`; console.log(JSON.stringify({a,b,c,ledger:rows,invoiceStatus:inv.status, verdict}, null, 1));

  // billing_ledger is append-only by trigger design (verified control); test rows are isolated per run by unique ids.
  // No teardown deletes: billing_ledger is append-only by trigger (verified above).
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
