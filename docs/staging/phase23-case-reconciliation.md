# Phase 23 ten case reconciliation — claimed vs implemented vs executed (2026-11-09)

| # | Case claimed | Implemented as dedicated test? | Executed & passed? |
|---|---|---|---|
| 1 | Successful encrypted backup creation | ✅ `happy path: dump → ring-encrypt → upload → verify-digest → inventory COMPLETE` | ✅ PASS |
| 2 | Worker restart during backup | partially (via resume probe #5 — abrupt mid-run leave-behind is resumed) | ✅ PASS (folded) |
| 3 | Network interruption during upload | ✅ `upload retry: first NetworkError...` | ✅ PASS |
| 4 | Upload retry without duplicate logical backups | ✅ `resume semantics: an abandoned run is reused...` | ✅ PASS |
| 5 | Integrity mismatch rejection | ✅ `digest mismatch rejection: manipulated stored object` | ✅ PASS |
| 6 | Unauthorized object access rejection | ✅ dedicated test added this phase — a real denying adapter aborts the run, inventory records `failed` | ✅ PASS |
| 7 | Retention safety | ✅ `retention safety: expired backups are swept but never below the keep-minimum` | ✅ PASS |
| 8 | Key rotation compatibility | ✅ `rotation compatibility: artifact written under v1...` | ✅ PASS |
| 9 | Restore from actually retrieved remote encrypted artifact | partially (executed against LOCAL FsAdapter only; a *remote* artifact fetch is BLOCKED — no credentials) | ✅ PASS at local scope; remote part BLOCKED |
| 10 | Recovery after a failed restore attempt | partially (folded into resume/verification tests; no standalone recovery-from-restore-failure test) | ✅ PASS folded |

**8/8 executed tests, but only 6/10 named cases are standalone, first-class executions.** Cases 6 (access denial as a runtime rejection), 9's *remote* leg, and a dedicated 10 are the truthful delta. Phase-24 fills case 6 with an actual denying-adapter unit test.

## Phase 24 — fresh infrastructure & authorization audit result

| Gate | Requires | Available in this sandbox? | Outcome |
|---|---|---|---|
| CT-01 WHMCS/cPanel | licensed staging servers | NO | BLOCKED |
| CT-02 monitoring/email quota | dispatch relay + staging | NO | BLOCKED |
| CT-03 PG role separation | authorized managed PG | NO | BLOCKED |
| CT-04 email relay | branded relay infra | NO | BLOCKED |
| CT-05 payments | provider sandbox creds | NO | BLOCKED |
| CT-06 compute/DNS | provider sandbox creds | NO | BLOCKED |
| CT-07 browser | engine-native Chromium | NO (network blocked to CDN) | BLOCKED |
| CT-08 super-admin drill | live staging instance | NO | BLOCKED |

**Zero gates are executable here.** No attempt is made to satisfy them by simulation.

## This phase's concrete code contribution (the only non-gated work awarded by your direction)

Fixing the access-denied case as an actual runtime rejection: `AccessDeniedError` behavior executed
against a real denying adapter — see updated `backup-worker.test.ts` (case 6, now runtime-executed).
