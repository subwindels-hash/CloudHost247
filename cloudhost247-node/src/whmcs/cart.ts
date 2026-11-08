/**
 * The cart hand-off: the only way this project should ever send a customer to buy something.
 *
 * The design decision behind it is deliberate and worth stating, because it is the difference
 * between an integration and a mock: **the website does not run a cart.** WHMCS already has one —
 * with tax, promotions, fraud review, currency, configurable options, order-form templates, payment
 * gateways and the provisioning trigger wired into it. Reproducing that in a second application is
 * how a project ends up with two invoices for one order. So the website's job is to hand the
 * customer to `cart.php` with the *right product and billing cycle*, and to know nothing else.
 *
 * Consequences that follow from that decision:
 *
 *  - the URL is built only from a verified `ProductBinding` (`product-map.ts`); an unmapped service
 *    cannot produce a URL at all, which is why "no mapping" and "no button" are the same fact;
 *  - a billing cycle is accepted only if WHMCS offers it for that product;
 *  - no price, quantity of money, or discount ever appears in the URL;
 *  - the API secret cannot reach the browser because this module never touches it.
 */

import {
  WhmcsCycleNotOfferedError,
  WhmcsProductNotMappedError,
} from './errors';
import { resolveBinding, type ProductMapDocument } from './product-map';
import type { BillingCycle } from './types';

export interface CartUrlOptions {
  /** WHMCS install root, e.g. https://billing.example.com (no trailing slash). */
  baseUrl: string;
  /** Defaults to `cart.php`; overridable for installs that rename the script. */
  cartPath?: string;
}

export interface CartRequest {
  serviceKey: string;
  billingCycle: BillingCycle;
}

function trimBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Builds `…/cart.php?a=add&pid=<id>&billingcycle=<cycle>` for a mapped service.
 *
 * @throws WhmcsProductNotMappedError when the service has no verified binding
 * @throws WhmcsCycleNotOfferedError  when WHMCS does not sell that cycle for the product
 */
export function buildCartUrl(
  map: ProductMapDocument,
  options: CartUrlOptions,
  request: CartRequest,
): string {
  const offer = resolveBinding(map, request.serviceKey);
  if (!offer) throw new WhmcsProductNotMappedError(request.serviceKey);
  if (!offer.billingCycles.includes(request.billingCycle)) {
    throw new WhmcsCycleNotOfferedError(request.serviceKey, request.billingCycle);
  }
  const base = trimBase(options.baseUrl);
  if (!/^https?:\/\//i.test(base)) {
    throw new Error('buildCartUrl requires an absolute base URL');
  }
  const cartPath = (options.cartPath ?? 'cart.php').replace(/^\/+/, '');
  const params = new URLSearchParams({
    a: 'add',
    pid: String(offer.productId),
    billingcycle: request.billingCycle,
  });
  return `${base}/${cartPath}?${params.toString()}`;
}

/**
 * Cycles a page may offer for a service. Empty when the service is unmapped — callers render the
 * "not available online" state from that, rather than inventing a default cycle.
 */
export function offeredCycles(map: ProductMapDocument, serviceKey: string): BillingCycle[] {
  return resolveBinding(map, serviceKey)?.billingCycles ?? [];
}

/** The client-area entry point, for "manage my services" style links. */
export function clientAreaUrl(options: CartUrlOptions, action?: string): string {
  const base = trimBase(options.baseUrl);
  const path = (options.cartPath ?? 'cart.php').replace(/cart\.php$/, 'clientarea.php');
  return action ? `${base}/${path}?action=${encodeURIComponent(action)}` : `${base}/${path}`;
}
