# WHMCS Integration Audit & Implementation Plan

| Field | Value |
| --- | --- |
| Document | `docs/WHMCS-INTEGRATION-AUDIT.md` |
| Date | 2026-11-08 |
| Branch | `arena/9283a138-cloudhost247` (from `main` @ `2b86541`) |
| Scope | Every website surface that advertises or sells a hosting service, and every path by which it could reach WHMCS |
| Implementation status | **Session A complete and reviewed (2026-11-08).** Session B slices B1.1–B1.4, B2.1, **B2.4** and **B5.1**, B3.1, plus C1.1–C1.3, **C1.5** (the product mapping review), **C1.6** (discovery readiness) and the C1.7 **approval pack**, are implemented and tested (§9.1). The C1.7 discovery run itself is **BLOCKED** on credentials. The mapping review runs and is complete, but every row is `BLOCKED` for want of a discovery artifact, so **0 services are verified**. The orderability endpoint and the identity/SSO bridge are live routes; **no storefront page consumes them yet**, and C2 onwards — wiring pages to WHMCS — remains **NOT STARTED**, gated on the discovery run that needs a reachable WHMCS installation. |
| Decisions taken | Option **A** (SPA becomes a WHMCS front-end), staging access **not yet available** (build and test against a fake transport; no product id renders until discovery runs), module-backed services **not advertised** until hosting is verified. See §0.1. |
| Honesty rule applied | Nothing below is called connected, verified or working on the strength of a page existing. Where a fact could not be established in this environment it is written as **UNVERIFIED** with the reason and the exact way it will be established. |

---

## 0.1 Decisions taken at the review gate (2026-11-08)

| Question | Answer | Consequences encoded in the code |
| --- | --- | --- |
| Which surface owns commerce? | **Option A** — the SPA becomes a WHMCS front-end. One identity, one cart, one invoice set, one provisioning system. The SPA's own cart/orders/invoices/payments routes are retired as hosting commerce, service by service, behind the verified mapping. | The cart hand-off (`src/whmcs/cart.ts`) is the only permitted route to checkout; a service with no verified binding cannot produce a URL. Nothing may compute a price locally. |
| Is there a reachable WHMCS installation? | **Not yet.** Build and test against a fake transport; keep every product id `UNVERIFIED`. | `WHMCS_MODE` defaults to `read-only`; the layer reports `enabled: false` with a named reason instead of failing at boot; the product map ships with **zero** bindings and 59 explicit dispositions. |
| What happens to module-backed services that are not advertised (RDP, LTE proxy, SMM, phone/SMS/eSIM/VoIP)? | **Leave unadvertised, marked NOT INTEGRATED**, and revisit after hosting is staging-verified. | They stay in §5E/§7 of this document. `modules/servers/RDP/` — whose suspend/unsuspend/terminate return `true` without calling the provider — is not reachable from any product page. |

---

## 0. Executive summary

**What already exists and is genuinely WHMCS-native.** The repository is not a static marketing site with a
billing system bolted on. It is a WHMCS customisation tree — 84 root PHP routes, 23 addon modules, 14 server
(provisioning) modules, a parent/child order-form skin, 3 order-form templates — plus a *separate*, complete
Node.js/TypeScript platform (`cloudhost247-node/`, 53 route modules, 85 SQL migrations, 193 declared SPA routes).
The PHP surface already reads the real WHMCS catalogue (`tblproducts`/`tblproductgroups`/`tblpricing`), and its
commerce links already point at the real WHMCS cart (`cart.php?a=add&pid=N&billingcycle=…`). There is **no**
WHMCS API key in browser code and **no** parallel payment engine inside the WHMCS addons: the ones that touch
money or mail go through WHMCS `localAPI` (`CreateInvoice`, `GetInvoice`, `AddClientDomain`, `SendEmail`).

**The single largest finding — a duplicate commerce stack.** `cloudhost247-node/` runs its own customers,
sessions, catalogue, cart, orders, invoices, payments, tickets and provisioning (`src/commerce/`,
`src/services/commerce-service.ts`, `src/services/billing-service.ts`, `src/payment*`, `orders`/`invoices`
tables). It has **zero** references to `cart.php`, `clientarea.php`, `register.php` or `submitticket.php` in any
component. Its plan and catalogue buttons lead to its own cart (`POST /api/v1/cart/catalog-items`) and its own
checkout (`POST /api/v1/orders`), invoiced by its own `issueInvoiceForOrder`. Against this directive — "do not create duplicate billing systems; WHMCS
is the central billing, ordering, provisioning and account system" — that stack is a second billing system, and
it is the one that the SPA's own audit calls the live website. **This cannot be resolved by adding a WHMCS client
library; it needs an explicit architecture decision (§8).**

**Second finding — no verified product mapping exists anywhere in the repository.**

- 55 advertised SPA service/marketing pages. **12** embed a live plan block (section-level `productSlug`) and
  **2** (`/pricing`, `/offers`) render the product catalogue — and every one of those order paths terminates in the
  SPA's own cart. The plan block itself has **no** order button: it prints name, price and features, then links to
  `/service-plans/catalog/<slug>`, where a `Choose <cycle>` button adds to the SPA cart. **Zero** pages, buttons or
  links reach WHMCS.
- 48 PHP routes render through the theme's `PublicPage`, and a page displays live WHMCS products only if its
  content record carries `product_group`. **0 of 67** theme content entries carry one
  (`modules/addons/cloudhost247_theme/resources/site.json`).
- The one PHP page that lists live products, `cloudhost247-hosting.php`, reads the OVH addon's own mapping table
  (`mod_cloudhost247_hosting_products`), which is deployment data absent from the repository.
- No `pid`, `gid`, product name or price for any CloudHost247 service is recorded in this repository.

**Third finding — product IDs cannot be retrieved from here, and will not be invented.** There is no licensed
WHMCS core, no `configuration.php`, no database and no API credentials in this workspace (the repository
explicitly excludes WHMCS core: `README.md` line 3-5). The directive requires retrieving and verifying product
IDs from the actual installation, so Session C of the plan begins with a read-only discovery run against the
WHMCS staging installation and emits a checksummed mapping artifact. Until that artifact exists, every product
ID below is `UNVERIFIED`.

**Fourth finding — provisioning coverage is partial, and what exists is honest about it.** 14 server modules ship
here (email ×2, SMTP, RDP, LTE proxy, SMM ×2, SoYouStart ×2, phone services ×4, OVH). **No** cPanel/WHM, Plesk,
VPS/cloud-hypervisor, dedicated-metal, SSL or registrar *modules* are in this repository — that is expected,
because those are WHMCS core modules supplied by the licence, not by this overlay. Their presence and
configuration in the target installation is **UNVERIFIED** and is a staging prerequisite, not a code task.
One shipping module is known-defective for production: `modules/servers/RDP/` is the vendor build whose suspend,
unsuspend and terminate `return true` without calling the provider (`docs/UNFINISHED-MODULES.md` §E). Under this
directive ("do not report an operation as successful until WHMCS or the provider confirms it") that module must be
restored to the in-tree secure rebuild or marked NOT INTEGRATED before any RDP product is offered.

**Fifth finding — the static link gate is green, and it does not measure connectivity.** `node
scripts/site/check-links.mjs` reports *2240 surfaces · 977 internal · 1017 PHP · 0 broken, 0 placeholder, 0
dangling*. That proves every destination resolves to a route or a licensed WHMCS entry point. It says nothing
about whether the route performs the WHMCS operation the card promised — which is the gap this project closes.

---

## 1. Verification boundary and method

### 1.1 What this environment can and cannot do

| Available | Not available |
| --- | --- |
| Full repository (9,004 tracked files), Git history | Licensed WHMCS 8.x core, `configuration.php`, `tbl*` database |
| PHP 8.2.33 via `scripts/php-wasm/php` (lint / CLI, `intl` missing) | Native PHP with ionCube, a rendered WHMCS page, a Smarty-compiled template |
| Node 22.22.3, Python 3.11.2 | WHMCS API credentials (identifier/secret), staging hostname |
| PGlite harness + Vitest suites (once `npm ci` runs) | Provider credentials: registrar, CA, cPanel/WHM, hypervisor, SMTP, gateways |
| Real headless Chromium (`@sparticuz/chromium`) for the SPA | A live payment gateway / webhook (financial freeze applies) |

Consequence, stated plainly: **PHP syntax clean ≠ WHMCS runtime verified; SPA screenshots ≠ PHP page parity;
catalogue code that compiles ≠ catalogue data that exists.** No production compatibility is claimed here.

### 1.2 Commands actually executed for this audit

