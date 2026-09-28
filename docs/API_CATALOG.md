# Catalog API Contract (Phase 3)

This document is the API contract for the catalog/application-façade layer added in Phase 3. It
covers everything under `/api/v1/catalog/*` (public) and `/api/v1/admin/catalog/*` (authenticated
admin). Keep this in sync with the code — the source of truth is
`cloudhost247-node/src/routes/catalog-public.ts` and `cloudhost247-node/src/routes/catalog-admin.ts`;
this document should never describe behavior the code doesn't actually have.

## Architecture

```
Node Catalog API (Fastify routes)
        │
        ▼
Catalog Service / Repository layer (src/services/catalog-service.ts, src/db/catalog-*.ts)
        │
        ▼
PostgreSQL (database/migrations/0004..0007)
```

Routes never query the database directly. Public routes only ever read through
`src/services/catalog-service.ts`, which enforces "only public/active data" and "only published
pricing" as a single, centrally-tested rule. Admin routes read/write through the same
`src/db/catalog-*.ts` repository functions. This is the seam a later phase's WHMCS-backed adapter
(`WHMCS Adapter → Catalog Repository`) would slot into without changing routes or DTOs.

Nothing here talks to WHMCS. WHMCS remains the authoritative order/billing system; this catalog is
an independent, currently order-less product/plan/pricing model for this new Node app.

## Data model summary

- `products` — a sellable category (`slug`, `name`, `description`, `product_type` ∈
  `hosting | domain | service`, `status` ∈ `draft | active | disabled`, `visibility` ∈
  `public | private`, `display_order`).
- `product_plans` — a plan/tier under a product (`slug` unique per product, `name`, `description`,
  `status` ∈ `draft | active | disabled`, `billing_model` ∈ `one_time | recurring`,
  `display_order`).
- `plan_pricing` — one row per billing period for a plan (`billing_period` ∈
  `one_time | monthly | quarterly | semi_annually | annually`, `currency`, `amount`, `setup_fee`,
  `effective_status` ∈ `draft | published`). A row can exist with `amount = NULL` — this is the
  honest "price not configured yet" state. A DB `CHECK` constraint
  (`plan_pricing_published_requires_amount_check`, migration `0006`) makes it structurally
  impossible to mark a price `published` without a real `amount`; the admin API also validates
  this before hitting the database, to return a clean `400` instead of a raw constraint error.
- `plan_features` — normalized feature rows per plan (`name`, `value`, `display_order`,
  `visibility` ∈ `public | private`). Only `public` features are ever returned by the public API.

"Available" in every public DTO always means: `product.status = 'active'` (for a product) — never
inferred from plan/pricing contents. A product can be publicly *listed* while still `draft`
(`available: false`, "coming soon") — see below — but its plans/pricing are never exposed while
draft.

## Public API — `/api/v1/catalog/*`

No authentication. No internal fields (ids, `status`, `visibility`, unpublished pricing, private
features) are ever present in these responses.

### `GET /api/v1/catalog`

Full public catalog — every publicly-visible product (`visibility = 'public'`), regardless of
`status`, ordered by `display_order`.

**Response `200`:**
```json
{ "products": [ PublicProductSummary, ... ] }
```

### `GET /api/v1/catalog/products?type=<hosting|domain|service>`

Same as above, optionally filtered by product type.

- `type` omitted → all public products.
- `type` present and valid → filtered.
- `type` present and invalid (not one of the three enum values) → `400 VALIDATION_ERROR`. The
  parameter is validated, never silently ignored.

**Response `200`:** `{ "products": [ PublicProductSummary, ... ] }`

### `GET /api/v1/catalog/products/:slug`

Detail for one product, plus its plan summaries (no pricing/features — use the `/plans` endpoint
for that).

- `slug` must match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase, digits, single hyphens) or `400
  VALIDATION_ERROR`.
