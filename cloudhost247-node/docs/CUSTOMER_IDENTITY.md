# Customer identity, username, Security PIN, recovery and support mode

This document is the contract for the customer identity layer: migrations
`0053_customer_identity_and_support_sessions.sql`, `0059_create_auth_recovery.sql`,
`0060_create_totp_mfa.sql`, and `0085_customer_username_pin_and_verification.sql`. It covers:

1. the unique **username** (sign-in handle, changeable from account settings),
2. the permanent nine-digit **Customer ID**,
3. the rotating four-digit **Security PIN**, viewable only behind an emailed code,
4. **account recovery** for a customer who has lost access to their mailbox,
5. the legacy rotating four-digit **Security Number**,
6. **admin user management** (including soft deletion),
7. **support mode** — an administrator temporarily working inside a customer's account,
8. email verification and password recovery, and
9. TOTP multi-factor authentication and recovery codes.

Everything here is additive: `users.id` (uuid) is still the primary key, every existing foreign
key still points at it, and existing authentication, billing and RBAC behaviour is unchanged.
Accounts created by an import or a fixture without a username or PIN are repaired in place — see
"Degradation" at the end.

## 1. Username

| Property | Value |
| --- | --- |
| Column | `users.username varchar(32)` (nullable at the storage layer, always populated in practice) |
| Format | 3–32 chars, starts with a letter, then letters/digits/`.`/`_`/`-`; no leading, trailing or doubled separator |
| Uniqueness | `users_username_lower_unique_idx` — case-insensitive |
| Mutability | changeable from account settings; the previous handle stops working for sign-in immediately |
| Reserved | static list in `src/services/username-service.ts` ∪ the `reserved_usernames` table |

One module (`src/services/username-service.ts`) owns every rule — format, reservation,
case-insensitive uniqueness and suggestions — because the same rules have to apply at registration,
in account settings, and in the admin create-user path. A rule that lives in a zod schema at one
call site is a rule the other call sites do not have.

The format rule and the `users_username_format_check` constraint are kept identical on purpose.
When they drifted, a name like `dots..` passed validation and was then rejected by PostgreSQL, so
the customer got a 500 instead of "choose a different name". `USERNAME_SEPARATOR_PATTERN` exists to
make that drift impossible to reintroduce silently.

**Registration does not require a username.** If the customer supplies one it is validated (a
conflict is a friendly 409 with suggestions); if they leave it blank the server derives one from
the email local-part with punctuation removed and a numeric suffix on collision. This keeps
imports, scripts and pre-0085 API clients working unchanged.

Sign-in accepts a username *or* an email address in the same field
(`identifier`; `email`/`username` are still accepted for older clients) and returns an identical
401 message either way, so the endpoint cannot be used to discover which accounts exist.

## 2. Customer ID

| Property | Value |
| --- | --- |
| Column | `users.customer_id varchar(9)` (widened in place from `varchar(6)`) |
| Format | exactly nine digits, first digit 1–9 (`100000000`–`999999999`) |
| Legacy | six-digit values issued before 0085 are **kept verbatim**, never re-issued |
| Source | `randomInt` (CSPRNG) in `src/services/customer-identity-service.ts` |
| Uniqueness | `users_customer_id_unique_idx` + insert-and-retry on unique violation |
| Mutability | immutable; also enforced by a `BEFORE UPDATE` trigger, not just by convention |

Why insert-and-retry rather than "pick a number, check it's free, insert it": the check-then-act
version races — two concurrent registrations can both see the same candidate as free. The unique
index is the only authoritative answer, so the code inserts and retries on SQLSTATE `23505`
(bounded to 10 attempts, then fails loudly).

The Customer ID is an **identifier, not a credential**. It is displayed to the customer, shown in
the staff directory, searchable by admins, and included in audit metadata. It never authenticates
anything on its own.

Pre-existing accounts were backfilled inside the migration itself, so `customer_id` is never NULL
in practice; `ensureCustomerId()` exists as defence-in-depth for out-of-band imports.

The format check accepts six **or** nine digits for exactly that reason: it is strict about
"digits only" either way, so the column can never hold a UUID, an email address or an arbitrary
string, while a customer who was told "000042" still has a valid, unchanged number.

Immutability is enforced in the database. Assignment happens once (the column starts NULL) and any
later `UPDATE` that changes it aborts with `23514`. Ordinary administrators and customers
therefore cannot rewrite an identifier even if a future route forgets to strip the field from its
input.

`admin_support_sessions.customer_id` (the audit copy taken when staff switch into an account) is
widened in the same migration. It was still `varchar(6)`, which made every "switch to customer"
fail with `22001` the moment the first nine-digit customer was delegated to.

## 3. Security PIN

