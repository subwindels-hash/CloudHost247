/**
 * Frontend mirror of the public catalog API's response DTOs (see src/dto/catalog.ts on the
 * backend and docs/API_CATALOG.md for the full contract). Kept as plain types, not generated,
 * since the backend and frontend live in the same repository/PR and are reviewed together — if
 * this drifts from the real API shape, the integration/contract tests in
 * tests/integration/catalog-public-api.test.ts would need to change too, which is an intentional
 * forcing function to keep them in sync.
 */

export interface PublicProductSummary {
  slug: string;
  name: string;
  description: string | null;
  productType: 'hosting' | 'domain' | 'service';
  displayOrder: number;
  available: boolean;
}

export interface PublicProductDetail extends PublicProductSummary {
  plans: PublicPlanSummary[];
}

export interface PublicPlanSummary {
  slug: string;
  name: string;
  description: string | null;
  billingModel: 'one_time' | 'recurring';
  displayOrder: number;
}

export interface PublicPrice {
  billingPeriod: 'one_time' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';
  currency: string;
  amount: number;
  setupFee: number | null;
}

export interface PublicFeature {
  name: string;
  value: string | null;
  displayOrder: number;
}

export interface PublicPlan extends PublicPlanSummary {
  pricing: PublicPrice[];
  features: PublicFeature[];
}

export interface CatalogListResponse {
  products: PublicProductSummary[];
}

export interface ProductDetailResponse {
  product: PublicProductDetail;
}

export interface ProductPlansResponse {
  product: PublicProductSummary;
  plans: PublicPlan[];
}

const BILLING_PERIOD_LABELS: Record<PublicPrice['billingPeriod'], string> = {
  one_time: 'one-time',
  monthly: 'per month',
  quarterly: 'per quarter',
  semi_annually: 'per 6 months',
  annually: 'per year',
};

/** Formats a published price for display, e.g. "$9.99 / per month". Never used on an unpublished
 * or missing price — callers should check `pricing.length > 0` first and show an honest
 * "pricing not yet published" state instead (see HostingCpanelPage/HostingVpsPage). */
export function formatPrice(price: PublicPrice): string {
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency }).format(price.amount);
  return `${amount} ${BILLING_PERIOD_LABELS[price.billingPeriod]}`;
}
