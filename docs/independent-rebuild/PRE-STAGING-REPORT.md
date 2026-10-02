# Final pre-staging report

Date: 2026-09-27  
Runtime status: **BLOCKED** — no secure WHMCS staging connection. Production deployment: **PROHIBITED**.

## Theme/CMS

**Implemented in source:** WHMCS Twenty-One child theme, standard-cart child, responsive branding, real settings, pages/landing records/sections/navigation/banners/testimonials/footer, publication state, safe custom route, SEO title/description/Open Graph, XML sitemap, native WHMCS account/cart inheritance, sanitization and CSRF-protected admin.

**Partial:** localized CMS, automatic WHMCS-product components, visual preview and drag/drop interface. Numeric section ordering is the supported practical builder.

**Blocked:** every actual WHMCS page, hook, authentication, cart, checkout, browser, accessibility and responsive assertion.

## Currency

**Implemented in source/mock:** ECB and Frankfurter providers, fallback/retry, manual/WHMCS cron/CLI updates, enabled currencies, base, frequency, margin, precision, rounding, conversion, history/comparison, locking, transactions, error/status dashboard and current-WHMCS-rate-only writes.

**Not applicable by safety:** automatic historical invoice or transaction rewriting. Product prices are not changed by currency updates.

**Blocked:** provider network, WHMCS database/hook/admin/cron behavior and live rate comparison.

## OVH

**Implemented in source/mock:** legitimate regional signing/authentication, fixed endpoint boundary, TLS/timeouts/limits, GET rate-limit retries, catalog persistence, normalized available hardware/CPU/RAM/storage/network/regions/OS fields, discovered configuration storage, validated mapping, currency-backed pricing preview and explicitly confirmed/audited apply, checkpointed idempotent provisioning, ambiguous-mutation stop/reconciliation state, pending-order polling and conservative service binding, existing-service search/preview/confirm/audit, duplicate-link prevention, status/details, normalized IPs, reverse DNS manager, reboot, VPS start/stop, explicit termination, known-service sync, locks, cron and dashboard.

**Partial:** catalog shapes and normalized fields are retained only when returned; automatic source-price extraction, automatic WHMCS configurable-option creation, order recovery when checkout response and order ID are both lost, automatic matching of unknown remote services, advanced product-specific operations and granular role UI. Uncertain mutation requires administrator reconciliation rather than risking duplication.

**Not implemented:** reinstall/rescue/snapshot/backup/firewall/IPMI/monitoring/virtual MAC/network boot/interventions/IP moves. These depend on product/API permissions and were not guessed.

**Blocked:** all real OVH and WHMCS behavior, spending, order/service delivery, lifecycle actions and concurrent database execution.

## Automated verification

The CI workflow runs PHP syntax, Foundation/Theme, Currency and OVH unit/mock tests plus Python static/security suites. Mock verification is not real provisioning. Original proprietary reference files remain covered by the 2,535-entry SHA-256 manifest.

## Security result

Source review covers authentication, authorization boundary, CSRF, query safety, XSS, SSRF, redirect/path/command injection, secrets/logs, deserialization, retries, races, duplicate provisioning, file operations, financial writes and migrations. Findings and residual risks are in `SECURITY-REVIEW.md`.

## Remaining staging requirements

1. Verify staging identity and isolation from production.
2. Record exact WHMCS patch, PHP 8.2 and database versions.
3. Confirm and rehearse a restorable file/database backup.
4. Deploy the tested branch commit; activate migrations in order and capture schema diffs.
5. Test every Theme/CMS client/admin route and native account/cart workflow on desktop/tablet/mobile.
6. Test currency providers, failure/fallback, locking, cron, current-rate writes and historical-record invariants.
7. Use least-privilege non-production OVH credentials and disposable products/services.
8. Validate regional catalog shapes, option labels, order routes, prices/currencies and permission rules.
9. Exercise cart/item/checkout failures, timeouts, repeated CreateAccount, polling, binding and manual reconciliation.
10. Exercise status/IP/reverse/reboot/VPS power and termination only on disposable resources.
11. Inspect audit/module logs for secrets and verify admin roles/CSRF.
12. Reconcile database/file backups and perform rollback.

After these steps, issue a PASS/FAIL/PARTIAL/BLOCKED runtime matrix. Until then, no component is production-ready.