A four-digit code, `0000`–`9999`, that rotates every 24 hours by default and that **the customer
can actually be shown** after proving control of their verified email address.

| Property | Value |
| --- | --- |
| Verification | `users.security_pin_hash` = HMAC-SHA-256 under `SECURITY_PIN_HMAC_KEY`, per-value random salt |
| Recoverable copy | `users.security_pin_encrypted` = AES-256-GCM envelope `pin1:<iv>:<tag>:<ct>` |
| Lifecycle | `security_pin_created_at`, `security_pin_expires_at`, `security_pin_version`, `security_pin_previous_hash` |
| Service | `src/services/security-pin-service.ts` (hash, seal, rotate), `security-pin-challenge-service.ts` (the gate), `security-pin-email-service.ts` (delivery) |

### Why two copies of the same value

The requirement is "the customer can see their current PIN after email verification". A one-way
hash cannot be shown again, so the PIN is stored twice for two different jobs:

* the **keyed hash** answers "is this the current PIN?" during any future verification, without
  the server ever needing the plaintext;
* the **sealed envelope** lets the application recover the digits for exactly one purpose: showing
  them to the account owner who has just passed email verification.

Domain separation (`...:security-pin:key:v1` vs `...:security-pin:seal:v1`) means one key material
value safely serves both, and the two column values can never be confused for one another. A
database dump alone still reveals nothing: the envelope is useless without the key, and the hash is
useless without the PIN. There is deliberately **no in-memory escrow** — the envelope is the only
recoverable copy, so a process restart can never lose a PIN.

The plaintext PIN is never logged, never placed in a JWT, never written to an audit row, never
returned in a summary payload, and never shown to staff. The only endpoint in the entire
application that returns it is `POST /account/security-pin/reveal`.

### The verification gate

Obtaining the PIN is a three-step sequence, and each step is only reachable from the previous one:

| Step | Endpoint | What it does |
| --- | --- | --- |
| 1 | `POST /api/v1/account/security-pin/view` | Issues a six-digit code **to the account's registered address** and returns a challenge token plus the masked address. The request body has no field for an address, so this cannot be used to send a code elsewhere or to discover which address belongs to an account. |
| 1b | `POST /api/v1/account/security-pin/resend` | Rotates the code on the same challenge. Cooldown + cap, both enforced inside the row lock. |
| 2 | `POST /api/v1/account/security-pin/verify` | Checks the code. Five wrong attempts finish the challenge. |
| 3 | `POST /api/v1/account/security-pin/reveal` | Consumes the verified challenge — once — and returns the current PIN. |

Properties the tests pin down:

* **Verified email required.** An account whose `email_verified_at` is null gets a 403 before a
  code is even generated.
* **One live challenge.** Issuing a new challenge consumes the previous one; a resend reuses the
  token but replaces the code, so an older code is never left alive.
* **Session-bound.** The challenge is keyed to `session_jti`, so a token stolen from another
  session cannot be used to redeem it (404, not 403 — no signal about why).
* **Single use.** `reveal` consumes the challenge in the same transaction; a replay is a 404.
* **Attempts actually count.** See "Correctness notes" below — the counter is committed before the
  failure is reported.
* **Support mode cannot use it.** `security_pin.view` and `security_pin.change` are in
  `SUPPORT_MODE_RESTRICTED_ACTIONS`, so a delegated admin session is refused outright.
* **Codes are sealed in the queue.** `pin_verification_email_queue` stores
  `pinv1:<iv>:<tag>:<ct>` and nothing else; the worker decrypts in memory immediately before
  handing the text to the mail transport. A stale row (expired, consumed, or superseded) is
  cancelled rather than delivered late.

### Rotation

| Path | Where | Purpose |
| --- | --- | --- |
| Proactive | `sweepSecurityPins()` in `src/worker/sweeps.ts` | keeps PINs fresh platform-wide, audited as `scheduled_rotation` |
| Reactive | `GET /api/v1/account/security` calls `ensureCurrentPin()` | guarantees nobody reads a stale PIN if the worker is down |

Rotation never reveals anything: the new value is sealed for the customer, and the plaintext is
discarded by the rotating process. A rotation notice goes out through `user_notifications` (so it
appears in the notification centre) and is idempotent per version; it never contains the PIN.

### Policy (`platform_settings`, super_admin configurable)

| Key | Default |
| --- | --- |
| `security_pin.rotation_hours` | 24 |
| `security_pin.reveal_ttl_seconds` | 30 |
| `security_pin.verification_code_ttl_minutes` | 10 |
| `security_pin.verification_max_attempts` | 5 |
| `security_pin.verification_resend_cooldown_seconds` | 3 |
| `security_pin.verification_max_resends` | 3 |
| `security_pin.notify_on_rotation` | true |

