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
