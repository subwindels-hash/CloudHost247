# Phase 18 — Complete Module-by-Module Functional, Security & Operational Certification (2026-11-09, HEAD `9e317106`+)

## Method

No rewriting of already-certified components (per direction). Each of the 12 modules was walked
through the six Phase-17 junctions (front door, validation, DB state, permissions, honest failure,
no-duplicate retry) and assigned to your four-state taxonomy — Implemented / Internally tested /
Provider-certified / Unavailable — with suite evidence per cell.

## Firmware for your eyes first: genuine unfinished & unavailable (acknowledged, not hidden)

- **Support ticket attachments**: not implemented (text-only messages were delivered earlier by
  design). Escalation path exists; no binary upload claims are made.
- **Hosting email quotas**: configured via engine E.140 pattern; not externally verified.
- Wallet top-up beyond payment-provider execution (hooked at payment boundary, CT-05).

## Per-module verdicts (see `MODULE-CERTIFICATION-CATALOG.md` for the full annotated matrix)

| Module | State | Runtime gate |
|---|---|---|
| Hosting lifecycle (12 transitions: create→active/suspend/unsuspend/downgrade/terminate…) | Internally tested | CT-01/CT-02 for cPanel runtime |
| Domains (13 areas incl. order pipeline, transfers, migrations, renewal) | Internally tested | CT-06 registrar |
| Email (mailbox/SMTP/relay/contracts) | Internally tested | CT-04 relay/DANE |
| SSL lifecycle | Internally tested | CT (cert-authority sandbox, part of CT-02/06) |
| VPS/Dedicated (soyoustart_vps/ovh) | Internally tested at boundaries | CT-06 compute |
| RDP | Implemented + provisioning units tested | CT-06 |
| Proxies (LTE 4G) | Internally tested lifecycle | CT-06 |
| Virtual numbers (phoneservices_*) | Implemented + provisioning units tested | CT-06 comms |
| SMM | Implemented at source level | CT-06 SMM API |
| Billing (wallets/invoices/refunds/reconciliation) | **Internally certified financial integrity** | CT-05 reconciliation |
| Administration (RBAC/audit) | Internally tested | operational drill CT-08 |
| Support (tickets/replies/escalation) | Internally tested | attachments unavailable item |

## Re-run evidence this phase

47/47 across provisioning-lifecycle, worker-deployments, admin-customers-api, catalog-admin-api;
plus ssl-firewall-api 3/3; hosting-mode-selector, email suites — all green (targets selected to
anchor the highest-churn modules). Full Phase-10 reproduction total remains 164/164.

## Completion boundaries to P1

Every "Internally tested" row converts to "Provider-certified" when its named CT gate yields executed
evidence + verifier signature (owner `subwindels-hash`). Until then the four-state matrix is the
honest certification level. Production NO-GO stands; independent reviewer outstanding.
