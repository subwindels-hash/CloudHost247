import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createUser } from '../../src/db/users';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { findOrderById } from '../../src/db/orders';
import { createServerResizeOrder } from '../../src/services/server-resize-order-service';
import { provisionPaidOrder } from '../../src/services/provisioning-service';
import { executeServerProvisioning } from '../../src/infrastructure/services/server-provisioner';
import type { DeploymentRow } from '../../src/db/deployments';
import type { InfrastructureProviderAdapter } from '../../src/infrastructure/providers/types';

function adapter(): InfrastructureProviderAdapter {
  const remote = { id: 'remote-vps', status: 'running', name: 'VPS', ipAddress: '203.0.113.20', imageId: 'ubuntu-24', metadata: {} };
  return {
    kind: 'test', provider: {} as never, validateConfiguration: async () => undefined,
    createServer: async () => remote, provisionServer: async () => remote, findServerByIdempotencyKey: async () => null,
    deleteServer: async () => undefined, rebootServer: async () => undefined, shutdownServer: async () => undefined, startServer: async () => undefined,
    powerOnServer: async () => undefined, powerOffServer: async () => undefined, getServer: async () => remote, getServerStatus: async () => remote,
    getServerIP: async () => remote.ipAddress, getAvailableImages: async () => [], getImage: async () => null,
    reinstallServer: async () => remote, rebuildServer: async () => remote, resizeServer: async (_id, plan) => ({ ...remote, metadata: { plan } }),
    createSnapshot: async () => ({}), deleteSnapshot: async () => undefined, restoreSnapshot: async () => undefined,
    getConsole: async () => ({}), enableRescue: async () => ({ type: 'test', username: 'root', rebooted: true }), disableRescue: async () => undefined,
    getServerMetrics: async () => ({}), healthCheck: async () => ({ exists: true, poweredOn: true, ipAddress: remote.ipAddress, imageMatches: true, providerStatus: 'running' }),
  };
}

