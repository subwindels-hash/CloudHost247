# CloudHost247 — Production-like PostgreSQL Certification (Phase 6, 2026-11-09)

## Status: STOPPED — infrastructure gate (Phase 6 §7)

| Discipline check | Result |
|---|---|
| Authorized isolated production-shaped PostgreSQL exists? | **no** — no TCP Postgres listening (`localhost:5432` and the documented probe target `:55432` → connection refused, 2026-11-09 sweep); the only database is the embedded PGlite dev instance |
| Owner authorization supplied? | none |
| Credentials? | none (no external `DATABASE_URL`) |

**None of the eight required executions ported to an external database:** financial probes CLI form,
constraint/transaction-isolation suite against production-shaped Postgres, backup+restore on that
topology, connection recovery under real network fault, concurrent settlement at database level,
tenant isolation at external scale, or migration compatibility against the production-shaped server.

## What is certified on the real engine available (executed, embedded PGlite = real Postgres semantics)

| Phase-6 requirement | Executed equivalent | Evidence level |
|---|---|---|
| Financial probes | integration-form financial invariants executed: `payment-authorization-matrix`, `financial-invariant-sweep`, settlement/parity checks live (webhook suites) | L1/L2 (CLI-form against external PG still B-3) |
| Constraints + transaction isolation | serial-style settlement tx, `FOR UPDATE` locking, optimistic CAS (`expectedCurrentStatus`), unique (gateway,event) idempotency — all exercised incl. 6/8-way concurrent bursts | L1/L2 |
| Backup + restoration | byte-level full-DB exercise, 221 tables + schema/constraints/indexes/sequences (COMPLETE-DATABASE-RECOVERY-REPORT.md, live PASS) | L2 — topology-specific (file copy vs pg_dump/PITR) |
| Connection recovery | pool + `/ready` probe semantics; dev-stack restarts tolerated through all phases | L2 (real network-fault drill = open) |
| Concurrent payment settlement | exactly-one-settlement under concurrent delivery — suite-proven | L1/L2 |
| Tenant isolation | cross-tenant read+initiation 404 live (Phase 3 + Phase 4 probes) | L2 |
| Migration compatibility | 92/92 applied; `schema_migrations` checksum-verified through the restore exercise; quarantined migrations 0023/0024/0025/0041 **not executed anywhere** (authorization absent, restriction honored) | L2 |

## Certification procedure when the isolated Postgres is authorized

1. Provision isolated instance (no production data), `DATABASE_URL` via secrets channel, scope logged.
2. `verify:financial` + `verify:authorization` CLI probes → expect identical verdicts to the integration forms.
3. Constraint sweep: FK/UNIQUE/CHECK violations deliberately attempted inside rolled-back txs; isolation-level check under two concurrent settlement txs (`FOR UPDATE` correctness at READ COMMITTED/REPEATABLE READ as configured).
4. `pg_dump` backup → destroy sandbox DB → restore → rerun the Phase 5 fingerprint methodology (byte-level per-table hashes) — plus PITR point-restore drill if WAL archiving enabled.
5. Connection recovery: kill/restart DB mid-traffic on staging; /ready probes fault + recover; no half-settled payments (idempotency holds because settlement is transactional).
6. Concurrency: N parallel sandboxes settle distinct invoices; invariant sweep → ledger/invoice/indemnity consistency; tenant count assertions pre/post.
7. Migration compatibility: fresh DB migrate-up 92; quarantined files remain excluded **unless the owner signs the explicit authorization change**.

## Restriction reaffirmed

No quarantined migration was run, or will be run, without explicit owner authorization — including
inside any recovery/certification drill.
