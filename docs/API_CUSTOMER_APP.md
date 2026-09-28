# Customer App API Contract (Phase 4)

This document is the API contract for the Phase 4 "Customer App" layer: self-service customer
account management, passive/informational service and domain records, and a basic support ticket
system, plus the staff-side (admin/super_admin) management surface for all of it. Keep this in
sync with the code — the source of truth is `cloudhost247-node/src/routes/account.ts` and
`cloudhost247-node/src/routes/admin-customers.ts`; this document should never describe behavior
the code doesn't actually have.

Nothing described here talks to cPanel/WHM, a domain registrar, or WHMCS. There is no checkout,
cart, order, payment, or billing ledger in this layer — see "Explicit non-goals" below.

## Architecture

```
Customer App API (Fastify routes)
  src/routes/account.ts           (self-service, /api/v1/account/*)
  src/routes/admin-customers.ts   (staff-side, /api/v1/admin/customers/*, /api/v1/admin/tickets/*)
        │
        ▼
Repository layer
  src/db/users.ts               (profile/password/status/role/directory)
  src/db/customer-services.ts   (passive service records)
  src/db/customer-domains.ts    (passive domain records)
  src/db/support-tickets.ts     (tickets + threaded messages)
        │
        ▼
PostgreSQL (database/migrations/0008..0013)
```

Both route files build their JSON responses only through `src/dto/account.ts`, the same
"never leak an internal field, never leak someone else's data" pattern used by the Phase 3 catalog
DTOs (`src/dto/catalog.ts`).

## Data model summary

- `customer_services` (`0008_create_customer_services.sql`) / `customer_domains`
  (`0009_create_customer_domains.sql`) — **passive, staff-entered-only informational records.**
  Creating or editing a row here never calls any cPanel/WHM/registrar API and never
  provisions, activates, renews, or verifies anything technical. They exist purely so a customer
  can see an accurate summary of what staff say they have. `product_id`/`plan_id` on
  `customer_services` are optional soft links into the Phase 3 catalog (`ON DELETE SET NULL`,
  never a hard dependency). `customer_domains.domain_name` is intentionally **not** globally
  unique — it is a staff record, not a live registry.
- `support_tickets` (`0010`) / `support_ticket_messages` (`0011`) — basic threaded support
  messaging. Ticket `status` lifecycle: `open` → `pending_staff` (customer replied, awaiting
  staff) / `pending_customer` (staff replied, awaiting customer) → `closed`. A customer reply on a
  closed ticket **reopens it** (see `src/db/support-tickets.ts`) instead of being silently dropped.
- `users.password_changed_at` (`0012`) — see "Password change & session invalidation" below.
- `auth_audit_log` event types were widened (`0013`, not a new table) to also accept
  `profile_update`, `password_change`, `admin_status_change`, `admin_role_change`.

## Authorization model

Every route in both files re-verifies the caller against the database on every request — never
trusts the JWT's `role`/`status` claims alone, matching the pattern already established for the
Phase 3 catalog admin API (`src/routes/catalog-admin.ts`).

| Capability | customer | admin | super_admin |
|---|---|---|---|
| Edit own full name / change own password | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| View/reply to own tickets | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| View own services/domains (read-only) | ✅ (self only) | ✅ (self only) | ✅ (self only) |
| View customer directory / any customer's detail | ❌ | ✅ | ✅ |
| Create/edit any customer's service or domain record | ❌ | ✅ | ✅ |
| View/reply to/change status of any ticket | ❌ | ✅ | ✅ |
| Suspend / reactivate / disable a customer account | ❌ | ❌ | ✅ |
| Change a customer's role | ❌ | ❌ | ✅ |

- Self-service routes (`registerAccountRoutes`) call `authenticate()`
  (`src/lib/require-auth.ts`) only — any active, authenticated account may use them, always
  scoped to their own `userId`.
- Staff routes (`registerAdminCustomerRoutes`) call `requireRole()` (`src/lib/require-role.ts`),
  which re-reads the caller's current role from `users` on every call. Most routes accept
  `admin` or `super_admin` (`CUSTOMER_MANAGEMENT_ROLES`); the account-status and role-change
  routes accept `super_admin` only (`ACCOUNT_INTEGRITY_ROLES`).
- A `super_admin` cannot change their **own** role via `PATCH /api/v1/admin/customers/:id/role`
  (returns `400`) — a deliberate guard against a super_admin locking every admin out of
  customer/catalog management with no way to undo it from inside this app.
- Frontend hiding of admin-only UI is UX only. Every authorization decision above is enforced
  server-side; there is no route that trusts a client-supplied role.

## Ownership isolation & 404-not-403

