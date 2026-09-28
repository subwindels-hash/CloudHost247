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

## Phase 2 (continued) — remaining core routes, real protected dashboard, session invalidation

- **Scope:** completes the remaining routes from the original Phase 2 agreement: `/hosting`,
  `/hosting/vps`, `/domains` (public), `/contact`, `/faq`, `/legal` (index), plus making
  `/dashboard` (and the rest of the authenticated app shell) a real, protected route instead of a
  page that merely displayed an error when signed out. Still explicitly not billing, payments, or
  provisioning.
- **New public pages, and where their content came from** (never invented prices, plans,
  capabilities, or legal text — see each page's own header comment for the specific source):
  - `/hosting` — index of service lines; the category list is the real, currently-published list
    from `faqs.php`'s "What services do you offer?" answer. Only cPanel Hosting and VPS Hosting
    link to a real page; the rest are labeled "on the current site" rather than given an invented
    page.
  - `/hosting/vps` — feature copy adapted from the real, currently-live VPS hosting content
    (`lang/overrides/english.php` `vpsfullaccess*`/`vpsintegratedcpanel*`/`vpsinstantprovision*`
    keys, rendered today by `vps-hosting.php`). No plan tiers, specs, or prices shown (same
    reasoning as the existing `/hosting/cpanel` page — that catalog is DB-driven in WHMCS and not
    yet connected here).
  - `/domains` (public marketing page, distinct from the authenticated `/account/domains` "my
    domains" page) — states plainly that domain search/registration isn't wired up yet (no live
    connection to the domain registry/pricing system), rather than showing a non-functional search
    box or invented prices.
  - `/contact` — real department email addresses already published and in active use across
    multiple currently-live policy pages (`support@`, `billing@`, `abuse@`, `privacy@`,
    `legal@cloudhost247.com`). No web contact form (this app has no outbound-email/SMTP capability
    yet — a form that didn't actually send anywhere would be a fake feature), no phone number or
    street address (the purchased theme's own contact template only has placeholder dummy values
    for those, e.g. `info@gmail.com` — correctly not reused, same reasoning as `AboutPage.tsx`).
  - `/faq` — all 12 questions/answers reused verbatim from the real, currently-published
    `faqs.php`; only internal links were repointed to this app's equivalent page where one exists.
  - `/legal` — index reusing the real titles/descriptions of all 10 policy documents from the real
    `legal.php`. Only Privacy Policy links to a page on this platform (via the existing generic,
    never-fabricates-legal-text `LegalPage` pattern); the other nine are listed honestly as "on
    the current site" rather than given fabricated policy text.
- **`/dashboard` is now a real protected route:**
  - `frontend/src/components/RequireAuth.tsx` wraps `/dashboard`, `/account`,
    `/account/domains` (renamed from `/domains` to free that path for the new public marketing
    page), `/services`, `/billing`, `/invoices`, `/admin`. A signed-out visitor is redirected to
    `/login` and never renders protected content, even momentarily.
  - This is a client-side convenience redirect on top of the real security boundary: every
    protected API call is independently re-verified server-side (`src/lib/require-auth.ts`),
    including rejecting a token that was explicitly logged out (see below). `apiFetch` centralizes
    reacting to a 401 by clearing the local session, so a token that goes bad server-side (expired
    or revoked, possibly from another tab) is reflected in the UI on the very next render.
  - `DashboardPage` and the new `AccountPage` show only real, server-verified identity
    (`/api/auth/me`) plus honest "hasn't been migrated to this platform yet" notices for hosting
    services, billing/invoices, and domains — no fabricated balances, invoices, services, orders,
    or provisioning records.
- **Logout now actually invalidates the session server-side**, not just client-side:
  - `database/migrations/0003_create_revoked_tokens.sql` adds a DB-backed denylist table (no
    Redis/queue — a single indexed Postgres lookup per authenticated request, consistent with this
    project's constraints).
  - JWTs now carry a `jti` (JWT ID, via `jsonwebtoken`'s built-in `jwtid` sign option).
    `POST /api/auth/logout` records that token's `jti` as revoked; `src/lib/require-auth.ts`
    (used by both `/api/auth/me` and `/api/auth/logout`) rejects any token whose `jti` is revoked,
    even though its signature and expiry are still valid.
  - Proven end-to-end against a real embedded Postgres engine (pglite, migrated with the actual
    committed SQL files — not mocks) in `tests/integration/auth-flow.test.ts`: register → login →
    `/api/auth/me` succeeds → logout (204) → the *same, still-unexpired* token now gets 401 from
    `/api/auth/me`; a second, different session for the same user is unaffected by the first one's
    logout; logout itself requires a valid token and is safe to call twice.
- **Navigation contract enforced:** logged-out header shows exactly "Sign In" / "Create Account";
  logged-in header shows "Dashboard" / an account link (labeled with the user's first name) /
  "Log out". "Log out" calls the real server-side logout endpoint first (best-effort — it also
  clears the local session even if that network call fails, e.g. offline) rather than only
  discarding the local token.
- **Source/local/CI verification: PASSED.**
  - Clean `git clone` + `npm ci` + `npm run typecheck` (server) + `npx tsc -p frontend/tsconfig.json
    --noEmit` (frontend) + `npm run build` + `npx vitest run` → all green, **70/70 tests** across
    12 test files (up from 43 at the last report): new backend integration coverage
    (`tests/integration/auth-flow.test.ts`, 7 tests, register/login/me/logout/revocation against a
    real embedded Postgres engine), extended `tests/integration/migrate.test.ts` for the new
    migration, extended `tests/unit/jwt.test.ts` for the `jti` claim, extended
    `tests/unit/spa-routing.test.ts` for all the new routes, and new frontend component tests
    under `frontend/tests/unit/` (jsdom + `@testing-library/react`, added as new dev dependencies)
    covering authentication-aware navigation, `/dashboard` route protection end-to-end, and
    session invalidation on a 401.
  - Manual smoke test against the built app (background server, DB intentionally unreachable so
    only static/routing/build behavior is exercised): every route listed above returns `200`
    through the real SPA-fallback mechanism, and the production JS bundle was grepped to confirm
    the real FAQ/contact/legal content actually made it into the built output.
  - Responsive/overflow review: CSS-only review (no automated headless-browser/visual-regression
    tool was available in this sandbox — Playwright's browser binaries could not be downloaded,
    network access is registry-only). The new grid layouts (`.ch247-index-grid`,
    `.ch247-contact-grid`) were given the same sub-767px single-column override already used by
    `.ch247-grid`, so no grid track has a minimum width that could force horizontal scroll on a
    narrow viewport.
  - `git diff` against the Phase 1 base commit, restricted to non-`cloudhost247-node`/non-docs
    paths, confirms zero WHMCS/PHP files modified.
- **cPanel staging verification: still BLOCKED** — unchanged from above; no cPanel
  environment/credentials have become available during this continuation.