The resend cooldown is three seconds, not thirty. It exists to stop a double-click from sending two
mails and to blunt scripted mail flooding; it is not the defence against guessing, because guessing
is capped separately by `verification_max_attempts` and `verification_max_resends` per challenge
plus a per-route request limit. Thirty seconds turned a mail-client filter into a half-minute dead
end for the customer.

### Admin oversight

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/admin/users/:id/security-pin` | lifecycle metadata only — never the value, hash, salt or envelope |
| POST | `/api/v1/admin/users/:id/security-pin/rotate` | force a rotation; the new value is **not** returned to the administrator |
| GET/PUT | `/api/v1/admin/security-pin/policy` | read / super_admin change |
| GET | `/api/v1/admin/security-pin/due` | accounts whose PIN is due for rotation |

## 4. Account recovery

A customer who cannot complete email verification (lost mailbox, compromised inbox) needs a human,
identity-checked route back in.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/account/recovery` | opens (or returns) the single open request; returns a short reference |
| GET | `/api/v1/account/recovery` | the caller's own recent requests |
| POST | `/api/v1/account/recovery/:id/cancel` | the owner cancels; cross-customer access is a 404 |

A recovery request **never reveals and never resets the PIN**. It records the claim, lets support
verify ownership out of band, and on approval *revokes* compromised verification methods: the
account's `email_verified_at` is cleared and every open PIN challenge is consumed, so the customer
must re-verify before anything security-related works again. Requests are idempotent (a second
click returns the same reference instead of stacking competing claims — the partial unique index
makes that true under a race), and approval is refused until an `IDENTITY_VERIFIED` step has been
recorded (409).

## 5. Security Number

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

## 6. Admin user management

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

## 7. Support mode (account switching)

`POST /api/v1/admin/customers/:id/switch` creates a row in `admin_support_sessions` and mints a
short-lived JWT with two extra claims: `sup` (the session id) and `act` (the acting admin).

* The token authenticates **as the customer** (`sub` = customer uuid) so every ownership-scoped
  route keeps working unchanged, while the real human stays recorded.
* `authenticate()` re-reads the session row on every request: ending it (or letting it expire, or
  the admin losing their role) invalidates the token immediately.
* The customer's password, sessions and Security Number are never read or modified. Their own
  session keeps working throughout.
* Restricted actions — password change, Security Number reveal/change, MFA enrollment/disable,
  payment-method change, account deletion, email change, role change — are refused with 403 and audited
  (`src/lib/support-mode.ts` owns the list).
* The UI shows a persistent banner for the whole session (`SupportModeBanner`), driven by what
  the server reports on `/api/auth/me`, with a one-click "Exit support mode" that ends the
  session server-side and restores the administrator's own session.
* Concurrent sessions are separate rows with separate clocks;
  `GET /api/v1/admin/support-sessions` lists them and
  `POST /api/v1/admin/support-sessions/:id/end` ends one.

## 8. Profile editing and profile images

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

## 9. Audit events

Written to `audit_logs` (free-form `action`), always with `customerId` in metadata and never any
secret:

`customer_identity_created`, `security_number_rotated`, `security_number_revealed`,
`security_number_changed`, `security_number_verification_failed`, `security_number_reveal_failed`,
`security_number_force_rotated`, `security_number_reinitialization_required`,
`security_number_policy_updated`, `account_profile_updated`, `account_profile_image_updated`,
`account_profile_image_removed`, `admin_user_created`, `admin_user_updated`, `admin_user_deleted`,
`admin_customer_account_switch_started`, `admin_customer_account_switch_ended`,
`admin_customer_account_switch_action_blocked`.

From migration 0085:

`security_pin_rotated`, `admin_security_pin_rotated`, `admin_security_pin_policy_updated`,
`account_username_changed`, `security_pin_challenge_requested`, `security_pin_challenge_resent`,
`security_pin_verification_failed`, `security_pin_revealed`, `account_recovery_requested`,
`account_recovery_approved`, `account_recovery_rejected`.

`auth_audit_log` carries the corresponding `event_type` values (widened by 0085) for sign-in-shaped
events: `username_changed`, `security_pin_rotated`, `security_pin_view_challenge_requested`,
`security_pin_view_challenge_resent`, `security_pin_view_verification_failed`, `security_pin_viewed`,
`account_recovery_requested`, `account_recovery_cancelled`, `account_recovery_identity_verified`,
`account_recovery_approved`, `account_recovery_rejected`. No PIN, code or challenge token ever
appears in either table; metadata is limited to ids, versions, timestamps and counts.

## 10. Email verification and password recovery

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

## 11. TOTP multi-factor authentication

Migration `0060_create_totp_mfa.sql` adds optional RFC 6238 TOTP MFA and single-use recovery
codes. It is deliberately a full login boundary—not merely an account-page preference.

