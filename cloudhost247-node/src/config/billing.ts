/**
 * Phase 5 commerce/billing configuration constants.
 *
 * `DEFAULT_CURRENCY` is the platform's single supported currency for now (explicit product
 * decision — see docs/API_BILLING.md "Explicit non-goals"). It is deliberately a source-level
 * constant, not a client-supplied request field anywhere: every price lookup, cart line, order,
 * and (later) invoice/payment record uses this value, never one read from a request body. Letting
 * a client choose or influence the currency used for a monetary calculation would be a
 * price-manipulation vector in exactly the same family as letting it choose the price itself.
 * Multi-currency support is out of scope until a future phase explicitly adds it.
 */
export const DEFAULT_CURRENCY = 'USD';

/**
 * Maximum quantity a single cart line (and therefore a single order line) may carry.
 *
 * This is the one source of truth for that number: the request-validation schema
 * (src/routes/commerce.ts), the additive add-to-cart upsert guard (src/db/carts.ts), and the
 * database CHECK constraints (`cart_items_quantity_positive_check` in
 * database/migrations/0015_create_cart_items.sql and `order_items_quantity_positive_check` in
 * 0017) must all agree. Changing it here requires a matching migration — the database constraint
 * is the real backstop and is deliberately not derived from this constant at runtime.
 */
export const MAX_CART_ITEM_QUANTITY = 20;
