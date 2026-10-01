import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createUser } from '../../src/db/users';
import { signAuthToken } from '../../src/lib/jwt';

/**
 * Operator-facing infrastructure surface: adapter configuration reporting, mock-provider
 * isolation and the infrastructure audit log. These endpoints must be admin-only and must never
 * return credential material.
 */
describe('admin infrastructure operations', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    JWT_SECRET: 'i'.repeat(32),
  } as NodeJS.ProcessEnv);
  let adminToken = '';
  let customerToken = '';

  beforeAll(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const admin = await createUser(db, {
      id: randomUUID(), email: `admin-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Admin',
    });
    await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [admin.id]);
    adminToken = signAuthToken(env, { sub: admin.id, role: 'admin', email: admin.email });
    const customer = await createUser(db, {
      id: randomUUID(), email: `customer-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Customer',
    });
    customerToken = signAuthToken(env, { sub: customer.id, role: 'customer', email: customer.email });
  });

  afterAll(async () => { await db.close(); });

  function auth(token: string) { return { authorization: `Bearer ${token}` }; }

  it('publishes the configuration contract for every adapter and refuses non-admins', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/provider-adapters' })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'GET', url: '/api/v1/admin/provider-adapters', headers: auth(customerToken),
    })).statusCode).toBe(403);

    const response = await app.inject({
      method: 'GET', url: '/api/v1/admin/provider-adapters', headers: auth(adminToken),
    });
    expect(response.statusCode).toBe(200);
    const adapters = response.json().adapters as Array<Record<string, unknown>>;
    const kinds = adapters.map((adapter) => adapter.adapter);
    for (const kind of ['hetzner', 'ovh', 'proxmox', 'virtualizor', 'solusvm', 'openstack']) {
      expect(kinds).toContain(kind);
    }
    expect(adapters.find((adapter) => adapter.adapter === 'mock')?.developmentOnly).toBe(true);
    await app.close();
  });

  it('reports which variables a provider still needs without exposing any value', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const created = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers', headers: auth(adminToken),
      payload: {
        name: 'Proxmox Lab', slug: `proxmox-${randomUUID().slice(0, 8)}`, providerType: 'PROXMOX',
        adapter: 'proxmox', status: 'CONFIGURATION_REQUIRED', apiBaseUrl: null, credentialEnvPrefix: 'PROXMOX_LAB',
      },
    });
    expect(created.statusCode).toBe(201);
    const providerId = created.json().provider.id as string;

    const report = await app.inject({
      method: 'GET', url: `/api/v1/admin/providers/${providerId}/configuration`, headers: auth(adminToken),
    });
    expect(report.statusCode).toBe(200);
    const body = report.json();
    expect(body.configuration.ready).toBe(false);
    expect(body.configuration.missing).toContain('api_base_url');
    expect(body.configuration.credentials.map((c: { name: string }) => c.name))
      .toContain('PROXMOX_LAB_API_TOKEN');
    // Only names and booleans: no property may carry a secret-looking value.
    for (const credential of body.configuration.credentials) {
      expect(Object.keys(credential).sort()).toEqual(['description', 'fallbackName', 'name', 'present', 'required']);
    }
    expect(body.images).toEqual({ total: 0, verifiedActive: 0 });
    await app.close();
  });

  it('never activates a provider whose credentials are absent', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const created = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers', headers: auth(adminToken),
      payload: {
        name: 'Hetzner Unconfigured', slug: `hetzner-${randomUUID().slice(0, 8)}`, providerType: 'HETZNER',
        adapter: 'hetzner', status: 'CONFIGURATION_REQUIRED', apiBaseUrl: null, credentialEnvPrefix: 'HETZNER_MISSING',
      },
    });
    const providerId = created.json().provider.id as string;
    const activation = await app.inject({
      method: 'PATCH', url: `/api/v1/admin/providers/${providerId}`, headers: auth(adminToken),
      payload: { status: 'ACTIVE' },
    });
    expect(activation.statusCode).toBe(400);
    const stored = await db.query<{ status: string }>(`SELECT status FROM infrastructure_providers WHERE id=$1`, [providerId]);
    expect(stored.rows[0]?.status).toBe('CONFIGURATION_REQUIRED');
    await app.close();
  });

  it('rejects credentials hidden inside operator metadata instead of returning them to admin clients', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers', headers: auth(adminToken),
      payload: {
        name: 'Metadata secret test', slug: `metadata-${randomUUID().slice(0, 8)}`,
        providerType: 'GENERIC_HTTP', adapter: 'generic_http', status: 'CONFIGURATION_REQUIRED',
        apiBaseUrl: 'https://bridge.example.test', credentialEnvPrefix: 'BRIDGE',
        metadata: { providerPlan: { apiToken: 'should-not-be-stored' } },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('Metadata cannot contain provider credentials');
    await app.close();
  });

  it('refuses to register the mock provider without the explicit development opt-in', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const rejected = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers', headers: auth(adminToken),
      payload: {
        name: 'Mock', slug: `mock-${randomUUID().slice(0, 8)}`, providerType: 'MOCK', adapter: 'mock',
        status: 'CONFIGURATION_REQUIRED', apiBaseUrl: null, credentialEnvPrefix: 'MOCK',
      },
    });
    expect(rejected.statusCode).toBe(400);

    const mismatched = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers', headers: auth(adminToken),
      payload: {
        name: 'Fake Hetzner', slug: `fake-${randomUUID().slice(0, 8)}`, providerType: 'HETZNER', adapter: 'mock',
        status: 'CONFIGURATION_REQUIRED', apiBaseUrl: null, credentialEnvPrefix: 'MOCK',
      },
    });
    expect(mismatched.statusCode).toBe(400);
    const count = await db.query<{ count: string }>(`SELECT count(*)::text count FROM infrastructure_providers WHERE adapter='mock'`);
    expect(count.rows[0]?.count).toBe('0');
    await app.close();
  });

  it('allows the mock provider only when the deployment explicitly enables it', async () => {
    const devEnv = loadEnv({
      NODE_ENV: 'development', DATABASE_URL: 'postgresql://test:test@localhost/test',
      JWT_SECRET: 'i'.repeat(32), ALLOW_MOCK_PROVIDER: 'true',
    } as NodeJS.ProcessEnv);
    const app = buildApp(devEnv, { serveFrontend: false, pool: db });
    const token = signAuthToken(devEnv, { sub: (await db.query<{ id: string }>(`SELECT id FROM users WHERE role='admin' LIMIT 1`)).rows[0]!.id, role: 'admin', email: 'admin@example.com' });
    const created = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers', headers: auth(token),
      payload: {
        name: 'Mock Dev', slug: `mockdev-${randomUUID().slice(0, 8)}`, providerType: 'MOCK', adapter: 'mock',
        status: 'CONFIGURATION_REQUIRED', apiBaseUrl: null, credentialEnvPrefix: 'MOCK',
      },
    });
    expect(created.statusCode).toBe(201);
    await db.query(`DELETE FROM infrastructure_providers WHERE adapter='mock'`);
    await app.close();
  });

  it('refuses a server template that promises an action the provider adapter cannot perform', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const headers = { authorization: `Bearer ${adminToken}` };
    const product = await db.query<{ id: string }>(
      `INSERT INTO products(id,slug,name,product_type,status,visibility) VALUES($1,$2,'Capability product','hosting','active','public') RETURNING id`,
      [randomUUID(), `cap-${randomUUID()}`]
    );
    const plan = await db.query<{ id: string }>(
      `INSERT INTO product_plans(id,product_id,slug,name,status) VALUES($1,$2,$3,'Capability plan','active') RETURNING id`,
      [randomUUID(), product.rows[0]!.id, `cap-plan-${randomUUID()}`]
    );
    const providerId = randomUUID();
    const regionId = randomUUID();
    // AWS is a real adapter whose profile declares no in-place reinstall and no serial console.
    await db.query(
      `INSERT INTO infrastructure_providers(id,name,slug,provider_type,adapter,status) VALUES($1,'Capability provider',$2,'AWS','aws','DISABLED')`,
      [providerId, `cap-${providerId}`]
    );
    await db.query(
      `INSERT INTO infrastructure_regions(id,provider_id,code,name,status) VALUES($1,$2,'cap-1','Capability Region','ACTIVE')`,
      [regionId, providerId]
    );
    await db.query(`UPDATE operating_system_versions SET status='ACTIVE' WHERE id='20000000-0000-0000-0000-000000000006'`);
    const body = (capabilities: Record<string, boolean>) => ({
      planId: plan.rows[0]!.id, providerId, regionId, datacenterId: null,
      operatingSystemVersionId: '20000000-0000-0000-0000-000000000006',
      architecture: 'x86_64', serverType: 'VPS', status: 'DISABLED',
      metadata: { cpuCores: 2, memoryMb: 4096, storageMb: 80000, providerServerType: 't3.small', capabilities },
    });

    const promised = await app.inject({
      method: 'POST', url: '/api/v1/admin/server-product-configurations', headers,
      payload: body({ start: true, stop: true, reboot: true, reinstall: true }),
    });
    expect(promised.statusCode).toBe(400);
    expect(promised.json().message).toContain('does not support reinstall');

    // Only power actions implemented by every adapter are accepted; the disabled native AWS
    // adapter must not advertise snapshots, metrics, resize or other unimplemented operations.
    const honest = await app.inject({
      method: 'POST', url: '/api/v1/admin/server-product-configurations', headers,
      payload: body({ start: true, stop: true, reboot: true, shutdown: true }),
    });
    expect(honest.statusCode).toBe(201);
    expect((await db.query<{ count: number }>(
      `SELECT count(*)::int count FROM server_product_configurations WHERE provider_id=$1`, [providerId]
    )).rows[0]?.count).toBe(1);
    await app.close();
  });

  it('stores, serves, replaces and deletes validated database-backed OS logos', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const osId='10000000-0000-0000-0000-000000000001';
    // A complete 1x1 transparent PNG. Upload validation checks both the declared MIME and bytes.
    const contentBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/69f2WQAAAABJRU5ErkJggg==';
    const upload=await app.inject({
      method:'POST',url:`/api/v1/admin/operating-systems/${osId}/logo`,headers:auth(adminToken),
      payload:{fileName:'ubuntu.png',contentType:'image/png',contentBase64},
    });
    expect(upload.statusCode).toBe(201);
    expect(upload.json().logo.url).toBe(`/api/v1/operating-systems/${osId}/logo`);

    const served=await app.inject({method:'GET',url:`/api/v1/operating-systems/${osId}/logo`});
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.rawPayload.equals(Buffer.from(contentBase64,'base64'))).toBe(true);
    expect(served.headers.etag).toMatch(/^\"[0-9a-f]{64}\"$/);
    expect((await app.inject({method:'GET',url:`/api/v1/operating-systems/${osId}/logo`,headers:{'if-none-match':String(served.headers.etag)}})).statusCode).toBe(304);

    const invalid=await app.inject({
      method:'POST',url:`/api/v1/admin/operating-systems/${osId}/logo`,headers:auth(adminToken),
      payload:{fileName:'fake.png',contentType:'image/png',contentBase64:Buffer.from('not an image').toString('base64')},
    });
    expect(invalid.statusCode).toBe(400);

    expect((await app.inject({method:'DELETE',url:`/api/v1/admin/operating-systems/${osId}/logo`,headers:auth(adminToken)})).statusCode).toBe(204);
    expect((await app.inject({method:'GET',url:`/api/v1/operating-systems/${osId}/logo`})).statusCode).toBe(404);
    await app.close();
  });

  it('exposes an append-only infrastructure audit trail, admin only', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/infrastructure-logs' })).statusCode).toBe(401);
    expect((await app.inject({
      method: 'GET', url: '/api/v1/admin/infrastructure-logs', headers: auth(customerToken),
    })).statusCode).toBe(403);

    const response = await app.inject({
      method: 'GET', url: '/api/v1/admin/infrastructure-logs?resourceType=provider', headers: auth(adminToken),
    });
    expect(response.statusCode).toBe(200);
    const logs = response.json().logs as Array<Record<string, unknown>>;
    // The provider creations above were audited by the API itself.
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.every((log) => log.resource_type === 'provider')).toBe(true);
    expect(logs.some((log) => log.action === 'PROVIDER_CREATED')).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/API_TOKEN|PASSWORD|SECRET/i);
    await app.close();
  });

  it('reports provisioning observability including failure codes and provider health', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const response = await app.inject({
      method: 'GET', url: '/api/v1/admin/provisioning-metrics', headers: auth(adminToken),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ total: 0, ready: 0, failed: 0, queueDepth: 0, stalledJobs: 0 });
    expect(Array.isArray(body.failuresByCode)).toBe(true);
    expect(Array.isArray(body.providers)).toBe(true);
    await app.close();
  });
});
