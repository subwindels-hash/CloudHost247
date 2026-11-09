# P1 Gate Closure Tracker — Phase 12 (owner-accountable, verifier-signed)

Created 2026-11-09 against verified HEAD `6e334eec` (== origin/arena/fe9b2088-cloudhost247, tree clean).

## Accountability model (supplied by the owner on 2026-11-09 — not invented)

- **Named accountable owner for all eight gates:** `subwindels-hash` (account owner, GitHub identity).
  The owner confirmed this assignment via the Phase-12 gate-ownership dialogue. A legal-name column is
  intentionally left blank until the owner supplies a legal name in secure configuration.
- **Independent verifier of every closure:** `subwindels-hash` (account owner).
- **⚠ Honest governance note:** owner and verifier are the same person. That is a real
  independence limitation — closures signed by the same person who provisioned the dependency carry a
  single-person risk. If a second accountable party ever exists, reassign verifier to them.
- **Standing recommendation recorded (Phase 13 acceptance note):** appoint a second independent
  reviewer for the final CLOSED-PASS signatures on CT-01..CT-08. Until that reviewer exists, every
  closure record must carry the marker `INDEPENDENT-SECONDARY-REVIEW: NOT-APPOINTED` so the absence
  is explicit rather than presumed.

## Acceptance rule for EVERY closure task (binding)

A gate moves to **CLOSED-PASS** only when ALL of the following exist in the repo:
1. **Execution record** — a dated run transcript (log/JSON) showing the runbook actually executed.
2. **Evidence artifact(s)** — committed under `docs/staging/` (or the provider's own sandbox IDs,
   redacted) referenced by absolute path.
3. **Verifier signature** — a named verifier line in the closure record with PASS/REJECT.
   Credentials supplied, configuration screens, or prepared tests never satisfy this rule.

## Closure tasks

| ID | Gate | Owner | Verifier | State | Runbook (execute verbatim) | Evidence artifact to produce |
|---|---|---|---|---|---|---|
| CT-01 | P1-1 WHMCS license | subwindels-hash | subwindels-hash | **MISSING** | `WHMCS-CPANEL-CERTIFICATION.md` §WHMCS | `docs/staging/ct01-whmcs-licensing-<date>.json` + activity-log export |
| CT-02 | P1-2 cPanel/WHM account | subwindels-hash | subwindels-hash | **MISSING** | `WHMCS-CPANEL-CERTIFICATION.md` §cPanel (full lifecycle on real account) | `docs/staging/ct02-cpanel-lifecycle-<date>.json` (redacted txn IDs) |
| CT-03 | P1-3 managed PostgreSQL | subwindels-hash | subwindels-hash | **PARTIAL** (local real-PG 16.2 evidenced 2026-11-09: 92 migrations, 221 tables, 6/6 probes, restore identical) | `POSTGRESQL-CERTIFICATION.md` on the authorized managed instance | `docs/staging/ct03-managed-pg-<date>.json` |
| CT-04 | P1-4 email relay | subwindels-hash | subwindels-hash | **MISSING** | `EMAIL-DELIVERY-CERTIFICATION.md` | `docs/staging/ct04-email-relay-<date>.json` |
| CT-05 | P1-5 payment sandbox credentials | subwindels-hash | subwindels-hash | **MISSING** | `PAYMENT-PROVIDER-CERTIFICATION.md` | `docs/staging/ct05-payment-sandbox-<date>.json` |
| CT-06 | P1-6 compute/registrar/DNS credentials | subwindels-hash | subwindels-hash | **MISSING** | `PROVIDER-INTEGRATION-CERTIFICATION.md` | `docs/staging/ct06-provider-cert-<date>.json` |
| CT-07 | P1-7 browser runtime | subwindels-hash | subwindels-hash | **MISSING** | `BROWSER-CERTIFICATION-REPORT.md` prep + `cloudhost247-node/e2e/auth-ceremonies.spec.ts` with `CH247_E2E_FULLSTACK=1` | `docs/staging/ct07-browser-ceremony-<date>.json` + Playwright report |
| CT-08 | P1-8 super-admin bootstrap drill | subwindels-hash | subwindels-hash | **MISSING** | secure-config walkthrough + audit-row verification + rights-rollback drill | `docs/staging/ct08-superadmin-drill-<date>.json` + audit rows |

## Provisioning-evidence log (append one row per supply event — never write credentials here)

| Date (UTC) | Gate | What became available | Receipt pointer (secure store location, NOT the secret) | Logged by |
|---|---|---|---|---|
| — | — | nothing supplied yet | — | — |

## Weekly closure cadence

Each week (or when evidence arrives), produce `P1-GATE-CLOSURE-REPORT-<YYYYMMDD>.md` summarizing:
per-task state diffs, new evidence artifacts, verifier decisions, and the remaining NO-GO rationale.
Production remains **NO-GO until CT-01..CT-08 are all CLOSED-PASS with verifier signatures.**
