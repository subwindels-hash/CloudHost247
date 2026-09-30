import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createUser } from '../../src/db/users';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { signAuthToken } from '../../src/lib/jwt';
import { sweepScheduledTerminations } from '../../src/services/server-termination-service';
import { executeServerProvisioning } from '../../src/infrastructure/services/server-provisioner';
import type { DeploymentRow } from '../../src/db/deployments';
import type { InfrastructureProviderAdapter } from '../../src/infrastructure/providers/types';

const UBUNTU_2404 = '20000000-0000-0000-0000-000000000006';

/**
 * Cancellation is the counterpart to provisioning: a customer must always be able to stop paying,
 * the paid-for term must be honoured unless they explicitly accept data loss now, and the actual
 * destruction must go through the same queue and provider adapter as everything else — never a
 * synchronous delete and never a silent row removal.
 */
describe('server cancellation and termination', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 't'.repeat(32),
  } as NodeJS.ProcessEnv);

  const providerId = randomUUID();
  const regionId = randomUUID();
  let ownerToken = '';
  let strangerToken = '';
  let ownerId = '';
  let planId = '';
  let imageId = '';

  /** Creates a paid server with its order and subscription, mirroring the post-payment state. */
  async function seedServer(options: { periodEndDays: number; status?: string }): Promise<{ serverId: string; orderId: string; subscriptionId: string }> {
    const serverId = randomUUID();
    const orderId = randomUUID();
    const subscriptionId = randomUUID();
    await db.query(
      `INSERT INTO orders(id,order_number,user_id,status,payment_status,currency,subtotal_amount,total_amount)
       VALUES($1,$2,$3,'completed','paid','USD',1000,1000)`,
      [orderId, `ORD-${orderId.slice(0, 8)}`, ownerId]
    );
    await db.query(
      `INSERT INTO subscriptions(id,customer_id,plan_id,order_id,status,current_period_end)
       VALUES($1,$2,$3,$4,'active',now() + ($5 || ' days')::interval)`,
      [subscriptionId, ownerId, planId, orderId, String(options.periodEndDays)]
    );
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,plan_id,order_id,provider_id,region_id,
         operating_system_version_id,os_image_id,architecture,provisioning_status,provider_server_id,capabilities)
       VALUES($1,$2,$3,'VPS',$4,$5,$6,$7,$8,$9,$10,$11,'x86_64','READY',$12,'{"reinstall":true}'::jsonb)`,
      [serverId, `srv-${serverId.slice(0, 8)}`, `${serverId.slice(0, 8)}.example.test`, options.status ?? 'active',
        ownerId, planId, orderId, providerId, regionId, UBUNTU_2404, imageId, `prov-${serverId.slice(0, 8)}`]
    );
    return { serverId, orderId, subscriptionId };
  }

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const owner = await createUser(db, {
      id: randomUUID(), email: `cancel-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Cancelling Customer',
    });
    const stranger = await createUser(db, {
      id: randomUUID(), email: `nosy-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Nosy Customer',
    });
    ownerId = owner.id;
    ownerToken = signAuthToken(env, { sub: owner.id, role: 'customer', email: owner.email });
    strangerToken = signAuthToken(env, { sub: stranger.id, role: 'customer', email: stranger.email });

    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Cancel provider',$2,'OTHER','generic_http','ACTIVE')`,
      [providerId, `cancel-${providerId}`]
    );
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'cancel-1','Cancel Region','ACTIVE')`,
      [regionId, providerId]
    );
    imageId = randomUUID();
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at)
       VALUES($1,$2,$3,'ubuntu-24.04','x86_64',$4,'ACTIVE',now())`,
      [imageId, providerId, UBUNTU_2404, regionId]
    );
    const product = await createProduct(db, {
      id: randomUUID(), slug: `cancel-compute-${randomUUID()}`, name: 'Cancel Compute',
      productType: 'hosting', status: 'active', visibility: 'public',
    });
    const plan = await createPlan(db, {
      id: randomUUID(), productId: product.id, slug: `cancel-vps-${randomUUID()}`, name: 'Cancel VPS', status: 'active',
    });
    planId = plan.id;
  });

  afterAll(async () => { await db.close(); });

  it('hides another customer server behind a 404', async () => {
    const { serverId } = await seedServer({ periodEndDays: 20 });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/cancel`,
      headers: { authorization: `Bearer ${strangerToken}` }, payload: { mode: 'AT_PERIOD_END' },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('refuses immediate destruction without the typed confirmation, and queues nothing', async () => {
    const { serverId } = await seedServer({ periodEndDays: 20 });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` }, payload: { mode: 'IMMEDIATE' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/DELETE/);
    const jobs = await db.query(`SELECT id FROM provisioning_jobs WHERE server_id=$1`, [serverId]);
    expect(jobs.rows).toHaveLength(0);
    const server = await db.query<{ status: string }>(`SELECT status FROM servers WHERE id=$1`, [serverId]);
    expect(server.rows[0]?.status).toBe('active');
    await app.close();
  });

  it('honours the paid term: schedules the cancellation, keeps the server running, and is revocable', async () => {
    const { serverId, subscriptionId } = await seedServer({ periodEndDays: 20 });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const scheduled = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: 'AT_PERIOD_END', reason: 'Project finished' },
    });
    expect(scheduled.statusCode).toBe(200);
    expect(scheduled.json()).toMatchObject({ mode: 'AT_PERIOD_END', jobId: null });
    expect(scheduled.json().effectiveAt).toBeTruthy();

    const afterSchedule = await db.query<{ status: string; metadata: Record<string, unknown> }>(
      `SELECT status,metadata FROM servers WHERE id=$1`, [serverId]
    );
    expect(afterSchedule.rows[0]?.status).toBe('active');
    expect((afterSchedule.rows[0]?.metadata.cancellation as Record<string, unknown>).mode).toBe('AT_PERIOD_END');
    const flagged = await db.query<{ cancel_at_period_end: boolean; status: string }>(
      `SELECT cancel_at_period_end,status FROM subscriptions WHERE id=$1`, [subscriptionId]
    );
    expect(flagged.rows[0]).toMatchObject({ cancel_at_period_end: true, status: 'active' });
    expect((await db.query(`SELECT id FROM provisioning_jobs WHERE server_id=$1`, [serverId])).rows).toHaveLength(0);

    const revoked = await app.inject({
      method: 'DELETE', url: `/api/v1/servers/${serverId}/cancel`, headers: { authorization: `Bearer ${ownerToken}` },
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({ revoked: true, restoredSubscriptions: 1 });
    const afterRevoke = await db.query<{ metadata: Record<string, unknown>; }>(`SELECT metadata FROM servers WHERE id=$1`, [serverId]);
    expect(afterRevoke.rows[0]?.metadata.cancellation).toBeUndefined();
    expect((await db.query<{ cancel_at_period_end: boolean }>(
      `SELECT cancel_at_period_end FROM subscriptions WHERE id=$1`, [subscriptionId]
    )).rows[0]?.cancel_at_period_end).toBe(false);
    await app.close();
  });

  it('queues a DELETE job for immediate termination, cancels billing, and never deletes the record', async () => {
    const { serverId, subscriptionId } = await seedServer({ periodEndDays: 20 });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}`, 'idempotency-key': `cancel-${serverId.slice(0, 8)}` },
      payload: { mode: 'IMMEDIATE', confirmation: 'DELETE' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ mode: 'IMMEDIATE', queued: true, cancelledSubscriptions: 1 });

    const job = await db.query<{ operation: string; status: string }>(
      `SELECT operation,status FROM provisioning_jobs WHERE server_id=$1`, [serverId]
    );
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0]).toMatchObject({ operation: 'DELETE', status: 'QUEUED' });
    // The provider resource is destroyed by the worker, not by the request: the row survives.
    const server = await db.query<{ status: string }>(`SELECT status FROM servers WHERE id=$1`, [serverId]);
    expect(server.rows[0]?.status).toBe('deleting');
    expect((await db.query<{ status: string }>(`SELECT status FROM subscriptions WHERE id=$1`, [subscriptionId])).rows[0]?.status)
      .toBe('cancelled');

    // A repeated request with the same idempotency key must not queue a second destruction.
    const repeat = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}`, 'idempotency-key': `cancel-${serverId.slice(0, 8)}` },
      payload: { mode: 'IMMEDIATE', confirmation: 'DELETE' },
    });
    expect(repeat.statusCode).toBe(409);
    expect((await db.query(`SELECT id FROM provisioning_jobs WHERE server_id=$1`, [serverId])).rows).toHaveLength(1);
    await app.close();
  });

  it('retires a server that never reached the provider instead of calling a provider', async () => {
    const serverId = randomUUID();
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,plan_id,provider_id,region_id,
         operating_system_version_id,os_image_id,architecture,provisioning_status,capabilities)
       VALUES($1,'unpaid-vps','unpaid.example.test','VPS','awaiting_payment',$2,$3,$4,$5,$6,$7,'x86_64','AWAITING_PAYMENT','{}'::jsonb)`,
      [serverId, ownerId, planId, providerId, regionId, UBUNTU_2404, imageId]
    );
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { mode: 'IMMEDIATE', confirmation: 'DELETE' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ jobId: null, retiredWithoutProviderCall: true });
    expect((await db.query<{ status: string }>(`SELECT status FROM servers WHERE id=$1`, [serverId])).rows[0]?.status)
      .toBe('retired');
    expect((await db.query(`SELECT id FROM provisioning_jobs WHERE server_id=$1`, [serverId])).rows).toHaveLength(0);
    await app.close();
  });

  it('destroys scheduled cancellations once the paid term ends, and is idempotent', async () => {
    const { serverId, subscriptionId } = await seedServer({ periodEndDays: 20 });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` }, payload: { mode: 'AT_PERIOD_END' },
    });
    await app.close();

    // Before the term ends the sweep must leave the server completely alone.
    expect(await sweepScheduledTerminations(db)).toEqual([]);
    expect((await db.query<{ status: string }>(`SELECT status FROM servers WHERE id=$1`, [serverId])).rows[0]?.status)
      .toBe('active');

    const later = new Date(Date.now() + 40 * 86_400_000);
    const swept = await sweepScheduledTerminations(db, { now: later });
    expect(swept.map((item) => item.serverId)).toContain(serverId);
    const job = await db.query<{ operation: string }>(`SELECT operation FROM provisioning_jobs WHERE server_id=$1`, [serverId]);
    expect(job.rows).toHaveLength(1);
    expect(job.rows[0]?.operation).toBe('DELETE');
    expect((await db.query<{ status: string }>(`SELECT status FROM servers WHERE id=$1`, [serverId])).rows[0]?.status)
      .toBe('deleting');
    expect((await db.query<{ status: string }>(`SELECT status FROM subscriptions WHERE id=$1`, [subscriptionId])).rows[0]?.status)
      .toBe('cancelled');

    // Re-running the sweep must not queue a second destruction for the same server.
    expect(await sweepScheduledTerminations(db, { now: later })).toEqual([]);
    expect((await db.query(`SELECT id FROM provisioning_jobs WHERE server_id=$1`, [serverId])).rows).toHaveLength(1);
  });

  it('destroys the provider resource through the worker, keeps the record, and tells the customer once', async () => {
    const { serverId } = await seedServer({ periodEndDays: 20 });
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const queued = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/cancel`,
      headers: { authorization: `Bearer ${ownerToken}` }, payload: { mode: 'IMMEDIATE', confirmation: 'DELETE' },
    });
    await app.close();
    const jobId = queued.json().jobId as string;
    const deploymentId = (await db.query<{ deployment_id: string }>(
      `SELECT deployment_id FROM provisioning_jobs WHERE id=$1`, [jobId]
    )).rows[0]!.deployment_id;
    const deployment = (await db.query<DeploymentRow>(`SELECT * FROM deployments WHERE id=$1`, [deploymentId])).rows[0]!;

    const deleted: string[] = [];
    const remote = { id: 'irrelevant', status: 'running', name: 'x', ipAddress: null, imageId: null, metadata: {} };
    const adapter = {
      kind: 'test-only', provider: {} as never, validateConfiguration: async () => undefined,
      createServer: async () => remote, provisionServer: async () => remote, findServerByIdempotencyKey: async () => null,
      deleteServer: async (id: string) => { deleted.push(id); },
      rebootServer: async () => undefined, shutdownServer: async () => undefined, startServer: async () => undefined,
      powerOnServer: async () => undefined, powerOffServer: async () => undefined, getServer: async () => remote,
      getServerStatus: async () => remote, getServerIP: async () => null, getAvailableImages: async () => [],
      getImage: async () => null, reinstallServer: async () => remote, rebuildServer: async () => remote,
      resizeServer: async () => remote, createSnapshot: async () => ({}), deleteSnapshot: async () => undefined,
      restoreSnapshot: async () => undefined, getConsole: async () => ({}), getServerMetrics: async () => ({}),
      healthCheck: async () => ({ exists: false, poweredOn: false, ipAddress: null, imageMatches: false, providerStatus: 'deleted' }),
    } satisfies InfrastructureProviderAdapter;

    const result = await executeServerProvisioning(db, deployment, { adapterOverride: adapter });
    expect(result.outcome).toBe('succeeded');
    expect(deleted).toEqual([`prov-${serverId.slice(0, 8)}`]);

    const server = (await db.query<{ status: string; provisioning_status: string }>(
      `SELECT status,provisioning_status FROM servers WHERE id=$1`, [serverId]
    )).rows[0];
    expect(server).toMatchObject({ status: 'retired' });

    const notifications = await db.query<{ title: string }>(
      `SELECT title FROM user_notifications WHERE resource_id=$1 AND type='SERVER_TERMINATED'`, [serverId]
    );
    expect(notifications.rows).toHaveLength(1);

    // Queue redelivery must not call the provider again or notify a second time.
    await executeServerProvisioning(db, deployment, { adapterOverride: adapter });
    expect(deleted).toHaveLength(1);
    expect((await db.query(
      `SELECT id FROM user_notifications WHERE resource_id=$1 AND type='SERVER_TERMINATED'`, [serverId]
    )).rows).toHaveLength(1);
  });
});
