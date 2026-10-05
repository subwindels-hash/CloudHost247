# Migration notes — cloudhost247-node (Fastify/TS) → platform (zero-dep monolith)

This document is the parity ledger. Every row is a capability in the Fastify platform and where it
lives (or whether it is deferred) in the new `platform/`. The new platform keeps **wire
compatibility** for error codes, JWT shape, and route paths so the two can run side by side during
the cutover.

## Framework replacements (all core-module)

| Old | New | Notes |
|-----|-----|-------|
| `fastify` (52 imports) | `src/core/router.js` + `src/core/http.js` | params/wildcards/405; HEAD→GET fallback; error handler mirrors `app.setErrorHandler` |
| `zod` (44) | `src/core/validate.js` | chainable DSL; steps run in declaration order (`trim().email()` works); collects all issues |
| `@fastify/helmet` | `src/core/security.js` | same header set; CSP is Report-Only unless production |
| `@fastify/cors` | `src/core/cors.js` | origin allowlist; credentials only for explicit origins; never `*` with credentials |
| `@fastify/rate-limit` | `src/core/ratelimit.js` | per-process fixed window; auth routes use a separate tighter limiter keyed by IP |
| `@fastify/static` | `src/core/static.js` | etag/304, ranges (206), gzip/br precompressed, traversal guard, SPA fallback |
| `pino` | `src/core/logger.js` | JSON in prod, pretty in dev; same level semantics; `child()` |
| `dotenv` | `src/core/config.js` | own `.env` parser; host env wins over file; empty string reads as unset |
| `bcryptjs` | `src/lib/password.js` | scrypt (memory-hard, no toolchain). See "Password hashes" below. |
| `jsonwebtoken` | `src/lib/jwt.js` | HS256, byte-compatible; rejects `alg:none` and wrong-secret; per-token `jti` |
| TOTP/QR deps | `src/lib/totp.js` + `src/lib/qr.js` | RFC 6238 + recovery codes; QR enrolment image implemented (see "QR codes") |

## Domain parity

| Domain | Old file(s) | New | Status |
|--------|-------------|-----|--------|
| health | `routes/health.ts` | `domains/health.js` | full (liveness no-DB; readiness checks storage) |
| auth core | `routes/auth.ts` | `domains/auth.js` | register/login/refresh/logout/me/password/email/MFA. Legacy `/api/auth/*` aliases kept |
| account | `routes/account.ts` | `domains/account.js` | caller-scoped; 404-not-403 for foreign records; support-mode guard on identity changes |
| catalog public | `routes/catalog-public.ts` + `services/catalog-service.ts` | `domains/catalog.js` | public DTOs only; draft/archived and inactive pricing hidden |
| catalog admin | `routes/catalog-admin.ts` | `domains/catalog.js` | role-gated CRUD with manual cascade on the JSON backend |

## Security behaviours preserved verbatim

- **Login timing equalisation**: unknown-email path performs a dummy verification so account
  existence is not measurable.
