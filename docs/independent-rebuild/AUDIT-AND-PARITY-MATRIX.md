# Independent parity rebuild: audit and parity matrix

**Audit date:** 2026-09-27  
**Baseline:** `432989b8e20f65b1db3c2eeadc15cc4b5b736e82`  
**Scope:** the legacy vendor stack (theme, order form, page-builder helper), Xtreme Currency Rates 6.0, and WGS OVH/SoYouStart 8.0.8

## Rules and status vocabulary

This is a clean-room replacement project, not a licence-check patch. Vendor code remains in Git for inventory/migration only and must not be activated or redistributed unless the operator has the relevant rights. Replacement modules will use new names and independently written source. They will not call vendor licensing services or read vendor licence keys. WHMCS licensing and OVH API authentication are explicitly out of scope and remain mandatory.

Status values: **Existing/vendor** (present but not an independent implementation), **Reusable integration** (ordinary WHMCS-facing template/route structure, subject to rights review), **Planned**, **Blocked from verification**, and **Complete**. “Present” never means “parity complete.”

## Repository findings

| Component | Active paths found | Size/shape | Encoding/source visibility | Vendor-key coupling | Independent status |
|---|---|---:|---|---|---|
| Legacy page-builder helper | `modules/addons/[retired-addon]/` | 266 files; 63 PHP | All 63 PHP files are ionCube encoded | Licence/activation behavior cannot be safely inspected statically; `includes/license.php` and `includes/errolicense.php` exist | **Not implemented** |
| Legacy client theme | `templates/cloudhost247_legacy/` | 1,711 files; 279 Smarty templates | Templates/assets readable; 49 directory guard PHP files are not encoded | Runtime data supplied by encoded addon/hooks | **Existing/vendor; rights review required** |
| Legacy order form | `templates/orderforms/cloudhost247_legacy/` | 108 files; 27 templates | Readable | Theme/addon compatibility dependency | **Existing/vendor; rights review required** |
| Xtreme Currency Rates | `modules/addons/xtreme_currency_rates/` | 19 files; 18 PHP | All 18 PHP files ionCube encoded | Explicit `license_verify.php`, security callback and encoded entry point | **Not implemented** |
| WGS OVH admin | `modules/addons/soyoustart/` | 254 files; 32 PHP, 14 templates | Readable source | Explicit `licenseNumtoactivate`, `CheckLicense`, dashboard/status gates | **Existing/vendor only** |
| WGS dedicated server | `modules/servers/soyoustart/` | 49 files | Readable source | Create/client operations query vendor licence and gate execution | **Existing/vendor only** |
| WGS VPS server | `modules/servers/soyoustart_vps/` | 46 files | Readable source | Provisioning/client operations query vendor licence and gate execution | **Existing/vendor only** |
| OVH order form | `templates/orderforms/ovh_cart/` | 78 files; 2 local templates | Readable; inherits WHMCS `standard_cart` | WGS addon exposes order-form entitlement checks | **Existing/vendor; replacement needed** |
| OVH automation | `crons/{getServer,getIpStatus,priceSync,emailSend}.php` | 4 scripts | Readable | Coupled to WGS classes/tables | **Existing/vendor only** |

A SHA-256 inventory of every in-scope original file is in `original-file-manifest.sha256`, and `scripts/release-candidate-check.sh` verifies all 2269 of them byte-for-byte with `sha256sum --check --strict` and **no exemptions**. The approved branding-only changes to legal copy, theme logo assets and three addon tour labels were folded into that baseline by re-cutting it — the manifest header dates each re-cut (2026-09-27 generated, 2026-09-28 legacy rebrand, 2026-10-01 vendor theme-helper retirement) — so it records the current rebranded state. The `rebrand-overrides.list` / `.sha256` side-car this document used to describe was never committed and the checker never implemented an exemption for it; no encoded PHP or business logic was changed. Corrected 2026-10-02 and pinned by `tests/security/test_release_gate_static.py`.

## Installation and configuration dependency inventory

### Legacy vendor stack

