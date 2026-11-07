# Genuine Multi-Currency Architecture

**Date:** 2026-11-07 · **Branch:** `arena/1b329121-cloudhost247` · **Canonical stack:** `cloudhost247-node/` (see `docs/ARCHITECTURE-DECISION-RECORD.md`)
**Status:** core implemented and unit-tested; **surface wiring gated by the standing financial freeze**. See §6 for exactly what is and is not live.

> This replaces the display-only FX model (`database/migrations/0083_create_display_fx_rates.sql`, `docs/CURRENCY_DISPLAY.md`) with a canonical-price model. The old model stays in place, untouched, until cutover — no financial setting was changed.

---

## 1. Principle

**One canonical price per product/term/currency, authored in the backend. A charge is never computed at display time and never re-converted after it is frozen.**

| Old (display-only, rejected) | New (canonical) |
| --- | --- |
| Every price stored in USD; UI multiplies by a rate and shows an "estimate" | `catalog_plan_pricing` holds a real price row **per currency** |
| Cart/checkout/invoice charge USD while the UI shows GBP/NGN | Cart, checkout, payment, invoice, renewal, dashboard and refund all carry the **same frozen `TransactionMoney`** |
| Rate may be stale or invented; rounding undocumented | Immutable FX snapshot with source + `observedAt` + `snapshotId`; HALF_UP exact integer rounding |
| A country change can silently alter an existing order's currency | `assertTransactionMoneyUnchanged` refuses any currency/amount mutation on a frozen transaction |
| Legal disclaimer needed because the charged amount differs | No disclaimer needed: displayed amount == charged amount |

## 2. What is implemented now (code + tests)

All in `cloudhost247-node/src/currency/`, pure TypeScript with **no DB writes, no network calls, no gateway activation**:

| File | Responsibility |
| --- | --- |
| `registry.ts` | ISO 4217 currency definitions (12 supported currencies incl. GBP/USD/NGN/EUR/JPY), minor-unit exponents, `BASE_CURRENCY = 'USD'`, `COUNTRY_CURRENCY` mapping (`GB→GBP`, `US→USD`, `NG→NGN`, …), `currencyForCountry()` |
| `money.ts` | Exact BigInt decimal arithmetic: `parseExactDecimal`, `toMinorUnits`, `fromMinorUnits`, `convertCanonicalPrice`, `roundHalfUpDivide`, `formatMoney`. **No JS float** is used for an amount. FX rate parsed as an exact rational. Rounding is `HALF_UP`, applied **once** at price creation. |
| `rates.ts` | `FxRateSource` interface, `FxRateSnapshot` (frozen, validated), `createFxRateSnapshot` (rejects non-finite/zero/negative/unsupported), `assertFresh` (fails closed on stale rates), `rateFromSnapshot`, `StaticFxRateSource` for isolated tests, documented ECB/Frankfurter endpoints (not activated) |
| `snapshot.ts` | `TransactionMoney` (frozen): charge currency, exact minor-unit amount, `pricingId`, canonical currency/amount, full FX provenance, `frozenAt`, `schemaVersion`. `freezeTransactionMoney`, `assertTransactionMoneyUnchanged`, `refundMoney` (original currency, never re-converted), `transactionMoneyLabel` |
| `index.ts` | single public entry point |

**Tests:** `cloudhost247-node/tests/unit/multi-currency.test.ts` — **14/14 passed** (`npx vitest run tests/unit/multi-currency.test.ts`). Covered: country→currency defaults and USD fallback; zero-decimal currencies (JPY/KRW); exact HALF_UP rounding including a large NGN magnitude (`12.99 USD × 1500 → 1,948,500 kobo`); malformed-rate rejection; stale-rate fail-closed; FX provenance requirement; **immutability** (a later country detection or a later FX feed cannot rewrite a frozen GBP order); refunds in the original currency; invariant that a canonical price must not carry an FX conversion.

Typecheck: `npm run typecheck` clean.

## 3. Canonical data model (designed; migration NOT applied)

A single **forward migration** `0084_create_canonical_currency_pricing.sql` (proposed; requires D2 authorisation before any production application) would add, without modifying existing rows:

```sql
-- 1. Real prices, one per plan / billing period / currency. USD remains the authoring base.
CREATE TABLE canonical_plan_prices (
  id uuid PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES catalog_product_plans(id),
  billing_period varchar(24) NOT NULL,
  currency char(3) NOT NULL,                    -- FK-like CHECK against the registry
  amount_minor numeric(20,0) NOT NULL CHECK (amount_minor >= 0),
  canonical_currency char(3) NOT NULL DEFAULT 'USD',
  canonical_amount_minor numeric(20,0) NOT NULL CHECK (canonical_amount_minor >= 0),
  fx_rate_snapshot_id uuid NULL REFERENCES fx_rate_snapshots(id),
  fx_rate numeric(20,10) NULL,
  rounding_rule varchar(16) NOT NULL DEFAULT 'HALF_UP',
  effective_from timestamptz NOT NULL,
  effective_status varchar(16) NOT NULL DEFAULT 'published',
  UNIQUE (plan_id, billing_period, currency, effective_from)
);

-- 2. Immutable, auditable FX snapshots (source, observation time, exact rates).
CREATE TABLE fx_rate_snapshots (
  id uuid PRIMARY KEY,
  source varchar(64) NOT NULL,
  observed_at timestamptz NOT NULL,
  base_currency char(3) NOT NULL DEFAULT 'USD',
  rates jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Frozen charge on every monetary row (append-only columns, NO UPDATE of existing values).
--    carts.cart_items, orders, order_items, invoices, payments, subscriptions, refunds each get:
--      charge_currency char(3), charge_amount_minor numeric(20,0),
--      fx_snapshot_id uuid NULL, price_frozen_at timestamptz, pricing_id uuid NULL,
--      money_snapshot jsonb   -- the full TransactionMoney, immutable after insert
--    plus a trigger / CHECK forbidding UPDATE of charge_currency / charge_amount_minor / money_snapshot.
```

**Invariant:** `money_snapshot` is written **once** at cart-item creation and copied verbatim into order → invoice → payment → renewal → refund. A country/currency preference change affects only *new* carts. `assertTransactionMoneyUnchanged()` is called before any update; a DB-level trigger is the second line of defence.

Exchange-rate source: reliable feeds already modelled in `modules/addons/cloudhost247_currency/lib/Providers/{EcbProvider,FrankfurterProvider}.php` (`EndpointResolver`, `RateMath`, `UpdateEngine`). The Node `FxRateSource` uses the same provenance fields. **No live feed is activated**; `StaticFxRateSource` supplies deterministic rates in tests.

## 4. Surface-by-surface plan (exact paths)

| Surface | Change | Exact paths | Freeze gate |
| --- | --- | --- | --- |
| Product catalogue | Public DTO returns only published canonical prices for the selected currency, with currency + amount + `pricingId`; never a converted estimate | `src/routes/catalog-public.ts`, `src/services/catalog-service.ts`, `src/db/{catalog-products,catalog-plans,catalog-pricing}.ts` | none (read-only) |
| Product pricing (admin) | Author prices per currency; require an FX snapshot + HALF_UP rounding for derived prices; store provenance | `src/routes/catalog-admin.ts`, `src/db/catalog-pricing.ts` | none (code) |
| Country detection | Trusted-proxy validated country → default currency; user may override **before** a cart is created | `src/routes/currency.ts` (`/api/v1/currency/geo-country` currently returns `country: null`), `src/currency/registry.ts` | none |
| Currency consistency | One `CurrencyProvider` value used on product pages, pricing cards, cart, checkout, invoices, dashboard | `frontend/src/currency/**`, `frontend/src/i18n/format.ts`, `frontend/src/pages/{Pricing,Cart,Billing,Invoices,InvoiceDetail,Dashboard}*` | none |
| Shopping cart | Freeze `TransactionMoney` on each `cart_item` at add time; re-pricing requires an explicit, audited cart update | `src/routes/commerce.ts`, `src/db/commerce*.ts`, `src/services/commerce-service.ts` | D2 (billing tables) |
| Checkout | Charge exactly the frozen currency/amount; reject any mismatch before payment initiation | `src/routes/commerce.ts`, `src/services/payment-service.ts`, `src/routes/payments.ts` | **D2 — gateways must stay inactive** |
| Payment processing | Gateway amount/currency must equal `money_snapshot`; minor-unit scale per currency (NGN kobo, JPY zero) | `src/services/payment-service.ts`, `src/routes/webhooks.ts`, `modules/gateways/**`, `platform/src/lib/money.js` | **D2** |
| Invoices | Print frozen currency/amount plus FX provenance; never recompute at render time | `src/routes/billing.ts`, `frontend/src/pages/{InvoicesPage,InvoiceDetailPage}.tsx`, `templates/cloudhost247/**` | D2 |
| Renewals | Renewal inherits the subscription's frozen currency and canonical `pricingId`; a new FX rate never reprices an existing subscription silently | `src/routes/subscriptions.ts (new)`, `src/routes/billing.ts` | **D2** |
| Customer dashboard | Shows the same frozen currency/amount as the invoice; currency switcher never rewrites history | `frontend/src/pages/{DashboardPage,BillingPage}.tsx` | none |
| Refunds | `refundMoney(original, partial?)` — same currency, never converted, bounded by the original | `src/services/payment-service.ts`, `src/routes/payments.ts`, `src/currency/snapshot.ts` | **D2** |
| PHP/WHMCS parity | WHMCS addon must read the same canonical prices/snapshots, not its own display FX | `modules/addons/cloudhost247_currency/**`, `templates/cloudhost247/**`, `lang/overrides/**` | **D5** (staging WHMCS) |

