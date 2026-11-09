# CT-06 — Compute / Registrar / DNS: Escrow & Certification Readiness (Phase 26, 2026-11-09)

## Your control boundary (as directed)

You (`subwindels-hash`) retain exclusive legal + account control. What this environment can only ever
receive is *one scoped credential per certification run* (revoked immediately after), never broad
account access.

## Per-provider minimum scope

| Provider | Exactly-one-needed scope | Minimum permission boundary supplied |
|---|---|---|
| Contabo | 1 VPS order sandbox scope | API order/disable (SEPARATE account, not production billing) |
| DigitalOcean | single project, droplet create/delete | scoped token, project-only, destroy allowed |
| Soyoustart/OVH | administration → sandbox server order | order/status only |
| Namecheap | DNS host record update on 1 test domain | DNS host-records only, sandbox TLD preferred |
| Namesilo | same | scoped API key + restricted IPs where feasible |
| Plesk (v-spot) | new cloud instance, ssh-restricted sandbox | create/stop/details only |

**Rule:** keys live short-lived, vault-held, never committed; revocation procedure = delete+rotate+
re-issue at each phase; revoked at certification end; usage is timeboxed to the certification window
which you schedule. Evidence: provider account IDs + transaction references + timestamps (captured,
never printed in artifacts).

## Execution-ready, run-time-yellow CT-06 unit order (once escrowed)

Order of unlock within CT-06 itself (most telling for the business):
**Compute (one: DigitalOcean or Contabo) → DNS (one: Cloudflare) → Registrar (one: Namecheap) → Plesk v-spot**.
Only one provider per sub-gate; each sub-gate is a separate authorization+evidence decision.

## Unavailable → stays blocked (honest)

Every CT-06 provider remains BLOCKED here because no credentials have been escrowed. Nothing else changed.

## Phase-26 deliverable ledger (internal, honest)

- Escrow topology: the table above + this document.
- Runbook: `docs/ops/BACKUP-RUNBOOK.md` unaffected; external runbook for providers `PAYMENT-PROVIDER-CERTIFICATION.md`-style per-provider SB honored by CT-06 as added when credentials land.
- No code touched requiring production key custody paths; no provider call attempted.

**CT-06 status: BLOCKED — awaiting narrowly scoped credentials under your escrow, per-integration.**
