# CloudHost247 — Operational Readiness Report (Phase 5, 2026-11-09)

Every row states **where** the capability is implemented and how it was verified this session —
or explicitly what is missing. No secrets appear in any log or report (redaction is itself
verified below).

| Area | Implementation | Verification this session | Status |
|---|---|---|---|
| Structured logging | Pino with request IDs, ISO timestamps, response times (`src/lib/logger.ts`) | observed live in streaming API logs during all phases | VERIFIED |
| **Log redaction** | `logger.ts` `redact.paths`: authorization headers, cookies, passwords, tokens, secrets, DATABASE_URL, SMTP passwords, client IPs (GDPR-sourced PII list) | grep-verified path list; live logs show `remoteAddress: [redacted]` | VERIFIED |
| Error monitoring | Central Fastify error handler maps domain errors to sanitized codes (401/403/404/409/400/500, no stack exposure); unexpected errors → `INTERNAL_ERROR` generic | observed live (500 hygiene during audit probes: message generic, no internals) | VERIFIED-in-code. **GAP:** no external sink (Sentry-class) configured — ops integration, owner decision |
| Backup scheduling | Cron-driven: `* * * * * npm run worker:once` + platform data per CPANEL_DEPLOYMENT; customer-server backups via server-agent archives + off-server S3-compatible upload (`BACKUP_S3_*` env, routes exist) | code + docs verified; schedule activation needs the hosting account's cron | DOCUMENTED, activation open (infra) |
| Restore procedures | Full-DB exercise re-executed at byte level this phase (COMPLETE-DATABASE-RECOVERY-REPORT.md, 10/10 incl. schema/constraints/indexes/sequences fingerprints) | live PASS | VERIFIED (staging substitute); production-topology drill open (B-3) |
| Queue processing | Durable Postgres queues; worker `--once` claim-lease with per-job backoff (`src/worker/*`, cron-driven) — no Redis dependency | worker present + lease semantics reviewed; suites: provisioning lifecycle worker install | VERIFIED-in-code + suites |
| Worker restart recovery | `recoverOrphanedJobs(ctx)` sweeps expired leases and requeues interrupted work each worker run — a worker killed mid-job loses nothing durable | code-read (`src/worker/main.ts:147` + handlers) | VERIFIED-in-code; live kill/restart drill is part of the B-3/cPanel run |
| Database connection recovery | `/ready` probes with 3 s timeout (`isDatabaseReachable`); pg pool reconnects transients inherently; startup fails loud when DB is absent (env + migrate gate) | `/ready` live-probed 200 through restarts this phase (recovery exercise stopping/starting the stack) | VERIFIED (connection-recovery under fault = ops drill, open) |
| Security incident logging | `auth_audit_log` durable event stream: logout, password changes, webhook settlements (`webhook_payment_succeeded`), refunds (`admin_invoice_refunded`), support sessions; wallet/security actions similarly journaled | rows produced by every probe run (register/login/MFA/logout audited) | VERIFIED |
| Secret rotation | Versioned credential key ring: `CREDENTIAL_ENCRYPTION_KEYS=1:<hex>,2:<hex>` with active-version selection; rotation = append new version, re-encrypt lazily, retire old | env schema + lib reviewed; plaintext legacy decrypt untouched by design | VERIFIED-in-code (procedure documented in CPANEL_DEPLOYMENT Appendix D + env.example) |
| Deployment rollback | **NEW this phase:** CPANEL_DEPLOYMENT.md Appendix D — code swap + Passenger restart, migration forward-only policy + checksum-guarded history, config rollback rules, rollback audit-journaling | doc authored against actual deploy mechanics; not executable in sandbox | DOCUMENTED, staging rehearsal open (cPanel account) |

## Deliberate non-claims

- No APM/uptime monitoring integrated (owner tooling decision).
- No production WAF/edge limits (OPS-1 requirement recorded in FINAL-PRODUCTION-BLOCKERS.md).
- No on-call/incident-policy document exists in-repo (owner org decision).
- Backup **cadence** (RPO/RTO targets) is documented but unenforceable until the hosting account
  schedules the cron entries.
