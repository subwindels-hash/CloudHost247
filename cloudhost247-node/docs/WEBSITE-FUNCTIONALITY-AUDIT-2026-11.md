# Website Functionality Audit — 2026-11-07

**Scope.** Every button, link, navigation item, dropdown, tab, form, modal action and
clickable element on the running CloudHost247 website (the Node.js platform in
`cloudhost247-node/`, served on port 3000), audited in three roles — signed-out visitor,
demo customer (`demo@cloudhost247.test`) and demo administrator
(`admin@cloudhost247.test`) — against the real Fastify API and database (embedded
PostgreSQL preview harness, `scripts/tools-preview-server.ts`). The WHMCS/PHP template
surface at the repository root cannot execute in this environment (no PHP/WHMCS
licence) and is out of runtime scope; it contains no links served by this website.

**Method — behaviour, not appearance.**
1. Static source inventory: every `<Link>`, `<a>`, `navigate()`, `<button>` and `<form>`
   in `frontend/src` extracted and classified.
2. Rendered crawl (headless Chromium): breadth-first crawl, 220 pages per role
   (35,507 / 37,837 / 39,141 link instances), capturing hrefs, buttons, forms, console
   errors, page errors and HTTP ≥400 responses.
3. Direct probe: all **345 distinct internal targets** visited under each of the three
   roles (1,035 page loads) and checked for the router 404 page and JS errors.
4. Click probe: 281 distinct buttons across 20 key pages clicked and observed for a
   navigation, DOM change, dialog or API call; every no-effect button individually
   re-inspected with filled forms.
5. End-to-end workflows in the browser against the real API (below), plus API-level
   permission checks with real tokens.

Machine-readable inventory: `docs/website-functionality-audit-2026-11/link-inventory.json`
(259 declared route patterns; 130 distinct internal link targets with sources).
Screenshots: `docs/website-functionality-audit-2026-11/evidence/`.

---

## 1. Inventory (audited interactive elements)

| Category | Count / result |
|---|---|
| Declared SPA route patterns | 259 (189 in `App.tsx` + 55 marketing + 17 legal + parameterised) |
| Distinct internal link targets in source | 130 — **100% resolve to a declared route** (now enforced by unit test) |
| Rendered links crawled (3 roles) | 112,485 instances; **0** `href="#"`, **0** empty hrefs, **0** href-less anchors, **0** `javascript:` hrefs |
| Distinct internal targets probed in browser | 345 × 3 roles — **0** landed on "Page not found", **0** JS page errors |
| Buttons in source | 493 (407 with `onClick`, 66 form submits; the 20 remaining are submit buttons inside `<form onSubmit>` — each manually verified) |
| Buttons click-tested in browser | 281 across 20 pages; 17 initial "no observable effect", all explained & verified (see §3) |
| Forms rendered | 111 (all submit to real API endpoints or are guarded by native validation) |
| External links | **None exist anywhere on the site** — no social-media icons are rendered, so none can be broken. Footer/header contain only internal links, mailto (4) and in-page anchors (443, targets verified present, e.g. `#ch247-top`, `#pricing`, `#main-content`) |
| Modals | Payment modal (invoice), refund modal, AI-support widget — open, submit and cancel paths exercised |

## 2. Broken actions discovered

### 2.1 FIXED — Per-account Tools pages leaked a raw API error to guests
`/tools/history`, `/tools/favorites`, `/tools/reports`, `/tools/monitors` were public
routes backed by bearer-token APIs. A signed-out visitor saw the backend's raw
**"Missing bearer token"** message, plus *Clear history* / *Refresh* buttons that could
only fail — a dead end that looked broken and leaked API internals. The server was never
insecure (it correctly answered 401); the frontend context was wrong.
**Fix:** the four routes are now nested under `<RequireAuth>` in `frontend/src/App.tsx`,
so guests are sent to `/login` with their destination preserved and land back on the
page after signing in (verified live, evidence `02/03`). Signed-in behaviour unchanged.

### 2.2 FIXED — Stale mega-menu regression test asserted a removed DOM contract
`e2e/navigation.spec.ts` selected `.ch247-mega-panel`, a class the header redesign
removed; the test failed on the pristine tree and guarded nothing. The current panels
are `.hg-menu__panel[hidden]` (`display:none !important` in `hostinger-chrome.css`) —
the spec now asserts the same "closed panels are not displayed" contract against the
current markup and passes.

### 2.3 Not bugs (verified, deliberately honest states — left unchanged)
- **Hosting/cloud plan pages** (`/hosting/business`, `/cloud/public`, …) request plans
  for catalogue slugs this demo deployment doesn't carry (API 404) and render
  *"Plan tiers and pricing for this service haven't been added to this platform's live
  catalog yet"* instead of invented prices. Correct by design; publishing products is
  an admin/catalogue operation, not a frontend fix.
- **Domain search / transfer / auctions / appraisal** render **"Service Provider Not
  Configured"**: no registrar provider is configured on this deployment, so no
  availability or prices are shown (see §4).
- Click-probe "no effect" buttons all verified working in context: already-active tabs
  (homepage *Websites*, 3D *Edge & DNS* layer, *My Domains*), form submits clicked with
  intentionally empty required fields (domain *Search*, *Send message*, *Open ticket*,
  *Add domain* — native validation, no fake submission), and account-security actions
  that require the current password first (*Add passkey*, *Set up authenticator app*,
  *Show/Change Security Number*, *Change password* — verified with the password filled;
  the security number displays and rotates via the API). ★ favourite toggles show a
  "please sign in" notice for guests and persist for customers.

## 3. Corrected routes & API integrations