* WHMCS document-root pages call `init.php`, select a legacy-theme template, and preserve public routes.
* The WHMCS system theme is `templates/cloudhost247_legacy`; cart theme is `templates/orderforms/cloudhost247_legacy`.
* The helper addon is activated as `the-retired-brand` — the directory and registration keep the vendor name because the ionCube-encoded entry point defines the `the-retired-brand_*()` functions WHMCS calls (see `BRAND-RENAME.md`). Its encoded entry point, hooks, classes, admin pages, sitemap generators, menu defaults and block defaults are runtime dependencies.
* Observed feature/admin entry points: settings, homepage selection, language management, top/side menus, page groups, page blocks, banners, reviews/testimonials, SEO manager/tags/content, TLD settings, category icons, dedicated settings, live chat and sitemap generation.
* Observable compatibility names include the Smarty variables `$[retired]_theme_settings` and `$[retired]_blocks`, the classes `[RetiredPage]`, `[RetiredBlock]` and `[RetiredBanner]`, and the partials under `cloudhost247_legacy_includes/`. The variable and class names are retained unchanged — the encoded helper assigns/calls them.
* ionCube is currently required only to run the vendor helper, not by the proposed replacement.
* Exact schema and licence protocol cannot be derived lawfully/reliably from encoded files. Schema discovery must be performed on an authorised staging database using metadata-only exports.

### Xtreme Currency Rates

* Activated as addon `xtreme_currency_rates`.
* Every PHP file is encoded, including hooks for `AfterCronJob`, `FetchCurrencyExchangeRates`, and `AdminDashboardWidget`.
* Visible admin pages indicate dashboard, module settings, rate history, documentation, update and licence verification.
* Current dependencies include ionCube and a vendor activation flow. Provider names, schemas, rounding/margin semantics and invoice behavior require an authorised black-box staging observation or database metadata export.

### WGS OVH / SoYouStart

* Addon activation name is `soyoustart`; dedicated and VPS server modules are separate.
* Vendor licence setting: `tbladdonmodules(module='soyoustart', setting='licenseNumtoactivate')`; the source calls `Helper::CheckLicense()` and gates addon, cart and provisioning paths.
* OVH authentication is independent from that vendor key and must be retained. The source has API/consumer configuration classes; replacement secrets must remain in WHMCS-encrypted server/addon configuration and never be logged.
* Tables referenced: `mod_soyoustart`, `_configurable`, `_email_log`, `_exchange_rates`, `_imap`, `_ips_orders`, `_license`, `_log`, `_operatingsys`, `_pricesetting`, `_product_settings`, `_products`, `_seenMessage`, `_servers_ips`, `_setting`, plus `tbl_soyoustart` and normal WHMCS product/pricing/service tables.
* Provisioning exports observed: create, renew, terminate and reboot for dedicated; create, renew, suspend, unsuspend, terminate, power on/off, reboot, rescue reboot and console for VPS; both expose admin/client service panels.
* Admin classes cover API calls, configuration, consumers, email templates, existing servers, orders, products and server status. Cron names indicate inventory, IP status, price and email processing.
* OVH API credentials and consumer tokens are legitimate authentication and are **not** to be removed or bypassed.

## Original-versus-replacement parity matrix

