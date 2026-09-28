# Independent rebuild installation and upgrade (project plan)

> The independent modules are not implemented yet. Do not use this document as a production cutover claim.

## Licence and authentication boundary

The replacement installation will never request HostX, Xtreme Currency Rates, or WGS-OVH vendor licence keys. It will continue to require a valid WHMCS installation/licence and valid OVH API credentials for OVH operations.

## Safe preparation

1. Clone production to an isolated staging installation supported by the exact WHMCS/PHP versions.
2. Back up database and files; verify restore before activation.
3. Keep the current `hostx`, `xtreme_currency_rates`, `soyoustart`, and `soyoustart_vps` paths unchanged for audit/rollback, but do not activate unlicensed code.
4. Never commit `configuration.php`, database dumps, OVH application secret/consumer key, WHMCS licence data, or API responses containing customer data.
5. Capture metadata-only schemas and row counts for legacy `hostx*`, `mod_soyoustart*`, and `tbl_soyoustart` tables.

## Intended install sequence

1. Deploy the repository over a licensed WHMCS staging root.
2. Activate the future `cloudhost247_theme`, `cloudhost247_currency`, and `cloudhost247_ovh` addons. Activation will only create their own tables.
3. Configure CloudHost247 branding and select the independent client/cart templates.
4. Configure currency provider(s), base currency, schedule, margins and rounding; run preview then manual update.
5. Configure the OVH regional endpoint and OVH API credentials, test a read-only call, import mappings in preview, then reconcile existing services.
6. Run cart, invoice and cron tests; provision and destroy only designated test services.
7. Cut over after backup/restore and rollback rehearsals. Disable legacy addons; retain files/tables until the retention window closes.

No replacement step will ask for the three vendor keys. Detailed commands and migration versions will be added as each phase is delivered.

## Required staging test record

Record exact WHMCS/PHP/database versions, module commit, tests and timestamps for: activation/upgrade/rollback; admin permissions and CSRF; theme routes and responsive rendering; cart checkout; manual/cron currency runs and provider failure; price preview; invoices unchanged; OVH credential failure; catalog import idempotency; existing-service reconciliation; lifecycle actions; IP/status sync; concurrent cron lock; log secret redaction; and full restore.

## Phase 1 foundation installation

The Phase 1 modules now exist and can be activated on staging in this order:

1. Copy `modules/addons/cloudhost247_core` and the three `cloudhost247_*` feature addon directories into the matching WHMCS path.
2. In **System Settings → Addon Modules**, activate **CloudHost247 Foundation** first.
3. Grant only the intended administrator roles access to the addon.
4. Activate **CloudHost247 Theme Manager**, **CloudHost247 Currency**, and **CloudHost247 OVH**.
5. Open the Foundation dashboard and confirm required health checks. cURL is expected before currency/OVH network features are enabled.
6. Confirm that the `mod_cloudhost247_*` tables were created and the legacy tables are unchanged. Keep a before/after schema report.

Activation is idempotent: migration versions are recorded in `mod_cloudhost247_migrations`. Deactivation intentionally retains all replacement data for rollback and never removes WHMCS or legacy vendor data. There is no uninstall/drop operation in Phase 1.

The replacement module forms do not contain fields for HostX, Xtreme Currency Rates, or WGS-OVH licence keys. Do not enter OVH secrets until Phase 4 credential configuration is available; they must ultimately be stored through WHMCS encrypted server configuration, never in source or logs.

Run the foundation checks with:

```bash
php tests/foundation/run.php
python3 -m unittest -v tests/foundation/test_static.py
```

GitHub Actions additionally lints every new PHP file on PHP 7.4. Runtime activation and database assertions must be performed against the supported WHMCS staging environment before Phase 1 is marked staging-verified.

## Phase 2 theme installation and rollback

Requirements: WHMCS 8.1 or later with stock `twenty-one` and `standard_cart` themes, plus an activated Phase 1 foundation.

1. Back up files/database and deploy `cloudhost247-page.php`, `templates/cloudhost247`, `templates/orderforms/cloudhost247`, and the updated `modules/addons/cloudhost247_theme`.
2. Deactivate/reactivate Theme Manager only if its initial migration has never run; otherwise opening it uses the existing schema. No legacy table is read or changed.
3. Configure branding and create content in **Addons → CloudHost247 Theme Manager**. Keep items as drafts until reviewed.
4. In WHMCS general settings select **CloudHost247** as the client theme. Select **CloudHost247 Cart** for the relevant product groups/general ordering settings.
5. Clear WHMCS template cache. Test anonymous/authenticated pages, cart and every role on staging before cutover.
6. For rollback, select `twenty-one` and `standard_cart` again and disable Theme Manager. Data and original themes remain intact; no database rollback is required.

Do not select or activate HostX. No HostX key is requested by this installation.

## Secure staging package (source update)

Follow `STAGING-DEPLOYMENT.md` and execute `STAGING-TEST-MATRIX.md`. Before tests, run the read-only preflight and protected-financial snapshot from outside the public webroot:

```bash
CH247_STAGING_CONFIRM=YES CH247_BUILD_COMMIT=<exact-hash> php scripts/staging-preflight.php /path/to/staging
CH247_STAGING_CONFIRM=YES CH247_BUILD_COMMIT=<exact-hash> php scripts/staging-financial-snapshot.php /path/to/staging > /secure/evidence/financial-before.json
```

Repeat the financial snapshot after currency/OVH tests and compare hashes. These scripts output versions, aggregate row metadata and hashes—not credentials or customer row contents. The required extensions, database baseline, permissions, backup/restore, migration, cache clearing, cron, health checks and rollback are specified in `STAGING-DEPLOYMENT.md`.

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

## Mandatory staging evidence gate

