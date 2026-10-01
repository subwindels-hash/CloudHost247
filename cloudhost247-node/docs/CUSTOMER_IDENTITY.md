# Customer identity, Security Number, user management and support mode

This document is the contract for the identity layer added in migration
`0053_customer_identity_and_support_sessions.sql`. It covers four related features:

1. the permanent six-digit **Customer ID**,
2. the rotating four-digit **Security Number**,
3. **admin user management** (including soft deletion), and
4. **support mode** — an administrator temporarily working inside a customer's account.

Everything here is additive: `users.id` (uuid) is still the primary key, every existing foreign
key still points at it, and existing authentication, billing and RBAC behaviour is unchanged.

## 1. Customer ID

| Property | Value |
| --- | --- |
| Column | `users.customer_id varchar(6)` |
| Format | exactly six digits, zero-padded (`000042` is valid) |
| Source | `randomInt` (CSPRNG) in `src/services/customer-identity-service.ts` |
| Uniqueness | `users_customer_id_unique_idx` + insert-and-retry on unique violation |
| Mutability | immutable; never reassigned, never released (even after soft deletion) |

Why insert-and-retry rather than "pick a number, check it's free, insert it": the check-then-act
version races — two concurrent registrations can both see the same candidate as free. The unique
index is the only authoritative answer, so the code inserts and retries on SQLSTATE `23505`
(bounded to 10 attempts, then fails loudly).

The Customer ID is an **identifier, not a credential**. It is displayed to the customer, shown in
the staff directory, searchable by admins, and included in audit metadata. It never authenticates
anything on its own.

Pre-existing accounts were backfilled inside the migration itself, so `customer_id` is never NULL
in practice; `ensureCustomerId()` exists as defence-in-depth for out-of-band imports.

## 2. Security Number

A four-digit code that rotates every 24 hours by default.

* **Storage**: `users.security_number_hash` holds a bcrypt hash (cost 12) and nothing else. The
  plaintext is never persisted, never logged, never placed in a JWT, never written to an audit
  row, and never returned to an administrator. It appears exactly once — in the response body of
  the request that generated it, to the account's owner.
* **Lifecycle columns**: `security_number_created_at`, `security_number_expires_at`,
  `security_number_version` (incremented on every rotation, which is what kills the old value),
  and `security_number_initialized` (false for legacy accounts and after an admin forces
  re-initialization).
* **Service**: all generation, hashing, verification, rotation, expiry and status logic lives in
  `src/services/security-number-service.ts`. No route implements its own.

### Rotation is enforced twice, deliberately

| Path | Where | Purpose |
| --- | --- | --- |
| Proactive | `sweepSecurityNumbers()` in `src/worker/sweeps.ts`, every 5 minutes | keeps numbers fresh platform-wide |
| Reactive | `GET /api/v1/account/security-number/status` calls `rotateIfExpired()` | guarantees nobody is locked out if the worker is down |

### Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/account/security-number/status` | metadata only; rotates on the spot if expired |
| POST | `/api/v1/account/security-number/reveal` | step-up (password) required, rate limited 5/min, issues and returns a new value |
| POST | `/api/v1/account/security-number/change` | requires the current value; restarts the window from now |
| GET | `/api/v1/admin/users/:id/security-number` | admin: lifecycle metadata only |
| POST | `/api/v1/admin/users/:id/security-number/rotate` | admin: force a rotation |
| POST | `/api/v1/admin/users/:id/security-number/require-reinitialization` | super_admin only |
| GET/PUT | `/api/v1/admin/security-number/policy` | super_admin configures policy |

Because only a hash is stored, "reveal" necessarily *issues a new number* — recovering the old
one is impossible by construction, for everyone including platform operators. Failed
verifications are recorded in `security_number_attempts` and throttled by policy
(`max_verification_attempts` per `attempt_window_seconds`) in addition to the route rate limit.

### Policy (platform_settings, super_admin configurable)

| Key | Default |
| --- | --- |
| `security_number.rotation_hours` | 24 |
| `security_number.allow_manual_rotation` | true |
| `security_number.require_step_up` | true |
| `security_number.max_verification_attempts` | 5 |
| `security_number.attempt_window_seconds` | 60 |
| `security_number.reveal_ttl_seconds` | 120 |
| `support_mode.session_minutes` | 30 |

## 3. Admin user management

`GET/POST /api/v1/admin/users` and `GET/PATCH/DELETE /api/v1/admin/users/:id`.

* Search matches email, full name and phone by substring, and Customer ID or internal UUID
  exactly.
* Creating a user issues a Customer ID and an initial Security Number automatically; the creating
  administrator does **not** see the Security Number.
* Role and status changes are super_admin-only, and self-role/self-status changes are refused
  (lockout protection), matching the pre-existing `/api/v1/admin/customers` rules.
* `DELETE` is a **soft delete**: `status = 'deleted'`, `deleted_at`/`deleted_by` stamped, the row
  and its Customer ID retained. Invoices, payments, tickets and audit entries keep resolving.
  Hard deletion is not offered because it would orphan financial history.

## 4. Support mode (account switching)

