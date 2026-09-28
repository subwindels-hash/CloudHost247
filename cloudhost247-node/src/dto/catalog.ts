import type { ProductRow } from '../db/catalog-products';
import type { PlanRow } from '../db/catalog-plans';
import type { PricingRow } from '../db/catalog-pricing';
import type { FeatureRow } from '../db/catalog-features';

/**
 * Public-facing response shapes (DTOs) for the catalog API.
 *
 * These are deliberately separate types from the DB row shapes (`ProductRow`, `PlanRow`, ...): the
 * public API must never leak internal-only fields (`id`, `status`, `visibility`, raw
 * timestamps) and must never return a price row that hasn't been explicitly published. Keeping a
 * dedicated mapping layer here means that guarantee lives in one place instead of being re-derived
 * ad hoc in every route handler.
 */

export interface PublicPriceDTO {
  billingPeriod: string;
  currency: string;
  amount: number;
  setupFee: number | null;
}

export interface PublicFeatureDTO {
  name: string;
  value: string | null;
  displayOrder: number;
}

export interface PublicPlanSummaryDTO {
  slug: string;
  name: string;
  description: string | null;
  billingModel: string;
  displayOrder: number;
}

export interface PublicPlanDTO extends PublicPlanSummaryDTO {
  pricing: PublicPriceDTO[];
  features: PublicFeatureDTO[];
}

export interface PublicProductSummaryDTO {
  slug: string;
  name: string;
  description: string | null;
  productType: string;
  displayOrder: number;
  /** false for a publicly-listed product that isn't actually available yet (status = 'draft') —
   * see database/migrations/0004_create_catalog_products.sql for the full rationale. Never used to
   * hide fake/placeholder data; only to honestly label a real, named service line that doesn't
   * have real plans/pricing configured yet. */
  available: boolean;
}

export interface PublicProductDetailDTO extends PublicProductSummaryDTO {
  plans: PublicPlanSummaryDTO[];
}

function isProductAvailable(product: ProductRow): boolean {
  return product.status === 'active';
}

export function toPublicProductSummary(product: ProductRow): PublicProductSummaryDTO {
  return {
    slug: product.slug,
    name: product.name,
    description: product.description,
    productType: product.product_type,
    displayOrder: product.display_order,
    available: isProductAvailable(product),
  };
}

export function toPublicPlanSummary(plan: PlanRow): PublicPlanSummaryDTO {
  return {
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    billingModel: plan.billing_model,
    displayOrder: plan.display_order,
  };
}

export function toPublicPrice(pricing: PricingRow): PublicPriceDTO | null {
  // Defense in depth: the repository layer (listPublishedPricingForPlan) already filters to
  // effective_status = 'published', and the database CHECK constraint
  // (plan_pricing_published_requires_amount_check) makes a published row with a null amount
  // impossible — but this mapping function never assumes a caller upstream got that right, so a
  // null amount is always excluded here rather than ever being serialized as `0` or `null` in a
  // way a frontend could mistake for a real, free price.
  if (pricing.effective_status !== 'published' || pricing.amount === null) {
    return null;
  }
  return {
    billingPeriod: pricing.billing_period,
    currency: pricing.currency,
    amount: Number(pricing.amount),
    setupFee: pricing.setup_fee === null ? null : Number(pricing.setup_fee),
  };
}

export function toPublicFeature(feature: FeatureRow): PublicFeatureDTO | null {
  if (feature.visibility !== 'public') return null;
  return {
    name: feature.feature_name,
    value: feature.feature_value,
    displayOrder: feature.display_order,
  };
}

export function toPublicPlan(plan: PlanRow, pricing: PricingRow[], features: FeatureRow[]): PublicPlanDTO {
  return {
    ...toPublicPlanSummary(plan),
    pricing: pricing.map(toPublicPrice).filter((p): p is PublicPriceDTO => p !== null),
    features: features.map(toPublicFeature).filter((f): f is PublicFeatureDTO => f !== null),
  };
}

// --- Admin DTOs -------------------------------------------------------------------------------
// Admin responses intentionally include internal fields (id, status, visibility, timestamps) that
// the public DTOs above always omit, since the admin API is only reachable by an authenticated
// super_admin (see src/lib/require-role.ts) and needs them to perform further mutations.

export interface AdminProductDTO {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  productType: string;
  status: string;
  visibility: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function toAdminProduct(product: ProductRow): AdminProductDTO {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    productType: product.product_type,
    status: product.status,
    visibility: product.visibility,
    displayOrder: product.display_order,
    createdAt: product.created_at,
    updatedAt: product.updated_at,
  };
}

export interface AdminPlanDTO {
  id: string;
  productId: string;
  slug: string;
  name: string;
  description: string | null;
  status: string;
  billingModel: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

export function toAdminPlan(plan: PlanRow): AdminPlanDTO {
  return {
    id: plan.id,
    productId: plan.product_id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    billingModel: plan.billing_model,
    displayOrder: plan.display_order,
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
  };
}

export interface AdminPricingDTO {
  id: string;
  planId: string;
  billingPeriod: string;
  currency: string;
  amount: number | null;
  setupFee: number | null;
  effectiveStatus: string;
  createdAt: string;
  updatedAt: string;
}

export function toAdminPricing(pricing: PricingRow): AdminPricingDTO {
  return {
    id: pricing.id,
    planId: pricing.plan_id,
    billingPeriod: pricing.billing_period,
    currency: pricing.currency,
    amount: pricing.amount === null ? null : Number(pricing.amount),
    setupFee: pricing.setup_fee === null ? null : Number(pricing.setup_fee),
    effectiveStatus: pricing.effective_status,
    createdAt: pricing.created_at,
    updatedAt: pricing.updated_at,
  };
}

export interface AdminFeatureDTO {
  id: string;
  planId: string;
  featureName: string;
  featureValue: string | null;
  displayOrder: number;
  visibility: string;
}

export function toAdminFeature(feature: FeatureRow): AdminFeatureDTO {
  return {
    id: feature.id,
    planId: feature.plan_id,
    featureName: feature.feature_name,
    featureValue: feature.feature_value,
    displayOrder: feature.display_order,
    visibility: feature.visibility,
  };
}
