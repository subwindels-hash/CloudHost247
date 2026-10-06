# CLOUDHOST247 Global Platform — Final Implementation Report

**Scope delivered:** the domain / hosting / website-building / AI-website / marketing / domain-investing /
digital-services platform specified in 31 sections, integrated into the existing deployment at
`https://rent.windelsai.com/`.

**Branding:** every new page, menu, dashboard, service, API, database record, email, notification and
piece of SEO metadata says **CLOUDHOST247**. `scripts/branding-audit.py` reports **0** retired-brand
matches across 5,569 text files, and the platform's own test
(`tests/integration/seo-routes.test.ts` → *never publishes any brand name other than CLOUDHOST247*)
asserts that the generated `robots.txt` / `sitemap.xml` cannot contain one either. The deployment
hostname is infrastructure and is unchanged.

**Two deployments, one product.** The repository holds the existing WHMCS tree (PHP/`.tpl`, the live
`rent.windelsai.com` site) **and** the Node/TypeScript platform in `cloudhost247-node/`. Most of the
domain capability the specification asks for (search, bulk search, transfers, the TLD catalogue,
auctions, appraisal, brokerage, the Discount Domain Club, WHOIS/RDAP) already existed in the Node
platform. §27 was followed literally: that code was **inspected, reused and extended** — never
re-implemented — and the new work was built on the same auth, RBAC, audit, notification, commerce,
provider-abstraction and worker infrastructure.

---

## 1. Features added

| Area | What now exists |
| --- | --- |
| **Packaged service plans + cart integration** | `platform_service_plans` (admin-priced, drafted then published) purchasable through the **existing** single cart as service lines: `Product → Cart → Checkout → Payment → Order → Fulfilment`. Prices are resolved server-side from the plan row; the client never sends an amount. |
| **Website Builder** | 14 typed section types (no HTML/script/iframe passthrough), pages/sections editing, 4 first-party templates, custom-domain binding to the customer's existing `customer_domains` row, draft vs **immutable published snapshot**, append-only revisions, forms, SEO fields with length caps, publish/unpublish. |
| **AI Website Builder** | Prompt → structure/pages/sections/copy/CTAs/design direction/SEO metadata/image suggestions, editable afterwards in the Website Builder. Built-in `rules` engine always available; `llm`/`anthropic` engines are fail-closed without credentials. Every generation is ledgered; only `succeeded` rows consume allowance; generated copy never invents testimonials, statistics, clients, awards or prices. |
| **Online Store** | Physical / digital / service products, variants, inventory + stock ledger, orders, discounts, shipping methods, tax rates, refunds, and a digital-delivery system (download tokens with expiry/ceiling, released only by a **signature-verified, idempotent** payment event). Digital lines are never shipped; physical lines require carrier + tracking. |
| **Hire an Expert** | Real request workflow (`requested → scoping → quoted → approved → in_progress → review → delivered → completed`, plus rejected/cancelled/failed), staff quotes, customer approval that creates the **order + invoice for the quoted amount** (never the catalogue “starting price”), messages, timeline, staff queue with assignment. |
| **Managed Digital Marketing** | Campaign engagements with the same lifecycle shape, per-period metric/report recording that **rejects any metric without a source** and reports a source-less period as `unavailable` rather than zeros, channel-connection registry that names the exact env var still missing. |
| **Logo Maker** | Deterministic vector logo engine (escaped SVG; PNG via a native rasterizer), palette/typography/layout/mark catalogue, revisions and restore, separate “select concept”, SVG/PNG export, optional AI palette suggestion that is refused with the missing configuration named when no model provider is connected. |
| **Unified Inbox** | Multi-channel-ready conversation store (channel adapters are data, `not_configured` names its env var), labels, assignment, internal notes that are filtered **in SQL** from customer reads, per-message delivery status that is never upgraded beyond what actually happened, secrets-authenticated and idempotent inbound ingestion. |
| **Public SEO surface** | Server-rendered `GET /sitemap.xml` and `GET /robots.txt` generated from the live navigation definition plus genuinely published content (published builder sites, active stores), host-aware, cached, rate-limited. |
| **Internationalised domains** | Unicode domain names are converted to their ASCII/punycode form once, at normalisation, so search/registration/transfer all speak what DNS and registrars speak (`münchen.de` → `xn--mnchen-3ya.de`). |
| **Platform-aware navigation** | One navigation definition (`src/navigation/mega-menu.ts`) drives the desktop mega menu, the mobile drawer, the footer, the API and the sitemap. 4 sections, 35 links, 6 badges in total (3 POPULAR, 2 NEW, 1 INCLUDED) — deliberately not overused. |

