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

  describe('GET /api/v1/control-panels/catalog', () => {
    it('paginates the complete directory, merging live rows without duplicate slugs', async () => {
      const first = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?offset=0&limit=24' });
      const second = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?offset=24&limit=24' });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      const a = JSON.parse(first.payload);
      const b = JSON.parse(second.payload);
      expect(a.total).toBe(1092);
      expect(a.categoryCounts.ALL).toBe(1092);
      expect(a.controlPanels).toHaveLength(24);
      expect(b.controlPanels).toHaveLength(24);
      expect(new Set([...a.controlPanels, ...b.controlPanels].map((p: any) => p.slug)).size).toBe(48);
      expect(a.controlPanels[0].slug).toBe('cpanel'); // the seeded DB row overrides its static listing
      const tail = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?offset=1085&limit=24' });
      expect(JSON.parse(tail.payload).controlPanels).toHaveLength(7);
    });

    it('returns distinct Fasten Health and fazer.ai entries without replacing the legacy identifier', async () => {
      const fasten = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?search=Fasten%20Health' });
      const fazer = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?search=fazer.ai' });
      expect(fasten.statusCode).toBe(200);
      expect(fazer.statusCode).toBe(200);
      expect(JSON.parse(fasten.payload).controlPanels.map((x: any) => [x.id, x.name])).toEqual([['app-fasten-healthfazer-ai-agents', 'Fasten Health']]);
      expect(JSON.parse(fazer.payload).controlPanels.map((x: any) => [x.slug, x.name])).toEqual([['fazerai-agents', 'fazer.ai agents']]);
    });

    it('distinguishes app-directory metadata from configured offers and manifest recipes', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?search=wordpress' });
      expect(response.statusCode).toBe(200);
      const wordpress = JSON.parse(response.payload).controlPanels.find((entry: any) => entry.slug === 'wordpress');
      expect(wordpress).toBeDefined();
      expect(wordpress.catalogSource).toBe('directory');
      expect(wordpress.hasValidatedManifest).toBe(true);
      expect(wordpress.hasPanelBootstrapAdapter).toBe(false);
      expect(wordpress.panelBootstrapProviderVerified).toBe(false);
      expect(wordpress.panelManagementAvailable).toBe(false);
      expect(wordpress.panelManagementProviderVerified).toBe(false);
      expect(wordpress.operationallySupported).toBe(false);
      expect(wordpress.hasPublishedMarketplaceApp).toBe(false);
      expect(wordpress.planCount).toBe(0);
      expect(wordpress.startingPrice).toBeNull();
    });

    it('searches and filters beyond the first page and validates page sizes', async () => {
      const filtered = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?search=galaxy&license=FREE&limit=24' });
      const result = JSON.parse(filtered.payload);
      expect(filtered.statusCode).toBe(200);
      expect(result.controlPanels.some((p: any) => p.slug === 'galaxy')).toBe(true);
      expect(result.controlPanels.every((p: any) => !p.requiresLicense)).toBe(true);
      expect(result.categoryCounts.ALL).toBe(1092);

      const osOnly = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?category=OPERATING_SYSTEM&limit=8' });
      expect(JSON.parse(osOnly.payload).controlPanels.every((p: any) => p.category === 'OPERATING_SYSTEM')).toBe(true);
      const oversized = await app.inject({ method: 'GET', url: '/api/v1/control-panels/catalog?limit=1091' });
      expect(oversized.statusCode).toBe(400);
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
      expect(body.controlPanel.catalogSource).toBe('configured');
      expect(body.controlPanel.hasPanelBootstrapAdapter).toBe(true);
      expect(body.controlPanel.panelBootstrapProviderVerified).toBe(false);
      expect(body.controlPanel.panelManagementAvailable).toBe(false);
      expect(body.controlPanel.panelManagementProviderVerified).toBe(false);
      expect(body.controlPanel.operationallySupported).toBe(false);
      expect(body.controlPanel.panelOperations).toHaveLength(22);
      expect(body.controlPanel.panelOperations.find((operation: any) => operation.operation === 'Install')).toMatchObject({
        implemented: false,
        providerVerified: false,
      });
    });

    it('returns detail metadata for directory-only apps without inventing a plan', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/control-panels/wordpress' });
      expect(res.statusCode).toBe(200);
      const panel = JSON.parse(res.payload).controlPanel;
      expect(panel).toMatchObject({
        slug: 'wordpress',
        catalogSource: 'directory',
        status: 'DIRECTORY_ONLY',
        hasValidatedManifest: true,
        hasPanelBootstrapAdapter: false,
        panelBootstrapProviderVerified: false,
        panelManagementAvailable: false,
        panelManagementProviderVerified: false,
        operationallySupported: false,
        hasPublishedMarketplaceApp: false,
        planCount: 0,
        startingPrice: null,
        plans: [],
      });
      expect(panel.panelOperations.find((operation: any) => operation.operation === 'Install')).toMatchObject({
        implemented: false,
        providerVerified: false,
        reason: 'No CloudHost247 control-panel adapter is registered for this entry.',
      });
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
