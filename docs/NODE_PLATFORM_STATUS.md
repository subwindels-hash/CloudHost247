# CloudHost247 Node Platform — Phase Status Ledger

Single source of truth for "what has actually been verified" vs. "what has only been built and
locally/CI tested." Update this file at the end of every phase. Do not describe any phase as
"cPanel-ready" or "production-ready" anywhere (chat, PRs, commit messages) unless this ledger
says the corresponding cPanel gate is CLOSED with evidence.

---

## ⚠️ GOVERNANCE NOTICE — Phase Status & Formal Acceptance Ledger

**Status: Phase 5A ACCEPTED · Phase 5B ACCEPTED (B1–B4; B5 separately recorded) · Phase 5C ACCEPTED · Phase 5D ACCEPTED (Dev Milestone) · Phase 5E VERIFIED · Phase 5F VERIFIED · Phase 5G VERIFIED**

The locked Phase 5 cadence requires explicit user review and formal acceptance at the end of every
sub-phase before the next one begins.

| Phase | Milestone / Verification Commit | Formal Status | Scope & Boundary Record |
| --- | --- | --- | --- |
| 5A — Commerce foundation | `3033349a3498a90c5a52dc76dc6d20f2d6fe4bf2` | **ACCEPTED** (2026-09-29) | Cart, orders, order items, server pricing snapshots. Zero payment routes. |
| 5B — Billing foundation | `9361062e40e36aa73d8a257e96b0dcd6707d4ce0` | **ACCEPTED** (2026-09-29) | Invoices, append-only billing ledger, payment schema. Invariants B1–B4 authorized scope. B5 separately recorded as additional defense-in-depth control. Migration 0023 prepared/tested — NOT EXECUTED IN PRODUCTION. |
| 5C — Payment integration | `c2d308679eec5e8315c7f08325a6c57ce94b2c41` | **ACCEPTED** (2026-09-29) | Manual offline payment flow & sandbox abstraction. Server-authoritative amounts, staff-only confirmation, atomic transitions (1 transition, 1 ledger entry), deterministic 409 conflicts, 39/39 auth probe, 49/49 invariant sweep. External webhooks remain FROZEN. |
| 5D — Webhooks & Ingestion Pipeline | `ec3950395891cc5293e40a86e84a373afc6d4904` | **ACCEPTED** (2026-09-29) | Development milestone accepted. Production frozen. Cryptographic webhook verification, DNS anti-SSRF, replay defenses, lease takeover crash recovery, raw-body verification. |
| 5E — Customer Billing Portal | `48d131b5c09bfa471df5d24edc110bdfd971571d` | **VERIFIED** (2026-09-29) | Customer invoice list (`/invoices`), invoice detail + line items + payment history (`/invoices/:id`), printable receipt `@media print`, interactive payment modal (`PaymentModal.tsx`), customer ledger & balance dashboard (`/billing`). |
| 5F — Admin Billing Management | `a5c0ce8` | **VERIFIED** (2026-09-29) | Staff invoice management (`/admin/invoices`, `/admin/invoices/:id`), authorized refund workflow with append-only ledger entries & balance capping, unpaid invoice cancellation, global audit ledger (`/admin/ledger`), Migration 0025. |
| 5G — End-to-End Reconciliation | `arena/01a0eb6e-cloudhost247` | **VERIFIED** (2026-09-29) | Automated financial reconciliation engine (`reconciliation-service.ts`), staff reconciliation API (`GET /api/v1/admin/billing/reconciliation`), multi-gateway E2E lifecycle suite, comprehensive platform verification. |

### Standing restrictions until the user explicitly lifts them

- **Migrations 0023, 0024, 0025, and 0041**: Prepared and tested migration artifacts only. **NOT authorized for production execution**; do not run against any production database until separately authorized.
- **Production Safety**: Zero production financial records modified. Zero deployment executed.
- **PR #12 (`subwindels-hash/CloudHost247#12`)**: Remains **OPEN and UNMERGED**.
- **Historical Integrity**: Current state is preserved: no history rewrite, no force-push, no whole-PR revert.

### Formal Acceptance Summary

| Phase | Acceptance Status | Scope Accepted | Verification Evidence |
| --- | --- | --- | --- |
| 5A | **ACCEPTED** | Cart management, order creation, order items, price snapshots, integer-cent money arithmetic. | 193/193 tests at isolated milestone; 251/251 at remote `main`. Remediated quantity cap 500 (`8806b9d`) & negative money (`d0afa16`). |
| 5B | **ACCEPTED** | Invoices issued atomically at checkout, append-only `billing_ledger` enforced by DB trigger, `payments` schema. Invariants **B1–B4** accepted as originally authorized scope. | DB-level enforcement, application enforcement, direct SQL tests, concurrency tests, populated-schema tests, rollback testing, migration integrity evidence. Full suite 35/35 files, 310/310 tests. |
| 5C | **ACCEPTED** | Manual/offline flow, sandbox gateway abstraction, server-authoritative amounts, customer cannot mark paid, staff-only confirmation, atomic payment confirmation (1 transition, 1 ledger entry), deterministic replay/conflict handling, audit trail actor attribution. | 22/22 payment API integration tests, 39/39 HTTP auth probes, 49/49 financial invariant sweep, deterministic forced-interleaving proof, 6x5 concurrency burst tests. |
| B5 | **Separately Recorded** | **B5 — Additional identified financial invariant / defense-in-depth control — implemented and verified, but added after the original B1–B4 authorization.** (Invoice `user_id`, `currency`, `total_amount` must agree with parent order). | Implemented and verified in `d01aa67` & `migration-0023.test.ts`. Preserved in codebase and tests. |

### Migration 0023 Status
- **Artifact**: `cloudhost247-node/database/migrations/0023_enforce_billing_invariants.sql` (SHA-256: `7a98a4a758686db2c15d8043da5381dbdb9c835d8934a4c4591efa8a66b2fe3d`).
- **Status**: **PREPARED AND TESTED ONLY — NOT EXECUTED IN PRODUCTION.**

### Staging & Verification Limitations
- **cPanel Staging**: **BLOCKED / NOT PERFORMED** (no cPanel environment or credentials available).
- **Visual / Browser Tests**: **NOT PERFORMED** (headless browser binaries unavailable in sandbox; frontend tested via jsdom / Testing Library unit suites).
- **Production Database**: **READ-ONLY INSPECTION ONLY** (Sections 5 and 6 of `check-production-state.sql` returned zero rows; no production data altered).

---

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

## Phase 3 — Node Façade & Catalog

- **Scope (explicitly authorized):** first real catalog/application-façade layer — Catalog →
  Product → Plan → Pricing → Public API → Admin config — independent of WHMCS, while WHMCS stays
  the authoritative order/billing system. Explicitly **not** order/payment/provisioning/invoice/
  service-activation (checkout flow deferred to a future phase). Started from accepted Phase 2
  commit `d1baf2e510a58a96a1b3657e5bbbcc76ce29693c`.
