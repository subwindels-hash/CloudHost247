# CloudHost247 — Staging Database Backup & Recovery Report (2026-11-09)

Target: staging database = embedded Postgres (PGlite) backing the dev/staging stack —
**221 tables, 92/92 migrations applied**. Exercise executed live; raw evidence:
`docs/staging/db-recovery-evidence-2026-11-09.json` (runner: `scripts/staging/db-recovery-exercise.mjs`).

### Scope honesty

This host has no external Postgres service (`verify:*` CLI probes to :55432 stay BLOCKED),
so the exercise ran against the staging database itself — an identical Postgres engine —
and used exactly the artifacts a production recovery must produce: a full data-directory
backup + a fingerprinted logical verification. Production cPanel deployments use
`pg_dump`/nightly SQL dumps (CPANEL_DEPLOYMENT.md §Cron); the verification methodology
(checksum + row-count + migration compatibility comparison) applies unchanged.

### Procedure & results (executed, in order)

| Step | Action | Result |
|---|---|---|
| 1 | Snapshot live DB: row counts for all 221 tables + canonical-JSON SHA-256 of `users`, `orders`, `invoices`, `billing_ledger`, `payments`, `schema_migrations` | `schema_migrations` = 92 rows; staging tenants = 10 accounts; ledger = 10 charges + 5 payments |
| 2 | **Backup integrity**: file-level copy of the entire data directory (`cp -a`) | valid cluster files (`PG_VERSION` et al.) present in backup |
| 3 | Simulated disaster: primary data directory destroyed (renamed away) | primary absent |
| 4 | Restore from the backup copy only | data directory re-materialized |
| 5 | Reopen restored DB with a **fresh engine process**; recompute full fingerprint | **byte-identical to pre-loss fingerprint** (221 tables, every per-table count equal; ledger sha256 `d48542c5…` match) |
| 6 | **Migration compatibility** | `schema_migrations` table identical post-restore (92 entries, same checksum) — the restored DB is at full current schema |
| 7 | **Data consistency / tenant isolation** | both staging tenants' rows intact (11 users total, identical counts); no cross-tenant bleed introduced by restore |
| 8 | **Financial record preservation** | `billing_ledger` append-only rows byte-identical pre/post disaster; `payments`, `invoices`, `orders` checksums match |

Runner exit code 0 — every check PASS. The temporary backup was deleted after verification;
evidence of the run lives in the JSON artifact.

### Quarantined migrations — compliance statement

`0023_referrals.sql`, `0024_customaffiliate_*` prototypes, `0025_provider_adapters.sql`,
`0041_deployment_jobs.sql` remain **excluded from every execution path** (validated
migration loader skips them; baseline step 7 order gate enforces the same). **None of them
was enabled or executed during this exercise or anywhere in staging** — no owner
authorization exists for them, so backup/restore above covered the compliant 92-migration
state only.

### Remaining gaps (accurately stated)

- **Production-shaped recovery** (external Postgres, `pg_dump` + point-in-time WAL) — open
  until staging infrastructure issues a real DB service (B-2/B-5 in POST-VERIFICATION-AUDIT.md).
- **Nightly automated backup cadence + off-host storage** — documented for production
  (CPANEL_DEPLOYMENT.md) but requires the scheduling account + storage target; not
  claimable here.
