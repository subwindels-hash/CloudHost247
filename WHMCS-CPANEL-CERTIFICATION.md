# CloudHost247 — WHMCS & cPanel Certification (Phase 6, 2026-11-09)

## Status: STOPPED — licensing/infrastructure gate (Phase 6 §7)

**Authorization discipline record:**

| Check | Result | Evidence |
|---|---|---|
| Environment staging/sandbox? | none exists | credential inventory contains no WHMCS base URL, cPanel host, or WHM account |
| Owner authorization supplied? | no licensed WHMCS staging installation provided; no cPanel account provided | `.env` sweep 2026-11-09: no `WHMCS_*`, cPanel, or upstream host configuration with values |
| Credentials supplied securely? | none supplied | — |
| Scope of authorization | known only in plan: authorized staging install + cPanel account + explicit written scope | `docs/CPANEL_DEPLOYMENT.md`, B-2 |

**No WHMCS sign-in, client-area session, plan sync, provisioning, suspension, termination,
callback, invoice sync, admin permission check, or cPanel account-lifecycle action was
executed or claimed.**

## What is certified without the licensed stack (executed evidence, unchanged)

- **Bridge code paths** (L1): `src/whmcs/*` fail-closed orderability (checksum-verified product
  map, `MAP_INVALID` on drift, read-only default), WHMCS-side PHP theme/modules render the shared
  content, cron/`crons/` scripts authored (18 PHP suites + 842-target dual-version lint, CI-green).
- **Simulated data paths** (L2): the dev staging stack honestly reports WHMCS "not connected"
  when unset — never fabricates sync.
- **Deployment procedure** (documented): `docs/CPANEL_DEPLOYMENT.md` incl. Appendix C 18-point
  acceptance checklist and Appendix D rollback procedure.

## Certification procedure ready to execute when the gate opens

WHMCS (licensed staging install):
1. AuthN/session: admin + client logins, session timeouts, password reset mail path.
2. Client-area integration: Node platform SSO/redirect hand-off, links, deep-link auth.
3. Service-plan synchronization: checksum-verified map; plan CRUD propagation both directions; drift → `MAP_INVALID` behavior demonstrated on staging rows.
4. Provisioning + suspension: module-driven create/suspend against the sandbox compute provider (never production), verify action audit trail.
5. Termination safeguards: dry-run + confirm-gate behavior on staging products.
6. Module callbacks: sandbox payment gateway → WHMCS invoice lifecycle sync.
7. Invoice/service synchronization: issue/pay/void propagation; reconciliation against Node ledger where bridged.

cPanel: the full Appendix C checklist (Passenger boot, cron worker, SSL edge, reverse proxy,
backup cron activation), then: account create/suspend/terminate/un-suspend against a staging
cPanel, quota enforcement, password rotation event handling.

Evidence format: per step — request/response summaries, WHMCS/cPanel object IDs, screenshots or
har traces, executor identity, environment labels, sensitive values redacted.

**No production customer accounts will be touched; only the explicitly authorized staging tenant.**