| Method | Path | Contract |
| --- | --- | --- |
| POST | `/api/auth/mfa/totp/enroll` | Authenticated password step-up; returns a pending setup secret/standard `otpauth://` URI once. |
| POST | `/api/auth/mfa/totp/confirm` | Proves the pending authenticator and returns ten one-time recovery codes once. |
| GET | `/api/auth/mfa/status` | Authenticated MFA state and remaining recovery-code count. |
| POST | `/api/auth/mfa/disable` | Requires current password and a current TOTP or unused recovery code. |
| POST | `/api/auth/mfa/login/verify` | Anonymous continuation of a password-authenticated, 5-minute MFA login challenge. |

* TOTP seeds in `user_mfa_totp` are encrypted with the existing versioned AES-256-GCM credential
  key ring (`CREDENTIAL_ENCRYPTION_KEY` or `CREDENTIAL_ENCRYPTION_KEYS`). Enrollment fails closed
  with 503 until that key ring is configured; MFA is never quietly enabled with a plaintext or
  unrecoverable seed.
* Recovery codes have 80 random bits each and only SHA-256 digests are stored. They are shown once
  at confirmation, are accepted at login or disable as a fallback, and atomically become unusable
  after redemption.
* Password login returns `202 { mfaRequired, mfaToken }` for an MFA-enrolled user instead of a
  JWT. The short-lived continuation token is stored only as a hash, is bound to the current
  password-session version, permits five attempts, is single-use, and is kept only in frontend
  component memory. A JWT is minted only after a TOTP or recovery factor succeeds. A password
  reset/change invalidates outstanding MFA challenges as well as ordinary sessions.
* Accepted TOTP timesteps are recorded, preventing replay of the same authenticator code within
  its validity period. A one-period clock-skew allowance is supported.
* Enrollment and disable are blocked in delegated support mode and audit all enrollment,
  challenge, failure, enable, disable, and recovery-code events. Passkeys/WebAuthn remain a
  separate future module because they require a reviewed relying-party and origin-registration
  policy.

## 12. Degradation: what happens when something is not configured

The identity layer must not be able to take the platform down, so every dependency has a defined
failure mode.

| Missing | Effect |
| --- | --- |
| `SECURITY_PIN_HMAC_KEY` | Registration and admin account creation still succeed; the account has no PIN yet. `GET /account/security` issues one lazily the first time the card is opened, and "view PIN" returns `503 SECURITY_PIN_UNAVAILABLE` until a key exists. Falls back to `CREDENTIAL_ENCRYPTION_KEY(S)` when unset. |
| `NOTIFICATION_EMAIL_WEBHOOK_URL` / `_TOKEN` | Codes are still generated and queued, but the drain parks them as `CONFIGURATION_REQUIRED` instead of failing. The UI says email delivery is not configured and points the customer at support. |
| Username absent on an inserted row | A `BEFORE INSERT` trigger derives one from the email local-part, bounded to the column width. `users.username` is therefore **not** `NOT NULL`: a hard constraint would turn one sloppy `INSERT` (an import, a fixture) into a 500 at a random call site, while the trigger repairs the row instead. |
| PIN key rotated or lost | Envelopes fail closed: an undecryptable row is marked `FAILED` with "key changed?", and the next rotation issues a fresh PIN. The keyed hash is unaffected. |

## 13. Correctness notes worth remembering

These were real defects found by the integration suite, and each one is worth not reintroducing.

* **A counter incremented inside a transaction that then throws is a counter that never
  increments.** `verifyChallengeCode` originally updated `attempts` and threw `InvalidCodeError`
  from inside `withTransaction`, so the rollback erased the update: five wrong guesses left
  `attempts = 0`, and the cap could never be reached — an unlimited-guess oracle behind a
  six-digit code. The service now returns an outcome from the transaction and throws *after* it
  commits.
* **A drain that selects a column which does not exist never runs.** The PIN mail drain read
  `q.consumed_at` / `q.verified_at` from `pin_verification_email_queue`, where those columns do not
  exist (they belong to the challenge). Liveness now comes from a correlated sub-select against
  `security_pin_challenges`, and it is the challenge — not the queue row — that decides whether a
  code is still worth delivering.
* **Rate-limit buckets are per key, so the key must include the route.** `@fastify/rate-limit`
  keys by client IP by default, which made every route's `config.rateLimit` share one counter: nine
  requests to a 5-per-10-minutes route also exhausted the global allowance for login. The key is
  now `${ip}|${routeOptions.url}`.
* **A field the UI validates must be validated the same way by the database.** The username format
  rule and the check constraint drifted; the customer saw a 500. They now share
  `USERNAME_SEPARATOR_PATTERN`.
