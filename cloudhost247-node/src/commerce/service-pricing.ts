/**
 * Service-line pricing — the one place a non-catalogue cart line gets a price.
 *
 * Every resolver in this registry answers the same question the catalogue does for a hosting plan:
 * *what does this line cost right now, from an authoritative source, for this customer?* None of
 * them accepts a price, a discount, a currency or a total from the caller, and none of them ever
 * falls back to a guessed, cached or "approximate" number. A line whose source cannot price it
 * right now resolves to `available: false` with a customer-safe reason, which is what makes
 * checkout refuse the cart instead of silently charging something.
 *
 * The registry is deliberately small and explicit: adding a new sellable service means adding one
 * resolver here, not touching cart, checkout, order, invoice or payment code.
 */
import type { Queryable } from '../db/types';
import { DomainProviderError, safeDomainProviderMessage } from '../domain-services/providers/types';
import { resolveRegistrationLinePrice } from '../domain-services/registration-service';
import { parseLimits, resolvePublishedPlan, type PlatformServiceKind } from './platform-plans';
import { DEFAULT_CURRENCY } from '../config/billing';

/** The cart kinds the platform can actually be sold through the cart today. */
export type PurchasableServiceKind = 'domain_registration' | 'platform_plan';

export interface ServiceLineRequest {
  serviceKind: string;
  serviceRef: string;
  serviceName: string;
  billingPeriod: string;
  quantity: number;
  metadata: Record<string, unknown>;
}

export interface ResolvedServiceLine {
  serviceKind: PurchasableServiceKind;
  serviceRef: string;
  /** Authoritative display name re-read from the source — the stored `serviceName` is a snapshot. */
  serviceName: string;
  billingPeriod: string;
  quantity: number;
  unitAmount: string | null;
  lineAmount: string | null;
  currency: string | null;
  available: boolean;
  /** Customer-safe explanation when `available` is false. Never contains provider internals. */
  unavailableReason: string | null;
  /** Server-set order-item metadata for checkout (never client-supplied beyond the reference). */
  orderMetadata: Record<string, unknown>;
  /** Platform plan limits that apply to the line, when it is a packaged service tier. */
  limits: Record<string, number>;
}

export const IS_PURCHASABLE_SERVICE_KIND = (value: string): value is PurchasableServiceKind =>
  value === 'domain_registration' || value === 'platform_plan';

function money(value: string | null, quantity: number): string | null {
  if (value === null) return null;
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents)) return null;
  return ((cents * quantity) / 100).toFixed(2);
}

function unavailable(
  request: ServiceLineRequest,
  reason: string,
  serviceName?: string
): ResolvedServiceLine {
  return {
    serviceKind: request.serviceKind as PurchasableServiceKind,
    serviceRef: request.serviceRef,
    serviceName: serviceName ?? request.serviceName,
    billingPeriod: request.billingPeriod,
    quantity: request.quantity,
    unitAmount: null,
    lineAmount: null,
    currency: null,
    available: false,
    unavailableReason: reason,
    orderMetadata: {},
    limits: {},
  };
}

/**
 * Resolves one service line. Never throws for a provider problem: a registrar outage is an
 * *unavailable line with a safe explanation*, not a crashed cart page. It does throw for a
 * malformed reference, which is a caller bug rather than an operational state.
 */
export async function resolveServiceLine(
  db: Queryable,
  userId: string,
  request: ServiceLineRequest
): Promise<ResolvedServiceLine> {
  if (request.serviceKind === 'domain_registration') {
    try {
      const resolved = await resolveRegistrationLinePrice(db, userId, request.serviceRef);
      if (!resolved) {
        return unavailable(request, 'This domain registration is no longer available for checkout.');
      }
      return {
        serviceKind: 'domain_registration',
        serviceRef: request.serviceRef,
        serviceName: resolved.displayName,
        billingPeriod: 'one_time',
        quantity: 1,
        unitAmount: resolved.amount,
        lineAmount: money(resolved.amount, 1),
        currency: resolved.currency,
        available: true,
        unavailableReason: null,
        orderMetadata: {
          kind: 'domain_registration',
          registrationId: request.serviceRef,
          domainName: resolved.domainName,
          years: resolved.years,
        },
        limits: {},
      };
    } catch (error) {
      if (error instanceof DomainProviderError) {
        return unavailable(request, safeDomainProviderMessage(error));
      }
      throw error;
    }
  }

  const plan = await resolvePublishedPlan(db, request.serviceRef, request.metadata.serviceKind as PlatformServiceKind);
  if (!plan) {
    return unavailable(request, 'This plan is no longer published — remove it from your cart.');
  }
  if (plan.currency.toUpperCase() !== DEFAULT_CURRENCY) {
    return unavailable(request, 'This plan is priced in a currency this platform does not support yet.');
  }

  return {
    serviceKind: 'platform_plan',
    serviceRef: plan.id,
    serviceName: `${plan.name} (${plan.billing_period.replace(/_/g, ' ')})`,
    billingPeriod: plan.billing_period,
    quantity: request.quantity,
    unitAmount: plan.price_amount,
    lineAmount: money(plan.price_amount, request.quantity),
    currency: plan.currency,
    available: true,
    unavailableReason: null,
    orderMetadata: {
      kind: 'platform_plan',
      planId: plan.id,
      serviceKind: plan.service_kind,
      planCode: plan.code,
      // Where the entitlement should be applied. Chosen by the customer at purchase time and
      // validated by the fulfilment step (the referenced resource must belong to the buyer).
      resourceType: (request.metadata.resourceType as string | undefined) ?? null,
      resourceId: (request.metadata.resourceId as string | undefined) ?? null,
    },
    limits: parseLimits(plan.limits),
  };
}
