# CloudHost247 — Database Recovery Audit (Phase 4 independent, 2026-11-09)

Audited artifacts: `scripts/staging/db-recovery-exercise.mjs`,
`docs/staging/db-recovery-evidence-2026-11-09.json`, `DATABASE-RECOVERY-REPORT.md`.
Method: line-level review of the runner + fresh reading of the evidence JSON.

## 1. What the exercise actually proves (verified)

| Property | Verified mechanism | Audit verdict |
|---|---|---|
| Backup completeness | `cp -a` of the **entire** embedded-Postgres data directory after clean app shutdown; validity gate checks `PG_VERSION` in the copy | SOUND for file-level backup of an at-rest single-process database |
| Restore completeness | Original directory removed from service path (simulated storage loss), restored from the backup **copy only**, then reopened | SOUND |
| Fresh-engine restoration | `PGlite.create()` in a NEW process instance against the restored dir — caches/registers of the old engine cannot leak into verification | SOUND |
| Fingerprint methodology | (a) full **table census + row count for all 221 tables** from `information_schema`; (b) canonical-JSON SHA-256 (sorted keys, ordered by PK column) for `users, orders, invoices, billing_ledger, payments, schema_migrations` | SOUND with one scope limit (D4-F1 below) |
| Financial table coverage | `billing_ledger`, `payments`, `invoices`, `orders` checksummed byte-for-byte plus `users` (tenancy) | SOUND |
| Migration bookkeeping integrity | `schema_migrations` both counted (92) **and content-checksummed** — a restore that silently dropped/altered applied-migration rows would fail | SOUND |
| Tenant preservation | user counts identical (11→11 at run time); evidence notes staging tenant count | SOUND (count-level) |
| Cannot-PASS-if-omitted analysis | whole-table omission: caught by census diff; row add/remove: caught by counts; content corruption: **caught only for the 6 checksummed tables** → see D4-F1 | PARTIAL — see finding |

## 2. Findings

- **D4-F1 (evidence-scope):** rows in the 215 non-checksummed tables are verified by COUNT only.
  Byte-level content corruption there (e.g., a mid-row byte flip that keeps count) would pass
  unnoticed by this exercise. The financial/identity spine is fully checksummed, so the claim
  "financial record preservation" is fully substantiated; the claim "all 221 tables identical"
  is count-level for 215 of them. **Recommendation:** extend the SHA-256 canonical dump to every
  table (cheap at staging scale) so the all-tables claim becomes byte-level.
- **D4-F2 (method, informational):** disaster simulation is a rename (availability loss), not a
  bit-rot simulation. Combined with D4-F1, partial-corruption recovery remains unproven beyond
  the spine tables.
- **D4-F3 (scope, by design):** PGlite embedded = single-host file backup. Production topology
  (standalone Postgres, `pg_dump`, WAL PITR, off-host copies) belongs to infrastructure item
  B-3/provider staging and the production ops runbook; methodology here (fingerprint before/after
  fresh-engine) ports unchanged and is what the production drill should still assert.
- **D4-F4 (hygiene):** temporary backup dir deleted post-run (verified: /tmp cleaned) — no stale
  credential/data copies linger outside the repo. Evidence JSON retained in-repo.

## 3. Compliance statements re-verified

- Quarantined migrations `0023/0024/0025/0041` were **not executed**; migration bookkeeping at
  restore matched the 92-migration compliant state exactly (checksum). No unauthorized-migration
  restriction was touched.
- No real customer data involved; staging accounts are synthetic `staging-*/p4audit-*` fixtures.
- No schema was altered anywhere in the exercise.

## 4. Verdict

The Phase-3 recovery exercise is **reproducible and its PASS criteria are not exploitable by
omission**: a missing table or a changed row count anywhere, or any content drift in the
financial/identity/migration tables, fails the run. The one genuinely unproven dimension is
byte-level integrity of the 215 non-spine tables (D4-F1) — disclosed here and carried into
FINAL-PRODUCTION-BLOCKERS.md as a pre-production drill refinement alongside the
production-topology recovery run (B-3).