Installation or upgrade is prohibited unless `staging-preflight.php` positively verifies the allowlisted URL, identity, database marker, runtime, document root, directories, extensions, database, modules/templates/migrations, addon state, and presentation state. Baseline `3a9fbb9` must be captured before upgrade to frozen RC `83de4e15d513c56128889d429350da83d46ad1fc`. A readable backup is insufficient: `staging-backup-verify.php` must run through the isolated restored WHMCS runtime and verify required tables. Rollback always restores the proven staging backup and prior files; modules do not destructively remove data.

## Post-freeze source completion batch

**IMPLEMENTED — SOURCE VERIFIED:** a WHMCS-native public hosting/VPS/dedicated catalog now reads only visible WHMCS products with CloudHost247 metadata marked `available` or `limited`, uses current WHMCS currency/pricing rows, presents verified specifications, and links into native WHMCS cart configuration. Missing prices and unknown service kinds fail safely as `NOT VERIFIED`. Client service presentation now includes the validated product kind. CMS localization has non-persistent draft preview with base fallback, and CMS administration includes bounded redacted audit history. Pricing preview evidence now displays current/proposed difference, conversion, margin, precision, rounding, component, cycle, correlation ID, and audit context. Shared safe errors expose only a correlation reference to customers and record bounded structured metadata without exception messages or traces.

**BLOCKED — STAGING REQUIRED:** WHMCS route/template resolution, real catalog prices, browser rendering, cart behavior, CMS runtime, translated preview rendering, administrator workflow, accessibility acceptance, migrations, currency/OVH calls, provisioning, lifecycle and reconciliation remain unverified. No visual drag-and-drop editor was added. No runtime PASS is claimed.

## Secure RDP source module

**IMPLEMENTED — SOURCE/MOCK VERIFIED:** independent `modules/servers/RDP` implementation with allowlisted HTTPS provider client, encrypted WHMCS server-field token input, strict response schemas, 5/20-second network bounds, disabled redirects, 1 MiB response cap, namespaced `cloudhost247_rdp:1.0.0` migration, operation ledger, generation-aware idempotency, ownership checks, read-only reconciliation, redacted audit/error handling and secret-free responsive templates. No code from `RDP.zip` was copied; the archive remains unchanged and inactive.

**BLOCKED — STAGING/API AUTHORIZATION REQUIRED:** provider ownership/licensing, endpoint contract, bearer-token authorization, product IDs, permissions, real create/suspend/unsuspend/terminate semantics, WHMCS module activation, migration execution, UI, concurrency and disposable lifecycle tests. The module must not be activated until these pass. Required migration ordering adds RDP `1.0.0` after the existing Core, Currency, Theme and OVH sequences.

## Central API & Integrations centre

Reference: [API-INTEGRATIONS.md](API-INTEGRATIONS.md) (per-provider credentials, scopes, endpoints, rotation, failure handling) and [API-INVENTORY-AUDIT.md](API-INVENTORY-AUDIT.md) (repository credential audit).

**Prerequisites.** PHP with OpenSSL and `aes-256-gcm` available. Before activation, set in the deployment environment (systemd unit, PHP-FPM pool, container secret — never in the repository):

| Variable | Required | Value |
|---|---|---|
| `CH247_INTEGRATIONS_KEY` | yes | 32+ random bytes as hex, base64 or a long passphrase (`head -c 32 /dev/urandom \| base64`). May instead be `$ch247_integrations_key` in `configuration.php`. |
| `CH247_PLATFORM_ENVIRONMENT` | recommended | `development`, `staging` or `production`. Unset is treated as `production`. |
| `CH247_INTEGRATION_ALLOW_PRIVATE_HOSTS` | no | `1` only when an integration must reach an internal control panel. |

**Install sequence.** Activate after Core and before the dependent modules are switched over:

1. Activate **CloudHost247 Foundation** (`cloudhost247_core`) — supplies the audit log and capability policy.
2. Activate **CloudHost247 API & Integrations** — runs migration `1.0.0` and creates `mod_cloudhost247_integrations`, `mod_cloudhost247_integration_secrets`, `mod_cloudhost247_integration_events`.
3. Under **CloudHost247 Foundation → Administrator role capabilities**, restrict `integrations.*` to the Super Admin role IDs.
4. Configure each provider you actually use, for the `production` environment, and press **Test** until it reports `Connected successfully`. Leave unused providers unconfigured.
5. Upgrade OVH to migration `1.6.0` (adds the nullable `integration_key` / `integration_environment` columns to `mod_cloudhost247_ovh_endpoints`) and tick *Use central OVH credentials* on each endpoint you want to migrate.
6. Schedule the verification cron: `0 */6 * * * php /path/to/whmcs/crons/cloudhost247_integrations.php production`.
7. Clear the legacy credential copies — the WHMCS server record for RDP, the deprecated LTE proxy product configuration options — so exactly one copy of each credential exists.

**Upgrade safety.** Every migration is additive and `hasTable`-guarded; deactivation retains all data. Each migrated module keeps its legacy credential source as an explicit fallback, so an upgrade that has not yet been configured centrally continues to work unchanged. Rotating `CH247_INTEGRATIONS_KEY` does not destroy anything: credentials encrypted under the previous key are flagged in the UI as *"Encrypted with a previous master key"* and must be re-entered.

**Rollback.** Deactivate the addon. Dependent modules fall back to their legacy credential sources (WHMCS server record for RDP and OVH, product configuration options for the LTE proxy, documented public endpoints for the currency providers). No table is dropped.

**BLOCKED — STAGING REQUIRED:** migration execution on MySQL/MariaDB, WHMCS activation, role-capability behaviour, live provider connection tests, cron scheduling and the per-module credential cut-over.
