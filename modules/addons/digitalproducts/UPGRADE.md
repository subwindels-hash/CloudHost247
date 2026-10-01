# Upgrade Guide

This upgrade is intentionally non-destructive and upgrades the existing `modules/addons/digitalproducts/` implementation in place.

## Preserved legacy data

The migration preserves and extends:

- `mod_digitalproducts_products`
- `mod_digitalproducts_files`
- `mod_digitalproducts_licenses`
- `mod_digitalproducts_downloads`
- `mod_digitalproducts_api_tokens`

It adds:

- `mod_digitalproducts_entitlements`
- `mod_digitalproducts_download_tokens`
- `mod_digitalproducts_rate_limits`

## Compatibility notes

- The legacy `product_id` column on `mod_digitalproducts_products` is retained as the WHMCS product ID.
- A new `whmcs_product_id` column is backfilled from legacy `product_id`.
- The legacy `mod_digitalproducts_files` table remains the canonical version/file table to avoid splitting old data into a duplicate version system.
- `current_version_id` is backfilled from `current_file_id`.
- Legacy plaintext license rows still validate; new licenses prefer `license_hash`, `license_prefix` and encrypted ciphertext when WHMCS encryption helpers are available.
- Legacy API tokens are backfilled to `api_token_hash` when the DB supports `SHA2()`.

## Safe upgrade process

1. Back up the WHMCS database and existing private download storage.
2. Deploy the updated module files.
3. Activate/upgrade the addon in WHMCS Admin.
4. Review activation output for applied migrations and storage warnings.
5. Open the Digital Products dashboard and verify counts.
6. Check products and current versions.
7. Test an existing customer service in **My Downloads**.
8. Test secure download token generation and download logging.
9. Test a license validation request.

## Rollback

Deactivation does not drop data or delete files. If rollback is required, restore previous module files and keep the database backup available. New hardening columns/tables can safely remain unused by the older code, but test before production rollback.
