import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import { createUser } from '../../src/db/users';
import { signAuthToken } from '../../src/lib/jwt';
import { buildKeyRing, decryptSecret } from '../../src/lib/crypto';
import { setKeyRingForTesting } from '../../src/lib/keyring';

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
    CREDENTIAL_ENCRYPTION_KEY: 'd'.repeat(64),
  } as NodeJS.ProcessEnv);
  const encryptionKey = 'd'.repeat(64);
  let adminToken = '';
  let superAdminToken = '';
  let customerToken = '';

  beforeAll(async () => {
    // The key-ring accessor uses the runtime env parser. Stub test values locally and restore them
    // after this file so other suites never inherit credentials or database settings.
    vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost/test');
    vi.stubEnv('JWT_SECRET', 'i'.repeat(32));
    vi.stubEnv('CREDENTIAL_ENCRYPTION_KEY', encryptionKey);
    setKeyRingForTesting(buildKeyRing(encryptionKey));
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
    const admin = await createUser(db, {
      id: randomUUID(), email: `admin-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Admin',
    });
    await db.query(`UPDATE users SET role='admin' WHERE id=$1`, [admin.id]);
    adminToken = signAuthToken(env, { sub: admin.id, role: 'admin', email: admin.email });
    const superAdmin = await createUser(db, {
      id: randomUUID(), email: `super-admin-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Super Admin',
    });
    await db.query(`UPDATE users SET role='super_admin' WHERE id=$1`, [superAdmin.id]);
    superAdminToken = signAuthToken(env, { sub: superAdmin.id, role: 'super_admin', email: superAdmin.email });
    const customer = await createUser(db, {
      id: randomUUID(), email: `customer-${randomUUID()}@example.com`, passwordHash: 'hash', fullName: 'Customer',
    });
    customerToken = signAuthToken(env, { sub: customer.id, role: 'customer', email: customer.email });
  });

  afterAll(async () => { await db.close(); setKeyRingForTesting(null); vi.unstubAllEnvs(); });
  afterEach(() => vi.unstubAllGlobals());

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
      expect(Object.keys(credential).sort()).toEqual(['description', 'fallbackName', 'name', 'present', 'required', 'stored', 'suffix']);
    }
    expect(body.images).toEqual({ total: 0, verifiedActive: 0 });
    await app.close();
  });

  it('lets only super admins save encrypted credentials and connect through a real adapter request', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const created = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers', headers: auth(adminToken),
      payload: {
        name: 'Hetzner Dashboard', slug: `hetzner-dash-${randomUUID().slice(0, 8)}`, providerType: 'HETZNER',
        adapter: 'hetzner', status: 'CONFIGURATION_REQUIRED', apiBaseUrl: 'https://api.hetzner.test/v1',
        credentialEnvPrefix: 'HETZNER_DASHBOARD',
      },
    });
    expect(created.statusCode).toBe(201);
    const providerId = created.json().provider.id as string;
    const secret = `hcloud-${randomUUID()}`;

    const denied = await app.inject({
      method: 'POST', url: `/api/v1/admin/providers/${providerId}/connect`, headers: auth(adminToken),
      payload: { credentials: { _API_TOKEN: secret } },
    });
    expect(denied.statusCode).toBe(403);

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ servers: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    const connected = await app.inject({
      method: 'POST', url: `/api/v1/admin/providers/${providerId}/connect`, headers: auth(superAdminToken),
      payload: { credentials: { _API_TOKEN: secret } },
    });
    expect(connected.statusCode, connected.body).toBe(200);
    expect(connected.json().result).toMatchObject({ status: 'connected', code: null });
    expect(connected.json().provider).toMatchObject({ status: 'ACTIVE', lastHealthStatus: 'HEALTHY' });
    expect(JSON.stringify(connected.json())).not.toContain(secret);

    const firstCall = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(String(firstCall[0])).toBe('https://api.hetzner.test/v1/servers?per_page=1');
    expect(new Headers(firstCall[1]?.headers).get('authorization')).toBe(`Bearer ${secret}`);

    const stored = await db.query<{ encrypted_credentials: string; credential_names: unknown }>(
      `SELECT encrypted_credentials,credential_names FROM infrastructure_provider_credentials WHERE provider_id=$1`,
      [providerId]
    );
    expect(stored.rows[0]?.encrypted_credentials).toBeTruthy();
    expect(stored.rows[0]?.encrypted_credentials).not.toContain(secret);
    expect(JSON.parse(decryptSecret(buildKeyRing(encryptionKey), stored.rows[0]!.encrypted_credentials)))
      .toEqual({ _API_TOKEN: secret });
    expect(stored.rows[0]?.credential_names).toEqual(['_API_TOKEN']);

    const report = await app.inject({
      method: 'GET', url: `/api/v1/admin/providers/${providerId}/configuration`, headers: auth(adminToken),
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().configuration.credentials[0]).toMatchObject({
      name: 'HETZNER_DASHBOARD_API_TOKEN', suffix: '_API_TOKEN', present: true, stored: true,
    });
    expect(JSON.stringify(report.json())).not.toContain(secret);
    await app.close();
  });

  it('keeps a provider inactive when the provider rejects the saved API credentials', async () => {
    const app = buildApp(env, { serveFrontend: false, pool: db });
    const created = await app.inject({
      method: 'POST', url: '/api/v1/admin/providers', headers: auth(adminToken),
      payload: {
        name: 'Rejected Hetzner', slug: `hetzner-no-${randomUUID().slice(0, 8)}`, providerType: 'HETZNER',
        adapter: 'hetzner', status: 'CONFIGURATION_REQUIRED', apiBaseUrl: 'https://api.hetzner.test/v1',
        credentialEnvPrefix: 'HETZNER_REJECTED',
      },
    });
    const providerId = created.json().provider.id as string;
    const secret = `bad-${randomUUID()}`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401, headers: { 'content-type': 'application/json' },
    })));

    const result = await app.inject({
      method: 'POST', url: `/api/v1/admin/providers/${providerId}/connect`, headers: auth(superAdminToken),
      payload: { credentials: { _API_TOKEN: secret } },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().result).toMatchObject({ status: 'failed', code: 'AUTHENTICATION_FAILED' });
    expect(result.json().result.message).toContain('rejected the credentials');
    expect(result.json().provider.status).toBe('UNAVAILABLE');
    expect(JSON.stringify(result.json())).not.toContain(secret);
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