## 2. Existing features upgraded (not duplicated)

- **Unified commerce**: `cart_service_items` + `platform_service_plans` extend the existing
  cart/order/invoice/ledger stack; `provisionPaidOrder` gained one dispatch hook
  (`platform_plan`, `expert_service`, `marketing_plan`) instead of each module inventing its own
  payment listener. Money never leaves `order_items.metadata` (server-set, absent from DTOs).
- **Existing domain services** (`src/domain-services/…`): registration-service now bridges paid
  orders to the registrar queue, multi-domain lines per order are allowed, and IDN handling was added
  to the shared domain-name grammar.
- **Customer dashboard**: the existing `/dashboard` landing page gained a live “Your platform
  services” grid (counts read from each service; a failing service shows *unavailable*, never a fake
  zero) and deep links into builder, AI builder, store, experts, marketing, logo maker, inbox and cart.
- **Header/navigation**: the existing `Header` now renders the platform mega menu (≥1024px) and an
  accessible mobile drawer; the old navigation is untouched at smaller breakpoints.
- **SEO metadata hook** (`usePageMeta`): extended from title/description to canonical, Open Graph,
  Twitter card, robots and JSON-LD — and fixed so it can no longer overwrite a page's own canonical.
- **Static `robots.txt`**: replaced by the generated route; the repository-root copy (PHP tree) now
  also points crawlers at the platform's live sitemap.
- **Env documentation**: 16 variables the code reads were undocumented; all are now in `.env.example`
  with the honest consequence of leaving each one unset.

## 3. Pages created

13 new page modules in `frontend/src/pages/platform/`: `PlatformHubPage`, `BuilderPage` (+ template
gallery), `AiBuilderPage`, `StorePage`, `StorefrontPage`, `PublicSitePage`, `ExpertsPage`,
`MarketingPage`, `LogoMakerPage`, `InboxPage`, `CartPage`, `AdminPlatformServicesPage`,
`AdminUnifiedInboxPage`. Supporting assets: `lib/platform-api.ts`, `components/platform/ui.tsx`,
`components/navigation/PlatformMegaMenu.tsx` (desktop + mobile), `platform.css`, `published-site.css`.
Every page: one `<h1>`, `usePageMeta` (title/description/canonical/JSON-LD where public), loading and
error states, no dead ends.

## 4. Database changes

12 additive migrations, `0071`–`0082`: service cart items + platform plans, website builder,
AI website builder, online store, expert services, digital marketing services, logo maker, unified
inbox, subscription extensions for platform plans, multiple domain lines per order, inbox delivery
status extension, digital-delivery recording. `scripts/validate-migrations.py` passes (ordering,
uniqueness, additive-only, namespace isolation, repeat-execution guards) and `migrate.test.ts` applies
all 82 migrations in order.

## 5. API endpoints / services added

**124 new routes** across 9 new route modules — `builder` (38), `admin-platform-services` (23),
`store` (22), `logo-maker` (13), `inbox` (13), `experts` (7), `marketing-services` (5), `seo` (2),
`navigation` (1) — plus 33 new backend source files in `src/builders/`, `src/commerce/`, `src/experts/`,
`src/inbox/`, `src/logo-maker/`, `src/marketing-services/`, `src/navigation/`, `src/store/`,
`src/lib/media-upload.ts` and `src/lib/transactional-email.ts`. Everything reuses
`authenticate()`/`requireRole()`, zod validation via `parseOrThrow`, `recordAudit`/`auditRequest`,
`createNotification` and the shared worker.

## 6. Admin functionality

Admin control centre routes for: packaged plans (create/publish/price — the only place a price is
authoritative), website-builder site overview, store oversight (overview + per-store), the expert
delivery queue (list, detail, assign, status, quotes, messages), marketing campaigns (list, detail,
status, report periods, metrics, channels with the missing env var named), Unified Inbox staff
surface (conversations, replies, assignment, labels, notes), plus every existing admin area. RBAC:
`staff` for queues, `admin`/`super_admin` for anything that changes pricing or what the public can buy;
all mutations audit-logged.

## 7. Customer dashboard functionality

Dashboard summary grid (above), plus per-service pages: builder sites and templates, AI drafts,
store + merchant orders/fulfilment, storefront, expert requests with quotes/tracking, campaigns with
reports, logo projects with revisions/exports, inbox conversations, and the shared cart/checkout.
Every private route is behind `RequireAuth`; every private API call is ownership-scoped server-side
(foreign resources answer 404, not 403).

## 8. External provider integrations

