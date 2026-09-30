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
import { signPayload } from '../../src/payments/webhook-signing';
import { importManifests } from '../../src/marketplace/import-service';
import { loadManifestCatalog, validatedManifests } from '../../src/marketplace/manifest-loader';
import { createServer } from '../../src/db/servers';
import { createInstallationRequest } from '../../src/services/installation-service';
import { processNextJob } from '../../src/worker/handlers';
import { scheduleHealthChecks, sweepSubscriptions } from '../../src/worker/sweeps';
import { findDeploymentById } from '../../src/db/deployments';
import type { DeploymentAdapter } from '../../src/deployments/adapters/types';

/**
 * The money→infrastructure lifecycle, end to end (spec §20, §21, §52, §53):
 *
 *   request installation (plan-priced) → unpaid invoice, NO deployment
 *   → sandbox payment → verified webhook → provisionPaidOrder
 *   → exactly one install deployment (duplicate webhook cannot double-deploy)
 *   → worker runs it → installation healthy, subscription active
 *   → dunning sweep: period ends → past_due → grace → suspended (installation stopped via the
 *     queue, never synchronously)
 *   → health-check scheduling: one job per bucket, circuit breaker honored
 */
describe('provisioning + subscription dunning lifecycle', () => {
  let db: PGlite;
  const SANDBOX_SECRET = 'sb_secret_provisioning_test';
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
    SANDBOX_GATEWAY_WEBHOOK_SECRET: SANDBOX_SECRET,
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function app() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(email: string, role = 'customer') {
    const userId = randomUUID();
    await db.query(`INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,$5)`, [
      userId,
      email,
      await hashPassword('correct-horse-battery'),
      'Test User',
      role,
    ]);
    return { userId, token: signAuthToken(env, { sub: userId, role, email }) };
  }

  async function seedPricedPlan(amount = 9.99) {
    const product = await createProduct(db, { id: randomUUID(), slug: `app-plan-${randomUUID().slice(0, 8)}`, name: 'App Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status = 'active', visibility = 'public' WHERE id = $1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `plan-${randomUUID().slice(0, 8)}`, name: 'App Plan' });
    await db.query(`UPDATE product_plans SET status = 'active' WHERE id = $1`, [plan.id]);
    await createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', amount, effectiveStatus: 'published' });
    return plan;
  }

  async function seedPublishedApp(slug: string) {
    const catalog = loadManifestCatalog('manifests');
    const manifest = validatedManifests(catalog).find((m) => m.id === slug);
    if (!manifest) throw new Error(`manifest ${slug} missing`);
    await importManifests(db, [manifest]);
    const app = (await db.query<{ id: string }>(`SELECT id FROM applications WHERE slug = $1`, [slug])).rows[0];
    const version = (await db.query<{ id: string }>(`SELECT id FROM application_versions WHERE application_id = $1`, [app.id])).rows[0];
    await db.query(`UPDATE application_versions SET status = 'published' WHERE id = $1`, [version.id]);
    await db.query(`UPDATE applications SET status = 'published' WHERE id = $1`, [app.id]);
    return app.id;
  }

  const ok = { ok: true, code: 'OK', message: 'ok' };
  function stubAdapter(): DeploymentAdapter {
    return {
      kind: 'docker',
      deployApplication: async () => ok,
      destroyApplication: async () => ok,
      startApplication: async () => ok,
      stopApplication: async () => ok,
      restartApplication: async () => ok,
      applicationStatus: async () => ({ ...ok, running: true, health: 'healthy' }),
      applicationLogs: async () => ({ ...ok, logs: '' }),
      runHealthcheck: async () => ({ ...ok, running: true, health: 'healthy' }),
      runBackup: async () => ({ ...ok, archivePath: '/backups/x.tar.gz', sizeBytes: 1, checksum: 'abc' }),
      restoreBackup: async () => ok,
      provisionHosting: async () => ok,
      suspendHosting: async () => ok,
      terminateHosting: async () => ok,
    };
  }

  function workerCtx() {
    return {
      db,
      options: { simulationMode: true, kubernetesEnabled: false, adapterOverride: stubAdapter() },
      workerId: `worker-${randomUUID().slice(0, 6)}`,
    };
  }

  async function countDeployments(installationId: string) {
    const result = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM deployments WHERE installation_id = $1`, [installationId]);
    return Number(result.rows[0].count);
  }

  it('deploys a PAID installation only after the verified webhook, exactly once', async () => {
    const customer = await createUser('paid@example.com');
    const appId = await seedPublishedApp('uptime-kuma');
    const plan = await seedPricedPlan(9.99);
    const server = await createServer(db, {
      name: 'paid-server',
      hostname: 'paid.example.com',
      serverType: 'VPS',
      cpuCores: 8,
      memoryMb: 16_384,
      storageMb: 204_800,
      dockerEnabled: true,
      kubernetesEnabled: false,
      cpanelEnabled: false,
    });

    // 1. Request — creates order + invoice, deploys nothing (spec §20).
    const request = await createInstallationRequest(db, customer.userId, {
      applicationIdOrSlug: appId,
      serverId: server.id,
      planId: plan.id,
    });
    expect(request.paymentRequired).toBe(true);
    expect(await countDeployments(request.installationId)).toBe(0);

    // The engine refuses to install an unpaid order even if a deployment somehow existed.
    const orderRow = (await db.query<{ payment_status: string }>(`SELECT payment_status FROM orders WHERE id = $1`, [request.orderId])).rows[0];
    expect(orderRow.payment_status).toBe('unpaid');

    // 2. Pay through the sandbox gateway + verified webhook (the real payment flow).
    const fastify = app();
    const payRes = await fastify.inject({
      method: 'POST',
      url: `/api/v1/invoices/${request.invoiceId}/payments`,
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { gateway: 'sandbox' },
    });
    expect(payRes.statusCode).toBe(201);
    const payment = (payRes.json() as { payment: { id: string; providerReference: string } }).payment;

    const webhookPayload = JSON.stringify({
      provider: 'sandbox',
      providerReference: payment.providerReference,
      paymentId: payment.id,
      outcome: 'successful',
      amount: request.totalAmount,
      currency: request.currency,
      eventId: `sb_evt_${payment.id}`,
      occurredAt: new Date().toISOString(),
    });
    const hook = await fastify.inject({
      method: 'POST',
      url: '/api/v1/webhooks/sandbox',
      headers: { 'content-type': 'application/json', 'x-sandbox-signature': signPayload(SANDBOX_SECRET, webhookPayload) },
      payload: webhookPayload,
    });
    expect(hook.statusCode).toBe(200);

    // 3. The webhook provisioned: subscription + exactly one install deployment.
    expect(await countDeployments(request.installationId)).toBe(1);
    const subscription = (
      await db.query<{ id: string; status: string; installation_id: string }>(
        `SELECT id, status, installation_id FROM subscriptions WHERE installation_id = $1`,
        [request.installationId]
      )
    ).rows[0];
    expect(subscription.status).toBe('active');

    // 4. A DUPLICATE webhook (retrying payment processors do this) must not double-deploy.
    const duplicate = await fastify.inject({
      method: 'POST',
      url: '/api/v1/webhooks/sandbox',
      headers: { 'content-type': 'application/json', 'x-sandbox-signature': signPayload(SANDBOX_SECRET, webhookPayload) },
      payload: webhookPayload,
    });
    expect(duplicate.statusCode).toBe(200);
    expect(await countDeployments(request.installationId)).toBe(1);

    // 5. The worker installs it; installation becomes healthy.
    const ctx = workerCtx();
    const claimed = await processNextJob(ctx);
    expect(claimed?.action).toBe('install');
    const finished = await findDeploymentById(db, claimed!.id);
    expect(finished?.status).toBe('succeeded');
    const installation = (
      await db.query<{ status: string; health_status: string; subscription_id: string | null }>(
        `SELECT status, health_status, subscription_id FROM application_installations WHERE id = $1`,
        [request.installationId]
      )
    ).rows[0];
    expect(installation.status).toBe('healthy');
    expect(installation.subscription_id).toBe(subscription.id);
    await fastify.close();
  });

  it('dunning sweep: past_due → grace → suspended, stopping the installation via the queue', async () => {
    const customer = await createUser('dunning@example.com');
    const installationId = randomUUID();
    const appId = randomUUID();
    const versionId = randomUUID();
    const server = await createServer(db, {
      name: 'dunning-server',
      hostname: 'dunning.example.com',
      serverType: 'VPS',
      cpuCores: 4,
      memoryMb: 8192,
      storageMb: 102_400,
      dockerEnabled: true,
      kubernetesEnabled: false,
      cpanelEnabled: false,
    });
    await db.query(`INSERT INTO applications (id, slug, name, description, status) VALUES ($1,'dun-app','Dun App','x','published')`, [appId]);
    await db.query(`INSERT INTO application_versions (id, application_id, version, status, manifest) VALUES ($1,$2,'1.0.0','published',$3)`, [
      versionId,
      appId,
      JSON.stringify({ id: 'dun-app', name: 'Dun App', category: 'cms', description: 'x', deployment: { engine: 'docker-compose' }, supportedHostingTypes: ['docker'], requirements: { cpu: 1, memory: 512, storage: 5120 }, services: { app: { image: 'nginx:alpine', port: 80 } }, environment: { required: [], optional: [] }, versions: [] }),
    ]);
    await db.query(
      `INSERT INTO application_installations (id, customer_id, application_id, application_version_id, server_id, name, status, container_project)
       VALUES ($1,$2,$3,$4,$5,$6,'healthy','cduninst')`,
      [installationId, customer.userId, appId, versionId, server.id, 'Dunning App']
    );
    // Tight windows so the test doesn't wait real days; the sweep reads them from settings.
    await db.query(
      `INSERT INTO platform_settings (key, value, description) VALUES
         ('subscription.grace_period_days', '1', 'test grace'), ('subscription.suspend_after_days', '1', 'test suspend')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`
    );
    const plan = await seedPricedPlan(19.99);

    // Active subscription whose period already ended 3 days ago.
    const subscriptionId = randomUUID();
    await db.query(
      `INSERT INTO subscriptions (id, customer_id, plan_id, installation_id, provider, status, current_period_start, current_period_end)
       VALUES ($1,$2,$3,$4,'cloudhost247','active', now() - interval '33 days', now() - interval '3 days')`,
      [subscriptionId, customer.userId, plan.id, installationId]
    );

    // Sweep 1: active → past_due (period ended). No stop job yet.
    await sweepSubscriptions(db);
    let row = (await db.query<{ status: string }>(`SELECT status FROM subscriptions WHERE id = $1`, [subscriptionId])).rows[0];
    expect(row.status).toBe('past_due');
    expect(await countDeployments(installationId)).toBe(0);

    // Sweep 2 once the 1-day grace has elapsed (36h overdue — but the 2-day suspend threshold
    // not yet): past_due → grace_period, still no stop job.
    await db.query(`UPDATE subscriptions SET past_due_since = now() - interval '36 hours' WHERE id = $1`, [subscriptionId]);
    await sweepSubscriptions(db);
    row = (await db.query<{ status: string }>(`SELECT status FROM subscriptions WHERE id = $1`, [subscriptionId])).rows[0];
    expect(row.status).toBe('grace_period');
    expect(await countDeployments(installationId)).toBe(0);

    // Sweep 3 after the suspend window: grace_period → suspended + a queued STOP for the app.
    await db.query(`UPDATE subscriptions SET past_due_since = now() - interval '50 hours' WHERE id = $1`, [subscriptionId]);
    await sweepSubscriptions(db);
    row = (await db.query<{ status: string }>(`SELECT status FROM subscriptions WHERE id = $1`, [subscriptionId])).rows[0];
    expect(row.status).toBe('suspended');
    expect(await countDeployments(installationId)).toBe(1);
    const stopJob = (await db.query<{ action: string; status: string }>(`SELECT action, status FROM deployments WHERE installation_id = $1`, [installationId])).rows[0];
    expect(stopJob.action).toBe('stop');
    expect(['queued', 'pending']).toContain(stopJob.status);
  });

  it('health-check scheduling: one job per installation per bucket, circuit breaker honored', async () => {
    const customer = await createUser('health@example.com');
    const server = await createServer(db, {
      name: 'health-server',
      hostname: 'health.example.com',
      serverType: 'VPS',
      cpuCores: 4,
      memoryMb: 8192,
      storageMb: 102_400,
      dockerEnabled: true,
      kubernetesEnabled: false,
      cpanelEnabled: false,
    });
    const appId = randomUUID();
    const versionId = randomUUID();
    await db.query(`INSERT INTO applications (id, slug, name, description, status) VALUES ($1,'hc-app','HC App','x','published')`, [appId]);
    await db.query(`INSERT INTO application_versions (id, application_id, version, status, manifest) VALUES ($1,$2,'1.0.0','published',$3)`, [
      versionId,
      appId,
      JSON.stringify({ id: 'hc-app', name: 'HC App', category: 'cms', description: 'x', deployment: { engine: 'docker-compose' }, supportedHostingTypes: ['docker'], requirements: { cpu: 1, memory: 512, storage: 5120 }, services: { app: { image: 'nginx:alpine', port: 80 } }, environment: { required: [], optional: [] }, versions: [] }),
    ]);

    async function addInstallation(project: string, extra = '') {
      const id = randomUUID();
      await db.query(
        `INSERT INTO application_installations (id, customer_id, application_id, application_version_id, server_id, name, status, container_project${extra ? ',' + extra : ''})
         VALUES ($1,$2,$3,$4,$5,$6,'healthy',$7${extra ? ', now()' : ''})`,
        [id, customer.userId, appId, versionId, server.id, 'Health App', project]
      );
      return id;
    }

    // Due for a check / checked recently / circuit breaker open (future timestamp).
    const due = await addInstallation('chc-due');
    await addInstallation('chc-recent', 'last_health_check_at');
    await addInstallation('chc-circuit', 'circuit_open_until');
    await db.query(
      `UPDATE application_installations SET circuit_open_until = now() + interval '10 minutes' WHERE container_project = 'chc-circuit'`
    );

    const scheduled = await scheduleHealthChecks(db);
    expect(scheduled).toBe(1); // only the due one

    // Running the scheduler again in the same bucket schedules nothing new (idempotent).
    expect(await scheduleHealthChecks(db)).toBe(0);
    expect(await countDeployments(due)).toBe(1);

    const job = (await db.query<{ action: string; max_attempts: number }>(`SELECT action, max_attempts FROM deployments WHERE installation_id = $1`, [due])).rows[0];
    expect(job.action).toBe('healthcheck');
    expect(job.max_attempts).toBe(1); // probes are cheap and scheduled — no retry storm
  });
});
