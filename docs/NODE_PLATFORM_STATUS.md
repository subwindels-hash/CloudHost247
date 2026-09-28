# CloudHost247 Node Platform — Phase Status Ledger

Single source of truth for "what has actually been verified" vs. "what has only been built and
locally/CI tested." Update this file at the end of every phase. Do not describe any phase as
"cPanel-ready" or "production-ready" anywhere (chat, PRs, commit messages) unless this ledger
says the corresponding cPanel gate is CLOSED with evidence.

## Phase 1 — Node app foundation

- **Source/local/CI verification:** PASSED.
  - Commit `3523035c5817b857eb2917c188db2452bebab35a` on `arena/01a0e82a-cloudhost247`.
  - Clean `git clone` + `npm ci` + `npm run typecheck` (server & frontend) + `npm run build` +
    `npx vitest run` → 40/40 tests passing.
  - End-to-end auth/migration/rate-limit/SPA-fallback flow verified against a local
    Postgres-wire-protocol test database (PGlite), not a real cPanel/Postgres host.
  - `git diff` against base commit confirms zero WHMCS/PHP files modified.
- **cPanel staging verification: BLOCKED — NOT PERFORMED.**
  - Reason: no cPanel staging environment, credentials, or connector has been available to this
    work at any point.
  - Full detail and the 18-point checklist: `docs/CPANEL_DEPLOYMENT.md`, "Status of this
    document" note and Appendix C. All 18 items unchecked.
  - **Explicit decision on record:** the project owner was told this exact blocker in plain terms
    and chose to let Phase 2 proceed in parallel rather than pause on it, with the explicit
    condition that no "cPanel-ready"/"production-ready" claim is made until the real cPanel run
    happens. This is a deliberate, informed exception — not a skipped step.
  - **Action required before production use:** deploy the latest reviewed commit on
    `arena/01a0e82a-cloudhost247` (Phase 1 baseline: `3523035c5817b857eb2917c188db2452bebab35a`)
    to a real disposable cPanel account and complete every item in
    `docs/CPANEL_DEPLOYMENT.md` Appendix C, then update this ledger with real evidence (versions,
    logs, route-test results) before that claim is made anywhere.

## Phase 2 — Public website + shared application shell

- Status: in progress. See commits after `3523035` on `arena/01a0e82a-cloudhost247`.
- cPanel staging verification: still blocked for the same reason as Phase 1 — inherits the same
  open gate; does not need to be re-justified per phase, but must be closed before either phase
  is called production-ready.
