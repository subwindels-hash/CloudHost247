import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { buildApp } from '../../src/app';
import { loadEnv, type Env } from '../../src/config/env';
import { signAuthToken } from '../../src/lib/jwt';
import { randomUUID } from 'node:crypto';

describe('Control Panels API & Catalog Integration', () => {
  let db: PGlite;
  let client: PgliteClient;
  let app: any;
  let env: Env;
  let adminToken: string;
  let customerToken: string;
  const adminId = randomUUID();
  const customerId = randomUUID();

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

    // Seed test admin and customer users
    await client.exec(`
      INSERT INTO users (id, email, password_hash, full_name, role, status)
      VALUES 
        ('${adminId}', 'admin@cloudhost247.com', 'hash', 'Admin User', 'admin', 'active'),
        ('${customerId}', 'customer@cloudhost247.com', 'hash', 'Customer User', 'customer', 'active');
    `);

    adminToken = signAuthToken(env, { sub: adminId, email: 'admin@cloudhost247.com', role: 'admin' });
    customerToken = signAuthToken(env, { sub: customerId, email: 'customer@cloudhost247.com', role: 'customer' });

    app = buildApp(env, { serveFrontend: false, pool: client as any });
  });

  afterEach(async () => {
    if (app) await app.close();
    await db.close();
  });

  describe('GET /api/v1/control-panels', () => {
    it('returns all 18 seeded control panels with official metadata', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/control-panels',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.controlPanels).toBeDefined();
      expect(body.controlPanels.length).toBe(18);

      const slugs = body.controlPanels.map((p: any) => p.slug);
      expect(slugs).toContain('cpanel');
      expect(slugs).toContain('plesk');
      expect(slugs).toContain('directadmin');
      expect(slugs).toContain('cyberpanel');
      expect(slugs).toContain('webmin');
      expect(slugs).toContain('hestiacp');
      expect(slugs).toContain('cloudpanel');
      expect(slugs).toContain('aapanel');
      expect(slugs).toContain('fastpanel');
      expect(slugs).toContain('webuzo');
      expect(slugs).toContain('tinycp');
      expect(slugs).toContain('kusanagi');
      expect(slugs).toContain('dokploy');
      expect(slugs).toContain('coolify');
      expect(slugs).toContain('easypanel');
      expect(slugs).toContain('cloudron');
      expect(slugs).toContain('cosmos');
      expect(slugs).toContain('adminbolt');

      // Verify Dokploy has PaaS / Docker capabilities
      const dokploy = body.controlPanels.find((p: any) => p.slug === 'dokploy');
      expect(dokploy.category).toBe('APPLICATION_DEPLOYMENT_PLATFORM');
      expect(dokploy.capabilities.docker).toBe(true);
      expect(dokploy.capabilities.traefik).toBe(true);
      expect(dokploy.logoUrl).toBe('/panel-logos/dokploy.svg');
    });

    it('filters control panels by category', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/control-panels?category=APPLICATION_DEPLOYMENT_PLATFORM',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.controlPanels.length).toBeGreaterThan(0);
      body.controlPanels.forEach((p: any) => {
        expect(p.category).toBe('APPLICATION_DEPLOYMENT_PLATFORM');
      });
    });
  });

  describe('GET /api/v1/control-panels/:slug', () => {
    it('returns detail view including commercial plans for cPanel', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/control-panels/cpanel',
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      expect(body.controlPanel.name).toBe('cPanel & WHM');
      expect(body.controlPanel.requiresLicense).toBe(true);
      expect(body.controlPanel.plans.length).toBeGreaterThanOrEqual(3);

      const planNames = body.controlPanel.plans.map((p: any) => p.name);
      expect(planNames).toContain('cPanel Solo');
      expect(planNames).toContain('cPanel Admin (Up to 5 Accounts)');
      expect(planNames).toContain('cPanel Pro (Up to 30 Accounts)');
    });

    it('returns 404 for unknown slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/control-panels/nonexistent-panel',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('Admin Endpoints & RBAC', () => {
    it('rejects unauthenticated requests to admin control panels', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/control-panels',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects customer requests to admin control panels', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/control-panels',
        headers: { authorization: `Bearer ${customerToken}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows admin to list and mutate control panels', async () => {
      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/control-panels',
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(listRes.statusCode).toBe(200);
      const listBody = JSON.parse(listRes.payload);
      expect(listBody.controlPanels.length).toBe(18);

      // Create new panel
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/control-panels',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Custom Test Panel',
          slug: 'custom-test-panel',
          description: 'A test platform for automated verification',
          category: 'SERVER_PANEL',
          minimumRamMb: 1024,
          minimumCpuCores: 2,
          minimumDiskGb: 25,
          supportedOs: ['ubuntu', 'debian'],
          capabilities: { domains: true, ssl: true },
        },
      });
      expect(createRes.statusCode).toBe(201);
      const newPanel = JSON.parse(createRes.payload).controlPanel;
      expect(newPanel.slug).toBe('custom-test-panel');

      // Add a commercial plan to the new panel
      const planRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/control-panel-plans',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          controlPanelId: newPanel.id,
          name: 'Starter Plan',
          price: 9.99,
          billingCycle: 'monthly',
          licenseType: 'STANDARD',
          includedDomains: 5,
        },
      });
      expect(planRes.statusCode).toBe(201);
      const newPlan = JSON.parse(planRes.payload).plan;
      expect(newPlan.name).toBe('Starter Plan');

      // Update the panel
      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/control-panels/${newPanel.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          description: 'Updated description for test platform',
        },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(JSON.parse(patchRes.payload).controlPanel.description).toBe('Updated description for test platform');

      // Delete the created plan and panel
      const delPlanRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/control-panel-plans/${newPlan.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(delPlanRes.statusCode).toBe(204);

      const delPanelRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/control-panels/${newPanel.id}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(delPanelRes.statusCode).toBe(204);
    });
  });
});
