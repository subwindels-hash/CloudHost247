# CloudHost247 — External Integration Readiness (Phase 5, 2026-11-09)

Independent certification procedures per integration, with the four verification levels kept
strictly distinct — **L1 code · L2 simulation · L3 real sandbox · L4 production**. Nothing here
implies L3/L4 attainment without its listed gate.

## Integration status matrix

| Integration | L1 code-verified | L2 simulated | L3 owner sandbox | L4 production | Blocking gate |
|---|---|---|---|---|---|
| WHMCS (billing/provisioning bridge) | ✅ checksum-verified product map, fail-closed orderability, read-only default | ✅ staging substitute data paths | ☐ | ☐ | Licensed WHMCS install (B-2) |
| cPanel/Passenger hosting | ✅ deploy tooling + Appendix D rollback | n/a | ☐ Appendix C (18 items) on staging account | ☐ | cPanel account (infra) |
| Domain registrars | ✅ domain-services architecture, extension provenance gate | ✅ (empty, honest) | ☐ | ☐ | Registrar sandbox creds (B-4b) |
| DNS providers (Cloudflare) | ✅ token-scoped zones, sanitization | ✅ suites | ☐ | ☐ | CF test token (B-4b) |
| Compute providers ×12 (Hetzner, DigitalOcean, Vultr, AWS, Contabo, OVH, Proxmox, Virtualizor, SolusVM, OpenStack, generic bridge, mock) | ✅ registry, fail-closed unknown adapters, capability truth, health-gated installs, credential AES-256-GCM | ✅ mock-adapter + DEPLOYMENT_SIMULATION_MODE (dev-verified live in staging) | ☐ per-adapter | ☐ | Owner-issued sandbox accounts (B-4b) |
| Email relay | ✅ outbox-queue design, uniform anti-enumeration UX, honest "not configured" | ✅ (queued, never claimed sent) | ☐ | ☐ | `NOTIFICATION_EMAIL_WEBHOOK_*` relay (owner) |
| Payment: in-app sandbox gateway | ✅ + P4-F1..F4 hardening this phase | ✅ fully executed live (33/33 + probes) + suites 41 webhook tests incl. concurrency/lease-takeover | n/a — it IS the lab | ☐ | — |
| Payment: Stripe | ✅ `t=`-timestamped HMAC scheme, replay window tests | ✅ suite fixtures | ☐ | ☐ | Stripe test keys (B-4) + P4-F4 retry-policy reconciliation |
| Payment: PayPal | ✅ cert-based verify, SSRF guards incl. cloud-metadata block | ✅ suite with mocked cert endpoints (rotation asserted) | ☐ | ☐ | PayPal sandbox + webhook id (B-4) |
| Payment: Paystack | ✅ HMAC-SHA512 verify | ✅ suite | ☐ | ☐ | Paystack test keys (B-4) |
| Payment: Blockonomics (crypto) | ✅ PHP gateway receiver/gate checks | structural | ☐ | ☐ | B-4 test wallet |
| Marketplace/payout chain | ✅ suite | ✅ simulation | n/a | ☐ | payout batch execution = owner financial action |

## Standard certification procedure per integration (to run when its gate opens)

1. **Account & scope** — create a throwaway provider test project; no production resource reuse.
2. **Credential entry** — keys land ONLY in runtime env (never repo/logs; logger redaction already verified).
3. **Code-path confirmation** — the adapter/registry/services the suites pin are the live ones.
4. **L3 runbook execution** — for compute providers: image/region/size listing real, provision a
   tagged sandbox server, health-gated install, reconcile deletion with no orphan billing rows;
   for payments: full charge → signed webhook settle → refund → ledger reconciliation + the
   P4-F4 retry-semantics check per provider; for registrars/DNS: sandbox order/zone APIs with
   provenance gate still enforced; for email: one real relayed message in/out.
5. **Negative tests** — wrong secret, tampered payload, replay, stale timestamps, ambiguous
   outcomes (replayed verdicts, P4-F4 durable behavior asserted).
6. **Retire** — sandbox credentials destroyed before production keys are minted; evidence filed
   under `docs/staging/` with date, environment, executer.

## Stop points honored now

All ☐ boxes above are stopped at their named gate (credential/licensing/infrastructure/owner
financial action). None were simulated into "verified".