All external calls sit behind adapters, never inline: registrar/availability/WHOIS adapters
(Namecheap, GoDaddy, RDAP, GoValue — no mock or silent fallback), payment providers (verified,
idempotent webhook settlement), DNS/Cloudflare, transactional email (one transport, statuses
`sent|manual|failed` never upgraded), AI model providers (OpenAI-compatible and Anthropic-shaped),
marketing channel connections, and the media-upload sniffer. Swapping a provider is a credential +
registry change, not a code change.

## 9. Required API credentials / configuration

| Capability | Configuration | Without it |
| --- | --- | --- |
| Domain search / registration / transfer / auctions settlement | Registrar credentials registered in **Admin → Domain Services** (encrypted with `CREDENTIAL_ENCRYPTION_KEY`) | Search returns typed `CONFIGURATION_REQUIRED`; nothing is faked |
| AI website generation, logo palette suggestion | `AI_LLM_BASE_URL`, `AI_LLM_MODEL`, `AI_LLM_API_KEY` (optional `AI_LLM_API_STYLE`, `AI_LLM_TIMEOUT_MS`) | Built-in generator + design catalogue still work; the AI request is refused naming these variables |
| Email delivery | `NOTIFICATION_EMAIL_WEBHOOK_URL`, `NOTIFICATION_EMAIL_WEBHOOK_TOKEN` | Messages queue visibly; the platform never claims delivery |
| Inbound inbox channels | `INBOX_INBOUND_WEBHOOK_SECRET` | `POST /api/v1/inbox/inbound` answers 503 naming the variable |
| Card/wallet settlement | `STRIPE_WEBHOOK_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYSTACK_SECRET_KEY`, `SANDBOX_GATEWAY_WEBHOOK_SECRET` | Orders settle through the existing manual/invoice flow; store payment mode stays `order_intake` |
| Manual payment copy | `MANUAL_PAYMENT_INSTRUCTIONS` | The instruction block is omitted |
| DNS/CDN automation | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_BASE_URL` | DNS changes stay manual; the UI says so |
| Metadata base outside a browser | `VITE_SITE_URL` (optional) | Canonical/OG URLs stay root-relative; in the browser the deployed origin is always used |
| Runtime | `APP_URL`, `DATABASE_URL`, `JWT_SECRET`, `PORT` | — |

## 10. Security changes

Authentication + authorization on every private route; 404 (not 403) for foreign resources;
server-side price authority (client amounts ignored); signature-verified, idempotent payment events as
the only path to `paid`; one-shot transactions for checkout/provisioning (no partially written
orders); digital delivery only via paid-order tokens with expiry and download ceilings; upload sniffing
by magic bytes with declared-type agreement; HTML/script/iframe rejected in builder content; form
submissions validated per field and rate-limited; per-route rate limits on public/expensive endpoints;
audit rows on every mutation; internal inbox notes filtered in SQL; no secrets or stack traces in
responses (pinned by existing tests).

## 11. SEO changes

Server-rendered, host-aware `sitemap.xml` (navigation + published sites + active stores, deduplicated,
`lastmod`, XML-escaped, cached 10 min) and `robots.txt` (private areas closed, sitemap advertised,
cached 1 h). Per-page canonical/OG/Twitter/robots/JSON-LD via `usePageMeta`; public pages carry
structured data (`WebSite`, `SoftwareApplication`, `Product`, `Organization`); clean URLs;
heading hierarchy with a single `<h1>` per page; accessible navigation (keyboard, focus management,
`aria-*`, 44px+ touch targets, no horizontal overflow); retired-brand string check included in the
test suite.

## 12. Tests performed

New/extended automated tests:

- `tests/integration/platform-services-api.test.ts` — **13/13 pass**: navigation integrity, plan
  draft→published, cart→order bridge, immutable publish snapshot + unpublish 404, public form →
  owner's inbox, digital sale + verified-payment release, digital-not-shippable / physical tracking
  rules, quoted-amount billing + double-approve 409, source-less metric rejection, logo generation/
  revisions/export (SVG + PNG magic bytes), inbound idempotency + note visibility, RBAC boundaries.
- `tests/integration/seo-routes.test.ts` — **4/4 pass**: sitemap completeness and dedupe, published-only
  dynamic entries following the deployed host, robots disallow list + sitemap line, retired-brand check.
- `tests/unit/domain-name-grammar.test.ts` — **8/8 pass** (2 new IDN cases).
- Pre-existing domain-services, commerce, notification and provider suites re-run.

Live audit against a running instance (real `buildApp` on PGlite):
**237 registered GET routes and 286 registered mutating routes exercised**; every one answered without
an unhandled error. The only two non-200s are deliberate honesty responses: `/ready` → 503 (no
production PostgreSQL in the harness) and `POST /api/v1/inbox/inbound` → 503 naming
`INBOX_INBOUND_WEBHOOK_SECRET`. All 25 SPA routes (`/domains/*`, `/websites/*`, `/marketing/*`,
`/cart`, `/dashboard/domains`, `/admin/platform-services`, `/sites/:slug`, `/store/:slug`) return the app.
Type checks: `tsc -p tsconfig.json --noEmit` and `tsc -p frontend/tsconfig.json --noEmit` both clean.
`scripts/branding-audit.py`: PASS (0 matches). `scripts/validate-migrations.py`: PASS.

### Defects found by the audit and fixed

| # | Defect | Fix |
| --- | --- | --- |
| 1 | `GET /api/v1/admin/expert-services/requests/:id` returned 500 (`users.company` does not exist) | select only real columns |
| 2 | Menu fetch used the authenticated wrapper, so a 401 on the **public** navigation endpoint cleared the customer's session | anonymous fetch for the navigation document |
| 3 | A page's own canonical (Tools Center) was overwritten by the metadata hook | canonical resolution keeps a deeper declaration |
| 4 | Menu skeleton added a second `role="status"` region, breaking status queries for assistive tech | decorative, `aria-hidden` skeleton |
| 5 | `fulfilOrderItem` could not run on a driver that deduces parameter types strictly (`$2` text/varchar) | explicit `::varchar` casts |
| 6 | AI apply could never succeed: the generation DTO exposed `generationId`, the apply route needs the id | DTO returns `id` |
| 7 | Generated `robots.txt` route collided with a stale static file, so the app failed to boot with the SPA served | static copies removed; the generated route is authoritative |
| 8 | `usePageMeta` hard-coded a retired-brand hostname | origin comes from the browser; `VITE_SITE_URL` only for tooling |
| 9 | Merchant order detail typed its lines with an inline conditional-type hack | named `StoreOrderLine` DTO |
| 10 | 16 environment variables were read by code but undocumented | documented in `.env.example` with consequences |
| 11 | Preview harness passed a non-transactional handle to the app, so transactional routes failed there | harness passes the transactional handle (tests already did) |
| 12 | Unicode domains were rejected outright | IDN → punycode at normalisation, with tests |

## 13. Build results

`npm run build:frontend` (Vite 6): **success** — the SPA, including every platform page, is emitted to
`public/assets` (largest page chunk 31 kB, entry 246 kB / 77 kB gzip). TypeScript server build
(`build:server`) is clean, and both `tsc -p tsconfig.json --noEmit` and
`tsc -p frontend/tsconfig.json --noEmit` report no errors. `scripts/validate-migrations.py` PASS.
`scripts/branding-audit.py` PASS (0 retired-brand matches in 5,569 text files).

**Full suite** (`npx vitest run`): **134 test files passed, 1,289 tests passed, 0 failures,
exit code 0**, in 1,287 s. (An earlier run flagged `tests/unit/spa-routing.test.ts`, which still
simulated a `robots.txt` inside the static build output — the very file whose removal fixed the route
collision. That test now asserts the stronger contract: `/favicon.svg` still comes from the static
build, and `/robots.txt` is a generated, non-HTML document. The green run above is after the fix.)

## 14. Remaining production blockers

1. **Provider credentials** (item 9) — live availability/pricing, paid registration, auction
   settlement, gateway payments, email delivery and DNS automation stay inert until an operator
   supplies them. The platform reports exactly which value is missing; it never simulates a result.
2. **Worker scheduling** — the inbox sweeps, domain-transfer polling and notification queue run in the
   existing worker; the cPanel cron/Passenger schedule must be configured on the deployment host.
3. **PostgreSQL** — production requires a real PostgreSQL instance (`DATABASE_URL`); PGlite is used by
   tests and the preview harness only.
4. **Localisation** — multi-currency is supported per plan/store, and IDN domains now work, but there
   is no UI translation layer (language packs) yet. It is not claimed anywhere in the UI.
5. **Auction/broker provider ops** — winner payment and transfer hand-off reuse the payment and
   registrar abstractions, so they inherit blocker 1.

## §28 honesty notes (no placeholders)

Every listing, count, price and status in the new UI is read from the database or the provider layer.
Where a capability needs a credential, the API returns a typed `CONFIGURATION_REQUIRED` naming the
variable and the UI repeats that message — there is no mock availability, no fabricated price, no
"queued/sent" status that was not actually achieved, and no inert button: a control either performs a
real action or is disabled with the reason shown.