- Slug well-formed but no matching *public* product (doesn't exist, or is `visibility = 'private'`)
  → `404 NOT_FOUND`. A private product and a genuinely missing slug are **intentionally
  indistinguishable** from the outside — the public API never reveals that a private product
  exists.
- Product exists and is public but `status != 'active'` (`draft`) → `200`, `available: false`,
  `plans: []`. A draft-but-public product is listed as "coming soon", never as an error and never
  with fabricated/partial plan data.
- Product exists, public, `status = 'active'` → `200`, `available: true`, `plans` populated with
  `PublicPlanSummary` entries for that product's active plans.

**Response `200`:** `{ "product": PublicProductDetail }`

### `GET /api/v1/catalog/products/:slug/plans`

Full plan detail (pricing + features) for one product.

- Same slug validation/404 rules as above.
- Draft-but-public product → `200`, `{ "product": {...}, "plans": [] }` (no partial data leak).
- Active product → `200`, `plans` is an array of `PublicPlan`, one per **active** plan under that
  product. Each plan's `pricing` array contains only rows with `effective_status = 'published'`
  (never a `draft`/no-amount row); each plan's `features` array contains only
  `visibility = 'public'` features. A plan can legitimately have `pricing: []` if nothing has been
  published for it yet — this is shown as-is, never substituted with an invented price.

**Response `200`:** `{ "product": PublicProductSummary, "plans": [ PublicPlan, ... ] }`

## Public DTOs (TypeScript, `src/dto/catalog.ts` / mirrored in
`cloudhost247-node/frontend/src/lib/catalog-types.ts`)

```ts
interface PublicProductSummary {
  slug: string;
  name: string;
  description: string | null;
  productType: 'hosting' | 'domain' | 'service';
  displayOrder: number;
  available: boolean; // true only when status === 'active'
}

interface PublicProductDetail extends PublicProductSummary {
  plans: PublicPlanSummary[];
}

interface PublicPlanSummary {
  slug: string;
  name: string;
  description: string | null;
  billingModel: 'one_time' | 'recurring';
  displayOrder: number;
}

interface PublicPlan extends PublicPlanSummary {
  pricing: PublicPrice[];   // published rows only
  features: PublicFeature[]; // public-visibility rows only
}

interface PublicPrice {
  billingPeriod: 'one_time' | 'monthly' | 'quarterly' | 'semi_annually' | 'annually';
  currency: string;   // ISO 4217, uppercase
  amount: number;      // JS number, never a string; always present here (published implies an amount)
  setupFee: number | null; // null, not omitted, when no setup fee
}

interface PublicFeature {
  name: string;
  value: string | null;
  displayOrder: number;
}
```

## Error shape (all endpoints, public and admin)

```json
{ "error": "VALIDATION_ERROR", "message": "human-readable description" }
```

| HTTP status | `error` code (typical) | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed/invalid input (bad enum, bad UUID, bad slug shape, business-rule violation e.g. publishing with no amount) |
| 401 | `UNAUTHORIZED` | Missing/invalid/expired/revoked JWT (admin routes only) |
| 403 | `FORBIDDEN` | Authenticated but not `super_admin` (admin routes only) |
| 404 | `NOT_FOUND` | No such public product/plan/pricing/feature row, or admin row by id |
| 429 | `RATE_LIMITED` | Rate limit exceeded (global Fastify rate-limit plugin, unchanged from Phase 2) |
| 500 | `INTERNAL_ERROR` | Unexpected server error |

## Admin API — `/api/v1/admin/catalog/*`

**Authentication:** `Authorization: Bearer <JWT>`, required on every route. Uses the same
JWT/`jti`-revocation model as Phase 2 (`src/lib/require-auth.ts`) — a token that has been logged
out via `/api/auth/logout` is rejected here too.

**Authorization:** `requireRole('super_admin')` (`src/lib/require-role.ts`). Catalog
administration is restricted to `super_admin` only — a plain `admin` role is **not** sufficient
(defense in depth: catalog mutation is treated as a highly sensitive operation). The role is
always read from the server-verified JWT claims, never trusted from any client-supplied value.

All mutations are persisted to PostgreSQL through the repository layer
(`src/db/catalog-products.ts`, `catalog-plans.ts`, `catalog-pricing.ts`, `catalog-features.ts`) —
there is no React-state-only "fake" admin UI; every create/update call here is a real `INSERT`/
`UPDATE` and is asserted to have happened via a follow-up read in
`tests/integration/catalog-admin-api.test.ts`.

### Products

