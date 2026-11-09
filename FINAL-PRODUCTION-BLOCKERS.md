# CloudHost247 — Final Production Blockers (Phase 4, 2026-11-09)

This document stratifies every claim by **verification level** — the levels are not
interchangeable and no claim is promoted beyond its evidence:

| Level | Meaning |
|---|---|
| **L1 — code verified** | implementation reviewed line-by-line and/or covered by the executed 2,901-test suite |
| **L2 — integration simulated** | runs end-to-end in the staging substitute with simulation/mock modes explicitly enabled and labeled |
| **L3 — verified against a real sandbox** | a provider's own test environment was used with owner-issued credentials |
| **L4 — production operation verified** | ran against the real deployed topology (cPanel/WHMCS/managed DB) |

**Current distribution:** L1: the entire first-party platform (server, adapters, security,
finance invariants, wallet/ledger, provider registry…). L2: provider provisioning paths (mock
adapter + deployment simulation mode, proven fail-closed), WHMCS bridge data paths, email
delivery honesty, payout batches, marketplace seller charges. **L3: only the in-app sandbox
payment gateway (which is first-party code — honest baseline, not third-party proof).**
**L4: nothing.** Anything labeled "production ready" in historical docs (2026-10-13 README
claims) remains superseded by `PRODUCTION-READINESS-REPORT.md`.

## Blockers (each actionable, none waived)

### Gate A — credentials / licensing (owner action required)
| ID | Item | Level needed | What's missing |
|---|---|---|---|
| B-2 | WHMCS client-area integration on staging (cart hand-off, SSO provisioning, callbacks, gateway module) | L3/L4 | licensed WHMCS install + staging account |
| B-4 | Real payment-provider sandbox certification (Stripe/PayPal/Paystack test keys, Blockonomics test wallet) incl. P4-F4 retry-semantics reconciliation | L3 | owner-issued test credentials |
| B-4b | Live provider sandbox runs for the 12 compute adapters (Hetzner/DO/Vultr/AWS/Contabo/OVH/Proxmox/Virtualizor/SolusVM/OpenStack/bridge) + registrar sandbox | L3 | owner-issued sandbox creds |
| B-5 | Quarantined migrations 0023/0024/0025/0041 | L1+ (still excluded) | explicit owner authorization — **must not be enabled without it** |

### Gate B — infrastructure (hosting action required)
| ID | Item | Level needed | What's missing |
|---|---|---|---|
| B-1 | Real-browser verification: Playwright e2e, WebAuthn attestation, visual responsiveness | L3 | browser binary CDN blocked in this sandbox |
| cPanel-run | CPANEL_DEPLOYMENT.md Appendix C — 18 unchecked staging items (Passenger boot, cron worker, SSL, proxy edge) | L4 | a real cPanel account |
| B-3 | Production Postgres probes (`verify:financial`, `verify:authorization` CLI form) + PITR recovery drill on the real topology | L4 | managed Postgres service (this host verified the method on embedded PGlite — the same fingerprint method must rerun there; include D4-F1 fix) |
| Email relay | Real `NOTIFICATION_EMAIL_WEBHOOK_*` delivery test | L3 | relay endpoint/credentials |

### Gate C — Phase-4 audit recommendations (pre-production hardening)
| ID | Item | Severity |
|---|---|---|
| P4-F1 | Require timestamp header on sandbox gateway webhooks (currently optional; dedup already bounds impact — proven live) | low |
| P4-F2 | Document `amount` as string-major-units-first in sandbox contract | cosmetic |
| P4-F3 | Explicit per-route throttle or edge WAF for webhook endpoints in production | operational |
| P4-F4 | Reconcile rejected-webhook HTTP semantics with each real provider's retry policy at integration time | integration |
| D4-F1 | Extend recovery drill checksums to all tables (not only the financial/identity spine) | low |
| OPS-1 | Fleet-wide rate limiting at the edge (in-code limits are per-instance; `tsx watch` reload retains counters — dev-only caveat discovered during audit) | operational |
| OPS-2 | Live admin-refund execution test on staging once a super_admin exists (code+suite verified; execution requires the role boundary honored) | pending-run |
| OPS-3 | Production backup cadence + off-host storage verification (today's drill proved method, not schedule) | operational |

## Stopped-at-authorization log (Phase 3+4 cumulative)

No live provider activation attempted; no production credentials present (none invented
either — sandbox secret is a local random dev value in git-ignored `.env`); no customer data;
no quarantined migration executed; no super_admin self-created (boundary observed); no security
gate bypassed; all 2,901 suite tests and both evidence-producing runs preserved.

## Certification verdict

- **Phase 3 staging certification: INDEPENDENTLY VALIDATED — reproducible, complete within its
  declared scope, trustworthy.** 33/33 claim-level checks verified (30 functional / 3
  availability-limited, disclosed); 23/23 independent security probes pass; payment settlement
  invariants hold under adversarial conditions; recovery proves backup→restore integrity for the
  staging database.
- **Production certification: NOT GRANTED.** Gates A/B/C above are the complete, current,
  honest list. Each item names its missing dependency and its target verification level.
