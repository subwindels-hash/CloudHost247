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
import { resolveAvailableConfiguration } from '../../src/db/operating-systems';
import { sweepOperatingSystemLifecycle } from '../../src/services/os-lifecycle-service';

const UBUNTU = '10000000-0000-0000-0000-000000000004';

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * End-of-life handling must protect two things at once: customers must be warned and stopped
 * from ordering unsupported versions, while servers that already run those versions must keep
 * working and keep displaying what they actually run.
 */
describe('operating system end-of-life lifecycle', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test', JWT_SECRET: 'i'.repeat(32),
  } as NodeJS.ProcessEnv);

  const providerId = randomUUID();
  const regionId = randomUUID();
  let planId = '';
  const expiringVersionId = randomUUID();
  const warningVersionId = randomUUID();
  const unusedExpiredVersionId = randomUUID();
  let customerId = '';
  let serverId = '';
  let expiringImageId = '';

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const user = await createUser(db, {
      id: randomUUID(), email: `eol-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'EOL Customer',
    });
    customerId = user.id;

    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'EOL provider',$2,'OTHER','generic_http','ACTIVE')`,
      [providerId, `eol-${providerId}`]
    );
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'eol-1','EOL Region','ACTIVE')`,
      [regionId, providerId]
    );
    // Three versions of a real catalog family: one expiring today, one expiring soon, one long
    // dead and unused.
    await db.query(
      `INSERT INTO operating_system_versions(id,operating_system_id,version,display_name,architecture_support,status,end_of_life_date) VALUES
        ($1,$4,'18.04','Ubuntu 18.04 LTS',ARRAY['x86_64']::varchar(16)[],'ACTIVE',$5),
        ($2,$4,'20.04','Ubuntu 20.04 LTS',ARRAY['x86_64']::varchar(16)[],'ACTIVE',$6),
        ($3,$4,'16.04','Ubuntu 16.04 LTS',ARRAY['x86_64']::varchar(16)[],'EOL',$7)`,
      [expiringVersionId, warningVersionId, unusedExpiredVersionId, UBUNTU,
        isoDaysFromNow(-1), isoDaysFromNow(30), isoDaysFromNow(-400)]
    );

    expiringImageId = randomUUID();
    await db.query(
      `INSERT INTO server_os_images(id,provider_id,operating_system_version_id,provider_image_id,architecture,region_id,status,verified_at)
       VALUES($1,$2,$3,'ubuntu-18.04','x86_64',$4,'ACTIVE',now())`,
      [expiringImageId, providerId, expiringVersionId, regionId]
    );
    const product = await createProduct(db, {
      id: randomUUID(), slug: `eol-compute-${randomUUID()}`, name: 'EOL Compute',
      productType: 'hosting', status: 'active', visibility: 'public',
    });
    const plan = await createPlan(db, {
      id: randomUUID(), productId: product.id, slug: `eol-vps-${randomUUID()}`, name: 'EOL VPS', status: 'active',
    });
    planId = plan.id;
    await db.query(
      `INSERT INTO server_product_configurations(id,plan_id,provider_id,region_id,operating_system_version_id,architecture,server_type,status)
       VALUES($1,$2,$3,$4,$5,'x86_64','VPS','ACTIVE')`,
      [randomUUID(), planId, providerId, regionId, expiringVersionId]
    );

    serverId = randomUUID();
    await db.query(
      `INSERT INTO servers(id,name,hostname,server_type,status,customer_id,provider_id,region_id,operating_system_version_id,os_image_id,architecture,provisioning_status,ip_address)
       VALUES($1,'legacy-vps','legacy.example.test','VPS','active',$2,$3,$4,$5,$6,'x86_64','READY','203.0.113.50')`,
      [serverId, customerId, providerId, regionId, expiringVersionId, expiringImageId]
    );
  });

  afterAll(async () => { await db.close(); });

  it('advances versions to EOL_WARNING and EOL from the operator-entered date', async () => {
    const transitions = await sweepOperatingSystemLifecycle(db, { warningDays: 90, archiveAfterDays: 180 });
    const byId = Object.fromEntries(transitions.map((item) => [item.versionId, item]));
    expect(byId[expiringVersionId]?.to).toBe('EOL');
    expect(byId[warningVersionId]?.to).toBe('EOL_WARNING');
    expect(byId[unusedExpiredVersionId]?.to).toBe('ARCHIVED');

    const statuses = await db.query<{ id: string; status: string }>(
      `SELECT id,status FROM operating_system_versions WHERE id=ANY($1::uuid[])`,
      [[expiringVersionId, warningVersionId, unusedExpiredVersionId]]
    );
    expect(Object.fromEntries(statuses.rows.map((row) => [row.id, row.status]))).toEqual({
      [expiringVersionId]: 'EOL',
      [warningVersionId]: 'EOL_WARNING',
      [unusedExpiredVersionId]: 'ARCHIVED',
    });
  });

  it('does not touch the running server, its image, or its recorded operating system', async () => {
    const server = await db.query<{ status: string; operating_system_version_id: string; ip_address: string }>(
      `SELECT status,operating_system_version_id,ip_address FROM servers WHERE id=$1`, [serverId]
    );
    expect(server.rows[0]).toEqual({
      status: 'active', operating_system_version_id: expiringVersionId, ip_address: '203.0.113.50',
    });
    const image = await db.query<{ status: string }>(`SELECT status FROM server_os_images WHERE id=$1`, [expiringImageId]);
    expect(image.rows[0]?.status).toBe('ACTIVE');
  });

  it('notifies each affected customer exactly once, and never notifies twice on a re-run', async () => {
    const first = await db.query<{ count: string }>(
      `SELECT count(*)::text count FROM user_notifications WHERE user_id=$1 AND type='OS_EOL'`, [customerId]
    );
    expect(first.rows[0]?.count).toBe('1');
    await sweepOperatingSystemLifecycle(db, { warningDays: 90, archiveAfterDays: 180 });
    const second = await db.query<{ count: string }>(
      `SELECT count(*)::text count FROM user_notifications WHERE user_id=$1`, [customerId]
    );
    expect(second.rows[0]?.count).toBe('1');
  });

  it('records every transition in the append-only audit trail', async () => {
    const { rows } = await db.query<{ action: string; resource_id: string }>(
      `SELECT action,resource_id FROM audit_logs WHERE resource_type='operating_system_version' ORDER BY action`
    );
    const actions = rows.map((row) => row.action);
    expect(actions).toContain('OS_VERSION_EOL');
    expect(actions).toContain('OS_VERSION_EOL_WARNING');
    expect(actions).toContain('OS_VERSION_ARCHIVED');
  });

  it('never archives a version that a server still references', async () => {
    await db.query(
      `UPDATE operating_system_versions SET end_of_life_date=$2 WHERE id=$1`,
      [expiringVersionId, isoDaysFromNow(-900)]
    );
    await sweepOperatingSystemLifecycle(db, { warningDays: 90, archiveAfterDays: 180 });
    const status = await db.query<{ status: string }>(
      `SELECT status FROM operating_system_versions WHERE id=$1`, [expiringVersionId]
    );
    expect(status.rows[0]?.status).toBe('EOL');
  });

  it('stops offering an end-of-life version for new orders and reinstalls', async () => {
    const configuration = await resolveAvailableConfiguration(db, {
      planId, providerId, regionId, datacenterId: null,
      operatingSystemVersionId: expiringVersionId, architecture: 'x86_64', serverType: 'VPS',
    });
    expect(configuration).toBeNull();
  });

  it('still reports the real operating system the server runs, with its lifecycle state', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const token = signAuthToken(env, { sub: customerId, role: 'customer', email: 'eol@example.com' });
    const response = await app.inject({
      method: 'GET', url: `/api/v1/servers/${serverId}`, headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    const server = response.json().server;
    expect(server.os_display_name).toBe('Ubuntu 18.04 LTS');
    expect(server.os_version_status).toBe('EOL');
    expect(server.os_end_of_life_date).toBeTruthy();
    await app.close();
  });

  it('lets an admin run the sweep on demand and refuses non-admins', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const customerToken = signAuthToken(env, { sub: customerId, role: 'customer', email: 'eol@example.com' });
    expect((await app.inject({
      method: 'POST', url: '/api/v1/admin/os-lifecycle/sweep', headers: { authorization: `Bearer ${customerToken}` }, payload: {},
    })).statusCode).toBe(403);

    const admin = await createUser(db, {
      id: randomUUID(), email: `eoladmin-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Admin',
    });
    await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [admin.id]);
    const adminToken = signAuthToken(env, { sub: admin.id, role: 'admin', email: admin.email });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/admin/os-lifecycle/sweep', headers: { authorization: `Bearer ${adminToken}` }, payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().transitions)).toBe(true);
    await app.close();
  });
});
