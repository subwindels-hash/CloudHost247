# Database Schema

Migrations are tracked in the CloudHost247 Foundation migration ledger under module `digitalproducts`. Activation and upgrade are non-destructive.

## Existing tables retained and hardened

### `mod_digitalproducts_products`

Legacy `product_id` is retained and mirrors the WHMCS product ID. New code prefers `whmcs_product_id`.

Important columns:

- `id`
- `product_id` (legacy WHMCS product id)
- `whmcs_product_id`
- `product_name`
- `name`
- `slug`
- `description`
- `short_description`
- `product_type` (`module`, `plugin`, `theme`, `script`, `software`, `template`, `api`, `document`, `media`, `other`)
- `status` (`draft`, `active`, `inactive`, `retired`)
- `current_file_id` (legacy)
- `current_version_id`
- `download_limit`
- `link_expiry_hours` (legacy)
- `download_expiry_hours`
- `license_enabled`
- `license_expiry_mode`
- `access_mode` (`CURRENT_VERSION`, `PURCHASE_VERSION`)
- `created_at`, `updated_at`

### `mod_digitalproducts_files`

This table remains the canonical version/file table to preserve existing records.

Important columns:

- `id`
- `product_id` (Digital Product id)
- `version`
- `filename` (randomized storage filename)
- `original_name`
- `file_path` (legacy absolute path, not rendered to customers)
- `storage_provider`
- `storage_key`
- `file_hash` (legacy SHA-256)
- `checksum_sha256`
- `file_size`
- `release_notes`
- `changelog`
- `minimum_php_version`, `maximum_php_version`
- `minimum_whmcs_version`, `maximum_whmcs_version`
- `required_extensions`, `required_modules`
- `release_date`
- `download_count`
- `status`
- `created_at`, `updated_at`

### `mod_digitalproducts_licenses`

Important columns:

- `id`
- `product_id`
- `entitlement_id`
- `service_id`
- `client_id`
- `license_key` (legacy / compatibility value)
- `license_hash`
- `license_prefix`
- `license_ciphertext`
- `status` (`active`, `suspended`, `expired`, `cancelled`)
- `domains` JSON
- `domain_limit`
- `activations_limit`
- `activations_count`
- `expires_at`
- `created_at`, `updated_at`

### `mod_digitalproducts_downloads`

Audit log for successful and failed download attempts.

Important columns:

- `id`
- `client_id`, `service_id`, `order_id`
- `product_id`, `version_id`, `file_id`
- `token_id`, `license_id`
- `ip_address`, `user_agent`
- `status` (`success`, `denied`, `expired`, `limit_exceeded`, `invalid_token`, `not_entitled`, `file_missing`, etc.)
- `failure_reason`
- `created_at`, `updated_at`

### `mod_digitalproducts_api_tokens`

- `api_token_hash` is preferred.
- Legacy `api_token` remains accepted for upgrade compatibility.
- `ip_restriction`, `expires_at` and `status` are enforced.

## New tables

### `mod_digitalproducts_entitlements`

Represents a real purchase/access grant.

- `id`
- `product_id`
- `whmcs_product_id`
- `order_id`
- `service_id`
- `client_id`
- `purchase_version_id`
- `access_mode`
- `status` (`active`, `suspended`, `revoked`, `expired`)
- `purchased_at`
- `expires_at`
- `download_limit_override`
- `download_count`
- `last_download_at`
- `created_at`, `updated_at`

Unique business key:

```text
client_id + service_id + product_id
```

### `mod_digitalproducts_download_tokens`

- `token_hash`
- `entitlement_id`
- `file_id`
- `client_id`
- `service_id`
- `product_id`
- `expires_at`
- `used_at`
- `revoked_at`
- `uses`
- `max_uses`
- `created_at`

### `mod_digitalproducts_rate_limits`

Small per-window throttle table for public API abuse protection.

## WHMCS core tables referenced

The module reads WHMCS data from supported Capsule queries against:

- `tblproducts`
- `tblorders`
- `tblhosting`
- `tblclients`
- `tblinvoiceitems`
- `tbladdonmodules`
- `tblemailtemplates`

It does not modify WHMCS core files.
