import { randomUUID } from 'node:crypto';
import type { Queryable } from '../db/types';
import {
  addCartItem,
  clearCart,
  findCartItemForPlanPeriod,
  findCartItemWithOwner,
  getOrCreateCartForUser,
  listCartItemsWithDetails,
  removeCartItem,
  setCartItemQuantity,
} from '../db/carts';
import {
  clearServiceItems,
  findServiceItemByRef,
  findServiceItemWithOwner,
  listServiceItemsForCart,
  removeServiceItem,
  setServiceItemQuantity,
  upsertServiceItem,
} from '../commerce/service-cart';
import { resolveServiceLine, type ResolvedServiceLine } from '../commerce/service-pricing';
import { findPlanById as findPlatformPlanById } from '../commerce/platform-plans';
import { attachRegistrationToOrder, discardRegistrationDraft } from '../domain-services/registration-service';
import { createOrder, findOrderById, listOrderItemsForOrder, listOrdersForUser, type CreateOrderItemInput } from '../db/orders';
import { findPlanById } from '../db/catalog-plans';
import { findProductById } from '../db/catalog-products';
import { listPublishedPricingForPlan, type BillingPeriod } from '../db/catalog-pricing';
import { withTransaction } from '../db/transaction';
import { issueInvoiceForOrder } from './billing-service';
import { fromCents, multiplyCents, sumCents, toCents } from '../lib/money';
import { NotFoundError, ValidationError } from '../lib/errors';
import { DEFAULT_CURRENCY, MAX_CART_ITEM_QUANTITY } from '../config/billing';
import {
  toCartLineDTO,
  toCartServiceLineDTO,
  toOrderItemDTO,
  toOrderSummaryDTO,
  type CartServiceLineDTO,
  type CartSummaryDTO,
  type OrderDetailDTO,
  type OrderSummaryDTO,
} from '../dto/commerce';

/**
 * Commerce business logic (Phase 5A, extended by the platform-services expansion) — cart pricing
 * and checkout. This is the *only* place in the codebase that is allowed to decide what a cart line
 * or an order costs. Every price used here is read fresh from an authoritative source at the moment
 * it's needed (`plan_pricing` for catalogue lines, src/commerce/service-pricing.ts for service
 * lines); nothing here ever accepts a price, subtotal, or total from a caller. Both the "view my
 * cart" route and the "place my order" route call into this module so there is exactly one
 * price-calculation code path to keep honest, not two that could drift apart.
 *
 * The expansion adds a second *line kind* — a domain registration draft or a packaged platform
 * service tier — to the same cart, the same checkout and the same order. It is not a second
 * commerce system: catalogue lines and service lines are priced here, merged into one
 * `orders`/`order_items` row here, and invoiced by the same `issueInvoiceForOrder`.
 */

interface PricedServiceLine extends ResolvedServiceLine {
  id: string;
}

async function priceServiceItems(
  db: Queryable,
  userId: string,
  cartId: string
): Promise<{ lines: PricedServiceLine[]; dtos: CartServiceLineDTO[] }> {
  const rows = await listServiceItemsForCart(db, cartId);
  const lines: PricedServiceLine[] = [];
  for (const row of rows) {
    const resolved = await resolveServiceLine(db, userId, {
      serviceKind: row.service_kind,
      serviceRef: row.service_ref,
      serviceName: row.service_name,
      billingPeriod: row.billing_period,
      quantity: row.quantity,
      metadata: row.metadata ?? {},
    });
    const priced: PricedServiceLine = { ...resolved, id: row.id };
    lines.push(priced);
  }
  return { lines, dtos: lines.map(toCartServiceLineDTO) };
}