| Element | Before | After |
|---|---|---|
| Tools → Favorites / Saved reports / Monitoring / "Your tool history" (guest) | Raw `Missing bearer token` page | `/login?` with return path → lands back on the requested page |
| Mega-menu closed-panel regression coverage | Failing, asserting removed `.ch247-mega-panel` | Passes against `.hg-menu__panel[hidden]` |

No fake integrations were created. Every action below was verified against the real
backend (order `CH-00000001`, invoice `INV-00000001`, ticket, tool run, profile/MFA APIs):

`Get started/Register → POST /api/auth/register` · `Login → POST /api/auth/login` ·
homepage/pricing **Choose plan → `/cart?product&plan&period`** (context preserved through
login) → `POST /api/v1/cart/catalog-items` → **Place order → `POST /api/v1/orders`** →
invoice link `/invoices/:id` → **Pay Now** opens the payment modal against
`/api/v1/invoices/:id` · **Open ticket → `/api/v1/account/tickets`** · contact
**Send message → `POST /api/v1/contact`** ("Your message has been received") · Tools
**Run → `/api/tools/*`** with results · **Clear history/Refresh/filters** operate on the
account's own history · dashboard/admin links resolve per role.

## 4. Missing backend functionality (documented, not faked)

| Capability | State |
|---|---|
| Domain registrar (search/transfer/auction/appraisal pricing & availability) | Provider not configured — UI says so; requires a Super Admin to configure+test a provider in API & Integrations. No endpoint invented. |
| Live payment gateways | Only the honest gateway states render (sandbox/manual instructions come from server config); no card data is collected or fake-approved by the frontend. |
| Network-backed tools (DNS/ping/traceroute…) | In this sandbox they return typed `DNS_LOOKUP_FAILED`/`TIMEOUT` errors — surfaced honestly, never fabricated results. Pure tools (subnet, JSON, encoding, MRZ…) fully work. |
| Catalogue depth | Only demo products are seeded in the preview DB; production catalogue content is an operator task. |
| Social profiles | The site renders **no** social-media links at all. Adding them requires the company's real profile URLs — not invented here. |

## 5. Security & permissions (verified)

- Customer token → `GET /api/v1/admin/customers` = **HTTP 403** (backend-enforced,
  independent of UI). Customer visiting any `/admin/*` URL renders "Not available";
  admin renders the real consoles. Staff-only sections sit behind `RequireRole`, and
  the server re-verifies role + token revocation per request.
- Signed-out access to account routes redirects to `/login` (83 such redirects observed
  for guests); post-login return destinations are allow-listed local paths only
  (`safeReturnTo` rejects `//evil.example`, backslashes, absolute URLs — unit-tested).
- Destructive actions keep confirmation (e.g. *Clear history* uses `window.confirm`,
  admin refund modal, archive/disable actions are explicit buttons with API `PATCH`).
- No action performs a "fake success": failed cart additions show the API error and do
  not retry on reload; failed support messages stay editable and are not shown as sent
  (covered by `e2e/functionality-audit.spec.ts`).

## 6. Automated tests

**Added by this audit**
- `frontend/tests/unit/link-integrity.test.ts` — every internal target in the source
  resolves to a declared route; placeholder/dead anchors forbidden; the four tools
  account routes stay under `RequireAuth`. **4/4 pass.**
- `e2e/link-integrity.spec.ts` (Playwright, real browser) — no dead links emitted on 10
  key pages; every internal link from them lands on a real page; guest gating for the
  four tools pages incl. return-path preservation; tools shortcut → login; mobile
  Pricing link. **8/8 pass.**
- `e2e/navigation.spec.ts` — repaired to the current header (see §2.2). **1/1 pass.**

**Existing suites re-run**
- `e2e/functionality-audit.spec.ts` (cart→login→order, context preservation, support
  widget, expert requests, builder published links, cart removal): **12/12 pass.**
- Frontend unit suite: **751 passed, 2 failed** — both failures proven pre-existing on
  the pristine tree (`design-system` palette token expectation; `hosting-catalog-page`
  API-expansion expectation) and unrelated to navigation; recorded here, not hidden.
- Backend spot integration (`auth-flow`, `commerce-api` against real migrations):
  **28/28 pass.** Server typecheck (`tsc --noEmit`): clean.
- The full backend Vitest suite (130+ files, per-file embedded-Postgres migrations)
  exceeds this sandbox's practical runtime (still incomplete after ~35 min at full
  CPU); it was run in targeted form above. CI remains the full-suite gate.

**Live browser verification (this deployment, screenshots in `evidence/`)**
13/14 checks pass; the one "failure" was the test's own wrong expectation — logging in
from the `/tools/monitors` gate correctly landed back on `/tools/monitors` instead of
`/dashboard`, i.e. return-context working as designed.

## 7. Evidence

| File | Workflow |
|---|---|
| `evidence/01-homepage.png` | Homepage, header nav, CTAs |
| `evidence/02-guest-tools-history-login-redirect.png` | Fix: guest gated to login |
| `evidence/03-customer-tool-history.png` | Fix: customer reaches history |
| `evidence/04-cart-with-selected-plan.png` | Plan context preserved into cart |
| `evidence/05-order-placed.png` | Order placed via real API |
| `evidence/06-support-ticket-created.png` | Ticket created & listed |
| `evidence/07-tool-run-result.png` | Subnet calculator real result |
| `evidence/08-mobile-navigation.png` | Mobile nav open at 390 px |

Demo data is in-memory and resets with the preview server; accounts:
`demo@cloudhost247.test` / `demo-tools-247`, `admin@cloudhost247.test` / `admin-tools-247`.
