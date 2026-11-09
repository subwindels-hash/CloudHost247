# CloudHost247 — Final Production Blockers (Phase 7 revision, 2026-11-09)

**Authoritative blocker register.** Severity: **P0** critical security/financial/data-integrity ·
**P1** essential infrastructure/external dependency · **P2** important operational/reliability ·
**P3** non-blocking improvement. Each entry: evidence, responsible owner, closure condition.
Supersedes the B-x/Gate listings of earlier phases (they remain the audit history).

## P0 — critical

**None.** Financial invariants, auth, tenancy, and data integrity carry executed adversarial
evidence (suites 2,916/2,916; staging 33/33; probes 23/23; Phase 4–5 audits). No P0 has ever
been downgraded into existence — earlier defects (F-1..F-3, Phase-5 FK-ordering fix) closed with
evidence.

## P1 — essential infrastructure & external-service dependencies

| ID | Blocker | Evidence (verification it is required/absent) | Owner | Closure condition |
|---|---|---|---|---|
| P1-1 | Licensed WHMCS staging install | Phase-6 sweep: no license/host; bridge certified code-only (18 PHP suites) | owner | Licensed staging online; WHMCS-CPANEL-CERTIFICATION procedure executed green |
| P1-2 | cPanel staging account | Appendix C (18 items) unchecked; account absent (sweep) | infra+owner | Appendix C all ✅ on real account incl. Appendix D rollback rehearsal |
| P1-3 | External production-shaped PostgreSQL | 5432/55432 connection refused (2026-11-09) | infra | `verify:financial`/`verify:authorization` CLI probes + pg_dump/PITR drill green |
| P1-4 | Email relay (SMTP/webhook) | no `NOTIFICATION_EMAIL_WEBHOOK_*`/SMTP values (sweep) | owner+vendor | EMAIL-DELIVERY-CERTIFICATION procedure executed (deliver/TLS/bounce/retry/limits/queue-recovery) |
| P1-5 | Payment provider test credentials (Stripe/PayPal/Paystack/Blockonomics) | zero test keys; endpoints unreachable (sweep) | owner | PAYMENT-PROVIDER-CERTIFICATION 10-cell matrix executed per provider (test funds only) |
| P1-6 | Compute/registrar/DNS sandbox credentials (12 adapters + registrar + CF) | zero tokens; egress unreachable (sweep) | owner+vendor | PROVIDER-INTEGRATION-CERTIFICATION per-provider procedure executed |
| P1-7 | Browser runtime for ceremonies | no binaries; CDN 000 (sweep) | infra | BROWSER-CERTIFICATION-REPORT procedure executed green (e2e/auth-ceremonies.spec.ts) |
| P1-8 | Initial super_admin on authorized staging | boundary intentionally unbypassed (Phase 4) | owner | Owner designates first super_admin; OPS-3 drill incl. live refund execution (OPS-2) |

## P2 — operational & reliability

| ID | Item | Evidence/status | Owner | Closure |
|---|---|---|---|---|
| P2-1 | Quarantined migrations 0023/0024/0025/0041 | never executed; loader-enforced exclusion | owner | Explicit written authorization + staging rehearsal each file |
| P2-2 | Error-monitoring sink (Sentry-class) | none configured; sanitized local errors verified | owner decision | sink integrated; alert thresholds documented |
| P2-3 | Edge/fleet-wide rate limiting | in-code limits verified per-instance (429s live) | ops | WAF/edge config + load test of 429 behavior across instances |
| P2-4 | Backup cadence + off-host storage (RPO/RTO) | method proven; schedule needs hosting cron + S3 target | infra | scheduled backups + restore drill on production topology |
| P2-5 | Incident-response runbook + on-call | durable audit stream exists; no IR doc | owner decision | IR runbook authored and accepted |
| P2-6 | Data retention/erasure runbook (GDPR ops) | log redaction verified; retention unwritten | owner | policy documented + erasure procedure tested on staging |
| P2-7 | Payout execution policy | payout batches suite-verified; owner financial action required | owner | written payout approval policy |
| P2-8 | Per-provider webhook retry semantics mapping | P4-F4 code closed; provider-specific mapping at integration time | vendor+owner | mapped during P1-5 execution |

## P3 — non-blocking improvements

| ID | Item | Notes |
|---|---|---|
| P3-1 | P4-F2 docstring polish (`amount` contract summary in API docs) | code already standardized |
| P3-2 | Fleet observability (metrics export) | nice-to-have |
| P3-3 | Admin UI responsive-polish screenshots | after P1-7 enables device projects |

## Decision inputs

GO-blockers = all P1 rows. CONDITIONAL-limited-release blockers = P1-4, P1-5 (unless launch
excludes payments → manual-mode READiness per COMPLETE-BUSINESS-FUNCTIONALITY-AUDIT), P1-7
(recommended), plus owner acceptance of P2-2/P2-5. See FINAL-GO-LIVE-READINESS-REPORT.md for the
decision itself.
