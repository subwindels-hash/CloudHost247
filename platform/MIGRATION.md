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
| TOTP/QR deps | `src/lib/totp.js` + `scripts/generate-icons.js` | RFC 6238 + recovery codes; QR enrolment image deferred (see below) |

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
reset their password (the login route says exactly that). A bulk re-enrolment tool
(`scripts/rehash-passwords.js`) is the intended follow-up; it is **not yet implemented**.

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
2. **QR enrolment image** for TOTP. The secret + `otpauth://` URI are returned; a self-contained
   QR+PNG encoder is not yet written (the PNG encoder in `scripts/generate-icons.js` is a start).
3. **AWS SDK adapters** (EC2/Route53/CloudWatch/instance-connect) and the infrastructure /
   provisioning / marketplace / deployments / dns / ssl / firewall / revenue-guardian / ai domains.
   By design these are the largest surface and are ported incrementally; adding their tables to
   `src/store/schema.js` and a `domains/*.js` module is the established pattern.
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