| # | Command | Result |
| --- | --- | --- |
| 1 | `git ls-files \| wc -l` | 9,004 tracked files |
| 2 | `ls *.php \| wc -l` | 84 root routes |
| 3 | `grep -c PublicPage::route` across root routes | 48 themed routes; 42 have a `site.json` entry |
| 4 | `python3` scan of `site.json` `pages` | 67 entries, **0** with `product_group` |
| 5 | `python3` scan of `shared/site/content/*.json` | 55 service/marketing pages: **12** embed a live plan block (`sections[].productSlug`), **2** render the catalogue section, **1** carries a page-level `catalogSlug`; 0 order actions into WHMCS |
| 6 | `python3` scan of `shared/site/registry.json` menus | 7 mega-menus, 105 items, 8 without an SPA target, 1 without a PHP target |
| 7 | `node scripts/site/check-links.mjs` | 2240 surfaces, 977 internal, 1017 PHP, 0 broken |
| 8 | `python3 -m unittest tests.website.test_static` | 23 tests OK |
| 9 | `python3 -m unittest tests.website.test_catalogue_honesty` | 21 tests OK (8 skipped: rendered fixtures absent) |
| 10 | `scripts/php-wasm/php -v` | PHP 8.2.33 (WASM) |
| 11 | `ls modules/addons`, `ls modules/servers`, `ls modules/gateways`, `ls modules/registrars` | 23 addons, 14 server modules, 1 gateway (Blockonomics), 0 registrar modules |
| 12 | `grep -rn "cart.php\|clientarea.php\|register.php\|submitticket"` in `cloudhost247-node/frontend/src` | only inside the crawl-policy deny-list — no commerce link exists in the SPA |

### 1.3 Evidence classes used below

`SOURCE` — read from a named file. `CMD` — produced by a command in table 1.2. `STAGING` — requires the licensed
WHMCS/cPanel staging environment described in `docs/STAGING-ENVIRONMENT-REQUIREMENTS.md` and **has not been
performed**. `UNVERIFIED` — the fact lives in the installation, not the repository.

---

## 2. WHMCS-relevant repository structure

```
/                                  ← WHMCS document root overlay (cPanel public_html)
├── init.php                       ← NOT shipped: supplied by the licensed WHMCS core
├── *.php  (84)                    ← public routes; 48 via Theme\PublicPage, 36 custom/legal/sitemap
├── modules/
│   ├── addons/ (23)               ← see §3.2; includes theme, builder, broker, payments, integrations,
│   │                                currency, passkey, ovh, smm, tools, phoneservices, digitalproducts…
│   ├── servers/ (14)              ← RDP, Smtphosting, cloudhost247_email, cloudhost247_email_hosting,
│   │                                cloudhost247_lteproxy, cloudhost247_ovh, cloudhost247_smm, smmprovisioning,
│   │                                phoneservices_{esim,numbers,sms,voip}, soyoustart, soyoustart_vps
│   ├── gateways/                  ← blockonomics (+ callback). No card/crypto gateway of our own.
│   └── registrars/                ← (absent by design; eNom/ResellerClub/etc. are WHMCS core)
├── templates/
│   ├── cloudhost247/ (67 pages)   ← first-party client-area theme: homepage, product pages, cart skin,
│   │                                login/register/pwreset contract, legal documents, tools surface
│   └── orderforms/{cloudhost247, cloudhost247_legacy, ovh_cart}   ← order form skins over standard_cart
├── shared/site/                   ← single source of truth projected into BOTH frontends
│   ├── registry.json              ← nav, footer, legal index, tools categories, sitemap (105 nav items)
│   └── content/{hosting,cloud,developers,platforms,products,resources}.json  ← 55 service pages (SPA)
├── scripts/site/generate.mjs      ← projects registry.json → theme site.json + SPA registry.generated.ts
├── cloudhost247-node/             ← SEPARATE Node platform: own DB, own auth, own cart/orders/invoices
├── platform/                      ← frozen read-only per ADR 001 (not touched)
├── crons/                         ← priceSync.php (OVH), currency, integrations, smm, passkey, builder, ovh
├── tests/ (22 suites)             ← website, builder, theme, payments, passkey, ovh, rdp, smm, tools, staging…
└── docs/ (71 files)               ← incl. STAGING-ENVIRONMENT-REQUIREMENTS.md, PROVIDER-COMPARISON.md,
                                     FEATURE-PARITY-REGISTER.md, UNFINISHED-MODULES.md, ADR 001
```

Two facts about this layout drive everything that follows:

1. **The PHP surface *is* WHMCS.** It runs inside WHMCS and therefore does not need an API client to read the
   catalogue or to open a cart — it uses WHMCS's own tables and its own `cart.php`. The "keep credentials on the
   server, never expose them" requirement is satisfied structurally here.
2. **The Node surface is not WHMCS.** Anything the SPA sells needs a server-side WHMCS adapter, and anything it
   sells today it sells itself.

---

## 3. Current WHMCS connection architecture

### 3.1 Two frontends, one content registry

```
                      shared/site/registry.json  +  content/*.json
                                    │
                 scripts/site/generate.mjs (single projection step)
                    ┌───────────────┴────────────────┐
                    ▼                                ▼
   theme resources/site.json                 SPA registry.generated.ts
   (PHP / WHMCS document root)               (cloudhost247-node/frontend)
                    │                                │
        ┌───────────┴──────────┐          ┌──────────┴───────────┐
        ▼                      ▼          ▼                      ▼
  PublicPage / templates   cart.php   React marketing      Fastify API
  (reads tblproducts,      (WHMCS     pages + own cart     (own Postgres:
   tblpricing, links to     cart)      (POST /api/v1/cart)   users, carts,
   cart.php?a=add&pid=N)                                        orders, invoices,
                                                                payments, tickets)
```

### 3.2 Every existing WHMCS touchpoint

| # | Component | Path | What it actually does | Direction | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | Theme page renderer | `modules/addons/cloudhost247_theme/lib/PublicPage.php` | Renders published/editorial content; attaches a product list only when `product_group` is set | read | SOURCE |
| 2 | Theme product component | `…/cloudhost247_theme/lib/Content/ProductComponents.php` | Validates/clamps a product widget, delegates the query to the builder reader; returns "unavailable + reason" rather than inventing a price | read | SOURCE |
| 3 | Bounded catalogue reader | `modules/addons/cloudhost247_builder/lib/Catalog/WhmcsDataSource.php` | The single product query: groups, products, price per cycle, domain pricing, cart view, reviews, service status, currency, brokerage | read (DB) | SOURCE |
| 4 | Commerce URL builder | `…/cloudhost247_builder/lib/Catalog/CartLinks.php` | `cart.php?a=add&pid=N&billingcycle=…`, `cart.php?gid=N`, `cart.php?a=view`, `checkout`, `domainchecker.php`, `clientarea.php`, `register.php` | link-out | SOURCE |
| 5 | Hosting catalogue (public) | `cloudhost247-hosting.php` + `modules/addons/cloudhost247_ovh/lib/Products/PublicCatalog.php` | Lists live products joined to `mod_cloudhost247_hosting_products`, per-currency `tblpricing`, per-cycle prices, `cart_url` per product | read (DB) | SOURCE |
| 6 | Hosting product admin | `…/cloudhost247_ovh/lib/Products/HostingProductManager.php` | Creates/updates `tblproducts` rows + mapping, with audit log and change confirmation | write (DB) | SOURCE |
| 7 | Email hosting catalogue | `modules/servers/cloudhost247_email_hosting/lib/Service/PublicCatalog.php` | Same pattern for email products | read | SOURCE |
| 8 | Invoice/payment via WHMCS | `modules/addons/cloudhost247_broker/lib/Services/PaymentService.php` | `localAPI('CreateInvoice')`, `localAPI('GetInvoice')`; no parallel payment engine | write (localAPI) | SOURCE |
| 9 | Domain delivery via WHMCS | `…/cloudhost247_broker/lib/Services/DomainDeliveryService.php` | `GetClientsDomains`, `AddClientDomain` — association in WHMCS, not a second registrar record | read/write (localAPI) | SOURCE |
| 10 | Notification via WHMCS | `…/NotificationService.php`, `passkey/lib/NotificationService.php`, `cart_recovery/lib/EmailService.php` | `localAPI('SendEmail')` with built-in templates | write (localAPI) | SOURCE |
| 11 | Form → ticket/lead seam | `…/cloudhost247_builder/lib/Services/FormService.php` | Injects a `localAPI` seam; returns `unavailable` when absent | write (localAPI) | SOURCE |
| 12 | Currency display feed | `modules/addons/cloudhost247_currency/display-feed.php` → Node `FX_FEED_URL` | Read-only FX rates consumed by the SPA's display-only conversion | read | SOURCE |
| 13 | Passkey/MFA | `modules/addons/cloudhost247_passkey/` | WebAuthn inside the WHMCS client area, CSRF-protected `api.php`, own migrations | write (client area) | SOURCE |
| 14 | Order form skin | `templates/orderforms/cloudhost247` | Child of `standard_cart`; parent owns markup and processing | presentation | SOURCE |
| 15 | Cart recovery | `modules/addons/cloudhost247_cart_recovery/recover.php` | Redirects to `cart.php?a=view` | link-out | SOURCE |
| 16 | Integration vault | `modules/addons/cloudhost247_integrations/` | AES-256-GCM secret vault, URL guard, signers (AWS v4, OVH), connection tester, redactor | provider creds | SOURCE |
| 17 | PDO/OVH product sync | `crons/priceSync.php`, `crons/cloudhost247_ovh.php` | Refreshes prices/availability from the provider into WHMCS products | provider → WHMCS | SOURCE |
| 18 | **Node → WHMCS** | — | **Does not exist.** No identifier/secret, no `api.php` client, no `WHMCS_*` variable in `.env.example` | — | **ABSENT** |

