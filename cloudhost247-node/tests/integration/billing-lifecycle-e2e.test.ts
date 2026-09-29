import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { runFinancialReconciliation } from '../../src/services/reconciliation-service';

describe('Phase 5G: End-to-End Billing Lifecycle & Automated Reconciliation', () => {
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

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(email: string, role: 'customer' | 'admin' | 'super_admin' = 'customer', fullName = 'Test User') {
    const id = randomUUID();
    const hash = await hashPassword('password123');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [id, email, hash, fullName, role]
    );
    const token = signAuthToken(env, { sub: id, email, role });
    return { id, email, role, token };
  }

  async function makeActivePlanWithPrice(amount = 100) {
    const product = await createProduct(db, { id: randomUUID(), slug: `hosting-${randomUUID()}`, name: 'Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status = 'active', visibility = 'public' WHERE id = $1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `plan-${randomUUID()}`, name: 'Pro Plan' });
    await db.query(`UPDATE product_plans SET status = 'active' WHERE id = $1`, [plan.id]);
    await createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', amount, effectiveStatus: 'published' });
    return { product, plan };
  }

  it('completes full manual billing lifecycle: checkout -> invoice -> payment -> confirm -> partial refund -> full refund', async () => {
    const app = buildTestApp();
    const customer = await createUser('customer-lifecycle@example.com', 'customer', 'E2E Customer');
    const admin = await createUser('admin-lifecycle@example.com', 'admin', 'E2E Staff');
    const { plan } = await makeActivePlanWithPrice(100);

    // 1. Add item to cart
    const addRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly' },
    });
    expect(addRes.statusCode).toBe(201);

    // 2. Checkout order
    const checkoutRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(checkoutRes.statusCode).toBe(201);
    const order = checkoutRes.json().order;
    expect(order.status).toBe('pending');
    expect(order.paymentStatus).toBe('unpaid');
    const invoiceId = order.invoiceId;

    // 3. Customer views invoice detail in billing portal
    const customerInvRes = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(customerInvRes.statusCode).toBe(200);
    const customerInv = customerInvRes.json().invoice;
    expect(customerInv.status).toBe('unpaid');
    expect(customerInv.totalAmount).toBe('100.00');
    expect(customerInv.ledger).toHaveLength(1); // Opening charge

    // 4. Customer initiates manual offline payment
    const payRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'manual' },
    });
    expect(payRes.statusCode).toBe(201);
    const paymentId = payRes.json().payment.id;
    expect(payRes.json().payment.status).toBe('pending');

    // 5. Staff confirms manual offline payment
    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(confirmRes.statusCode).toBe(200);

    // 6. Verify invoice and order payment status are paid
    const paidInvRes = await app.inject({
      method: 'GET',
      url: `/api/v1/invoices/${invoiceId}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(paidInvRes.json().invoice.status).toBe('paid');
    expect(paidInvRes.json().invoice.ledger).toHaveLength(2); // Charge + Payment

    // 7. Staff issues 40% partial refund ($40.00 = 4000 cents)
    const refund40Res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${invoiceId}/refund`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amountCents: 4000, reason: '40% partial refund for SLA credit' },
    });
    expect(refund40Res.statusCode).toBe(200);
    expect(refund40Res.json().invoice.status).toBe('partially_refunded');

    // 8. Staff issues remaining 60% refund ($60.00 = 6000 cents) -> full refund
    const refund60Res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${invoiceId}/refund`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amountCents: 6000, reason: 'Final refund balance' },
    });
    expect(refund60Res.statusCode).toBe(200);
    expect(refund60Res.json().invoice.status).toBe('refunded');

    // 9. Customer ledger reflects full double-entry flow: 1 Charge ($100), 1 Payment ($100), 2 Refunds ($40 + $60)
    const customerLedgerRes = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/ledger',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(customerLedgerRes.statusCode).toBe(200);
    const ledger = customerLedgerRes.json().ledger;
    expect(ledger).toHaveLength(4);

    // 10. Audit reconciliation passes with 100% healthy status
    const reconReport = await runFinancialReconciliation(db);
    expect(reconReport.status).toBe('healthy');
    expect(reconReport.summary.totalViolations).toBe(0);
    expect(reconReport.invariantChecks.B1_paymentCurrencyMatch).toBe(true);
    expect(reconReport.invariantChecks.B2_paymentUserMatch).toBe(true);
    expect(reconReport.invariantChecks.B3_ledgerInvoiceMatch).toBe(true);
    expect(reconReport.invariantChecks.B4_paymentTotalCap).toBe(true);
    expect(reconReport.invariantChecks.B5_orderInvoiceParity).toBe(true);
    expect(reconReport.invariantChecks.R1_refundTotalCap).toBe(true);

    await app.close();
  });

  it('runs automated reconciliation API endpoint for admin staff and reports clean health', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-recon@example.com', 'admin');
    const customer = await createUser('cust-recon@example.com', 'customer');
    const { plan } = await makeActivePlanWithPrice(50);

    // Create a transaction record
    await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly' },
    });
    await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { authorization: `Bearer ${customer.token}` },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/reconciliation',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(res.statusCode).toBe(200);
    const report = res.json().report;
    expect(report.status).toBe('healthy');
    expect(report.summary.totalInvoicesAudited).toBeGreaterThan(0);
    expect(report.summary.totalViolations).toBe(0);

    await app.close();
  });
});
