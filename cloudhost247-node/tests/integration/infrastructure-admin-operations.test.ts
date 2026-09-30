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