### 3.3 Security posture (current state)

| Requirement (directive) | Current state | Verdict |
| --- | --- | --- |
| API credentials server-side only | No WHMCS API credentials exist anywhere; provider secrets encrypted in the integrations vault | PASS (trivially) / N-A |
| No admin credentials in browser code | No WHMCS credential is referenced by any template, JS bundle or SPA component | PASS |
| Authenticated backend→WHMCS | PHP path is inside WHMCS (localAPI/DB); Node path absent | **GAP** |
| Request/response validation | Builder reader bounds queries (limit/whitelist); no schema validation of API responses because there are none | PARTIAL |
| Timeouts, retries, circuit breaking | Provider clients have bounded transports (`CurlTransport`, OVH/AWS signers); no WHMCS client to harden yet | **GAP (Node)** |
| Idempotency for order/payment ops | `cloudhost247_broker` records invoice ids; RDP rebuild has a ledger but the active module is the vendor one; no general idempotency store | PARTIAL |
| Reconciliation references | `PaymentService` reads back `GetInvoice`; Blockonomics addon only shows *Paid* when a real WHMCS payment exists | PARTIAL |
| Redacted logging | `cloudhost247_core/lib/Support/{AuditLogger,Logger,SafeError}`, `integrations/lib/Support/Redactor` | PASS |
| Graceful WHMCS downtime | Catalogue paths return "unavailable + reason"; SPA has no WHMCS dependency to fail | PARTIAL |
| No success before upstream confirms | PHP: catalogue honesty tests enforce "no invented price". RDP vendor module violates this (§7) | **FAIL (RDP)** |

---

## 4. Products, product groups, pricing — discovery status

### 4.1 Why nothing is listed as a verified ID

`README.md`: *"WHMCS core (`init.php`, `includes/`, `vendor/`, licence and database) is not included."* There is
no installation to query in this workspace and no credential with which to query one remotely. The directive is
explicit — *do not invent WHMCS product IDs; retrieve and verify them from the actual installation* — so this
audit records **what the code will read, from where, and with which parameter**, and leaves the values to the
discovery run in §9 Session C.

### 4.2 Authoritative sources the code already reads

| Purpose | Source of truth | Read by | Notes |
| --- | --- | --- | --- |
| Product groups | `tblproductgroups` (`id`, `name`, `hidden`, `order`) | `WhmcsDataSource::productGroups()` | `hidden=0`, ordered |
| Products | `tblproducts` (`id`, `gid`, `name`, `description`, `paytype`, `hidden`, `order`) | `WhmcsDataSource::products($gid,…)`, OVH `PublicCatalog` (joined) | Hidden products excluded |
| Prices per cycle | `tblpricing` (`type='product'`, `relid`, `currency`, `monthly\|quarterly\|semiannually\|annually\|biennially\|triennially`, `msetupfee`…) | `WhmcsDataSource::price()`, OVH `PublicCatalog` | Cycle shown only if configured |
| Domain pricing | `tblpricing` `type='domainregister'\|'domaintransfer'\|'domainrenew'` (via `DOMAIN_YEAR_COLUMN`) | `WhmcsDataSource::domainPricing()` | TLD table |
| Configurable options | `tblproductconfiggroups` / `tblproductconfigoptions` / `…optionssub` / `…links` | **not read by this repository** — delegated to WHMCS cart | Intentional: WHMCS cart owns configuration |
| Currency | `tblcurrencies` (`id`, `code`, `prefix`, `suffix`, `default`, rate) | `WhmcsDataSource::currency()`, OVH `PublicCatalog` | Session currency honoured |
| Hosting-product mapping | `mod_cloudhost247_hosting_products` (`whmcs_product_id`, `product_kind`, `featured`, `availability_status`, `display_order`, `specifications_json`) | OVH `PublicCatalog` | **Deployment data — absent from repo** |
| OVH plan mapping | `mod_cloudhost247_ovh_product_mappings` (`whmcs_product_id`, `endpoint_id`, `family`, `plan_code`, `subsidiary`, `configuration_json`, `active`, `margin_percent`) | OVH addon | **Deployment data — absent from repo** |
| Provisioning module per product | `tblproducts.servertypeid` → `tblservers` | WHMCS core | **UNVERIFIED** |
| Order form / cart | WHMCS `cart.php`, `standard_cart` child | Link-out | **UNVERIFIED (staging)** |

### 4.3 How every ID will be retrieved and verified (Session C gate)

1. **Read-only WHMCS API:** `GetProducts` (all groups/products, `paytype`, cycles, server module) and `GetProductGroups`.
2. **Read-only cross-check:** `tblproducts`/`tblpricing` snapshot exported with `SELECT` only, no writes.
3. **Provisioning cross-check:** `tblproducts.servertypeid` joined to `tblservers.type`, to name the module per
   product — this is the only accepted evidence for "Provisioning module" in the report matrix.
4. **Emit an artifact,** not hand-typed numbers: `config/whmcs/product-map.json` with
   `{ service_key, product_group_id, product_id, available_cycles[], currency, provisioning_module,
   source: "GetProducts", retrieved_at, whmcs_version, sha256 }`, produced by
   `cloudhost247-node/scripts/whmcs/discover-catalogue.ts` (slice C1).
5. **Refuse to sell without it:** any service whose key is absent from the verified map renders no price and no
   order button, and says why. This is enforceable and testable *before* any credential exists — and it now is
   (§9.1, slices C1.1–C1.2).

   The artifact lives in the Node application root, not at repository root, because that is the directory
   deployed to cPanel: `cloudhost247-node/config/whmcs/product-map.json`. Held in this workspace today:
   `version 1`, `products: []`, `services: {}`, `unmapped:` **59** entries — every advertised service, with a
   reason. It is checksummed, and `npm run whmcs:map -- verify` fails if it is edited by hand.

> Product IDs in §5 are therefore written as `UNVERIFIED` and keyed by a stable `service_key` (the catalogue
> slug). No placeholder integers are used anywhere, because a plausible-looking wrong `pid` sends a customer to
> the wrong product.

---

## 5. Service inventory and current mappings

Legend — **Order path**: `own` = the SPA's own cart/orders; `WHMCS cart` = link to `cart.php` with a `pid`;
`none` = no ordering affordance found. **Product list**: `live` = reads the WHMCS catalogue at request time;
`authored` = copy only, no products; `own DB` = reads the SPA's own `products/plans/plan_pricing`.

**Machine-readable form:** [`config/whmcs/service-register.csv`](../config/whmcs/service-register.csv) — 59 rows
(46 `FRONTEND CONNECTED`, 12 `BLOCKED`, 1 `WHMCS CONNECTED`; 12 rows carry a catalogue binding), one per advertised
service surface, with empty
`product_group_id`/`product_id` columns until the discovery run (slice C1) fills them from WHMCS. This file is the
input to the completeness test in slice C1.2: a service advertised on either frontend that has no row, or whose row
still has an empty product ID after discovery, fails CI. Services that exist only as provider modules and are not
advertised anywhere (LTE proxy, SMM, phone/SMS/eSIM/VoIP, RDP) are covered in §5E and §7 instead of being listed as
sellable.

### A. Domains

| Service | Website page (SPA / PHP) | Order path | Product list | WHMCS product | Group | Provisioning | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Domain registration | `/domains/search` · `domain.php`, nav → `cart.php?a=add&domain=register` | WHMCS cart (from PHP nav) / SPA own registrar flow | authored + SPA provider | registrar TLD pricing `UNVERIFIED` | — | WHMCS registrar module `UNVERIFIED` | FRONTEND CONNECTED (PHP) / duplicate stack (SPA) |
| Domain transfer | `/domains/transfer` · nav → `cart.php?a=add&domain=transfer` | WHMCS cart | authored | `UNVERIFIED` | — | registrar | FRONTEND CONNECTED (PHP) |
| Domain renewal | `/legal/domain-renewal-policy` | none | authored (policy text) | — | — | WHMCS core | **NOT CONNECTED** — policy page, no renewal action |
| Domain search / availability | `/domains/bulk-search`, `/domains/whois` · `domain.php` | SPA provider (not configured) | SPA: "Service Provider Not Configured" | — | — | — | **BLOCKED** — no registrar provider configured; `cloudhost247_domain_lookup` uses third-party WHOIS/IPinfo APIs, not the registrar |
| Domain pricing / extensions | `/domains/extensions` | none | SPA | `tblpricing` domain columns via `WhmcsDataSource::domainPricing()` — used only by builder blocks | — | — | **PARTIAL** |
| DNS management | `/dashboard/dns`, `/account/dns` · `dns-management.php` | own | own DB (`src/dns`) | — | — | — | duplicate stack; PHP page is authored |
| Nameservers / DNS records | SPA `cloudflare` service + own DNS tables | own | own DB | — | — | — | duplicate stack |
| Domain contacts / WHOIS privacy | — | none | — | WHMCS core client area | — | — | **NOT CONNECTED** |
| Domain brokerage | `index.php?m=cloudhost247_broker` (addon) | WHMCS | addon tables | n/a | — | localAPI `AddClientDomain` | WHMCS CONNECTED (modular, staging-unverified) |

### B. Web hosting

