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
import { createOrder, findOrderById, listOrderItemsForOrder, listOrdersForUser } from '../db/orders';
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
  toOrderItemDTO,
  toOrderSummaryDTO,
  type CartSummaryDTO,
  type OrderDetailDTO,
  type OrderSummaryDTO,
} from '../dto/commerce';

/**
 * Commerce business logic (Phase 5A) — cart pricing and checkout. This is the *only* place in the
 * codebase that is allowed to decide what a cart line or an order costs. Every price used here is
 * read fresh from `plan_pricing` at the moment it's needed; nothing here ever accepts a price,
 * subtotal, or total from a caller. Both the "view my cart" route and the "place my order" route
 * call into this module so there is exactly one price-calculation code path to keep honest, not
 * two that could drift apart.
 */

async function computeCartSummary(pool: Queryable, cartId: string, currency: string): Promise<CartSummaryDTO> {
  const rows = await listCartItemsWithDetails(pool, cartId, currency);
  const items = rows.map(toCartLineDTO);
  const available = items.filter((i) => !i.priceUnavailable && i.lineTotalAmount !== null);
  const subtotalCents = sumCents(available.map((i) => toCents(i.lineTotalAmount as string)));

  return {
    items,
    currency,
    subtotalAmount: fromCents(subtotalCents),
    itemCount: items.reduce((total, i) => total + i.quantity, 0),
    hasUnavailableItems: items.some((i) => i.priceUnavailable),
  };
}

export async function getCartSummary(pool: Queryable, userId: string, genId: () => string): Promise<CartSummaryDTO> {
  const cart = await getOrCreateCartForUser(pool, userId, genId());
  return computeCartSummary(pool, cart.id, DEFAULT_CURRENCY);
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

  return computeCartSummary(pool, cart.id, DEFAULT_CURRENCY);
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
  return computeCartSummary(pool, item.cart_id, DEFAULT_CURRENCY);
}

export async function removeItemFromCart(pool: Queryable, userId: string, itemId: string): Promise<CartSummaryDTO> {
  const item = await assertOwnsCartItem(pool, userId, itemId);
  await removeCartItem(pool, itemId);
  return computeCartSummary(pool, item.cart_id, DEFAULT_CURRENCY);
}

/**
 * Converts the caller's cart into a real, immutable order — the only place in the codebase that
 * creates an `orders`/`order_items` row. Runs entirely inside one database transaction
 * (src/db/transaction.ts) so the price re-check, the order write, and emptying the cart either all
 * happen together or none of them do; a half-checked-out cart (order created but cart still full,
 * or vice versa) must never be observable, including when this throws partway through.
 *
 * Phase 5A creates the order in `status: 'pending'` / `payment_status: 'unpaid'` only — there is no
 * payment gateway yet (Phase 5C), so no route anywhere can mark an order paid at this stage.
 *
 * Phase 5B extends this same transaction to also issue the order's invoice and its opening
 * `charge` ledger entry (src/services/billing-service.ts#issueInvoiceForOrder) — the order, its
 * items, its invoice, and that invoice's ledger entry are one atomic unit; a checkout can never
 * produce any strict subset of the four.
 */
export async function checkoutCart(pool: Queryable, userId: string, genId: () => string): Promise<OrderDetailDTO> {
  const orderId = genId();

  const { order, items, invoice } = await withTransaction(pool, async (tx) => {
    const cart = await getOrCreateCartForUser(tx, userId, genId());
    const lines = await listCartItemsWithDetails(tx, cart.id, DEFAULT_CURRENCY);

    if (lines.length === 0) {
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

    const orderItems = lines.map((line) => {
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
      };
    });

    const subtotalCents = sumCents(orderItems.map((i) => toCents(i.lineTotalAmount)));
    // Phase 5A has no tax/discount configuration system yet — both are genuinely zero for every
    // order created here, never a fabricated or hidden value. See docs/API_BILLING.md.
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

    await clearCart(tx, cart.id);

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