| Method & path | Body | Notes |
|---|---|---|
| `GET /api/v1/admin/catalog/products` | – | Full admin product list — includes `draft`/`disabled`/`private` products, unlike the public list. |
| `POST /api/v1/admin/catalog/products` | `{ slug, name, description?, productType, status?, visibility?, displayOrder? }` | Creates a product. `slug` must be unique. |
| `GET /api/v1/admin/catalog/products/:id` | – | Full detail for one product **by UUID**, including its draft plans, unpublished pricing, and private features — i.e. everything the public API deliberately hides. `:id` must be a valid UUID (`400` otherwise); unknown id → `404`. |
| `PATCH /api/v1/admin/catalog/products/:id` | Any subset of `{ name, description, productType, visibility, displayOrder }` | Partial update; only supplied fields change; `updated_at` always bumps. |
| `POST /api/v1/admin/catalog/products/:id/status` | `{ status: 'draft' \| 'active' \| 'disabled' }` | Enable/disable a product. Setting `disabled` (or leaving `draft`) removes it from the public catalog **immediately** — verified in `catalog-admin-api.test.ts` by reading the public endpoint right after. |

### Plans

| Method & path | Body | Notes |
|---|---|---|
| `POST /api/v1/admin/catalog/products/:id/plans` | `{ slug, name, description?, billingModel, status?, displayOrder? }` | Creates a plan under product `:id`. `slug` unique per product. `404` if the product id doesn't exist. |
| `PATCH /api/v1/admin/catalog/plans/:id` | Any subset of `{ name, description, billingModel, displayOrder }` | Partial update. |
| `POST /api/v1/admin/catalog/plans/:id/status` | `{ status: 'draft' \| 'active' \| 'disabled' }` | Enable/disable a plan; a disabled/draft plan is excluded from `listActivePlansForProduct` and therefore from every public response, immediately. |

### Pricing

| Method & path | Body | Notes |
|---|---|---|
| `POST /api/v1/admin/catalog/plans/:id/pricing` | `{ billingPeriod, currency, amount?, setupFee?, effectiveStatus? }` | Creates a pricing row for plan `:id`. If `effectiveStatus: 'published'` is requested with no `amount`, rejected with `400 VALIDATION_ERROR` **before** touching the database (the DB `CHECK` constraint is a second, independent line of defense, not the primary UX). |
| `GET /api/v1/admin/catalog/pricing/:id` | – | Full pricing row by id, including `draft` rows and `amount: null`. |
| `PATCH /api/v1/admin/catalog/pricing/:id` | Any subset of `{ currency, amount, setupFee, effectiveStatus }` | Partial update. If the resulting row (existing amount, or the amount in this same patch) would be `published` with no amount, rejected with `400 VALIDATION_ERROR`. Publishing an amount and setting `effectiveStatus: 'published'` in the **same** request is supported and succeeds. |

### Features

| Method & path | Body | Notes |
|---|---|---|
| `PUT /api/v1/admin/catalog/plans/:id/features` | `{ features: [{ name, value?, displayOrder?, visibility? }, ...] }` | Replaces the full feature set for plan `:id` in one call (delete + re-insert, transactional). `visibility` defaults to `public`; set `private` for internal-only notes that must never reach the public API. |

All `:id` params above are validated as UUIDs (`400 VALIDATION_ERROR` on malformed input, distinct
from `404` for a well-formed-but-nonexistent id).

## Security notes

- Public endpoints are read-only and return no internal identifiers, no `draft`/`disabled`/
  `private` rows, and no unpublished pricing/private features, under any query parameter
  combination — enforced by the repository-level filtering in `src/services/catalog-service.ts`,
  not by route-level post-filtering.
- Admin endpoints require both authentication (`require-auth.ts`) and authorization
  (`requireRole('super_admin')`) independently; either failing returns the appropriate `401`/`403`
  and takes no action. Every admin mutation test in `tests/integration/catalog-admin-api.test.ts`
  is proven by reading the row back from the database or from the public API afterward — not just
  asserting a `200`.
- No endpoint here performs a WHMCS table passthrough; there is no direct WHMCS DB
  connection/credential anywhere in this code path.

## What Phase 3 explicitly does not include

No order, cart, checkout, payment, invoice, or service-activation/provisioning endpoints exist
anywhere in this API. Pricing shown here is informational catalog pricing only; no endpoint in this
document creates a purchase, charges a payment method, or activates a service. That is explicitly
deferred to a future phase.