async function computeCartSummary(
  pool: Queryable,
  userId: string,
  cartId: string,
  currency: string
): Promise<CartSummaryDTO> {
  const rows = await listCartItemsWithDetails(pool, cartId, currency);
  const items = rows.map(toCartLineDTO);
  const available = items.filter((i) => !i.priceUnavailable && i.lineTotalAmount !== null);
  const catalogCents = sumCents(available.map((i) => toCents(i.lineTotalAmount as string)));

  const { lines: serviceLines, dtos: serviceItems } = await priceServiceItems(pool, userId, cartId);
  const pricedServiceLines = serviceLines.filter((line) => line.available && line.lineAmount !== null);
  const serviceCents = sumCents(pricedServiceLines.map((line) => toCents(line.lineAmount as string)));

  return {
    items,
    serviceItems,
    currency,
    subtotalAmount: fromCents(catalogCents + serviceCents),
    itemCount:
      items.reduce((total, i) => total + i.quantity, 0) +
      serviceItems.reduce((total, i) => total + i.quantity, 0),
    hasUnavailableItems:
      items.some((i) => i.priceUnavailable) || serviceItems.some((i) => i.priceUnavailable),
  };
}

export async function getCartSummary(pool: Queryable, userId: string, genId: () => string): Promise<CartSummaryDTO> {
  const cart = await getOrCreateCartForUser(pool, userId, genId());
  return computeCartSummary(pool, userId, cart.id, DEFAULT_CURRENCY);
}

export interface AddCartItemInput {
  planId: string;
  billingPeriod: BillingPeriod;
  quantity: number;
}

/**
 * Validates that (planId, billingPeriod) is genuinely purchasable *right now* — the plan and its
 * parent product must both be active/public, and a published price must exist for that exact
 * cadence in the platform's single supported currency — before adding it to the cart. Rejects
 * outright rather than adding a line the customer could never actually check out.
 */
export async function addItemToCart(pool: Queryable, userId: string, input: AddCartItemInput, genId: () => string): Promise<CartSummaryDTO> {
  const plan = await findPlanById(pool, input.planId);
  if (!plan || plan.status !== 'active') {
    throw new NotFoundError('No purchasable plan was found with that id');
  }
  const product = await findProductById(pool, plan.product_id);
  if (!product || product.status !== 'active' || product.visibility !== 'public') {
    throw new NotFoundError('No purchasable plan was found with that id');
  }

  const publishedPricing = await listPublishedPricingForPlan(pool, plan.id);
  const matchingPrice = publishedPricing.find((p) => p.billing_period === input.billingPeriod && p.currency === DEFAULT_CURRENCY);
  if (!matchingPrice) {
    throw new ValidationError(`This plan has no published ${input.billingPeriod} price in ${DEFAULT_CURRENCY} yet`);
  }

  const cart = await getOrCreateCartForUser(pool, userId, genId());
  const added = await addCartItem(pool, {
    id: genId(),
    cartId: cart.id,
    planId: plan.id,
    billingPeriod: input.billingPeriod,
    quantity: input.quantity,
  });

  if (!added) {
    // The line already exists and adding `input.quantity` more would push it past the per-line
    // cap (src/db/carts.ts#addCartItem enforces this atomically). Report it honestly with the
    // numbers the customer needs to act on, rather than letting the database CHECK constraint
    // escape as an unhandled 500. Re-reading the current quantity here is safe: this is the
    // already-rejected path, nothing was written, and a concurrent change would at worst make
    // the number in the message slightly stale — never the decision itself, which the database
    // already made.
    const existing = await findCartItemForPlanPeriod(pool, cart.id, plan.id, input.billingPeriod);
    const current = existing?.quantity ?? MAX_CART_ITEM_QUANTITY;
    throw new ValidationError(
      `You already have ${current} of this item in your cart and the maximum per line is ${MAX_CART_ITEM_QUANTITY}. ` +
        `Adding ${input.quantity} more would exceed it — update the existing line's quantity instead.`
    );
  }

  return computeCartSummary(pool, userId, cart.id, DEFAULT_CURRENCY);
}

