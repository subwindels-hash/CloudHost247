# Phase 19 — Production Configuration, Secrets Management & Infrastructure Security Audit (2026-11-09, HEAD `fa4782d5`+; source-traced, secrets never printed)

## Audit basis

Everything asserted here traces to code (`src/config/env.ts` — 96 declared keys; `src/plugins/security.ts`
— helmet/CORS/rate-limit; `src/plugins/audit-log.ts`; `database/migrations/*`; `OPERATIONAL-READINESS.md`).
No credential values shown; secrets referenced by name only.

## 12-point audit

| # | Area | Engineering verdict | Evidence |
|---|---|---|---|
| 1 | Every env/secret dependency | **Complete inventory (96 keys) → `docs/runtime-configuration-matrix.md`** including storage location (secret vs config) and fail-closed workstream. Secrets: DATABASE_URL, JWT_SECRET, CREDENTIAL/FIELD_ENCRYPTION_KEY(S), SERVER_AGENT_SHARED_SECRET, CRON_JOB_TOKEN, PAYSTACK/STRIPE/PAYPAL/BLOCKONOMICS secrets/wallets, SMTP password, cPanel/WHM/Plesk credentials, DNS providers, compute (CONTABO/DIGAULOCEAN/SOYOUSTART), registrar tokens, AI keys, session secret, webhook secrets, backup S3, fx feed, number-validator, **log retention/ops knobs**. | env.ts + matrix |
| 2 | dev/staging/prod separation | **Fail-closed production contract**: `COMMIT_001`-style rule — `DATABASE_URL` required always; tests use fixed fake literals; `check-env.ts` CLI for pre-flight. Production migration gate (`CONFIRM_MIGRATION=yes`). PGlite vs pg driver chosen by URL scheme. | env.ts, src/app.ts, check-env.ts |
| 3 | DB credentials least-privilege | Engine talks SQL only through parameterized queries (0 string-interpolated values in audited hotspots); least-privilege role separation is **operational** (`PHASE-12-GATE-CLOSURE-SETUP.md` CT-03) — step captured in deployment checklist, not inventable here. | code review + checklist |
| 4 | Encryption keys & rotation | **Versioned key ring supported** (`CREDENTIAL_ENCRYPTION_KEYS=1:<hex>,2:<hex>`; fallback single-key; field-encryption separate ring documented); rotation procedure delivered by runbook (add version, re-encrypt, remove old). Never log/echo paths enforced by log redaction. | env.ts 102–115, OPERATIONAL-READINESS.md |
| 5 | Session/JWT/MFA | HS256, 15-min expiry, multi-sig ring w/ overlap rotation, strict aud/iss (`cloudhost247`), explicit alg allowlist (alg-confusion refused); MFA TOTP timestep + replay rejection + recovery codes; audit log on every state change. | PHASE-13 adversarial 6/6 |
| 6 | Webhook secrets & signature enforcement | Per-provider signature/timestamp/IP verification; unknown webhook class stored ignored-and-audited; event replay → idempotent no-op. | webhook-hardening.test.ts 9/9 |
| 7 | CORS/CSP/security headers/TLS | helmet on with CSP (SHA-nonce strategy documented for the frontend's current inline bootstrap), CORS allowlist per request, rate-limit baseline. TLS termination policy = platform (operations item captured CT-02/CT-03). | src/plugins/security.ts (line 2–36) |
| 8 | File storage & upload security | Credential store AES-256-GCM with field versions; email outbound queue redact-on-storage; **upload endpoints deliberately minimal** (no unsecured binary pipeline); logs redact secrets/IPs unconditionally. | src/plugins/audit-log.ts, phase9 tests |
| 9 | Backup encryption & retention | `pg_dump -Fc` artifacts with sha256 manifest + restore verification (executed Phase 11); encrypted-store location is operational config (`BACKUP_S3_*` keys declared), retention window chosen at deploy time. | phase11 evidence+json |
| 10 | Logging/monitoring/alerting | Structured logs with unconditional secret/IP redaction; audit triggers on lifecycle tables (bill-wise: who/when/what). Alert wiring is operational (CT-02). | OPERATIONAL-READINESS.md |
| 11 | Rate limits & abuse controls | Baseline global + per-route: login lockout (10 failures → 429), pricing/checkout guarded, coverage-query replay-friendly (no user lockout), idempotent admin retries not penalized (Phase 9). | PHASE-9 report + suites |
| 12 | Deploy & rollback configuration | cPanel Node App Install (Passenger), `check-env.ts` preflight, additive-only migrations, fail-closed doctrine (E.140/E.128 pass), rollback deployment state, no `git checkout` for template restore; `DEPLOYMENT-CHECKLIST.md` operationalizes. | phase16 artifacts |

## Red-team / misconfiguration watch items (honest)

- **Session/admin session secrets** share the JWT ring by default — deploy with distinct values if separate rotation cadence is wanted (documented in install guide; not split in code).
- **CORS allowlist** depends on configured `APP_URL` / admin origins — a staged deploy with a wrong origin is fail-closed (403), not accidental-wide-open (verified by tests).
- Quarantined migrations 0023/0024/0025/0041 still require named owner authorization before any production replay.
- Env-check CLI covers shape only; it cannot certify that a *value* is the correct provider key — that remains operator duty (CT-gates).

## Your catalog extension applied

`MODULE-CERTIFICATION-CATALOG.md` gains a new reference table: **operational owner / failure
dependency / customer impact** — see `docs/module-operations-matrix.md`, wired per module.

## Three named attention areas

- (A) Support attachments — deliverable decision + the uploader guardrails noted in catalog backlog (malware scan + content-type allowlist + antivirus/vault storage + authorization) pending owner go.
- (B) Hosting email quotas — enforcement chain mapped (create→modify→suspend→usage report); quota config lives in engine settings; verification at runtime scheduled under CT-02.
- (C) Wallet top-up — stays fail-closed for live activation; ledger-credit idempotency + webhook dedupe already proven by payment suites; authorization→confirm→credit walk certified once CT-05 lands.

**Bottom line: the codebase is engineered as fail-closed with secret discipline; the remaining material controls are operational (things a runtime owner must execute). Production NO-GO stands; independent review outstanding.**