| Service | Website page (SPA / PHP) | Order path | Product list | WHMCS product | Group | Provisioning | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Web / shared hosting | `/hosting/web-hosting` · `web-hosting.php` | SPA: plan block → plan page → SPA cart. PHP: none (no `product_group`) | SPA own DB (empty by default); PHP authored | `UNVERIFIED` | `UNVERIFIED` | WHMCS `cpanel` (core) `UNVERIFIED` | FRONTEND CONNECTED only |
| Business hosting | `/hosting/business` · `business-hosting.php` | SPA: plan block → plan page → SPA cart. PHP: none | SPA own DB; PHP authored | `UNVERIFIED` | `UNVERIFIED` | core `UNVERIFIED` | FRONTEND CONNECTED only |
| WordPress hosting | `/hosting/wordpress` · `wordpress-hosting.php` | SPA: plan block → plan page → SPA cart. PHP: none | SPA own DB; PHP authored | `UNVERIFIED` | `UNVERIFIED` | core `UNVERIFIED` | FRONTEND CONNECTED only |
| cPanel hosting | `/hosting/cpanel` · `cpanel-hosting.php` | SPA: plan block → plan page → SPA cart. PHP: none | SPA own DB; PHP authored (+live via `/cloudhost247-hosting.php?type=hosting`) | `UNVERIFIED` | `UNVERIFIED` | core `cpanel` `UNVERIFIED` | FRONTEND CONNECTED only |
| Plesk hosting | *(none)* · `plesk-hosting.php` | none | authored | `UNVERIFIED` | `UNVERIFIED` | core `plesk` `UNVERIFIED` | **NOT CONNECTED** (no SPA route, no order path) |
| Windows hosting | `/hosting/windows` · `windows-hosting.php` | SPA: plan block → plan page → SPA cart. PHP: none | SPA own DB; PHP authored | `UNVERIFIED` | `UNVERIFIED` | core `UNVERIFIED` | FRONTEND CONNECTED only |
| Reseller hosting | `/hosting/reseller` · `reseller-hosting.php` | SPA: plan block → plan page → SPA cart. PHP: none | SPA own DB; PHP authored | `UNVERIFIED` | `UNVERIFIED` | core `UNVERIFIED` | FRONTEND CONNECTED only |
| Email hosting | `/hosting/email` · `email-hosting.php` + `modules/servers/cloudhost247_email_hosting` | SPA: plan block → SPA cart. PHP: none | module's `PublicCatalog` (live) | `UNVERIFIED` | `UNVERIFIED` | `cloudhost247_email_hosting` | WHMCS CONNECTED (module present) |
| PHP / Python / Node / Laravel / Docker / API / Developer hosting | `/developers/*`, `/hosting/developer`, `/hosting/api` · `*-hosting.php` | none — hero CTA to `/pricing` or `/hosting` | authored | `UNVERIFIED` | `UNVERIFIED` | core `UNVERIFIED` | FRONTEND CONNECTED only |
| Hosting catalogue (all plans) | `/pricing`, `/offers` · `cloudhost247-hosting.php` (the target of every themed page's *View Plans* CTA) | WHMCS cart (`cart_url` per card) | **live** (`PublicCatalog`) | from `tblproducts` + mapping table | from `tblproductgroups` | per product | **WHMCS CONNECTED** — the only PHP page listing real products with real prices and real `cart.php?a=add&pid=N` links |

### C. Cloud and server services

| Service | Website page (SPA / PHP) | Order path | Product list | WHMCS product | Group | Provisioning | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| VPS hosting | `/hosting/vps` · `vps-hosting.php` | SPA: plan block → SPA cart → SPA provisioning. PHP: none | SPA own DB; PHP authored | `UNVERIFIED` | `UNVERIFIED` | `cloudhost247_ovh` / hypervisor `UNVERIFIED` | duplicate stack; **PHP NOT CONNECTED** |
| Public / private cloud | `/cloud/public`, `/cloud/private` · `vps-publiccloud.php`, `vps-privatecloud.php` | SPA: plan block → SPA cart. PHP: none | SPA own DB; PHP authored | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | FRONTEND CONNECTED only |
| Dedicated servers | `/hosting/dedicated` · `dedicated-server.php`, `dedeicated-server.php` (typo route, preserved) | SPA: plan block → SPA cart. PHP: none | SPA own DB; PHP authored | `UNVERIFIED` | `UNVERIFIED` | `soyoustart` / `soyoustart_vps` (in-tree) `UNVERIFIED` | module present; mapping unverified |
| Enterprise servers | `/cloud/enterprise-servers` · `enterprise-servers.php` | none — hero CTA only | authored | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | FRONTEND CONNECTED only |
| Game servers | `/cloud/game-servers` · `game-servers.php` | none — hero CTA only | authored | `UNVERIFIED` | `UNVERIFIED` | `UNVERIFIED` | FRONTEND CONNECTED only |
| Managed services | `/cloud/managed-services` · `managed-services.php` | none | authored | `UNVERIFIED` | `UNVERIFIED` | n/a (service line) | **NOT CONNECTED** |
| RDP | *(none)* · no route | none | none | `UNVERIFIED` | `UNVERIFIED` | `modules/servers/RDP` (vendor build, **defective**) | **BLOCKED** — not advertised, module unsafe |
| Server upgrades / renewals / termination | SPA `/account/services/:id/*` (own); PHP client area (WHMCS core) | mixed | own DB / WHMCS core | — | — | per product | duplicate stack on SPA; PHP = WHMCS core, `UNVERIFIED` |
| Server management, monitoring, firewall, backups, IP management, network, data centres, operating systems | `/cloud/*`, `/dashboard/servers/*` | SPA `own` | authored / own DB | — | — | — | Mostly authored; SPA implements its own operations |

### D. SSL certificates

| Service | Website page (SPA / PHP) | Order path | Product list | WHMCS product | Group | Provisioning | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SSL catalogue & pricing | `/hosting/ssl` · `ssl-certificate.php` | SPA: plan block (`ssl-certificate`) → SPA cart; `account/ssl` manages its own table. PHP: none | SPA own DB; PHP authored | **no SSL product group in repo** — `UNVERIFIED` | `UNVERIFIED` | **none in tree** (WHMCS MarketConnect or a CA module must supply it) | **NOT INTEGRATED** |
| Certificate issuance / installation | SPA `/account/ssl` (own table `src/db/ssl.ts`) | own | own DB | — | — | — | **No real CA integration.** Violates "do not simulate certificate issuance" |
| Renewal / expiry tracking | SPA own | own | own DB | — | — | — | **NOT INTEGRATED** |
| Cancellation | SPA own | own | — | — | — | — | **NOT INTEGRATED** |

### E. Additional services present in the catalogue

| Service | Where | Order path | Provider module in tree | Status |
| --- | --- | --- | --- | --- |
| Business email / SMTP | `email-hosting.php`, `modules/servers/{Smtphosting,cloudhost247_email,cloudhost247_email_hosting}` | module-mediated | yes — IMAP/SMTP, M365, Google Workspace adapters | WHMCS CONNECTED (module), **localAPI `SendEmail` not used for sending**; staging-unverified |
| LTE proxy | `modules/servers/cloudhost247_lteproxy` | module | yes (HTTPS provider API) | module present; **no website page found** → not advertised |
| SMM services | `modules/servers/{cloudhost247_smm,smmprovisioning}`, `modules/addons/smmaddon`, `crons/cloudhost247_smm.php` | module | yes | module present; **no advertised page** |
| Virtual numbers / SMS / eSIM / VoIP | `modules/servers/phoneservices_*`, `modules/addons/phoneservices` | module | yes (Twilio/Telnyx-style) | module present; **no advertised page** |
| Digital products | `modules/addons/digitalproducts` (client area + `API.md`) | addon | n/a | WHMCS CONNECTED (addon) |
| Tools platform (105 tools) | `/tools/*` · `modules/addons/cloudhost247_tools`, `tools/` | own (not sold) | n/a | Independent of WHMCS — no product, no billing. Correct. |
| Website builder / store / logo maker / experts / marketing / inbox / AI | SPA only (migrations 0072–0083) | SPA `own` | n/a | **Not in WHMCS at all**; sold through the SPA's own commerce |

---

## 6. Disconnected buttons, links and workflows

### 6.1 Structural disconnections (not broken links)

| # | Element | Evidence | Impact |
| --- | --- | --- | --- |
| D1 | **SPA cart/checkout/orders/invoices/payments** | `src/routes/commerce.ts:90-180`, `billing.ts:38-50`, `payments.ts:41`, `src/services/commerce-service.ts` | A second billing system; orders never reach WHMCS, invoices are not WHMCS invoices, provisioning is not WHMCS provisioning |
| D2 | **SPA accounts** | `src/routes/auth.ts`, `users` table, JWT, passkeys | Customers have two identities: SPA user and WHMCS client. No link, no SSO, no shared password |
| D3 | **SPA service pages have no buy path to WHMCS** | `grep cart.php` in `frontend/src` → only the crawl deny-list; `ProductPlansSection` renders prices with no button | All 55 pages' commerce terminates in the SPA cart (12 via a plan block → dedicated plan page; 2 via the catalogue → "Add to cart"); **0** reach WHMCS |
| D3a | **The plan block on 12 service pages has no order button** | `frontend/src/components/ProductPlansSection.tsx:60-92` (price + features, no CTA) | A visitor on `/hosting/business`, `/hosting/vps`, `/cloud/public`, … cannot buy from the plan they are reading; they must follow "View dedicated plan page →" and find the button there |
| D4 | **PHP service pages show no products** | `site.json` 67 entries, 0 `product_group`; `cloudhost247-page.tpl:12` renders the plan grid only when `product_component` is set | 42 themed service pages render copy plus a shared hero CTA — `View Plans` → `cloudhost247-hosting.php` (or, on `domain.php`, register/transfer links). Only the one live catalogue page actually lists products |
| D5 | **Configurable options never surface on the website** | no reader for `tblproductconfig*` | "Configure" happens only inside WHMCS cart; acceptable, but no page can show that options exist, and no test asserts the hand-off preserves the choice |
| D6 | **Billing cycle is lost on most hand-offs** | `CartLinks::product()` supports `billingcycle`, but the theme's product-plans include and `product-hero.tpl` link without a cycle | Customer re-selects the cycle in cart; a "from $X/mo" card can land on an annual-only price |
| D7 | **Domain search `query` parameter is unverified** | `templates/cloudhost247/homepage.tpl` posts `a=add&domain=register&query=…` to `cart.php` | If WHMCS ignores `query`, the hero search silently lands on an empty domain form. **STAGING** check |
| D8 | **Renew / upgrade / cancel / order history have no entry point at all** | Theme links exist only for generic destinations — `clientarea.php`, `clientarea.php?action=details` (`header.tpl:58`), `clientarea.php?action=services` (`cloudhost247-platform.tpl:6`), `register.php`, `submitticket.php`. **No** `upgrade.php`, no `clientarea.php?action=orders`, and no service-cancellation or renewal link exists in either frontend (the only `cancel` match is the password-reset dialog's back link, `password-reset-change-prompt.tpl:35`) | The four lifecycle actions the directive lists as mandatory have no door; a customer must know WHMCS's URL scheme to find them |
| D9 | **Support: SPA tickets are its own**; PHP links to `submitticket.php` | `src/routes/account.ts` tickets vs nav `submitticket.php` | Two ticket histories |
| D10 | **2 nav items have no SPA route (PHP-only)** and **1 has no PHP page** | `registry.json`: `Plesk Hosting`, `Domain DNS`, `All Tools`, `Compliance & Document Tools`, `MRZ Generator`, `Knowledge Base`, `Announcements` (SPA absent); `Managed Databases` (PHP absent) | Accepted cross-surface links, but must be re-verified once the commerce target is decided |
| D11 | **`docs/website-functionality-audit-2026-11` records 17 "no-effect" buttons** | that document §2.3 | All explained as correct (native validation, already-active tabs, password-gated actions) — carried forward as a regression set, not re-litigated |

### 6.2 What is *not* broken (verified, must be preserved)

- 2,240 published surfaces; 0 broken/placeholder/dangling destinations (CMD 7).
- 0 `href="#"`, 0 empty hrefs, 0 `javascript:` URLs across rendered SPA crawls.
- Catalogue honesty: no page shows a price the backend did not return; `ProductPlansSection` handles
  loading / error / 404 / draft / no-plans / no-pricing individually (`test_catalogue_honesty`, 21 tests).
- Account page contract (login/register/pwreset field names, post targets, hidden flags) pinned by
  `tests/website/test_account_pages.py`.
- Cart skin inherits `standard_cart` and is pinned by `tests/website/test_cart_skin.py` (no invented brand colour,
  no hidden parent control).
- No secrets in any frontend bundle: no WHMCS API identifier exists to leak.

---

## 7. Missing provider modules and credentials

| Category | Needed for | In repository? | Credential/config needed | Status |
| --- | --- | --- | --- | --- |
| **WHMCS core** | Everything (init.php, cart, client area, invoices, provisioning orchestration) | **No** — by design | Licensed WHMCS 8.x + DB + API identifier/secret | **BLOCKED (staging prerequisite W1-W5)** |
| cPanel / WHM | Shared, business, reseller, WordPress, cPanel hosting | No (core module) | WHM server hostname, API token per server | UNVERIFIED |
| Plesk | Plesk hosting page | No (core module) | Plesk server + credentials | UNVERIFIED |
| Hypervisor for VPS/cloud | VPS, public/private cloud | Partly: `cloudhost247_ovh` (OVH), SoYouStart | OVH application key/secret/consumer key, project id | module present, **unverified** |
| Dedicated metal | Dedicated / enterprise | `soyoustart`, `soyoustart_vps` | SoYouStart/OVH credentials | module present, **unverified** |
| **Domain registrar** | Registration, transfer, renewal, availability, DNS, contacts, privacy | **No** `modules/registrars/` | Registrar account + API (e.g. eNom/ResellerClub/Namecheap) | **BLOCKED** — SPA says "Service Provider Not Configured"; PHP has no registrar either |
| **SSL certificate authority** | SSL catalogue, issuance, install, renewal, expiry | **No** SSL module, no SSL product group | CA account (or MarketConnect) | **NOT INTEGRATED** — SPA's SSL table is not a CA |
| Payment gateways | Checkout | Blockonomics only (+ `modules/gateways/callback`) | Card/bank gateway account; **financial freeze applies** | 1 gateway; **no live activation authorised** |
| Business email / SMTP | Email hosting | Yes (`Smtphosting`, `cloudhost247_email`, `cloudhost247_email_hosting`) | IMAP/SMTP or M365/Google tenant credentials | module present, **unverified** |
| LTE proxy | Proxy service | Yes (`cloudhost247_lteproxy`) | Provider API token (vault) | module present, **unverified**, not advertised |
| SMM | SMM services | Yes (`cloudhost247_smm`, `smmprovisioning`, `smmaddon`) | Provider API key | module present, **unverified**, not advertised |
| Phone / SMS / eSIM / VoIP | Voice & messaging | Yes (`phoneservices_*`) | Twilio/Telnyx-style credentials | module present, **unverified**, not advertised |
| RDP | Remote desktop | Yes — **vendor build with `return true` provisioning** | RDP Arena API authorisation + licence position | **BLOCKED / unsafe** — restore the in-tree secure rebuild or do not sell |
| Managed databases / PaaS / containers | `/platforms/*` | SPA only (own provider adapters: 13 kinds) | Provider tokens per adapter | outside WHMCS |
| AI / LLM | AI builder, support | SPA only | OpenAI-compatible endpoint + key | outside WHMCS |

---

## 8. Architecture decision required before implementation

The directive and the repository currently contradict each other on one point: **which system is the system of
record for commerce, and which frontend sells.** The repository's ADR 001 makes `cloudhost247-node` the canonical
backend and describes WHMCS replacement as incremental; the directive makes WHMCS the centre. Both cannot be true
of the same customer journey.

| Option | What it means | Work | Risk | Verdict |
| --- | --- | --- | --- | --- |
| **A. SPA becomes a WHMCS front-end** (recommended) | Service pages keep their design; the cart/checkout/orders/invoices/payments routes become a thin, server-side WHMCS gateway (catalogue → `cart.php` hand-off → client area / SSO). SPA-local commerce for *hosting* is retired; SPA-only products (builder, store, tools licences) either move into WHMCS products or are explicitly out of scope. | High — touches ~40 routes, auth, 85 migrations | Duplicated data during transition; needs staging | **Recommended** — it is the only option that satisfies the directive without a second billing system |
| **B. WHMCS owns hosting commerce; SPA stays marketing + platform services** | SPA service pages link to WHMCS cart with verified `pid`+cycle; SPA cart remains for non-hosting platform products only; no WHMCS API needed for orders | Medium | Two carts still exist, but for disjoint products — defensible if documented | **Acceptable fallback** |
| **C. Full WHMCS API gateway for all commerce, SPA cart replaced by WHMCS-backed cart** | Deepest integration: a real cart inside the SPA, backed by WHMCS sessions | Very high — WHMCS exposes no public cart API | Requires emulating the client-area session, which is an unsupported integration method and a standing security/upgrade hazard | **Rejected** — the directive requires supported APIs and documented integration methods |
| **D. Keep both stacks as they are, document the duplication** | — | None | Directly violates the directive | **Rejected** |

**Recommendation: Option A, executed in the order below, with Option B as the fallback if the WHMCS cart hand-off
proves unworkable in staging.** Either way, the credits for the decision are:

1. One identity (WHMCS client) — SPA accounts get an SSO path to/from WHMCS, or are scoped to non-billing surfaces.
2. One cart (WHMCS `cart.php` + `standard_cart` child).
3. One invoice set (WHMCS `tblinvoices`).
4. One provisioning system (WHMCS server modules).
5. The SPA keeps its design, AI, tools, builder and store — those are not billing-system duplicates.

---

## 9. Implementation plan — Sessions → Steps → Slices

Conventions: every slice is independently shippable, has a test that fails before it and passes after, and
records evidence in `docs/WHMCS-INTEGRATION-EVIDENCE/`. No slice may be declared done on the strength of a page
existing. `STAGING` slices are written and unit-tested against a fake transport; they are marked **STAGING
VERIFIED** only after a real run.

### Delivery log

| Slice | State | Evidence |
| --- | --- | --- |
| B1.1 configuration | **DONE** | `src/whmcs/config.ts`; 11 tests (`tests/unit/whmcs-config.test.ts`) — missing/partial config, http refusal, pasted endpoint, short secret, bad mode, write-mode guard |
| B1.2 client (auth, retries, breaker, redaction) | **DONE** | `src/whmcs/client.ts`; 12 tests — timeout retry, 500→success, 302 no-retry, HTML body, `result=error`, schema rejection, write refused in read-only, write never retried, breaker opens/closes, secret absent from logs |
| B1.3 idempotency ledger | **DONE** | `database/migrations/0086_create_whmcs_operations.sql`, `src/whmcs/idempotency.ts`; 6 integration tests against embedded PostgreSQL (duplicate claim counts attempts, success is terminal, failed→succeeded allowed, pending forbids retry) |
| B1.4 response schemas | **DONE** | `src/whmcs/schemas.ts`; exercised through the client and catalogue suites |
| B2.1 catalogue normalisation | **DONE** | `src/whmcs/catalogue.ts`; 11 tests — `-1` means not offered, hidden rows removed, per-currency isolation, unpriced product reported, free (`0.00`) preserved, malformed row tolerated |
| B2.2 currency selection | **PARTIAL** | Currency is selected and a missing currency raises `WHMCS_CURRENCY_UNAVAILABLE`; the display-only FX path is untouched |
| B3.1 cart hand-off | **DONE (library)** | `src/whmcs/cart.ts`; 7 tests — URL from binding only, unmapped and unoffered-cycle refuse, no price/credential in URL |
| C1.1 discovery CLI | **DONE (never run against WHMCS)** | `scripts/whmcs/catalogue-map.ts` — `snapshot`, `bind`, `dispose`, `dispositions`, `verify`; `npm run whmcs:map` |
| C1.2 completeness gate | **DONE** | `tests/unit/whmcs-service-coverage.test.ts`; 5 tests — map valid/checksummed, no advertised service without a disposition, register and site in step, no binding for an unadvertised service |
| B2.4 public orderability | **DONE (no bound services yet)** | `src/whmcs/orderability.ts`, `src/routes/whmcs-public.ts`; 15 unit + 15 integration tests — only a binding ∩ live product ∩ priced cycle is orderable, `NOT_INTEGRATED` for the 59 unbound services, `MAP_INVALID` for an edited map, `UPSTREAM_UNAVAILABLE` on outage, request parameters cannot change the verdict |
| B5.1 one identity + SSO hand-off | **DONE (never run against a live WHMCS)** | `src/whmcs/sso.ts`, `src/routes/account-whmcs.ts`, migration `0087_create_whmcs_identity.sql`; 24 unit + 14 integration tests — client id only from the stored link, one-to-one link, verified+exact email match, token never stored, redirect pinned to the WHMCS origin, MFA required by default, support sessions refused, per-account hand-off budget |
| B5.1 security review | **DONE** | Anti-look-alike email canonicalisation (`WHMCS_SSO_EMAIL_NOT_CANONICAL`), atomic cross-instance hand-off budget (migration `0088`, upsert with `RETURNING`), lost-race link idempotency, stale-client mapping (`WHMCS_SSO_LINK_STALE`), bearer-only/CSRF test, lifecycle table (`WHMCS-INTEGRATION.md` §9); 8 new tests |
| C1.3 discovery commands | **DONE (never run against WHMCS)** | `npm run whmcs:doctor` (read-only preflight, per-check pass/fail, states what it cannot verify) and `npm run whmcs:discover` (catalogue JSON + review report, binds nothing); `src/whmcs/discovery.ts`; 11 tests asserting the exact read-only action list |
| C1.5 product mapping review | **DONE (complete but empty — 0 verified)** | `src/whmcs/mapping-review.ts`, `src/whmcs/service-register.ts`, `npm run whmcs:review` → `docs/WHMCS-MAPPING-REVIEW.md`; 27 tests, all six classifications reachable from fixtures, no binding path; currently 59/59 `BLOCKED` because no discovery artifact exists |
| C1.6 discovery execution readiness | **DONE (the run itself is BLOCKED)** | `docs/WHMCS-DISCOVERY-RUNBOOK.md` (7 steps, preflight failure → cause table, abort conditions, the five C2 questions discovery cannot answer); `src/whmcs/discovery-validation.ts` + `npm run whmcs:validate` (14 tests) refusing a snapshot with a duplicate pid, a dangling group, an unknown cycle, a bad price string, an unreported currency or a wrong default; review refuses an invalid artifact and a proposal from another install (4 tests); `npm run typecheck:scripts` added to the build, which exposed and fixed four broken CLI flag handlers |
| C1.7 approval pack | **DONE** | `src/whmcs/evidence-pack.ts` + `npm run whmcs:evidence` assemble the C1.7 step 6 pack from the artifacts on disk (provenance incl. artifact sha256, measured prerequisites, doctor transcript, discovery + validation verdicts, review summary, per-product and per-service evidence, one pending owner-decision row); 12 tests, including redaction of supplied secrets, credential-shaped pairs, bearer tokens and absolute URLs. Committed pack: `docs/WHMCS-APPROVAL-PACK.md`, 0 bindings, 59 dispositions, every service `BLOCKED` |
| C1.7 staging discovery execution | **BLOCKED** | attempted: no `WHMCS_*` variables and no `.env` in the environment, `whmcs:doctor` refuses at configuration (exit 2), and this build environment has no route to a WHMCS installation. Nothing was simulated in its place (`WHMCS-INTEGRATION-REPORT.md` §8.1) |
| Frontend regression baseline | **DONE** | 19 pre-existing failures → 0 (782/782 frontend tests). Causes: stale generated `SPA_ROUTE_PATTERNS` (regenerated), empty `href` in `AppErrorBoundary`, a seventh utility-line control that broke the documented six-control contract, and `play()` returning `undefined` under jsdom. Classified in `WHMCS-INTEGRATION-REPORT.md` §9 |
| B2.3 configurable options | NOT STARTED | Requires staging to confirm the cart parameter format |
| B3.2/B3.3 orders, invoices, clients | NOT STARTED | Needs discovery + staging |
| B4 lifecycle | NOT STARTED | Needs staging |
| B5.2+ (SSO into cart, WHMCS → SPA direction) | NOT STARTED | Deliberately out of scope; see `WHMCS-INTEGRATION.md` §6 |
| C2 + all later sessions | NOT STARTED | Gated on discovery |

Phase-by-phase evidence (implemented / tested / blocked / evidence) is kept in
[`WHMCS-INTEGRATION-REPORT.md`](WHMCS-INTEGRATION-REPORT.md); this audit keeps the plan and the record.

**What is wired into the website today: two routes, no pages.** `GET /api/v1/whmcs/orderability` and the four
`/api/v1/account/whmcs*` identity routes are registered and tested, but no SPA component calls them and the SPA still
renders its own catalogue and checkout. That is stated plainly rather than presented as progress: the next slice
(C2) replaces those price sources service by service, and cannot begin honestly until a real `pid` exists. In the
meantime the orderability endpoint answers `NOT_INTEGRATED` for all 59 advertised services, which is the truthful
state and the same message the SPA already shows.

### Session A — Audit (this document) ✅ complete, reviewed 2026-11-08

| Step | Slice | Output | State |
| --- | --- | --- | --- |
| A1 | Repository + WHMCS-surface inventory | §2, §3 | done |
| A2 | Service inventory and mapping table | §5 | done |
| A3 | Interactive-element disconnection register | §6 | done |
| A4 | Provider/credential gap register | §7 | done |
| A5 | Architecture options + plan | §8, §9 | done |

### Session B — Central WHMCS integration layer (server-side, no credentials required to build)

| Step | Slice | Deliverable | Tests | Exit criteria |
| --- | --- | --- | --- | --- |
| B1 Config | B1.1 | `src/whmcs/config.ts` — `WHMCS_API_URL`, `WHMCS_API_IDENTIFIER`, `WHMCS_API_SECRET`, timeouts, `WHMCS_MODE=read-only\|full`; startup refuses `full` without both; `.env.example` updated (names only) | unit: missing/invalid config fails closed | No secret reaches any frontend bundle (grep test over `frontend/dist`) |
| B1 | B1.2 | `src/whmcs/client.ts` — POST form to `includes/api.php`, 10 s timeout, response-code taxonomy, retry only for idempotent reads (3 attempts, jitter), circuit breaker, redacted structured logging, per-request `request_id` | fake transport: timeout, 500, HTML error page, `result=error`, malformed JSON, slow response | Every failure mode produces a typed error, never a success |
| B1 | B1.3 | Idempotency store (migration `0086_whmcs_operations.sql`): `operation_key UNIQUE`, `request_id`, `whmcs_ref`, `state`, `attempts`, `created_at` | unit: same key twice → one upstream call, second returns stored result | Replaying checkout/payment cannot double-charge |
| B1 | B1.4 | Response schemas (zod) for every action used; drift test against recorded fixtures | unit: schema rejects a missing `pid`, a negative price, an unexpected `result` | No unvalidated shape reaches a route |
| B2 | B2.4 | Public read endpoint for service orderability + WHMCS status, consumed by the plan block | unit + integration | A page cannot render a buy button without a verified binding |
| B2 Catalogue | B2.1 | `whmcs/catalogue.ts`: `GetProductGroups`, `GetProducts`, per-currency pricing, available cycles only | fake fixtures incl. product with 3 cycles and one with 0 prices | A product with no price is never rendered with a price |
| B2 | B2.2 | `whmcs/pricing.ts` + currency: currency-aware conversion, checkout currency locked per session | unit: requested currency ≠ confirmed currency → refuse | Never charge in a currency other than the confirmed one |
| B2 | B2.3 | Configurable-options reader (`GetProductConfigOptions`-equivalent via client area or `tblproductconfig*` through an addon) | unit + contract | "Configure" is possible from the website with the selection preserved |
| B3 Commerce | B3.1 | `whmcs/cart.ts` — server-side cart *intent* (pid, cycle, options, qty) that renders a signed WHMCS cart URL; no price is ever computed locally | unit: intent → URL contains pid+cycle+options; tampering is rejected | Hand-off preserves product, cycle and options |
| B3 | B3.2 | `whmcs/orders.ts` / `invoices.ts` / `payments.ts` — read-only `GetOrders`, `GetInvoice`, `GetTransactions` for account views | unit against fixtures | Dashboard shows WHMCS truth, not a mirror |
| B3 | B3.3 | `whmcs/clients.ts` — `GetClientsDetails`, `GetClientsProducts`, `GetClientsDomains`; ownership check on every request | unit: client A cannot read client B | Authorization enforced server-side |
| B4 Lifecycle | B4.1 | `whmcs/services.ts` — `ModuleSuspend\|Unsuspend\|Terminate` wrappers, **admin-only**, idempotent, reconciled before retry | unit: ambiguous response → reconcile, never blind retry | No blind retry on ambiguous provisioning |
| B4 | B4.2 | `whmcs/tickets.ts` — `OpenTicket`, `GetTickets`, `AddTicketReply` | unit + fixture | Support works in both surfaces |
| B4 | B4.3 | `whmcs/domains.ts` — availability/registration/transfer/renewal through WHMCS registrar; refuse when no registrar is configured | unit: no registrar → typed `REGISTRAR_NOT_CONFIGURED`, no fake availability | No simulated domain results |
| B5 SSO | B5.1 | Hand-off design + implementation: WHMCS-issued one-time token → SPA session (or SSO into client area), server-verified, single-use, short TTL | unit: replay, expiry, wrong audience | No WHMCS password stored or exposed; ownership verified per request |

### Session C — Discovery and verified mapping (requires WHMCS staging)

| Step | Slice | Deliverable | Exit criteria |
| --- | --- | --- | --- |
| C1 | C1.1 | `scripts/whmcs/discover-catalogue.ts` → `config/whmcs/product-map.json` (read-only `GetProducts`/`GetProductGroups` + `servertypeid`→`tblservers.type`) | Artifact carries `retrieved_at`, `whmcs_version`, `sha256`; **no hand-entered IDs** |
| C1 | C1.2 | Mapping completeness test: every `service_key` advertised on either frontend is present, or explicitly listed as `NOT_MAPPED` with a reason | Test fails on an unmapped advertised service |
| C2 | C2.1 | Wire each hosting/cloud/SSL/email service page to its group (PHP: `product_group` in the content store; SPA: catalogue slug) | Page shows the group's real products and prices |
| C2 | C2.2 | Wire each domain surface to the registrar-backed flow | Availability and prices come from WHMCS, not a third-party WHOIS tool |
| C2 | C2.3 | Wire upgrades/downgrades, renewals, cancellation to WHMCS client-area routes | Each action lands on the correct WHMCS page with the service pre-selected |

### Session D — Catalogue and pricing synchronisation

| Slice | Deliverable | Exit criteria |
| --- | --- | --- |
| D1 | Sync job (worker) writing a cached catalogue with TTL + last-known-good | Price change in WHMCS appears without a frontend deploy; stale cache is labelled stale, never shown as current |
| D2 | Cache invalidation on admin change + drift alarm | Drift between cache and WHMCS is detected and logged |
| D3 | Currency/cycle matrix tests | All six cycles; only configured cycles rendered; per-currency prices correct |
| D4 | Availability/visibility sync (`hidden`, stock, `availability_status`) | Hidden product never rendered; unavailable product says so |

### Session E — Every button and link

| Slice | Deliverable | Exit criteria |
| --- | --- | --- |
| E1 | `scripts/audit/interactive-elements.mjs` — enumerates every `<a>`, `<button>`, form submit, `navigate()` in both frontends; classifies each as `whmcs-order\|whmcs-account\|internal\|external\|in-page\|no-action` | Fails on any element that is none of these |
| E2 | Click-probe harness for the PHP surface (headless Chromium against a stub WHMCS render) + existing SPA probe | 0 no-effect buttons not on the documented allow-list |
| E3 | Fix the register: D3-D9 in §6.1 | Each row closed with evidence |
| E4 | Preserve-state test: plan → configure → cycle → cart | Selection survives every navigation |

### Session F — Customer account and authentication

| Slice | Deliverable | Exit criteria |
| --- | --- | --- |
| F1 | SSO (B5.1) integrated into login/register/logout/password reset | One identity; no second password store |
| F2 | Dashboard backed by WHMCS reads: services, domains, invoices, transactions, tickets, renewals, upgrades, cancellation | Every panel's data traced to a WHMCS call |
| F3 | MFA/passkey: WHMCS passkey addon is the authority | No divergent second MFA |
| F4 | Authorization matrix tests | Customer A cannot reach customer B's service/invoice/ticket via any route |

### Session G — Order → payment → provisioning lifecycle

| Slice | Deliverable | Exit criteria |
| --- | --- | --- |
| G1 | End-to-end trace with a stub WHMCS: select → configure → cart → account → billing info → tax → gateway → order → invoice → payment → accepted → provisioning → active → notification | Each of the 18 steps in the directive produces a recorded event |
| G2 | Pending/failed/cancelled/disputed/refunded states surfaced honestly | No state shown as paid without a WHMCS payment record |
| G3 | Unpaid-order guard | No provisioning for an unpaid order unless the product's configured rule permits it |
| G4 | Reconciliation runbook for ambiguous payment/provisioning | Document + test |

### Session H — Administration

| Slice | Deliverable | Exit criteria |
| --- | --- | --- |
| H1 | Confirm admin operations live in WHMCS (product/group/price/cycle/option CRUD, suspend/unsuspend/terminate, upgrade, order/invoice/refund review, domains, provisioning monitor, tickets) | Operators can run the catalogue without touching the frontend |
| H2 | Remove/redirect any SPA admin surface that duplicates a WHMCS admin function | No double-entry of the same product |
| H3 | Sync-from-WHMCS test | A change in WHMCS appears on the site with no code edit |

### Session I — Design and UX

| Slice | Deliverable | Exit criteria |
| --- | --- | --- |
| I1 | Per-service plan display with real prices, correct cycles, working order button | Visual regression clean at 1440/834/390 |
| I2 | Plan comparison + preserved selection | Compare → choose → checkout keeps state |
| I3 | Honest states everywhere (no catalogue, no provider, stale) | Screenshots captured as evidence |

### Session J — Automated testing and staging verification

| Slice | Deliverable | Exit criteria |
| --- | --- | --- |
| J1 | The 20 required tests from the directive, mapped 1:1 to a file and a command | Index table in the report |
| J2 | Staging run: connectivity, catalogue, cart, order (test gateway), invoice, provisioning (sandbox provider), status sync, domain (sandbox registrar), SSL (sandbox CA), upgrade, cancel, ticket, dashboard, downtime/recovery | Evidence captured per test; failures documented, not hidden |
| J3 | Downtime drill: WHMCS unreachable for N minutes | Site degrades to labelled unavailable states; no false success; recovery verified |

### Session K — Final report

`docs/WHMCS-INTEGRATION-REPORT.md` with the service-by-service matrix (Service, WHMCS product ID, Provider,
Provisioning module, API integration, Frontend connection, Order/Payment/Provisioning/Renewal tests, Final
status, Evidence) using exactly: `NOT STARTED`, `IN PROGRESS`, `FRONTEND CONNECTED`, `WHMCS CONNECTED`,
`PROVIDER CONNECTED`, `STAGING VERIFIED`, `PRODUCTION VERIFIED`, `BLOCKED`.

---

## 10. Test strategy

| Layer | Existing (green today) | Added by this project |
| --- | --- | --- |
| Static links | `scripts/site/check-links.mjs` — 2,240 surfaces, 0 broken | extended to classify commerce intent |
| Catalogue honesty | `tests/website/test_catalogue_honesty.py` (21) | same rules applied to the SPA and to the WHMCS gateway |
| Account contract | `tests/website/test_account_pages.py` | + SSO hand-off contract |
| Cart skin | `tests/website/test_cart_skin.py` | + cycle/option preservation |
| PHP syntax | `scripts/php-lint-targets.sh` (838 targets, WASM) | unchanged, run per slice |
| Node unit/integration | 189 Vitest files | + `src/whmcs/*` suites with a fake transport |
| Interactive elements | SPA click-probe (281 buttons) | E1/E2 both surfaces |
| Staging | none possible here | the 20 tests in Session J |

Rule: a slice is not complete until its test fails when the slice is reverted. Where a test cannot fail (e.g. a
"no fake price" assertion against an empty catalogue), a negative fixture is added that must trip it.

---

## 11. Risks, stop conditions, definition of done

| Risk | Mitigation |
| --- | --- |
| Wrong product ID sends a customer to the wrong product | IDs only from the checksummed discovery artifact; a mismatch test; no hand-typed IDs |
| Two carts live at once during transition | Feature flag per service key; a service is either WHMCS-owned or SPA-owned, never both; flag assertion in E1 |
| Customers stranded between two identities | SSO slice B5.1 before any SPA commerce is retired; explicit "where is my account" copy |
| WHMCS downtime shows as a broken shop | B1.2 circuit breaker + J3 drill; labelled unavailable states |
| Retry/duplicate charges | B1.3 idempotency; reconcile-before-retry in B4.1; no live gateway without authorisation |
| Domain/SSL advertised with no provider | C2.2/C2.3 typed `NOT_CONFIGURED`; no simulated availability or issuance (already the SPA's behaviour; extend to PHP) |
| RDP vendor module reports fake success | restore the secure rebuild or keep the product unlisted (§7) |
| Claiming staging verification we did not do | status vocabulary limited to evidence actually collected; §1.3 classes cited per row |

**Definition of done (mirrors directive Session 11).** Every advertised service has a verified map row; every
product shows the WHMCS price; every order button starts the correct WHMCS workflow; provisioning is connected or
marked BLOCKED; accounts connect; checkout/payment work; statuses sync; renewals and upgrades work; support works;
no critical button disconnected; no simulated success; no credential in frontend code; automated tests pass; staging
evidence exists; failures documented.

---

## Appendix A — Commands and outputs (verbatim excerpts)

```
$ node scripts/site/check-links.mjs
link integrity: 2240 surfaces · 977 internal · 1017 PHP · 5 external · 19 in-page anchors
excluded from enforcement (vendor/dev surfaces, reported not fixed): … 722 hrefs
5 note(s): (5 external HTTP links in legal templates — guidance URLs)
✓ no broken, placeholder or dangling links

$ python3 -m unittest tests.website.test_static
Ran 23 tests in 3.817s — OK

$ python3 -m unittest tests.website.test_catalogue_honesty
Ran 21 tests in 0.015s — OK (skipped=8)   # rendered fixtures absent without WHMCS

$ ./scripts/php-wasm/php -v
PHP 8.2.33 (cli) (built: Aug 27 2026 22:15:56) (NTS)

$ ls modules/addons | wc -l        → 23
$ ls modules/servers               → 14 modules
$ ls modules/gateways              → blockonomics, callback  (no registrar directory)
$ ls *.php | wc -l                 → 84
$ git ls-files | wc -l             → 9004
$ ls cloudhost247-node/src/routes/*.ts | wc -l → 53
$ ls cloudhost247-node/database/migrations/*.sql | wc -l → 85
```

## Appendix B — Service page inventory (exhaustive)

### B.1 SPA service/marketing pages — 55 pages; **12** embed a live plan block, **2** render the product
catalogue section, and every commerce path terminates in the SPA cart (never WHMCS)

| Route | Title | Family | Live plan block | Catalogue section |
| --- | --- | --- | --- | --- |
| `/cloud` | Cloud & Servers | cloud | — | — |
| `/cloud/backups` | Server & Cloud Backups | cloud | — | — |
| `/cloud/data-centers` | Data Centers | cloud | — | — |
| `/cloud/enterprise-servers` | Enterprise Servers | cloud | — | — |
| `/cloud/firewall` | Firewalls | cloud | — | — |
| `/cloud/game-servers` | Game Servers | cloud | — | — |
| `/cloud/infrastructure` | Infrastructure | cloud | — | — |
| `/cloud/ip-management` | IP Management | cloud | — | — |
| `/cloud/managed-services` | Managed Services | cloud | — | — |
| `/cloud/monitoring` | Monitoring | cloud | — | — |
| `/cloud/network` | Network | cloud | — | — |
| `/cloud/operating-systems` | Operating Systems | cloud | — | — |
| `/cloud/private` | Private Cloud | cloud | private-cloud | — |
| `/cloud/public` | Public Cloud | cloud | public-cloud | — |
| `/cloud/security` | Cloud Security | cloud | — | — |
| `/cloud/server-management` | Server Management | cloud | — | — |
| `/developers` | Developer Platform | developers | — | — |
| `/developers/deployment` | Application Deployment | developers | — | — |
| `/developers/docker` | Docker Hosting | developers | — | — |
| `/developers/environments` | Application Environments | developers | — | — |
| `/developers/laravel` | Laravel Hosting | developers | — | — |
| `/developers/nodejs` | Node.js Hosting | developers | — | — |
| `/developers/php` | PHP Hosting | developers | — | — |
| `/developers/python` | Python Hosting | developers | — | — |
| `/hosting` | Hosting | hosting | — | yes |
| `/hosting/api` | API Hosting | hosting | — | — |
| `/hosting/backups` | Backups | hosting | — | — |
| `/hosting/business` | Business Hosting | hosting | business-hosting | — |
| `/hosting/developer` | Developer Hosting | hosting | — | — |
| `/hosting/email` | Email Hosting | hosting | email-hosting | — |
| `/hosting/migration` | Website Migration | hosting | — | — |
| `/hosting/reseller` | Reseller Hosting | hosting | reseller-hosting | — |
| `/hosting/security` | Hosting Security | hosting | — | — |
| `/hosting/ssl` | SSL Certificates | hosting | ssl-certificate | — |
| `/hosting/web-hosting` | Web Hosting | hosting | web-hosting | — |
| `/hosting/windows` | Windows Hosting | hosting | windows-hosting | — |
| `/hosting/wordpress` | WordPress Hosting | hosting | wordpress-hosting | — |
| `/platforms` | Platforms | platforms | — | — |
| `/platforms/applications` | Application Hosting | platforms | — | — |
| `/platforms/containers` | Containers & Docker | platforms | — | — |
| `/platforms/databases` | Managed Databases | platforms | — | — |
| `/platforms/paas` | PaaS & Deployment Workflows | platforms | — | — |
| `/hosting/cpanel` | cPanel Hosting | products | cpanel-hosting | — |
| `/hosting/dedicated` | Dedicated Servers | products | dedicated-server | — |
| `/hosting/vps` | VPS Hosting | products | vps-hosting | — |
| `/about` | About CloudHost247 | resources | — | — |
| `/blog` | News & Updates | resources | — | — |
| `/docs` | Documentation | resources | — | — |
| `/help` | Help Center | resources | — | — |
| `/offers` | Offers & Pricing | resources | — | yes |
| `/pricing` | Pricing | resources | — | yes |
| `/search` | Search | resources | — | — |
| `/security` | Security & Compliance | resources | — | — |
| `/status` | Service Status | resources | — | — |
| `/websites` | Websites | resources | — | — |

Domain surfaces (declared in `App.tsx`, no content-page record): `/domains`, `/domains/search`,
`/domains/bulk-search`, `/domains/transfer`, `/domains/whois`, `/domains/extensions`, `/domains/appraisal`,
`/domains/auctions`, `/domains/club`, `/domains/broker`, `/domains/:domain/health`.

### B.2 PHP routes — 84 files, 48 themed through `PublicPage`

| Renderer | Count | Notes |
| --- | --- | --- |
| `Theme\PublicPage::route(...)` | 48 | 42 have a `site.json` entry; **0** entries carry `product_group`; `all-elements`, `cloudhost247-sample`, `coming-soon`, `future-element`, `tables`, `vps-sample` are unthemed sample routes |
| Custom controllers using `init.php` | 34 | includes `cloudhost247-hosting.php` (the only live-product page), `legal.php`, `site-search.php`, sitemap/robots, `applications.php`, `operating-systems.php`, `deployments.php`, `infrastructure.php`, `server-management.php`, policy pages, `builder-page.php`, `cloudhost247-page.php` |
| Renderers preserved but unreachable | 2 | `dedeicated-server.php` (historical typo path, kept for inbound links) |

### B.3 Mega-menu — 7 groups, 105 items

| Menu | Items | SPA targets missing | PHP targets missing |
| --- | ---: | --- | --- |
| Hosting | 22 | 1 (`Plesk Hosting` — SPA `/hosting/plesk` does not exist) | 0 |
| Cloud & Servers | 19 | 0 | 0 |
| Domains | 14 | 1 (`Domain DNS`) | 0 |
| Platforms | 19 | 1 (`Plesk` — same missing SPA route as above) | 1 (`Managed Databases` has no PHP page) |
| Tools | 3 | 3 (`All Tools`, `Compliance & Document Tools`, `MRZ Generator` are PHP tools routes) | 0 |
| Resources | 17 | 2 (`Knowledge Base`, `Announcements`) | 0 |
| Company | 11 | 0 | 0 |
| **Total** | **105** | **8** | **1** |
