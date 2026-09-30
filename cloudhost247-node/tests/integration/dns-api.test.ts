import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { randomUUID } from 'node:crypto';

describe('DNS Management API Integration', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: any;
  let env: Env;
  let user1Token: string;
  let user2Token: string;
  const user1Id = randomUUID();
  const user2Id = randomUUID();

  beforeEach(async () => {
    env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
      JWT_SECRET: 'f'.repeat(32),
      SERVER_AGENT_SHARED_SECRET: 's'.repeat(32),
    } as NodeJS.ProcessEnv);

    db = new PGlite();
    client = new PgliteClient(db);
    await migrateUp(client, { allowProduction: true });

    // Seed test users
    await client.exec(`
      INSERT INTO users (id, email, password_hash, full_name, role, status)
      VALUES 
        ('${user1Id}', 'user1@example.com', 'hash', 'User One', 'customer', 'active'),
        ('${user2Id}', 'user2@example.com', 'hash', 'User Two', 'customer', 'active');
    `);

    user1Token = signAuthToken(env, { sub: user1Id, email: 'user1@example.com', role: 'customer' });
    user2Token = signAuthToken(env, { sub: user2Id, email: 'user2@example.com', role: 'customer' });

    app = buildApp(env, { serveFrontend: false, pool: client as any });
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  it('creates a new DNS zone with default nameservers', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: { authorization: `Bearer ${user1Token}` },
      payload: {
        domainName: 'example-company.com',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.zone.domain_name).toBe('example-company.com');
    expect(body.zone.status).toBe('ACTIVE');
    expect(body.zone.nameservers).toContain('ns1.cloudhost247.com');

    // Fetch zone details and verify initial default NS records
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dns/zones/${body.zone.id}`,
      headers: { authorization: `Bearer ${user1Token}` },
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.payload);
    expect(getBody.records.length).toBeGreaterThanOrEqual(2);
    expect(getBody.records.some((r: any) => r.type === 'NS')).toBe(true);
  });

  it('rejects duplicate zone creation with 409 Conflict', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: { authorization: `Bearer ${user1Token}` },
      payload: { domainName: 'duplicate-test.com' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: { authorization: `Bearer ${user2Token}` },
      payload: { domainName: 'duplicate-test.com' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('allows adding, updating, and deleting DNS records', async () => {
    // 1. Create Zone
    const zoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: { authorization: `Bearer ${user1Token}` },
      payload: { domainName: 'myapp-production.net' },
    });
    const zoneId = JSON.parse(zoneRes.payload).zone.id;

    // 2. Add A Record
    const createRecRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dns/zones/${zoneId}/records`,
      headers: { authorization: `Bearer ${user1Token}` },
      payload: {
        name: '@',
        type: 'A',
        content: '198.51.100.25',
        ttl: 300,
      },
    });
    expect(createRecRes.statusCode).toBe(201);
    const record = JSON.parse(createRecRes.payload).record;
    expect(record.content).toBe('198.51.100.25');

    // 3. Add CNAME Record
    const cnameRes = await app.inject({
      method: 'POST',
      url: `/api/v1/dns/zones/${zoneId}/records`,
      headers: { authorization: `Bearer ${user1Token}` },
      payload: {
        name: 'www',
        type: 'CNAME',
        content: 'myapp-production.net',
        ttl: 3600,
      },
    });
    expect(cnameRes.statusCode).toBe(201);

    // 4. Update A Record
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/dns/zones/${zoneId}/records/${record.id}`,
      headers: { authorization: `Bearer ${user1Token}` },
      payload: {
        content: '198.51.100.26',
        ttl: 600,
      },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(JSON.parse(patchRes.payload).record.content).toBe('198.51.100.26');

    // 5. Delete A Record
    const delRecRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dns/zones/${zoneId}/records/${record.id}`,
      headers: { authorization: `Bearer ${user1Token}` },
    });
    expect(delRecRes.statusCode).toBe(204);

    // 6. Delete Zone
    const delZoneRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dns/zones/${zoneId}`,
      headers: { authorization: `Bearer ${user1Token}` },
    });
    expect(delZoneRes.statusCode).toBe(204);
  });

  it('enforces resource ownership across users', async () => {
    // User 1 creates zone
    const zoneRes = await app.inject({
      method: 'POST',
      url: '/api/v1/dns/zones',
      headers: { authorization: `Bearer ${user1Token}` },
      payload: { domainName: 'user1-private.org' },
    });
    const zoneId = JSON.parse(zoneRes.payload).zone.id;

    // User 2 attempts to read User 1's zone
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/dns/zones/${zoneId}`,
      headers: { authorization: `Bearer ${user2Token}` },
    });
    expect(getRes.statusCode).toBe(404);

    // User 2 attempts to delete User 1's zone
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/dns/zones/${zoneId}`,
      headers: { authorization: `Bearer ${user2Token}` },
    });
    expect(delRes.statusCode).toBe(404);
  });
});
