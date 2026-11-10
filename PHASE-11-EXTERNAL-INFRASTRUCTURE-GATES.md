# Phase 11 — External Infrastructure Provisioning & Live Staging Certification (2026-11-09, interim)

Approach per direction: close P1 gates individually **with evidence**, no broad code-rewriting, no
credentials in Git or reports, no live charges / production activation / deployment without approval.

## Documents read first (as directed)

- `PHASE-10-FINAL-READINESS-AND-GATE-CLOSURE.md` — decisions & matrix absorbed.
- `docs/staging/phase10-realpg-evidence-2026-11-09.json` — 92/92 migrations, 6/6 probes confirmed present and intact.

## NEW evidence produced this phase (all local, throwaway, no external destinations)

| Evidence | Result | Artifact |
|---|---|---|
| Real backup-restore demonstration (Phase-10 concern #5) on genuine PostgreSQL 16.2 | **pg_dump -Fc (820,858 bytes) → pg_restore into a fresh database `p10_restored` → 221/221 tables; schema_migrations content identical (md5 over version+name+checksum); table set identical; CHECK constraints fire on restored rows (bogus SSL status → 23514)** | this report + transcript below |
| API booted against **real PostgreSQL** (not PGlite) — tenant isolation smoke (Phase-10 concern #3) | **5/5 PASS**: health 200; cross-tenant cert unreadable (list filtered, by-id 404); anonymous 401; real-PG write path verified | `docs/staging/phase11-api-realpg-smoke-2026-11-09.json` (+ script `scripts/phase11-api-on-realpg-smoke.ts`) |

Restore transcript (abridged):
```
pg_dump -Fc -f /tmp/p10-backup.dump -d postgres            → 820,858 bytes
createdb p10_restored; pg_restore -d p10_restored ...     → completed
restored tables: 221 (== source)
migrations-checksum-equal:YES  table-set-equal:YES  applied:92
bogus INSERT on restored DB → ERROR ... violates check constraint "ssl_certificates_status_check"
```

## Gate closure status (each P1, individually)

| Gate | State after Phase 11 |
|---|---|
| P1-3 production-like PG | **Substantially advanced**: real-PG migration+constraints+concurrency+restore now evidenced (but on an embedded binary — must be re-executed on the authorized managed service) |
| P1-1, P1-2, P1-4..P1-8 | **MISSING**, unchanged; owner + procedure + required evidence now defined per gate in `P1-INFRASTRUCTURE-INVENTORY.md` |

## Rule compliance

- No external credential exists in this environment; none was requested, minted, committed, or printed.
- Local scripts use throwaway dummy secrets (`'f'.repeat(32)` etc.) inside test-only harnesses.
- Every new artifact is integration/staging-local; none is passed off as live-provider certification.

## Honest delta remaining

Live staging certification still requires the owner provision of P1-1..P1-8 per the inventory table.
The codebase is ready to execute those runbooks unchanged; Phase-11 restored-DB and real-PG-API
evidence is two gates closer (P1-3 shape, recovery concern #5, isolation concern #3) but **not a
substitute for the authorized external services**.
