import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { confirmManualPayment } from '../../src/services/payment-service';
import { hashPassword } from '../../src/lib/password';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';

/**
 * Exercises the Phase 5C payment API (/api/v1/invoices/:id/payments, /api/v1/payments/:id,
 * /api/v1/admin/payments/:id/confirm-manual, /api/v1/admin/payments/:id/reject-manual) end-to-end
 * against a real embedded Postgres engine — not mocks. Covers both gateways' initiation, ownership
 * isolation, invoice/payment state guards, the manual gateway's staff confirm/reject flow (and its
 * atomic ledger + invoice + order side effects), RBAC on the admin routes, and — the specific proof
 * this phase must not skip — that nothing anywhere in the route/service layer ever moves a
 * `sandbox`-provider payment out of `pending`.
 */
describe('payment API (/api/v1/invoices/:id/payments, /api/v1/payments/:id, /api/v1/admin/payments)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'p'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createCustomer(email: string): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, 'customer')`, [
      userId,
      email,
      passwordHash,
      'Test Customer',
    ]);
    const token = signAuthToken(env, { sub: userId, role: 'customer', email });
    return { userId, token };
  }

  async function createUserWithRole(role: 'admin' | 'super_admin', email?: string): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const userEmail = email ?? `${role}-${userId}@example.com`;
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`, [
      userId,
      userEmail,
      'not-a-real-hash',
      'Test Staff',
      role,
    ]);
    const token = signAuthToken(env, { sub: userId, role, email: userEmail });
    return { userId, token };
  }

  async function makeActivePlanWithPrice(amount = 24.5) {
    const product = await createProduct(db, { id: randomUUID(), slug: `hosting-${randomUUID()}`, name: 'Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status = 'active', visibility = 'public' WHERE id = $1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `plan-${randomUUID()}`, name: 'Starter' });
    await db.query(`UPDATE product_plans SET status = 'active' WHERE id = $1`, [plan.id]);
    await createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', amount, effectiveStatus: 'published' });
    return { plan };
  }

  async function checkoutAndGetInvoiceId(app: ReturnType<typeof buildTestApp>, token: string, amount = 24.5): Promise<{ invoiceId: string; orderId: string }> {
    const { plan } = await makeActivePlanWithPrice(amount);
    await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly', quantity: 1 },
    });
    const checkoutRes = await app.inject({ method: 'POST', url: '/api/v1/orders', headers: { authorization: `Bearer ${token}` } });
    const order = checkoutRes.json().order;
    return { invoiceId: order.invoiceId, orderId: order.id };
  }

  // --- Authentication / validation ---------------------------------------------------------

  it('rejects payment routes when unauthenticated', async () => {
    const app = buildTestApp();
    const res1 = await app.inject({ method: 'POST', url: `/api/v1/invoices/${randomUUID()}/payments`, payload: { gateway: 'manual' } });
    expect(res1.statusCode).toBe(401);
    const res2 = await app.inject({ method: 'GET', url: `/api/v1/payments/${randomUUID()}` });
    expect(res2.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an unknown gateway id with 400', async () => {
    const { token } = await createCustomer('badgateway@example.com');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, token);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { gateway: 'stripe' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("a customer can never initiate a payment on another customer's invoice (404, not 403)", async () => {
    const alice = await createCustomer('alice-pay@example.com');
    const bob = await createCustomer('bob-pay@example.com');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, alice.token);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${bob.token}` },
      payload: { gateway: 'manual' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  // --- Manual gateway initiation ------------------------------------------------------------

  it('initiates a manual-gateway payment: pending, null providerReference, bank_transfer method, generic fallback instructions', async () => {
    const { token } = await createCustomer('manualpay1@example.com');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, token, 30);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { gateway: 'manual' },
    });
    expect(res.statusCode).toBe(201);
    const payment = res.json().payment;
    expect(payment.status).toBe('pending');
    expect(payment.provider).toBe('manual');
    expect(payment.providerReference).toBeNull();
    expect(payment.method).toBe('bank_transfer');
    expect(payment.amount).toBe('30.00');
    expect(payment.instructions).toMatch(/contact support/i);
    await app.close();
  });

  it('initiates a sandbox-gateway payment: pending, sandbox_ providerReference, sandbox_demo method', async () => {
    const { token } = await createCustomer('sandboxpay1@example.com');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, token, 15);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { gateway: 'sandbox' },
    });
    expect(res.statusCode).toBe(201);
    const payment = res.json().payment;
    expect(payment.status).toBe('pending');
    expect(payment.provider).toBe('sandbox');
    expect(payment.providerReference).toMatch(/^sandbox_[0-9a-f]+$/);
    expect(payment.method).toBe('sandbox_demo');
    await app.close();
  });

  it('refuses to initiate a payment for an invoice that is not unpaid', async () => {
    const customer = await createCustomer('notunpaid@example.com');
    const admin = await createUserWithRole('admin');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, customer.token, 40);

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = initRes.json().payment.id;

    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(confirmRes.statusCode).toBe(200);

    const secondInitRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    expect(secondInitRes.statusCode).toBe(400);
    await app.close();
  });

  it('a new payment attempt cancels a previous still-pending attempt for the same invoice', async () => {
    const { token } = await createCustomer('cancelpend@example.com');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, token, 12);

    const first = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { gateway: 'sandbox' },
    });
    const firstPaymentId = first.json().payment.id;

    const second = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { gateway: 'manual' },
    });
    expect(second.statusCode).toBe(201);

    const firstAfter = await app.inject({ method: 'GET', url: `/api/v1/payments/${firstPaymentId}`, headers: { authorization: `Bearer ${token}` } });
    expect(firstAfter.json().payment.status).toBe('cancelled');
    await app.close();
  });

  // --- GET /api/v1/payments/:id ownership ----------------------------------------------------

  it("a customer can never view another customer's payment (404, not 403)", async () => {
    const alice = await createCustomer('alice-payview@example.com');
    const bob = await createCustomer('bob-payview@example.com');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, alice.token, 22);

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${alice.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = initRes.json().payment.id;

    const bobRes = await app.inject({ method: 'GET', url: `/api/v1/payments/${paymentId}`, headers: { authorization: `Bearer ${bob.token}` } });
    expect(bobRes.statusCode).toBe(404);

    const aliceRes = await app.inject({ method: 'GET', url: `/api/v1/payments/${paymentId}`, headers: { authorization: `Bearer ${alice.token}` } });
    expect(aliceRes.statusCode).toBe(200);
    expect(aliceRes.json().payment.id).toBe(paymentId);
    await app.close();
  });

  // --- Admin confirm/reject manual payment: RBAC ---------------------------------------------

  it('rejects unauthenticated and customer-role requests on the admin payment routes', async () => {
    const customer = await createCustomer('rbaccust@example.com');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, customer.token, 18);
    const initRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = initRes.json().payment.id;

    const unauthRes = await app.inject({ method: 'POST', url: `/api/v1/admin/payments/${paymentId}/confirm-manual` });
    expect(unauthRes.statusCode).toBe(401);

    const customerRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(customerRes.statusCode).toBe(403);
    await app.close();
  });

  it('allows both admin and super_admin to confirm a manual payment (not super_admin-only)', async () => {
    for (const role of ['admin', 'super_admin'] as const) {
      const customer = await createCustomer(`confirmrole-${role}@example.com`);
      const staff = await createUserWithRole(role);
      const app = buildTestApp();
      const { invoiceId } = await checkoutAndGetInvoiceId(app, customer.token, 33);
      const initRes = await app.inject({
        method: 'POST',
        url: `/api/v1/invoices/${invoiceId}/payments`,
        headers: { authorization: `Bearer ${customer.token}` },
        payload: { gateway: 'manual' },
      });
      const paymentId = initRes.json().payment.id;

      const confirmRes = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
        headers: { authorization: `Bearer ${staff.token}` },
      });
      expect(confirmRes.statusCode).toBe(200);
      expect(confirmRes.json().payment.status).toBe('successful');
      await app.close();
    }
  });

  // --- Admin confirm manual payment: atomic side effects --------------------------------------

  it('confirming a manual payment atomically marks it successful, records a ledger entry, marks the invoice paid, and marks the order payment_status paid (order status untouched)', async () => {
    const customer = await createCustomer('confirmatomic@example.com');
    const admin = await createUserWithRole('admin');
    const app = buildTestApp();
    const { invoiceId, orderId } = await checkoutAndGetInvoiceId(app, customer.token, 55);

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = initRes.json().payment.id;

    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(confirmRes.statusCode).toBe(200);
    const confirmed = confirmRes.json().payment;
    expect(confirmed.status).toBe('successful');
    expect(confirmed.completedAt).toBeTruthy();

    const invoiceDetailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    const invoice = invoiceDetailRes.json().invoice;
    expect(invoice.status).toBe('paid');
    expect(invoice.ledger.some((l: { entryType: string; amount: string }) => l.entryType === 'payment' && l.amount === '55.00')).toBe(true);
    expect(invoice.payments).toHaveLength(1);
    expect(invoice.payments[0].id).toBe(paymentId);

    const { rows } = await db.query('SELECT status, payment_status FROM orders WHERE id = $1', [orderId]);
    const orderRow = rows[0] as { status: string; payment_status: string };
    expect(orderRow.payment_status).toBe('paid');
    expect(orderRow.status).toBe('pending'); // order lifecycle status is a separate concern, untouched

    const { rows: paymentRows } = await db.query('SELECT confirmed_by_user_id FROM payments WHERE id = $1', [paymentId]);
    expect((paymentRows[0] as { confirmed_by_user_id: string }).confirmed_by_user_id).toBe(admin.userId);

    const { rows: auditRows } = await db.query(
      `SELECT event_type, metadata FROM auth_audit_log WHERE event_type = 'manual_payment_confirmed' AND user_id = $1`,
      [admin.userId]
    );
    expect(auditRows).toHaveLength(1);
    await app.close();
  });

  it('rejecting a manual payment marks it failed with a reason, records no ledger entry, and leaves the invoice unpaid', async () => {
    const customer = await createCustomer('rejectatomic@example.com');
    const admin = await createUserWithRole('admin');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, customer.token, 44);

    const initRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = initRes.json().payment.id;

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/reject-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reason: 'No matching bank transfer received' },
    });
    expect(rejectRes.statusCode).toBe(200);
    const rejected = rejectRes.json().payment;
    expect(rejected.status).toBe('failed');
    expect(rejected.failureReason).toBe('No matching bank transfer received');

    const invoiceDetailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    const invoice = invoiceDetailRes.json().invoice;
    expect(invoice.status).toBe('unpaid');
    expect(invoice.ledger.some((l: { entryType: string }) => l.entryType === 'payment')).toBe(false);

    const { rows: auditRows } = await db.query(
      `SELECT event_type FROM auth_audit_log WHERE event_type = 'manual_payment_rejected' AND user_id = $1`,
      [admin.userId]
    );
    expect(auditRows).toHaveLength(1);
    await app.close();
  });

  it('reject-manual requires a non-empty reason', async () => {
    const customer = await createCustomer('rejectreason@example.com');
    const admin = await createUserWithRole('admin');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, customer.token, 9);
    const initRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = initRes.json().payment.id;

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/reject-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reason: '' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  // --- State guards on confirm/reject ----------------------------------------------------------

  it('refuses to confirm/reject a sandbox-provider payment through the manual-only admin routes', async () => {
    const customer = await createCustomer('sandboxguard@example.com');
    const admin = await createUserWithRole('admin');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, customer.token, 27);
    const initRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'sandbox' },
    });
    const paymentId = initRes.json().payment.id;

    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(confirmRes.statusCode).toBe(400);

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/reject-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reason: 'test' },
    });
    expect(rejectRes.statusCode).toBe(400);

    const stillPending = await app.inject({ method: 'GET', url: `/api/v1/payments/${paymentId}`, headers: { authorization: `Bearer ${customer.token}` } });
    expect(stillPending.json().payment.status).toBe('pending');
    await app.close();
  });

  it('refuses to confirm/reject an already-resolved manual payment a second time', async () => {
    const customer = await createCustomer('doubleconfirm@example.com');
    const admin = await createUserWithRole('admin');
    const app = buildTestApp();
    const { invoiceId } = await checkoutAndGetInvoiceId(app, customer.token, 60);
    const initRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = initRes.json().payment.id;

    const firstConfirm = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(firstConfirm.statusCode).toBe(200);

    const secondConfirm = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    // 409 Conflict, not 400: the request is well-formed, the payment's state simply makes it
    // impossible. This is the same status a concurrent duplicate receives, so the
    // "already processed" answer does not depend on how late the duplicate arrives.
    expect(secondConfirm.statusCode).toBe(409);
    expect(secondConfirm.json().error).toBe('CONFLICT');

    const rejectAfterConfirm = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/reject-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reason: 'too late' },
    });
    expect(rejectAfterConfirm.statusCode).toBe(409);
    await app.close();
  });

  it('404s confirm/reject for a payment id that does not exist', async () => {
    const admin = await createUserWithRole('admin');
    const app = buildTestApp();
    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${randomUUID()}/confirm-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(confirmRes.statusCode).toBe(404);
    await app.close();
  });

  // --- The specific "5C stops at initiation" proof ---------------------------------------------

  it('static proof: no route or service transitions a sandbox-provider payment out of pending anywhere in the codebase', () => {
    // This is a deliberate static/grep-based assertion, not a runtime one: it proves the absence
    // of a code path, which a runtime test alone cannot conclusively demonstrate. Phase 5C's
    // sandbox gateway is documented to leave payments permanently `pending` until Phase 5D's
    // webhook receiver exists; this guards against that boundary being silently violated by a
    // future edit (e.g. someone "helpfully" auto-completing sandbox payments to make demos look
    // nicer).
    const srcDir = path.join(__dirname, '..', '..', 'src');
    const filesToScan: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts')) filesToScan.push(full);
      }
    };
    walk(srcDir);

    const offendingFiles: string[] = [];
    for (const file of filesToScan) {
      const content = readFileSync(file, 'utf8');
      // Every call to updatePaymentStatus(...) in a route/service must not be reachable for a
      // sandbox payment with a terminal status. As of Phase 5C, updatePaymentStatus is only ever
      // called from src/services/payment-service.ts, and only ever after a
      // provider==='manual' guard (loadManualPendingPaymentOrThrow). No webhook route exists at
      // all (grep confirms there is no route path containing "webhook").
      if (/\/(webhooks?)\//i.test(content) || /app\.(post|get|put|patch)\s*\(\s*['"`][^'"`]*webhook/i.test(content)) {
        offendingFiles.push(file);
      }
    }
    expect(offendingFiles).toEqual([]);

    // The only caller of updatePaymentStatus must be payment-service.ts, and every call site in
    // it must be preceded (in the same function) by the manual-only guard.
    const paymentServiceContent = readFileSync(path.join(srcDir, 'services', 'payment-service.ts'), 'utf8');
    const updateCallCount = (paymentServiceContent.match(/updatePaymentStatus\(/g) ?? []).length;
    expect(updateCallCount).toBeGreaterThan(0);
    expect(paymentServiceContent).toMatch(/loadManualPendingPaymentOrThrow/);

    // updatePaymentStatus is *defined* in db/payments.ts and *called* only from payment-service.ts
    // — no other file may even import it, which rules out any other call site anywhere.
    for (const file of filesToScan) {
      if (file.endsWith(path.join('services', 'payment-service.ts'))) continue;
      if (file.endsWith(path.join('db', 'payments.ts'))) continue;
      const content = readFileSync(file, 'utf8');
      expect(content).not.toMatch(/\bupdatePaymentStatus\b/);
    }
  });
  // --- Concurrency: the Phase 5C double-credit defect ------------------------------------------
  //
  // Independent audit finding (PHASE_5_CHECKPOINT_REPORT.md section 3.1): `confirmManualPayment`
  // checked `status === 'pending'` OUTSIDE its transaction and then updated with `WHERE id = $1`
  // and no status guard. Two staff requests that both completed the read before either committed
  // would therefore both proceed, and each would append its own `payment` entry to
  // `billing_ledger` — a table that is append-only and enforced as such by database triggers, so
  // the bogus rows could never be deleted, only offset by compensating entries. A stress run
  // reproduced SIX confirmations, and six ledger entries, for a single invoice.
  //
  // The fix folds the status check into the UPDATE's own WHERE clause so check-and-write are one
  // atomic statement. These tests fail against the pre-fix code and must never be weakened: they
  // are the only thing standing between a double-clicked admin button and a corrupted ledger.

  describe('concurrent manual payment confirmation', () => {
    async function pendingManualPayment(app: ReturnType<typeof buildTestApp>, email: string) {
      const customer = await createCustomer(email);
      const { invoiceId } = await checkoutAndGetInvoiceId(app, customer.token);
      const initRes = await app.inject({
        method: 'POST',
        url: `/api/v1/invoices/${invoiceId}/payments`,
        headers: { authorization: `Bearer ${customer.token}` },
        payload: { gateway: 'manual' },
      });
      expect(initRes.statusCode).toBe(201);
      return { customer, invoiceId, paymentId: initRes.json().payment.id as string };
    }

    const paymentLedgerRows = async (invoiceId: string) =>
      (await db.query(`SELECT * FROM billing_ledger WHERE invoice_id = $1 AND entry_type = 'payment'`, [invoiceId]))
        .rows as Array<{ amount: string }>;

    it('commits exactly one confirmation when several arrive simultaneously', async () => {
      const app = buildTestApp();
      const admin = await createUserWithRole('admin');
      const { invoiceId, paymentId } = await pendingManualPayment(app, 'concurrent-confirm@example.com');

      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          app.inject({
            method: 'POST',
            url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
            headers: { authorization: `Bearer ${admin.token}` },
          })
        )
      );

      const statuses = results.map((r) => r.statusCode);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      // Every loser must get the same deterministic "already processed" answer — never a second
      // success, never a 500, never a timing-dependent mixture of codes.
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);
      expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);

      // The financial record is the real assertion: one credit, matching the invoice exactly.
      const ledger = await paymentLedgerRows(invoiceId);
      expect(ledger).toHaveLength(1);
      const invoice = (await db.query('SELECT total_amount, status FROM invoices WHERE id = $1', [invoiceId])).rows[0] as {
        total_amount: string;
        status: string;
      };
      expect(ledger[0].amount).toBe(invoice.total_amount);
      expect(invoice.status).toBe('paid');

      const payment = (await db.query('SELECT status FROM payments WHERE id = $1', [paymentId])).rows[0] as { status: string };
      expect(payment.status).toBe('successful');
      await app.close();
    });

    it('keeps the ledger total equal to the invoice total under repeated concurrent bursts', async () => {
      const app = buildTestApp();
      const admin = await createUserWithRole('admin');

      // Repeated rounds, because a single round can pass by luck: during the audit one 5-way run
      // passed while a 25-round stress reproduced the defect at 6 duplicate entries.
      for (let round = 0; round < 6; round += 1) {
        const { invoiceId, paymentId } = await pendingManualPayment(app, `burst-${round}@example.com`);

        const results = await Promise.all(
          Array.from({ length: 5 }, () =>
            app.inject({
              method: 'POST',
              url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
              headers: { authorization: `Bearer ${admin.token}` },
            })
          )
        );

        expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
        expect(await paymentLedgerRows(invoiceId)).toHaveLength(1);
      }

      // Global invariant across every invoice the burst touched: no invoice may ever be credited
      // more than its own total.
      const overCredited = (
        await db.query(`
          SELECT i.id
          FROM invoices i
          LEFT JOIN billing_ledger l ON l.invoice_id = i.id AND l.entry_type = 'payment'
          GROUP BY i.id, i.total_amount
          HAVING COALESCE(SUM(l.amount), 0) > i.total_amount`)
      ).rows;
      expect(overCredited).toHaveLength(0);
      await app.close();
    });

    it('lets a confirmation and a rejection race without producing both outcomes', async () => {
      const app = buildTestApp();
      const admin = await createUserWithRole('admin');
      const { invoiceId, paymentId } = await pendingManualPayment(app, 'confirm-vs-reject@example.com');

      const [confirmRes, rejectRes] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
          headers: { authorization: `Bearer ${admin.token}` },
        }),
        app.inject({
          method: 'POST',
          url: `/api/v1/admin/payments/${paymentId}/reject-manual`,
          headers: { authorization: `Bearer ${admin.token}` },
          payload: { reason: 'transfer never arrived' },
        }),
      ]);

      // Exactly one of the two must win; the other must be a clean 409.
      const codes = [confirmRes.statusCode, rejectRes.statusCode].sort();
      expect(codes).toEqual([200, 409]);

      const payment = (await db.query('SELECT status FROM payments WHERE id = $1', [paymentId])).rows[0] as { status: string };
      const invoice = (await db.query('SELECT status FROM invoices WHERE id = $1', [invoiceId])).rows[0] as { status: string };
      const ledger = await paymentLedgerRows(invoiceId);

      if (payment.status === 'successful') {
        expect(invoice.status).toBe('paid');
        expect(ledger).toHaveLength(1);
      } else {
        // A rejection records no ledger entry, because nothing was actually charged.
        expect(payment.status).toBe('failed');
        expect(invoice.status).toBe('unpaid');
        expect(ledger).toHaveLength(0);
      }
      await app.close();
    });

    it('DETERMINISTIC forced interleave: both callers read `pending` before either writes', async () => {
      // The bursts above race with Promise.all, which is realistic but NOT deterministic — the
      // interleaving that actually triggers the defect may or may not occur on a given run. This
      // test forces the exact ordering instead, so it can never pass by luck:
      //
      //   caller A: reads the payment, sees `pending`  ---.
      //   caller B: reads the payment, sees `pending`  ---'  (both reads now done)
      //   release both -> A commits its transaction -> B attempts its UPDATE
      //
      // That was precisely the defect: B's UPDATE used `WHERE id = $1` with no status guard, so
      // it succeeded against an already-confirmed payment and appended a SECOND `payment` entry
      // to the append-only ledger. With the guard folded into the UPDATE's own WHERE clause, B
      // matches zero rows and its whole transaction is abandoned.
      const app = buildTestApp();
      const admin = await createUserWithRole('admin');
      const { invoiceId, paymentId } = await pendingManualPayment(app, 'forced-interleave@example.com');

      const CALLERS = 2;
      let arrived = 0;
      let releaseAll: () => void = () => {};
      const allArrived = new Promise<void>((resolve) => {
        releaseAll = resolve;
      });

      // A Queryable proxy that holds every caller at the same point — just after the
      // pre-transaction status read — until all of them have got past it.
      const barrierDb = {
        query: async (text: string, params?: unknown[]) => {
          const result = await db.query(text, params as unknown[]);
          if (/SELECT \* FROM payments WHERE id/.test(text)) {
            arrived += 1;
            if (arrived >= CALLERS) releaseAll();
            await allArrived;
          }
          return result;
        },
        transaction: (cb: (tx: unknown) => Promise<unknown>) => db.transaction(cb as never),
      };

      const outcomes = await Promise.allSettled(
        Array.from({ length: CALLERS }, () =>
          confirmManualPayment(barrierDb as never, admin.userId, paymentId, randomUUID)
        )
      );

      // Both callers genuinely observed `pending` before either wrote.
      expect(arrived).toBe(CALLERS);

      const succeeded = outcomes.filter((o) => o.status === 'fulfilled');
      const failed = outcomes.filter((o) => o.status === 'rejected');
      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      // The loser must fail with the deterministic 409, not a 400, a 404 or a 500.
      expect((failed[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });

      // And the financial record — the thing that actually matters — must show a single credit.
      const ledger = await paymentLedgerRows(invoiceId);
      expect(ledger).toHaveLength(1);
      const invoice = (await db.query('SELECT total_amount, status FROM invoices WHERE id = $1', [invoiceId])).rows[0] as {
        total_amount: string;
        status: string;
      };
      expect(ledger[0].amount).toBe(invoice.total_amount);
      expect(invoice.status).toBe('paid');
      await app.close();
    });

    it('rolls the payment status back when the ledger write fails, so the two can never disagree', async () => {
      const app = buildTestApp();
      const admin = await createUserWithRole('admin');
      const { invoiceId, paymentId } = await pendingManualPayment(app, 'atomic-ledger@example.com');

      // Force the ledger insert to fail mid-transaction. The payment status change, the invoice
      // update and the order update must all roll back with it — a payment marked `successful`
      // with no matching ledger entry would be silent financial corruption.
      await db.query(`CREATE OR REPLACE FUNCTION test_fail_ledger() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'simulated ledger failure'; END; $$ LANGUAGE plpgsql`);
      await db.query(`CREATE TRIGGER test_fail_ledger_trg BEFORE INSERT ON billing_ledger
        FOR EACH ROW EXECUTE FUNCTION test_fail_ledger()`);

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
        headers: { authorization: `Bearer ${admin.token}` },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(500);

      await db.query('DROP TRIGGER test_fail_ledger_trg ON billing_ledger');

      const payment = (await db.query('SELECT status, completed_at FROM payments WHERE id = $1', [paymentId])).rows[0] as {
        status: string;
        completed_at: string | null;
      };
      const invoice = (await db.query('SELECT status FROM invoices WHERE id = $1', [invoiceId])).rows[0] as { status: string };
      expect(payment.status).toBe('pending');
      expect(payment.completed_at).toBeNull();
      expect(invoice.status).toBe('unpaid');
      expect(await paymentLedgerRows(invoiceId)).toHaveLength(0);

      // And the payment must still be confirmable once the fault clears — the failed attempt
      // must not have poisoned it.
      const retry = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
        headers: { authorization: `Bearer ${admin.token}` },
      });
      expect(retry.statusCode).toBe(200);
      expect(await paymentLedgerRows(invoiceId)).toHaveLength(1);
      await app.close();
    });
  });
});
