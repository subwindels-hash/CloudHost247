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

- **Scope (explicitly agreed with the project owner):** shared layout shell (header/nav/footer,
  brand design tokens) applied to every route, plus a handful of core public pages (`/about`,
  `/hosting/cpanel`, `/legal/privacy-policy`) — not full content parity with the ~40-page existing
  WHMCS marketing site, and not billing/payments/provisioning.
- **Source/local/CI verification:** PASSED.
  - `frontend/src/layout/` (Header, Footer, Layout, useAuthState) + `frontend/src/lib/auth.ts`:
    shared shell wraps every route; header nav adapts to logged-in/out state.
  - New pages: `HomePage` (real hero copy), `AboutPage`, `HostingCpanelPage`,
    `LegalPage`/`PrivacyPolicyPage` (generic placeholder pattern).
  - `npm run typecheck` (server & frontend), `npm run build`, `npx vitest run` → all green
    (43/43 tests, up from 40 — added 3 cases to `tests/unit/spa-routing.test.ts` covering the new
    public routes through the real SPA-fallback mechanism, no server changes needed to add them).
  - Manual smoke test against the built app (background server, DB intentionally unreachable):
    `/`, `/about`, `/hosting/cpanel`, `/legal/privacy-policy`, `/login`, `/register`, `/dashboard`
    all returned `200`; CSS/JS bundle assets served correctly.
- **Content honesty decisions made this phase** (see `docs/CPANEL_DEPLOYMENT.md` section 8 for
  detail): reused the *real* CloudHost247 brand tokens/hero copy from
  `modules/addons/cloudhost247_theme/lib/ThemeRepository.php`; did **not** reuse the Lorem
  Ipsum/fabricated team-bio content from the legacy purchased WHMCS theme
  (`templates/cloudhost247_legacy/aboutus.tpl`); did **not** invent hosting plan prices (the real
  catalog is DB-driven in WHMCS and not yet connected to this app); did **not** fabricate legal
  policy text for the Privacy Policy placeholder route.
- **cPanel staging verification: still BLOCKED** — inherits the same open gate as Phase 1 (same
  reason: no cPanel environment/credentials available). Does not need to be re-justified per
  phase, but must be closed, alongside Phase 1's checklist, before either phase is described as
  cPanel-ready/production-ready. The project owner explicitly authorized Phase 2 to proceed in
  parallel with this gate open (see Phase 1 entry above).