- **Session/git constraint:** this session cannot create a separate `phase3` branch or a genuinely
  separate pull request. Phase 3 is delivered as new, clearly-labeled commits on
  `arena/01a0e82a-cloudhost247` (the same branch as PR #11), with the PR description updated to
  delineate "Phase 2 (accepted)" from "Phase 3 (new, pending review)". Nothing from Phase 1/2 was
  amended, rebased, or force-pushed — Phase 2's accepted commit remains intact and reachable.
- **Schema (`database/migrations/0004`–`0007`):**
  - `0004` — `products` (slug, name, description, product_type, status, visibility,
    display_order, timestamps).
  - `0005` — `product_plans` (product FK, slug unique per product, name, description, status,
    billing_model, display_order, timestamps).
  - `0006` — `plan_pricing` (plan FK, billing_period, currency, amount **nullable**, setup_fee,
    effective_status, timestamps) with a `CHECK` constraint
    (`plan_pricing_published_requires_amount_check`) making "published with no amount"
    structurally impossible at the database level — the schema itself enforces "never invent a
    price."
  - `0007` — `plan_features` (plan FK, name, value, display_order, visibility).
  - All four are additive-only (new tables), no destructive change to any Phase 1/2 table.
- **Repository/service/DTO layer (never a WHMCS-table passthrough):**
  `src/db/catalog-products.ts`, `catalog-plans.ts`, `catalog-pricing.ts`, `catalog-features.ts`
  (repository) → `src/services/catalog-service.ts` (public read model, enforces "public/active
  only" and "published pricing only" centrally) → `src/dto/catalog.ts` (explicit response DTOs,
  never raw DB rows) → `src/routes/catalog-public.ts` / `src/routes/catalog-admin.ts`. Full
  contract: `docs/API_CATALOG.md`.
- **Public API added:** `GET /api/v1/catalog`, `GET /api/v1/catalog/products[?type=]`,
  `GET /api/v1/catalog/products/:slug`, `GET /api/v1/catalog/products/:slug/plans`. Unauthenticated,
  public-data-only, validated params, consistent JSON error shape, correct status codes (400/404
  distinguished, e.g. malformed slug vs. missing/private slug).
- **Admin API added:** full product/plan/pricing/feature CRUD plus enable/disable, all under
  `/api/v1/admin/catalog/*`, gated by the existing JWT/`jti`-revocation auth model plus
  `requireRole('super_admin')` (server-side only — the client-supplied role is never trusted).
  Every mutation is a real Postgres write, proven in tests by reading the row back afterward, not
  just asserting a `200`.
- **Frontend wiring (Phase 2 visual system unchanged — no redesign):**
  - `/hosting` is now a real catalog landing page: primary content is fetched live from
    `GET /api/v1/catalog` (`frontend/src/lib/useApiResource.ts`), with a distinct "coming soon" vs.
    "available here" state per real product `available` flag. The known-real-but-not-yet-catalogued
    service lines from Phase 2 (Shared Hosting, Dedicated Hosting, etc.) are still shown honestly
    below the live catalog section so the page never looks emptier than the real current service
    lineup, and an explicit empty-catalog hint appears if the live catalog itself has zero rows.
  - `/hosting/cpanel` and `/hosting/vps` keep their existing static "what's included" marketing
    copy (true regardless of catalog state) and add a new, live "Plans & pricing" section
    (`frontend/src/components/ProductPlansSection.tsx`) backed by
    `GET /api/v1/catalog/products/:slug/plans`, with an honest, distinct message for every real
    state: loading, network/server error, product not yet in the catalog (404), product present but
    still draft ("being finalized"), product active with zero published plans, and — per plan — no
    published pricing yet. No fabricated plan names, specs, or prices at any point.
  - `/domains` keeps the Phase 2 "domain search/registration isn't connected yet" notice
    unconditionally (registrar/WHMCS domain-lookup integration is still absent), and separately,
    honestly queries `GET /api/v1/catalog/products?type=domain` to show whatever domain-type
    catalog entries actually exist (or "none configured yet") — catalog capability and real
    registrar availability are kept visibly distinct, exactly as required.
  - `frontend/src/lib/api.ts`'s `apiFetch` now throws an `ApiRequestError` carrying the real HTTP
    status code (previously just a message), used to distinguish a 404 ("not in the catalog") from
    a generic failure; fully backward compatible with every existing `instanceof Error` catch site.
- **Every catalog-driven page/section explicitly handles:** loading, success, empty (zero
  products/plans), unavailable product (draft), API failure (network/5xx), and malformed response
  (a `res.json()` parse failure surfaces as the same visible error banner, via the same rejected
  promise path) — no blank screens, no silent fallback to fake data anywhere in this phase.
- **Testing:**
  - `tests/integration/catalog-schema.test.ts` (8 tests) — DB-level: constraints, per-product plan
    slug uniqueness, active-only plan listing, publish-requires-amount `CHECK`, negative-price
    rejection, feature replace + public-only visibility, enable/disable persistence,
    partial-update semantics.
  - `tests/integration/catalog-public-api.test.ts` (10 tests) — list/retrieve/plans endpoints:
    hidden/private exclusion, draft-but-public "coming soon" (not hidden, not 404), invalid `type`
    query rejected, invalid vs. missing-vs-private slug (400 vs. 404, indistinguishable for
    private), empty catalog returns a real empty `200`, disabled plan excluded from public plans.
  - `tests/integration/catalog-admin-api.test.ts` (15 tests) — unauthenticated rejected, non-admin
    (`customer`) rejected, wrong-role (`admin`, not `super_admin`) rejected, revoked/logged-out
    token rejected, full create/update/enable/disable persistence (verified by reading the row
    back and by re-querying the public API), invalid payload → 400 + confirmed non-persistence,
    invalid UUID param → 400, nonexistent id → 404, full plan+pricing+features creation flow
    verified end-to-end through the public API, publish-without-amount rejected with a clean 400
    (both on create and on `PATCH`), admin detail endpoint exposes draft/unpublished/private data
    that the public API correctly withholds.
  - `tests/integration/migrate.test.ts` — extended to 10 tests covering all 7 migrations
    (unchanged pattern from Phase 2, now including the 4 new catalog migrations).
  - Frontend: `frontend/tests/unit/hosting-catalog-page.test.tsx` (4), `hosting-cpanel-page.test.tsx`
    (5), `hosting-vps-page.test.tsx` (2), `domains-marketing-page.test.tsx` (3) — loading, success
    (real data rendering, correct links/prices/features), empty, error, draft/unavailable-product,
    and 404-not-yet-catalogued states, each asserted against the real rendered DOM via
    `@testing-library/react` with a stubbed `fetch`, exercised through the real `App` router (not
    the component in isolation).
  - **Full suite: 118/118 tests passing across 20 test files** (up from 70 at the last Phase 2
    report), via a clean `npm run typecheck` (server), `npx tsc -p frontend/tsconfig.json --noEmit`
    (frontend), `npm run build` (server + frontend, Vite production build succeeds), and
    `npx vitest run`. All integration tests run against a real embedded Postgres engine (pglite),
    migrated with the actual committed SQL files — not mocks.
  - `git diff` against the Phase 2 base commit, restricted to non-`cloudhost247-node`/non-docs
    paths, confirms zero WHMCS/PHP files modified, consistent with every prior phase.
- **API contract documentation:** `docs/API_CATALOG.md` — endpoints, methods, auth/authz
  requirements, request/response DTOs, and the full error-code table, written directly against the
  actual route/schema code in this phase (not aspirational).
- **cPanel staging verification: still BLOCKED / UNVERIFIED** — unchanged reason as every prior
  phase (no cPanel environment/credentials have been available at any point in this project). This
  phase does not add or remove any cPanel-incompatible dependency (still Fastify + `pg` +
  `process.env.PORT`, no Docker/K8s/systemd/mandatory-Redis/PM2/custom-Nginx/daemons/root). Must
  not be described as cPanel-ready/production-ready until Appendix C of
  `docs/CPANEL_DEPLOYMENT.md` is closed with real evidence from an actual cPanel account.
- **Known limitation carried over, unchanged:** no automated headless-browser (Playwright/
  Chromium) visual/responsive verification is possible in this sandbox (browser binary download
  fails — registry-only network access). The new `.ch247-plan-grid`/`.ch247-state-banner` CSS
  reuses the same responsive breakpoint pattern as the existing `.ch247-index-grid`/`.ch247-grid`
  (single-column below 767px), verified by manual CSS review only, not a real browser.
- **Dev-only seed data:** `database/seed/dev-catalog-seed.sql` — an optional, explicitly-labeled
  fixture (two obviously-fake `[DEV FIXTURE]`-prefixed products, one published example price of
  `$1.23/mo`, one left in `draft`) for manually exercising the full UI end to end without first
  driving the admin API by hand. Lives outside `database/migrations/` on purpose and is **never**
  run automatically by `npm run migrate` or app boot — run by hand only
  (`psql "$DATABASE_URL" -f database/seed/dev-catalog-seed.sql`), idempotent (fixed ids,
  `ON CONFLICT (id) DO NOTHING`), verified in `tests/integration/dev-catalog-seed.test.ts`.
- **Intentionally not implemented in this phase (deferred, per the authorized scope):** no
  cart/checkout/payment/invoice/order/service-activation flow of any kind; domain
  registrar/availability integration remains unconnected by design.

## Phase 4 — Customer App

- **Scope (explicitly authorized):** self-service customer account management (full-name edit,
  password change with real session invalidation), passive/staff-entered `customer_services` and
  `customer_domains` records, a threaded customer support-ticket system, a staff customer
  directory (admin + super_admin), staff service/domain/ticket management, and super_admin-only
  account status/role changes. Explicitly **not** cart/checkout/orders/payments/billing ledger/
  invoices/automated provisioning/registrar integration (deferred to Phase 5/6). Started from
  accepted Phase 3 commit `66bfb76deb7a57ebdcf55f474c81b08fdf99e30c`.
- **Session/git constraint:** same as Phase 3 — delivered as new, clearly-labeled commits on
  `arena/01a0e82a-cloudhost247` (PR #11), with the PR description updated with a dedicated Phase 4
  section. Nothing from Phase 1–3 was amended, rebased, or force-pushed.
- **Schema (`database/migrations/0008`–`0013`):**
  - `0008` — `customer_services` (user FK `ON DELETE CASCADE`, optional catalog product/plan soft
    links `ON DELETE SET NULL`, status `CHECK`, staff-only `notes`/`created_by`).
  - `0009` — `customer_domains` (same pattern; `domain_name` deliberately **not** globally unique —
    a staff record, not a live registry).
  - `0010`/`0011` — `support_tickets` / `support_ticket_messages` (status lifecycle `open` →
    `pending_staff`/`pending_customer` → `closed`, reopens on any further reply; message body
    non-blank `CHECK`; `author_role` captured as an immutable snapshot at post time).
  - `0012` — `users.password_changed_at`, backfilled to **epoch** (`1970-01-01T00:00:00Z`, never
    `now()`) so existing sessions are not disrupted by the deploy itself — only a real, subsequent
    password change invalidates prior tokens. Full rationale in the migration file's comments.
  - `0013` — widens the `auth_audit_log` event-type `CHECK` (not a new table) to accept
    `profile_update`, `password_change`, `admin_status_change`, `admin_role_change`.
  - All six are additive-only, no destructive change to any Phase 1–3 table.
- **Repository/DTO/route layer:** `src/db/customer-services.ts`, `customer-domains.ts`,
  `support-tickets.ts` (repository) → `src/dto/account.ts` (never leaks `notes`/`created_by`/
  `password_hash`/another user's raw id to a customer-facing response) → `src/routes/account.ts`
  (self-service, `/api/v1/account/*`) and `src/routes/admin-customers.ts` (staff,
  `/api/v1/admin/customers/*`, `/api/v1/admin/tickets/*`).
- **Authorization model (enforced server-side on every request, never trusting the JWT claim
  alone):** `src/lib/require-role.ts` re-reads the caller's current role from `users` on every
  call. Customer routes are self-scoped only (`authenticate()`); most staff routes accept
  `admin`/`super_admin`; account-status and role-change routes accept `super_admin` only. A
  super_admin cannot change their own role (self-demotion lockout, `400`). Frontend hiding
  (`RequireRole.tsx`) is UX only and documented as such in its own source comment.
- **Ownership isolation:** every self-service query is scoped to the caller's own `userId`. A
  record that exists but belongs to someone else is **never** distinguishable from one that
  doesn't exist — both return `404`, never `403` (proved adversarially in
  `tests/integration/account-api.test.ts` with two real accounts, including a DB-level check that
  a cross-customer write attempt was never persisted).
- **Password/session security:** `authenticate()` (`src/lib/require-auth.ts`) rejects a JWT whose
  `iat` predates the account's current `password_changed_at` (both floored to whole-second
  precision — a deliberate, documented fix for the `iat`/`timestamptz` granularity mismatch,
  proven by a test that forces real >1s delays around the password-change call). Independent of
  the existing `jti`/`revoked_tokens` logout mechanism. A suspended/disabled account's still-valid
  JWT is rejected on its very next request. Wrong-current-password returns `400
  VALIDATION_ERROR`, not `401` — using `401` here was a real bug (caught via frontend TDD) that
  collided with the frontend's "401 while holding a token ⇒ clear session" heuristic and silently
  logged customers out for a typo; fixed and regression-tested.
- **Passive-record boundary (no provisioning):** creating/editing a `customer_services` or
  `customer_domains` row never calls cPanel/WHM/a registrar API and never provisions/activates/
  verifies anything — proved by a test that stubs `globalThis.fetch` to throw if called at all,
  then performs both mutations and asserts zero calls were made.
- **Every customer-facing page explicitly handles:** loading, success (real data), empty ("no
  services/domains/tickets yet"), API failure (visible banner, not a blank page), signed-out
  (redirect to `/login`), and role-restricted (`RequireRole`'s "not available" message for a
  customer reaching `/admin`) — no hardcoded records, balances, invoices, or fake success states
  anywhere in this phase. Billing/Invoices remain the unchanged, honest Phase 1 placeholder.
- **Testing:**
  - `tests/integration/customer-app-schema.test.ts` (11 tests) — DB-level: FK
    cascade/SET NULL behavior, status `CHECK` enforcement, partial-update semantics, ticket
    lifecycle including reopen-on-reply, blank-message rejection, per-user vs. all-tickets scoping.
  - `tests/integration/account-api.test.ts` (8 tests) — self-service API end-to-end: unauthenticated
    rejection, profile update persistence, wrong-password `400` (hash untouched), real
    password-invalidation of prior tokens with a freshly-issued token still working, ownership
    isolation (services/domains/tickets), no self-service create/edit route exists for
    services/domains, 404-not-403 for another customer's ticket (with non-persistence proof),
    malformed-UUID vs. nonexistent-id distinction.
  - `tests/integration/admin-customers-api.test.ts` (11 tests) — full RBAC matrix (unauthenticated/
    customer/admin/super_admin), super_admin-only status/role routes, self-demotion lockout, a
    forged-JWT-claiming-super_admin attack correctly rejected via DB re-verification, cross-customer
    URL-id attachment rejected (`404`), and the `fetch`-stubbing no-side-effect boundary test.
  - `tests/integration/migrate.test.ts` — extended to cover all 13 migrations.
  - Frontend: `dashboard-protected.test.tsx`, `services-domains-pages.test.tsx`,
    `support-pages.test.tsx`, `account-page.test.tsx`, `admin-rbac.test.tsx` — loading/empty/
    success/error/signed-out/role-restricted states, the 404-not-403 ownership check, and a
    dedicated regression assertion for the wrong-current-password bug (session/token still intact,
    no Login screen shown).
  - **Full suite: 165/165 tests passing across 27 test files**, via a clean backend typecheck,
    frontend typecheck, production build (`npm run build`), and `npx vitest run`. All integration
    tests run against a real embedded Postgres engine (pglite), migrated with the actual committed
    SQL files — not mocks.
  - `git diff` against the Phase 3 base commit, restricted to non-`cloudhost247-node`/non-docs
    paths, confirms zero WHMCS/PHP files modified. **`package.json`/`package-lock.json` are
    byte-identical to the Phase 3 baseline — zero new npm dependencies added.**
- **API contract documentation:** `docs/API_CUSTOMER_APP.md` — full RBAC matrix, ownership/
  404-not-403 rationale, the complete password-invalidation contract (including the epoch-backfill
  rationale and the same-second precision trade-off), and every endpoint's request/response shape,
  written directly against the actual route/DTO code (cross-checked line-by-line in an independent
  review pass — see PR #11's Phase 4 verification section).
- **Independent verification pass:** a separate review (not the implementation session) re-derived
  every result above from a genuinely fresh `git clone` of `origin` — resolving the true branch tip
  via `git ls-remote`, confirming `66bfb76` as a genuine unmodified ancestor, and re-running the
  full clean-clone build/typecheck/test suite independently. No discrepancy found. Full detail
  recorded in PR #11's description.
- **cPanel staging verification: still BLOCKED / UNVERIFIED** — unchanged reason as every prior
  phase. This phase adds no cPanel-incompatible dependency and no new dependency at all.
- **Known limitation carried over, unchanged:** no automated headless-browser (Playwright/
  Chromium) visual/responsive verification is possible in this sandbox. Frontend correctness is
  verified via jsdom + Testing Library unit tests only, not a rendered browser.
- **Intentionally not implemented in this phase (deferred, per the authorized scope):** cart,
  checkout, orders, payments, payment gateways, a billing ledger, real invoices, automated
  provisioning, cPanel/WHM API calls, domain registrar API calls, automatic service activation,
  automatic domain registration/renewal, email verification/change, 2FA, SSO, file uploads.

## Phase 5A — Commerce foundation (cart → orders → order items → price snapshots) — ACCEPTED

- **Status:** **ACCEPTED** by the repository owner on 2026-09-29 following independent review-only clean-clone verification.
- **Accepted Milestone SHA:** `3033349a3498a90c5a52dc76dc6d20f2d6fe4bf2`.
- **Independently Verified Remote `main` SHA:** `cca731a4a9178ba784b408265da65ab5bacd9d49`.
- **Acceptance Record Commit:** `40c6d323dd629f57d62a5dce83e83c8bee8f6bd8`.
- **Ancestry Verification:** Phase 4 accepted commit `c6e2e6a405aafd50aae8efe10caaf2503d9ec066` confirmed as genuine ancestor.
- **Independent Clean-Clone Verification Results:**
  - Clean `git clone` + `npm ci` (302 packages installed, 0 vulnerabilities).
  - Backend typecheck (`tsc -p tsconfig.json --noEmit`): PASSED (0 errors).
  - Frontend typecheck (`npx tsc -p frontend/tsconfig.json --noEmit`): PASSED (0 errors).
  - Production build (`npm run build`): PASSED (server + Vite client, 82 modules transformed).
  - Test suite at 5A isolated milestone (`3033349`): **29 test files, 193/193 tests passing** (0 failures, 0 skips).
  - Test suite at remote `main` SHA (`cca731a`): **33 test files, 251/251 tests passing** (0 failures, 0 skips).
- **Verification Limitations & Environmental Boundaries:**
  - **Browser/Headless-browser verification: NOT PERFORMED.** No visual, real browser, or headless-browser (Playwright/Chromium) test was executed in this sandbox environment; frontend verification was conducted via jsdom and Testing Library unit tests only.
  - **cPanel staging verification: BLOCKED / NOT PERFORMED.** Inherits the open staging gate (no cPanel environment/credentials).
- **Scope (explicitly authorized, first sub-phase of Phase 5 "Commerce & Billing"):** a real cart
  (one per customer), server-priced add/update/remove-item operations, and checkout into a real,
  immutable `orders`/`order_items` record with a permanent price snapshot. Explicitly **not**
  payments, payment gateways, webhooks, invoices, a billing ledger, billing emails, or admin/staff
  order-viewing (all deferred to 5B–5G, per the user-approved sub-phase sequence and the
  per-sub-phase checkpoint cadence). Started from accepted Phase 4 commit `d84b620`.
- **Preserved Phase 5A Non-goals & Financial Boundaries:** Zero payment gateway integration, zero invoice processing, zero billing ledger, zero automated provisioning, zero registrar calls, and zero ability to mark orders paid (all orders created as `status: 'pending'` and `payment_status: 'unpaid'`).
- **Locked architecture decisions carried into this and every later Phase 5 sub-phase:** (1) the
  payment gateway layer (5C) will be an abstraction plus a fully-featured manual/offline gateway
  plus a self-contained sandbox gateway with simulated *signed* webhooks — never a stub-only
  interface, never invented/faked real provider credentials; (2) every sub-phase (5A, 5B, …) is
  checkpointed individually with the user before the next one starts; (3) single default currency
  (`USD`, `src/config/billing.ts`) only, tax/fee support is optional and off unless a future phase
  adds real configuration — never a fabricated rate.
  adds real configuration — never a fabricated rate.
- **Schema (`database/migrations/0014`–`0017`, all additive, no change to any Phase 1–4 table):**
  - `0014` — `carts` (`user_id` FK `ON DELETE CASCADE`; unique index on `user_id` — exactly one
    cart per customer, enabling an atomic get-or-create upsert).
  - `0015` — `cart_items` (`plan_id` only — no redundant `product_id`, so it can never drift out of
    sync with the plan's real product; `billing_period` `CHECK`; `quantity` `CHECK` `1..20`; unique
    on `(cart_id, plan_id, billing_period)` so re-adding increases quantity instead of duplicating
    a line). No price column at all — cart pricing is always resolved live, never cached.
  - `0016` — `orders`, the first genuinely financial table in the platform: `order_number` is
    generated **by the database itself** from a new `order_number_seq` sequence
    (`'CH-' || lpad(nextval(...)::text, 8, '0')`) — atomic and race-free under concurrent
    checkouts, never client- or app-generated; `user_id` is `ON DELETE RESTRICT` (not `CASCADE`) so
    an account with order history can never be deleted; `status`/`payment_status` are separate
    columns with their own `CHECK` enums; every amount column has a non-negative `CHECK`.
  - `0017` — `order_items`, an immutable price **snapshot** per line
    (`product_name_snapshot`/`plan_name_snapshot`/`unit_price_amount`/`currency`/
    `line_total_amount`, copied once at checkout and never recalculated); `product_id`/`plan_id`
    are optional soft links `ON DELETE SET NULL` so a later catalog rename/price-change/deletion
    can never alter a historical order (proved by tests — see below).
- **Transactional integrity (new, foundational for the rest of Phase 5):** discovered that the
  existing `Queryable` interface had no real transaction support, and that naively calling
  `pool.query('BEGIN')` followed by more `pool.query()` calls against a real `pg.Pool` would
  **not** be a genuine transaction (each call can be handed a different pooled connection — a
  well-known node-postgres pitfall). Added `src/db/transaction.ts`'s `withTransaction(pool, fn)`,
  which checks out one dedicated client via `pool.connect()` in production (real
  `BEGIN`/`COMMIT`/`ROLLBACK` on that single client, always released in `finally`) or uses
  `@electric-sql/pglite`'s native `.transaction()` API in tests. `checkoutCart` runs the price
  re-read, the `orders`/`order_items` insert, and clearing the cart **inside one call to this
  helper** — closing a check-then-act (TOCTOU) gap between reading a price and writing the order,
  and guaranteeing a rejected checkout (empty cart, unavailable line) leaves the cart completely
  untouched. This helper is designed to be reused for 5D's webhook-idempotency + payment +
  order-status atomicity.
- **Exact-money arithmetic (new):** `src/lib/money.ts` (`toCents`/`fromCents`/`multiplyCents`/
  `sumCents`) is the only place any monetary string from the database is ever turned into a number
  — always as a whole integer number of cents, never a native float — consistent with the existing
  "numeric columns come back as strings" convention (`src/db/catalog-pricing.ts`). No commerce code
  does `+`/`-`/`*` on a decimal money string directly.
- **Repository/service/DTO/route layering (same shape as Phase 3's catalog layer and Phase 4's
  account layer):** `src/db/carts.ts`, `src/db/orders.ts` (raw CRUD) → `src/services/
  commerce-service.ts` (the *only* code allowed to decide what a cart line or order costs; reuses
  Phase 3's `findPlanById`/`findProductById`/`listPublishedPricingForPlan` for add-to-cart and
  checkout validation) → `src/dto/commerce.ts` (response shaping, never leaks an internal field or
  a client-supplied price) → `src/routes/commerce.ts` (`/api/v1/cart*`, `/api/v1/orders*`, wired
  into `src/app.ts`'s existing single shared route-registration context).
- **Price-integrity rules enforced server-side, never trusting the client:** no request body field
  for price/subtotal/tax/discount/total/currency is ever read or validated against — a client can
  only say *what* it wants (`planId` + `billingPeriod` + `quantity`); adding to cart requires the
  plan `active`, its product `active`+`public`, and a currently-`published` price for that exact
  cadence in the platform's one currency; checkout re-validates all of this fresh, inside the
  transaction, immediately before writing the order — never from cart-add-time data. An
  unavailable/inactive line is surfaced honestly (`priceUnavailable`/`hasUnavailableItems` in the
  cart response, excluded from the subtotal) rather than silently dropped or approximated, and
  blocks checkout outright (`400`, listing the affected plan names, no partial order created).
- **Ownership isolation:** identical pattern to Phase 4 — every cart-item/order query is scoped to
  the caller's own `userId`; a record that exists but belongs to someone else is never
  distinguishable from one that doesn't exist — both `404`, never `403` (proved adversarially with
  two real accounts, including a persisted-state check that a cross-customer mutation attempt never
  took effect).
- **No route anywhere can mark an order paid in this phase** — `payment_status` starts at
  `'unpaid'` and there is no code path that changes it yet (payments/webhooks are 5C/5D). No admin/
  staff order-viewing route exists yet (5F).
- **Testing:**
  - `tests/integration/commerce-schema.test.ts` (16 tests) — DB-level: one-cart-per-user upsert,
    `cart_items` quantity `CHECK` (0 and 21 both rejected), upsert-increases-quantity-not-rows,
    live-price join returning `null` honestly when no published price exists for a currency/period,
    remove/clear operations, ownership-join helper, sequential/unique/zero-padded order numbers via
    the DB sequence, negative-amount and invalid-enum rejection on `orders`, a full
    `createOrder`+snapshot test that changes the catalog name/price *after* the order exists and
    asserts the order is untouched, `ON DELETE SET NULL` behavior when the underlying catalog rows
    are deleted, `ON DELETE RESTRICT` proving a user with an order can't be deleted, and
    `withTransaction`'s commit-on-success/rollback-on-throw/unsupported-handle-error paths, plus
    the money-helper round-trip and non-finite-input rejection.
  - `tests/integration/commerce-api.test.ts` (12 tests) — full API end-to-end: unauthenticated
    rejection on every route, empty-cart shape, server-computed subtotal from the live price,
    a direct price/currency/subtotal-manipulation attempt in the request body proven to have zero
    effect, rejection of a plan with no published price for the requested cadence, rejection of an
    inactive-plan/private-product add (both `404`, no existence leak), 404-not-403 ownership
    isolation on both cart items and orders (with a persisted-state check), empty-cart checkout
    rejection, a full checkout proving the order/cart-clearing/price-permanence chain (including a
    post-checkout catalog price change that the placed order is proven immune to), a
    race-condition test where a line is disabled between add-to-cart and checkout (checkout
    rejected, **zero** orders created, cart left intact), and out-of-range quantity rejection on
    both add and update.
  - `tests/integration/migrate.test.ts` — extended to cover all 17 migrations.
  - **Full suite: 193/193 tests passing across 29 test files**, via a clean backend typecheck
    (`tsc --noEmit`) and `npx vitest run` (backend + frontend). All integration tests run against a
    real embedded Postgres engine (pglite), migrated with the actual committed SQL files — not
    mocks. No frontend changes were needed this sub-phase (backend-only, per the locked cadence).
- **API contract documentation:** `docs/API_COMMERCE.md` — architecture diagram, full data-model
  summary, the money-handling and transactional-integrity rationale, the authorization/ownership
  matrix, every price-integrity rule, and every endpoint's exact request/response shape, written
  directly against the actual route/service/DTO code.
- **cPanel staging verification: still BLOCKED / UNVERIFIED** — unchanged reason as every prior
  phase. This sub-phase adds no new npm dependency (transaction/money helpers are hand-written,
  no library added) and no cPanel-incompatible dependency.
- **Explicit checkpoint:** per the locked "checkpoint after every sub-phase" cadence, this is the
  end of Phase 5A. Phase 5B (billing foundation: invoices → ledger → payment records) has not been
  started and will not begin until the user reviews and approves this sub-phase.
- **Intentionally not implemented in this sub-phase (deferred to later Phase 5 sub-phases, per the
  authorized scope):** payments, payment gateways (manual/offline and sandbox), webhooks, invoices,
  a billing ledger, refunds, billing emails, admin/staff order or payment management, an audit
  trail beyond what Phase 1–4 already provide, tax/discount configuration, multi-currency support.

## Phase 5B — Billing foundation (invoices → ledger → payment records) — ACCEPTED

- **Status:** **ACCEPTED** by the repository owner on 2026-09-29.
  - **Scope Accepted**: Originally authorized financial invariants **B1–B4** (B1 currency parity, B2 owner parity, B3 ledger owner/currency parity, B4 payment ceiling guard).
  - **B5 Scope Clarification**: **B5 — Additional identified financial invariant / defense-in-depth control — implemented and verified, but added after the original B1–B4 authorization.** (Preserved and verified in `d01aa67` & `migration-0023.test.ts`).
  - **Migration 0023**: Accepted as a **prepared and tested migration artifact**. **NOT authorized for production execution**; do not run against any production database until separately authorized.
- **Verification Evidence Accepted**: Database-level enforcement, application enforcement, direct SQL tests, concurrency tests, populated-schema tests, rollback testing, and migration integrity evidence. Full suite 35/35 test files, 310/310 tests.
- **Scope (explicitly authorized, second of the seven user-approved Phase 5 sub-phases):** real
  invoices, issued atomically at checkout alongside the Phase 5A order; an append-only, immutable
  billing ledger; and the `payments` table schema/repository laid down as groundwork for Phase 5C's
  gateway abstraction. Explicitly **not** a working payment gateway, webhooks, refunds, billing
  emails, admin/staff billing management, or customer billing UI wiring (all deferred to 5C–5G).
  Started from accepted Phase 5A commit `3033349`.
- **Schema (`database/migrations/0018`–`0020`, all additive, no change to any Phase 1–5A table):**
  - `0018` — `invoices`: one per order (`order_id` `UNIQUE`) — no recurring/subscription billing
    yet; `invoice_number` generated by the database itself from a new `invoice_number_seq`
    (`'INV-' || lpad(nextval(...)::text, 8, '0')`), the same proven race-free pattern as
    `orders.order_number`; `subtotal_amount`/`discount_amount`/`tax_amount`/`total_amount` are a
    snapshot copied from the order at issue time, not a live join; `due_date` defaults to the issue
    date (due on receipt) — no payment-terms configuration system exists, and none was invented;
    `order_id`/`user_id` both `ON DELETE RESTRICT`.
  - `0019` — `billing_ledger`: the append-only financial audit trail the Phase 5 spec calls for
    explicitly. `entry_type` `CHECK IN ('charge','payment','refund','credit')`; Phase 5B only ever
    inserts `charge` entries. **Enforced insert-only at the database level** via `BEFORE
    UPDATE`/`BEFORE DELETE` triggers that raise an exception on any mutation attempt — a stronger,
    DB-level guarantee than the "no route exposes a mutation" convention used elsewhere in this
    codebase, specifically because this table is the audit trail the spec names. Verified with a
    real embedded Postgres engine (pglite is genuine PL/pgSQL-capable Postgres under WASM — spot
    checked directly before committing to this design), including that the trigger correctly
    rolls back a mutation attempted from *inside* a transaction without corrupting other writes in
    that same transaction.
  - `0020` — `payments`: the real payment lifecycle the spec calls for
    (`pending`/`successful`/`failed`/`cancelled`/`expired`/`refunded`/`partially_refunded`), plus a
    partial unique index on `(provider, provider_reference)` that is the exact idempotency
    guarantee Phase 5D's webhook handling will depend on. **No route or service anywhere calls
    `createPayment` as of this phase** — proven by a test that greps every file in `src/routes/`
    for the literal string and asserts it is absent. Building this schema now, ahead of the
    gateway work, lets 5C build directly on a reviewed, stable table instead of redesigning it
    under time pressure.
- **Checkout now issues a real invoice atomically (extends Phase 5A, no behavior change to the
  order itself):** `checkoutCart` (`src/services/commerce-service.ts`) now also calls the new
  `issueInvoiceForOrder` (`src/services/billing-service.ts`) **inside the same `withTransaction`
  call** as the order/order_items insert and the cart clear — the order, its items, its invoice,
  and that invoice's opening `charge` ledger entry are one atomic unit; none can exist without the
  others. `orders.ts`'s `findOrderById`/`listOrdersForUser` were extended with a `LEFT JOIN` to
  surface each order's `invoiceId`/`invoiceNumber` directly, so every existing Phase 5A order
  endpoint (`POST /api/v1/orders`, `GET /api/v1/orders`, `GET /api/v1/orders/:id`) now also returns
  its invoice reference with zero new client-facing routes required for that link.
- **Repository/service/DTO/route layering (same shape as every prior phase):** `src/db/invoices.ts`,
  `src/db/billing-ledger.ts`, `src/db/payments.ts` (raw CRUD) → `src/services/billing-service.ts`
  (the only code that issues an invoice or records a ledger entry) → `src/dto/billing.ts` (response
  shaping, reuses Phase 5A's `toOrderItemDTO` for invoice line items rather than duplicating it) →
  `src/routes/billing.ts` (`/api/v1/invoices*`, wired into `src/app.ts`'s existing shared route
  context).
- **No client-controlled financial state, ever, extended to this layer too:** there is no
  `POST`/`PATCH`/`DELETE` route for invoices or ledger entries anywhere — an invoice is only ever
  produced as a side effect of a real checkout, never directly created or edited by any request.
- **Ownership isolation:** identical pattern to every prior phase — every invoice query is scoped
  to the caller's own `user_id`; an invoice that exists but belongs to someone else is never
  distinguishable from one that doesn't exist — both `404`, never `403` (proved adversarially with
  two real accounts).
- **No route anywhere can mark an invoice paid in this phase** — `status` starts and stays
  `'unpaid'`; there is no code path that changes it (Phase 5D's verified-webhook processing is the
  only thing ever allowed to). No admin/staff invoice-viewing route exists yet (5F).
- **Testing:**
  - `tests/integration/billing-schema.test.ts` (16 tests) — DB-level: sequential/unique/zero-padded
    invoice numbers via the DB sequence, one-invoice-per-order uniqueness, invalid-status and
    negative-amount rejection, `ON DELETE RESTRICT` on both `orders`/`users` and on `invoices` (once
    it has ledger entries or a payment), invoice lookup joined with its order number, ledger
    entry recording/listing, ledger `entry_type`/amount `CHECK` enforcement, **the append-only
    trigger rejecting a raw `UPDATE`/`DELETE` both standalone and inside a transaction (row proven
    unchanged afterward)**, `payments` default-`pending` creation and status/amount `CHECK`
    enforcement, the `(provider, provider_reference)` idempotency unique index (including that a
    second `NULL`-reference payment is still allowed), `updatePaymentStatus` transitions, and the
    grep-based proof that no route file references `createPayment`.
  - `tests/integration/billing-api.test.ts` (6 tests) — full API end-to-end: unauthenticated
    rejection, a real checkout proven to atomically produce an invoice with a matching `charge`
    ledger entry (checked all the way down to the raw `invoices.user_id` row), empty invoice list
    for a customer who never checked out, 404-not-403 ownership isolation on another customer's
    invoice, multiple checkouts each producing their own distinct invoice, and malformed-id
    rejection.
  - `tests/integration/migrate.test.ts` — extended to cover all 20 migrations.
  - **Full suite: 215/215 tests passing across 31 test files**, via a clean backend typecheck
    (`tsc --noEmit`) and a clean production build (`npm run build`). All integration tests run
    against a real embedded Postgres engine (pglite), migrated with the actual committed SQL
    files — not mocks. No frontend changes were needed this sub-phase (backend-only, per the
    locked cadence).
- **API contract documentation:** `docs/API_BILLING.md` — architecture diagram, full data-model
  summary (including the append-only-trigger rationale), the checkout-issues-invoice-atomically
  contract, the authorization/ownership matrix, and every endpoint's exact request/response shape,
  written directly against the actual route/service/DTO code.
- **cPanel staging verification: still BLOCKED / UNVERIFIED** — unchanged reason as every prior
  phase. This sub-phase adds no new npm dependency and no cPanel-incompatible dependency; the
  append-only trigger uses only standard PL/pgSQL, already exercised successfully against pglite's
  real embedded Postgres engine.
- **Explicit checkpoint:** per the locked "checkpoint after every sub-phase" cadence, this is the
  end of Phase 5B. Phase 5C (payment integration: gateway abstraction → checkout → payment
  initiation) has not been started and will not begin until the user reviews and approves this
  sub-phase.
- **Intentionally not implemented in this sub-phase (deferred to later Phase 5 sub-phases, per the
  authorized scope):** a working payment gateway (manual/offline and sandbox), payment initiation,
  webhooks, refunds, credits actually being issued, billing emails, admin/staff invoice or payment
  management, customer-facing billing UI, tax/discount configuration, multi-currency support.

## Phase 5C — Payment integration (gateway abstraction → manual + sandbox gateways → payment initiation) — ACCEPTED

- **Status:** **ACCEPTED** by the repository owner on 2026-09-29 within its implemented scope.
  - **Scope Accepted**: Manual/offline payment flow, sandbox payment gateway abstraction, server-authoritative payment amounts, customer/browser cannot mark an order or invoice paid, staff-only manual confirmation, atomic payment confirmation, exactly one successful transition under concurrent confirmation, exactly one corresponding ledger entry, deterministic replay/conflict handling, audit record identifying the authorized staff actor, unauthorized HTTP requests cannot mutate financial state, 39/39 authorization probe matrix, 49/49 financial-state sweep, and concurrency protections.
  - **Important Phase 5C Boundary & Freeze**: External payment-provider webhook processing is **NOT** accepted and remains **FROZEN**.
    - No external webhook receiver.
    - No `/api/v1/webhooks/:gateway` activation.
    - No asynchronous external-provider payment transitions.
    - No live Stripe/PayPal/Paystack credentials or live external gateway activation.
    - No Phase 5D work.
  - **PR State**: PR #12 remains **OPEN and UNMERGED**.
  - **Production State**: Production deployment and production migration execution are **NOT AUTHORIZED**.
- **Verification Evidence Accepted**: 22/22 payment API integration tests, 39/39 HTTP auth probes, 49/49 financial invariant sweep, deterministic forced-interleaving proof, 6x5 concurrency burst tests.
- **Scope (explicitly authorized, third of the seven user-approved Phase 5 sub-phases; user
  approved proceeding via "CONTINUE" after reviewing the 5B checkpoint):** a payment gateway
  abstraction; a manual/offline gateway (staff record bank-transfer/cash payments) with its own
  staff-confirmation resolution path; a self-contained sandbox gateway with simulated signed
  webhook groundwork. Deliberately stops at **payment initiation** — actually receiving and
  verifying a webhook is Phase 5D's job, not this one's. Started from accepted Phase 5B commit
  `9361062`.
- **Schema (`database/migrations/0021`–`0022`, additive, no change to any Phase 1–5B table):**
  - `0021` — adds `payments.confirmed_by_user_id` (`uuid NULL REFERENCES users(id) ON DELETE SET
    NULL`). Records which staff member confirmed/rejected a manual payment — the manual gateway's
    equivalent of a webhook's provider signature: what makes a state transition attributable and
    auditable rather than an unexplained status flip. `ON DELETE SET NULL` so deleting the staff
    account later never blocks the delete or corrupts the payment record.
  - `0022` — widens `auth_audit_log.event_type`'s `CHECK` (same drop/re-add pattern as `0013`) to
    add `payment_initiated`, `manual_payment_confirmed`, `manual_payment_rejected` — continuing the
    "one shared audit trail across phases" pattern rather than a new table per phase.
- **Gateway abstraction (`src/payments/*`), new this phase:**
  - `types.ts` — the `PaymentGateway` interface. `initiatePayment` only ever returns "here are the
    details of a now-pending attempt," never "whether it succeeded" — every real gateway confirms
    asynchronously (redirect/webhook/human), so the interface is honest about that instead of
    baking synchronous success into its shape.
  - `manual-gateway.ts` (`id='manual'`) — `providerReference` always `null` (no external system),
    `method='bank_transfer'`, instructions from the new `MANUAL_PAYMENT_INSTRUCTIONS` env var or an
    honest generic fallback if unset — **never a fabricated bank account number**.
  - `sandbox-gateway.ts` (`id='sandbox'`) — generates a unique `sandbox_<hex>` provider reference
    per call, `method='sandbox_demo'`, plus `buildSignedWebhookPayload()` — Phase 5D groundwork
    only, not wired to any route.
  - `webhook-signing.ts` — generic HMAC-SHA256 `signPayload`/`verifySignature` (timing-safe via
    `crypto.timingSafeEqual`), pure crypto with zero DB/route knowledge, reusable by Phase 5D's
    webhook receiver.
  - `gateway-registry.ts` — `getGateway(id, env)` resolves `'manual'`/`'sandbox'` or throws a `400`;
    `AVAILABLE_GATEWAY_IDS` kept in the same module as the registry so the two can never drift.
- **New environment variables (both optional, both validated with no fabricated fallback secret):**
  `MANUAL_PAYMENT_INSTRUCTIONS` (free-text; generic honest fallback if unset) and
  `SANDBOX_GATEWAY_WEBHOOK_SECRET` (`min(16)`; only ever required at the point the sandbox gateway's
  signing capability is actually invoked, not at process startup, so a deployment that never
  exercises the sandbox gateway is never forced to configure it).
- **Service layer (`src/services/payment-service.ts`, new this phase):**
  `initiatePaymentForInvoice` — 404 if the invoice isn't owned/found, 400 if it isn't `unpaid`,
  transactionally cancels any other still-`pending` attempt for that invoice then creates the new
  `payments` row via the chosen gateway, logs `payment_initiated`.
  `confirmManualPayment`/`rejectManualPayment` — both refuse (400) anything but a
  `provider==='manual'`, `status==='pending'` payment (404 if the payment doesn't exist at all).
  Confirming atomically: marks the payment `successful` + `confirmed_by_user_id`, records a
  `payment` ledger entry, marks the invoice `paid`, marks the order's `payment_status` `paid`
  (**the order's own fulfillment `status` is deliberately left untouched** — preserving the
  Phase 5A/5B separation between order lifecycle and payment status) — logs
  `manual_payment_confirmed`. Rejecting: marks the payment `failed` with a reason, records **no**
  ledger entry (nothing was actually charged), leaves the invoice `unpaid` — logs
  `manual_payment_rejected`. `getMyPaymentDetail` — same ownership-scoped 404 pattern as every other
  read in this codebase.
- **Routes (new this phase, wired into `src/app.ts`'s existing shared route context):**
  `src/routes/payments.ts` — `POST /api/v1/invoices/:id/payments` (customer, body
  `{gateway:'manual'|'sandbox'}`), `GET /api/v1/payments/:id` (customer, ownership-checked).
  `src/routes/admin-billing.ts` — `POST /api/v1/admin/payments/:id/confirm-manual` and
  `POST /api/v1/admin/payments/:id/reject-manual` (body `{reason}`), both gated to `admin` **and**
  `super_admin` (not `super_admin`-only) — confirming/rejecting a manual payment is routine billing
  support work, the staff equivalent of a webhook arriving, not an account-integrity action;
  mirrors the same `admin`+`super_admin` split already used for routine customer support in
  `src/routes/admin-customers.ts`. **This is deliberately narrow** — two single-purpose endpoints
  for resolving a `manual` payment only, **not** the broader Phase 5F admin billing dashboard
  (search/filter/view-all-invoices, refunds), which remains fully out of scope for 5C. Flagging this
  boundary explicitly per the checkpoint cadence, in case the user intended something broader.
- **Invoice detail extended, no breaking change:** `getMyInvoiceDetail`
  (`src/services/billing-service.ts`) now also returns `payments` (every attempt for that invoice,
  oldest first, including cancelled/failed ones) — `src/dto/billing.ts`'s `InvoiceDetailDTO` gained
  one new field; every existing field is unchanged.
- **The specific "5C stops at initiation" guarantee, proved, not just asserted:** `updatePaymentStatus`
  (the only function in the codebase capable of changing a payment's status) is defined in
  `src/db/payments.ts` and has **exactly one caller anywhere** —
  `src/services/payment-service.ts` — and every call site there is preceded by a guard requiring
  `provider === 'manual'`. `tests/integration/payments-api.test.ts` includes a static/grep-based
  test asserting both of these facts directly against the committed source files (not just
  behaviorally), specifically so a future edit "helpfully" auto-completing sandbox payments (e.g.
  to make a demo look nicer) would be caught immediately.
- **Testing:**
  - `tests/integration/payments-schema.test.ts` (19 tests) — DB-level: `confirmed_by_user_id`
    default-null/set/`COALESCE`-preserved-on-later-update/`ON DELETE SET NULL` behavior, the widened
    `auth_audit_log` `CHECK` accepting the three new event types (and still rejecting an unknown
    one), `setOrderPaymentStatus` touching only `payment_status`, `cancelOtherPendingPayments`
    scoping correctly to one invoice, the gateway registry resolving both ids and rejecting unknown
    ones, the manual gateway's fallback vs. configured-instructions behavior, the sandbox gateway's
    unique-reference generation and `buildSignedWebhookPayload`'s guards (missing secret,
    non-sandbox payment) and correct signature, and the webhook-signing module's sign/verify
    round-trip, tamper rejection, wrong-secret rejection, and malformed-signature fail-closed
    behavior.
  - `tests/integration/payments-api.test.ts` (17 tests) — full API end-to-end: unauthenticated
    rejection, unknown-gateway rejection, 404-not-403 ownership isolation on initiation and on
    `GET /api/v1/payments/:id`, both gateways' initiation response shapes, the not-unpaid-invoice
    guard, prior-pending-attempt cancellation on re-initiation, admin-route RBAC (401 unauth, 403
    customer, 200 both `admin` and `super_admin`), confirm-manual's full atomic proof (payment +
    ledger + invoice + order + `confirmed_by_user_id` + audit log, all checked against raw rows),
    reject-manual's proof (failed status, no ledger entry, invoice stays unpaid, audit log),
    empty-reason rejection, the manual-only guard rejecting a `sandbox` payment on both admin
    routes, double-confirm/reject-after-confirm rejection, 404 for a nonexistent payment id, and
    the static grep-based "sandbox never leaves pending" proof described above.
  - `tests/integration/migrate.test.ts` — extended to cover all 22 migrations.
  - **Full suite: 251/251 tests passing across 33 test files**, via a clean backend typecheck
    (`tsc --noEmit`) and a clean production build (`npm run build`). All integration tests run
    against a real embedded Postgres engine (pglite), migrated with the actual committed SQL files
    — not mocks. No frontend changes were needed this sub-phase (backend-only, per the locked
    cadence).
- **API contract documentation:** new `docs/API_PAYMENTS.md` — architecture diagram, full
  gateway-abstraction/data-model summary, the new env vars, the authorization matrix, and every
  endpoint's exact request/response shape, written directly against the actual route/service/DTO
  code. `docs/API_BILLING.md` updated in place to point at it and to document the invoice detail
  response's new `payments` field, without altering its own historical Phase 5B record.
- **cPanel staging verification: still BLOCKED / UNVERIFIED** — unchanged reason as every prior
  phase. This sub-phase adds no new npm dependency and no cPanel-incompatible dependency; both new
  migrations use only standard SQL/PL-pgSQL already exercised successfully against pglite's real
  embedded Postgres engine.
- **Explicit checkpoint:** per the locked "checkpoint after every sub-phase" cadence, this is the
  end of Phase 5C. Phase 5D (webhook signature verification → idempotency → reconciliation) has not
  been started and will not begin until the user reviews and approves this sub-phase.
- **Intentionally not implemented in this sub-phase (deferred to later Phase 5 sub-phases, per the
  authorized scope):** any inbound webhook route, automated payment confirmation of any kind (a
  `sandbox` payment cannot resolve itself), refunds/credits, billing emails, the broader admin
  billing dashboard (search/filter/view-all-invoices), customer-facing "Pay now" UI, real external
  payment provider integration, tax/discount configuration, multi-currency support.

---

## Phase 5D — Webhooks & Ingestion Pipeline (Design & Implementation Prototype)

- **Source/local verification:** IMPLEMENTED & TESTED on working branch `arena/01a0eb6e-cloudhost247`.
  - Architecture proposal document: `docs/PROPOSED_SCOPE_WEBHOOK_PIPELINE.md`.
  - Candidate Database Migration: `database/migrations/0024_create_webhook_events.sql` (SHA-256: `b8694deae80340e8a826450d1ab5b800f1c363c2fe540e7986a921f744adbbd7`).
  - Webhook Pipeline: `src/routes/webhooks.ts`, `src/services/webhook-service.ts`, `src/db/webhook-events.ts`.
  - Provider Gateways: `src/payments/stripe-gateway.ts` (HMAC-SHA256, 300s freshness), `src/payments/paypal-gateway.ts` (CRC32, RSA-SHA256, SSRF IP blocking, cert cache), `src/payments/paystack-gateway.ts` (HMAC-SHA512), `src/payments/sandbox-gateway.ts`.
  - Invariant Enforcement: Zero-trust validation (B1 currency parity, B2 owner parity, B4 amount ceiling, B5 order parity), lease takeover crash recovery (60s lease), row-level locks `FOR UPDATE`, append-only billing ledger.
  - Test Suite: `tests/integration/webhooks-api.test.ts` (32/32 integration tests covering all providers, concurrency bursts, replay protection, SSRF rejection, and invariant checks).
- **Production Status:** NOT EXECUTED IN PRODUCTION. PR #12 remains OPEN and UNMERGED. Remote `main` untouched. Zero live credentials configured.

---

## Phase 5E — Customer Billing Portal & Invoices UI

- **Source/local/CI verification:** PASSED on working branch `arena/01a0eb6e-cloudhost247`.
  - Architecture proposal document: `docs/PROPOSED_SCOPE_PHASE_5E_BILLING_PORTAL.md`.
  - Customer Invoice List: `frontend/src/pages/InvoicesPage.tsx` (`/invoices`).
  - Invoice Breakdown & Printable Receipt: `frontend/src/pages/InvoiceDetailPage.tsx` (`/invoices/:id`).
  - Self-Service Payment Initiation Modal: `frontend/src/components/PaymentModal.tsx` (Manual bank transfer instructions & sandbox simulation).
  - Billing Dashboard & Customer Ledger: `frontend/src/pages/BillingPage.tsx` (`/billing`) with real-time balance calculations.
  - Backend Customer Ledger Route: `GET /api/v1/billing/ledger` in `src/routes/billing.ts` & `src/services/billing-service.ts`.
  - Frontend Test Suites: `frontend/tests/unit/invoices-page.test.tsx`, `frontend/tests/unit/invoice-detail-page.test.tsx`, `frontend/tests/unit/payment-modal.test.tsx`, `frontend/tests/unit/billing-page.test.tsx`.
- **Invariants Preserved:** Non-authoritative client status views, integer-cent arithmetic, multi-tenant isolation (404 on unowned records), zero production execution.

---

## Phase 5F — Staff & Admin Billing Management & Financial Operations

- **Source/local/CI verification:** PASSED on working branch `arena/01a0eb6e-cloudhost247`.
  - Architecture proposal document: `docs/PROPOSED_SCOPE_PHASE_5F_ADMIN_BILLING.md`.
  - Database Migration Artifact: `database/migrations/0025_extend_auth_audit_log_for_admin_billing.sql` (widens `orders.payment_status` and extends `auth_audit_log` event types).
  - Staff Invoices Directory: `frontend/src/pages/AdminInvoicesPage.tsx` (`/admin/invoices`) with multi-field search and status filtering.
  - Staff Invoice Management Detail: `frontend/src/pages/AdminInvoiceDetailPage.tsx` (`/admin/invoices/:id`) with line items, ledger trail, and payment attempts.
  - Authorized Staff Refund Flow: `frontend/src/components/AdminRefundModal.tsx` and `POST /api/v1/admin/invoices/:id/refund` enforcing $\sum \text{refunds} \le \sum \text{payments}$.
  - Unpaid Invoice Cancellation: `POST /api/v1/admin/invoices/:id/cancel` cancelling unpaid invoices and active payment attempts.
  - Global Financial Ledger: `frontend/src/pages/AdminLedgerPage.tsx` (`/admin/ledger`) and `GET /api/v1/admin/billing/ledger`.
  - Test Suites: `tests/integration/admin-billing-api.test.ts`, `tests/integration/migration-0025.test.ts`, and frontend unit test suites in `frontend/tests/unit/admin-*.test.tsx`.

---

## Phase 5G — End-to-End Billing Lifecycle & Automated Reconciliation

- **Source/local/CI verification:** PASSED on working branch `arena/01a0eb6e-cloudhost247`.
  - Architecture proposal document: `docs/PROPOSED_SCOPE_PHASE_5G_RECONCILIATION.md`.
  - Automated Financial Reconciliation Engine: `src/services/reconciliation-service.ts` (`runFinancialReconciliation`).
  - Staff Reconciliation Health Endpoint: `GET /api/v1/admin/billing/reconciliation`.
  - Multi-Gateway E2E Lifecycle Suite: `tests/integration/billing-lifecycle-e2e.test.ts` (Order $\to$ Invoice $\to$ Payment $\to$ Settlement $\to$ Customer Ledger $\to$ Admin Review $\to$ Partial & Full Refund Lifecycle $\to$ Invariant Audit).
  - Full Platform Verification: **48 / 48 test files passing (371 / 371 total tests passing)** with 0 vulnerabilities.
- **Production Status:** PREPARED AND TESTED ONLY. PR #12 remains OPEN and UNMERGED. Remote `main` untouched (zero drift).

---

## Phase 6 — App Marketplace, Manifest Catalog & the Deployment Pipeline

- **Source/local/CI verification:** PASSED on working branch `arena/01a0eeb2-cloudhost247` (PR #17, all CI checks green).
  - **Full platform verification: 54 / 54 test files passing (402 / 402 total tests), `tsc` clean, `vite build` clean.**
  - Overview document: `docs/PHASE_6_MARKETPLACE_DEPLOYMENTS.md`; agent operations guide: `docs/SERVER_AGENT.md`.
  - **Manifest catalog (52 applications, 23 categories):** `manifests/<slug>/manifest.yaml`, authored by `tools/build-manifests.py`, validated by zod (`src/marketplace/manifest-schema.ts`). Runtime is 100% DB-driven — no per-app deployment code exists.
  - **Migrations 0026–0040:** applications/versions/categories, installations, deployment queue + steps + events, servers + encrypted credentials + metrics, domain verification, backups, subscriptions, audit logs, platform settings.
  - **Importer:** `src/marketplace/import-service.ts` (+ `scripts/import-catalog.ts`, `npm run catalog:import`); admin validate/import routes; imported apps start `draft` and publish only through the approval workflow (spec §47).
  - **Deployment engine:** `src/deployments/engine.ts` — per-action step pipelines, manifest re-validation, one-retry steps, rollback of completed infra steps, capacity checks, env/secret generation; adapters: docker (via Server Agent), cPanel (WHM/UAPI only), Kubernetes (optional, off by default).
  - **Compose generator:** `src/deployments/compose-generator.ts` — per-customer projects, resource limits, 0600 `.env`, Traefik labels from manifest+domain; `cap_add` support.
  - **Worker:** `src/worker/` — registry of handlers, `FOR UPDATE SKIP LOCKED` claiming, lease expiry recovery, retries with backoff (`npm run worker`).
  - **Provisioning gate:** `src/services/provisioning-service.ts` — money→infrastructure only via verified webhooks; zero-total installs queue the same way; engine re-checks `orders.payment_status`.
  - **Server Agent:** `server-agent/` — zero-dependency Node service; fixed HMAC-signed operation set; the Docker socket never leaves the server; installer with hardened systemd unit.
  - **Platform infrastructure:** `infrastructure/docker/` (compose for API+worker+Postgres+Redis+Traefik, dev overlay, hardened image), `infrastructure/traefik/`, `infrastructure/backups/`.
  - **API:** public marketplace; customer installations/deployments (incl. SSE live console)/domains (real DNS TXT verification)/servers; admin apps workflow + versions, servers registry + rotation, deployments oversight, settings whitelist, audit log; inbound agent API.
  - **Frontend:** marketplace + app detail install wizard, My Apps, instance management (logs/backups/domains/config/deployments), live deployment console, dashboard integration, admin apps/deployments/servers/settings/audit pages.
  - **Tests added:** `tests/unit/manifest-catalog.test.ts`, `tests/integration/marketplace-installations.test.ts`, `tests/integration/worker-deployments.test.ts`, `tests/integration/agent-deployments-api.test.ts`, `tests/integration/domains-servers-admin.test.ts`. These found and fixed two real queue bugs (PG parameter typing in `recordHealthResult`/`failDeployment` that left deployments stuck `running`, and step-row duplication on retry).
  - **Lifecycle coverage:** `tests/integration/provisioning-lifecycle.test.ts` — end-to-end PAID path (checkout → invoice → sandbox webhook (HMAC-verified) → subscription + exactly one install deployment via the idempotent queue, duplicate webhook ignored), subscription dunning sweep (`active → past_due → grace_period → suspended` with a queued STOP deployment, idempotency-keyed `subscription-suspend:<id>:<ts>`), and health-check scheduling (one job per installation per 5-minute bucket, recent-check and circuit-breaker installations skipped, `max_attempts=1`). Schedulers extracted to `src/worker/sweeps.ts` (`scheduleHealthChecks`, `sweepSubscriptions`; settings `subscription.grace_period_days` / `subscription.suspend_after_days`, defaults 7 + 7).
- **Production Status:** PREPARED AND TESTED ONLY. `DEPLOYMENT_SIMULATION_MODE=false` is the default; deployments require registered servers with reachable agents.

---

## Phase 7 — Server OS Catalog & Provider Provisioning

- **Source/local verification:** PASSED on branch `arena/01a0ef49-cloudhost247`.
  - **Full platform verification: 56 / 56 test files passing (412 / 412 tests), backend/frontend TypeScript clean, production server + Vite build clean, and migration 0041 applies/idempotently verifies in the embedded PostgreSQL test engine.**
  - Migration artifact: `cloudhost247-node/database/migrations/0041_create_os_catalog_and_server_provisioning.sql` — normalized OS families/versions/lifecycle/architectures, providers/regions/datacenters, private image mappings, exact product availability, control-panel compatibility, provisioning jobs, SSH keys, notifications, and UNKNOWN backfill for existing servers.
  - Real compute path: verified payment → existing PostgreSQL deployment queue → dedicated compute provisioner → explicit adapter → provider/image/network/SSH/authenticated-agent health → READY/ACTIVE. Create and reinstall use persisted idempotency state; long jobs renew their queue leases.
  - Native provider integration: Hetzner Cloud. Other declared provider types fail closed unless an operator configures a real `generic_http` bridge implementing `docs/SERVER_PROVISIONING.md`; no compute mock is selected by production code.
  - Customer UI/API: dynamic plan/location/OS/version/architecture/SSH key/control-panel order flow, owned server inventory/detail/status/logs/actions, and confirmation-gated queued reinstall.
  - Admin UI/API: OS/version lifecycle, provider/location, image testing/activation, exact availability, jobs/logs/retry/cancel, metrics, and audit events.
  - Tests added: `tests/integration/server-infrastructure.test.ts`, `tests/unit/infrastructure-provider-registry.test.ts`, and `frontend/tests/unit/operating-system-selector.test.tsx`.
- **Production Status:** PREPARED AND LOCALLY TESTED ONLY. Migration 0041 has **NOT** been run against staging or production. No provider credential was configured, no live provider API was called, and no real Ubuntu 24.04 → Debian 13 acceptance run was performed. Live acceptance remains blocked on operator-supplied credentials, real image/location/product mappings, and a published self-contained server-agent installer.

---

## Phase 2 (Control Plane) — Core Infrastructure Abstraction & Provider Adapters

- **Source/local verification:** PASSED on branch `arena/01a0ef49-cloudhost247`.
  - **Full platform verification: 56 / 56 test files passing (418 / 418 tests), backend/frontend TypeScript clean, production server + Vite build clean.**
  - Migration artifact: `cloudhost247-node/database/migrations/0042_expand_infrastructure_providers_and_server_operations.sql` — expands provider types and adapter kinds to include `AWS`, `DIGITALOCEAN`, `VULTR`, `CONTABO`, `OVH`, `HETZNER`, `PROXMOX`, `VIRTUALIZOR`, `SOLUSVM`, `OPENSTACK`, and `GENERIC_HTTP`. Expands deployment actions and provisioning jobs to include `server_resize`, `server_snapshot_create`, `server_snapshot_restore`, and `server_snapshot_delete`.
  - Provider Adapter Architecture: Concrete adapters implemented for Hetzner, DigitalOcean, Vultr, AWS, OVH, Contabo, and Generic HTTP with fail-closed configuration validation (`validateConfiguration()`).
  - Server Operations API: Added customer endpoints `POST /api/v1/servers/:id/resize`, `POST /api/v1/servers/:id/snapshots`, `DELETE /api/v1/servers/:id/snapshots/:snapshotId`, and `POST /api/v1/servers/:id/snapshots/:snapshotId/restore` with SHA-256 bounded idempotency keys.
  - Worker Execution: Asynchronous execution of server resize and snapshot operations via the PostgreSQL-backed deployments queue.

---

## Phase 3 & 4 (Control Plane) — Control Panel Catalog, Commercial Plans, Adapters & Auto-Installer

- **Source/local verification:** PASSED on branch `arena/01a0ef49-cloudhost247`.
  - **Full platform verification: 58 / 58 test files passing (431 / 431 tests), backend/frontend TypeScript clean, production server + Vite build clean.**
  - **Migration artifact:** `cloudhost247-node/database/migrations/0043_create_control_panels_and_plans.sql` — extended `control_panels` with category (`SERVER_PANEL`, `APPLICATION_DEPLOYMENT_PLATFORM`, `SERVER_MANAGEMENT`), hardware requirements (min CPU, RAM, disk), compatible operating systems array, and native capability flags. Created `control_panel_plans` table for commercial licensing tiers, billing cycles, and domain/account quotas. Seeded all 18 requested control panel platforms and their starter plans.
  - **Control Panel Adapter Architecture:** Implemented unified `ControlPanelAdapter` interface and concrete adapters for all 18 platforms: Dokploy, Coolify, CloudPanel, cPanel, Plesk, DirectAdmin, CyberPanel, HestiaCP, FASTPANEL, aaPanel, Easypanel, Cosmos, Cloudron, Webuzo, Webmin, TinyCP, Kusanagi, and AdminBolt.
  - **Auto-Installer Engine:** Implemented `buildServerCloudInitWithControlPanel` in the central adapter registry to synthesize comprehensive Cloud-Init user-data scripts installing both the CloudHost247 monitoring agent and the automated platform setup routine.
  - **REST API:** Implemented Fastify endpoints `/api/v1/control-panels`, `/api/v1/control-panels/:slug`, `/api/v1/control-panel-plans`, and audit-logged administrative endpoints `/api/v1/admin/control-panels` and `/api/v1/admin/control-panel-plans`.
  - **Marketplace & Customer UI:**
    - `/hosting/control-panels` — Filterable marketplace with category tabs (`SERVER_PANEL`, `APPLICATION_DEPLOYMENT_PLATFORM`, `SERVER_MANAGEMENT`), keyword search, license filters (Free vs. Commercial), and pricing cards.
    - `/hosting/control-panels/:slug` — Deep-dive platform specification with system requirements, compatible OS chips, native capabilities checklist, and commercial license plans.
    - `/admin/control-panels` — Staff administration console for platform metadata, system requirements, and commercial license tier builders.
    - `/dashboard/servers/:id` — Enhanced server management dashboard displaying installed control panel cards, direct access links ("Open Panel Dashboard ↗"), default login instructions, snapshot creation, and destructive OS reinstall.
  - **Tests added:** `tests/integration/control-panels-api.test.ts` (7 tests) and `tests/unit/control-panel-adapters.test.ts` (6 tests).

---

## Phase 5 (Control Plane) — Authoritative DNS Management Engine

- **Source/local verification:** PASSED on branch `arena/01a0ef49-cloudhost247`.
  - **Full platform verification: 59 / 59 test files passing (435 / 435 tests), backend/frontend TypeScript clean, production server + Vite build clean.**
  - **Migration artifact:** `cloudhost247-node/database/migrations/0044_create_dns_zones_and_records.sql` — created `dns_zones` and `dns_records` tables with support for authoritative record types (`A`, `AAAA`, `CNAME`, `TXT`, `MX`, `NS`, `SRV`, `CAA`), priority fields, TTL limits, and default CloudHost247 nameservers (`ns1.cloudhost247.com`, `ns2.cloudhost247.com`).
  - **DNS Provider Architecture:** Created `DNSProvider` abstraction (`src/dns/types.ts`) and concrete drivers (`src/dns/providers.ts`) supporting Local Database, Cloudflare API, and AWS Route53 with fail-closed configuration checks.
  - **REST API:** Implemented Fastify routes `/api/v1/dns/zones`, `/api/v1/dns/zones/:zoneId`, and record lifecycle operations `/api/v1/dns/zones/:zoneId/records` with RBAC tenant ownership validation.
  - **Customer Portal UI:** Built DNS Management interface at `/dashboard/dns` and `/account/dns` (`frontend/src/pages/DnsManagementPage.tsx`) allowing zone creation, record additions, inline edits, and deletions.
  - **Tests added:** `tests/integration/dns-api.test.ts` (4 tests).

---

## Phase 6 (Control Plane) — SSL / TLS Certificate Lifecycle & Baseline Network Firewall

- **Source/local verification:** PASSED on branch `arena/01a0ef49-cloudhost247`.
  - **Full platform verification: 60 / 60 test files passing (438 / 438 tests), backend/frontend TypeScript clean, production server + Vite build clean.**
  - **Migration artifacts:**
    - `0045_create_ssl_certificates.sql` — `ssl_certificates` schema with automated state machine (`PENDING`, `VALIDATING`, `ISSUED`, `EXPIRED`, `FAILED`, `REVOKED`), challenge types (`HTTP_01`, `DNS_01`, `MANUAL`), renewal tracking, and certificate/private key storage.
    - `0046_create_firewall_rules.sql` — `firewall_rules` schema for protocol (`TCP`, `UDP`, `ICMP`, `ALL`), port ranges, CIDR source blocks, rule actions (`ALLOW`, `DENY`), and panel profiles.
  - **Persistence & API Layer:**
    - `src/db/ssl.ts` & `src/routes/ssl.ts` — Certificate ordering, ACME issuance, CSR handling, certificate revocation, and automated renewal triggers.
    - `src/db/firewall.ts` & `src/routes/firewall.ts` — Server firewall rule listing, creation, deletion, and dynamic baseline application. Baseline rules derive from the installed control panel's required ports (e.g., cPanel opens 2083/2087, Dokploy opens 3000, Plesk opens 8443) alongside standard SSH (22), HTTP (80), and HTTPS (443).
  - **Customer Portal UI:**
    - `/dashboard/ssl` (`frontend/src/pages/SslManagementPage.tsx`) — SSL certificate overview, new certificate ordering wizard, validation challenge tracker, and auto-renew toggle.
    - `/dashboard/servers/:id` (`frontend/src/pages/ServerDetailPage.tsx`) — Interactive firewall manager tab allowing one-click baseline security application and custom ingress rule configuration.
  - **Tests added:** `tests/integration/ssl-firewall-api.test.ts` (3 tests).
  - **Migration artifact:** `cloudhost247-node/database/migrations/0043_create_control_panels_and_plans.sql` — extended `control_panels` with category (`SERVER_PANEL`, `APPLICATION_DEPLOYMENT_PLATFORM`, `SERVER_MANAGEMENT`), hardware requirements (min CPU, RAM, disk), compatible operating systems array, and native capability flags. Created `control_panel_plans` table for commercial licensing tiers, billing cycles, and domain/account quotas. Seeded all 18 requested control panel platforms and their starter plans.
  - **Control Panel Adapter Architecture:** Implemented unified `ControlPanelAdapter` interface and concrete adapters for all 18 platforms: Dokploy, Coolify, CloudPanel, cPanel, Plesk, DirectAdmin, CyberPanel, HestiaCP, FASTPANEL, aaPanel, Easypanel, Cosmos, Cloudron, Webuzo, Webmin, TinyCP, Kusanagi, and AdminBolt.
  - **Auto-Installer Engine:** Implemented `buildServerCloudInitWithControlPanel` in the central adapter registry to synthesize comprehensive Cloud-Init user-data scripts installing both the CloudHost247 monitoring agent and the automated platform setup routine.
  - **REST API:** Implemented Fastify endpoints `/api/v1/control-panels`, `/api/v1/control-panels/:slug`, `/api/v1/control-panel-plans`, and audit-logged administrative endpoints `/api/v1/admin/control-panels` and `/api/v1/admin/control-panel-plans`.
  - **Marketplace & Customer UI:**
    - `/hosting/control-panels` — Filterable marketplace with category tabs (`SERVER_PANEL`, `APPLICATION_DEPLOYMENT_PLATFORM`, `SERVER_MANAGEMENT`), keyword search, license filters (Free vs. Commercial), and pricing cards.
    - `/hosting/control-panels/:slug` — Deep-dive platform specification with system requirements, compatible OS chips, native capabilities checklist, and commercial license plans.
    - `/admin/control-panels` — Staff administration console for platform metadata, system requirements, and commercial license tier builders.
    - `/dashboard/servers/:id` — Enhanced server management dashboard displaying installed control panel cards, direct access links ("Open Panel Dashboard ↗"), default login instructions, snapshot creation, and destructive OS reinstall.
  - **Tests added:** `tests/integration/control-panels-api.test.ts` (7 tests) and `tests/unit/control-panel-adapters.test.ts` (6 tests).

---

## Phase 7 (continued) — Console access, server templates, and the cancellation lifecycle

- **Source/local verification:** PASSED on branch `arena/01a0f219-cloudhost247`.
  - **Full platform verification: 70 / 70 test files passing (515 / 515 tests), backend and frontend TypeScript clean.**
  - **No migration required:** `provisioning_jobs.operation` already allowed `DELETE` and `deployments.action` already mapped `server_delete`; the gap was that nothing ever requested one.
  - **Serial console:** `POST /api/v1/servers/:id/console` issues a provider console session to the owner only — the single server action answered in request scope, since the credential is only useful in the requesting browser. Ownership 404, capability 400, pre-provision 409, and an unconfigured provider 503 through the new `src/infrastructure/providers/error-mapping.ts`. The session URL/password are never logged, audited or stored; the audit record `SERVER_CONSOLE_OPENED` holds only the server and provider ids.
  - **Server templates:** `server_product_configurations` is named for what it is in the admin UI (`/admin/infrastructure/availability` → "Server templates"), rather than adding a duplicate registry that could disagree with the ordering and reinstall queries. The create form can now grant the `console` capability.
  - **Cancellation and termination:** `POST /api/v1/servers/:id/cancel` with `AT_PERIOD_END` (revocable via `DELETE /api/v1/servers/:id/cancel`, honours the paid term, flags `cancel_at_period_end`) or `IMMEDIATE` (typed `"DELETE"` confirmation, cancels subscriptions, enqueues the `DELETE` job). `sweepScheduledTerminations` runs in the worker every 15 minutes and on demand via `POST /api/v1/admin/server-terminations/sweep`. Destruction always runs through the queue and adapter; the `servers` row is kept as `retired` so orders, invoices and audit history survive; a server that never reached the provider is retired directly rather than faking a provider call. Completion raises a once-only `SERVER_TERMINATED` notification.
  - **Customer UI:** "Open console" action and session panel, plus a danger zone on `/dashboard/servers/:id` offering cancel-at-term or destroy-now with the typed confirmation, a revoke path, and a "Cancels on …" hint on the server list.
  - **Tests added:** `tests/integration/server-console.test.ts` (5), `tests/unit/provider-error-mapping.test.ts` (4), `tests/integration/server-termination.test.ts` (7).

---

## Phase 7 (continued) — Notification email delivery that actually retries

- **Source/local verification:** PASSED on branch `arena/01a0f219-cloudhost247`.
  - **Full platform verification: 71 / 71 test files passing (522 / 522 tests), backend and frontend TypeScript clean.**
  - **Migration artifact:** `cloudhost247-node/database/migrations/0049_notification_outbox_delivery_scheduling.sql` — adds `next_attempt_at` and `max_attempts` to `notification_outbox`, a partial due-row index, and re-arms rows previously parked only because nothing was configured. Additive; existing rows become due immediately.
  - **Decoupled delivery:** `createNotification` in `src/services/notification-service.ts` writes the durable in-app row and queues its email copy; no HTTP happens on the path that is finishing a customer's server. `src/services/notification-outbox-service.ts` drains the queue in the worker every minute, claiming rows by pushing `next_attempt_at` forward so concurrent workers never send the same email twice.
  - **Failure classification:** unconfigured webhook and `401`/`403` park as `CONFIGURATION_REQUIRED` and are retried every 15 minutes without consuming the attempt budget; `408`/`429`/`5xx`/network errors back off 1 → 5 → 15 → 60 → 240 minutes up to `max_attempts`; other `4xx` fail permanently; `2xx` is never re-sent.
  - **Operator visibility:** `GET /api/v1/admin/notification-outbox` and `POST /api/v1/admin/notification-outbox/drain`, surfaced as a "Notification delivery" panel on `/admin/infrastructure/logs` listing every stuck or failed delivery with its reason.
  - **Tests added:** `tests/integration/notification-outbox.test.ts` (7).
