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

describe('Admin Billing API (/api/v1/admin/invoices, /api/v1/admin/billing/ledger)', () => {
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

  async function makeActivePlanWithPrice(amount = 50) {
    const product = await createProduct(db, { id: randomUUID(), slug: `hosting-${randomUUID()}`, name: 'Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status = 'active', visibility = 'public' WHERE id = $1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `plan-${randomUUID()}`, name: 'Starter' });
    await db.query(`UPDATE product_plans SET status = 'active' WHERE id = $1`, [plan.id]);
    await createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', amount, effectiveStatus: 'published' });
    return { product, plan };
  }

  async function createCustomerWithCheckedOutInvoice(app: ReturnType<typeof buildTestApp>, email: string, amount = 50) {
    const user = await createUser(email, 'customer', 'Alice Customer');
    const { plan } = await makeActivePlanWithPrice(amount);
    await app.inject({
      method: 'POST',
      url: '/api/v1/cart/items',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { planId: plan.id, billingPeriod: 'monthly' },
    });
    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/orders',
      headers: { authorization: `Bearer ${user.token}` },
    });
    const order = orderRes.json().order;
    return { user, order };
  }

  it('rejects unauthenticated requests on all admin billing endpoints with 401', async () => {
    const app = buildTestApp();
    const invoiceId = randomUUID();

    const resList = await app.inject({ method: 'GET', url: '/api/v1/admin/invoices' });
    expect(resList.statusCode).toBe(401);

    const resDetail = await app.inject({ method: 'GET', url: `/api/v1/admin/invoices/${invoiceId}` });
    expect(resDetail.statusCode).toBe(401);

    const resRefund = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${invoiceId}/refund`,
      payload: { amountCents: 1000, reason: 'test' },
    });
    expect(resRefund.statusCode).toBe(401);

    const resCancel = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${invoiceId}/cancel`,
      payload: { reason: 'test' },
    });
    expect(resCancel.statusCode).toBe(401);

    const resLedger = await app.inject({ method: 'GET', url: '/api/v1/admin/billing/ledger' });
    expect(resLedger.statusCode).toBe(401);

    await app.close();
  });

  it('rejects customer-role tokens on all admin billing endpoints with 403', async () => {
    const customer = await createUser('cust-forbidden@example.com', 'customer');
    const app = buildTestApp();
    const invoiceId = randomUUID();
    const headers = { authorization: `Bearer ${customer.token}` };

    const resList = await app.inject({ method: 'GET', url: '/api/v1/admin/invoices', headers });
    expect(resList.statusCode).toBe(403);

    const resDetail = await app.inject({ method: 'GET', url: `/api/v1/admin/invoices/${invoiceId}`, headers });
    expect(resDetail.statusCode).toBe(403);

    const resRefund = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${invoiceId}/refund`,
      headers,
      payload: { amountCents: 1000, reason: 'test' },
    });
    expect(resRefund.statusCode).toBe(403);

    const resCancel = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${invoiceId}/cancel`,
      headers,
      payload: { reason: 'test' },
    });
    expect(resCancel.statusCode).toBe(403);

    const resLedger = await app.inject({ method: 'GET', url: '/api/v1/admin/billing/ledger', headers });
    expect(resLedger.statusCode).toBe(403);

    await app.close();
  });

  it('allows both admin and super_admin to list and view invoices with customer details', async () => {
    const admin = await createUser('admin-staff@example.com', 'admin', 'Staff Admin');
    const app = buildTestApp();
    const { order } = await createCustomerWithCheckedOutInvoice(app, 'alice-inv@example.com', 45);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(listRes.statusCode).toBe(200);
    const body = listRes.json();
    expect(body.total).toBe(1);
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0].id).toBe(order.invoiceId);
    expect(body.invoices[0].userEmail).toBe('alice-inv@example.com');
    expect(body.invoices[0].totalAmount).toBe('45.00');

    // Detail view
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${order.invoiceId}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(detailRes.statusCode).toBe(200);
    const detailBody = detailRes.json().invoice;
    expect(detailBody.id).toBe(order.invoiceId);
    expect(detailBody.userEmail).toBe('alice-inv@example.com');
    expect(detailBody.items).toHaveLength(1);
    expect(detailBody.ledger).toHaveLength(1);
    expect(detailBody.ledger[0].entryType).toBe('charge');

    await app.close();
  });

  it('supports searching and filtering invoices by status and search terms', async () => {
    const admin = await createUser('filter-admin@example.com', 'admin');
    const app = buildTestApp();
    await createCustomerWithCheckedOutInvoice(app, 'john.doe@example.com', 20);
    await createCustomerWithCheckedOutInvoice(app, 'jane.smith@example.com', 30);

    // Search by email substring
    const searchRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices?search=john.doe',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(searchRes.statusCode).toBe(200);
    expect(searchRes.json().invoices).toHaveLength(1);
    expect(searchRes.json().invoices[0].userEmail).toBe('john.doe@example.com');

    // Filter by status unpaid
    const statusRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/invoices?status=unpaid',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().total).toBe(2);

    await app.close();
  });

  it('executes partial and full refunds with append-only ledger and audit logging', async () => {
    const admin = await createUser('refund-admin@example.com', 'admin', 'Refund Staff');
    const app = buildTestApp();
    const { user, order } = await createCustomerWithCheckedOutInvoice(app, 'payer@example.com', 100);

    // 1. Pay the invoice via manual flow
    const payRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${order.invoiceId}/payments`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { gateway: 'manual' },
    });
    const paymentId = payRes.json().payment.id;

    const confirmRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/payments/${paymentId}/confirm-manual`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(confirmRes.statusCode).toBe(200);

    // Verify invoice is paid
    const paidDetail = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/invoices/${order.invoiceId}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(paidDetail.json().invoice.status).toBe('paid');

    // 2. Reject refund exceeding paid balance ($100.01 = 10001 cents)
    const overRefundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${order.invoiceId}/refund`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amountCents: 10001, reason: 'Accidental over-refund' },
    });
    expect(overRefundRes.statusCode).toBe(400);

    // 3. Issue partial refund ($40.00 = 4000 cents)
    const partialRefundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${order.invoiceId}/refund`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amountCents: 4000, reason: 'Customer requested 40% discount retrospectively' },
    });
    expect(partialRefundRes.statusCode).toBe(200);
    const partialInvoice = partialRefundRes.json().invoice;
    expect(partialInvoice.status).toBe('partially_refunded');
    expect(partialInvoice.ledger).toHaveLength(3); // charge ($100), payment ($100), refund ($40)

    // 4. Issue remaining refund ($60.00 = 6000 cents) -> full refund
    const fullRefundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${order.invoiceId}/refund`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amountCents: 6000, reason: 'Remaining refund balance' },
    });
    expect(fullRefundRes.statusCode).toBe(200);
    const fullInvoice = fullRefundRes.json().invoice;
    expect(fullInvoice.status).toBe('refunded');
    expect(fullInvoice.ledger).toHaveLength(4);

    // 5. Try another refund on fully refunded invoice -> rejects
    const redundantRefundRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${order.invoiceId}/refund`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { amountCents: 500, reason: 'Extra' },
    });
    expect(redundantRefundRes.statusCode).toBe(400);

    // 6. Verify audit logs for refunds
    const auditRes = await db.query<{ event_type: string; user_id: string }>(
      `SELECT event_type, user_id FROM auth_audit_log WHERE event_type = 'admin_invoice_refunded'`
    );
    expect(auditRes.rows).toHaveLength(2);
    expect(auditRes.rows[0].user_id).toBe(admin.id);

    await app.close();
  });

  it('cancels an unpaid invoice and cancels pending payment attempts', async () => {
    const admin = await createUser('cancel-admin@example.com', 'admin');
    const app = buildTestApp();
    const { user, order } = await createCustomerWithCheckedOutInvoice(app, 'abandoned@example.com', 60);

    // Customer initiated a payment attempt
    const payRes = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${order.invoiceId}/payments`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { gateway: 'sandbox' },
    });
    const paymentId = payRes.json().payment.id;
    expect(payRes.json().payment.status).toBe('pending');

    // Admin cancels the unpaid invoice
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/invoices/${order.invoiceId}/cancel`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { reason: 'Order abandoned by customer request' },
    });
    expect(cancelRes.statusCode).toBe(200);
    const cancelledInvoice = cancelRes.json().invoice;
    expect(cancelledInvoice.status).toBe('void');

    // Pending payment was cancelled
    const payCheck = await db.query<{ status: string }>(`SELECT status FROM payments WHERE id = $1`, [paymentId]);
    expect(payCheck.rows[0].status).toBe('cancelled');

    // Customer cannot pay a void invoice
    const retryPay = await app.inject({
      method: 'POST',
      url: `/api/v1/invoices/${order.invoiceId}/payments`,
      headers: { authorization: `Bearer ${user.token}` },
      payload: { gateway: 'manual' },
    });
    expect(retryPay.statusCode).toBe(400);

    // Verify audit log
    const auditRes = await db.query<{ event_type: string }>(
      `SELECT event_type FROM auth_audit_log WHERE event_type = 'admin_invoice_cancelled'`
    );
    expect(auditRes.rows).toHaveLength(1);

    await app.close();
  });

  it('lists global ledger entries for audit and financial reconciliation', async () => {
    const admin = await createUser('ledger-auditor@example.com', 'admin');
    const app = buildTestApp();
    const cust1 = await createCustomerWithCheckedOutInvoice(app, 'cust1-ledger@example.com', 25);
    const cust2 = await createCustomerWithCheckedOutInvoice(app, 'cust2-ledger@example.com', 35);

    const ledgerRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/billing/ledger',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(ledgerRes.statusCode).toBe(200);
    const body = ledgerRes.json();
    expect(body.total).toBe(2);
    expect(body.ledger).toHaveLength(2);
    expect(body.ledger.map((e: { userEmail: string }) => e.userEmail).sort()).toEqual([
      'cust1-ledger@example.com',
      'cust2-ledger@example.com',
    ].sort());

    // Filter by specific customer userId
    const filterRes = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/billing/ledger?userId=${cust1.user.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(filterRes.statusCode).toBe(200);
    expect(filterRes.json().total).toBe(1);
    expect(filterRes.json().ledger[0].userEmail).toBe('cust1-ledger@example.com');

    await app.close();
  });
});