## Source-completion addendum

Additional source work implements localized CMS translations with base fallback, safe unsaved CMS preview, optional WHMCS-role capability restrictions, broader conservative OVH normalization, unique source-price resolution, exact configurable-option mapping, safe cart-order discovery and improved service matching. The executable deployment and evidence package is in `STAGING-DEPLOYMENT.md`, `STAGING-TEST-MATRIX.md`, and `scripts/staging-*.php`.

Status vocabulary is strict: **IMPLEMENTED** means owned source plus applicable automated/mock evidence; **STAGING VERIFIED** has no entries; **PARTIAL** identifies intentionally bounded workflows; **BLOCKED — STAGING REQUIRED** covers all WHMCS/browser/database/network claims; **NOT IMPLEMENTED — API/PRODUCT DEPENDENCY** covers advanced OVH operations not safely generalized.

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

## Staging-readiness hardening

Source tooling now provides fail-closed environment identification, runtime preflight, privacy-preserving baseline capture, backup/isolated-restore verification, expanded financial snapshots, explicit expected/unexpected comparison, per-migration validation, and acceptance report generation. These capabilities are **IMPLEMENTED (SOURCE/MOCK TESTED)**. No generated runtime PASS artifact is committed. Secure WHMCS/OVH access, real backup restoration, migrations, browser testing, provider updates, and lifecycle operations remain **BLOCKED — STAGING REQUIRED**.

## Post-freeze source completion batch

**IMPLEMENTED — SOURCE VERIFIED:** a WHMCS-native public hosting/VPS/dedicated catalog now reads only visible WHMCS products with CloudHost247 metadata marked `available` or `limited`, uses current WHMCS currency/pricing rows, presents verified specifications, and links into native WHMCS cart configuration. Missing prices and unknown service kinds fail safely as `NOT VERIFIED`. Client service presentation now includes the validated product kind. CMS localization has non-persistent draft preview with base fallback, and CMS administration includes bounded redacted audit history. Pricing preview evidence now displays current/proposed difference, conversion, margin, precision, rounding, component, cycle, correlation ID, and audit context. Shared safe errors expose only a correlation reference to customers and record bounded structured metadata without exception messages or traces.

**BLOCKED — STAGING REQUIRED:** WHMCS route/template resolution, real catalog prices, browser rendering, cart behavior, CMS runtime, translated preview rendering, administrator workflow, accessibility acceptance, migrations, currency/OVH calls, provisioning, lifecycle and reconciliation remain unverified. No visual drag-and-drop editor was added. No runtime PASS is claimed.

## Secure RDP source module

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** independent `modules/servers/RDP` implementation with allowlisted HTTPS provider client, encrypted WHMCS server-field token input, strict response schemas, 5/20-second network bounds, disabled redirects, 1 MiB response cap, namespaced `cloudhost247_rdp:1.0.0` migration, operation ledger, generation-aware idempotency, ownership checks, read-only reconciliation, redacted audit/error handling and secret-free responsive templates. **SUPERSEDED IN THE TREE 2026-10-02:** at the owner's explicit direction the vendor archive was extracted over this module path and then deleted, so `modules/servers/RDP/RDP.php`, `templates/error.tpl` and `templates/overview.tpl` are now the vendor RDP Arena files (hard-coded `https://www.rdparena.com/payments/resellerapi.php`, redirects followed, no TLS verification option set, no response cap, no idempotency ledger, RDP passwords displayed and emailed, direct writes to `tblcustomfields`/`tblcustomfieldsvalues`/`tblemailtemplates`), and the implementation described in this paragraph remains in the tree but inert — nothing loads `bootstrap.php`, `lib/Api/*`, `lib/Contracts/*`, `lib/Operations/*` or `migrations/V100.php`. It is what should be restored before any staging or production use; see `RDP-SECURE-REBUILD-WORK-ITEM.md` for the cited deltas and the one-command restore.

**BLOCKED — STAGING/API AUTHORIZATION REQUIRED:** provider ownership/licensing, endpoint contract, bearer-token authorization, product IDs, permissions, real create/suspend/unsuspend/terminate semantics, WHMCS module activation, migration execution, UI, concurrency and disposable lifecycle tests. The module must not be activated until these pass. Required migration ordering adds RDP `1.0.0` after the existing Core, Currency, Theme and OVH sequences.
