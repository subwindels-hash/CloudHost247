/**
 * DEVELOPMENT PREVIEW ONLY — never used in production.
 *
 * Boots the real CloudHost247 app (full migration chain, real route handlers, real Revenue
 * Guardian automation) against an EMBEDDED Postgres engine (PGlite — the same engine the
 * integration tests use), seeds a clearly-labeled demo dataset, runs one automation cycle, and
 * serves the built frontend so the Revenue Guardian module can be explored end to end without
 * an external database server.
 *
 * Every number visible in the preview is genuinely computed by the production code paths from
 * the seeded billing rows — the module itself contains no demo/fake-data branches.
 *
 * Usage: npx tsx scripts/revenue-guardian-demo-preview.ts
 * Logins: admin@demo.cloudhost247.test / staff@demo.cloudhost247.test / root@demo.cloudhost247.test
 * Password (all): demo-password-123
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { loadEnv } from '../src/config/env';
import { buildApp } from '../src/app';
import { PgliteClient } from '../database/db-client';
import { migrateUp } from '../database/migrate';
import { hashPassword } from '../src/lib/password';
import { runRevenueGuardianCycle } from '../src/revenue-guardian/jobs/scheduler';
import { createPaymentPromise } from '../src/revenue-guardian/services/promise-service';
import { assignCustomer } from '../src/revenue-guardian/services/assignment-service';
import { reconcileRecoveryState, processPaymentPromises } from '../src/revenue-guardian/jobs/definitions';
import { buildKeyRing } from '../src/lib/crypto';
import { setKeyRingForTesting } from '../src/lib/keyring';
import { setCloudflareTestOverrides, encryptApiToken } from '../src/integrations/cloudflare/config';
import { createCloudflareOrder } from '../src/services/cloudflare-service';
import { provisionPaidOrder } from '../src/services/provisioning-service';
import { withTransaction } from '../src/db/transaction';
import { sweepCloudflareJobs } from '../src/worker/cloudflare-sweep';
import { MockCloudflare } from '../tests/helpers/mock-cloudflare';

const PASSWORD = 'demo-password-123';

async function main() {
  const db = new PGlite();
  await migrateUp(new PgliteClient(db), { isProduction: false });

  process.env.DATABASE_URL = 'postgresql://embedded:embedded@localhost:5432/embedded';
  process.env.JWT_SECRET = 'demo-preview-secret-demo-preview-secret';
  process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64);
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'development',
    PORT: '3000',
  } as NodeJS.ProcessEnv);
  setKeyRingForTesting(buildKeyRing('a'.repeat(64), undefined));

  // DEV PREVIEW ONLY: a simulated Cloudflare API endpoint (tests/helpers/mock-cloudflare.ts) so
  // the module is explorable without real credentials. Production always talks to the real API.
  const mockCf = new MockCloudflare();
  setCloudflareTestOverrides({ fetchImpl: mockCf.fetch, sleep: () => Promise.resolve() });

  // ------------------------------------------------------------------------------- seed ---
  const hash = await hashPassword(PASSWORD);
  const mkUser = async (email: string, role: string, name: string, country: string | null = null) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, country) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, email, hash, name, role, country]
    );
    return id;
  };

  const rootId = await mkUser('root@demo.cloudhost247.test', 'super_admin', 'Root Admin (demo)');
  const adminId = await mkUser('admin@demo.cloudhost247.test', 'admin', 'Ada Admin (demo)');
  const staff1 = await mkUser('staff@demo.cloudhost247.test', 'staff', 'Sam Staff (demo)');
  const staff2 = await mkUser('collections@demo.cloudhost247.test', 'staff', 'Cleo Collections (demo)');

  const customers = [
    { email: 'amara@demo-customer.test', name: 'Amara Obi (demo)', country: 'Nigeria' },
    { email: 'bruno@demo-customer.test', name: 'Bruno Keller (demo)', country: 'Germany' },
    { email: 'chidi@demo-customer.test', name: 'Chidi Eze (demo)', country: 'Nigeria' },
    { email: 'dana@demo-customer.test', name: 'Dana Ferreira (demo)', country: 'Brazil' },
    { email: 'emeka@demo-customer.test', name: 'Emeka Ude (demo)', country: 'Nigeria' },
    { email: 'freya@demo-customer.test', name: 'Freya Holm (demo)', country: 'Denmark' },
  ];
  const custIds: string[] = [];
  for (const c of customers) custIds.push(await mkUser(c.email, 'customer', c.name, c.country));

  // Catalog: product + plan + monthly pricing (used by subscriptions/recurring revenue).
  const productId = randomUUID();
  const planId = randomUUID();
  await db.query(
    `INSERT INTO products (id, slug, name, product_type, status, visibility) VALUES ($1,'demo-hosting','Demo Cloud Hosting','hosting','active','public')`,
    [productId]
  );
  await db.query(
    `INSERT INTO product_plans (id, product_id, slug, name, status) VALUES ($1,$2,'demo-pro','Pro Plan','active')`,
    [planId, productId]
  );
  await db.query(
    `INSERT INTO plan_pricing (id, plan_id, billing_period, currency, amount, effective_status) VALUES ($1,$2,'monthly','USD',49.00,'published')`,
    [randomUUID(), planId]
  );

  const seedInvoice = async (userId: string, amount: string, dueOffsetDays: number, paid = false) => {
    const orderId = randomUUID();
    const invoiceId = randomUUID();
    await db.query(
      `INSERT INTO orders (id, user_id, currency, subtotal_amount, total_amount, status, payment_status)
       VALUES ($1,$2,'USD',$3,$3,'completed',$4)`,
      [orderId, userId, amount, paid ? 'paid' : 'unpaid']
    );
    await db.query(
      `INSERT INTO invoices (id, order_id, user_id, currency, subtotal_amount, total_amount, status, due_date)
       VALUES ($1,$2,$3,'USD',$4,$4,$5, CURRENT_DATE + $6::int)`,
      [invoiceId, orderId, userId, amount, paid ? 'paid' : 'unpaid', dueOffsetDays]
    );
    await db.query(
      `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
       VALUES ($1,$2,$3,'charge',$4,'USD','Invoice issued (demo seed)')`,
      [randomUUID(), userId, invoiceId, amount]
    );
    if (paid) {
      await db.query(
        `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
         VALUES ($1,$2,$3,'payment',$4,'USD','Payment received (demo seed)')`,
        [randomUUID(), userId, invoiceId, amount]
      );
    }
    return invoiceId;
  };

  const seedSubscription = async (userId: string, status: string, periodEndOffsetDays: number, pastDueDaysAgo?: number, suspendedDaysAgo?: number) => {
    await db.query(
      `INSERT INTO subscriptions (id, customer_id, plan_id, status, current_period_start, current_period_end, past_due_since, suspended_at)
       VALUES ($1,$2,$3,$4, now() - interval '30 days', now() + ($5 || ' days')::interval,
               CASE WHEN $6::int IS NOT NULL THEN now() - ($6 || ' days')::interval END,
               CASE WHEN $7::int IS NOT NULL THEN now() - ($7 || ' days')::interval END)`,
      [randomUUID(), userId, planId, status, String(periodEndOffsetDays), pastDueDaysAgo ?? null, suspendedDaysAgo ?? null]
    );
  };

  // Amara: heavily overdue + failed payments + past-due subscription (critical risk).
  const amaraInv = await seedInvoice(custIds[0]!, '196.00', -35);
  await seedInvoice(custIds[0]!, '49.00', -8);
  await seedSubscription(custIds[0]!, 'past_due', -3, 10);
  await db.query(
    `INSERT INTO payments (id, invoice_id, user_id, amount, currency, status, provider, failure_reason)
     SELECT $1, i.id, i.user_id, i.total_amount, 'USD', 'failed', 'stripe', 'card_declined (demo seed)'
       FROM invoices i WHERE i.id = $2`,
    [randomUUID(), amaraInv]
  );

  // Bruno: mildly overdue, will make a partial payment after case opens.
  const brunoInv = await seedInvoice(custIds[1]!, '98.00', -6);
  await seedSubscription(custIds[1]!, 'active', 25);

  // Chidi: invoice due soon + renewal inside rescue window.
  await seedInvoice(custIds[2]!, '49.00', 3);
  await seedSubscription(custIds[2]!, 'active', 9);

  // Dana: suspended subscription (pre-termination) + overdue invoice.
  await seedInvoice(custIds[3]!, '147.00', -20);
  await seedSubscription(custIds[3]!, 'suspended', -20, 25, 26);

  // Emeka: healthy high-value customer — paid history + several services.
  for (let i = 0; i < 5; i += 1) await seedInvoice(custIds[4]!, '245.00', -30 * (i + 1), true);
  await seedSubscription(custIds[4]!, 'active', 45);
  for (let i = 0; i < 4; i += 1) {
    await db.query(
      `INSERT INTO customer_services (id, user_id, product_id, plan_id, label, status)
       VALUES ($1,$2,$3,$4,$5,'active')`,
      [randomUUID(), custIds[4]!, productId, planId, `Demo VPS ${i + 1}`]
    );
  }

  // Freya: expiring domain + upcoming renewal.
  await db.query(
    `INSERT INTO customer_domains (id, user_id, domain_name, registrar, status, expires_at)
     VALUES ($1,$2,'freya-demo.example','DemoRegistrar','active', CURRENT_DATE + 12)`,
    [randomUUID(), custIds[5]!, ]
  );
  await seedSubscription(custIds[5]!, 'active', 30);

  // Staff ownership.
  const actor = { userId: adminId };
  await assignCustomer(db, { customerId: custIds[0]!, staffUserId: staff2, assignmentType: 'collections', reason: 'Demo seed' }, actor);
  await assignCustomer(db, { customerId: custIds[1]!, staffUserId: staff1, assignmentType: 'account_manager', reason: 'Demo seed' }, actor);
  await assignCustomer(db, { customerId: custIds[2]!, staffUserId: staff1, assignmentType: 'account_manager', reason: 'Demo seed' }, actor);
  await assignCustomer(db, { customerId: custIds[4]!, staffUserId: staff1, assignmentType: 'customer_success', reason: 'Demo seed' }, actor);

  // Run the real automation cycle: opens cases, follow-ups, queues notices.
  await runRevenueGuardianCycle(db);

  // Bruno pays half → real partial recovery via ledger reconciliation.
  await db.query(
    `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
     VALUES ($1,$2,$3,'payment',49.00,'USD','Partial payment (demo seed)')`,
    [randomUUID(), custIds[1]!, brunoInv]
  );
  await reconcileRecoveryState(db);

  // A pending promise on Amara's big invoice (assigned to collections).
  await createPaymentPromise(
    db,
    {
      customerId: custIds[0]!,
      invoiceId: amaraInv,
      promisedAmount: '196.00',
      promisedDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      assignedStaffId: staff2,
      notes: 'Customer promised to pay after payday (demo seed)',
    },
    { userId: staff2 }
  );
  // And a broken one on Dana's overdue invoice (dated in the past, seeded directly).
  const danaInv = (await db.query<{ id: string }>(
    `SELECT id FROM invoices WHERE user_id = $1 AND status = 'unpaid' LIMIT 1`,
    [custIds[3]!]
  )).rows[0]!.id;
  await db.query(
    `INSERT INTO revenue_guardian_payment_promises (id, customer_id, invoice_id, promised_amount, currency, promised_date, assigned_staff_id)
     VALUES ($1,$2,$3,'147.00','USD', CURRENT_DATE - 4, $4)`,
    [randomUUID(), custIds[3]!, danaInv, staff2]
  );
  await processPaymentPromises(db);

  // ----------------------------------------------------------------------- Cloudflare demo ---
  await db.query(
    `INSERT INTO cloudflare_accounts (id, account_name, cloudflare_account_id, api_base_url, encrypted_api_token, created_by)
     VALUES ($1,'Demo Reseller Account',$2,'https://api.cloudflare.test/client/v4',$3,$4)`,
    [randomUUID(), mockCf.accountId, encryptApiToken(mockCf.validToken), adminId]
  );
  const cfPlans: Array<[string, string, number, Record<string, boolean>]> = [
    ['Cloudflare Free', 'free', 0, { firewall: false, speed: false }],
    ['Cloudflare Pro', 'pro', 20, {}],
    ['Cloudflare Business', 'business', 200, {}],
  ];
  const cfPlanIds: string[] = [];
  for (const [name, tier, price, entitlements] of cfPlans) {
    const prodId = randomUUID();
    const cfPlanId = randomUUID();
    await db.query(`INSERT INTO products (id, slug, name, product_type, status, visibility) VALUES ($1,$2,$3,'service','active','public')`,
      [prodId, `cf-${tier}`, name]);
    await db.query(`INSERT INTO product_plans (id, product_id, slug, name, status) VALUES ($1,$2,$3,$4,'active')`,
      [cfPlanId, prodId, `cf-${tier}-plan`, name]);
    await db.query(`INSERT INTO plan_pricing (id, plan_id, billing_period, currency, amount, effective_status) VALUES ($1,$2,'monthly','USD',$3,'published')`,
      [randomUUID(), cfPlanId, price]);
    await db.query(
      `INSERT INTO cloudflare_plan_mappings (id, plan_id, cloudflare_plan, entitlements, created_by) VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [randomUUID(), cfPlanId, tier, JSON.stringify(entitlements), adminId]
    );
    cfPlanIds.push(cfPlanId);
  }
  // Emeka buys Cloudflare Pro for a domain; the order settles and the worker provisions it.
  const cfOrder = await createCloudflareOrder(db, custIds[4]!, { planId: cfPlanIds[1]!, billingPeriod: 'monthly', domainName: 'emeka-demo.example' });
  await withTransaction(db, async (tx) => {
    await tx.query(`UPDATE orders SET payment_status='paid', status='completed' WHERE id=$1`, [cfOrder.order.id]);
    await tx.query(`UPDATE invoices SET status='paid' WHERE order_id=$1`, [cfOrder.order.id]);
    await tx.query(
      `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
       SELECT $1, $2, i.id, 'payment', i.total_amount, i.currency, 'Payment received (demo seed)' FROM invoices i WHERE i.order_id = $3`,
      [randomUUID(), custIds[4]!, cfOrder.order.id]
    );
    const { rows } = await tx.query<import('../src/db/orders').OrderRow>(`SELECT * FROM orders WHERE id=$1`, [cfOrder.order.id]);
    await provisionPaidOrder(tx, rows[0]!);
  });
  mockCf.records.set('r-demo-txt', { id: 'r-demo-txt', zoneId: '', type: 'TXT', name: 'emeka-demo.example', content: 'v=spf1 -all', ttl: 1, proxied: false } as never);
  await sweepCloudflareJobs(db, 'preview-worker');
  // Attach the pre-seeded TXT record to the created zone and sync once so DNS shows data.
  const zoneEntry = [...mockCf.zones.values()][0];
  if (zoneEntry) {
    mockCf.records.set('r-demo-txt', { id: 'r-demo-txt', zoneId: zoneEntry.id, type: 'TXT', name: 'emeka-demo.example', content: 'v=spf1 -all', ttl: 1, proxied: false } as never);
    zoneEntry.status = 'active';
    const { rows: cfsvc } = await db.query<{ id: string }>(`SELECT id FROM cloudflare_services LIMIT 1`);
    if (cfsvc[0]) {
      await db.query(`INSERT INTO cloudflare_jobs (id, cloudflare_service_id, job_type) VALUES ($1,$2,'sync_zone')`, [randomUUID(), cfsvc[0].id]);
      await sweepCloudflareJobs(db, 'preview-worker');
    }
  }

  // ------------------------------------------------------------------------------ serve ---
  const app = buildApp(env, {
    serveFrontend: true,
    publicDir: path.join(process.cwd(), 'public'),
    pool: db as never,
  });
  await app.listen({ port: 3000, host: '0.0.0.0' });

  // Keep automation honest in the preview too: re-run the cycles periodically.
  setInterval(() => void runRevenueGuardianCycle(db).catch(() => undefined), 5 * 60_000);
  setInterval(() => void sweepCloudflareJobs(db, 'preview-worker').catch(() => undefined), 30_000);

  // eslint-disable-next-line no-console
  console.log('\nRevenue Guardian demo preview ready on http://0.0.0.0:3000');
  // eslint-disable-next-line no-console
  console.log('Cloudflare module: /admin/cloudflare (admin) and /services/cloudflare (as emeka@demo-customer.test).');
  console.log('NOTE: this preview talks to a SIMULATED Cloudflare endpoint (dev-only); production uses the real API.');
  console.log(`Logins (password "${PASSWORD}"):
  root@demo.cloudhost247.test   (super_admin — includes write-off)
  admin@demo.cloudhost247.test  (admin)
  staff@demo.cloudhost247.test  (staff — portfolio-scoped)
  amara@demo-customer.test      (customer — see /account revenue health API)`);
  void rootId;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