`POST /api/v1/admin/customers/:id/switch` creates a row in `admin_support_sessions` and mints a
short-lived JWT with two extra claims: `sup` (the session id) and `act` (the acting admin).

* The token authenticates **as the customer** (`sub` = customer uuid) so every ownership-scoped
  route keeps working unchanged, while the real human stays recorded.
* `authenticate()` re-reads the session row on every request: ending it (or letting it expire, or
  the admin losing their role) invalidates the token immediately.
* The customer's password, sessions and Security Number are never read or modified. Their own
  session keeps working throughout.
* Restricted actions — password change, Security Number reveal/change, payment-method change,
  account deletion, email change, role change — are refused with 403 and audited
  (`src/lib/support-mode.ts` owns the list).
* The UI shows a persistent banner for the whole session (`SupportModeBanner`), driven by what
  the server reports on `/api/auth/me`, with a one-click "Exit support mode" that ends the
  session server-side and restores the administrator's own session.
* Concurrent sessions are separate rows with separate clocks;
  `GET /api/v1/admin/support-sessions` lists them and
  `POST /api/v1/admin/support-sessions/:id/end` ends one.

## 5. Profile editing and profile images

`GET/PATCH /api/v1/account` exposes only the safe fields (name, phone, address, city, state,
postal code, country). The zod schema is `.strict()`, so an attempt to send `role`, `status`,
`customerId`, `id`, `email` or any security field is rejected with 400 rather than silently
ignored.

Profile images are uploaded as base64 on the JSON API and stored in `user_profile_images`
(database-backed — see the module docblock for why no new object store was introduced). The
server re-derives everything: whitelisted MIME type (PNG/JPEG/WebP/GIF), magic-byte sniffing that
rejects SVG/HTML/scripts outright, extension agreement, a 2 MiB cap on decoded bytes, and a
server-generated uuid as the storage key. Bytes are served from an authenticated route with
`X-Content-Type-Options: nosniff`.

## 6. Audit events

Written to `audit_logs` (free-form `action`), always with `customerId` in metadata and never any
secret:

`customer_identity_created`, `security_number_rotated`, `security_number_revealed`,
`security_number_changed`, `security_number_verification_failed`, `security_number_reveal_failed`,
`security_number_force_rotated`, `security_number_reinitialization_required`,
`security_number_policy_updated`, `account_profile_updated`, `account_profile_image_updated`,
`account_profile_image_removed`, `admin_user_created`, `admin_user_updated`, `admin_user_deleted`,
`admin_customer_account_switch_started`, `admin_customer_account_switch_ended`,
`admin_customer_account_switch_action_blocked`.

## 7. Email verification and password recovery

Migration `0059_create_auth_recovery.sql` adds durable, independent recovery primitives without
putting a bearer link into an ordinary notification or storing it in plaintext.

| Method | Path | Contract |
| --- | --- | --- |
| POST | `/api/auth/email-verification/confirm` | Redeems a single-use 24-hour verification link. |
| POST | `/api/auth/email-verification/resend` | Authenticated resend; Fastify + per-account throttled. |
| POST | `/api/auth/password-reset/request` | Anonymous, non-enumerating request; always returns 202 for a syntactically valid email. |
| POST | `/api/auth/password-reset/confirm` | Redeems a single-use 30-minute link and replaces the password. |

### Token and delivery properties

* `auth_action_tokens` contains a SHA-256 digest only, never a raw email-verification or password
  reset token. A raw link is domain-separated HMAC output derived only in worker memory from the
  action UUID, purpose and `JWT_SECRET`; it is not persisted in `auth_email_outbox`, logs, audit
  metadata or API responses.
* Issuing a replacement marks any older unused token of the same purpose unusable. Redemption is
  one `UPDATE … RETURNING` under a transaction, so concurrent clicks cannot consume it twice.
  Expired, superseded, consumed and signing-key-invalidated queue entries become visible
  `CANCELLED` rows instead of being sent as misleading links.
* `auth_email_outbox` uses the same explicitly configured operator email webhook as notifications,
  but is a separate table because a reset request must not create an in-app notification. The
  worker delivers it in the normal one-shot Cron cycle with lease, bounded retries and
  `CONFIGURATION_REQUIRED` handling. Until `NOTIFICATION_EMAIL_WEBHOOK_URL` and
  `NOTIFICATION_EMAIL_WEBHOOK_TOKEN` are configured, no email is claimed as delivered.
* Reset requests have a route limit (5 per 15 minutes) and a database-backed per-account limit
  (3 per hour). Known, unknown and inactive email addresses get the same accepted response.
* A completed reset increments `users.auth_session_version` in the same SQL write as the new
  password hash. Every earlier JWT—including one issued in the same second—is rejected, while a
  fresh login receives the new version immediately. `password_changed_at` remains stamped for
  audit/backward compatibility.

Email verification currently confirms contactability and is surfaced in `/api/auth/me` and the
Account page. It does not yet gate all customer actions; enforcing verification as a policy gate
should be a separately reviewed product decision so existing customers and administrator-created
accounts are migrated deliberately.
