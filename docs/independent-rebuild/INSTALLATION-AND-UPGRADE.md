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