| Area | Original capability evidenced | Independent replacement acceptance criterion | Status |
|---|---|---|---|
| Theme shell | WHMCS client/header/footer/account pages, responsive assets | New CloudHost247 theme supports current target WHMCS pages, accessibility and mobile layouts | Planned |
| Routes | Root PHP marketing/legal/product routes | Existing URLs return equivalent CloudHost247 pages without CloudHost247 runtime | Reusable structure; replacement planned |
| Branding/settings | Colors, typography, logo, layouts, custom CSS/JS | Admin settings with validation, safe output encoding and defaults | Planned |
| Navigation | Top menu, side menu, category icons, mega-menu partials | Ordered nested menus, visibility, translations and WHMCS links | Planned |
| CMS/pages | Page groups, homepage selection, editable blocks | Draft/publish pages and ordered reusable sections; safe HTML policy | Planned |
| Page builder | Drag/drop block library and defaults | Practical section reorder/configure/preview; no vendor JS dependency | Planned |
| Banners | Banner admin and theme assets | CRUD, scheduling, links, alt text and responsive rendering | Planned |
| Testimonials | Reviews/testimonial CRUD and images | Moderated CRUD, ordering and accessible rendering | Planned |
| SEO | Per-page tags/content, OG images, sitemap classes | Title/description/canonical/robots/OG and sitemap generation | Planned |
| Domains/TLDs | TLD settings and domain pages | WHMCS domain pricing/search integration without copied business logic | Planned |
| Legal pages | Existing branded legal routes/templates | Preserve routes/content subject to content-rights review | Existing files; runtime test pending |
| Cart | CloudHost247 order flow | Current-WHMCS cart/configure/checkout/complete flow, CSRF-safe | Planned |
| Currency providers | Encoded provider configuration/API | Provider interface; at least ECB-compatible and configurable HTTP provider; timeouts/retries | Planned |
| Auto/manual rates | Cron and manual update hooks | Idempotent manual/cron jobs, base normalization and transactional write | Planned |
| Conversion | WHMCS currency integration | Decimal-safe conversion; base rate invariant; no silent partial updates | Planned |
| Margins/rounding | Requested parity; encoded implementation | Per-currency/provider margin and explicit precision/rounding rules | Planned; semantics need staging observation |
| Rate history | Admin history page | Immutable run/rate history with source, timestamps and actor | Planned |
| Currency logs/errors | Dashboard widget and cron hooks | Redacted structured logs, status widget, retry-safe errors | Planned |
| Prices/invoices | Requested safe synchronization | Preview/dry run; backups; never rewrite historical paid invoices; documented invoice policy | Planned |
| OVH API auth | API/consumer configuration | Official OVH API signing/token auth, regional endpoint, TLS verification, encrypted secrets | Planned; authentication remains required |
| Catalog import | Product/order/product-setting classes | Preview/import OVH catalog into mapped WHMCS groups/products, idempotently | Planned |
| Pricing sync | Price settings, exchange rates, `priceSync.php` | Dry-run diff, margin/rounding, selected billing cycles/currencies, audit trail | Planned |
| Config options | Product configurable mappings incl. OS/licences/network/storage | Stable OVH-to-WHMCS option mapping without destructive recreation | Planned |
| Existing services | ExistingServer and service tables | Link/reconcile by immutable OVH service ID; no duplicate provisioning | Planned |
| Dedicated provision | create/renew/terminate/reboot | Idempotent state machine, confirmation for destructive calls, WHMCS module results | Planned |
| VPS provision | create/renew/suspend/unsuspend/terminate/power/rescue/console | Equivalent supported lifecycle with scoped client/admin controls | Planned |
| Status | ServerStatus, `getServer.php` | Reconciled state, last successful poll, stale/error indicators | Planned |
| IP management | IP order/status tables and `getIpStatus.php` | List/reverse/failover actions supported by OVH API/product; validation and audit | Planned |
| Client area | Dedicated/VPS client templates | Service details, status, IPs and allowed lifecycle actions; CSRF and ownership checks | Planned |
| Automation | Four cron scripts | WHMCS cron hooks and optional CLI, locks, batching, retries, run logs | Planned |
| Admin controls | Dashboard/import/settings/logs | Role-checked pages, CSRF, pagination, redaction and actionable errors | Planned |
| Compatibility/data | Existing WGS tables and service config | Read-only discovery + explicit migration, backups and rollback; no destructive activation | Planned |
| Vendor keys | Three vendor activation dependencies | Replacement install/config/runtime has no fields/calls for those keys | Planned |
| WHMCS licence | WHMCS core | Unchanged and mandatory | Preserved by design |

## Data-safety and migration contract

1. Replacement modules use new module names (`cloudhost247_theme`, `cloudhost247_currency`, `cloudhost247_ovh`) while migration is validated; vendor modules remain inactive but untouched.
2. Activation only creates namespaced tables. It must not drop/rename vendor or WHMCS tables and must not alter services, invoices, products or prices.
3. Migration starts with backup and dry-run reports, reads legacy records, maps stable IDs, and records checkpoints. Writes are transactional where supported and resumable where APIs are involved.
4. Invoice policy defaults to prospective rates only. Historical invoices and transactions are immutable unless an administrator performs a separate explicit WHMCS-supported operation.
5. OVH destructive lifecycle actions require permission checks, CSRF protection, ownership checks, idempotency keys/state checks and redacted audit logs.
6. Vendor licence values may remain in legacy tables for rollback, but replacement code will neither request nor consume them.

## Verification gaps / staging prerequisites

The repository does not include WHMCS core, a database dump, target-version declaration beyond “WHMCS 8.x,” staging URL, or test OVH credentials. Consequently no honest end-to-end activation, cart, invoice, provisioning, existing-service or cron result can yet be reported. Static audit is complete; runtime parity is not.