## 5. Rounding and display rules (explicit)

1. All amounts are **decimal strings of minor units**; no float, no `BigInt` in JSON.
2. `HALF_UP` (half away from zero) is applied **once**, when a canonical price is derived from the USD base using a recorded rate: `targetMinor = HALF_UP(sourceMinor × rate × 10^targetScale / (10^sourceScale × 10^rateScale))`.
3. Zero-decimal currencies (JPY, KRW) have no fractional minor unit. `platform/src/lib/money.js` additionally documents that `NUMERIC(16,2)` cannot credit 8-decimal BTC amounts and refuses them by name — that limit must be preserved or the ledger widened explicitly.
4. `Intl.NumberFormat` handles locale-specific symbols, separators, dates and numbers; it **never** determines the charged amount.
5. If no fresh, validated FX snapshot exists, price creation **fails closed** (`FxRateUnavailableError`). No estimate, no stale rate, no silent fallback.
6. A displayed amount equals the charged amount. Appearance of `docs/CURRENCY_DISPLAY.md`'s "estimated conversion" disclaimer means the old path is still in use and must not be shown to a customer as a price.

## 6. Honest status

| Item | Status |
| --- | --- |
| Canonical currency registry, exact money arithmetic, FX snapshot model, immutable transaction snapshots | **Complete and verified** (14/14 unit tests, typecheck clean) |
| Country→currency default mapping with USD fallback | **Complete and verified** (unit tests); not yet wired to `/api/v1/currency/geo-country` |
| Schema migration `0084`, DB columns/triggers, cart/checkout/invoice/renewal/refund wiring | **Not implemented — gated by the financial freeze (D2)**. No production payment setting, gateway, webhook or quarantined migration was touched. |
| Live FX feed activation | **Not activated** — requires provider approval (`docs/PROVIDER-COMPARISON.md`) |
| PHP/WHMCS currency parity | **Blocked by external provider** — needs licensed WHMCS + cPanel staging (`docs/STAGING-ENVIRONMENT-REQUIREMENTS.md`) |
| Old display-only FX (`0083`, `docs/CURRENCY_DISPLAY.md`) | **Still present and untouched**; must remain visibly labelled "estimate / USD charge" until cutover |

I did **not** apply any migration, change any existing monetary column, activate a gateway, enable a webhook, or process a transaction. The currency work in this phase is deliberately isolated to pure, tested primitives plus a design that can be reviewed before any financial change is authorised.

## 7. Acceptance criteria for the future cutover (requires D2 + D5)

- A GB customer sees GBP on the product page, pricing card, cart, checkout, invoice and dashboard — and is charged exactly that GBP amount.
- A US customer sees/charges USD; an NG customer sees/charges NGN; other supported countries get their currency; unsupported countries get USD with no conversion.
- Changing country/currency **after** an order exists does not change that order or its invoice (DB trigger + service guard + test).
- Refunds are in the original currency at the original frozen amount.
- Renewals keep the subscription's currency.
- FX provenance (source, observedAt, snapshotId, rate, rounding rule) is recorded and auditable.
- No price appears that is not backed by a canonical price row; no TLD/plan price literal is committed.
- Both PHP/WHMCS and React/Node show the same currency for the same invoice.
- All of the above proven with mocks in an isolated test environment; **no live transaction**.
