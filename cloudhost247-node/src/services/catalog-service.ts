import type { Queryable } from '../db/types';
import {
  findPubliclyListableProductBySlug,
  listPubliclyListableProducts,
  type ProductType,
} from '../db/catalog-products';
import { listActivePlansForProduct } from '../db/catalog-plans';
import { listPublishedPricingForPlan } from '../db/catalog-pricing';
import { listPublicFeaturesForPlan } from '../db/catalog-features';
import {
  toPublicPlan,
  toPublicPlanSummary,
  toPublicProductSummary,
  type PublicPlanDTO,
  type PublicProductDetailDTO,
  type PublicProductSummaryDTO,
} from '../dto/catalog';

/**
 * Public catalog read model. This is the "Catalog Repository" consumer described in
 * docs/API_CATALOG.md's architecture note — routes never query the database directly; they go
 * through here, which is the seam a future WHMCS-backed adapter (or a real product catalog import)
 * would slot into without route/DTO changes.
 */

export async function getPublicCatalog(pool: Queryable): Promise<{ products: PublicProductSummaryDTO[] }> {
  const products = await listPubliclyListableProducts(pool);
  return { products: products.map(toPublicProductSummary) };
}

export async function getPublicProductList(pool: Queryable, productType?: ProductType): Promise<{ products: PublicProductSummaryDTO[] }> {
  const products = await listPubliclyListableProducts(pool, productType);
  return { products: products.map(toPublicProductSummary) };
}

export async function getPublicProductBySlug(pool: Queryable, slug: string): Promise<PublicProductDetailDTO | null> {
  const product = await findPubliclyListableProductBySlug(pool, slug);
  if (!product) return null;

  // A publicly-listed-but-not-yet-available product (status = 'draft') never has its plans
  // enumerated, even if some were configured internally while the product was being set up — an
  // "unavailable" product should never leak partial plan/pricing data.
  if (product.status !== 'active') {
    return { ...toPublicProductSummary(product), plans: [] };
  }

  const plans = await listActivePlansForProduct(pool, product.id);
  return {
    ...toPublicProductSummary(product),
    plans: plans.map(toPublicPlanSummary),
  };
}

export async function getPublicPlansForProduct(pool: Queryable, slug: string): Promise<{ product: PublicProductSummaryDTO; plans: PublicPlanDTO[] } | null> {
  const product = await findPubliclyListableProductBySlug(pool, slug);
  if (!product) return null;

  if (product.status !== 'active') {
    return { product: toPublicProductSummary(product), plans: [] };
  }

  const plans = await listActivePlansForProduct(pool, product.id);
  const detailedPlans = await Promise.all(
    plans.map(async (plan) => {
      const [pricing, features] = await Promise.all([
        listPublishedPricingForPlan(pool, plan.id),
        listPublicFeaturesForPlan(pool, plan.id),
      ]);
      return toPublicPlan(plan, pricing, features);
    })
  );

  return { product: toPublicProductSummary(product), plans: detailedPlans };
}