Before a staging phase, supply through the deployment environment (not Git/chat): exact WHMCS version and PHP version, a sanitised clone of the database, a staging WHMCS licence, OVH sandbox/test credentials where available, regional API endpoint, and a non-production test product/service. Production credentials must never be committed.

## Phased implementation plan

1. **Foundation:** independent namespaces, schema migrations, capability checks, secret handling, logging, uninstall policy and CI/static tests.
2. **Theme/CMS:** CloudHost247 shell and cart compatibility first; settings, menus, pages/blocks, banners/testimonials, SEO/sitemap; then route-by-route regression.
3. **Currency:** provider abstraction, history/log tables, manual/cron update, margins/rounding, dashboard; dry-run pricing sync and invoice safeguards.
4. **OVH read-only:** signed client, endpoint/credential validation, catalog/status/IP discovery, mapping UI and existing-service reconciliation.
5. **OVH mutations:** dedicated then VPS lifecycle actions, client UI, cron workers, retries/idempotency and audited error handling.
6. **Migration/cutover:** metadata backup, dry runs, sampled reconciliation, dual-read comparison where safe, rollback rehearsal, then disable—not delete—vendor modules.

Each matrix row moves to **Complete** only with source, automated tests and staging evidence. Installation alone is insufficient.

## Phase 1 implementation update — 2026-09-27

| Foundation capability | Implementation | Test status | Remaining/blocker |
|---|---|---|---|
| Independent namespaces/modules | `cloudhost247_core`, `cloudhost247_theme`, `cloudhost247_currency`, `cloudhost247_ovh` | Static structure test passed | Runtime activation needs WHMCS staging |
| Versioned migrations | Shared ordered/transactional migration runner and module `1.0.0` migrations | Namespaced-table and non-destructive tests passed | MySQL/MariaDB execution needs staging |
| Data preservation | Deactivation retains data; no replacement migration drops or alters WHMCS/vendor tables | Static test passed | Backup/restore rehearsal needs staging database |
| Logging | Correlation IDs, structured JSON context, recursive secret redaction, WHMCS module-log fallback for errors | PHP unit test defined; CI pending | Database insertion needs staging |
| Secrets | Redaction policy; OVH module design requires WHMCS encrypted server credential storage | Static prohibited-dependency test passed | Credential validation belongs to Phase 4 |
| Admin security | Authenticated-admin guard, POST-only CSRF guard, role capability repository | Source/static review complete | WHMCS role/token integration needs staging |
| Capability/health checks | PHP, WHMCS, Capsule, cURL, JSON, OpenSSL and entropy checks in admin dashboard | PHP unit test defined; CI pending | Live result needs staging |
| Error reporting | Safe activation errors, retained-data deactivation responses and structured error logger | Source review complete | WHMCS UI behavior needs staging |
| Automated tests | Standalone PHP tests, Python static safety tests, GitHub Actions PHP 7.4 lint/test workflow | Python: 4/4 passed locally; PHP unavailable locally | GitHub Actions will provide PHP lint/unit result |
| Vendor-key independence | Replacement modules expose no vendor-key field/call and do not load original modules | Static scan passed | End-to-end proof needs staging activation |
| WHMCS/OVH auth boundary | No WHMCS core changes; OVH credentials remain required and delegated to encrypted WHMCS server configuration | Design/static review complete | OVH API implementation is Phase 4 |

Phase 1 deliberately implements operational foundations and real activation migrations, not business-feature parity. Theme workflows remain Phase 2, currency update workflows Phase 3, and OVH API/provisioning workflows Phase 4. Those corresponding matrix rows remain **Planned**.

## Phase 2 implementation update — 2026-09-27

The detailed legacy-theme comparison is maintained in `PHASE-2-LEGACY-PARITY.md`. The independent deliverable uses WHMCS-supported child-theme inheritance rather than copying 279 vendor templates: native customer/session/billing pages inherit from the stock `twenty-one` parent, while CloudHost247 owns presentation, homepage/CMS output, settings, navigation and cart styling.

**Implemented in source:** independent client/cart themes, responsive visual system, real settings-to-client CSS/output path, authenticated/CSRF-protected CMS administration, publish/draft content, ordered sections, banners, testimonials, nested navigation, footer blocks, per-page SEO title/description, custom WHMCS ClientArea page route, native account/cart inheritance, output escaping and HTML allowlisting.

