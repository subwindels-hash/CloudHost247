import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createUser, recordAuthEvent } from '../../src/db/users';
import { createOrder, setOrderPaymentStatus } from '../../src/db/orders';
import { createInvoice } from '../../src/db/invoices';
import { cancelOtherPendingPayments, createPayment, findPaymentById, updatePaymentStatus } from '../../src/db/payments';
import { withTransaction } from '../../src/db/transaction';
import { getGateway, AVAILABLE_GATEWAY_IDS } from '../../src/payments/gateway-registry';
import { manualGateway } from '../../src/payments/manual-gateway';
import { sandboxGateway, buildSignedWebhookPayload } from '../../src/payments/sandbox-gateway';
import { signPayload, verifySignature } from '../../src/payments/webhook-signing';
import { loadEnv } from '../../src/config/env';

/**
 * Exercises the real Phase 5C schema additions (payments.confirmed_by_user_id, the widened
 * auth_audit_log CHECK constraint) and the new src/payments/* gateway modules against a real
 * embedded Postgres engine (pglite) migrated with the actual committed migration files — not
 * mocks. Mirrors tests/integration/billing-schema.test.ts's approach for Phase 5B.
 */
describe('Phase 5C payment schema, gateway abstraction, and webhook signing', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  async function makeUser(email: string, role: 'customer' | 'admin' | 'super_admin' = 'customer') {
    const user = await createUser(db, { id: randomUUID(), email, passwordHash: 'hash', fullName: 'Test User' });
    if (role !== 'customer') {
      await db.query('UPDATE users SET role = $1 WHERE id = $2', [role, user.id]);
    }
    return user;
  }

  async function makeInvoice(userId: string, totalAmount = '49.99') {
    const { order } = await createOrder(db, {
      id: randomUUID(),
      userId,
      currency: 'USD',
      subtotalAmount: totalAmount,
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount,
      items: [],
    });
    const invoice = await createInvoice(db, {
      id: randomUUID(),
      orderId: order.id,
      userId,
      currency: 'USD',
      subtotalAmount: totalAmount,
      discountAmount: '0.00',
      taxAmount: '0.00',
      totalAmount,
    });
    return { order, invoice };
  }

  describe('0021: payments.confirmed_by_user_id', () => {
    it('accepts a null confirmed_by_user_id (default state for a freshly-created pending payment)', async () => {
      const user = await makeUser('payconf1@example.com');
      const { invoice } = await makeInvoice(user.id);
      const payment = await createPayment(db, {
        id: randomUUID(),
        invoiceId: invoice.id,
        userId: user.id,
        amount: invoice.total_amount,
        currency: invoice.currency,
        provider: 'manual',
      });
      expect(payment.confirmed_by_user_id).toBeNull();
    });

    it('records which staff member confirmed a payment, and setting it to null on other updates leaves it untouched', async () => {
      const customer = await makeUser('payconf2@example.com');
      const admin = await makeUser('payconfadmin@example.com', 'admin');
      const { invoice } = await makeInvoice(customer.id);
      const payment = await createPayment(db, {
        id: randomUUID(),
        invoiceId: invoice.id,
        userId: customer.id,
        amount: invoice.total_amount,
        currency: invoice.currency,
        provider: 'manual',
      });

      const confirmed = await updatePaymentStatus(db, payment.id, 'successful', { confirmedByUserId: admin.id });
      expect(confirmed?.confirmed_by_user_id).toBe(admin.id);

      // A later update that doesn't pass confirmedByUserId must not wipe out the one already
      // recorded (COALESCE behavior in the UPDATE statement).
      const touchedAgain = await updatePaymentStatus(db, payment.id, 'successful', {});
      expect(touchedAgain?.confirmed_by_user_id).toBe(admin.id);
    });

    it('ON DELETE SET NULL: deleting the confirming staff account does not block the delete and leaves the payment record intact', async () => {
      const customer = await makeUser('payconf3@example.com');
      const admin = await makeUser('payconfadmin2@example.com', 'admin');
      const { invoice } = await makeInvoice(customer.id);
      const payment = await createPayment(db, {
        id: randomUUID(),
        invoiceId: invoice.id,
        userId: customer.id,
        amount: invoice.total_amount,
        currency: invoice.currency,
        provider: 'manual',
      });
      await updatePaymentStatus(db, payment.id, 'successful', { confirmedByUserId: admin.id });

      await db.query('DELETE FROM users WHERE id = $1', [admin.id]);

      const after = await findPaymentById(db, payment.id);
      expect(after).not.toBeNull();
      expect(after?.status).toBe('successful');
      expect(after?.confirmed_by_user_id).toBeNull();
    });
  });

  describe('0022: widened auth_audit_log event_type CHECK', () => {
    it('accepts the three new Phase 5C event types', async () => {
      const user = await makeUser('auditpay@example.com');
      for (const eventType of ['payment_initiated', 'manual_payment_confirmed', 'manual_payment_rejected'] as const) {
        await expect(
          recordAuthEvent(db, { id: randomUUID(), userId: user.id, eventType, metadata: {} })
        ).resolves.toBeUndefined();
      }
      const { rows } = await db.query('SELECT event_type FROM auth_audit_log WHERE user_id = $1 ORDER BY created_at ASC', [user.id]);
      expect(rows.map((r) => (r as { event_type: string }).event_type)).toEqual([
        'payment_initiated',
        'manual_payment_confirmed',
        'manual_payment_rejected',
      ]);
    });

    it('still rejects an event type outside the allowed set', async () => {
      const user = await makeUser('auditpay2@example.com');
      await expect(
        db.query(
          `INSERT INTO auth_audit_log (id, user_id, event_type, metadata) VALUES ($1, $2, 'not-a-real-event', '{}')`,
          [randomUUID(), user.id]
        )
      ).rejects.toThrow();
    });
  });

  describe('setOrderPaymentStatus (src/db/orders.ts)', () => {
    it('updates only payment_status, leaving the order lifecycle status untouched', async () => {
      const user = await makeUser('orderpay@example.com');
      const { order } = await makeInvoice(user.id);
      expect(order.status).toBe('pending');
      expect(order.payment_status).toBe('unpaid');

      const updated = await setOrderPaymentStatus(db, order.id, 'paid');
      expect(updated?.payment_status).toBe('paid');
      expect(updated?.status).toBe('pending');
    });
  });

  describe('cancelOtherPendingPayments (src/db/payments.ts)', () => {
    it('cancels other pending attempts for the same invoice but leaves the kept one and other invoices alone', async () => {
      const user = await makeUser('cancelpend@example.com');
      const { invoice: invoiceA } = await makeInvoice(user.id, '10.00');
      const { invoice: invoiceB } = await makeInvoice(user.id, '20.00');

      const stale = await createPayment(db, { id: randomUUID(), invoiceId: invoiceA.id, userId: user.id, amount: '10.00', currency: 'USD', provider: 'sandbox' });
      const fresh = await createPayment(db, { id: randomUUID(), invoiceId: invoiceA.id, userId: user.id, amount: '10.00', currency: 'USD', provider: 'manual' });
      const otherInvoicePending = await createPayment(db, { id: randomUUID(), invoiceId: invoiceB.id, userId: user.id, amount: '20.00', currency: 'USD', provider: 'sandbox' });

      await withTransaction(db, async (tx) => {
        await cancelOtherPendingPayments(tx, invoiceA.id, fresh.id);
      });

      expect((await findPaymentById(db, stale.id))?.status).toBe('cancelled');
      expect((await findPaymentById(db, fresh.id))?.status).toBe('pending');
      expect((await findPaymentById(db, otherInvoicePending.id))?.status).toBe('pending');
    });
  });

  describe('gateway registry (src/payments/gateway-registry.ts)', () => {
    it('resolves the manual and sandbox gateway ids', () => {
      expect(getGateway('manual', env)).toBe(manualGateway);
      expect(getGateway('sandbox', env)).toBe(sandboxGateway);
      expect(AVAILABLE_GATEWAY_IDS.sort()).toEqual(['manual', 'sandbox']);
    });

    it('throws a ValidationError for an unknown gateway id', () => {
      expect(() => getGateway('stripe', env)).toThrow(/Unknown payment gateway/);
      expect(() => getGateway('', env)).toThrow();
    });
  });

  describe('manual gateway (src/payments/manual-gateway.ts)', () => {
    it('returns a null providerReference and a generic fallback message when MANUAL_PAYMENT_INSTRUCTIONS is unset', async () => {
      const result = await manualGateway.initiatePayment({ paymentId: randomUUID(), invoiceNumber: 'INV-00000001', amount: '10.00', currency: 'USD' }, env);
      expect(result.providerReference).toBeNull();
      expect(result.method).toBe('bank_transfer');
      expect(result.instructions).toMatch(/contact support/i);
    });

    it('returns the configured MANUAL_PAYMENT_INSTRUCTIONS verbatim when set, never a fabricated bank detail', async () => {
      const configuredEnv = loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
        JWT_SECRET: 'g'.repeat(32),
        MANUAL_PAYMENT_INSTRUCTIONS: 'Wire to Test Bank, account 000123, reference your invoice number.',
      } as NodeJS.ProcessEnv);
      const result = await manualGateway.initiatePayment({ paymentId: randomUUID(), invoiceNumber: 'INV-00000002', amount: '10.00', currency: 'USD' }, configuredEnv);
      expect(result.instructions).toBe('Wire to Test Bank, account 000123, reference your invoice number.');
    });
  });

  describe('sandbox gateway (src/payments/sandbox-gateway.ts)', () => {
    it('generates a unique sandbox_ provider reference on every call', async () => {
      const input = { paymentId: randomUUID(), invoiceNumber: 'INV-00000003', amount: '10.00', currency: 'USD' };
      const r1 = await sandboxGateway.initiatePayment(input, env);
      const r2 = await sandboxGateway.initiatePayment(input, env);
      expect(r1.providerReference).toMatch(/^sandbox_[0-9a-f]+$/);
      expect(r2.providerReference).toMatch(/^sandbox_[0-9a-f]+$/);
      expect(r1.providerReference).not.toBe(r2.providerReference);
      expect(r1.method).toBe('sandbox_demo');
    });

    it('buildSignedWebhookPayload refuses to run without a configured webhook secret', async () => {
      const user = await makeUser('sandboxwh@example.com');
      const { invoice } = await makeInvoice(user.id);
      const payment = await createPayment(db, {
        id: randomUUID(),
        invoiceId: invoice.id,
        userId: user.id,
        amount: invoice.total_amount,
        currency: invoice.currency,
        provider: 'sandbox',
        providerReference: 'sandbox_abc123',
      });
      expect(() => buildSignedWebhookPayload(payment, 'successful', env)).toThrow(/SANDBOX_GATEWAY_WEBHOOK_SECRET/);
    });

    it('buildSignedWebhookPayload refuses to build a payload for a non-sandbox payment', async () => {
      const user = await makeUser('sandboxwh2@example.com');
      const { invoice } = await makeInvoice(user.id);
      const manualPayment = await createPayment(db, {
        id: randomUUID(),
        invoiceId: invoice.id,
        userId: user.id,
        amount: invoice.total_amount,
        currency: invoice.currency,
        provider: 'manual',
      });
      const envWithSecret = loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
        JWT_SECRET: 'g'.repeat(32),
        SANDBOX_GATEWAY_WEBHOOK_SECRET: 's'.repeat(32),
      } as NodeJS.ProcessEnv);
      expect(() => buildSignedWebhookPayload(manualPayment, 'successful', envWithSecret)).toThrow(/sandbox gateway/);
    });

    it('buildSignedWebhookPayload produces a payload whose signature verifies correctly under the configured secret', async () => {
      const user = await makeUser('sandboxwh3@example.com');
      const { invoice } = await makeInvoice(user.id);
      const payment = await createPayment(db, {
        id: randomUUID(),
        invoiceId: invoice.id,
        userId: user.id,
        amount: invoice.total_amount,
        currency: invoice.currency,
        provider: 'sandbox',
        providerReference: 'sandbox_abc123',
      });
      const secret = 's'.repeat(32);
      const envWithSecret = loadEnv({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
        JWT_SECRET: 'g'.repeat(32),
        SANDBOX_GATEWAY_WEBHOOK_SECRET: secret,
      } as NodeJS.ProcessEnv);

      const { payload, rawBody, signature } = buildSignedWebhookPayload(payment, 'successful', envWithSecret);
      expect(payload.paymentId).toBe(payment.id);
      expect(payload.outcome).toBe('successful');
      expect(verifySignature(secret, rawBody, signature)).toBe(true);
    });
  });

  describe('webhook-signing (src/payments/webhook-signing.ts) — pure crypto, Phase 5D groundwork', () => {
    it('sign/verify round-trips correctly', () => {
      const secret = 'a-very-secret-webhook-key-value';
      const body = JSON.stringify({ hello: 'world', n: 42 });
      const signature = signPayload(secret, body);
      expect(verifySignature(secret, body, signature)).toBe(true);
    });

    it('rejects a tampered body', () => {
      const secret = 'a-very-secret-webhook-key-value';
      const body = JSON.stringify({ amount: '10.00' });
      const signature = signPayload(secret, body);
      const tamperedBody = JSON.stringify({ amount: '99999.00' });
      expect(verifySignature(secret, tamperedBody, signature)).toBe(false);
    });

    it('rejects a signature produced under a different secret', () => {
      const body = JSON.stringify({ hello: 'world' });
      const signature = signPayload('secret-one-value-long-enough', body);
      expect(verifySignature('secret-two-value-long-enough', body, signature)).toBe(false);
    });

    it('rejects a malformed/wrong-length signature without throwing', () => {
      const secret = 'a-very-secret-webhook-key-value';
      const body = JSON.stringify({ x: 1 });
      expect(() => verifySignature(secret, body, 'not-hex-and-too-short')).not.toThrow();
      expect(verifySignature(secret, body, 'not-hex-and-too-short')).toBe(false);
    });
  });
});
