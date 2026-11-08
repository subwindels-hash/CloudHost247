/**
 * The WHMCS integration layer exists so that every hosting, domain, SSL and support operation the
 * website offers is executed by WHMCS — the system that owns billing, invoicing, payment gateways,
 * provisioning modules and the customer record — instead of by a second platform pretending to be
 * one. Nothing in this directory may invent a price, a product id, a provisioning result or a
 * success.
 *
 * Layering (and why each piece is separate):
 *
 *   config    — what the deployment was told, validated; never a hardcoded fallback
 *   errors    — one taxonomy, so a route can answer honestly instead of catching `unknown`
 *   transport — the only code that speaks HTTP; swappable for a fake in tests
 *   client    — WHMCS `includes/api.php` semantics: auth, JSON, retries, circuit breaker, logging
 *   schemas   — the response shapes this project relies on, validated before use
 *   catalogue — WHMCS product/group/pricing payloads normalised into what a page may display
 *   product-map — the verified service → product binding; the ONLY source of product ids
 *   cart      — the WHMCS cart hand-off, built only from a verified binding
 *   sso       — the one-identity link and the single-use session hand-off into the client area
 *   orderability — the single public verdict "may this be bought online, in these cycles"
 *   discovery — the read-only C1 snapshot of a real installation, and its review report
 *   idempotency — one durable record per order/payment operation, so a retry cannot double-charge
 */

export * from './types';
export * from './errors';
export * from './config';
export * from './transport';
export * from './schemas';
export * from './client';
export * from './catalogue';
export * from './product-map';
export * from './cart';
export * from './sso';
export * from './orderability';
export * from './discovery';
export * from './idempotency';
