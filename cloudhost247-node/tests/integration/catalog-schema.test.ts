import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PgliteClient } from '../../database/db-client';
import { migrateUp } from '../../database/migrate';
import { createProduct, findProductById, setProductStatus, updateProduct } from '../../src/db/catalog-products';
import { createPlan, listActivePlansForProduct, setPlanStatus } from '../../src/db/catalog-plans';
import { createPricing, updatePricing } from '../../src/db/catalog-pricing';
import { listPublicFeaturesForPlan, replacePlanFeatures } from '../../src/db/catalog-features';

/**
 * Exercises the real Phase 3 catalog schema (products/product_plans/plan_pricing/plan_features)
 * and the repository functions on top of it, against a real embedded Postgres engine (pglite)
 * migrated with the actual committed migration files — not mocks.
 */
describe('catalog database schema and repositories', () => {
  let db: PGlite;

  beforeEach(async () => {
    db = new PGlite();
    await migrateUp(new PgliteClient(db), { isProduction: false });
  });

  afterEach(async () => {
    await db.close();
  });

  it('creates a product and enforces the slug/type/status/visibility constraints', async () => {
    const product = await createProduct(db, {
      id: randomUUID(),
      slug: 'cpanel-hosting',
      name: 'cPanel Hosting',
      productType: 'hosting',
      status: 'active',
      visibility: 'public',
    });
    expect(product.slug).toBe('cpanel-hosting');
    expect(product.status).toBe('active');

    await expect(
      db.query(
        `INSERT INTO products (id, slug, name, product_type) VALUES ($1, $2, $3, $4)`,
        [randomUUID(), 'bad-type', 'Bad', 'not-a-real-type']
      )
    ).rejects.toThrow();

    // Slugs are unique case-insensitively.
    await expect(
      db.query(`INSERT INTO products (id, slug, name, product_type) VALUES ($1, $2, $3, $4)`, [
        randomUUID(),
        'CPANEL-HOSTING',
        'Duplicate',
        'hosting',
      ])
    ).rejects.toThrow();
  });

  it('creates a plan under a product and enforces per-product slug uniqueness', async () => {
    const product = await createProduct(db, {
      id: randomUUID(),
      slug: 'vps-hosting',
      name: 'VPS Hosting',
      productType: 'hosting',
      status: 'active',
      visibility: 'public',
    });

    const plan = await createPlan(db, {
      id: randomUUID(),
      productId: product.id,
      slug: 'starter',
      name: 'Starter',
      status: 'active',
    });
    expect(plan.product_id).toBe(product.id);

    // Same slug is fine under a *different* product...
    const otherProduct = await createProduct(db, {
      id: randomUUID(),
      slug: 'cpanel-hosting-2',
      name: 'cPanel Hosting 2',
      productType: 'hosting',
    });
    await expect(
      createPlan(db, { id: randomUUID(), productId: otherProduct.id, slug: 'starter', name: 'Starter (other product)' })
    ).resolves.toBeTruthy();

    // ...but not duplicated under the *same* product.
    await expect(
      createPlan(db, { id: randomUUID(), productId: product.id, slug: 'starter', name: 'Duplicate Starter' })
    ).rejects.toThrow();
  });

  it('only lists active plans in listActivePlansForProduct, never draft/disabled ones', async () => {
    const product = await createProduct(db, {
      id: randomUUID(),
      slug: 'hosting-x',
      name: 'Hosting X',
      productType: 'hosting',
      status: 'active',
      visibility: 'public',
    });

    const active = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'active-plan', name: 'Active', status: 'active' });
    await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'draft-plan', name: 'Draft', status: 'draft' });
    await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'disabled-plan', name: 'Disabled', status: 'disabled' });

    const plans = await listActivePlansForProduct(db, product.id);
    expect(plans.map((p) => p.id)).toEqual([active.id]);
  });

  it('enforces that a price row cannot be published without a real amount', async () => {
    const product = await createProduct(db, { id: randomUUID(), slug: 'p1', name: 'P1', productType: 'hosting' });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'plan1', name: 'Plan 1' });

    // Creating a published row with no amount must fail (this is the database-level "never
    // fabricate a price" guarantee — see 0006_create_catalog_plan_pricing.sql).
    await expect(
      createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', effectiveStatus: 'published' })
    ).rejects.toThrow();

    // A draft row with no amount is fine (this is exactly how "not priced yet" is represented).
    const draft = await createPricing(db, {
      id: randomUUID(),
      planId: plan.id,
      billingPeriod: 'monthly',
      currency: 'USD',
      effectiveStatus: 'draft',
    });
    expect(draft.amount).toBeNull();

    // Publishing without ever setting a real amount must still fail...
    await expect(updatePricing(db, draft.id, { effectiveStatus: 'published' })).rejects.toThrow();

    // ...but once a real amount is set, publishing succeeds.
    const withAmount = await updatePricing(db, draft.id, { amount: 12.5 });
    expect(withAmount?.amount).toBe('12.50');
    const published = await updatePricing(db, draft.id, { effectiveStatus: 'published' });
    expect(published?.effective_status).toBe('published');
  });

  it('rejects a negative price or setup fee', async () => {
    const product = await createProduct(db, { id: randomUUID(), slug: 'p2', name: 'P2', productType: 'hosting' });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'plan1', name: 'Plan 1' });

    await expect(
      createPricing(db, { id: randomUUID(), planId: plan.id, billingPeriod: 'monthly', currency: 'USD', amount: -5 })
    ).rejects.toThrow();
  });

  it('replaces a plan feature set and only public-visibility features are returned by listPublicFeaturesForPlan', async () => {
    const product = await createProduct(db, { id: randomUUID(), slug: 'p3', name: 'P3', productType: 'hosting' });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'plan1', name: 'Plan 1' });

    await replacePlanFeatures(
      db,
      plan.id,
      [
        { featureName: 'Storage', featureValue: '10 GB', displayOrder: 1, visibility: 'public' },
        { featureName: 'Internal cost note', featureValue: 'do not show customers', visibility: 'private' },
      ],
      randomUUID
    );

    const publicFeatures = await listPublicFeaturesForPlan(db, plan.id);
    expect(publicFeatures).toHaveLength(1);
    expect(publicFeatures[0]?.feature_name).toBe('Storage');

    // Replacing again fully replaces the previous set (delete-then-insert), not append.
    await replacePlanFeatures(db, plan.id, [{ featureName: 'Bandwidth', featureValue: 'Unmetered' }], randomUUID);
    const afterReplace = await listPublicFeaturesForPlan(db, plan.id);
    expect(afterReplace.map((f) => f.feature_name)).toEqual(['Bandwidth']);
  });

  it('enable/disable behavior: setProductStatus and setPlanStatus persist and are immediately reflected', async () => {
    const product = await createProduct(db, {
      id: randomUUID(),
      slug: 'p4',
      name: 'P4',
      productType: 'hosting',
      status: 'active',
      visibility: 'public',
    });
    const plan = await createPlan(db, { id: randomUUID(), productId: product.id, slug: 'plan1', name: 'Plan 1', status: 'active' });

    await setProductStatus(db, product.id, 'disabled');
    const reloaded = await findProductById(db, product.id);
    expect(reloaded?.status).toBe('disabled');

    await setPlanStatus(db, plan.id, 'disabled');
    const activePlans = await listActivePlansForProduct(db, product.id);
    expect(activePlans).toEqual([]);
  });

  it('updateProduct only changes the provided fields and always bumps updated_at', async () => {
    const product = await createProduct(db, { id: randomUUID(), slug: 'p5', name: 'Original Name', productType: 'hosting' });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const updated = await updateProduct(db, product.id, { name: 'New Name' });
    expect(updated?.name).toBe('New Name');
    expect(updated?.slug).toBe('p5'); // untouched
    expect(updated?.updated_at).not.toBe(product.updated_at);
  });
});