Every self-service route filters explicitly by the caller's own `userId`. A record that exists but
belongs to a different customer is **never** distinguishable from a record that doesn't exist at
all — both return `404 NOT_FOUND`, never `403 FORBIDDEN`. This is deliberate: returning 403 would
confirm to an attacker that a given ticket/service/domain id belongs to *someone*, even if not to
them. See `GET /api/v1/account/tickets/:id` and `POST /api/v1/account/tickets/:id/messages` in
`src/routes/account.ts` for the concrete implementation, and
`tests/integration/account-api.test.ts` ("...rejects access to another customer's ticket with 404
(not 403)") for the automated proof.

## Password change & session invalidation

**Contract:**

1. `POST /api/v1/account/password` verifies `currentPassword` against the stored hash, then
   updates `password_hash` **and stamps `password_changed_at = now()`** in the same statement
   (`src/db/users.ts#updatePasswordHash`).
2. Every JWT whose `iat` (issued-at) claim predates the account's current `password_changed_at`
   is rejected with `401` on its very next use, in `authenticate()`
   (`src/lib/require-auth.ts`) — even though that token's own signature and expiry are still
   perfectly valid, and even though it was never explicitly logged out.
3. A token minted **after** the password change (e.g. a fresh login) continues to work
   immediately — there is no server-side lag or grace period.
4. This mechanism is completely independent of the existing `jti`/`revoked_tokens` explicit-logout
   mechanism (`0003_create_revoked_tokens.sql`, `POST /api/auth/logout`). Logging out one specific
   browser/device/token still only ever affects that one token; a password change affects *every*
   outstanding token for that account at once.

**Migration backfill (binding, deliberate):** `0012_add_password_changed_at_to_users.sql`
backfills every pre-existing user's `password_changed_at` to **epoch**
(`1970-01-01T00:00:00Z`) — **never** `now()`. Backfilling to `now()` would mean every session that
exists anywhere at the moment this migration runs is immediately treated as "issued before the
last password change" and force-logged-out on its very next request, even though no password
actually changed — a surprising, disruptive side effect of an unrelated deploy. Backfilling to
epoch means every pre-existing session keeps working exactly as it did before; the new check only
ever takes effect the first time a given customer actually changes their password from then on.

**Comparison precision trade-off (deliberate, documented, accepted — not a bug):** JWT `iat` is
whole-second precision (a standard `NumericDate`, per RFC 7519), while Postgres `timestamptz`
(`password_changed_at`) carries microsecond precision. `authenticate()` floors
`password_changed_at` down to whole-second precision before comparing it against `iat`. This
guarantees a freshly issued post-change token always validates immediately — the common,
important case of "user changes their password, then immediately logs in again." Its accepted,
narrow trade-off is the mirror image: **a token that was issued in the exact same wall-clock
second as the password change (before the change) is not invalidated by this check alone**, and
remains valid until it separately expires or is explicitly logged out.

This is judged an acceptable, narrow residual limitation, not a security gap: it requires an
attacker to already hold a valid, unexpired, unrevoked token *and* for the legitimate password
change to happen to land in the exact same one-second window as that token's issuance. The
alternative (sub-second/millisecond comparison) would instead guarantee failure for every
legitimate "change password then immediately re-login" flow — a strictly worse, reproducible UX
break in exchange for closing an implausible-to-engineer race. Do not attempt to "fix" this by
moving to sub-second comparison. See the comment above the check in `src/lib/require-auth.ts` for
the same rationale in code, and `tests/integration/account-api.test.ts` for the test that forces a
real >1s delay around the password-change step so the assertion deterministically crosses a whole
second boundary rather than racing wall-clock timing.

## Self-service API — `/api/v1/account/*`

Requires `Authorization: Bearer <token>` for every route below. `authenticate()` also re-checks
the account's current `status` (rejecting anything not `active`) and the password-invalidation
rule above on every call.

### `PATCH /api/v1/account/profile`

Body: `{ "fullName": string (1-255 chars) }`. Updates the account's display name — **full name
only**; there is no self-service email change (out of scope until an email-verification flow
exists). Records a `profile_update` audit event. Returns `{ user: PublicUserDTO }`.

### `POST /api/v1/account/password`

Body: `{ "currentPassword": string, "newPassword": string (min 10 chars) }`. Rate-limited to 10
requests/minute. Returns `401` if `currentPassword` is wrong (and makes no change at all — the
hash is only ever touched after successful verification). On success: `204 No Content`, and
invalidates every other outstanding session per the contract above. Records a `password_change`
audit event.

### `GET /api/v1/account/services`

Read-only list of the caller's own `customer_services` rows. Returns
`{ services: CustomerServiceDTO[] }` (no `notes`/`created_by` — staff-only fields). There is no
`POST`/`PATCH` here: customers cannot create or modify their own service records (see "Explicit
non-goals").

### `GET /api/v1/account/domains`

Read-only list of the caller's own `customer_domains` rows. Returns
`{ domains: CustomerDomainDTO[] }`. Same read-only, staff-notes-excluded shape as services above.

### `GET /api/v1/account/tickets`

Returns `{ tickets: TicketSummaryDTO[] }` for the caller only.

### `POST /api/v1/account/tickets`

Body: `{ "subject": string (1-255), "message": string (1-10000), "priority"?: "low"|"normal"|"high" }`.
Creates a new ticket plus its first message (`authorRole: "customer"`). Returns `201` with
`{ ticket: TicketSummaryDTO }`.

### `GET /api/v1/account/tickets/:id`

Returns full detail + message thread for the caller's own ticket, or `404` (never `403`) if the id
doesn't exist or belongs to someone else.

### `POST /api/v1/account/tickets/:id/messages`

Body: `{ "message": string (1-10000) }`. Appends a customer reply; reopens the ticket if it was
`closed`. `404` (never `403`) for another customer's ticket id. Returns `201` with the updated
ticket + full thread.

## Staff API — `/api/v1/admin/customers/*`, `/api/v1/admin/tickets/*`

Requires `Authorization: Bearer <token>` for an account whose **current** role (re-checked in the
database) is `admin` or `super_admin`, except where noted `super_admin`-only.

### `GET /api/v1/admin/customers`

Query: `search?` (matches email or full name, case-insensitive substring), `role?`
(`customer|admin|super_admin`), `limit?` (1-100, default 25), `offset?` (default 0). Returns
`{ customers: AdminCustomerSummaryDTO[], total: number }`.

### `GET /api/v1/admin/customers/:id`

Returns the customer's profile plus **all** of their services, domains, and tickets in one call
(admin-variant DTOs, including `notes`/`created_by`/`updatedAt`). `404` if the id doesn't exist.

### `PATCH /api/v1/admin/customers/:id/status` — **super_admin only**

Body: `{ "status": "active"|"suspended"|"disabled" }`. Records an `admin_status_change` audit
event with `targetUserId`/`newStatus` in `metadata`. A suspended/disabled account's existing,
otherwise-valid JWTs stop working on their very next request, because `authenticate()` re-checks
`status` on every call (see `src/lib/require-auth.ts`).

### `PATCH /api/v1/admin/customers/:id/role` — **super_admin only**

Body: `{ "role": "customer"|"admin"|"super_admin" }`. Returns `400` if `id` is the caller's own id
(self-role-change is refused outright — see "Authorization model" above). Records an
`admin_role_change` audit event.

### `POST /api/v1/admin/customers/:id/services` / `PATCH /api/v1/admin/customers/:id/services/:subId`

Create or edit a passive service record for a specific customer. `PATCH` requires at least one
field and 404s if `subId` doesn't belong to that `id`. Neither ever calls any hosting/provisioning
API — see "Explicit non-goals".

### `POST /api/v1/admin/customers/:id/domains` / `PATCH /api/v1/admin/customers/:id/domains/:subId`

Same pattern as services, for `customer_domains`. Neither ever calls a registrar API.

### `GET /api/v1/admin/tickets`

Query: `status?`, `limit?` (1-100, default 25), `offset?` (default 0). Returns every customer's
tickets (not scoped to one customer) — `{ tickets: TicketSummaryDTO[], total: number }`.

### `GET /api/v1/admin/tickets/:id`

Full detail + thread for any ticket, plus the owning customer's summary. `404` if it doesn't
exist (there is no ownership restriction for staff — that's the point of this surface).

### `POST /api/v1/admin/tickets/:id/messages`

Body: `{ "message": string (1-10000) }`. Appends a staff reply with `authorRole` set to the
caller's real, DB-verified role (`admin` or `super_admin`), not a hardcoded value.

### `PATCH /api/v1/admin/tickets/:id`

Body: `{ "status": "open"|"pending_customer"|"pending_staff"|"closed" }`. Directly sets ticket
status (e.g. staff closing a resolved ticket without necessarily posting a reply).

## Explicit non-goals (binding — do not add without a new phase of explicit approval)

This layer deliberately does **not** include: checkout, cart, orders, payments, payment gateways,
a billing ledger, real invoices, automated provisioning, cPanel/WHM API calls, domain registrar
API calls, automatic service activation, automatic domain registration/renewal, email
verification/change, 2FA, SSO, or file uploads. `customer_services`/`customer_domains` records
must always be presented in the UI as staff-entered informational records only — never as
evidence CloudHost247 automatically provisioned or verified anything.