describe('paid server resize orders', () => {
  let db: PGlite;
  beforeEach(async () => { db = new PGlite(); await migrateUp(new PgliteClient(db), { isProduction: false }); });
  afterEach(async () => { await db.close(); });

  it('prices only a server-side upgrade, queues it only after payment, then updates plan/resources after provider success', async () => {
    const user = await createUser(db, { id: randomUUID(), email: `resize-${randomUUID()}@example.test`, passwordHash: 'hash', fullName: 'Resize customer' });
    const product = await createProduct(db, { id: randomUUID(), slug: `vps-${randomUUID()}`, name: 'VPS', productType: 'hosting', status: 'active', visibility: 'public' });
    const small = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `small-${randomUUID()}`, name: 'Small', status: 'active' });
    const large = await createPlan(db, { id: randomUUID(), productId: product.id, slug: `large-${randomUUID()}`, name: 'Large', status: 'active' });
    await createPricing(db, { id: randomUUID(), planId: small.id, billingPeriod: 'monthly', currency: 'USD', amount: 10, effectiveStatus: 'published' });
    await createPricing(db, { id: randomUUID(), planId: large.id, billingPeriod: 'monthly', currency: 'USD', amount: 30, effectiveStatus: 'published' });
    await db.query(`UPDATE operating_system_versions SET status='ACTIVE' WHERE id='20000000-0000-0000-0000-000000000006'`);

    const providerId = randomUUID(), regionId = randomUUID(), imageId = randomUUID(), serverId = randomUUID(), sourceOrderId = randomUUID(), subscriptionId = randomUUID();
    await db.query(`INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Resize provider',$2,'HETZNER','hetzner','ACTIVE')`, [providerId, `resize-${providerId}`]);
    await db.query(`INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'nbg1','Nuremberg','ACTIVE')`, [regionId, providerId]);
    await db.query(`INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at) VALUES($1,$2,'20000000-0000-0000-0000-000000000006','ubuntu-24','x86_64',$3,'ACTIVE',now())`, [imageId, providerId, regionId]);
    const config = async (planId: string, cpu: number, memory: number, disk: number, type: string) => db.query(
      `INSERT INTO server_product_configurations(id,plan_id,provider_id,region_id,operating_system_version_id,architecture,server_type,status,metadata)
       VALUES($1,$2,$3,$4,'20000000-0000-0000-0000-000000000006','x86_64','VPS','ACTIVE',$5)`,
      [randomUUID(), planId, providerId, regionId, JSON.stringify({ cpuCores: cpu, memoryMb: memory, storageMb: disk, providerServerType: type, capabilities: { resize: true, start: true, stop: true, reboot: true, shutdown: true } })],
    );
    await config(small.id, 1, 1024, 20000, 'cx22');
    await config(large.id, 2, 4096, 80000, 'cx32');
    await db.query(`INSERT INTO orders(id,user_id,status,payment_status,currency,subtotal_amount,discount_amount,tax_amount,total_amount) VALUES($1,$2,'completed','paid','USD',10,0,0,10)`, [sourceOrderId, user.id]);
    await db.query(`INSERT INTO servers(id,name,hostname,server_type,status,customer_id,order_id,plan_id,provider_id,region_id,provider_server_id,operating_system_version_id,os_image_id,architecture,provisioning_status,cpu_cores,memory_mb,storage_mb,capabilities,metadata)
      VALUES($1,'vps','resize.example.test','VPS','active',$2,$3,$4,$5,$6,'remote-vps','20000000-0000-0000-0000-000000000006',$7,'x86_64','READY',1,1024,20000,$8,$9)`,
      [serverId, user.id, sourceOrderId, small.id, providerId, regionId, imageId, JSON.stringify({ resize: true }), JSON.stringify({ providerPlan: { providerServerType: 'cx22' } })]);
    await db.query(`INSERT INTO order_items(id,order_id,product_id,plan_id,product_name_snapshot,plan_name_snapshot,billing_period,quantity,unit_price_amount,currency,line_total_amount,metadata)
      VALUES($1,$2,$3,$4,'VPS','Small','monthly',1,10,'USD',10,$5)`, [randomUUID(), sourceOrderId, product.id, small.id, JSON.stringify({ serverProvision: { serverId } })]);
    await db.query(`INSERT INTO subscriptions(id,customer_id,plan_id,order_id,status,provider,current_period_end) VALUES($1,$2,$3,$4,'active','cloudhost247',now()+interval '30 days')`, [subscriptionId, user.id, small.id, sourceOrderId]);

    const quote = await createServerResizeOrder(db, user.id, { serverId, targetPlanId: large.id });
    expect(quote).toMatchObject({ created: true, paymentRequired: true, totalAmount: '20.00', targetPlanId: large.id });
    expect((await db.query<{ count: number }>(`SELECT count(*)::int count FROM provisioning_jobs WHERE server_id=$1`, [serverId])).rows[0]?.count).toBe(0);
    const duplicate = await createServerResizeOrder(db, user.id, { serverId, targetPlanId: large.id });
    expect(duplicate).toMatchObject({ created: false, orderId: quote.orderId, invoiceId: quote.invoiceId });

    await db.query(`UPDATE orders SET payment_status='paid' WHERE id=$1`, [quote.orderId]);
    const order = await findOrderById(db, quote.orderId);
    await provisionPaidOrder(db, order!);
    const job = (await db.query<{ id: string; deployment_id: string; operation: string }>(`SELECT id,deployment_id,operation FROM provisioning_jobs WHERE server_id=$1`, [serverId])).rows[0]!;
    expect(job.operation).toBe('RESIZE');
    const deployment = (await db.query<DeploymentRow>(`SELECT * FROM deployments WHERE id=$1`, [job.deployment_id])).rows[0]!;
    await expect(executeServerProvisioning(db, deployment, { adapterOverride: adapter() })).resolves.toEqual({ outcome: 'succeeded' });

    expect((await db.query<{ plan_id: string; cpu_cores: number; memory_mb: number; storage_mb: number }>(`SELECT plan_id,cpu_cores,memory_mb,storage_mb FROM servers WHERE id=$1`, [serverId])).rows[0]).toEqual({ plan_id: large.id, cpu_cores: 2, memory_mb: 4096, storage_mb: 80000 });
    expect((await db.query<{ plan_id: string }>(`SELECT plan_id FROM subscriptions WHERE id=$1`, [subscriptionId])).rows[0]?.plan_id).toBe(large.id);
    expect((await db.query<{ status: string }>(`SELECT status FROM orders WHERE id=$1`, [quote.orderId])).rows[0]?.status).toBe('completed');
  });
});
