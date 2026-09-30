import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createUser } from '../../src/db/users';
import { signAuthToken } from '../../src/lib/jwt';
import { executeServerProvisioning } from '../../src/infrastructure/services/server-provisioner';
import { ProviderError } from '../../src/infrastructure/providers/types';
import type { DeploymentRow } from '../../src/db/deployments';
import type { InfrastructureProviderAdapter, ProviderServer } from '../../src/infrastructure/providers/types';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { findOrderById } from '../../src/db/orders';
import { provisionPaidOrder } from '../../src/services/provisioning-service';

/**
 * Spec §50 — the acceptance flow, executed rather than described.
 *
 * Order → pay → provisioning job → provider → health check → READY → notification, and then the
 * destructive half that the rest of the suite only covered at its edges: a confirmed reinstall to
 * Debian 13 that runs through the queue and actually moves the catalog OS recorded against the
 * server. The reinstall target is re-resolved server-side, so these assertions are what proves the
 * customer's dashboard shows Debian 13 because the provider installed Debian 13 — not because the
 * browser said so.
 */
const UBUNTU_2404 = '20000000-0000-0000-0000-000000000006';
const DEBIAN_13 = '20000000-0000-0000-0000-000000000003';

describe('acceptance: order, provision, then reinstall onto another operating system', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    JWT_SECRET: 'i'.repeat(32),
  } as NodeJS.ProcessEnv);

  const providerId = randomUUID();
  const regionId = randomUUID();
  const ubuntuImageId = randomUUID();
  const debianImageId = randomUUID();
  let userId = '';
  let token = '';
  let serverId = '';

  /** The provider's view of the resource. `imageId` is what the adapter reports as installed. */
  const remote: ProviderServer = {
    id: 'provider-acceptance-1',
    status: 'running',
    name: 'acceptance-vps',
    ipAddress: '203.0.113.42',
    imageId: 'ubuntu-24.04',
    metadata: {},
  };

  /** A stub standing in for a real provider: it records what it was asked to install. */
  function adapterStub(overrides: Partial<InfrastructureProviderAdapter> = {}): InfrastructureProviderAdapter {
    return {
      kind: 'test-only',
      provider: {} as never,
      validateConfiguration: async () => undefined,
      createServer: async () => remote,
      provisionServer: async () => remote,
      findServerByIdempotencyKey: async () => null,
      deleteServer: async () => undefined,
      rebootServer: async () => undefined,
      shutdownServer: async () => undefined,
      startServer: async () => undefined,
      powerOnServer: async () => undefined,
      powerOffServer: async () => undefined,
      getServer: async () => remote,
      getServerStatus: async () => remote,
      getServerIP: async () => remote.ipAddress,
      getAvailableImages: async () => [],
      getImage: async (image) => ({
        id: image.provider_image_id ?? 'image',
        name: image.provider_image_id ?? 'image',
        architecture: image.architecture,
        available: true,
        metadata: {},
      }),
      reinstallServer: async () => remote,
      rebuildServer: async () => remote,
      resizeServer: async () => remote,
      createSnapshot: async () => ({}),
      deleteSnapshot: async () => undefined,
      restoreSnapshot: async () => undefined,
      getConsole: async () => ({}),
      getServerMetrics: async () => ({}),
      healthCheck: async () => ({
        exists: true,
        poweredOn: true,
        ipAddress: remote.ipAddress,
        imageMatches: true,
        providerStatus: 'running',
      }),
      ...overrides,
    };
  }

  /** Agent attestation is the one production gate a deterministic suite cannot satisfy. */
  const healthOptions = { requireAgentHealth: false, tcpCheck: async () => true, pollIntervalMs: 1, healthTimeoutMs: 100 };

  async function deploymentForJob(jobId: string): Promise<DeploymentRow> {
    const { rows } = await db.query<DeploymentRow>(
      `SELECT d.* FROM deployments d JOIN provisioning_jobs j ON j.deployment_id=d.id WHERE j.id=$1`,
      [jobId]
    );
    const deployment = rows[0];
    if (!deployment) throw new Error(`No deployment exists for job ${jobId}`);
    return deployment;
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });

    const user = await createUser(db, {
      id: randomUUID(),
      email: `acceptance-${randomUUID()}@example.com`,
      passwordHash: 'hash',
      fullName: 'Acceptance Customer',
    });
    userId = user.id;
    token = signAuthToken(env, { sub: user.id, role: 'customer', email: user.email });

    const product = await createProduct(db, {
      id: randomUUID(), slug: `compute-${randomUUID()}`, name: 'Acceptance Compute',
      productType: 'hosting', status: 'active', visibility: 'public',
    });
    const plan = await createPlan(db, {
      id: randomUUID(), productId: product.id, slug: `vps-${randomUUID()}`, name: 'Acceptance VPS', status: 'active',
    });
    await createPricing(db, {
      id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', amount: 20, effectiveStatus: 'published',
    });
    planId = plan.id;

    await db.query(`UPDATE operating_system_versions SET status='ACTIVE' WHERE id = ANY($1::uuid[])`, [[UBUNTU_2404, DEBIAN_13]]);
    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Acceptance provider',$2,'OTHER','generic_http','ACTIVE')`,
      [providerId, `acceptance-${providerId}`]
    );
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'acc-1','Acceptance Region','ACTIVE')`,
      [regionId, providerId]
    );
    // Both mappings are live-verified: an unverified mapping is rejected by the schema itself.
    for (const [imageId, versionId, providerImage] of [
      [ubuntuImageId, UBUNTU_2404, 'ubuntu-24.04'],
      [debianImageId, DEBIAN_13, 'debian-13'],
    ] as const) {
      await db.query(
        `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at)
         VALUES($1,$2,$3,$4,'x86_64',$5,'ACTIVE',now())`,
        [imageId, providerId, versionId, providerImage, regionId]
      );
      await db.query(
        `INSERT INTO server_product_configurations(id,plan_id,provider_id,region_id,operating_system_version_id,architecture,server_type,status,metadata)
         VALUES($1,$2,$3,$4,$5,'x86_64','VPS','ACTIVE',$6)`,
        [randomUUID(), plan.id, providerId, regionId, versionId, JSON.stringify({
          cpuCores: 2, memoryMb: 4096, storageMb: 80000, providerServerType: 'acc-small',
          capabilities: { start: true, stop: true, reboot: true, shutdown: true, reinstall: true },
        })]
      );
    }
    sshKeyId = randomUUID();
    await db.query(
      `INSERT INTO customer_ssh_keys(id,user_id,name,public_key,fingerprint) VALUES($1,$2,'Acceptance key','ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAcceptance tests@example.test',$3)`,
      [sshKeyId, user.id, `SHA256:${randomUUID()}`]
    );
  });

  let planId = '';
  let sshKeyId = '';

  afterAll(async () => {
    await db.close();
  });

  it('orders, takes payment, provisions Ubuntu 24.04 through the queue and notifies the customer', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const ordered = await app.inject({
      method: 'POST', url: '/api/v1/servers', headers: { authorization: `Bearer ${token}` },
      payload: {
        planId, billingPeriod: 'monthly', providerId, regionId, datacenterId: null,
        operatingSystemVersionId: UBUNTU_2404, architecture: 'x86_64', serverType: 'VPS',
        sshKeyIds: [sshKeyId], hostname: 'acceptance.example.test',
      },
    });
    expect(ordered.statusCode).toBe(201);
    const body = ordered.json();
    serverId = body.serverId;
    expect(body.provisioningStatus).toBe('AWAITING_PAYMENT');

    // Nothing is provisioned on the strength of an order alone.
    expect((await db.query<{ count: number }>(`SELECT count(*)::int count FROM provisioning_jobs WHERE server_id=$1`, [serverId])).rows[0]?.count).toBe(0);

    await db.query(`UPDATE orders SET payment_status='paid' WHERE id=$1`, [body.orderId]);
    const paid = await findOrderById(db, body.orderId);
    await provisionPaidOrder(db, paid!);

    const job = (await db.query<{ id: string; operation: string }>(`SELECT id,operation FROM provisioning_jobs WHERE server_id=$1`, [serverId])).rows[0]!;
    expect(job.operation).toBe('PROVISION');

    const outcome = await executeServerProvisioning(db, await deploymentForJob(job.id), { adapterOverride: adapterStub(), ...healthOptions });
    expect(outcome.outcome).toBe('succeeded');

    const server = (await db.query<{ status: string; provisioning_status: string; ip_address: string; operating_system_version_id: string; os_image_id: string }>(
      `SELECT status,provisioning_status,ip_address,operating_system_version_id,os_image_id FROM servers WHERE id=$1`, [serverId]
    )).rows[0];
    expect(server).toEqual({
      status: 'active', provisioning_status: 'READY', ip_address: '203.0.113.42',
      operating_system_version_id: UBUNTU_2404, os_image_id: ubuntuImageId,
    });
    const notified = await db.query<{ type: string }>(`SELECT type FROM user_notifications WHERE user_id=$1 AND resource_id=$2`, [userId, serverId]);
    expect(notified.rows.map((row) => row.type)).toContain('SERVER_READY');
    await app.close();
  });

  it('refuses a reinstall that is not explicitly confirmed, and one requested by another customer', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const unconfirmed = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/reinstall`, headers: { authorization: `Bearer ${token}` },
      payload: { operatingSystemVersionId: DEBIAN_13, architecture: 'x86_64' },
    });
    expect(unconfirmed.statusCode).toBe(400);

    const architectureChange = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/reinstall`, headers: { authorization: `Bearer ${token}` },
      payload: { operatingSystemVersionId: DEBIAN_13, architecture: 'arm64', confirmation: 'REINSTALL' },
    });
    expect(architectureChange.statusCode).toBe(400);
    expect(architectureChange.json().message).toContain('cannot change the server architecture');

    const intruder = await createUser(db, { id: randomUUID(), email: `intruder-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Intruder' });
    const stolen = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/reinstall`,
      headers: { authorization: `Bearer ${signAuthToken(env, { sub: intruder.id, role: 'customer', email: intruder.email })}` },
      payload: { operatingSystemVersionId: DEBIAN_13, architecture: 'x86_64', confirmation: 'REINSTALL' },
    });
    expect(stolen.statusCode).toBe(404);

    // Neither rejected attempt may leave a job behind or disturb the installed OS.
    expect((await db.query<{ count: number }>(`SELECT count(*)::int count FROM provisioning_jobs WHERE server_id=$1 AND operation='REINSTALL'`, [serverId])).rows[0]?.count).toBe(0);
    expect((await db.query<{ v: string }>(`SELECT operating_system_version_id v FROM servers WHERE id=$1`, [serverId])).rows[0]?.v).toBe(UBUNTU_2404);
    await app.close();
  });

  it('reinstalls onto Debian 13 after confirmation and records the new operating system', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const requested = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/reinstall`, headers: { authorization: `Bearer ${token}` },
      payload: { operatingSystemVersionId: DEBIAN_13, architecture: 'x86_64', confirmation: 'REINSTALL' },
    });
    expect(requested.statusCode).toBe(200);
    const jobId = requested.json().jobId;

    // The job carries the resolved provider mapping, never a client-supplied image reference.
    const job = (await db.query<{ operation: string; os_image_id: string; status: string }>(
      `SELECT operation,os_image_id,status FROM provisioning_jobs WHERE id=$1`, [jobId]
    )).rows[0];
    expect(job?.operation).toBe('REINSTALL');
    expect(job?.os_image_id).toBe(debianImageId);

    let installed = '';
    const outcome = await executeServerProvisioning(db, await deploymentForJob(jobId), {
      adapterOverride: adapterStub({
        reinstallServer: async (input) => {
          installed = input.image.provider_image_id ?? '';
          return { ...remote, imageId: 'debian-13' };
        },
      }),
      ...healthOptions,
    });
    expect(outcome.outcome).toBe('succeeded');
    expect(installed).toBe('debian-13');

    const server = (await db.query<{ status: string; provisioning_status: string; operating_system_version_id: string; os_image_id: string }>(
      `SELECT status,provisioning_status,operating_system_version_id,os_image_id FROM servers WHERE id=$1`, [serverId]
    )).rows[0];
    expect(server).toEqual({
      status: 'active', provisioning_status: 'READY',
      operating_system_version_id: DEBIAN_13, os_image_id: debianImageId,
    });

    // What the customer's dashboard reads back is the catalog OS, resolved by join.
    const dashboard = await app.inject({ method: 'GET', url: `/api/v1/servers/${serverId}`, headers: { authorization: `Bearer ${token}` } });
    expect(dashboard.statusCode).toBe(200);
    expect(JSON.stringify(dashboard.json())).toContain('Debian 13');

    const types = (await db.query<{ type: string }>(`SELECT type FROM user_notifications WHERE user_id=$1 AND resource_id=$2`, [userId, serverId])).rows.map((row) => row.type);
    expect(types).toContain('SERVER_REINSTALLED');
    expect((await db.query<{ count: number }>(
      `SELECT count(*)::int count FROM audit_logs WHERE action='SERVER_REINSTALL_COMPLETED' AND resource_id=$1`, [serverId]
    )).rows[0]?.count).toBe(1);
    await app.close();
  });

  it('leaves the recorded operating system untouched when a reinstall fails at the provider', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const requested = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/reinstall`,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': `acceptance-failure-${randomUUID()}` },
      payload: { operatingSystemVersionId: UBUNTU_2404, architecture: 'x86_64', confirmation: 'REINSTALL' },
    });
    expect(requested.statusCode).toBe(200);
    const jobId = requested.json().jobId;

    const outcome = await executeServerProvisioning(db, await deploymentForJob(jobId), {
      adapterOverride: adapterStub({
        reinstallServer: async () => {
          throw new ProviderError('IMAGE_UNAVAILABLE', 'Provider withdrew the image mid-flight', false);
        },
      }),
      ...healthOptions,
    });
    expect(outcome.outcome).toBe('failed');

    const failed = (await db.query<{ status: string; error_code: string; retryable: boolean }>(
      `SELECT status,error_code,retryable FROM provisioning_jobs WHERE id=$1`, [jobId]
    )).rows[0];
    expect(failed).toEqual({ status: 'FAILED', error_code: 'IMAGE_UNAVAILABLE', retryable: false });

    // A failed reinstall must never advertise an OS the server is not running.
    expect((await db.query<{ v: string }>(`SELECT operating_system_version_id v FROM servers WHERE id=$1`, [serverId])).rows[0]?.v).toBe(DEBIAN_13);
    await app.close();
  });
});
