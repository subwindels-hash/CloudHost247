import type { CartItemDetailRow } from '../db/carts';
import type { OrderItemRow, OrderRow } from '../db/orders';
import { fromCents, multiplyCents, toCents } from '../lib/money';

/**
 * Phase 5A commerce DTOs — same purpose as src/dto/catalog.ts (Phase 3): a dedicated mapping layer
 * between raw DB rows and what the API actually returns, so "never leak an internal-only field"
 * and "never fabricate a price" live in one place instead of being re-derived in every route.
 */

export interface CartLineDTO {
  id: string;
  planId: string;
  productId: string;
  productName: string;
  productSlug: string;
  planName: string;
  planSlug: string;
  billingPeriod: string;
  quantity: number;
  unitPriceAmount: string | null;
  lineTotalAmount: string | null;
  /** True when this line's plan/product is no longer active, or no published price currently
   * exists for its (plan, billing_period, currency) — e.g. staff changed the catalog after this
   * item was added. The UI must show this honestly and checkout must refuse to proceed until the
   * customer removes or otherwise resolves the line — never silently drop it or substitute a
   * stale/approximate price. */
  priceUnavailable: boolean;
}

/**
 * A non-catalogue cart line (see database/migrations/0071 and src/commerce/service-cart.ts):
 * a provider-confirmed domain registration draft, or a packaged platform-service tier. Same cart,
 * same checkout, same order — a second line *kind*, not a second commerce system.
 *
 * `serviceKind`/`serviceRef` are the only things a client may echo back; the amount is always the
 * one the server resolved for this read.
 */
export interface CartServiceLineDTO {
  id: string;
  lineKind: 'service';
  serviceKind: 'domain_registration' | 'platform_plan';
  serviceRef: string;
  serviceName: string;
  billingPeriod: string;
  quantity: number;
  unitPriceAmount: string | null;
  lineTotalAmount: string | null;
  currency: string | null;
  priceUnavailable: boolean;
  /** Customer-safe reason the line cannot be checked out right now (provider outage, plan
   * unpublished, domain taken). Never contains provider internals. */
  unavailableReason: string | null;
}

export interface CartSummaryDTO {
  items: CartLineDTO[];
  /** Service lines, kept separate so existing consumers of `items` are unaffected. */
  serviceItems: CartServiceLineDTO[];
  currency: string;
  subtotalAmount: string;
  itemCount: number;
  hasUnavailableItems: boolean;
}

export function toCartLineDTO(row: CartItemDetailRow): CartLineDTO {
  const priceUnavailable = row.unit_price_amount === null || row.product_status !== 'active' || row.plan_status !== 'active';
  const unitCents = row.unit_price_amount !== null ? toCents(row.unit_price_amount) : null;
  return {
    id: row.id,
    planId: row.plan_id,
    productId: row.product_id,
    productName: row.product_name,
    productSlug: row.product_slug,
    planName: row.plan_name,
    planSlug: row.plan_slug,
    billingPeriod: row.billing_period,
    quantity: row.quantity,
    unitPriceAmount: row.unit_price_amount,
    lineTotalAmount: unitCents !== null ? fromCents(multiplyCents(unitCents, row.quantity)) : null,
    priceUnavailable,
  };
}

export interface OrderSummaryDTO {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  createdAt: string;
  /** Set from Phase 5B onward — every order now gets exactly one invoice, issued atomically at
   * checkout (see src/services/billing-service.ts#issueInvoiceForOrder). `null` only for orders
   * that could theoretically predate that guarantee; no such orders exist once 0018+ are applied. */
  invoiceId: string | null;
  invoiceNumber: string | null;
}

export interface OrderItemDTO {
  id: string;
  productName: string;
  planName: string;
  billingPeriod: string;
  quantity: number;
  unitPriceAmount: string;
  lineTotalAmount: string;
  currency: string;
}

export interface OrderDetailDTO extends OrderSummaryDTO {
  items: OrderItemDTO[];
}

export function toOrderSummaryDTO(row: OrderRow, invoice?: { id: string; invoice_number: string } | null): OrderSummaryDTO {
  return {
    id: row.id,
    orderNumber: row.order_number,
    status: row.status,
    paymentStatus: row.payment_status,
    currency: row.currency,
    subtotalAmount: row.subtotal_amount,
    discountAmount: row.discount_amount,
    taxAmount: row.tax_amount,
    totalAmount: row.total_amount,
    createdAt: row.created_at,
    invoiceId: invoice?.id ?? null,
    invoiceNumber: invoice?.invoice_number ?? null,
  };
}

export function toOrderItemDTO(row: OrderItemRow): OrderItemDTO {
  return {
    id: row.id,
    productName: row.product_name_snapshot,
    planName: row.plan_name_snapshot,
    billingPeriod: row.billing_period,
    quantity: row.quantity,
    unitPriceAmount: row.unit_price_amount,
    lineTotalAmount: row.line_total_amount,
    currency: row.currency,
  };
}

/**
 * Maps a resolved service line to its cart DTO. `priceUnavailable` is the same honest flag the
 * catalogue lines carry and drives the same UI state and the same checkout refusal — a service
 * line is never quietly dropped from the cart or checked out at a stale price.
 */
export function toCartServiceLineDTO(
  line: {
    id: string;
    serviceKind: string;
    serviceRef: string;
    serviceName: string;
    billingPeriod: string;
    quantity: number;
    unitAmount: string | null;
    lineAmount: string | null;
    currency: string | null;
    available: boolean;
    unavailableReason: string | null;
  }
): CartServiceLineDTO {
  return {
    id: line.id,
    lineKind: 'service',
    serviceKind: line.serviceKind as CartServiceLineDTO['serviceKind'],
    serviceRef: line.serviceRef,
    serviceName: line.serviceName,
    billingPeriod: line.billingPeriod,
    quantity: line.quantity,
    unitPriceAmount: line.unitAmount,
    lineTotalAmount: line.lineAmount,
    currency: line.currency,
    priceUnavailable: !line.available,
    unavailableReason: line.unavailableReason,
  };
}
