import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env';
import { buildApp } from '../../src/app';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createProduct } from '../../src/db/catalog-products';
import { createPlan } from '../../src/db/catalog-plans';
import { createPricing } from '../../src/db/catalog-pricing';
import { replacePlanFeatures } from '../../src/db/catalog-features';

/**
 * Exercises the public catalog API (GET /api/v1/catalog...) end-to-end against a real embedded
 * Postgres engine (pglite). Every test inserts its own explicit fixture rows directly through the
 * repository functions — nothing here relies on a shared seed script — and each fixture is a
 * throwaway test value (e.g. "Test Hosting Product"), never presented as real CloudHost247
 * pricing/catalog data.
 */
describe('public catalog API (/api/v1/catalog)', () => {
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

  it('GET /api/v1/catalog lists only public, non-disabled products', async () => {
    await createProduct(db, { id: randomUUID(), slug: 'public-active', name: 'Public Active', productType: 'hosting', status: 'active', visibility: 'public' });
    await createProduct(db, { id: randomUUID(), slug: 'private-active', name: 'Private Active', productType: 'hosting', status: 'active', visibility: 'private' });
    await createProduct(db, { id: randomUUID(), slug: 'public-disabled', name: 'Public Disabled', productType: 'hosting', status: 'disabled', visibility: 'public' });

    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.products.map((p: { slug: string }) => p.slug)).toEqual(['public-active']);
    // Internal fields never leak into the public response.
    expect(body.products[0]).not.toHaveProperty('id');
    expect(body.products[0]).not.toHaveProperty('status');
    expect(body.products[0]).not.toHaveProperty('visibility');
    await app.close();
  });

  it('a publicly-listed but draft ("coming soon") product is listed as unavailable, not hidden and not 404', async () => {
    await createProduct(db, {
      id: randomUUID(),
      slug: 'coming-soon',
      name: 'Coming Soon Product',
      productType: 'service',
      status: 'draft',
      visibility: 'public',
    });

    const app = buildTestApp();
    const list = await app.inject({ method: 'GET', url: '/api/v1/catalog/products' });
    expect(list.statusCode).toBe(200);
    const listedProduct = list.json().products.find((p: { slug: string }) => p.slug === 'coming-soon');
    expect(listedProduct).toBeTruthy();
    expect(listedProduct.available).toBe(false);

    const detail = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/coming-soon' });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().product.available).toBe(false);
    expect(detail.json().product.plans).toEqual([]);
    await app.close();
  });

  it('GET /api/v1/catalog/products?type=hosting filters by product type', async () => {
    await createProduct(db, { id: randomUUID(), slug: 'hosting-1', name: 'Hosting 1', productType: 'hosting', status: 'active', visibility: 'public' });
    await createProduct(db, { id: randomUUID(), slug: 'domain-1', name: 'Domain 1', productType: 'domain', status: 'active', visibility: 'public' });

    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?type=hosting' });
    expect(res.statusCode).toBe(200);
    expect(res.json().products.map((p: { slug: string }) => p.slug)).toEqual(['hosting-1']);
    await app.close();
  });

  it('GET /api/v1/catalog/products?type=bogus is rejected as a malformed request (400), not silently ignored', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products?type=bogus' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('GET /api/v1/catalog/products/:slug returns 404 for an unknown slug', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
    await app.close();
  });

  it('GET /api/v1/catalog/products/:slug returns 404 for a private product (never distinguishable from "does not exist")', async () => {
    await createProduct(db, { id: randomUUID(), slug: 'secret-product', name: 'Secret', productType: 'service', status: 'active', visibility: 'private' });
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/secret-product' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('GET /api/v1/catalog/products/:slug rejects a malformed slug (400), distinct from a valid-but-missing slug (404)', async () => {
    const app = buildTestApp();
    const malformed = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/Not_A_Valid-Slug!' });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('GET /api/v1/catalog/products/:slug/plans returns full plan detail with published pricing and public features only', async () => {
    const product = await createProduct(db, { id: randomUUID(), slug: 'full-product', name: 'Full Product', productType: 'hosting', status: 'active', visibility: 'public' });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'starter', name: 'Starter', status: 'active', billingModel: 'recurring' });
    await createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'usd', amount: 9.99, effectiveStatus: 'published' });
    await createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'annually', currency: 'usd', amount: 99, effectiveStatus: 'draft' }); // unpublished — must not appear
    await replacePlanFeatures(
      db,
      plan.id,
      [
        { featureName: 'Storage', featureValue: '10 GB', visibility: 'public' },
        { featureName: 'internal margin note', featureValue: 'do not expose', visibility: 'private' },
      ],
      randomUUID
    );

    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/full-product/plans' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plans).toHaveLength(1);
    const [returnedPlan] = body.plans;
    expect(returnedPlan.slug).toBe('starter');
    expect(returnedPlan.pricing).toEqual([{ billingPeriod: 'monthly', currency: 'USD', amount: 9.99, setupFee: null }]);
    expect(returnedPlan.features).toEqual([{ name: 'Storage', value: '10 GB', displayOrder: 0 }]);
    // Never leaks internal ids/status.
    expect(returnedPlan).not.toHaveProperty('id');
    expect(returnedPlan).not.toHaveProperty('status');
    await app.close();
  });

  it('an empty catalog returns a real empty list (200), not an error and not fake data', async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ products: [] });
    await app.close();
  });

  it('a disabled plan under an otherwise active product is excluded from the public plans response', async () => {
    const product = await createProduct(db, { id: randomUUID(), slug: 'mixed-product', name: 'Mixed', productType: 'hosting', status: 'active', visibility: 'public' });
    await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'disabled-plan', name: 'Disabled Plan', status: 'disabled' });

    const app = buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/v1/catalog/products/mixed-product/plans' });
    expect(res.statusCode).toBe(200);
    expect(res.json().plans).toEqual([]);
    await app.close();
  });
});
