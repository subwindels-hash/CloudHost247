import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { hashPassword } from '../../src/lib/password';
import { signAuthToken } from '../../src/lib/jwt';
import { completePasswordReset, deriveAuthActionToken, hashAuthActionToken } from '../../src/services/auth-recovery-service';
import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  issueMfaLoginChallenge,
  completeMfaLogin,
  __private__ as mfaPrivate,
} from '../../src/services/totp-mfa-service';
import { adminIssueRefund } from '../../src/services/billing-service';

/**
 * Phase 13 — Independent Security, Financial Integrity & Adversarial Readiness Audit tests.
 * Every test here attacks a real code path. All are integration evidence against real PGlite
 * PostgreSQL; the concurrent-refund race additionally has a real-PostgreSQL 16.2 probe
 * (`scripts/phase13-refund-race-probe.ts`), reproduced before/after remediation.
 */

describe('Phase 13 — adversarial readiness [integration]', () => {
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

  afterEach(async () => {
    await db.close();
  });

  async function seedUser(role: 'customer' | 'admin' = 'customer') {
    const id = randomUUID();
    const email = `p13-${randomUUID().slice(0, 8)}@example.com`;
    await client.query(`INSERT INTO users (id, email, password_hash, full_name, role, status) VALUES ($1,$2,$3,'P13',$4,'active')`, [
      id,
      email,
      await hashPassword('correct-horse-battery'),
      role,
    ]);
    return { id, email };
  }

  it('financial: a fully-refunded paid invoice refuses any further refund (sequential regression of the race fix)', async () => {
    const { id: cust } = await seedUser();
    const { id: admin } = await seedUser('admin');
    const orderId = randomUUID();
    const invoiceId = randomUUID();
    await client.query(`INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status) VALUES ($1,$2,'USD',100,100,'completed','paid')`, [orderId, cust]);
    await client.query(`INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status) VALUES ($1,$2,$3,'USD',100,100,'paid')`, [invoiceId, orderId, cust]);
    await client.query(`INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description) VALUES ($1,$2,$3,'payment',100,'USD','seed')`, [randomUUID(), cust, invoiceId]);

    const first = await adminIssueRefund(db as never, admin, invoiceId, 10000, 'full', randomUUID, {});
    expect(first.status).toBe('refunded');
    await expect(adminIssueRefund(db as never, admin, invoiceId, 1, 'one more cent', randomUUID, {})).rejects.toThrow(/Cannot refund/);
    const refunds = (await client.query(`SELECT COUNT(*)::int AS n FROM billing_ledger WHERE invoice_id=$1 AND entry_type='refund'`, [invoiceId])).rows[0];
    expect(refunds.n).toBe(1);
  });

  it('financial: refund rejects non-integer, zero, negative and unpaid-invoice attempts', async () => {
    const { id: cust } = await seedUser();
    const { id: admin } = await seedUser('admin');
    const orderId = randomUUID();
    const invoiceId = randomUUID();
    await client.query(`INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount) VALUES ($1,$2,'USD',100,100)`, [orderId, cust]);
    await client.query(`INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status) VALUES ($1,$2,$3,'USD',100,100,'unpaid')`, [invoiceId, orderId, cust]);

    await expect(adminIssueRefund(db as never, admin, invoiceId, 0, 'zero', randomUUID, {})).rejects.toThrow();
    await expect(adminIssueRefund(db as never, admin, invoiceId, -500, 'neg', randomUUID, {})).rejects.toThrow();
    await expect(adminIssueRefund(db as never, admin, invoiceId, 50.5, 'frac', randomUUID, {})).rejects.toThrow();
    await expect(adminIssueRefund(db as never, admin, invoiceId, 10000, 'unpaid target', randomUUID, {})).rejects.toThrow(/Cannot refund/);
    const count = (await client.query(`SELECT COUNT(*)::int AS n FROM billing_ledger WHERE invoice_id=$1`, [invoiceId])).rows[0];
    expect(count.n).toBe(0);
  });

  it('financial: every refund requires a reason and writes a staff-accountability audit event', async () => {
    const { id: cust } = await seedUser();
    const { id: admin } = await seedUser('admin');
    const orderId = randomUUID();
    const invoiceId = randomUUID();
    await client.query(`INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status) VALUES ($1,$2,'USD',10,10,'completed','paid')`, [orderId, cust]);
    await client.query(`INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status) VALUES ($1,$2,$3,'USD',10,10,'paid')`, [invoiceId, orderId, cust]);
    await client.query(`INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description) VALUES ($1,$2,$3,'payment',10,'USD','seed')`, [randomUUID(), cust, invoiceId]);

    await expect(adminIssueRefund(db as never, admin, invoiceId, 500, '   ', randomUUID, {})).rejects.toThrow(/reason/i);
    await adminIssueRefund(db as never, admin, invoiceId, 500, 'legit with audit', randomUUID, {});
    const audit = (await client.query(`SELECT event_type, metadata FROM auth_audit_log WHERE user_id=$1 AND event_type='admin_invoice_refunded' ORDER BY created_at DESC LIMIT 1`, [admin])).rows[0];
    expect(audit).toBeTruthy();
    expect(audit.metadata.reason).toBe('legit with audit');
    expect(audit.metadata.refundAmountCents).toBe(500);
  });

  it('auth: password-reset link is single-use — a replay returns the same benign outcome, never a second reset', async () => {
    const user = await seedUser();
    const actionId = randomUUID();
    const token = deriveAuthActionToken(env.JWT_SECRET, 'password_reset', actionId);
    await client.query(
      `INSERT INTO auth_action_tokens (id, user_id, purpose, token_hash, expires_at) VALUES ($1,$2,'password_reset',$3, now() + interval '30 minutes')`,
      [actionId, user.id, hashAuthActionToken(token)]
    );
    // First use: consume it
    const first = await completePasswordReset(db as never, token, await hashPassword('brand-new-password'), {});
    expect(first).toBe(true);
    // Second use of the very same token must fail
    const second = await completePasswordReset(db as never, token, await hashPassword('attacker-chosen'), {});
    expect(second).toBe(false);
  });

  it('auth: MFA — a TOTP code replayed in the same timestep is refused; the next timestep succeeds; replaying that one too is refused', async () => {
    const user = await seedUser();
    const enroll = await beginTotpEnrollment(db as never, env, { id: user.id, email: user.email });
    expect(enroll.secret).toBeTruthy();
    const baseTime = new Date();
    const timestep0 = Math.floor(baseTime.getTime() / 1000 / 30);
    const code0 = mfaPrivate.totpAt(enroll.secret!, timestep0);
    const confirmed = await confirmTotpEnrollment(db as never, env, user.id, code0);
    expect(confirmed.confirmed).toBe(true);
    expect(confirmed.recoveryCodes.length).toBe(10);

    const sessionVersion = 0;
    const challenge = await issueMfaLoginChallenge(db as never, env.JWT_SECRET, user.id, sessionVersion);
    // Replay of the SAME code/timestep that confirmed enrollment: must be refused (replay guard).
    const replay = await completeMfaLogin(db as never, env, challenge, code0);
    expect(replay.success).toBe(false);

    // Fresh timestep works once...
    const challenge2 = await issueMfaLoginChallenge(db as never, env.JWT_SECRET, user.id, sessionVersion);
    const code1 = mfaPrivate.totpAt(enroll.secret!, timestep0 + 1);
    const ok1 = await completeMfaLogin(db as never, env, challenge2, code1);
    expect(ok1.success).toBe(true);
    // ...but replaying THAT code is refused too (monotonic last_used_timestep).
    const challenge3 = await issueMfaLoginChallenge(db as never, env.JWT_SECRET, user.id, sessionVersion);
    const replay2 = await completeMfaLogin(db as never, env, challenge3, code1);
    expect(replay2.success).toBe(false);
  });

  it('auth: login endpoint enforces the abuse rate limit (10/min window)', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db as never });
    await seedUser();
    try {
      const responses: number[] = [];
      for (let i = 0; i < 11; i++) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: `p13-rl@example.com`, password: 'wrong-password' },
        });
        responses.push(res.statusCode);
      }
      expect(responses.slice(0, 10).every((s) => s !== 429)).toBe(true);
      expect(responses[10]).toBe(429);
    } finally {
      await app.close();
    }
  });
});
