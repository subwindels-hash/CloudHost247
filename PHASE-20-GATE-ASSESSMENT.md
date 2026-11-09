# Phase 20 — Independent Security Review, Evidence Reconciliation & Release Gate Assessment (2026-11-09, HEAD `5ee7ab68`+)

## Independence statement (unchanged, honest)

No independent human reviewer exists in this environment. I am the implementing agent; this phase
therefore executes the mechanical reconciliations and reproductions rigorously, reproduces the
critical claims byte-for-byte where possible, and leaves the named-reviewer finding slot open.
`INDEPENDENT-SECONDARY-REVIEW: NOT-APPOINTED` remains in force.

## 1. Reproduction of selected critical tests (re-executed now, fresh evidence)

| Claim | Re-run | Result |
|---|---|---|
| Real-PG migration verify | `npx tsx scripts/phase10-realpg-verify.ts` | `allPassed: true` (94 migrations installed, checksums verified) |
| Financial 8-scenario battery | `npx tsx scripts/phase14-financial-concurrency.ts` | **8/8 PASS** — results file refreshed `16:40Z` |
| Phase-13 adversarial suite | vitest | 6/6 |
| Phase-16 idempotency hardening | vitest | 4/4 |

## 2. Reconciliation of all 96 configuration keys (mechanical, code-traced)

Each key now carries: first consumer (source file), default behavior, validation, and production
requirement: **`docs/runtime-config-reconciliation.md`** (96 rows). Key findings:
- Two hard requirements (`DATABASE_URL`, `JWT_SECRET`) are crash-loop guarded at startup.
- Every provider key is "mandatory for its feature; absent ⇒ that feature fails closed" — there is
  no silent-misconfig surface; `check-env.ts` extends this to IP-mode semantics.
- SESSION_SECRET dev-default exists but is **fatal in production** per env.ts enforcement comments
  (kept to be exact: the rule is enforced at boot, not only documented).

## 3. Backup claims — separated, per your correction

| Property | Claim type | Evidence |
|---|---|---|
| Integrity (SHA-256 + manifest) | Verified | Phase 11 artifacts |
| Restore round-trip (pg_restore into fresh target, table+checksum equality) | Verified | Phase 11 evidence json |
| **Encryption at rest** | **NOT VERIFIED** — `BACKUP_S3_*` keys exist; bucket-side encryption is operational config; no here-run proof | matrix + this report — open until executed |
| **Retention & access control** | **NOT VERIFIED** — retention windows + IAM are operator-set | open until executed |

## 4. Quarantined migrations — explicit owner-decision records (no execution performed)

The four quarantined migrations individually:

| Migration | Content | Risk if executed unreviewed | Decision required from owner (`subwindels-hash`) |
|---|---|---|---|
| 0023_enforce_billing_invariants.sql | B1–B5 triggers (payments↔invoices currency/user/amount; ledger↔invoice; invoice↔order total decomposition) | Backfill conflicts on legacy rows; trigger surprises on writes | AUTHORIZE via `AUTHORIZED_MIGRATIONS=0023` after staging rehearsal, or keep quarantined |
| 0024_create_webhook_events.sql | durable webhook event ledger (idempotency/leases/replay) | Table creation, plus later consumers assume lease columns present | authorize after confirming Phase-5D suite in a seeded environment |
| 0025_extend_auth_audit_log_for_admin_billing.sql | broaden orders.payment_status to varchar(20) + widen auth_audit_log event-type CHECK | DDL lock on hot tables | authorize after confirming drain of long transactions |
| 0041_create_os_catalog_and_server_provisioning.sql | infrastructure_providers/OS catalog/provisioning_jobs domain | Creates tables later ones depend on; everything after ordered run depends on it (note in migrate.ts:147) | authorize only with the exact named reason recorded (mechanism requires the reason string) |

**No default applied. Execution stays gated on an explicit per-run allowlist with a recorded reason.**

## 5. Decision record — support attachments (deferred to owner; NOT implemented)

Options: (a) text-only is the product design (recorded bound); (b) build attachment support with type
allowlist + size cap + malware scan + authorization + vault-encrypted storage. Status: **deferred to
owner**; no partial uploader was added.

## 6. Assigned follow-ups (per your mapping)

Email quota verification → CT-02. Wallet top-up federal walk → CT-05.

## 7. Final release-gate classification (PASS/FAIL/BLOCKED/NOT-TESTED)

| Gate | Class | Why |
|---|---|---|
| Source-level engineering quality | PASS | 170/170 + 8/8, fail-closed doctrine enforced in code |
| Financial internal integrity | PASS (internal) | Phase 14–16 chain |
| Operational DB role separation | BLOCKED (CT-03) | requires authorized managed PG |
| Key rotation execution | NOT-TESTED | rings exist; live rotation unexecuted |
| Backup encryption/retention | NOT-TESTED | corrected split above |
| Monitoring/alert delivery | NOT-TESTED | CT-02 |
| Provider webhooks/payments | BLOCKED (CT-05) | sandbox creds |
| CT-01 WHMCS/cPanel | BLOCKED | secondary server acquisition |
| CT-06 compute/DNS | BLOCKED | sandbox creds |
| CT-07 browser runtime | BLOCKED | no engine-native browser available |
| CT-08 super-admin drill | BLOCKED | live instance required |
| Independent human review | BLOCKED | no second reviewer appointed in environment |

**Release decision: NO-GO — unchanged. 3 PASS-class workstreams are internal-facing; every
external-runtime gate remains BLOCKED or NOT-TESTED with named owner assignment.**
