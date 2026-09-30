/**
 * Cloudflare subsystem end-to-end tests: real embedded Postgres (full migration chain), the
 * real Fastify app, the real Cloudflare client — talking to the scripted in-memory Cloudflare
 * (tests/helpers/mock-cloudflare.ts). Covers admin configuration + encryption, billing-gated
 * provisioning + idempotency, worker job execution with retry, DNS CRUD + ownership rules,
 * entitlement + cross-customer authorization, lifecycle, plan change gating, and fail-closed
 * behaviour without configuration.
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
import { buildKeyRing } from '../../src/lib/crypto';
import { setKeyRingForTesting } from '../../src/lib/keyring';
import { setCloudflareTestOverrides } from '../../src/integrations/cloudflare/config';
import { provisionPaidOrder } from '../../src/services/provisioning-service';
import { sweepCloudflareJobs } from '../../src/worker/cloudflare-sweep';
import { withTransaction } from '../../src/db/transaction';
import { MockCloudflare } from '../helpers/mock-cloudflare';

const TEST_KEY = 'a'.repeat(64);

describe('Cloudflare subsystem (/api/v1/cloudflare, /api/v1/admin/cloudflare)', () => {
  let db: PGlite;
  let mock: MockCloudflare;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: TEST_KEY,
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    mock = new MockCloudflare();
    // getKeyRing() derives the ring from process.env (see src/lib/keyring.ts), so the key must
    // exist there for route-level encryption; the injected ring covers direct library callers.
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/cloudhost247';
    process.env.JWT_SECRET = 'g'.repeat(32);
    process.env.CREDENTIAL_ENCRYPTION_KEY = TEST_KEY;
    setKeyRingForTesting(buildKeyRing(TEST_KEY, undefined));
    setCloudflareTestOverrides({ fetchImpl: mock.fetch, sleep: () => Promise.resolve() });
  });

  afterEach(async () => {
    setCloudflareTestOverrides(null);
    setKeyRingForTesting(null);
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(email: string, role: 'customer' | 'admin' | 'super_admin' = 'customer') {
    const id = randomUUID();
    const hash = await hashPassword('password12345');
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [
      id, email, hash, `User ${email}`, role,
    ]);
    return { id, email, role, token: signAuthToken(env, { sub: id, email, role }) };
  }

  /** Catalog: a Cloudflare product with a plan + published monthly pricing. */
  async function createCloudflarePlan(name: string, amount: number) {
    const productId = randomUUID();
    const planId = randomUUID();
    await db.query(
      `INSERT INTO products (id, slug, name, product_type, status, visibility) VALUES ($1,$2,$3,'service','active','public')`,
      [productId, `cf-${name.toLowerCase()}-${randomUUID().slice(0, 6)}`, `Cloudflare ${name}`]
    );
    await db.query(`INSERT INTO product_plans (id, product_id, slug, name, status) VALUES ($1,$2,$3,$4,'active')`, [
      planId, productId, `cf-plan-${randomUUID().slice(0, 6)}`, name,
    ]);
    await db.query(
      `INSERT INTO plan_pricing (id, plan_id, billing_period, currency, amount, effective_status)
       VALUES ($1,$2,'monthly','USD',$3,'published')`,
      [randomUUID(), planId, amount]
    );
    return { productId, planId };
  }

  async function configureAccount(app: ReturnType<typeof buildTestApp>, adminToken: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/cloudflare/accounts',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { accountName: 'Main', cloudflareAccountId: mock.accountId, apiToken: mock.validToken, apiBaseUrl: 'https://api.cloudflare.test/client/v4' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().account as { id: string };
  }

  async function mapPlan(app: ReturnType<typeof buildTestApp>, adminToken: string, planId: string, cloudflarePlan: string, entitlements: Record<string, boolean> = {}) {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/cloudflare/plan-mappings',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { planId, cloudflarePlan, entitlements },
    });
    expect(res.statusCode).toBe(200);
  }

  /** Places a Cloudflare order via the API, then settles it exactly like the payment webhook. */
  async function orderAndPay(app: ReturnType<typeof buildTestApp>, customer: { id: string; token: string }, planId: string, domainName: string) {
    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cloudflare/orders',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { planId, billingPeriod: 'monthly', domainName },
    });
    expect(orderRes.statusCode).toBe(201);
    const orderId = orderRes.json().order.id as string;
    await settleOrder(orderId, customer.id);
    return orderId;
  }

  async function settleOrder(orderId: string, userId: string) {
    await withTransaction(db, async (tx) => {
      await tx.query(`UPDATE orders SET payment_status = 'paid', status = 'completed', updated_at = now() WHERE id = $1`, [orderId]);
      await tx.query(`UPDATE invoices SET status = 'paid', updated_at = now() WHERE order_id = $1`, [orderId]);
      const { rows } = await tx.query<{ total_amount: string; currency: string; invoice_id: string }>(
        `SELECT o.total_amount, o.currency, i.id AS invoice_id FROM orders o JOIN invoices i ON i.order_id = o.id WHERE o.id = $1`,
        [orderId]
      );
      const order = rows[0]!;
      if (Number(order.total_amount) > 0) {
        await tx.query(
          `INSERT INTO billing_ledger (id, user_id, invoice_id, entry_type, amount, currency, description)
           VALUES ($1,$2,$3,'payment',$4,$5,'Test settlement')`,
          [randomUUID(), userId, order.invoice_id, order.total_amount, order.currency]
        );
      }
      const { rows: orderRows } = await tx.query<import('../../src/db/orders').OrderRow>(`SELECT * FROM orders WHERE id = $1`, [orderId]);
      await provisionPaidOrder(tx, orderRows[0]!, randomUUID);
    });
  }

  // ------------------------------------------------------------------ admin config & RBAC ---

  it('admin configures the account with an encrypted, never-returned token; connection test verifies against Cloudflare', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin@example.com', 'admin');
    const customer = await createUser('nosy@example.com', 'customer');

    // RBAC: customers cannot touch admin cloudflare routes.
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/cloudflare', headers: { authorization: `Bearer ${customer.token}` } })).statusCode).toBe(403);

    const account = await configureAccount(app, admin.token);

    // Token is encrypted at rest — the DB row never contains the plaintext.
    const stored = await db.query<{ encrypted_api_token: string }>(`SELECT encrypted_api_token FROM cloudflare_accounts WHERE id = $1`, [account.id]);
    expect(stored.rows[0]!.encrypted_api_token).not.toContain(mock.validToken);
    expect(stored.rows[0]!.encrypted_api_token).toMatch(/^v\d+:/);

    // No API response ever includes the token.
    const listRes = await app.inject({ method: 'GET', url: '/api/v1/admin/cloudflare/accounts', headers: { authorization: `Bearer ${admin.token}` } });
    expect(JSON.stringify(listRes.json())).not.toContain(mock.validToken);
    expect(listRes.json().accounts[0].has_token).toBe(true);

    const testRes = await app.inject({ method: 'POST', url: `/api/v1/admin/cloudflare/accounts/${account.id}/test`, headers: { authorization: `Bearer ${admin.token}` } });
    expect(testRes.json().status).toBe('CONNECTED');
    expect(testRes.json().accountName).toBe('Mock Account');
    expect(testRes.json().permissions).toContain('DNS Write');
    await app.close();
  });

  it('connection test reports AUTH_FAILED for rejected credentials — never fabricated success', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin2@example.com', 'admin');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/cloudflare/accounts',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { accountName: 'Bad', cloudflareAccountId: 'acc', apiToken: 'wrong-token-value', apiBaseUrl: 'https://api.cloudflare.test/client/v4' },
    });
    const accountId = res.json().account.id;
    const testRes = await app.inject({ method: 'POST', url: `/api/v1/admin/cloudflare/accounts/${accountId}/test`, headers: { authorization: `Bearer ${admin.token}` } });
    expect(testRes.json().status).toBe('AUTH_FAILED');
    await app.close();
  });

  it('fails closed with CONFIGURATION_REQUIRED when no account is configured (spec §67)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin3@example.com', 'admin');
    const customer = await createUser('cust3@example.com', 'customer');
    const { planId } = await createCloudflarePlan('Free', 0);
    await mapPlan(app, admin.token, planId, 'free');
    await orderAndPay(app, customer, planId, 'unconfigured.example');

    // Worker runs the provisioning job — it retries (config may be mid-setup), never fakes success.
    const report = await sweepCloudflareJobs(db, 'w1');
    expect(report.claimed).toBe(1);
    expect(report.retrying).toBe(1);
    const service = await db.query<{ status: string; zone_id: string | null }>(`SELECT status, zone_id FROM cloudflare_services`);
    expect(service.rows[0]!.status).not.toBe('active');
    expect(service.rows[0]!.zone_id).toBeNull();
    await app.close();
  });

  // -------------------------------------------------- billing-gated provisioning pipeline ---

  it('standalone order: checkout → payment → provisioning job → zone created → ACTIVE, idempotently', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin4@example.com', 'admin');
    const customer = await createUser('buyer@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { planId } = await createCloudflarePlan('Pro', 20);
    await mapPlan(app, admin.token, planId, 'pro');

    const orderId = await orderAndPay(app, customer, planId, 'shop.example');

    // Before the worker runs, the service exists but is NOT active (spec §68).
    let rows = await db.query<{ id: string; status: string }>(`SELECT id, status FROM cloudflare_services`);
    expect(rows.rows[0]!.status).toBe('pending');

    // Duplicate webhook settlement: nothing new is created (idempotency, spec §42).
    await settleOrder(orderId, customer.id);
    rows = await db.query(`SELECT id, status FROM cloudflare_services`);
    expect(rows.rows).toHaveLength(1);
    const jobs = await db.query(`SELECT id FROM cloudflare_jobs WHERE job_type = 'provision_zone'`);
    expect(jobs.rows).toHaveLength(1);

    const report = await sweepCloudflareJobs(db, 'w1');
    expect(report.succeeded).toBe(1);

    const serviceRes = await app.inject({
      method: 'GET',
      url: `/api/v1/cloudflare/services/${rows.rows[0]!.id}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    const body = serviceRes.json();
    expect(body.service.status).toBe('active');
    expect(body.service.zone_id).toMatch(/^z-/);
    expect(body.service.cloudflare_plan).toBe('pro');
    expect(body.nameservers).toEqual(['ada.ns.cloudflare.com', 'bob.ns.cloudflare.com']);
    expect(body.service.activation_status).toBe('pending_nameserver_update'); // zone is pending until CF confirms
    expect(mock.planChanges).toEqual([{ zoneId: body.service.zone_id, ratePlan: 'pro' }]);

    // Re-running provisioning reuses the zone (search-then-create) — no duplicates.
    const zoneCount = mock.zones.size;
    await db.query(`INSERT INTO cloudflare_jobs (id, cloudflare_service_id, job_type) VALUES ($1,$2,'provision_zone')`, [
      randomUUID(), rows.rows[0]!.id,
    ]);
    await sweepCloudflareJobs(db, 'w1');
    expect(mock.zones.size).toBe(zoneCount);
    await app.close();
  });

  it('provisioning failure marks the service PROVISIONING_FAILED after retries — never ACTIVE (spec §65)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin5@example.com', 'admin');
    const customer = await createUser('failbuyer@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { planId } = await createCloudflarePlan('Free', 0);
    await mapPlan(app, admin.token, planId, 'free');
    await orderAndPay(app, customer, planId, 'doomed.example');

    // Every zone call fails permission-denied (non-retryable).
    mock.failNext((m, p) => p === '/zones', 403, 9109, 'token lacks Zone Write', 99);
    const report = await sweepCloudflareJobs(db, 'w1');
    expect(report.failed).toBe(1);
    const service = await db.query<{ status: string; last_error_code: string | null }>(
      `SELECT status, last_error_code FROM cloudflare_services`
    );
    expect(service.rows[0]!.status).toBe('provisioning_failed');
    expect(service.rows[0]!.last_error_code).toBe('CLOUDFLARE_PERMISSION_DENIED');
    await app.close();
  });

  it('unpaid orders never provision anything (spec §68)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin6@example.com', 'admin');
    const customer = await createUser('unpaid@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { planId } = await createCloudflarePlan('Pro', 20);
    await mapPlan(app, admin.token, planId, 'pro');

    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cloudflare/orders',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { planId, billingPeriod: 'monthly', domainName: 'unpaid.example' },
    });
    expect(orderRes.statusCode).toBe(201);

    // No settlement → no service, no job, no zone.
    expect((await db.query(`SELECT id FROM cloudflare_services`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT id FROM cloudflare_jobs`)).rows).toHaveLength(0);
    expect(mock.zones.size).toBe(0);
    await app.close();
  });

  // ----------------------------------------------------------- DNS + ownership + security ---

  async function activeService(app: ReturnType<typeof buildTestApp>, adminToken: string, customer: { id: string; token: string }, domain: string, cfPlan = 'pro', entitlements: Record<string, boolean> = {}) {
    const { planId } = await createCloudflarePlan(`Plan-${domain}`, 15);
    await mapPlan(app, adminToken, planId, cfPlan, entitlements);
    await orderAndPay(app, customer, planId, domain);
    await sweepCloudflareJobs(db, 'w1');
    const { rows } = await db.query<{ id: string; zone_id: string }>(`SELECT id, zone_id FROM cloudflare_services WHERE zone_name = $1`, [domain]);
    return { serviceId: rows[0]!.id, zoneId: rows[0]!.zone_id, planId };
  }

  it('DNS CRUD works through the real client; records are keyed by Cloudflare id; system records are protected', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin7@example.com', 'admin');
    const customer = await createUser('dns@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { serviceId, zoneId } = await activeService(app, admin.token, customer, 'dns.example');
    const headers = { authorization: `Bearer ${customer.token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/cloudflare/services/${serviceId}/dns`,
      headers,
      payload: { type: 'A', name: 'dns.example', content: '203.0.113.10', ttl: 300, proxied: true },
    });
    expect(createRes.statusCode).toBe(201);
    const recordId = createRes.json().record.cloudflare_record_id as string;
    expect(recordId).toMatch(/^r-/);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/cloudflare/services/${serviceId}/dns/${recordId}`,
      headers,
      payload: { content: '203.0.113.99', ttl: 1 },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(mock.records.get(recordId)!.content).toBe('203.0.113.99');

    // System-managed rows cannot be edited/deleted by the customer (spec §44).
    await db.query(
      `INSERT INTO cloudflare_dns_records (id, cloudflare_service_id, cloudflare_record_id, type, name, content, ttl, proxied, ownership)
       VALUES ($1,$2,'r-system','A','dns.example','198.51.100.1',1,true,'SYSTEM_MANAGED')`,
      [randomUUID(), serviceId]
    );
    const sysDel = await app.inject({ method: 'DELETE', url: `/api/v1/cloudflare/services/${serviceId}/dns/r-system`, headers });
    expect(sysDel.statusCode).toBe(400);

    const delRes = await app.inject({ method: 'DELETE', url: `/api/v1/cloudflare/services/${serviceId}/dns/${recordId}`, headers });
    expect(delRes.statusCode).toBe(200);
    expect(mock.records.has(recordId)).toBe(false);

    // Audit trail exists for the destructive operation.
    const audits = await db.query(`SELECT id FROM audit_logs WHERE action = 'cloudflare.dns_record_deleted'`);
    expect(audits.rows).toHaveLength(1);
    void zoneId;
    await app.close();
  });

  it('cross-customer access is impossible even with valid ids (spec §71)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin8@example.com', 'admin');
    const alice = await createUser('alice@example.com', 'customer');
    const mallory = await createUser('mallory@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { serviceId } = await activeService(app, admin.token, alice, 'alice.example');

    const headers = { authorization: `Bearer ${mallory.token}` };
    for (const [method, url, payload] of [
      ['GET', `/api/v1/cloudflare/services/${serviceId}`, undefined],
      ['GET', `/api/v1/cloudflare/services/${serviceId}/dns`, undefined],
      ['POST', `/api/v1/cloudflare/services/${serviceId}/dns`, { type: 'A', name: 'x.alice.example', content: '203.0.113.5', ttl: 300 }],
      ['POST', `/api/v1/cloudflare/services/${serviceId}/caching/purge`, { everything: true }],
      ['GET', `/api/v1/cloudflare/services/${serviceId}/analytics`, undefined],
    ] as const) {
      const res = await app.inject({ method, url, headers, payload: payload as never });
      expect(res.statusCode, `${method} ${url}`).toBe(404); // indistinguishable from nonexistent
    }
    await app.close();
  });

  it('entitlements gate features server-side: firewall disabled by admin → 403 even on a paid tier', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin9@example.com', 'admin');
    const customer = await createUser('gated@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { serviceId } = await activeService(app, admin.token, customer, 'gated.example', 'pro', { firewall: false });
    const headers = { authorization: `Bearer ${customer.token}` };

    const fwRes = await app.inject({ method: 'GET', url: `/api/v1/cloudflare/services/${serviceId}/firewall`, headers });
    expect(fwRes.statusCode).toBe(403);
    expect(fwRes.json().message).toContain('FEATURE_NOT_SUPPORTED');

    // DNS stays available (default entitlement untouched).
    expect((await app.inject({ method: 'GET', url: `/api/v1/cloudflare/services/${serviceId}/dns`, headers })).statusCode).toBe(200);
    await app.close();
  });

  // ------------------------------------------- features: dnssec/ssl/cache/firewall/analytics ---

  it('DNSSEC, SSL, caching, firewall rules, purge, and analytics run against the provider API', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin10@example.com', 'admin');
    const customer = await createUser('featureful@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { serviceId, zoneId } = await activeService(app, admin.token, customer, 'features.example');
    const headers = { authorization: `Bearer ${customer.token}` };

    // DNSSEC
    expect((await app.inject({ method: 'POST', url: `/api/v1/cloudflare/services/${serviceId}/dnssec/enable`, headers })).json().dnssec.status).toBe('active');
    expect(mock.dnssec.get(zoneId)).toBe('active');

    // SSL settings
    const sslPatch = await app.inject({ method: 'PATCH', url: `/api/v1/cloudflare/services/${serviceId}/ssl`, headers, payload: { ssl: 'strict', min_tls_version: '1.2' } });
    expect(sslPatch.statusCode).toBe(200);
    expect(mock.settings.get(zoneId)!['ssl']).toBe('strict');

    // Caching + development mode + purge (URL host validation)
    const cachePatch = await app.inject({ method: 'PATCH', url: `/api/v1/cloudflare/services/${serviceId}/caching`, headers, payload: { development_mode: 'on' } });
    expect(cachePatch.statusCode).toBe(200);
    const badPurge = await app.inject({ method: 'POST', url: `/api/v1/cloudflare/services/${serviceId}/caching/purge`, headers, payload: { files: ['https://other-domain.example/x.css'] } });
    expect(badPurge.statusCode).toBe(400);
    const goodPurge = await app.inject({ method: 'POST', url: `/api/v1/cloudflare/services/${serviceId}/caching/purge`, headers, payload: { files: ['https://features.example/x.css'] } });
    expect(goodPurge.statusCode).toBe(200);
    expect(mock.purges).toHaveLength(1);

    // Firewall rules with CIDR validation
    const badRule = await app.inject({ method: 'POST', url: `/api/v1/cloudflare/services/${serviceId}/firewall/rules`, headers, payload: { value: 'not-an-ip', mode: 'block' } });
    expect(badRule.statusCode).toBe(400);
    const rule = await app.inject({ method: 'POST', url: `/api/v1/cloudflare/services/${serviceId}/firewall/rules`, headers, payload: { value: '198.51.100.0/24', mode: 'managed_challenge', notes: 'test' } });
    expect(rule.statusCode).toBe(201);
    const ruleId = rule.json().rule.id;
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/cloudflare/services/${serviceId}/firewall/rules/${ruleId}`, headers })).statusCode).toBe(200);

    // Analytics from GraphQL — real numbers from the scripted API, no fabrication.
    const analytics = await app.inject({ method: 'GET', url: `/api/v1/cloudflare/services/${serviceId}/analytics?range=7`, headers });
    expect(analytics.json().dataStatus).toBe('OK');
    expect(analytics.json().analytics.totals.requests).toBe(120);
    await app.close();
  });

  // --------------------------------------------------------------- plan change + lifecycle ---

  it('plan upgrades are billing-gated: invoice first, Cloudflare updated only after payment (spec §25)', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin11@example.com', 'admin');
    const customer = await createUser('upgrader@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { serviceId } = await activeService(app, admin.token, customer, 'upgrade.example', 'free');
    const { planId: proPlanId } = await createCloudflarePlan('Pro-Target', 25);
    await mapPlan(app, admin.token, proPlanId, 'pro');
    const headers = { authorization: `Bearer ${customer.token}` };

    const changeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/cloudflare/services/${serviceId}/plan/change`,
      headers,
      payload: { newPlanId: proPlanId, billingPeriod: 'monthly' },
    });
    expect(changeRes.statusCode).toBe(202);
    expect(changeRes.json().mode).toBe('invoice');
    const orderId = changeRes.json().orderId as string;

    // Clicking did NOT change Cloudflare.
    expect(mock.planChanges).toHaveLength(0);
    let service = await db.query<{ cloudflare_plan: string }>(`SELECT cloudflare_plan FROM cloudflare_services WHERE id = $1`, [serviceId]);
    expect(service.rows[0]!.cloudflare_plan).toBe('free');

    // Payment settles → change_plan job queued → worker applies it.
    await settleOrder(orderId, customer.id);
    const report = await sweepCloudflareJobs(db, 'w1');
    expect(report.succeeded).toBe(1);
    service = await db.query(`SELECT cloudflare_plan FROM cloudflare_services WHERE id = $1`, [serviceId]);
    expect(service.rows[0]!.cloudflare_plan).toBe('pro');
    expect(mock.planChanges).toHaveLength(1);
    await app.close();
  });

  it('admin lifecycle: suspend pauses the zone, unsuspend resumes, terminate deletes and cascades locally', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin12@example.com', 'admin');
    const customer = await createUser('lifecycle@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { serviceId, zoneId } = await activeService(app, admin.token, customer, 'lifecycle.example');
    const headers = { authorization: `Bearer ${admin.token}` };

    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/cloudflare/services/${serviceId}/suspend`, headers })).statusCode).toBe(202);
    await sweepCloudflareJobs(db, 'w1');
    expect(mock.zones.get(zoneId)!.paused).toBe(true);
    let svc = await db.query<{ status: string; service_status?: string }>(`SELECT status FROM cloudflare_services WHERE id = $1`, [serviceId]);
    expect(svc.rows[0]!.status).toBe('suspended');
    // Suspended service: feature endpoints refuse (spec §46).
    const dnsRes = await app.inject({ method: 'GET', url: `/api/v1/cloudflare/services/${serviceId}/dns`, headers: { authorization: `Bearer ${customer.token}` } });
    expect(dnsRes.statusCode).toBe(400);

    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/cloudflare/services/${serviceId}/unsuspend`, headers })).statusCode).toBe(202);
    await sweepCloudflareJobs(db, 'w1');
    expect(mock.zones.get(zoneId)!.paused).toBe(false);

    expect((await app.inject({ method: 'POST', url: `/api/v1/admin/cloudflare/services/${serviceId}/terminate`, headers })).statusCode).toBe(202);
    await sweepCloudflareJobs(db, 'w1');
    expect(mock.zones.has(zoneId)).toBe(false);
    svc = await db.query(`SELECT status FROM cloudflare_services WHERE id = $1`, [serviceId]);
    expect(svc.rows[0]!.status).toBe('terminated');
    const cs = await db.query<{ status: string }>(
      `SELECT cs.status FROM customer_services cs JOIN cloudflare_services s ON s.customer_service_id = cs.id WHERE s.id = $1`,
      [serviceId]
    );
    expect(cs.rows[0]!.status).toBe('cancelled');
    await app.close();
  });

  // -------------------------------------------------------------------------------- sync ---

  it('sync reconciles DNS cache and activation status from Cloudflare truth, preserving ownership', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin13@example.com', 'admin');
    const customer = await createUser('syncer@example.com', 'customer');
    await configureAccount(app, admin.token);
    const { serviceId, zoneId } = await activeService(app, admin.token, customer, 'sync.example');

    // Upstream changes made outside the panel: new record appears, zone activates.
    mock.records.set('r-external', { id: 'r-external', zoneId, type: 'TXT', name: 'sync.example', content: 'v=spf1 -all', ttl: 1, proxied: false });
    mock.zones.get(zoneId)!.status = 'active';

    const syncRes = await app.inject({
      method: 'POST',
      url: `/api/v1/cloudflare/services/${serviceId}/sync`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(syncRes.statusCode).toBe(202);
    await sweepCloudflareJobs(db, 'w1');

    const cache = await db.query<{ cloudflare_record_id: string; ownership: string }>(
      `SELECT cloudflare_record_id, ownership FROM cloudflare_dns_records WHERE cloudflare_service_id = $1`,
      [serviceId]
    );
    expect(cache.rows.some((r) => r.cloudflare_record_id === 'r-external' && r.ownership === 'CUSTOMER_MANAGED')).toBe(true);
    const svc = await db.query<{ activation_status: string; last_synced_at: string | null }>(
      `SELECT activation_status, last_synced_at FROM cloudflare_services WHERE id = $1`,
      [serviceId]
    );
    expect(svc.rows[0]!.activation_status).toBe('active');
    expect(svc.rows[0]!.last_synced_at).not.toBeNull();
    await app.close();
  });

  it('admin dashboard aggregates real service/job/log counts and API logs contain no secrets', async () => {
    const app = buildTestApp();
    const admin = await createUser('admin14@example.com', 'admin');
    const customer = await createUser('dash@example.com', 'customer');
    await configureAccount(app, admin.token);
    await activeService(app, admin.token, customer, 'dash.example');
    const headers = { authorization: `Bearer ${admin.token}` };

    const overview = await app.inject({ method: 'GET', url: '/api/v1/admin/cloudflare', headers });
    expect(Number(overview.json().stats.total_services)).toBe(1);
    expect(Number(overview.json().stats.active_services)).toBe(1);

    const logs = await app.inject({ method: 'GET', url: '/api/v1/admin/cloudflare/logs', headers });
    expect(logs.json().total).toBeGreaterThan(0);
    expect(JSON.stringify(logs.json())).not.toContain(mock.validToken);
    await app.close();
  });
});
