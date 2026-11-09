import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { loadEnv, type Env } from '../../src/config/env';
import { hashPassword } from '../../src/lib/password';
import { adminIssueRefund } from '../../src/services/billing-service';
import { buildApp } from '../../src/app';
import { signAuthToken } from '../../src/lib/jwt';

/** Phase 16 — idempotency hardening: a key identifies ONE operation, never a class of them. */
describe('Phase 16 — refund idempotency hardening [integration]', () => {
  let db: PGlite;
  let client: PgliteClient;
  let env: Env;

  beforeEach(async () => {
    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { isProduction: false });
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
      CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    } as NodeJS.ProcessEnv);
  });
  afterEach(async () => { await db.close(); });

  async function seed() {
    const cust = randomUUID(); const admin = randomUUID();
    await client.query(`INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,'h','C','customer','active'),($3,$4,'h','A','admin','active')`,
      [cust, `p16c-${randomUUID().slice(0,4)}@example.com`, admin, `p16a-${randomUUID().slice(0,4)}@example.com`]);
    return { cust, admin };
  }
  async function paidInvoice(cust: string, dollars: number) {
    const orderId = randomUUID(); const invoiceId = randomUUID();
    await client.query(`INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status) VALUES ($1,$2,'USD',$3,$3,'completed','paid')`, [orderId, cust, dollars]);
    await client.query(`INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status) VALUES ($1,$2,$3,'USD',$4,$4,'paid')`, [invoiceId, orderId, cust, dollars]);
    await client.query(`INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description) VALUES ($1,$2,$3,'payment',$4,'USD','seed')`, [randomUUID(), cust, invoiceId, dollars]);
    return invoiceId;
  }

  it('reusing a key on a DIFFERENT invoice is rejected as a conflict — keys do not bleed across operations', async () => {
    const { cust, admin } = await seed();
    const invA = await paidInvoice(cust, 100);
    const invB = await paidInvoice(cust, 100);
    const key = `p16-${randomUUID()}`;
    await adminIssueRefund(db as never, admin, invA, 4000, 'original refund on A', randomUUID, {}, key);
    await expect(adminIssueRefund(db as never, admin, invB, 4000, 'original refund on A', randomUUID, {}, key))
      .rejects.toThrow(/different refund operation/);
    const refunds = (await client.query(`SELECT COUNT(*)::int AS n FROM billing_ledger WHERE entry_type='refund' AND idempotency_key=$1`, [key])).rows[0];
    expect(refunds.n).toBe(1);
  });

  it('reusing a key on the same invoice with a DIFFERENT amount is rejected (amount is part of the operation identity)', async () => {
    const { cust, admin } = await seed();
    const inv = await paidInvoice(cust, 100);
    const key = `p16-${randomUUID()}`;
    await adminIssueRefund(db as never, admin, inv, 4000, 'partial forty', randomUUID, {}, key);
    await expect(adminIssueRefund(db as never, admin, inv, 4100, 'partial forty', randomUUID, {}, key))
      .rejects.toThrow(/different refund operation/);
  });

  it('replaying a COMPLETED refund with modified metadata (reason) is rejected too', async () => {
    const { cust, admin } = await seed();
    const inv = await paidInvoice(cust, 100);
    const key = `p16-${randomUUID()}`;
    await adminIssueRefund(db as never, admin, inv, 4000, 'legitimate reason', randomUUID, {}, key);
    await expect(adminIssueRefund(db as never, admin, inv, 4000, 'tampered narrative', randomUUID, {}, key))
      .rejects.toThrow(/different refund operation/);
    const replay = await adminIssueRefund(db as never, admin, inv, 4000, 'legitimate reason', randomUUID, {}, key);
    expect(replay.status).toBe('partially_refunded'); // identical triple: true replay honored
  });

  it('route level: refund without a key is rejected (400) before any ledger work', async () => {
    const { admin } = await seed();
    const adminToken = signAuthToken(env, { sub: admin, email: 'a@example.com', role: 'admin' });
    const app = buildApp(env, { serveFrontend: false, pool: db as never });
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/invoices/${randomUUID()}/refund`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { amountCents: 100, reason: 'keyless' },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