async function assertOwnsCartItem(pool: Queryable, userId: string, itemId: string) {
  const item = await findCartItemWithOwner(pool, itemId);
  if (!item || item.cart_user_id !== userId) {
    // Never distinguish "doesn't exist" from "exists but isn't yours" — same pattern as every
    // other ownership check in this codebase (see docs/API_CUSTOMER_APP.md).
    throw new NotFoundError('No cart item was found with that id');
  }
  return item;
}

export async function updateCartItemQuantity(pool: Queryable, userId: string, itemId: string, quantity: number): Promise<CartSummaryDTO> {
  const item = await assertOwnsCartItem(pool, userId, itemId);
  await setCartItemQuantity(pool, itemId, quantity);
  return computeCartSummary(pool, userId, item.cart_id, DEFAULT_CURRENCY);
}

export async function removeItemFromCart(pool: Queryable, userId: string, itemId: string): Promise<CartSummaryDTO> {
  const item = await assertOwnsCartItem(pool, userId, itemId);
  await removeCartItem(pool, itemId);
  return computeCartSummary(pool, userId, item.cart_id, DEFAULT_CURRENCY);
}

/* -------------------------------------------------------------------------------------------
 * Service lines
 * ----------------------------------------------------------------------------------------- */

export interface AddServiceItemInput {
  serviceKind: string;
  serviceRef: string;
  quantity: number;
  /** Optional entitlement target for a packaged tier (`resourceType` + `resourceId` only). */
  resourceType?: string | null;
  resourceId?: string | null;
}

/**
 * Adds a service line after *proving* it is sellable right now: the line must resolve to a real
 * price from an authoritative source before it is stored. A domain registration line can therefore
 * only exist behind a successful provider-confirmed quote, and a packaged tier only behind a
 * published plan — the cart never holds a line the platform cannot actually charge for.
 *
 * Everything except the reference is server-resolved: the client names *what* it wants, never what
 * it costs, and the plan's own `service_kind`, cadence and amount are read from the database.
 */
export async function addServiceItemToCart(
  pool: Queryable,
  userId: string,
  input: AddServiceItemInput,
  genId: () => string
): Promise<CartSummaryDTO> {
  const cart = await getOrCreateCartForUser(pool, userId, genId());

  // The plan's own service kind is authoritative — the client cannot reclassify a plan, and a plan
  // that does not exist fails here rather than being stored as an unresolvable line.
  const metadata: Record<string, unknown> = {};
  if (input.serviceKind === 'platform_plan') {
    const plan = await findPlatformPlanById(pool, input.serviceRef);
    if (!plan) throw new ValidationError('No such plan could be found.');
    metadata.serviceKind = plan.service_kind;
    metadata.resourceType = input.resourceType ?? null;
    metadata.resourceId = input.resourceId ?? null;
  }

  const priced = await resolveServiceLine(pool, userId, {
    serviceKind: input.serviceKind,
    serviceRef: input.serviceRef,
    serviceName: input.serviceRef,
    billingPeriod: 'one_time',
    quantity: input.quantity,
    metadata,
  });

  if (!priced.available || priced.unitAmount === null) {
    throw new ValidationError(priced.unavailableReason ?? 'That item is not available for checkout right now.');
  }

  await upsertServiceItem(pool, {
    id: genId(),
    cartId: cart.id,
    serviceKind: priced.serviceKind,
    serviceRef: priced.serviceRef,
    serviceName: priced.serviceName,
    billingPeriod: priced.billingPeriod,
    quantity: input.quantity,
    metadata: priced.orderMetadata,
  });

  return computeCartSummary(pool, userId, cart.id, DEFAULT_CURRENCY);
}

export async function updateServiceItemQuantity(
  pool: Queryable,
  userId: string,
  itemId: string,
  quantity: number
): Promise<CartSummaryDTO> {
  const item = await findServiceItemWithOwner(pool, itemId);
  if (!item || item.cart_user_id !== userId) {
    throw new NotFoundError('No cart item was found with that id');
  }
  // A domain registration is a single entitlement (one domain, N years) — quantity is not a knob.
  if (item.service_kind === 'domain_registration' && quantity !== 1) {
    throw new ValidationError('A domain registration line is always quantity 1 — change the term years instead.');
  }
  await setServiceItemQuantity(pool, itemId, quantity);
  return computeCartSummary(pool, userId, item.cart_id, DEFAULT_CURRENCY);
}

