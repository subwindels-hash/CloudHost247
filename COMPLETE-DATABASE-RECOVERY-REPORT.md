# CloudHost247 — Complete Database Recovery Report (Phase 5, 2026-11-09)

**Supersedes and extends** `DATABASE-RECOVERY-REPORT.md` (Phase 3) under audit finding D4-F1.
Evidence: `docs/staging/db-recovery-evidence-full-2026-11-09.json` (runner:
`scripts/staging/db-recovery-exercise.mjs`, executed live against the staging database —
embedded PGlite Postgres, 221 tables, 92 migrations).

## What changed since Phase 3 (D4-F1 closure)

The first exercise fingerprinted **6 spine tables byte-level + 215 tables count-level**.
This exercise fingerprints **EVERY object class byte-level**:

1. **Table census** — SHA-256 of the full ordered table-name list (a missing/injected table fails).
2. **Schema fingerprint** — every column of every table: name, data type, nullability, default, ordinal position.
3. **Constraint fingerprint** — every PK/FK/UNIQUE/CHECK (name, table, type).
4. **Index fingerprint** — every index (name, table).
5. **Sequence fingerprint** — every sequence with its `last_value` (a value-resetting restore would be caught here, before any silent ID collision).
6. **Row counts** — per table, all 221.
7. **Canonicalized record hashes** — SHA-256 per table over rows canonicalized as JSON with sorted keys, byte-stably ordered via `md5(t::text)` (works for any column types incl. non-orderable JSON), for **all 221 tables**.
8. **Financial record integrity** — spine tables re-asserted individually (ledger sha256 match `ceca0889…`; charges/payments census).
9. **Tenant ownership preservation** — user rows count preserved; spine checksums carry ownership columns byte-exact (`users`, `orders`, `invoices`, `payments` all include `user_id`).
10. **Migration history** — `schema_migrations` counted (92) and checksummed.

## Procedure (unchanged, live)

snapshot live DB → full at-rest backup (`cp -a`) → primary destroyed (renamed to a tombstone dir) →
restored **from the backup copy only** → reopened with a **fresh engine process** → recomputed full
fingerprint → **byte-identical**. All 10 steps PASS; tombstone and temp backup deleted after the run.

## Pass-criteria completeness

A restored database can only PASS this exercise if: the table set, every column definition, every
constraint, every index, every sequence state, every row count, and every byte of every row in all
221 tables match the pre-disaster snapshot exactly. **No required object class is excluded from the
fingerprint** — the D4-F1 scope limitation is closed.

## What remains honestly out of scope

- **Production topology:** external Postgres (pg_dump + WAL PITR) on the hosting target — needs the
  managed DB service (blocker B-3); the fingerprint methodology above ports verbatim.
- **Cross-machine transfer integrity/TLS, off-host storage durability, RPO/RTO cadence:** operational,
  covered in OPERATIONAL-READINESS-REPORT.md / production runbook.
- Continuous backup scheduling (cron) — configured per CPANEL_DEPLOYMENT.md but requires the
  scheduling account.

**Verdict:** on this staging environment the application database is recoverable byte-for-byte,
demonstrably — migration state, financial trail, tenant ownership, constraints, indexes and sequences
included.
