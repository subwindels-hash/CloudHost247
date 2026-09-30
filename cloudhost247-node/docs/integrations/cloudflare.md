# Cloudflare Reseller & Management Integration

CloudHost247 sells and manages Cloudflare (Free/Pro/Business tiers) as a native platform
service: products/plans/pricing live in the existing catalog, purchases flow through the
existing cart/order/invoice/payment/subscription engine, and each Cloudflare service is an
ordinary `customer_services` row backed by a Cloudflare zone.

## Architecture

| Layer | Location |
| --- | --- |
| Provider abstraction | `src/integrations/cloudflare/` (`client`, `config`, `errors`, `types`, `zones`, `dns`, `features`, `analytics`, `sync`) |
| Business layer | `src/services/cloudflare-service.ts` (entitlements, authorization chain, checkout, provisioning pipeline, lifecycle, plan change) |
| Data access | `src/db/cloudflare.ts`; migration `database/migrations/0055_create_cloudflare.sql` |
| Background jobs | `cloudflare_jobs` table + `src/worker/cloudflare-sweep.ts` (runs inside the existing worker) |
| Customer API | `src/routes/cloudflare.ts` → `/api/v1/cloudflare/*` |
| Admin API | `src/routes/admin-cloudflare.ts` → `/api/v1/admin/cloudflare/*` |
| Frontend | `/services/cloudflare[...]` (customer), `/admin/cloudflare` + `/admin/integrations/cloudflare` (admin) |
| Billing hook | `provisionPaidOrder` (`src/services/provisioning-service.ts`) → `provisionCloudflareOrderItem` |

### Tables (migration 0055)

`cloudflare_accounts` (reseller account, AES-256-GCM-encrypted token, single active row),
`cloudflare_plan_mappings` (catalog plan → Cloudflare tier + per-feature entitlements),
`cloudflare_services` (zone-backed service; unique per customer_service, per live zone id, per
live zone name), `cloudflare_dns_records` (synchronized cache with Cloudflare record ids and
SYSTEM_MANAGED/CUSTOMER_MANAGED ownership), `cloudflare_jobs` (durable queue: claim-lease,
attempts, exponential backoff, unique idempotency keys), `cloudflare_api_logs` (request
envelopes, never bodies or tokens). `cart_items` gains a nullable `metadata` column.

## Setup

1. **Encryption key** — the platform's existing `CREDENTIAL_ENCRYPTION_KEY` (or
   `CREDENTIAL_ENCRYPTION_KEYS`) must be configured; Cloudflare tokens are stored as envelopes
   produced by `src/lib/crypto.ts`. No new environment variables are introduced; the account
   configuration lives in the database via the admin UI (spec §74).
2. **Create an API token** in the Cloudflare dashboard with:
   - Zone → Zone → Edit (create/read/pause/delete zones)
   - Zone → DNS → Edit
   - Zone → Zone Settings → Edit (SSL, speed, caching, scrape shield, security level)
   - Zone → Cache Purge → Purge
   - Zone → Analytics → Read (GraphQL analytics)
   - Account → Account Settings → Read (connection test)
   - Zone → DNSSEC → Edit, Zone → Firewall Services → Edit (IP access rules)
   - Billing edit rights on the account if paid rate plans (Pro/Business) will be sold.
3. **Admin → Cloudflare → Accounts**: add account name, Cloudflare Account ID, and the token,
   then press **Test connection**. Expected result `CONNECTED` with the token's permission
   groups; failures report `AUTH_FAILED` / `SERVICE_UNAVAILABLE` / `CONFIGURATION_REQUIRED` —
   nothing is ever simulated.

## Product configuration

