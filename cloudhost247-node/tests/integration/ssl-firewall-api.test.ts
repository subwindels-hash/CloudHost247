import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { randomUUID } from 'node:crypto';

describe('SSL Certificates & Firewall Security APIs Integration', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: any;
  let env: Env;
  let userToken: string;
  let otherToken: string;
  const userId = randomUUID();
  const otherId = randomUUID();
  const serverId = randomUUID();

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

    // Seed test users and server with a control panel (cPanel)
    await client.exec(`
      INSERT INTO users (id, email, password_hash, full_name, role, status)
      VALUES 
        ('${userId}', 'owner@example.com', 'hash', 'Server Owner', 'customer', 'active'),
        ('${otherId}', 'other@example.com', 'hash', 'Other User', 'customer', 'active');

      INSERT INTO servers (id, customer_id, name, hostname, server_type, status, control_panel_id, cpu_cores, memory_mb, storage_mb)
      VALUES 
        ('${serverId}', '${userId}', 'vps-cpanel-01', 'vps01.example.com', 'VPS', 'active', '30000000-0000-0000-0000-000000000001', 2, 4096, 80000);
    `);

    userToken = signAuthToken(env, { sub: userId, email: 'owner@example.com', role: 'customer' });
    otherToken = signAuthToken(env, { sub: otherId, email: 'other@example.com', role: 'customer' });

    app = buildApp(env, { serveFrontend: false, pool: client as any });
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  describe('SSL Certificates Lifecycle', () => {
    it('creates and lists SSL certificate requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/ssl/certificates',
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          domainName: 'secure.cloudhost247-demo.com',
          sans: ['api.cloudhost247-demo.com'],
          issuer: 'LETS_ENCRYPT',
          challengeType: 'HTTP_01',
          serverId,
        },
      });

      expect(res.statusCode).toBe(201);
      const cert = JSON.parse(res.payload).certificate;
      expect(cert.domain_name).toBe('secure.cloudhost247-demo.com');
      expect(cert.status).toBe('PENDING');

      // List certificates
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/ssl/certificates',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.payload);
      expect(listBody.certificates.length).toBe(1);

      // Delete certificate
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/ssl/certificates/${cert.id}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(delRes.statusCode).toBe(204);
    });
  });

  describe('Server Firewall Rules & Baseline Security', () => {
    it('applies baseline security rules matching the server control panel', async () => {
      // Apply baseline firewall (cPanel has WHM 2087, cPanel 2083, webmail, HTTP/HTTPS, SSH 22)
      const baseRes = await app.inject({
        method: 'POST',
        url: `/api/v1/servers/${serverId}/firewall/baseline`,
        headers: { authorization: `Bearer ${userToken}` },
      });

      expect(baseRes.statusCode).toBe(201);
      const rules = JSON.parse(baseRes.payload).rules;
      expect(rules.length).toBeGreaterThanOrEqual(5);

      const ports = rules.map((r: any) => r.port_range_start);
      expect(ports).toContain(22); // SSH
      expect(ports).toContain(2087); // WHM
      expect(ports).toContain(2083); // cPanel

      // Add a custom rule
      const customRes = await app.inject({
        method: 'POST',
        url: `/api/v1/servers/${serverId}/firewall`,
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          protocol: 'tcp',
          portRangeStart: 8088,
          description: 'Custom staging proxy',
        },
      });
      expect(customRes.statusCode).toBe(201);
      const customRule = JSON.parse(customRes.payload).rule;

      // Delete the custom rule
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/servers/${serverId}/firewall/${customRule.id}`,
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(delRes.statusCode).toBe(204);
    });

    it('rejects unauthorized access from other users', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/servers/${serverId}/firewall`,
        headers: { authorization: `Bearer ${otherToken}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
