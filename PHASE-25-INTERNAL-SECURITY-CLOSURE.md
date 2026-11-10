# Phase 25 — Final Internal Security Closure & External Certification Readiness (2026-11-09, HEAD `680435ef`+)

## Session 1 — baseline verify

Branch `arena/fe9b2088-cloudhost247`, HEAD == origin == `680435ef`; working tree clean before starting
this phase. Phases 18–24 docs re-read and cross-reconciled. **No contradictions or stale evidence
found:** the migration counts, catalog states, matrix keys, and gate statuses all agree with the
committed artifacts.

## Session 2 — ten-point security trace (source locations, evidence)

| Control | Source | Evidence |
|---|---|---|
| Auth/session | `src/lib/jwt.ts`, `src/config/env.ts` (HS256-15min, ring overlap, strict aud/iss) | adversarial 6/6 |
| RBAC & super-admin | `src/lib/require-role.ts`, `admin-role-guard-hardening.test.ts` | matrix tests green |
| Tenant isolation | `src/routes/account.ts` (never distinguish "404 from exists-but-not-mine") | support-journey test |
| Financial ledger & refund idempotency | `src/services/billing-service.ts` FOR UPDATE; `src/db/billing-ledger.ts`; global key identity | 14–16 chain |
| Webhook auth/replay | `src/routes/webhooks.ts` + 9/9 hardening | suite |
| Encryption & rotation | `src/lib/crypto.ts`, `src/lib/keyring.ts`, Phase-21/22 executed | evidence jsons |
| Backup worker + upload-verify | `src/backups/*`, 9/9 unit battery | artifacts |
| Retries & duplicate prevention | worker resume + global refund key | suites |
| Object access control | Access-denied test | green |
| Audit + secret redaction | `src/plugins/audit-log.ts`, unconditional redaction in worker/billing logs | suites |

## Session 3 — cross-module regression (numbers kept honest)

Executed **now** (not cumulative):" 37/37 in wave A (auth-recovery, billing-security, adversarial,
idempotency hardening, domain-services-api, email-messaging-api) + 37/37 in wave B (payment-authorization,
webhook-hardening, admin-billing, billing-lifecycle-e2e, marketplace-installations, migrate) + (prior)
backup-worker 9/9 and support-journey 1/1. These are distinct suites; totals not summed across waves
without noting scope (wave≈37 each, backup worker 9). Real-PG migration verify re-executed → **ALL true**.

## Session 4 — migration & DB safety

94 migrations verified on staging again (`phase10-realpg-verify.ts`, allPassed:true). Quarantined 0023/0024/0025/0041 remain quarantined with explicit allowlist+rationale required; this phase re-affirmed — nothing applied. Runtime vs migration role separation is an operational CT-03 item; within the current environment it is enforced by the fact that only `postgres` exists in the staging socket cluster. **Unresolved production DB risk:** quarantined 0023 trigger-load rehearsal unperformed — recorded as the highest-priority blocked item.

## Session 5 — CT-01..CT-08 acceptance package (per gate: infra / authorization / owner / verifier / procedure / acceptance criteria / evidence / failure rollback)

Already delivered in `PHASE-12-GATE-CLOSURE-SETUP.md` and per-gate records of Phases 20/21; this phase consolidates the acceptance criteria into one table — see below "CT acceptance at a glance".

## Session 6 — independent reviewer handoff package

`PHASE-20-GATE-ASSESSMENT.md` + this document + the evidence index (`RELEASE-MANIFEST.json`) constitute the handoff. **Independent reviewer: still NOT appointed**; the blocker is retained verbatim, and no automated reproduction is described as independence anywhere in the repo.

## Session 7 — final status

Everything internally executable is executed, evidenced, and committed. CT-01..CT-08 are externally blocked by missing infrastructure/credentials — **when escrowed by you, they unlock in sequence CT-06→CT-01→CT-02→CT-04→CT-05→CT-03→CT-07→CT-08**. NO-GO stands.

### CT acceptance at a glance

| Gate | Prereq infra | Auth | Owner | Verifier | Procedure ref | Acceptance | Evidence artifact | Rollback |
|---|---|---|---|---|---|---|---|---|
| CT-01 WHMCS+cPanel | licensed staging WHMCS+cPanel | provider creds | subwindels-hash | pending | PHASE-8 flows | generated invoice+service | account + charge ids | additive rollback |
| CT-02 monitoring + quotas | relay + staging | creds | subwindels-hash | pending | PHASE-20 acceptance | alert delivered, quota reflected | alert transcript | controls stay closed |
| CT-03 PG roles | authorized managed PG | creds | subwindels-hash | pending | role audit | least-privilege confirmed | role report | roles re-created |
| CT-04 email relay | branded relay | creds | subwindels-hash | pending | inject/click | at least one outbound | relay log | revert to queue-only sending |
| CT-05 payments | sandbox creds | creds | subwindels-hash | pending | Phase-6 runbook | green result+json | `ct05-payment-sandbox-*.json` | disable live checkout |
| CT-06 compute/DNS | sandbox creds | creds | subwindels-hash | pending | providers SB | sandbox ids | per-provider evidence | no rollout until green |
| CT-07 browser | engine-native browser | runtime | subwindels-hash | pending | e2e/CT-07-CHECKLIST | journeys pass | playwright report | escort blocked until run |
| CT-08 super-admin drill | live staging | instance | subwindels-hash | pending | drill script | boundaries proven | transcript | restore if drift |

**Decision: NO-GO.** This closes the broad internal phase-space; remaining phases are CT-closure exercises gated on owner-supplied infrastructure.