1. Create products/plans/pricing in the normal catalog admin (e.g. products "Cloudflare Free /
   Pro / Business" with monthly/annual published pricing — prices are entirely admin-defined).
2. **Admin → Cloudflare → Products**: map each catalog plan to a Cloudflare tier and tick the
   feature matrix (DNS, DNSSEC, analytics, SSL, firewall, speed, caching, cache purge,
   development mode, scrape shield, plan change). Entitlements are enforced server-side on
   every request; the client UI only *additionally* hides disallowed tabs.
3. Tier defaults apply for any feature the admin leaves untouched; an entitlement can never
   exceed what the current Cloudflare API/tier supports (capability layer, spec §58).

## Purchase & provisioning lifecycle

```
Order (plan + domain) → invoice → payment webhook verified
  → customer_service + subscription + cloudflare_service (PENDING) + provision_zone job
  → worker: search zone by name → reuse or create → store zone id + nameservers
  → system DNS (hosting IP, when attached) → default SSL → paid rate plan
  → service ACTIVE, activation_status from Cloudflare's real zone status
```

- Payment gating (spec §68): the service row and job are created **only** inside the webhook
  settlement transaction (`provisionPaidOrder`); an unpaid order provisions nothing.
- Idempotency (spec §42): duplicate settlements hit the unique zone-name/service indexes and
  unique job idempotency keys; provisioning re-runs find-then-create both zones and DNS
  records. Failures retry with backoff `1/5/15/60/240` minutes; exhausted retries mark the
  service `PROVISIONING_FAILED` (never ACTIVE) with the normalized error code.
- Nameservers are displayed with copy buttons; `activation_status` becomes `active` only when
  Cloudflare reports the zone active (spec §55–§56).

### DNS ownership (spec §43–§44)

Records created by hosting automation carry `ownership = SYSTEM_MANAGED` (comment
`ch247:system`) and cannot be edited/deleted through the customer API; sync never reassigns
ownership, and hosting-IP synchronization only ever touches system-managed rows.

### Suspension / termination policies

`platform_settings`:
- `cloudflare.suspension_policy` — `pause_zone` (default; stops proxying) or `none`.
- `cloudflare.termination_policy` — `delete_zone` (default) or `detach`.
- `cloudflare.sync_interval_minutes` — scheduled zone re-sync cadence (default 360).
- `cloudflare.enabled` — master switch (fail-closed when off).

### Plan changes (spec §25)

Customer selects a new mapped plan → priced changes create an order + invoice; the
`change_plan` job runs only after the payment webhook settles. Zero-priced downgrades queue
immediately. Entitlements follow the new plan's mapping automatically.

## Error model (spec §35)

`CLOUDFLARE_AUTH_FAILED`, `CLOUDFLARE_PERMISSION_DENIED`, `CLOUDFLARE_ZONE_NOT_FOUND`,
`CLOUDFLARE_RECORD_NOT_FOUND`, `CLOUDFLARE_RATE_LIMITED` (429), `CLOUDFLARE_API_ERROR`,
`CLOUDFLARE_TIMEOUT`, `CLOUDFLARE_CONFIGURATION_REQUIRED` (503), `CLOUDFLARE_SERVICE_UNAVAILABLE`
(503), `CLOUDFLARE_FEATURE_NOT_SUPPORTED`. Clients receive stable codes + safe messages; raw
upstream payloads stay in server logs / `cloudflare_api_logs`.

## Security

- Tokens: encrypted at rest, write-only through the API, never logged, never in URLs or
  frontend bundles; account responses expose only `has_token`.
- Authorization chain on every customer endpoint: authenticated → owns service → service
  active → feature entitled → zone id read from OUR row (spec §46); missing and foreign
  resources are indistinguishable (404) to block IDOR/enumeration (spec §71).
- Destructive operations require explicit confirmation client-side and are audited
  (`cloudflare.*` actions in `audit_logs`) with actor, IP, and user agent.
- Purge-by-URL validates every URL's host belongs to the service's zone.

## Testing

- `tests/unit/cloudflare-client.test.ts` — error normalization, retry/backoff, auth handling,
  zone-reuse idempotency, capabilities/entitlements, safe messages.
- `tests/integration/cloudflare-api.test.ts` — full-stack against embedded Postgres and the
  scripted in-memory Cloudflare (`tests/helpers/mock-cloudflare.ts`; mocks exist only in
  tests): admin config + encryption + connection test, fail-closed without configuration,
  billing-gated provisioning + duplicate-settlement idempotency, provisioning failure → 
  `PROVISIONING_FAILED`, DNS CRUD + ownership, cross-customer 404s, entitlement 403s, DNSSEC/
  SSL/caching/firewall/purge/analytics, billing-gated plan change, lifecycle, sync
  reconciliation, dashboard aggregates + secret-free logs.

## Deployment & rollback

Deploy: `npm run build` → `npm run migrate` (applies 0055, additive-only) → restart app +
worker. Rollback: revert the release; migration 0055 may remain applied (all tables are new
and unused by prior code; `cart_items.metadata` is nullable). To disable the module without a
deploy, set `cloudflare.enabled = false` (fail-closed) or disable the account row.

## Known limitations

- Renewal invoicing follows the platform's existing subscription engine; per-period renewal
  invoices are generated by the same machinery as other subscription products.
- Multi-account routing is schema-ready (multiple `cloudflare_accounts` rows) but the resolver
  currently uses the single active account.
- The reference product's deprecated Cloudflare features (legacy minify, mobile redirect) are
  intentionally not exposed; modern equivalents (Brotli, HTTP/3, Early Hints, Rocket Loader)
  are (spec §59).