export async function removeServiceItemFromCart(
  pool: Queryable,
  userId: string,
  itemId: string
): Promise<CartSummaryDTO> {
  const item = await findServiceItemWithOwner(pool, itemId);
  if (!item || item.cart_user_id !== userId) {
    throw new NotFoundError('No cart item was found with that id');
  }
  await removeServiceItem(pool, itemId);
  // Releasing the line releases the un-paid registration draft behind it, so a removed domain does
  // not keep a name reserved. Discarding is refused by the domain service for anything already
  // attached to an order or beyond `pending_payment`.
  if (item.service_kind === 'domain_registration') {
    await discardRegistrationDraft(pool, userId, item.service_ref);
  }
  return computeCartSummary(pool, userId, item.cart_id, DEFAULT_CURRENCY);
}

/** Idempotent "the domain I just quoted is in my cart" lookup used by the search UI. */
export async function findServiceLine(
  pool: Queryable,
  userId: string,
  serviceKind: string,
  serviceRef: string
): Promise<{ id: string } | null> {
  const cart = await getOrCreateCartForUser(pool, userId, randomUUID());
  const row = await findServiceItemByRef(pool, cart.id, serviceKind, serviceRef);
  return row ? { id: row.id } : null;
}

/* -------------------------------------------------------------------------------------------
 * Checkout
 * ----------------------------------------------------------------------------------------- */

/**
 * Converts the caller's cart into a real, immutable order — the only place in the codebase that
 * creates an `orders`/`order_items` row. Runs entirely inside one database transaction
 * (src/db/transaction.ts) so the price re-check, the order write, and emptying the cart either all
 * happen together or none of them do; a half-checked-out cart (order created but cart still full,
 * or vice versa) must never be observable, including when this throws partway through.
 *
 * Every price is re-resolved inside this transaction — catalogue lines from `plan_pricing`, service
 * lines from their authoritative source — so what the invoice says is what was true at the moment
 * of checkout, and a change between "view cart" and "place order" changes the order (never silently
 * charges the stale number the customer saw).
 */
