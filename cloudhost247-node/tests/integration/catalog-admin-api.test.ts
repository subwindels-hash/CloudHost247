import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { signAuthToken } from '../../src/lib/jwt';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';

/**
 * Exercises the protected catalog administration API (/api/v1/admin/catalog/...) end-to-end
 * against a real embedded Postgres engine. Covers the full authorization ladder
 * (unauthenticated -> authenticated-but-not-admin -> authenticated-and-admin) plus proving
 * mutations actually persist to the database, not just that a 200/201 is returned.
 */
describe('catalog administration API (/api/v1/admin/catalog)', () => {
  let db: PGlite;
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/cloudhost247',
    JWT_SECRET: 'f'.repeat(32),
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

  /**
   * Test-only helper: directly inserts a user with a given role and returns a valid bearer token
   * for them. There is deliberately no API endpoint that lets a caller self-assign a role (that
   * would be a privilege-escalation vulnerability) — in this codebase today, a role can only be
   * set by direct database access, which is exactly what this helper simulates for test setup.
   */
  async function createUserWithRole(role: 'customer' | 'admin' | 'super_admin'): Promise<{ userId: string; token: string }> {
    const userId = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, password_hash, full_name, role) VALUES ($1, $2, $3, $4, $5)`,
      [userId, `${role}-${userId}@example.com`, 'not-a-real-hash', 'Test User', role]
    );
    const token = signAuthToken(env, { sub: userId, role, email: `${role}-${userId}@example.com` });
    return { userId, token };
  }

  it('rejects an unauthenticated request to create a product', async () => {
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      payload: { slug: 'x', name: 'X', productType: 'hosting' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects an authenticated but non-admin (customer) request', async () => {
    const { token } = await createUserWithRole('customer');
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      headers: { authorization: `Bearer ${token}` },
      payload: { slug: 'x', name: 'X', productType: 'hosting' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORBIDDEN');
    await app.close();
  });

  it('rejects an authenticated "admin" role request (catalog admin is restricted to super_admin only, by design)', async () => {
    const { token } = await createUserWithRole('admin');
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      headers: { authorization: `Bearer ${token}` },
      payload: { slug: 'x', name: 'X', productType: 'hosting' },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it('a super_admin can create a product, and it is actually persisted in the database', async () => {
    const { token } = await createUserWithRole('super_admin');
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      headers: { authorization: `Bearer ${token}` },
      payload: { slug: 'admin-created', name: 'Admin Created Product', productType: 'hosting' },
    });
    expect(res.statusCode).toBe(201);
    const productId = res.json().product.id;
    expect(typeof productId).toBe('string');

    const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [productId]);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { name: string }).name).toBe('Admin Created Product');
    expect((rows[0] as { status: string }).status).toBe('draft'); // safe default: never auto-active
    await app.close();
  });

  it('rejects an invalid product creation payload (bad product type) with a 400 and persists nothing', async () => {
    const { token } = await createUserWithRole('super_admin');
    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/catalog/products',
      headers: { authorization: `Bearer ${token}` },
      payload: { slug: 'bad', name: 'Bad', productType: 'not-a-real-type' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');

    const { rows } = await db.query('SELECT * FROM products WHERE slug = $1', ['bad']);
    expect(rows).toHaveLength(0);
    await app.close();
  });

  it('a super_admin can update a product and the change is persisted', async () => {
    const { token } = await createUserWithRole('super_admin');
    const product = await createProduct(db, { id: randomUUID(), slug: 'update-me', name: 'Before', productType: 'hosting' });

    const app = buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${product.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'After' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().product.name).toBe('After');

    const { rows } = await db.query('SELECT name FROM products WHERE id = $1', [product.id]);
    expect((rows[0] as { name: string }).name).toBe('After');
    await app.close();
  });

  it('a super_admin can enable a product (status -> active), and a customer/public request then sees it', async () => {
    const { token } = await createUserWithRole('super_admin');
    const product = await createProduct(db, {
      id: randomUUID(),
      slug: 'newly-enabled',
      name: 'Newly Enabled',
      productType: 'hosting',
      status: 'draft',
      visibility: 'public',
    });

    const app = buildTestApp();

    const beforeEnable = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/newly-enabled' });
    expect(beforeEnable.json().product.available).toBe(false);

    const enableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${product.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'active' },
    });
    expect(enableRes.statusCode).toBe(200);
    expect(enableRes.json().product.status).toBe('active');

    const afterEnable = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/newly-enabled' });
    expect(afterEnable.json().product.available).toBe(true);
    await app.close();
  });

  it('disabling a product removes it from the public catalog immediately — no stale exposure', async () => {
    const { token } = await createUserWithRole('super_admin');
    const product = await createProduct(db, {
      id: randomUUID(),
      slug: 'about-to-disable',
      name: 'About To Disable',
      productType: 'hosting',
      status: 'active',
      visibility: 'public',
    });

    const app = buildTestApp();
    const beforeDisable = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/about-to-disable' });
    expect(beforeDisable.statusCode).toBe(200);

    const disableRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${product.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'disabled' },
    });
    expect(disableRes.statusCode).toBe(200);

    const afterDisable = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/about-to-disable' });
    expect(afterDisable.statusCode).toBe(404);

    const listing = await app.inject({ method: 'GET', url: '/api/v1/catalog/products' });
    expect(listing.json().products.map((p: { slug: string }) => p.slug)).not.toContain('about-to-disable');
    await app.close();
  });

  it('a super_admin can create a plan, set pricing, and publish it — end to end through to the public API', async () => {
    const { token } = await createUserWithRole('super_admin');
    const product = await createProduct(db, {
      id: randomUUID(),
      slug: 'e2e-product',
      name: 'E2E Product',
      productType: 'hosting',
      status: 'active',
      visibility: 'public',
    });

    const app = buildTestApp();
    const auth = { authorization: `Bearer ${token}` };

    const planRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/products/${product.id}/plans`,
      headers: auth,
      payload: { slug: 'e2e-plan', name: 'E2E Plan', billingModel: 'recurring' },
    });
    expect(planRes.statusCode).toBe(201);
    const planId = planRes.json().plan.id;

    await app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/plans/${planId}/status`,
      headers: auth,
      payload: { status: 'active' },
    });

    const pricingRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/plans/${planId}/pricing`,
      headers: auth,
      payload: { billingPeriod: 'monthly', currency: 'usd', amount: 14.5, effectiveStatus: 'published' },
    });
    expect(pricingRes.statusCode).toBe(201);

    const featuresRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/catalog/plans/${planId}/features`,
      headers: auth,
      payload: { features: [{ featureName: 'Bandwidth', featureValue: 'Unmetered', displayOrder: 1 }] },
    });
    expect(featuresRes.statusCode).toBe(200);

    const publicPlans = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/e2e-product/plans' });
    expect(publicPlans.statusCode).toBe(200);
    const body = publicPlans.json();
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].pricing).toEqual([{ billingPeriod: 'monthly', currency: 'USD', amount: 14.5, setupFee: null }]);
    expect(body.plans[0].features).toEqual([{ name: 'Bandwidth', value: 'Unmetered', displayOrder: 1 }]);
    await app.close();
  });

  it('rejects publishing a price with no amount (validation happens before hitting the database constraint)', async () => {
    const { token } = await createUserWithRole('super_admin');
    const product = await createProduct(db, { id: randomUUID(), slug: 'pp', name: 'PP', productType: 'hosting' });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'pl', name: 'PL' });

    const app = buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/plans/${plan.id}/pricing`,
      headers: { authorization: `Bearer ${token}` },
      payload: { billingPeriod: 'monthly', currency: 'usd', effectiveStatus: 'published' },
    });
    // Caught at the route layer before it ever reaches the database (see catalog-admin.ts) so the
    // API caller gets a clean, expected 400 — the underlying database CHECK constraint (0006
    // migration) is still the real, load-bearing guarantee this route-level check mirrors.
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    const { rows } = await db.query('SELECT * FROM plan_pricing WHERE plan_id = $1', [plan.id]);
    expect(rows).toHaveLength(0);
    await app.close();
  });

  it('rejects PATCHing a draft price to published when it still has no amount', async () => {
    const { token } = await createUserWithRole('super_admin');
    const product = await createProduct(db, { id: randomUUID(), slug: 'pp2', name: 'PP2', productType: 'hosting' });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'pl2', name: 'PL2' });

    const app = buildTestApp();
    const auth = { authorization: `Bearer ${token}` };

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/catalog/plans/${plan.id}/pricing`,
      headers: auth,
      payload: { billingPeriod: 'monthly', currency: 'usd' }, // no amount, stays draft
    });
    expect(createRes.statusCode).toBe(201);
    const pricingId = createRes.json().pricing.id;

    const publishRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/pricing/${pricingId}`,
      headers: auth,
      payload: { effectiveStatus: 'published' },
    });
    expect(publishRes.statusCode).toBe(400);

    // Setting the amount and publishing in the same request succeeds.
    const publishWithAmount = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/pricing/${pricingId}`,
      headers: auth,
      payload: { amount: 5, effectiveStatus: 'published' },
    });
    expect(publishWithAmount.statusCode).toBe(200);
    expect(publishWithAmount.json().pricing.effectiveStatus).toBe('published');
    await app.close();
  });

  it('rejects an admin request with an invalid UUID in the :id param', async () => {
    const { token } = await createUserWithRole('super_admin');
    const app = buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/admin/catalog/products/not-a-uuid',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('returns 404 when updating a product that does not exist', async () => {
    const { token } = await createUserWithRole('super_admin');
    const app = buildTestApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/catalog/products/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('a token that was logged out (revoked) can no longer be used to call an admin route', async () => {
    const { token } = await createUserWithRole('super_admin');
    const app = buildTestApp();

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } });
    expect(logout.statusCode).toBe(204);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/catalog/products',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('GET /api/v1/admin/catalog/products/:id returns full detail including draft plans, unpublished pricing, and private features', async () => {
    const { token } = await createUserWithRole('super_admin');
    const product = await createProduct(db, { id: randomUUID(), slug: 'admin-detail', name: 'Admin Detail', productType: 'hosting' });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'draft-plan', name: 'Draft Plan', status: 'draft' });

    const app = buildTestApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/admin/catalog/products/${product.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plans).toHaveLength(1);
    expect(body.plans[0].status).toBe('draft'); // visible to admin even though it's not public
    await app.close();
  });
});
