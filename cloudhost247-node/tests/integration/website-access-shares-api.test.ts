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
 * Exercises the website access sharing API (J03 — J Agency) end-to-end against a real
 * embedded Postgres engine (pglite).
 *
 *   - Customers can create shares for sites they grant access to.
 *   - Customers can list shares they granted or received.
 *   - Customers can update/revoke shares they granted.
 *   - Staff can manage any share.
 *   - Customers cannot access shares they're not involved in (404).
 *   - Duplicate active shares are rejected (400).
 *
 * Every test inserts its own fixture users, sites and shares directly through
 * the database. Tokens are minted with `signAuthToken` using the test JWT_SECRET.
 */
describe('website access shares API (J03)', () => {
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
    status: 'active' | 'suspended' | 'disabled' = 'active',
  ): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    const passwordHash = await hashPassword('correct-horse-battery');
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role, status, username)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (lower(email)) DO UPDATE SET status = $6`,
      [userId, email, passwordHash, email.split('@')[0], role, status, email.split('@')[0]],
    );
    const token = signAuthToken(env, { sub: userId, role, email });
    return { userId, token: `Bearer ${token}` };
  }

  async function createSite(userId: string, name: string): Promise<string> {
    const siteId = randomUUID();
    await db.query(
      `INSERT INTO builder_sites (id, user_id, name, slug, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'draft', now(), now())`,
      [siteId, userId, name, name.toLowerCase().replace(/\s+/g, '-')],
    );
    return siteId;
  }

  it('customer can create a website access share', async () => {
    const app = buildTestApp();
    const { userId: grantorId, token: grantorToken } = await createUserAccount('share-grantor@example.com', 'customer');
    const { userId: granteeId } = await createUserAccount('share-grantee@example.com', 'customer');
    const siteId = await createSite(grantorId, 'My Site');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: grantorToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: siteId,
        granted_to_user_id: granteeId,
        permission_level: 'editor',
      }),
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { website_access_share: { site_id: string; granted_to_user_id: string; permission_level: string; status: string } };
    expect(body.website_access_share.site_id).toBe(siteId);
    expect(body.website_access_share.granted_to_user_id).toBe(granteeId);
    expect(body.website_access_share.permission_level).toBe('editor');
    expect(body.website_access_share.status).toBe('active');

    await app.close();
  });

  it('customer can list shares they granted', async () => {
    const app = buildTestApp();
    const { userId: grantorId, token: grantorToken } = await createUserAccount('share-list-grantor@example.com', 'customer');
    const { userId: granteeId } = await createUserAccount('share-list-grantee@example.com', 'customer');
    const siteId = await createSite(grantorId, 'Shared Site');

    await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: grantorToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'viewer' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: grantorToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { website_access_shares: Array<{ granted_by_user_id: string; granted_to_user_id: string }> };
    expect(body.website_access_shares.length).toBeGreaterThanOrEqual(1);
    expect(body.website_access_shares.some((s) => s.granted_by_user_id === grantorId && s.granted_to_user_id === granteeId)).toBe(true);

    await app.close();
  });

  it('customer can list shares received by them', async () => {
    const app = buildTestApp();
    const { userId: grantorId, token: grantorToken } = await createUserAccount('share-receive-grantor@example.com', 'customer');
    const { userId: granteeId, token: granteeToken } = await createUserAccount('share-receive-grantee@example.com', 'customer');
    const siteId = await createSite(grantorId, 'Site to Share');

    await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: grantorToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'viewer' }),
    });

    // Grantee lists shares (granted_to filter matching their own id)
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agency/website-access/shares?granted_to_user_id=${granteeId}`,
      headers: { Authorization: granteeToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { website_access_shares: Array<{ granted_to_user_id: string }> };
    expect(body.website_access_shares.some((s) => s.granted_to_user_id === granteeId)).toBe(true);

    await app.close();
  });

  it('staff can list all shares', async () => {
    const app = buildTestApp();
    const { token: staffToken } = await createUserAccount('share-staff@example.com', 'staff');
    const { userId: userA } = await createUserAccount('share-staff-a@example.com', 'customer');
    const { userId: userB } = await createUserAccount('share-staff-b@example.com', 'customer');
    const siteId = await createSite(userA, 'Staff Site');

    await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: `Bearer ${signAuthToken(env, { sub: userA, role: 'customer', email: 'share-staff-a@example.com' })}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: userB, permission_level: 'editor' }),
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: staffToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { website_access_shares: Array<{ site_id: string }> };
    expect(body.website_access_shares.length).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it('customer can get a share they are involved in', async () => {
    const app = buildTestApp();
    const { userId: grantorId, token: grantorToken } = await createUserAccount('share-get-grantor@example.com', 'customer');
    const { userId: granteeId } = await createUserAccount('share-get-grantee@example.com', 'customer');
    const siteId = await createSite(grantorId, 'Get Site');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: grantorToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'viewer' }),
    });
    const shareId = (create.json() as { website_access_share: { id: string } }).website_access_share.id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agency/website-access/shares/${shareId}`,
      headers: { Authorization: grantorToken },
    });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it('customer cannot access a share they are not involved in (404)', async () => {
    const app = buildTestApp();
    const { userId: grantorId, token: grantorToken } = await createUserAccount('share-noaccess-grantor@example.com', 'customer');
    const { userId: granteeId } = await createUserAccount('share-noaccess-grantee@example.com', 'customer');
    const siteId = await createSite(grantorId, 'Private Share');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: grantorToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'viewer' }),
    });
    const shareId = (create.json() as { website_access_share: { id: string } }).website_access_share.id;

    const { userId: strangerId } = await createUserAccount('share-stranger@example.com', 'customer');
    const tokenStranger = `Bearer ${signAuthToken(env, { sub: strangerId, role: 'customer', email: 'share-stranger@example.com' })}`;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/agency/website-access/shares/${shareId}`,
      headers: { Authorization: tokenStranger },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });

  it('customer can update permission_level on their own share', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('share-update@example.com', 'customer');
    const { userId: granteeId } = await createUserAccount('share-update-grantee@example.com', 'customer');
    const siteId = await createSite(userId, 'Updatable Share');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'viewer' }),
    });
    const shareId = (create.json() as { website_access_share: { id: string } }).website_access_share.id;

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agency/website-access/shares/${shareId}`,
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission_level: 'editor' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { website_access_share: { permission_level: string } };
    expect(body.website_access_share.permission_level).toBe('editor');

    await app.close();
  });

  it('customer cannot update a share they did not grant (403)', async () => {
    const app = buildTestApp();
    const { userId: grantorId, token: grantorToken } = await createUserAccount('share-noupdate-grantor@example.com', 'customer');
    const { userId: granteeId } = await createUserAccount('share-noupdate-grantee@example.com', 'customer');
    const siteId = await createSite(grantorId, 'No Update Share');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: grantorToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'viewer' }),
    });
    const shareId = (create.json() as { website_access_share: { id: string } }).website_access_share.id;

    const tokenGrantee = `Bearer ${signAuthToken(env, { sub: granteeId, role: 'customer', email: 'share-noupdate-grantee@example.com' })}`;
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/agency/website-access/shares/${shareId}`,
      headers: { Authorization: tokenGrantee, 'Content-Type': 'application/json' },
      body: JSON.stringify({ permission_level: 'editor' }),
    });
    expect(res.statusCode).toBe(403);

    await app.close();
  });

  it('customer can revoke their own share', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('share-revoke@example.com', 'customer');
    const { userId: granteeId } = await createUserAccount('share-revoke-grantee@example.com', 'customer');
    const siteId = await createSite(userId, 'Revocable Share');

    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'viewer' }),
    });
    const shareId = (create.json() as { website_access_share: { id: string } }).website_access_share.id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/agency/website-access/shares/${shareId}`,
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { website_access_share: { status: string } };
    expect(body.website_access_share.status).toBe('revoked');

    await app.close();
  });

  it('rejects duplicate active share (400)', async () => {
    const app = buildTestApp();
    const { userId, token } = await createUserAccount('share-dup@example.com', 'customer');
    const { userId: granteeId } = await createUserAccount('share-dup-grantee@example.com', 'customer');
    const siteId = await createSite(userId, 'Duplicate Share');

    await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'viewer' }),
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/agency/website-access/shares',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: siteId, granted_to_user_id: granteeId, permission_level: 'editor' }),
    });
    expect(res.statusCode).toBe(400);

    await app.close();
  });

  it('returns 404 for a missing share', async () => {
    const app = buildTestApp();
    const { token } = await createUserAccount('share-missing@example.com', 'customer');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/agency/website-access/shares/00000000-0000-0000-0000-000000000000',
      headers: { Authorization: token },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