**Implemented since that record:** localized CMS, sitemap and Open Graph metadata; the product-query landing component (the theme renders products through the page builder's read-only catalogue reader, one bounded query, and says so when the catalogue is unavailable instead of inventing a price); a visual preview of unsaved settings and content that emits the live custom properties; and drag-and-drop ordering that posts a validated permutation, with a numeric fallback for no-JavaScript admins. Block composition — layout template, assigned pages and widgets — is authorable, which the theme template already consumed but the form never wrote. **Staging-blocked:** every browser/runtime assertion, WHMCS menu/head/footer hook behavior, auth/account/cart workflows and screenshots. These are not marked runtime-verified.

## Independent currency implementation update — 2026-09-27

The source implementation is documented in `CURRENCY-SYSTEM.md`. It provides two independent providers, fallback/retry, validated base/enabled currencies, manual/WHMCS-cron/CLI updates, lease locking, transactional current-rate writes, immutable history, comparison, margins, rounding, conversion, status/error reporting and an authenticated CSRF-protected admin dashboard. Static safeguards prohibit historical invoice, transaction and product-pricing writes.

All source/unit-testable currency capabilities are implemented. Every WHMCS database, hook, provider-network, cron and admin-browser assertion remains **BLOCKED** pending secure staging; no runtime compatibility or production-readiness claim is made. The proprietary Xtreme module remains untouched and is not loaded by this implementation.

## Independent OVH implementation update — 2026-09-27

The detailed evidence-based WGS comparison and replacement status are in `OVH-INTEGRATION.md`. Implemented source includes regional OVH signing/time synchronization, TLS/timeouts/limits, safe GET retries/rate-limit handling, encrypted-WHMCS-server credential resolution, connectivity test, eco/VPS catalog persistence, validated WHMCS mappings, checkpointed/idempotent cart provisioning, dedicated/VPS status/IP/reboot, VPS power operations, explicit termination, non-destructive known-service synchronization, stale-safe locks, CLI cron, admin controls and audit/error records.

**PARTIAL:** automatic configurable-option discovery, normalized hardware/OS/datacenter UI, pricing preview/apply, existing-service link UI, order polling/service-name binding, reverse DNS and advanced product-specific actions. **NOT IMPLEMENTED:** reinstall/rescue/snapshot/backup/firewall/IPMI/monitoring because these are product/permission dependent and must not be invented. All real WHMCS/OVH API claims remain **BLOCKED** pending secure staging and disposable OVH services. WGS code/licensing is untouched and not loaded.

## Final pre-staging parity update — 2026-09-27

OVH partials were reduced with catalog normalization, discovered options, explicit pricing preview/application through CloudHost247 currency rates, existing-service search/preview/confirmed linking, ambiguous-mutation reconciliation states, order polling/binding, normalized IPs and reverse DNS. API/product-dependent advanced operations remain explicitly NOT IMPLEMENTED. Theme now includes Open Graph page metadata and an independent CMS sitemap. See `PRE-STAGING-REPORT.md`, `OVH-INTEGRATION.md`, and `SECURITY-REVIEW.md` for exact IMPLEMENTED/PARTIAL/BLOCKED boundaries.

## Source gap and staging-package update

| Area | Source status | Runtime status |
|---|---|---|
| Localized CMS and safe preview | IMPLEMENTED with base fallback and sanitizer; visual preview of unsaved values | BLOCKED — STAGING REQUIRED |
| Landing product components and ordering | IMPLEMENTED through the page builder reader; drag-and-drop ordering validated server-side | BLOCKED — STAGING REQUIRED |
| Admin capability restrictions | IMPLEMENTED over WHMCS addon-role access | BLOCKED — STAGING REQUIRED |
| OVH regional/product normalization | IMPLEMENTED conservatively for returned fields | BLOCKED — STAGING REQUIRED |
| Source-price extraction | IMPLEMENTED only for exactly one numeric/currency candidate | BLOCKED — STAGING REQUIRED |
| Configurable-option mapping | IMPLEMENTED for exact discovered matches with confirmation | BLOCKED — STAGING REQUIRED |
| Missing-order discovery | PARTIAL: unique cart match only; ambiguity stops | BLOCKED — STAGING REQUIRED |
| Existing-service matching | PARTIAL: ranked suggestions; explicit preview/confirmation remains mandatory | BLOCKED — STAGING REQUIRED |
| Staging deployment/evidence package | IMPLEMENTED in documentation/read-only scripts | BLOCKED — STAGING REQUIRED |

No functionality is marked STAGING VERIFIED. The complete test IDs and evidence fields are in `STAGING-TEST-MATRIX.md`.

## Source management layer update (2026-09-27)

**Project state: SOURCE DEVELOPMENT → STAGING PENDING.** CloudHost247 now includes additive source foundations for confirmed hosting-product metadata, pricing comparison evidence, redacted searchable audit events, currency policy administration, OVH operational filtering/reconciliation evidence, safe customer service states, and audited CMS mutations. WHMCS remains authoritative for products, pricing, billing, ownership, and authentication.

- **IMPLEMENTED (source):** CSRF/role checks, explicit confirmation for consequential writes, namespaced metadata, current-versus-proposed pricing evidence, one-use price previews with stale-price rejection, audit filtering/pagination, bounded operational queries, reconciliation guidance that does not automatically repeat uncertain mutations, localization/preview fallback, output escaping, and secret redaction.
- **PARTIAL:** Product specifications require runtime UI validation; operational next-sync/rate-limit visibility depends on persisted provider evidence; customer lifecycle buttons remain limited to operations already authorized by the server module; visual presentation needs browser evidence.
- **BLOCKED — STAGING REQUIRED:** real migrations/database transactions, WHMCS hooks and client area, browser/accessibility rendering, cron, currency HTTP providers, OVH authentication/API calls, provisioning and lifecycle operations.
- **NOT IMPLEMENTED — API/PRODUCT DEPENDENCY:** provider capabilities not exposed by an authenticated OVH product/API are not guessed; unsafe mutation retry is intentionally unavailable.

Migration ordering is core `1.1.0`, currency `1.0.0 → 1.1.0`, theme `1.0.0 → 1.1.0`, and OVH `1.0.0 → 1.1.0 → 1.2.0 → 1.3.0 → 1.4.0 → 1.5.0`. All migrations are additive/idempotent and retain data on module deactivation. No WHMCS core schema is altered. Before upgrade, back up the database; rollback means restoring that backup and the prior source commit because additive tables/columns are deliberately retained.

## Release-candidate freeze procedure (2026-09-27)

Status: **SOURCE FOUNDATION COMPLETE → RELEASE CANDIDATE → STAGING PENDING**.

The mandatory staging comparison sequence is:

1. Deploy frozen baseline `3a9fbb9` to a positively identified non-production environment.
2. Prove backup restoration and record exact WHMCS, PHP, database, web-server, and extension versions.
3. Clear caches and execute the complete baseline matrix before configuring disposable OVH access.
4. Capture database, browser, cron, financial, client-area, and operation evidence.
5. Upgrade to the final release-candidate commit reported with this batch; do not substitute an unreviewed branch tip.
6. Execute ordered CloudHost247 migrations, repeat affected tests, and compare evidence to baseline.
7. Use only disposable least-privilege OVH resources. Never submit credentials through chat or commit them.

The CI-level `scripts/release-candidate-check.sh` verifies syntax, behavior tests, static/security tests, migration ordering/additive policy, preserved proprietary checksums, embedded-secret patterns, core-schema policy, and diff cleanliness on PHP 7.4 and 8.2. This is source evidence only. Real migrations, WHMCS integration, browser behavior, cron, provider updates, and OVH lifecycle operations remain **BLOCKED — STAGING REQUIRED**.

## Post-freeze source completion batch

**IMPLEMENTED — SOURCE VERIFIED:** a WHMCS-native public hosting/VPS/dedicated catalog now reads only visible WHMCS products with CloudHost247 metadata marked `available` or `limited`, uses current WHMCS currency/pricing rows, presents verified specifications, and links into native WHMCS cart configuration. Missing prices and unknown service kinds fail safely as `NOT VERIFIED`. Client service presentation now includes the validated product kind. CMS localization has non-persistent draft preview with base fallback, and CMS administration includes bounded redacted audit history. Pricing preview evidence now displays current/proposed difference, conversion, margin, precision, rounding, component, cycle, correlation ID, and audit context. Shared safe errors expose only a correlation reference to customers and record bounded structured metadata without exception messages or traces.

**BLOCKED — STAGING REQUIRED:** WHMCS route/template resolution, real catalog prices, browser rendering, cart behavior, CMS runtime, translated preview rendering, administrator workflow, accessibility acceptance, migrations, currency/OVH calls, provisioning, lifecycle and reconciliation remain unverified. No visual drag-and-drop editor was added. No runtime PASS is claimed.

## Secure RDP source module

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** independent `modules/servers/RDP` implementation with allowlisted HTTPS provider client, encrypted WHMCS server-field token input, strict response schemas, 5/20-second network bounds, disabled redirects, 1 MiB response cap, namespaced `cloudhost247_rdp:1.0.0` migration, operation ledger, generation-aware idempotency, ownership checks, read-only reconciliation, redacted audit/error handling and secret-free responsive templates. **SUPERSEDED IN THE TREE 2026-10-02:** at the owner's explicit direction the vendor archive was extracted over this module path and then deleted, so `modules/servers/RDP/RDP.php`, `templates/error.tpl` and `templates/overview.tpl` are now the vendor RDP Arena files (hard-coded `https://www.rdparena.com/payments/resellerapi.php`, redirects followed, no TLS verification option set, no response cap, no idempotency ledger, RDP passwords displayed and emailed, direct writes to `tblcustomfields`/`tblcustomfieldsvalues`/`tblemailtemplates`), and the implementation described in this paragraph remains in the tree but inert — nothing loads `bootstrap.php`, `lib/Api/*`, `lib/Contracts/*`, `lib/Operations/*` or `migrations/V100.php`. It is what should be restored before any staging or production use; see `RDP-SECURE-REBUILD-WORK-ITEM.md` for the cited deltas and the one-command restore.

**BLOCKED — STAGING/API AUTHORIZATION REQUIRED:** provider ownership/licensing, endpoint contract, bearer-token authorization, product IDs, permissions, real create/suspend/unsuspend/terminate semantics, WHMCS module activation, migration execution, UI, concurrency and disposable lifecycle tests. The module must not be activated until these pass. Required migration ordering adds RDP `1.0.0` after the existing Core, Currency, Theme and OVH sequences.

## CloudHost247 Email Hosting — added 2026-09-28

| Component | Path | Independent status |
|---|---|---|
| Email provisioning server module | `modules/servers/cloudhost247_email_hosting/` | **Complete (source/mock verified)** — new independent implementation; no vendor code reused |
| Public email hosting page | `email-hosting.php`, `templates/cloudhost247/cloudhost247-email-hosting.tpl`, `templates/cloudhost247/css/email-hosting.css` | **Complete (source verified)** — live WHMCS products/pricing only |
| Client-area email management | `modules/servers/cloudhost247_email_hosting/templates/overview.tpl` | **Complete (source verified)** — ownership + CSRF enforced |
| Provider adapters | `lib/Providers/{ProfessionalEmail,Microsoft365,GoogleWorkspace}Provider.php` | **Complete (mock verified)** — real Graph/Admin SDK/REST contracts, no SDKs |
| Schema and migrations | `install/schema.sql`, `install/migrations/1.0.0_baseline.sql` | **Complete (source verified)** — `mod_cloudhost247_email_hosting_*` only |
| Automated diagnostics | `tests/cloudhost247_email/run.php` | **Complete** — 59 mock checks in the PHP 7.4/8.2 CI matrix (`count($tests)` in the harness; 58 before the branding pass added the no-legacy-identifier check) |
| Live tenant behaviour | Microsoft 365 / Google Workspace / mail platform | **Blocked from verification** — see `STAGING-TEST-MATRIX.md` rows CH247E-01..CH247E-27 |

The pre-existing `modules/servers/cloudhost247_email` is left untouched and inactive; it owns `mod_cloudhost247_email_accounts` and must never be confused with the active module. The active CloudHost247 Email Hosting module is `modules/servers/cloudhost247_email_hosting` (WHMCS module ID and display name `CloudHost247 Email Hosting`, tables `mod_cloudhost247_email_hosting_*`). It was renamed away from the vendor module ID by the rebrand and `scripts/migrate-legacy-names-to-cloudhost247.sql` moves every existing product/server binding and table in the same maintenance window. Nothing in the hosting, OVH, currency, authentication, checkout or dashboard paths was modified.
