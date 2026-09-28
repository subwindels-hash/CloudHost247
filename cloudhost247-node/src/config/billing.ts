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
