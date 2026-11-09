# CloudHost247 — Staging Certification Report (2026-11-09)

Branch: `arena/fe9b2088-cloudhost247` · HEAD at execution: `c578ff2f`
Environment: **controlled local staging substitute** — the unmodified application stack
(`npm run dev:stack`): Fastify API on :3000 + Vite SPA on :5173, **real embedded Postgres
(PGlite, 92/92 migrations applied)**, credential encryption enabled, deployment simulation
mode on, sandbox payment gateway configured with an environment-only secret. No external
provider or payment network was contacted. **This is not a cPanel/WHMCS staging run** —
that gate remains open and is explicitly listed under §4.

Executable runner: `scripts/staging/smoke-staging.mjs`
Raw evidence: `docs/staging/staging-evidence-2026-11-09.json` (JSON, per-step status/timestamps)

---

## 1. Staging readiness — required architecture (from `docs/CPANEL_DEPLOYMENT.md`, env schema, and repo inspection)

| Requirement | Value | Evidence |
|---|---|---|
| Web/app runtime | **Node.js ≥ 20.9.0** (Fastify v5 drops Node 18) | `cloudhost247-node/package.json` engines |
| PHP stack (legacy/WHMCS side) | PHP **7.4–8.2** both lint legs green; ionCube-encoded vendor modules require the ionCube loader | `scripts/php-lint-targets.sh` (842 targets), php-wasm 7.4/8.2 sweeps |
| Database | PostgreSQL 12+ via single `DATABASE_URL` string; cPanel-hosted or external managed; SSL configurable | `src/config/env.ts`, `.env.example` |
| Redis | **None** — durable work queues are Postgres-backed; cron drives `npm run worker:once` | no Redis dependency in env schema/package.json; worker leases in migrations |
| WHMCS | Licensed WHMCS install for billing gateway/provisioning side; Node platform runs independently with `WHMCS_MODE=read-only` default | README, CPANEL_DEPLOYMENT.md |
| Environment variables | `JWT_SECRET` (min 32), `CREDENTIAL_ENCRYPTION_KEY` (hex64), `SECURITY_PIN_HMAC_KEY`, `DATABASE_URL`, optional provider/webhook sets; no secret has a hardcoded fallback | `src/config/env.ts` (fail-loud startup) |
| Storage/backups | Customer-server backups via server-agent archives; off-server S3-compatible upload (`BACKUP_S3_*`); platform DB per §recovery report | `src/routes` backup endpoints, `.env.example` |
| Domain/SSL/proxy | Apache reverse proxy → Passenger; HTTPS at edge; SPA fallback via built static `public/`; no `PORT` on cPanel (Passenger injects) | CPANEL_DEPLOYMENT.md §0–§6 |
| Cron | `* * * * * node dist/src/worker/main.js --once` + WHMCS-side `crons/` scripts | QUICK_START.txt, `crons/` |

**Not certified by this document:** real cPanel/Passenger deployment (Appendix C's 18 items in
CPANEL_DEPLOYMENT.md remain unchecked), because no cPanel account exists in this environment.

## 2. Live workflow verification — 33/33 PASS

All steps executed over HTTP against the running staging stack (JWT auth, real DB, real
crypto; only the payment *provider* is the built-in sandbox). Evidence: raw JSON artifact +
console transcript (33 passed / 0 failed), reproducible via the runner command above.

| Workflow | Evidence (live HTTP) |
|---|---|
| Registration | 201; duplicate email → 409 |
| Login | wrong password → 401; correct → 200 + signed JWT |
| Email verification / password recovery | uniform 202 anti-enumeration (known vs unknown email byte-identical); mails queue honestly without a configured relay (CONFIGURATION_REQUIRED design) |
| **MFA/TOTP** | full real ceremony: password-confirmed enroll → otpauth URL → confirm with real RFC-6238 code → status `enabled:true` → fresh login returns **202 + mfaToken, no session** → verify with next-window code → session issued. Server's single-use `last_used_timestep` replay defense observed and respected |
| Passkeys | register/options issues challenge (password-confirmed); attestation half needs a browser authenticator → B-1 |
| Customer dashboard | profile PATCH 200; services/domains/tickets lists 200 |
| Support tickets | create 201 → reply 201 (real rows) |
| Catalog browsing | anonymous 200; seeded dev product plans resolve with server-side prices; absent products return honest 404 (no fabricated pricing) |
| Purchase workflow | cart add (server-priced, 201) → checkout **201: order + unpaid invoice atomically** → invoice list shows `unpaid` |
| VPS/dedicated & domain workflows | data-driven: honest empty states without providers/registrars (extensions endpoint 200 with 0 rows) — by design, certified against provider hookup in B-4 |
| Admin boundaries | customer token → admin route **403**; anonymous → **401**; app-catalog admin CRUD separately covered by integration suites |
| Rate limiting | login 10/min: **11th attempt → 429** (in-memory bucket per app instance — multi-instance deployments get per-instance limits; document an edge-level limit for fleet-wide ceilings) |
| API authentication | unsigned/forged tokens rejected (401) across suites; live: admin probe anonymous 401 |
| Analytics consent & tracking | live: `/api/v1/marketing/bootstrap` → 200 with `enabled:false` + `diagnostic:"missing_configuration"`; consent save/event ingest **without bootstrap-bound context → 403** (fail-closed, CSRF-safe). Providers activate only under operator config AND visitor consent (marketing-consent-api suite) |
| Mobile/desktop responsiveness | static a11y contract + rendered-site audit pass; **visual** responsiveness unverifiable without a browser → B-1 |

## 3. Notification/email delivery honesty

Registration/reset mails are **durably queued**, never claimed sent; with no
`NOTIFICATION_EMAIL_WEBHOOK_*` configured the platform reports configuration required
instead of pretending delivery (verified live via uniform 202 regardless of destination
existence, and by the services' design + tests).

## 4. Explicitly NOT certified here (staging dependencies)

| Item | Why | Plan |
|---|---|---|
| cPanel/Passenger real run | no cPanel account in sandbox | CPANEL_DEPLOYMENT.md Appendix C (18 items) on a real account |
| WHMCS client-area flows (cart hand-off, SSO, callback) | licensed WHMCS absent | B-2 staging |
| Real browser verification (WebAuthn attestation, visual responsive, e2e links) | no browser binary, CDN blocked | B-1 |
| Real email delivery | relay not configured | owner-provided webhook relay |
| Live providers/registrars/payments | credentials/authorization absent | B-4 sandbox certification |

**Verdict:** the application works end-to-end as an integrated system on the controlled
staging substitute — 33/33 workflows pass live. Production staging certification continues
with the real-cPanel and licensed-WHMCS runs above.
