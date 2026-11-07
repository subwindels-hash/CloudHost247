import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { createProduct } from '../../src/db/catalog-products';
import { createUser } from '../../src/db/users';
import { dbUuidSchema } from '../../src/lib/identifier-contract';
import { signAuthToken } from '../../src/lib/jwt';

/**
 * P0 acceptance test (2026-11-07). Verifies the identifier contract against the ACTUAL seeded
 * database rows and drives a real VPS order through POST /api/v1/servers using an OS-version id
 * read from `operating_system_versions` — not a hard-coded fixture. It also proves that malformed
 * ids are still rejected, i.e. validation was not relaxed to hide the defect.
 *
 * No provider is contacted and no payment is taken: the order must remain AWAITING_PAYMENT with
 * zero provisioning jobs (see the "no simulated successful provisioning" rule).
 */
describe('OS catalogue identifier contract through the VPS ordering workflow', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    JWT_SECRET: 'i'.repeat(32),
  } as NodeJS.ProcessEnv);
  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });
  afterAll(async () => { await db.close(); });

  it('every seeded OS family, OS version and control panel id satisfies the shared contract', async () => {
    const tables = ['operating_systems', 'operating_system_versions', 'control_panels'] as const;
    for (const table of tables) {
      const result = await db.query<{ id: string }>(`SELECT id::text AS id FROM ${table}`);
      expect(result.rows.length, table).toBeGreaterThan(0);
      for (const row of result.rows) {
        expect(dbUuidSchema.safeParse(row.id).success, `${table}: ${row.id}`).toBe(true);
      }
    }
  });

  it('creates an unpaid VPS order with a real seeded OS-version id and no provider work', async () => {
    // Resolve the identifier from the database — the same value a customer's OS selector sends.
    const seeded = await db.query<{ id: string; version: string }>(
      `SELECT id::text AS id, version FROM operating_system_versions WHERE version='24.04' LIMIT 1`
    );
    const osVersionId = seeded.rows[0]?.id;
    expect(osVersionId).toBeDefined();
    expect(dbUuidSchema.safeParse(osVersionId).success).toBe(true);

    const user = await createUser(db, {
      id: randomUUID(), email: `p0-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'P0 Customer',
    });
    const product = await createProduct(db, {
      id: randomUUID(), slug: `p0-${randomUUID()}`, name: 'P0 Compute', productType: 'hosting', status: 'active', visibility: 'public',
    });
    const plan = await createPlan(db, {
      id: randomUUID(), productId: product.id, slug: `p0-vps-${randomUUID()}`, name: 'P0 VPS', status: 'active',
    });
    await createPricing(db, {
      id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', amount: 12, effectiveStatus: 'published',
    });

    const providerId = randomUUID(), regionId = randomUUID(), imageId = randomUUID();
    const configurationId = randomUUID(), sshKeyId = randomUUID();
    await db.query(`UPDATE operating_system_versions SET status='ACTIVE' WHERE id=$1`, [osVersionId]);
    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'P0 provider',$2,'HETZNER','hetzner','ACTIVE')`,
      [providerId, `p0-${providerId}`]
    );
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'p0-1','P0 Region','ACTIVE')`,
      [regionId, providerId]
    );
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at) VALUES($1,$2,$3,'ubuntu-24.04','x86_64',$4,'ACTIVE',now())`,
      [imageId, providerId, osVersionId, regionId]
    );
    await db.query(
      `INSERT INTO server_product_configurations(id,plan_id,provider_id,region_id,operating_system_version_id,architecture,server_type,status,metadata) VALUES($1,$2,$3,$4,$5,'x86_64','VPS','ACTIVE',$6)`,
      [configurationId, plan.id, providerId, regionId, osVersionId,
        JSON.stringify({ cpuCores: 2, memoryMb: 4096, storageMb: 80000, providerServerType: 'test-small', capabilities: { reinstall: true, start: true, stop: true, reboot: true, shutdown: true } })]
    );
    await db.query(
      `INSERT INTO customer_ssh_keys(id,user_id,name,public_key,fingerprint) VALUES($1,$2,'P0 key','ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIP0Key p0@example.test',$3)`,
      [sshKeyId, user.id, `SHA256:${randomUUID()}`]
    );

    const app = buildApp(env, { serveFrontend: false, pool: db });
    const token = signAuthToken(env, { sub: user.id, role: 'customer', email: user.email });
    const payload = {
      planId: plan.id, billingPeriod: 'monthly', providerId, regionId, datacenterId: null,
      operatingSystemVersionId: osVersionId, architecture: 'x86_64', serverType: 'VPS',
      sshKeyIds: [sshKeyId], hostname: 'p0-ordered.example.test',
    };
    const response = await app.inject({
      method: 'POST', url: '/api/v1/servers',
      headers: { authorization: `Bearer ${token}` }, payload,
    });
    expect(response.statusCode, response.body).toBe(201);
    const body = response.json();
    expect(body.provisioningStatus).toBe('AWAITING_PAYMENT');
    // No simulated provisioning: no job, no provider resource, no charge.
    expect((await db.query<{ count: number }>(`SELECT count(*)::int count FROM provisioning_jobs WHERE server_id=$1`, [body.serverId])).rows[0]?.count).toBe(0);
    expect((await db.query<{ payment_status: string }>(`SELECT payment_status FROM orders WHERE id=$1`, [body.orderId])).rows[0]?.payment_status).toBe('unpaid');
    expect((await db.query<{ provider_server_id: string | null }>(`SELECT provider_server_id FROM servers WHERE id=$1`, [body.serverId])).rows[0]?.provider_server_id).toBeNull();

    // The same workflow still rejects a non-UUID OS id: strict shape validation is intact.
    const malformed = await app.inject({
      method: 'POST', url: '/api/v1/servers',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...payload, hostname: 'p0-malformed.example.test', operatingSystemVersionId: 'ubuntu-24.04' },
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('does not turn a cross-customer reinstall into a validation error', async () => {
    const owner = await createUser(db, { id: randomUUID(), email: `owner-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Owner' });
    const other = await createUser(db, { id: randomUUID(), email: `other-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Other' });
    const seeded = await db.query<{ id: string }>(`SELECT id::text AS id FROM operating_system_versions WHERE version='13' LIMIT 1`);
    const osVersionId = seeded.rows[0]!.id;
    const serverId = randomUUID();
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,operating_system_version_id,architecture,provisioning_status) VALUES($1,'private-vps','private.example.test','VPS','active',$2,$3,'x86_64','READY')`,
      [serverId, owner.id, osVersionId]
    );
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const token = signAuthToken(env, { sub: other.id, role: 'customer', email: other.email });
    const response = await app.inject({
      method: 'POST', url: `/api/v1/servers/${serverId}/reinstall`,
      headers: { authorization: `Bearer ${token}` },
      payload: { operatingSystemVersionId: osVersionId, architecture: 'x86_64', confirmation: 'REINSTALL' },
    });
    // Ownership must be enforced as 404, never masked by a 400 from an over-strict id validator.
    expect(response.statusCode, response.body).toBe(404);
    await app.close();
  });
});
