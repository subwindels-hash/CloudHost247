/**
 * Revenue Guardian end-to-end tests against a real embedded Postgres engine (PGlite) with the
 * full migration chain applied — validating the migration on a clean database, the API + RBAC
 * surface, ledger-driven recovery/promise reconciliation, and automation idempotency.
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import {
  processOverdueInvoices,
  processPaymentPromises,
  reconcileRecoveryState,
  runAssignmentRules,
} from '../../src/revenue-guardian/jobs/definitions';
import { executeJobManually } from '../../src/revenue-guardian/jobs/runner';
import { runRevenueGuardianCycle } from '../../src/revenue-guardian/jobs/scheduler';
import { sendRgWhatsApp, getWhatsAppStatus } from '../../src/revenue-guardian/notifications/whatsapp';

describe('Revenue Guardian (/api/admin/revenue-guardian)', () => {
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

  async function createUser(email: string, role: 'customer' | 'staff' | 'admin' | 'super_admin' = 'customer') {
    const id = randomUUID();
    const hash = await hashPassword('password12345');
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [
      id,
      email,
      hash,
      `User ${email}`,
      role,
    ]);
    const token = signAuthToken(env, { sub: id, email, role });
    return { id, email, role, token };
  }

  /** Seeds a real order + unpaid invoice + charge ledger entry, like billing-service does. */
  async function seedUnpaidInvoice(userId: string, amount: string, dueDaysAgo: number, currency = 'USD') {
    const orderId = randomUUID();
    const invoiceId = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status)
       VALUES ($1,$2,$3,$4,$4,'completed','unpaid')`,
      [orderId, userId, currency, amount]
    );
    await db.query(
      `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status, due_date)
       VALUES ($1,$2,$3,$4,$5,$5,'unpaid', CURRENT_DATE - $6::int)`,
      [invoiceId, orderId, userId, currency, amount, dueDaysAgo]
    );
    await db.query(
      `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
       VALUES ($1,$2,$3,'charge',$4,$5,'Invoice issued')`,
      [randomUUID(), userId, invoiceId, amount, currency]
    );
    return { orderId, invoiceId };
  }

  /** Records a ledger payment + marks the invoice paid when fully covered (as webhooks do). */
  async function recordLedgerPayment(userId: string, invoiceId: string, amount: string, markPaid: boolean, currency = 'USD') {
    await db.query(
      `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
       VALUES ($1,$2,$3,'payment',$4,$5,'Payment received')`,
      [randomUUID(), userId, invoiceId, amount, currency]
    );
    if (markPaid) {
      await db.query(`UPDATE invoices SET status = 'paid', updated_at = now() WHERE id = $1`, [invoiceId]);
    }
  }

  // ------------------------------------------------------------------------------- RBAC ---

  it('requires authentication and staff roles on every endpoint; customers are rejected', async () => {
    const app = buildTestApp();
    const customer = await createUser('cust@example.com', 'customer');

    for (const url of [
      '/api/admin/revenue-guardian/dashboard',
      '/api/admin/revenue-guardian/recovery-cases',
      '/api/admin/revenue-guardian/revenue-at-risk',
      '/api/admin/revenue-guardian/settings',
      '/api/admin/revenue-guardian/automation/runs',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      expect((await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${customer.token}` } })).statusCode).toBe(403);
    }
    await app.close();
  });

  it('enforces granular permissions: staff can view/work but not settings, automation, write-off or staff performance', async () => {
    const app = buildTestApp();
    const staff = await createUser('staff@example.com', 'staff');
    const headers = { authorization: `Bearer ${staff.token}` };

    expect((await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/dashboard', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/follow-ups', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/settings', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/automation/runs', headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/staff-performance', headers })).statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'POST', url: '/api/admin/revenue-guardian/automation/jobs/process_overdue_invoices/run', headers }))
        .statusCode
    ).toBe(403);
    await app.close();
  });

  it('scopes staff accounts to their own portfolio (spec §25, §42)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-scope@example.com', 'admin');
    const staffA = await createUser('staff-a@example.com', 'staff');
    const mine = await createUser('mine@example.com', 'customer');
    const other = await createUser('other@example.com', 'customer');
    await seedUnpaidInvoice(mine.id, '40.00', 5);
    await seedUnpaidInvoice(other.id, '60.00', 5);
    await processOverdueInvoices(db);

    // Assign only "mine" to staffA.
    const assignRes = await app.inject({
      method: 'POST',
      url: '/api/admin/revenue-guardian/assignments',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { customerIds: [mine.id], staffUserId: staffA.id, assignmentType: 'account_manager' },
    });
    expect(assignRes.statusCode).toBe(201);

    const adminCases = await app.inject({
      method: 'GET',
      url: '/api/admin/revenue-guardian/recovery-cases',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    expect(adminCases.json().total).toBe(2);

    const staffCases = await app.inject({
      method: 'GET',
      url: '/api/admin/revenue-guardian/recovery-cases',
      headers: { authorization: `Bearer ${staffA.token}` },
    });
    expect(staffCases.json().total).toBe(1);
    expect(staffCases.json().items[0].customer_id).toBe(mine.id);

    // Customer profile of the unassigned customer is out of scope for staff.
    const profileRes = await app.inject({
      method: 'GET',
      url: `/api/admin/revenue-guardian/customers/${other.id}`,
      headers: { authorization: `Bearer ${staffA.token}` },
    });
    expect(profileRes.statusCode).toBe(403);
    await app.close();
  });

  // ------------------------------------------------------- overdue automation & idempotency ---

  it('turns overdue invoices into recovery work idempotently: cases, follow-ups, and queued notices are never duplicated', async () => {
    const customer = await createUser('overdue@example.com', 'customer');
    const { invoiceId } = await seedUnpaidInvoice(customer.id, '99.00', 10);

    const first = await processOverdueInvoices(db);
    expect(first.processed).toBe(1);
    const second = await processOverdueInvoices(db);
    expect(second.created).toBe(0);
    expect(second.notificationsSent).toBe(0);

    const cases = await db.query(`SELECT * FROM revenue_guardian_recovery_cases WHERE invoice_id = $1`, [invoiceId]);
    expect(cases.rows).toHaveLength(1);
    const followUps = await db.query(`SELECT * FROM revenue_guardian_follow_ups WHERE invoice_id = $1`, [invoiceId]);
    expect(followUps.rows).toHaveLength(1);
    const comms = await db.query(
      `SELECT * FROM revenue_guardian_communication_log WHERE invoice_id = $1 AND template_key = 'invoice_overdue'`,
      [invoiceId]
    );
    expect(comms.rows).toHaveLength(1);
    expect((comms.rows[0] as { status: string }).status).toBe('queued'); // honest: queued, not "sent"

    const rgCase = cases.rows[0] as { amount_outstanding: string; risk_reasons: unknown; status: string };
    expect(Number(rgCase.amount_outstanding)).toBe(99);
    expect(rgCase.status).toBe('new');
    expect(Array.isArray(rgCase.risk_reasons)).toBe(true);
    expect((rgCase.risk_reasons as string[]).length).toBeGreaterThan(0);
  });

  it('never sends a reminder or opens a case for a paid invoice (spec §75)', async () => {
    const customer = await createUser('paid@example.com', 'customer');
    const { invoiceId } = await seedUnpaidInvoice(customer.id, '50.00', 10);
    await recordLedgerPayment(customer.id, invoiceId, '50.00', true);

    const result = await processOverdueInvoices(db);
    expect(result.processed).toBe(0);
    const cases = await db.query(`SELECT * FROM revenue_guardian_recovery_cases WHERE invoice_id = $1`, [invoiceId]);
    expect(cases.rows).toHaveLength(0);
  });

  // ----------------------------------------------------------- ledger-driven case lifecycle ---

  it('reconciles cases with the ledger: partial payment → partially_recovered, full → recovered', async () => {
    const customer = await createUser('ledger@example.com', 'customer');
    const { invoiceId } = await seedUnpaidInvoice(customer.id, '100.00', 8);
    await processOverdueInvoices(db);

    await recordLedgerPayment(customer.id, invoiceId, '40.00', false);
    await reconcileRecoveryState(db);
    let rows = await db.query(`SELECT status, amount_recovered::text, amount_outstanding::text FROM revenue_guardian_recovery_cases WHERE invoice_id = $1`, [invoiceId]);
    let rgCase = rows.rows[0] as { status: string; amount_recovered: string; amount_outstanding: string };
    expect(rgCase.status).toBe('partially_recovered');
    expect(Number(rgCase.amount_recovered)).toBe(40);
    expect(Number(rgCase.amount_outstanding)).toBe(60);

    await recordLedgerPayment(customer.id, invoiceId, '60.00', true);
    await reconcileRecoveryState(db);
    rows = await db.query(`SELECT status, amount_recovered::text, closed_at FROM revenue_guardian_recovery_cases WHERE invoice_id = $1`, [invoiceId]);
    rgCase = rows.rows[0] as never;
    expect(rgCase.status).toBe('recovered');
    expect(Number(rgCase.amount_recovered)).toBe(100);
    expect((rows.rows[0] as { closed_at: string | null }).closed_at).not.toBeNull();
  });

  it('refuses a manual "recovered" transition while the ledger shows an outstanding balance (spec §52)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-guard@example.com', 'admin');
    const customer = await createUser('guard@example.com', 'customer');
    const { invoiceId } = await seedUnpaidInvoice(customer.id, '75.00', 6);
    await processOverdueInvoices(db);
    const caseRow = (await db.query(`SELECT id FROM revenue_guardian_recovery_cases WHERE invoice_id = $1`, [invoiceId]))
      .rows[0] as { id: string };

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/revenue-guardian/recovery-cases/${caseRow.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'recovered' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('outstanding');

    // Invalid transition is rejected too.
    const res2 = await app.inject({
      method: 'PATCH',
      url: `/api/admin/revenue-guardian/recovery-cases/${caseRow.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'payment_pending' },
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().message).toContain('Invalid status transition');

    // Dispute requires a reason; write-off requires super_admin.
    const res3 = await app.inject({
      method: 'PATCH',
      url: `/api/admin/revenue-guardian/recovery-cases/${caseRow.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'disputed' },
    });
    expect(res3.statusCode).toBe(400);
    const res4 = await app.inject({
      method: 'PATCH',
      url: `/api/admin/revenue-guardian/recovery-cases/${caseRow.id}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { status: 'written_off', reason: 'uncollectable' },
    });
    expect(res4.statusCode).toBe(400);

    const superAdmin = await createUser('root@example.com', 'super_admin');
    const res5 = await app.inject({
      method: 'PATCH',
      url: `/api/admin/revenue-guardian/recovery-cases/${caseRow.id}`,
      headers: { authorization: `Bearer ${superAdmin.token}` },
      payload: { status: 'written_off', reason: 'uncollectable' },
    });
    expect(res5.statusCode).toBe(200);
    expect(res5.json().recoveryCase.status).toBe('written_off');
    // Write-off never deletes billing history (spec §54).
    const invoiceStillThere = await db.query(`SELECT id FROM invoices WHERE id = $1`, [invoiceId]);
    expect(invoiceStillThere.rows).toHaveLength(1);
    await app.close();
  });

  // -------------------------------------------------------------------------- promises ---

  it('promise fulfillment is decided by the ledger, never by a staff click (spec §10, §52)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-promise@example.com', 'admin');
    const customer = await createUser('promiser@example.com', 'customer');
    const { invoiceId } = await seedUnpaidInvoice(customer.id, '80.00', 4);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/admin/revenue-guardian/payment-promises',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { customerId: customer.id, invoiceId, promisedAmount: '80.00', promisedDate: new Date().toISOString().slice(0, 10) },
    });
    expect(createRes.statusCode).toBe(201);
    const promiseId = createRes.json().promise.id;

    // Reconcile without payment: still pending (today's deadline has not passed).
    let patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/revenue-guardian/payment-promises/${promiseId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { action: 'reconcile' },
    });
    expect(patchRes.json().promise.status).toBe('pending');

    // Ledger payment arrives → fulfilled with the real amount.
    await recordLedgerPayment(customer.id, invoiceId, '80.00', true);
    patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/admin/revenue-guardian/payment-promises/${promiseId}`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { action: 'reconcile' },
    });
    expect(patchRes.json().promise.status).toBe('fulfilled');
    expect(Number(patchRes.json().promise.fulfilled_amount)).toBe(80);
    await app.close();
  });

  it('a promise past its date without payment becomes broken and creates an urgent follow-up', async () => {
    const customer = await createUser('breaker@example.com', 'customer');
    const { invoiceId } = await seedUnpaidInvoice(customer.id, '120.00', 15);
    await processOverdueInvoices(db);
    const caseRow = (await db.query(`SELECT id FROM revenue_guardian_recovery_cases WHERE invoice_id = $1`, [invoiceId]))
      .rows[0] as { id: string };

    // Promise dated yesterday, directly seeded.
    const promiseId = randomUUID();
    await db.query(
      `INSERT INTO revenue_guardian_payment_promises (id, customer_id, invoice_id, case_id, promised_amount, currency, promised_date)
       VALUES ($1,$2,$3,$4,'120.00','USD', CURRENT_DATE - 1)`,
      [promiseId, customer.id, invoiceId, caseRow.id]
    );

    const result = await processPaymentPromises(db);
    expect(result.processed).toBe(1);

    const promise = (await db.query(`SELECT status, broken_at FROM revenue_guardian_payment_promises WHERE id = $1`, [promiseId]))
      .rows[0] as { status: string; broken_at: string | null };
    expect(promise.status).toBe('broken');
    expect(promise.broken_at).not.toBeNull();

    const followUps = await db.query(
      `SELECT * FROM revenue_guardian_follow_ups WHERE dedupe_key = $1`,
      [`broken-promise-followup:${promiseId}`]
    );
    expect(followUps.rows).toHaveLength(1);

    // Second run does not duplicate anything.
    const again = await processPaymentPromises(db);
    expect(again.processed).toBe(0);
  });

  // ------------------------------------------------------------------- assignments & rules ---

  it('reassignment preserves full ownership history with actor and reason (spec §6)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-assign@example.com', 'admin');
    const staffA = await createUser('am-a@example.com', 'staff');
    const staffB = await createUser('am-b@example.com', 'staff');
    const customer = await createUser('owned@example.com', 'customer');
    const headers = { authorization: `Bearer ${admin.token}` };

    await app.inject({
      method: 'POST',
      url: '/api/admin/revenue-guardian/assignments',
      headers,
      payload: { customerIds: [customer.id], staffUserId: staffA.id, assignmentType: 'account_manager' },
    });
    const reassign = await app.inject({
      method: 'POST',
      url: '/api/admin/revenue-guardian/assignments',
      headers,
      payload: { customerIds: [customer.id], staffUserId: staffB.id, assignmentType: 'account_manager', reason: 'territory change' },
    });
    expect(reassign.statusCode).toBe(201);

    const history = await app.inject({
      method: 'GET',
      url: `/api/admin/revenue-guardian/assignments?customerId=${customer.id}&includeEnded=true`,
      headers,
    });
    const items = history.json().items as Array<{ staff_user_id: string; ended_at: string | null }>;
    expect(items).toHaveLength(2);
    expect(items.find((a) => a.staff_user_id === staffA.id)?.ended_at).not.toBeNull();
    expect(items.find((a) => a.staff_user_id === staffB.id)?.ended_at).toBeNull();

    // Audit trail exists in the platform audit log.
    const audits = await db.query(`SELECT * FROM audit_logs WHERE action = 'revenue_guardian.assignment_changed'`);
    expect(audits.rows.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  it('database-stored assignment rules assign matching customers automatically and idempotently', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-rule@example.com', 'admin');
    const staff = await createUser('rule-staff@example.com', 'staff');
    const customer = await createUser('ng-customer@example.com', 'customer');
    await db.query(`UPDATE users SET country = 'Nigeria' WHERE id = $1`, [customer.id]);

    const ruleRes = await app.inject({
      method: 'POST',
      url: '/api/admin/revenue-guardian/assignment-rules',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {
        name: 'Nigeria accounts',
        conditions: { country: 'Nigeria' },
        staffUserId: staff.id,
        assignmentType: 'account_manager',
      },
    });
    expect(ruleRes.statusCode).toBe(201);

    const run1 = await runAssignmentRules(db);
    expect(run1.created).toBe(1);
    const run2 = await runAssignmentRules(db);
    expect(run2.created).toBe(0);

    const active = await db.query(
      `SELECT staff_user_id, source FROM revenue_guardian_assignments WHERE customer_id = $1 AND ended_at IS NULL`,
      [customer.id]
    );
    expect(active.rows).toHaveLength(1);
    expect((active.rows[0] as { staff_user_id: string }).staff_user_id).toBe(staff.id);
    expect((active.rows[0] as { source: string }).source).toContain('rule:');
    await app.close();
  });

  // ------------------------------------------------------------- scheduler, runs, dashboards ---

  it('manual runs are locked against double execution and recorded with counters (spec §20–§21)', async () => {
    const admin = await createUser('runner@example.com', 'admin');
    const customer = await createUser('runnee@example.com', 'customer');
    await seedUnpaidInvoice(customer.id, '30.00', 5);

    const now = new Date();
    const first = await executeJobManually(db, 'process_overdue_invoices', admin.id, now);
    expect(first.status).toBe('completed');
    expect(first.result?.processed).toBe(1);

    const second = await executeJobManually(db, 'process_overdue_invoices', admin.id, now);
    expect(second.status).toBe('locked');

    const runs = await db.query(`SELECT * FROM revenue_guardian_automation_runs WHERE job_name = 'process_overdue_invoices'`);
    expect(runs.rows).toHaveLength(1);
    expect((runs.rows[0] as { status: string; trigger: string }).status).toBe('completed');
    expect((runs.rows[0] as { trigger: string }).trigger).toBe('manual');
  });

  it('the scheduler cycle runs every job once per bucket, and a second overlapping pass is fully locked out', async () => {
    const customer = await createUser('cycle@example.com', 'customer');
    await seedUnpaidInvoice(customer.id, '20.00', 3);
    const now = new Date();

    const pass1 = await runRevenueGuardianCycle(db, now);
    expect(pass1.ran.length).toBeGreaterThan(0);
    expect(pass1.failed).toHaveLength(0);

    const pass2 = await runRevenueGuardianCycle(db, now);
    expect(pass2.ran).toHaveLength(0);
    expect(pass2.locked.length).toBe(pass1.ran.length + pass1.locked.length);
  });

  it('dashboard, revenue-at-risk, risk analysis and forecast are computed from real billing rows', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-dash@example.com', 'admin');
    const customer = await createUser('dash-cust@example.com', 'customer');
    const { invoiceId } = await seedUnpaidInvoice(customer.id, '150.00', 40);
    await seedUnpaidInvoice(customer.id, '50.00', 2);
    await processOverdueInvoices(db);
    await recordLedgerPayment(customer.id, invoiceId, '150.00', true);
    await reconcileRecoveryState(db);

    const headers = { authorization: `Bearer ${admin.token}` };
    const dash = (await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/dashboard', headers })).json();
    expect(dash.metrics.revenue.totalOutstanding).toEqual([{ currency: 'USD', amount: '50.00' }]);
    expect(dash.metrics.revenue.revenueRecovered).toEqual([{ currency: 'USD', amount: '150.00' }]);
    expect(dash.metrics.recovery.recoveredCases).toBe(1);
    expect(dash.metrics.customers.withOverdueInvoices).toBe(1);

    const atRisk = (await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/revenue-at-risk', headers })).json();
    expect(atRisk.total).toBe(1);
    expect(atRisk.items[0].risk_reasons.length).toBeGreaterThan(0);

    const aging = (await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/risk-analysis', headers })).json();
    expect(aging.buckets.length).toBeGreaterThan(0);

    const forecast = (await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/forecast', headers })).json();
    expect(forecast.actual.outstanding).toEqual([{ currency: 'USD', amount: '50.00' }]);
    expect(forecast.actual.collectedLast30d).toEqual([{ currency: 'USD', amount: '150.00' }]);
    await app.close();
  });

  it('exports the report as CSV with honest metadata, and customer profile centralizes revenue history', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-report@example.com', 'admin');
    const customer = await createUser('report-cust@example.com', 'customer');
    await seedUnpaidInvoice(customer.id, '65.00', 12);
    await processOverdueInvoices(db);
    const headers = { authorization: `Bearer ${admin.token}` };

    const exportRes = await app.inject({
      method: 'POST',
      url: '/api/admin/revenue-guardian/reports/export',
      headers,
      payload: { reportType: 'revenue_recovery', format: 'csv' },
    });
    expect(exportRes.statusCode).toBe(200);
    expect(exportRes.headers['content-type']).toContain('text/csv');
    expect(exportRes.body).toContain('report-cust@example.com');
    expect(exportRes.body).toContain('amount_outstanding=OUTSTANDING');

    const profileRes = await app.inject({
      method: 'GET',
      url: `/api/admin/revenue-guardian/customers/${customer.id}`,
      headers,
    });
    expect(profileRes.statusCode).toBe(200);
    const profile = profileRes.json().profile;
    expect(profile.customer.email).toBe('report-cust@example.com');
    expect(profile.invoices).toHaveLength(1);
    expect(profile.cases).toHaveLength(1);
    expect(profile.financials[0].outstanding).toBe('65.00');
    expect(profileRes.json().timeline.length).toBeGreaterThan(0);
    await app.close();
  });

  // ------------------------------------------------------------------ settings & fail-closed ---

  it('settings are admin-configurable through platform_settings and hide secrets', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin-settings@example.com', 'admin');
    const headers = { authorization: `Bearer ${admin.token}` };

    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/admin/revenue-guardian/settings',
      headers,
      payload: { overdueThresholdDays: 5, renewalReminderDays: [30, 7, 1], whatsapp: { enabled: true, provider: 'twilio', accountSid: 'AC1', authToken: 'secret-token', fromNumber: '+1000' } },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().settings.overdueThresholdDays).toBe(5);
    expect(JSON.stringify(patch.json())).not.toContain('secret-token');

    const get = await app.inject({ method: 'GET', url: '/api/admin/revenue-guardian/settings', headers });
    expect(get.json().settings.renewalReminderDays).toEqual([30, 7, 1]);
    expect(JSON.stringify(get.json())).not.toContain('secret-token');
    expect(get.json().whatsappStatus.state).toBe('READY');
    await app.close();
  });

  it('WhatsApp fails closed with CONFIGURATION_REQUIRED when not configured (spec §23, §63)', async () => {
    const status = await getWhatsAppStatus(db);
    expect(status.state).toBe('DISABLED');

    await db.query(
      `UPDATE platform_settings SET value = '{"enabled": true, "provider": "twilio"}'::jsonb WHERE key = 'revenue_guardian.whatsapp'`
    );
    expect((await getWhatsAppStatus(db)).state).toBe('CONFIGURATION_REQUIRED');

    const customer = await createUser('wa@example.com', 'customer');
    const outcome = await sendRgWhatsApp(db, {
      customerId: customer.id,
      recipient: '+2348000000000',
      templateKey: 'payment_reminder',
      message: 'test',
    });
    expect(outcome).toBe('WHATSAPP_CONFIGURATION_REQUIRED');
    const log = await db.query(`SELECT status FROM revenue_guardian_communication_log WHERE channel = 'whatsapp'`);
    expect((log.rows[0] as { status: string }).status).toBe('configuration_required');
  });

  it('exposes a customer-facing revenue health view without internal recovery data (spec §45)', async () => {
    const app = buildTestApp();
    const customer = await createUser('healthy@example.com', 'customer');
    await seedUnpaidInvoice(customer.id, '25.00', 3);
    await processOverdueInvoices(db);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/account/revenue-health',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.outstandingInvoices).toHaveLength(1);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('risk_score');
    expect(raw).not.toContain('assigned_staff');
    expect(raw).not.toContain('case_number');
    await app.close();
  });
});
