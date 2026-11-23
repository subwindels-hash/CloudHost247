import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';
import { randomUUID } from 'node:crypto';

/**
 * Exercises the WordPress hosting API (A02) end-to-end against a real embedded
 * Postgres engine (pglite).
 *
 *   - Customers can clone, stage and migrate their own WordPress installations.
 *   - Jobs are enqueued but not executed (WP-CLI bridge not configured) — honest
     about the absence rather than fabricating success.
 *   - Customers cannot access other customers' installations (404, not 403).
 *
 * Every test inserts its own fixture users and installations directly through the
 * database. Tokens are minted with `signAuthToken` using the test JWT_SECRET.
 */
describe('WordPress hosting API (A02)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'e'.repeat(32),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function buildTestApp() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUserAccount(
    email: string,
    role: 'customer' | 'staff' | 'admin' | 'super_admin',
    status: 'active' | 'suspended' | 'disabled' = 'active'
  ): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lower(email)) DO UPDATE SET status = $6`,
      [userId, email, passwordHash, email.split('@')[0], role, status, email.split('@')[0]]
    );
    const token = signAuthToken(env, { sub: userId, role, email });
    return { userId, token: `Bearer ${token}` };
  }

  async function createApplication(
    slug: string,
    name: string,
  ): Promise<string> {
    const appId = randomUUID();
    await db.query(
      `INSERT INTO applications (id, category_id, name, slug, description, deployment_type, status, created_at, updated_at)
       VALUES ($1, NULL, $2, $3, $4, 'docker_compose', 'published', now(), now())`,
      [appId, name, slug, `WordPress application for testing`]
    );
    return appId;
  }

  async function createApplicationVersion(appId: string, version: string): Promise<string> {
    const versionId = randomUUID();
    await db.query(
      `INSERT INTO application_versions (id, application_id, version, manifest, status, is_stable, created_at, updated_at)
       VALUES ($1, $2, $3, '{}'::jsonb, 'published', true, now(), now())`,
      [versionId, appId, version]
    );
    return versionId;
  }

  async function createServer(): Promise<string> {
    const serverId = randomUUID();
    await db.query(
      `INSERT INTO servers (id, name, hostname, server_type, provider, region, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'VPS', 'test', 'test-region', 'active', now(), now())`,
      [serverId, 'Test Server', 'test-server.example.com']
    );
    return serverId;
  }

  async function createInstallation(
    userId: string,
    appId: string,
    versionId: string,
    domain: string,
    serverId?: string,
  ): Promise<string> {
    const installationId = randomUUID();
    await db.query(
      `INSERT INTO application_installations
         (id, customer_id, application_id, application_version_id, server_id, name, status, domain, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'healthy', $7, now(), now())`,
      [installationId, userId, appId, versionId, serverId ?? null, `My ${domain}`, domain]
    );
    return installationId;
  }

  it('customer can clone, stage and migrate their own WordPress installation', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('wp-customer@example.com', 'customer');
    const appId = await createApplication('wordpress', 'WordPress');
    const versionId = await createApplicationVersion(appId, '6.5');
    const serverId = await createServer();
    const installationId = await createInstallation(userId, appId, versionId, 'wp.example.com', serverId);

    // Clone
    const clone = await app.inject({
      method: 'POST',
      url: `/api/v1/wordpress/${installationId}/clone`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cloned WP', domain: 'clone-wp.example.com' }),
    });
    expect(clone.statusCode).toBe(200);
    const cloneBody = clone.json() as { deployment: { id: string; action: string }; created: boolean; notice: string };
    expect(cloneBody.deployment.action).toBe('clone');
    expect(cloneBody.notice).toContain('WP-CLI bridge');

    // Stage
    const stage = await app.inject({
      method: 'POST',
      url: `/api/v1/wordpress/${installationId}/stage`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Staging WP' }),
    });
    expect(stage.statusCode).toBe(200);
    const stageBody = stage.json() as { deployment: { id: string; action: string }; created: boolean; notice: string };
    expect(stageBody.deployment.action).toBe('stage');
    expect(stageBody.notice).toContain('WP-CLI bridge');

    // Migrate
    const migrate = await app.inject({
      method: 'POST',
      url: `/api/v1/wordpress/${installationId}/migrate`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: serverId }),
    });
    expect(migrate.statusCode).toBe(200);
    const migrateBody = migrate.json() as { deployment: { id: string; action: string }; created: boolean; notice: string };
    expect(migrateBody.deployment.action).toBe('migrate');
    expect(migrateBody.notice).toContain('WP-CLI bridge');

    await app.close();
  });

  it('customer cannot access another customer WordPress installation (404)', async () => {
    const app = buildTestApp();
    const { userId: userA, token: tokenA } = await createUserAccount('wp-user-a@example.com', 'customer');
    const appId = await createApplication('wordpress', 'WordPress');
    const versionId = await createApplicationVersion(appId, '6.5');
    const installationId = await createInstallation(userA, appId, versionId, 'a.example.com');

    // User B tries to clone User A's installation — gets 404.
    const { userId: userB } = await createUserAccount('wp-user-b@example.com', 'customer');
    const tokenB = `Bearer ${signAuthToken(env, { sub: userB, role: 'customer', email: 'wp-user-b@example.com' })}`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/wordpress/${installationId}/clone`,
      headers: { Authorization: tokenB, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Stolen WP' }),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('rejects invalid server_id on migrate', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('wp-invalid@example.com', 'customer');
    const appId = await createApplication('wordpress', 'WordPress');
    const versionId = await createApplicationVersion(appId, '6.5');
    const installationId = await createInstallation(userId, appId, versionId, 'invalid.example.com');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/wordpress/${installationId}/migrate`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ server_id: 'not-a-uuid' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for a missing installation', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('wp-missing@example.com', 'customer');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/wordpress/00000000-0000-0000-0000-000000000000/clone',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Missing WP' }),
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
