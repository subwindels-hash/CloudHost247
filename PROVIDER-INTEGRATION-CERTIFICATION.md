# CloudHost247 — Provider Integration Certification (Phase 6, 2026-11-09)

**Scope:** registrar, DNS and compute providers against external sandboxes.

## Status: STOPPED — credential + network gates (Phase 6 §7), per-provider, independently

**Authorization discipline record (per provider — same outcome for all ten):**

| Discipline check | Result (all providers) |
|---|---|
| Environment is staging/sandbox? | this sandbox only; no provider sandbox accounts registered |
| Owner authorization in writing? | none supplied |
| Credentials supplied securely? | **zero provider credentials present** (`.env` sweep 2026-11-09: no Hetzner/DO/Vultr/AWS/Contabo/OVH/Proxmox/Virtualizor/SolusVM/OpenStack/bridge tokens, no registrar or Cloudflare tokens) |
| Network path to provider sandbox? | unreachable — `api.hetzner.cloud` → 000; same allowlist blocks all provider APIs (verified egress sweep) |

**Accordingly: no Authentication, Account/balance lookup, Availability listing, Order creation,
Provisioning, Status synchronization, Cancellation, Error handling, Retry/reconciliation, or
Webhook verification call was made or claimed against any external provider. No transaction
identifiers exist to record (and hence nothing to redact from — none were invented).**

## What IS certified without external credentials (executed, unchanged)

| Property | Evidence |
|---|---|
| All 12 adapter contracts (auth shapes, base URLs, mapping) | `provider-configuration`, `adapter-capability-matrix`, per-adapter suites — CI green |
| Fail-closed behavior without credentials (NOT_CONFIGURED, never fabricated) | `undeclared-adapter-fail-closed.test.ts`; live staging honesty (extensions 200/0 rows, honest empty states) |
| Health-gated provisioning, sanitization, error mapping, rescue semantics | integration suites `provisioning-*`, `provider-response-sanitization`, `provider-error-mapping`, `provider-rescue` |
| Credential storage (AES-256-GCM + versioned ring), audit trail | phoneservices suite + key-ring lib tests |
| Registry truth (capability matrix as single source) | `provider-capability-truth`, `infrastructure-provider-registry` |

These are L1/L2 facts. They are **not** L3 provider certification and are labeled accordingly in
EXTERNAL-INTEGRATION-READINESS.md.

## Certification procedure per provider (ready on unblock; Phase-5 runbook §standard procedure)

For each of Hetzner Cloud, DigitalOcean, Vultr, AWS EC2, Contabo, OVHcloud PCI, Proxmox VE,
Virtualizor, SolusVM 1, OpenStack, the generic HTTPS bridge, plus registrar and Cloudflare DNS:

1. Record authorization scope (who/what/when) into `docs/staging/phase6-authorizations.md` (file this report references as required).
2. Store test-only credentials in runtime env from a secrets channel — never in repo.
3. Execute: auth → account/balance lookup → catalog listing (images/regions/sizes or TLDs/zones) → sandbox order → provisioning with health gate → live status sync → cancellation/termination safeguard dry-run → induced error (bad token) → retry/reconciliation against `webhook_events`-style durable jobs → webhook signature verification where the provider supports callbacks.
4. Redacted evidence: provider transaction IDs retained, account identifiers and IPs masked, in `docs/staging/providers/<name>-cert-<date>.md`.
5. Retire sandbox credentials before production keys are minted.

**Standing forbiddance reaffirmed:** no production provisioning; L2 simulation is never
presented as external certification.