- **No account enumeration** on `password/forgot` (identical 200 either way).
- **Wrong current password = 400**, not 401 — a 401 while holding a token tells the SPA the session
  is dead and clears it; a mistyped current password must not log the user out. (Real bug caught by
  the old platform's frontend tests; preserved.)
- **Session-version invalidation**: password change increments `auth_session_version` in the same
  write as the hash; `authenticate()` compares it and floors `password_changed_at` to whole seconds
  before comparing with JWT `iat` (do not move to millisecond precision — see comment in
  `src/lib/auth.js`).
- **Revocation by `jti`** on logout; refresh tokens are rotated and single-use.
- **RBAC re-read from the store** on every role-gated request (never trusted from the JWT).

## Storage

- **JSON file store (default)**: one file per table under `DATA_DIR`, atomic writes, unique-index
  enforcement, transactions with rollback. Single-process by design.
- **PostgreSQL**: `src/store/pg-store.js` generates SQL from `src/store/schema.js`; identifiers are
  allowlisted so injection is impossible by construction. `scripts/migrate.js` applies the schema.
- The schema registry mirrors the old `database/migrations/00*.sql` column names so records are
  shape-compatible across platforms.

## Password hashes (bcrypt → scrypt)

The new platform hashes with scrypt and can *read* scrypt hashes, but deliberately does **not**
re-implement Blowfish, so a legacy `bcrypt$...`/`$2b$...` hash verifies `false`. Those users must
reset their password (the login route says exactly that). `scripts/rehash-passwords.js` is the
supported migration path, and it **cannot do more than invite a reset** — re-hashing needs the
plaintext, and nobody has it. It runs dry by default, reports `legacy-bcrypt` accounts, stale-parameter
scrypt hashes (which only need the login route's upgrade-on-sign-in) and blank hashes, and with
`--apply` writes only `auth_recovery` rows of kind `password_reset` with
`sha256(random 32-byte token)` and a one-hour expiry — the same contract as
`POST /api/v1/auth/password/forgot`. It refuses to stack a second invite on a live one unless
`--force`; raw tokens go to stdout only outside production, otherwise to a `0600` `--out` file, and
production `--apply` refuses to run without one. There is no mail transport in this build, so
delivery is explicitly the operator's job.

## QR codes (TOTP enrolment)

`src/lib/qr.js` is a dependency-free QR encoder (byte mode, versions 1–40, EC L/M/Q/H, automatic
version and mask selection, SVG + 1-bit greyscale PNG + `data:` URI output). `POST
/api/v1/auth/mfa/totp/enroll` returns `qrPngDataUri` next to `secret` and `otpauthUri`, so clients
never have to draw a QR code themselves; the React Security page renders it.

Confidence comes from independent tools, not from the encoder agreeing with itself:

- `tests/fixtures/qr-reference.json` holds **744 matrices from python-qrcode 8.2**, an unrelated
  implementation: every version at every level, every mask at a spread of versions, full-capacity
  payloads, and four real `otpauth://` URIs. All 744 match byte-for-byte, and all 264 full-capacity
  payloads select the same version unaided. Regenerate with `tests/fixtures/generate-qr-fixtures.py`
  (needs `qrcode==8.2`; `segno==1.6.6` is optional).
- The same fixture carries **32 penalty-score checks from segno 1.6.6** and five synthetic matrices
  that isolate each penalty rule, so a single wrong rule cannot hide in a plausible total.
- The test suite reads the **bits back out** of a finished matrix and recomputes the Reed–Solomon
  codewords with a second, independently written GF(256) implementation, and decodes the PNG with a
  reader that shares no code with the writer.
- The PNG the API actually serves was decoded back to the exact `otpauth://` URI by an **independent
  decoder** — OpenCV 5.0.0, `cv2.QRCodeDetector`:
  `python -c "import cv2; print(cv2.QRCodeDetector().detectAndDecode(cv2.imread('enrol.png', 0))[0])"`
  (install `opencv-python-headless`; not a project dependency).

Two honest limits: mask *choice* is not compared across encoders (all eight masks encode the same
data; scoring-border conventions differ), and `margin: 0` output is legal but not scanner-readable —
the API always uses the standard 4-module quiet zone, and `tests/qr.test.js` covers a margin of 0
only as an image-encoding edge case. One deviation is documented rather than hidden: segno 1.6.6
appends a spurious `0x00` pad codeword where ISO/IEC 18004 §7.4.10 says to start the `0xEC`/`0x11`
alternation immediately; that matrix is stored as `segno_padding_deviation` and the test asserts the
difference.

## Deliberately deferred (open items)

These are real capabilities of the old platform that were not ported in this pass. They are called
out so nobody mistakes absence for parity:

1. **WebAuthn / passkeys — IMPLEMENTED without `@simplewebauthn/server`.** This platform has no
   runtime dependencies, so the protocol is written in-tree on `node:crypto`:
   `src/lib/webauthn/{cbor,cose,authenticator-data,verify,options}.js` (strict RFC 8949 decoder,
   COSE_Key → SPKI, ceremony verification for ES256/RS256/PS256/EdDSA) and the routes in
   `src/domains/passkeys.js`: `GET /auth/passkeys`,
   `POST /auth/passkeys/register/options|verify`, `PATCH|DELETE /auth/passkeys/:id`,
   `POST /auth/passkeys/login/options|verify` — each also under the legacy `/api/auth/*` alias.
   Enrolment and removal require the current password and are refused during a support session.
   A challenge is single-use, expires in five minutes, belongs to one ceremony, and is burned
   *before* verification so a failed attempt cannot be ground against it. Sign-in mints the same
   session shape as password login. Sign-in is email-first **or** usernameless via a discoverable
   credential: with no email the ceremony carries an empty `allowCredentials`, the account is
   resolved from the credential the authenticator chose, and `userHandle` is matched against it.
   (With `residentKey: 'preferred'`, a hardware key configured for non-resident credentials will not
   appear in the usernameless flow; those users type their email.)
   Deliberately **not** implemented, and refused by name rather than faked: attestation formats
   other than `none` — this build requests `attestation: 'none'` and has no trust-anchor store for
   `packed` / `tpm` / `android-key` / Apple / `fido-u2f` attestation, so a non-`none` `fmt` is a
   named refusal. Coverage is unit + integration (a software authenticator drives the real server
   over HTTP, including the browser-shaped base64url marshalling that
   `public/assets/js/webauthn.js` performs) with mutation checks on every refusal rule — but **no
   real browser or hardware authenticator has driven a ceremony** (the sandbox has no WebAuthn
   stack). That limitation is recorded in `docs/UNFINISHED-BUILD-CODE-NAMES.md` rather than
   presented as verified.
2. ~~**QR enrolment image** for TOTP.~~ **Implemented 2026-10-05** — `src/lib/qr.js` and
   `qrPngDataUri` on the enrolment response; see "QR codes" above for the evidence and the limits
   (mask choice is not compared across encoders; a zero-margin render is legal but not
   scanner-readable).
3. **AWS SDK adapters** (EC2/Route53/CloudWatch/instance-connect) and the infrastructure /
   provisioning / marketplace / deployments / dns / ssl / firewall / revenue-guardian / ai domains.
   By design these are the largest surface and are ported incrementally; adding their tables to
   `src/store/schema.js` and a `domains/*.js` module is the established pattern.
   **Update 2026-10-05 — the adapter layer is fully ported and the first domain calls it.**
   All twelve kinds live in `src/lib/providers/`, and `src/lib/provider-egress.js` is now the single
   place a domain may construct one (it fails closed before egress, never fabricates a result, and
   keeps the provider's own error text server-side). `src/domains/infrastructure.js` uses it for
   three request-scope calls: provider diagnostics (`POST /admin/providers/:id/test`), OS image
   verification (`POST /admin/os-images/:id/test`, which now stamps `verified_at` only on a real
   provider answer) and server reconciliation (`healthCheck` per server). What is still deferred is
   *writing* provider state — create/resize/snapshot and the provisioning worker that would execute
   queued jobs — and no call has been made to a real provider account.
   `src/domains/servers.js` followed the same day: the console route issues a real provider session
   (normalized through an explicit field whitelist, with the session's credential never written to an
   audit log), and every lifecycle action passes one capability gate in `queueAction`, so a provider
   that documents no rescue system refuses instead of returning `202` and a job that could only fail.
   `src/lib/provisioning-worker.js` closes the loop the same day: it executes every queued job kind
   against the provider that owns the machine — idempotent creation on the job id, retryable-vs-final
   failure classification, and secrets kept off the job row an admin can read. Exposed as one cycle
   per request (`POST /admin/provisioning/worker/run`) rather than a background timer, so a deployment
   schedules it. What is still deferred is the *order-driven* provisioning path — `services.js` and
   `app-installations.js` still queue paid-order work this worker does not yet know about.
   `src/domains/operating-systems.js` closed its last deferral the same day, and it is the read side
   of the same question: which of these can a customer actually order. New
   `src/lib/os-availability.js` resolves each OS version through `server_product_configurations` →
   `regions` → `infra_providers` → `os_images` and answers `orderable` plus exactly one reason
   (`NO_CONFIGURATION`, `CONFIGURATION_DISABLED`, `ARCHITECTURE_UNSUPPORTED`, `NO_IMAGE`,
   `IMAGE_UNVERIFIED`). `GET /api/v1/operating-systems/:id/versions` returns only buildable versions,
   each with an `availability` block, plus a `hidden` count; `?includeUnavailable=true` is
   staff-only and returns the withheld ones with their reasons. `GET /api/v1/operating-systems` omits
   any OS with no orderable version. **An `os_images` row is not a mapping until it carries a
   `version`:** matching images on `os_id` alone let Ubuntu 22.04 borrow 24.04's verified mapping, and
   the same join was how the worker picked a build image — so a customer could have been given a
   machine running the wrong release from a mapping that had passed verification. Both the catalogue
   and the worker match the version now, and the worker refuses when `servers.os` is unrecorded and
   more than one version is mapped instead of choosing a release for the customer.
4. **Real payment gateways — INBOUND HALF IMPLEMENTED, initiation still deferred.** Received and
   settled: `stripe`, `paypal` and `paystack` webhooks via `src/lib/gateways/` +
   `src/lib/provider-webhook-service.js` (signature verified before any database access, canonical
   event mapping, unique-index claiming with lease takeover, zero-trust amount/currency/owner
   invariants, settlement through the shared `applySuccessfulPayment`). Still open, and refused with
   the reason rather than faked: **initiating** a checkout with a real provider, which needs live
   provider egress and PSP credentials this build does not have. `GET
   /api/v1/billing/invoices/:id/payment-methods` reports each gateway's availability and why, and
   initiation of an unavailable gateway is a 400 naming the missing piece. The sandbox and manual
   gateways remain the usable ones locally.
5. **Domain availability lookup** (`GET /api/v1/domains/availability`). The public site degrades to
   honest client-side validation until the domain-services domain is ported.

## How to port the next domain

1. Add its tables to `src/store/schema.js` (works on both backends immediately).
2. Create `src/domains/<name>.js` exporting `{ name, register(router, deps) }`.
3. Add it to `DOMAINS` in `src/app.js`.
4. Add integration tests in `tests/` using `tests/helpers.js`.
