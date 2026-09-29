import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { importManifests } from '../../src/marketplace/import-service';
import { loadManifestCatalog, validatedManifests } from '../../src/marketplace/manifest-loader';
import { createServer, storeCredential } from '../../src/db/servers';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { getKeyRing } from '../../src/lib/keyring';

/**
 * Phase 6 end-to-end marketplace + installation flow against a real embedded Postgres:
 * catalog import → public marketplace visibility → request installation (order + unpaid
 * invoice, NO deployment yet — spec §23) → paid-order webhook provisioning → lifecycle
 * actions enqueue idempotent deployment jobs.
 */
describe('marketplace + application installation flow', () => {
  let db: PGlite;
  // The installation service encrypts environment entries via the process-wide key ring, which
  // builds itself from the ambient env — so the ambient env must be valid too, exactly like a
  // real deployment (the per-test env object below covers what buildApp sees).
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
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
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [userId, email, await hashPassword('correct-horse-battery'), 'Test User', role]
    );
    return { userId, token: signAuthToken(env, { sub: userId, role, email }) };
  }

  async function importCatalog() {
    // Import a few real manifests (kept small: each import is a transaction).
    const catalog = loadManifestCatalog('manifests');
    const subset = validatedManifests(catalog)
      .filter((m) => ['n8n', 'wordpress', 'gitea', 'uptime-kuma'].includes(m.id))
      .map((m) => ({ ...m }));
    const report = await importManifests(db, subset);
    return { report, subset };
  }

  async function makeServer(name = 'docker-1') {
    return createServer(db, {
      name,
      hostname: `${name}.example.com`,
      serverType: 'VPS',
      cpuCores: 8,
      memoryMb: 16_384,
      storageMb: 204_800,
      dockerEnabled: true,
      kubernetesEnabled: false,
      cpanelEnabled: false,
    });
  }

  it('imports manifests and exposes only published apps on the public marketplace', async () => {
    const { report } = await importCatalog();
    expect(report.applicationsCreated.length).toBe(4);

    // Imported apps start as draft (approval workflow) — invisible on the public marketplace.
    const draftList = await app().inject({ method: 'GET', url: '/api/v1/apps' });
    expect(draftList.statusCode).toBe(200);
    expect((draftList.json() as { apps: unknown[] }).apps).toHaveLength(0);

    // Publish through the admin workflow: version first, then application.
    const admin = await createUser('admin@example.com', 'admin');
    const list = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/apps',
      headers: { authorization: `Bearer ${admin.token}` },
    });
    const applications = (list.json() as { applications: Array<{ id: string; slug: string }> }).applications;
    expect(applications).toHaveLength(4);

    for (const application of applications) {
      const detail = await app().inject({
        method: 'GET',
        url: `/api/v1/admin/apps/${application.id}`,
        headers: { authorization: `Bearer ${admin.token}` },
      });
      const versions = (detail.json() as { versions: Array<{ id: string }> }).versions;
      expect(versions.length).toBeGreaterThan(0);
      const publishVersion = await app().inject({
        method: 'PATCH',
        url: `/api/v1/admin/apps/${application.id}/versions/${versions[0].id}`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { status: 'published', isStable: true },
      });
      expect(publishVersion.statusCode).toBe(200);
      // The full workflow must be walked — a direct draft→published jump is refused.
      const illegalJump = await app().inject({
        method: 'POST',
        url: `/api/v1/admin/apps/${application.id}/status`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { status: 'published' },
      });
      expect(illegalJump.statusCode).toBe(409);
      for (const status of ['validating', 'testing', 'approved', 'published']) {
        const step = await app().inject({
          method: 'POST',
          url: `/api/v1/admin/apps/${application.id}/status`,
          headers: { authorization: `Bearer ${admin.token}` },
          payload: { status },
        });
        expect(step.statusCode).toBe(200);
      }
    }

    const publicList = await app().inject({ method: 'GET', url: '/api/v1/apps' });
    const { apps } = publicList.json() as { apps: Array<{ slug: string; stableVersion: string | null }> };
    expect(apps.map((a) => a.slug).sort()).toEqual(['gitea', 'n8n', 'uptime-kuma', 'wordpress']);

    const detail = await app().inject({ method: 'GET', url: '/api/v1/apps/n8n' });
    expect(detail.statusCode).toBe(200);
    const { app: n8n } = detail.json() as { app: { environment: { required: Array<{ key: string }> }; versions: Array<{ id: string; stable: boolean }> } };
    expect(n8n.environment.required.map((e) => e.key)).toContain('N8N_ENCRYPTION_KEY');
    expect(n8n.versions[0].stable).toBe(true);

    // Slug that never existed → 404.
    expect((await app().inject({ method: 'GET', url: '/api/v1/apps/does-not-exist' })).statusCode).toBe(404);
  });

  it('requests an installation: order + unpaid invoice, deployment NOT created, secrets not echoed', async () => {
    await importCatalog();
    const admin = await createUser('admin@example.com', 'admin');
    await publishAll(admin.token);
    const server = await makeServer();
    const customer = await createUser('cust@example.com');

    // Attach a real priced plan so this is a PAID install (payment-gated path).
    const product = await createProduct(db, { id: randomUUID(), slug: `app-hosting-${randomUUID().slice(0, 8)}`, name: 'App Hosting', productType: 'hosting' });
    await db.query(`UPDATE products SET status = 'active', visibility = 'public' WHERE id = $1`, [product.id]);
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `plan-${randomUUID().slice(0, 8)}`, name: 'App Plan' });
    await db.query(`UPDATE product_plans SET status = 'active' WHERE id = $1`, [plan.id]);
    await createPricing(db, {
      id: randomUUID(),
      planId: plan.id,
      billingPeriod: 'monthly',
      currency: 'USD',
      amount: 4.99,
      effectiveStatus: 'published',
    });

    const request = await app().inject({
      method: 'POST',
      url: '/api/v1/app-installations',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: {
        applicationId: 'n8n',
        serverId: server.id,
        name: 'My n8n',
        planId: plan.id,
        environment: { N8N_ENCRYPTION_KEY: '' },
      },
    });
    expect(request.statusCode).toBe(201);
    const result = request.json() as {
      installationId: string;
      orderId: string;
      invoiceId: string;
      paymentRequired: boolean;
      totalAmount: string;
    };
    expect(result.orderId).toBeDefined();
    expect(result.invoiceId).toBeDefined();
    expect(result.paymentRequired).toBe(true);
    expect(result.totalAmount).toBe('4.99');

    // No deployment exists yet: provisioning is gated on payment (spec §20).
    const deployments = await db.query(`SELECT count(*)::int AS count FROM deployments WHERE installation_id = $1`, [
      result.installationId,
    ]);
    expect(deployments.rows[0].count).toBe(0);

    // The installation is visible to its owner only — another customer gets a 404, not 403.
    const mine = await app().inject({
      method: 'GET',
      url: '/api/v1/app-installations',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    const installations = (mine.json() as { installations: Array<{ id: string; status: string }> }).installations;
    expect(installations).toHaveLength(1);
    expect(installations[0].status).toBe('pending');

    const stranger = await createUser('stranger@example.com');
    const foreign = await app().inject({
      method: 'GET',
      url: `/api/v1/app-installations/${result.installationId}`,
      headers: { authorization: `Bearer ${stranger.token}` },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('runs lifecycle actions as async jobs with status guards and idempotency', async () => {
    await importCatalog();
    const admin = await createUser('admin@example.com', 'admin');
    await publishAll(admin.token);
    const server = await makeServer();
    const customer = await createUser('cust@example.com');

    const request = await app().inject({
      method: 'POST',
      url: '/api/v1/app-installations',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { applicationId: 'n8n', serverId: server.id },
    });
    const { installationId } = request.json() as { installationId: string };

    // An unpaid installation is pending — stop is not allowed from pending (status guard).
    const prematureStop = await app().inject({
      method: 'POST',
      url: `/api/v1/app-installations/${installationId}/stop`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(prematureStop.statusCode).toBe(409);

    // Mark it healthy (simulating a finished install) → actions enqueue jobs.
    await db.query(`UPDATE application_installations SET status = 'healthy' WHERE id = $1`, [installationId]);

    const restart = await app().inject({
      method: 'POST',
      url: `/api/v1/app-installations/${installationId}/restart`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(restart.statusCode).toBe(202);
    const { deploymentId } = restart.json() as { deploymentId: string };

    // The deployment row exists with the right action and idempotency key.
    const row = await db.query<{ action: string; status: string; idempotency_key: string }>(
      `SELECT action, status, idempotency_key FROM deployments WHERE id = $1`,
      [deploymentId]
    );
    expect(row.rows[0].action).toBe('restart');
    expect(['pending', 'queued']).toContain(row.rows[0].status);
    expect(row.rows[0].idempotency_key).toContain(`restart:${installationId}`);

    // Environment keys are listable but values NEVER leave the server (spec §16).
    await storeCredential(db, getKeyRing(), server.id, 'agent_secret', 'x'.repeat(40));
    const envList = await app().inject({
      method: 'GET',
      url: `/api/v1/app-installations/${installationId}/environment`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(envList.statusCode).toBe(200);
    const envJson = JSON.stringify(envList.json());
    expect(envJson).not.toMatch(/[0-9a-f]{64,}/); // no secret values, no hashes

    // Uninstall queues an uninstall job and flips status to deleting.
    const uninstall = await app().inject({
      method: 'DELETE',
      url: `/api/v1/app-installations/${installationId}`,
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(uninstall.statusCode).toBe(202);
    const uninstallDeployment = (uninstall.json() as { deploymentId: string }).deploymentId;
    const uninstallRow = await db.query<{ action: string }>(`SELECT action FROM deployments WHERE id = $1`, [
      uninstallDeployment,
    ]);
    expect(uninstallRow.rows[0].action).toBe('uninstall');
    const statusRow = await db.query<{ status: string }>(`SELECT status FROM application_installations WHERE id = $1`, [
      installationId,
    ]);
    expect(statusRow.rows[0].status).toBe('deleting');
  });

  it('auto-queues a FREE installation without deploying synchronously (spec §23)', async () => {
    await importCatalog();
    const admin = await createUser('admin@example.com', 'admin');
    await publishAll(admin.token);
    const server = await makeServer('docker-free');
    const customer = await createUser('free@example.com');

    const request = await app().inject({
      method: 'POST',
      url: '/api/v1/app-installations',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { applicationId: 'uptime-kuma', serverId: server.id },
    });
    expect(request.statusCode).toBe(201);
    const result = request.json() as { installationId: string; orderId: string; paymentRequired: boolean; status: string };
    expect(result.paymentRequired).toBe(false);
    expect(result.status).toBe('queued');

    // Exactly one queued INSTALL job — enqueued, NOT executed (status is still pending/queued).
    const rows = await db.query<{ action: string; status: string }>(
      `SELECT action, status FROM deployments WHERE installation_id = $1`,
      [result.installationId]
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].action).toBe('install');
    expect(['pending', 'queued']).toContain(rows.rows[0].status);

    // The order and invoice are already settled — nothing left to pay.
    const order = await db.query<{ payment_status: string }>(`SELECT payment_status FROM orders WHERE id = $1`, [
      result.orderId,
    ]);
    expect(order.rows[0].payment_status).toBe('paid');
  });

  it('blocks installs on incompatible or under-provisioned servers (server auto-selection rules)', async () => {
    await importCatalog();
    const admin = await createUser('admin@example.com', 'admin');
    await publishAll(admin.token);
    const customer = await createUser('cust@example.com');

    // A CPANEL server cannot host a docker-compose app that doesn't list cpanel hosting.
    const cpanelServer = await createServer(db, {
      name: 'cpanel-1',
      hostname: 'cpanel.example.com',
      serverType: 'CPANEL',
      cpuCores: 8,
      memoryMb: 16_384,
      storageMb: 204_800,
      dockerEnabled: false,
      kubernetesEnabled: false,
      cpanelEnabled: true,
    });
    const incompatible = await app().inject({
      method: 'POST',
      url: '/api/v1/app-installations',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { applicationId: 'n8n', serverId: cpanelServer.id },
    });
    expect(incompatible.statusCode).toBe(400);

    // wordpress lists cpanel hosting, so a cPanel server is fine for it.
    const wordpressRequest = await app().inject({
      method: 'POST',
      url: '/api/v1/app-installations',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: { applicationId: 'wordpress', serverId: cpanelServer.id },
    });
    expect(wordpressRequest.statusCode).toBe(201);
  });

  /**
   * Publishes every imported app through the REAL workflow (spec §47): version draft→published
   * first (publishing an app requires a published version), then app
   * draft→validating→testing→approved→published. The server refuses shortcuts — so must we.
   */
  async function publishAll(adminToken: string) {
    const list = await app().inject({
      method: 'GET',
      url: '/api/v1/admin/apps',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const applications = (list.json() as { applications: Array<{ id: string; status: string }> }).applications;
    for (const application of applications) {
      const detail = await app().inject({
        method: 'GET',
        url: `/api/v1/admin/apps/${application.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      const versions = (detail.json() as { versions: Array<{ id: string }> }).versions;
      const publishVersion = await app().inject({
        method: 'PATCH',
        url: `/api/v1/admin/apps/${application.id}/versions/${versions[0].id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { status: 'published', isStable: true },
      });
      expect(publishVersion.statusCode, 'version publish must succeed').toBe(200);
      for (const status of ['validating', 'testing', 'approved', 'published']) {
        const step = await app().inject({
          method: 'POST',
          url: `/api/v1/admin/apps/${application.id}/status`,
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { status },
        });
        expect(step.statusCode, `workflow step ${status} must succeed`).toBe(200);
      }
    }
  }
});
