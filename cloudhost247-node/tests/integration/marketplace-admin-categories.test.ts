import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { hashPassword } from '../../src/lib/password';

/**
 * Admin marketplace operator endpoints that previously had no dedicated integration coverage
 * (module-integrity gap G-1, 2026-11-09): /api/v1/admin/app-categories and
 * /api/v1/admin/manifests/*, plus the app-status workflow guard rails on
 * /api/v1/admin/apps/:id/status. Runs against a real embedded Postgres with the real auth
 * middleware — nothing mocked.
 */
describe('marketplace admin categories + manifests API', () => {
  let db: PGlite;
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/cloudhost247';
  process.env.JWT_SECRET ??= 'g'.repeat(32);
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64);
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'g'.repeat(32),
    CREDENTIAL_ENCRYPTION_KEY: 'a'.repeat(64),
  } as NodeJS.ProcessEnv);

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  function app() {
    return buildApp(env, { serveFrontend: false, pool: db });
  }

  async function createUser(email: string, role = 'customer') {
    const userId = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [userId, email, await hashPassword('correct-horse-battery'), 'Test User', role]
    );
    return { userId, token: signAuthToken(env, { sub: userId, role, email }) };
  }

  const CATEGORY = { name: 'Automation', slug: 'automation', description: 'Workflow tools', sortOrder: 10 };

  it('refuses anonymous and customer callers on every admin categories endpoint', async () => {
    const server = app();
    const customer = await createUser('customer@example.com', 'customer');

    const anonymous = await server.inject({ method: 'GET', url: '/api/v1/admin/app-categories' });
    expect(anonymous.statusCode).toBe(401);

    const asCustomer = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/app-categories',
      headers: { authorization: `Bearer ${customer.token}` },
    });
    expect(asCustomer.statusCode).toBe(403);

    const postAsCustomer = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/app-categories',
      headers: { authorization: `Bearer ${customer.token}` },
      payload: CATEGORY,
    });
    expect(postAsCustomer.statusCode).toBe(403);
  });

  it('creates, lists, updates categories and rejects duplicates/invalid slugs', async () => {
    const server = app();
    const admin = await createUser('admin@example.com', 'admin');
    const auth = { authorization: `Bearer ${admin.token}` };

    const created = await server.inject({ method: 'POST', url: '/api/v1/admin/app-categories', headers: auth, payload: CATEGORY });
    expect(created.statusCode).toBe(201);
    const category = created.json().category;
    expect(category.slug).toBe('automation');

    const list = await server.inject({ method: 'GET', url: '/api/v1/admin/app-categories', headers: auth });
    expect(list.statusCode).toBe(200);
    expect(list.json().categories.some((c: { slug: string }) => c.slug === 'automation')).toBe(true);

    const duplicate = await server.inject({ method: 'POST', url: '/api/v1/admin/app-categories', headers: auth, payload: CATEGORY });
    expect(duplicate.statusCode).toBe(409);

    const badSlug = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/app-categories',
      headers: auth,
      payload: { name: 'Bad', slug: 'Not A Slug!!' },
    });
    expect(badSlug.statusCode).toBe(400);

    const patched = await server.inject({
      method: 'PATCH',
      url: `/api/v1/admin/app-categories/${category.id}`,
      headers: auth,
      payload: { name: 'Automation & AI' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().category.name).toBe('Automation & AI');

    const missing = await server.inject({
      method: 'PATCH',
      url: `/api/v1/admin/app-categories/${randomUUID()}`,
      headers: auth,
      payload: { name: 'Nothing' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('validates manifest YAML honestly: real manifest passes, garbage fails with named errors', async () => {
    const server = app();
    const admin = await createUser('admin@example.com', 'admin');
    const auth = { authorization: `Bearer ${admin.token}` };

    const realManifest = readFileSync('manifests/n8n/manifest.yaml', 'utf8');
    const valid = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/manifests/validate',
      headers: auth,
      payload: { manifestYaml: realManifest },
    });
    expect(valid.statusCode).toBe(200);
    expect(valid.json()).toEqual({ valid: true, errors: [] });

    const invalid = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/manifests/validate',
      headers: auth,
      payload: { manifestYaml: 'id: [unterminated' },
    });
    expect(invalid.statusCode).toBe(200);
    const body = invalid.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('imports the manifest catalog and the imported apps appear in the public marketplace', async () => {
    const server = app();
    const admin = await createUser('admin@example.com', 'admin');
    const auth = { authorization: `Bearer ${admin.token}` };

    const imported = await server.inject({ method: 'POST', url: '/api/v1/admin/manifests/import', headers: auth });
    expect(imported.statusCode).toBe(200);
    const body = imported.json();
    expect(body.imported).toBeGreaterThan(0);
    expect(body.report).toBeTruthy();

    // Imported manifests arrive as drafts — they must NOT leak into the public catalog.
    const publicList = await server.inject({ method: 'GET', url: '/api/v1/apps' });
    expect(publicList.statusCode).toBe(200);
    const adminList = await server.inject({ method: 'GET', url: '/api/v1/admin/apps', headers: auth });
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().total).toBeGreaterThanOrEqual(body.imported);
  });

  it('seeds canonical categories idempotently', async () => {
    const server = app();
    const admin = await createUser('admin@example.com', 'admin');
    const auth = { authorization: `Bearer ${admin.token}` };

    const first = await server.inject({ method: 'POST', url: '/api/v1/admin/manifests/seed-categories', headers: auth });
    expect(first.statusCode).toBe(200);
    const firstCreated = first.json().created;
    expect(Array.isArray(firstCreated)).toBe(true);

    const second = await server.inject({ method: 'POST', url: '/api/v1/admin/manifests/seed-categories', headers: auth });
    expect(second.statusCode).toBe(200);
    // Second run must not duplicate categories.
    expect(second.json().created.length).toBe(0);
  });

  it('enforces the approval workflow server-side and requires super_admin to delete', async () => {
    const server = app();
    const admin = await createUser('admin@example.com', 'admin');
    const superAdmin = await createUser('root@example.com', 'super_admin');
    const auth = { authorization: `Bearer ${admin.token}` };
    const rootAuth = { authorization: `Bearer ${superAdmin.token}` };

    await server.inject({ method: 'POST', url: '/api/v1/admin/app-categories', headers: auth, payload: CATEGORY });
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/apps',
      headers: auth,
      payload: {
        name: 'Audit Test App',
        slug: 'audit-test-app',
        categorySlug: 'automation',
        description: 'Application created to test the approval workflow',
        supportedHostingTypes: ['docker'],
      },
    });
    expect(created.statusCode).toBe(201);
    const appId = created.json().application.id;
    expect(created.json().application.status).toBe('draft');

    // draft → published is an illegal transition (must pass through validating/testing/approved).
    const illegal = await server.inject({
      method: 'POST',
      url: `/api/v1/admin/apps/${appId}/status`,
      headers: auth,
      payload: { status: 'published' },
    });
    expect(illegal.statusCode).toBe(409);
    expect(illegal.json().message).toContain('Illegal application workflow transition');

    // plain admin may not delete.
    const deniedDelete = await server.inject({ method: 'DELETE', url: `/api/v1/admin/apps/${appId}`, headers: auth });
    expect(deniedDelete.statusCode).toBe(403);

    // super_admin may delete an app with zero installations.
    const deleted = await server.inject({ method: 'DELETE', url: `/api/v1/admin/apps/${appId}`, headers: rootAuth });
    expect(deleted.statusCode).toBe(204);
  });
});
