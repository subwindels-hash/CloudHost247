# CloudHost247 — Provider Integration Certification Matrix (2026-11-09)

Environment: controlled staging substitute (see STAGING-CERTIFICATION-REPORT.md).
**No production provisioning was activated; no provider was contacted with real credentials.**
Every adapter was verified at source/test level; live provider sandbox calls require
owner-issued credentials and are marked BLOCKED accordingly.

Test evidence: 15 unit provider/adapter suites + 4 integration suites (all passing):
`provider-configuration`, `undeclared-adapter-fail-closed`, `adapter-capability-matrix`,
`provider-capability-truth`, `provider-response-sanitization`, `provider-error-mapping`,
`provider-rescue`, `provider-console-metrics-truth`, `aws-adapter`, `contabo-adapter`,
`control-panel-adapters`, `deployment-adapter-operations`, `dns-providers`,
`domain-provider-architecture`, `infrastructure-provider-registry`,
`infrastructure-admin-operations`, `provisioning-health-and-images`, `provisioning-lifecycle`,
`server-infrastructure` — plus the server-agent protocol/conformance suites.

| Provider | Adapter | Capabilities verified | Fail-closed behavior | Live sandbox (owner creds) | Status |
|---|---|---|---|---|---|
| Hetzner Cloud | `hetzner-adapter.ts` (REST v1) | images/regions/sizes live-listed at call time; no hardcoded inventories | unconfigured → NOT_CONFIGURED; errors sanitized | BLOCKED — token required | Code-verified |
| DigitalOcean | `digitalocean-adapter.ts` | native REST v2 adapter | as above | BLOCKED | Code-verified |
| Vultr | `vultr-adapter.ts` | ISO list resolved live from public catalog | as above | BLOCKED | Code-verified |
| AWS EC2 | `aws-adapter.ts` (official SDK) | native adapter; serial-console helper audited | as above | BLOCKED | Code-verified |
| Contabo | `contabo-adapter.ts` (OAuth2) | token endpoint config; credential secrecy | as above | BLOCKED | Code-verified |
| OVHcloud PCI | `ovh-adapter.ts` + signed v1 client | signed requests; project-scoped | as above | BLOCKED | Code-verified |
| Proxmox VE | `proxmox-adapter.ts` + client | self-hosted API URL/token | as above | BLOCKED (self-hosted) | Code-verified |
| Virtualizor | `virtualizor-adapter.ts` | admin API key/secret | as above | BLOCKED | Code-verified |
| SolusVM 1 | `solusvm-adapter.ts` | admin API id/key | as above | BLOCKED | Code-verified |
| OpenStack | `openstack-adapter.ts` + Keystone v3 client | password login OR pre-issued token paths | as above | BLOCKED | Code-verified |
| Generic HTTPS bridge | `generic-http-adapter.ts` | operator-owned bridge token | as above | BLOCKED (bridge host) | Code-verified |
| Mock (development only) | `mock-adapter.ts` | pipeline mechanics under `ALLOW_MOCK_PROVIDER` + `DEPLOYMENT_SIMULATION_MODE` | **never honored when NODE_ENV=production** | exercised in dev staging | Verified (simulated) |
| WHMCS (billing/provisioning bridge) | `src/whmcs/*` | checksum-verified product map, fail-closed orderability (`MAP_INVALID`), read-only default | WHMCS unset → "not connected", never faked | BLOCKED — licensed install | Code-verified |
| Cloudflare DNS | `src/routes/cloudflare.ts` + `dns-providers` | token-scoped zone ops | unset → not connected | BLOCKED | Code-verified |
| Registrar/domain services | `src/domain-services/*` | extension catalog provenance gate (no seed may invent TLD data) | empty → honest empty state (live: extensions 200, 0 rows) | BLOCKED — registrar creds | Code-verified |
| Blockonomics (crypto gateway) | `modules/gateways/blockonomics*` | webhook/callback verification in payments suite | unconfigured → manual/invoice flow | BLOCKED — B-4 | Structural (PHP) |
| Stripe / PayPal / Paystack | webhook receivers | signature gates refuse webhooks until secrets configured | unset → not connected | BLOCKED — test creds | Code-verified gates |

## Cross-cutting properties (verified)

- **Undeclared adapters fail closed** — an enabled provider whose adapter isn't declared errors
  explicitly (`undeclared-adapter-fail-closed.test.ts`).
- **Provider responses are sanitized** before UI/logs (`sanitize-provider-response.ts` + suite).
- **Capability honesty**: adapter capability matrix is the single source — UI/tests assert the
  registry vocabulary (`provider-capability-truth`, `adapter-capability-matrix`).
- **Provisioning health-gating**: installs fail closed until the authenticated server-agent
  reports OS/security/health (`provisioning-health-and-images.test.ts`).
- **Credential storage**: agent/provider secrets AES-256-GCM via versioned key ring; rotation
  supported; plaintext legacies decrypt untouched (phoneservices suite + lib tests).
- **Audit trail**: admin provider operations audit-logged (infrastructure-admin-operations).

## Certification status

**Code-level certification: COMPLETE for all 12 compute adapters + WHMCS bridge + DNS +
registrar surface + 4 payment providers.** Live per-provider sandbox certification: **BLOCKED
on owner-issued credentials / authorization — none were invented or simulated as real.**
Plan: `POST-VERIFICATION-AUDIT.md` §3 item B-4 (sandbox-only, test projects, then retirement
of sandbox credentials before production keys are minted).