export async function checkoutCart(pool: Queryable, userId: string, genId: () => string): Promise<OrderDetailDTO> {
  const orderId = genId();

  const { order, items, invoice } = await withTransaction(pool, async (tx) => {
    const cart = await getOrCreateCartForUser(tx, userId, genId());
    const lines = await listCartItemsWithDetails(tx, cart.id, DEFAULT_CURRENCY);
    const serviceRows = await listServiceItemsForCart(tx, cart.id);

    if (lines.length === 0 && serviceRows.length === 0) {
      throw new ValidationError('Your cart is empty');
    }

    const unavailable = lines.filter((l) => l.unit_price_amount === null || l.product_status !== 'active' || l.plan_status !== 'active');
    if (unavailable.length > 0) {
      throw new ValidationError(
        `The following item(s) are no longer available for checkout: ${unavailable
          .map((l) => l.plan_name)
          .join(', ')}. Please remove them from your cart and try again.`
      );
    }

    const pricedServices: PricedServiceLine[] = [];
    for (const row of serviceRows) {
      const resolved = await resolveServiceLine(tx, userId, {
        serviceKind: row.service_kind,
        serviceRef: row.service_ref,
        serviceName: row.service_name,
        billingPeriod: row.billing_period,
        quantity: row.quantity,
        metadata: row.metadata ?? {},
      });
      if (!resolved.available || resolved.lineAmount === null || resolved.unitAmount === null) {
        throw new ValidationError(
          `${resolved.serviceName} is no longer available for checkout: ${
            resolved.unavailableReason ?? 'the price could not be confirmed'
          }. Please remove it from your cart and try again.`
        );
      }
      pricedServices.push({ ...resolved, id: row.id });
    }

    const orderItems: CreateOrderItemInput[] = lines.map((line) => {
      const unitCents = toCents(line.unit_price_amount as string);
      const lineCents = multiplyCents(unitCents, line.quantity);
      return {
        id: genId(),
        productId: line.product_id,
        planId: line.plan_id,
        productNameSnapshot: line.product_name,
        planNameSnapshot: line.plan_name,
        billingPeriod: line.billing_period,
        quantity: line.quantity,
        unitPriceAmount: fromCents(unitCents),
        currency: DEFAULT_CURRENCY,
        lineTotalAmount: fromCents(lineCents),
        metadata: {} as Record<string, unknown>,
      };
    });

    for (const service of pricedServices) {
      const unitCents = toCents(service.unitAmount as string);
      const lineCents = multiplyCents(unitCents, service.quantity);
      orderItems.push({
        id: genId(),
        productId: null,
        planId: null,
        productNameSnapshot:
          service.serviceKind === 'domain_registration' ? 'Domain Services' : 'CloudHost247 Services',
        planNameSnapshot: service.serviceName,
        billingPeriod: service.billingPeriod,
        quantity: service.quantity,
        unitPriceAmount: fromCents(unitCents),
        currency: service.currency ?? DEFAULT_CURRENCY,
        lineTotalAmount: fromCents(lineCents),
        metadata: service.orderMetadata,
      });
    }

    const subtotalCents = sumCents(orderItems.map((i) => toCents(i.lineTotalAmount)));
    // No tax/discount configuration system exists for platform orders — both are genuinely zero
    // for every order created here, never a fabricated or hidden value. See docs/API_BILLING.md.
    const discountCents = 0;
    const taxCents = 0;
    const totalCents = subtotalCents - discountCents + taxCents;

    const result = await createOrder(tx, {
      id: orderId,
      userId,
      currency: DEFAULT_CURRENCY,
      subtotalAmount: fromCents(subtotalCents),
      discountAmount: fromCents(discountCents),
      taxAmount: fromCents(taxCents),
      totalAmount: fromCents(totalCents),
      items: orderItems,
    });

    const issuedInvoice = await issueInvoiceForOrder(tx, result.order, genId);

    // Point each checked-out domain draft at the order that now pays for it. The guarded update
    // refuses a draft another order already claimed, which makes a concurrent double-checkout of
    // the same line impossible to settle twice.
    for (const service of pricedServices) {
      if (service.serviceKind !== 'domain_registration') continue;
      const attached = await attachRegistrationToOrder(tx, service.serviceRef, result.order.id, issuedInvoice.id);
      if (!attached) {
        throw new ValidationError(
          'One of the domains in your cart was claimed by another checkout. Please refresh your cart and try again.'
        );
      }
    }

    await clearCart(tx, cart.id);
    await clearServiceItems(tx, cart.id);

    return { ...result, invoice: issuedInvoice };
  });

  return { ...toOrderSummaryDTO(order, invoice), items: items.map(toOrderItemDTO) };
}

export async function listMyOrders(pool: Queryable, userId: string): Promise<OrderSummaryDTO[]> {
  const orders = await listOrdersForUser(pool, userId);
  return orders.map((row) => toOrderSummaryDTO(row, row.invoice_id ? { id: row.invoice_id, invoice_number: row.invoice_number as string } : null));
}

export async function getMyOrderDetail(pool: Queryable, userId: string, orderId: string): Promise<OrderDetailDTO> {
  const order = await findOrderById(pool, orderId);
  if (!order || order.user_id !== userId) {
    throw new NotFoundError('No order was found with that id');
  }
  const items = await listOrderItemsForOrder(pool, order.id);
  const invoice = order.invoice_id ? { id: order.invoice_id, invoice_number: order.invoice_number as string } : null;
  return { ...toOrderSummaryDTO(order, invoice), items: items.map(toOrderItemDTO) };
}
