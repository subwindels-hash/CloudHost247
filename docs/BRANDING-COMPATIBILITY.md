# CloudHost247 branding and compatibility register

**Reviewed:** 2026-10-01

**Status:** Source-only rebrand; no production database was accessed or changed.

## Approved naming rules

- **Legal/company name:** `CloudHost247 Isc.` (including the final period).
- **Primary customer-facing brand:** `CloudHost247`.
- **Compact identifier:** `CH247`, where a short technical or visual label is appropriate.
- Do not introduce new HostX branding. The legacy strings below are immutable integration identifiers or historical audit data, not current product branding.

Legal policies, legal notices, copyright/footer copy, the 27 WHMCS language overrides, and the WHMCS company-name migration use `CloudHost247 Isc.`. General customer-facing copy and the Email Hosting display name use `CloudHost247`.

## Intentional legacy references

### 1. Encoded WHMCS page-builder addon

The addon remains at `modules/addons/hostx/`. Its ionCube-encoded entry point defines the WHMCS registration and `hostx_*()` callbacks; those PHP names and the addon path cannot be changed safely without replacing the licensed module. The addon also exposes legacy Smarty variables/classes and the `inner-box-tool-tip-hostx` selector used by the old theme. Three editable tour-label assets and a CSS comment were rebranded, but no encoded PHP, hook, or runtime behavior was changed.

### 2. Legacy theme and its stored data

The old theme is now presented under `templates/cloudhost247_legacy/`, but some internal names remain coupled to the encoded addon and database:

- Smarty variables such as `$hostx_theme_settings` and `$hostx_blocks`, and classes such as `HostxPage`, `HostxBlock`, and `HostxBanner`.
- Legacy partial filenames and block slugs such as `includes/blocks/why_hostx.tpl`; no editable source references this filename, so it is retained until the encoded addon's lookup and any database-stored content are verified in staging.
- The addon-owned tables `mod_hostx_pages`, `mod_hostx_page_products`, `mod_hostx_setting`, and the historically misspelled `mod_hostx_dynmic_translation`.
- Default banner image filenames containing `hostx`; banner records store those filenames, so renaming the files without a data/content migration would break existing banners.
- The original-file integrity inventory records historical names and hashes by design.

These are runtime/database compatibility names. Customer-visible copy, the four main legacy-theme logo PNGs, the offer `host-logo.png`, the legacy portrait art in `for-logo.png`, and the favicon were rebranded in place so existing paths and dimensions continue to work. `for-logo.png` is not referenced by editable source, but its existing path and portrait were retained in case stored theme content uses it. Unrelated third-party/partner artwork (for example WHMCS MarketConnect provider logos) was not altered. The unreferenced `templates/cloudhost247_legacy/images/logo_old.png` renders an `ae server` wordmark rather than CloudHost247/HostX branding, so it was left unchanged. Some editable block titles, footer text, and other theme settings are stored in the encoded addon's database tables; their schema is not available in source, so no blanket SQL replacement was attempted. The static footer fallback is rebranded, but any custom `copyright` block must be reviewed in staging through the theme admin before cutover.

### 3. CloudHost247 Email Hosting WHMCS module

The customer-facing product is **CloudHost247 Email Hosting**, but the module remains at `modules/servers/hostx_email/` with technical WHMCS type `hostx_email`. Existing `tblproducts.servertype`, `tblservers.type`, callback names such as `hostx_email_CreateAccount`, the `$_SESSION['hostx_email_token']` CSRF key, webhook routes, WHMCS module-log ID, and `mod_hostx_email_*` tables are used by current installations. Renaming them without a staged product/server/table migration could orphan services or disrupt provisioning. The `X-Hostx-*` webhook headers are also part of the existing callback contract.

Safe source-level branding changes were made where identifiers are not contracts: the PHP namespace is `CloudHost247\Email`, the internal constants/selectors and user-agent use CH247/CloudHost247, and WHMCS displays **CloudHost247 Email Hosting**. Newly rendered forms use `ch247_email_action`; the handler also accepts the former `hostx_email_action` field as a fallback for cached forms during deployment. The test directory is `tests/cloudhost247_email/`; tests still mention old module identifiers only to verify compatibility.

The existing SQL rebrand script intentionally leaves the Email Hosting type and tables unchanged. It does not constitute a module migration, and no database script was executed during this work.

### 4. Migration literals and historical documentation

`scripts/migrate-legacy-names-to-cloudhost247.sql` must contain old source values when migrating addon registrations and legacy-theme settings. Those values are migration inputs, not branding. The script only changes exact recognized `HostX`, the old no-period `CloudHost247 Isc` spelling, `CloudHost247 Inc.`, and `CloudHost247 Pvt Ltd.` values in `tblconfiguration.CompanyName` to `CloudHost247 Isc.`; it does not rename Email Hosting identifiers, alter customer/product names, or touch credentials.

`docs/independent-rebuild/BRAND-RENAME.md`, prior audit records, and the original-file manifest intentionally describe or hash the old state. They are historical/verification artifacts; their contents are not current customer-facing copy.

## Draft logo assets

No approved full corporate wordmark was supplied in the repository. The three new SVG lockups (`cloudhost247-wordmark.svg`, `cloudhost247-wordmark-white.svg`, and `cloudhost247-banner-wordmark.svg`) are **draft artwork**, pairing the existing CloudHost247 favicon mark with the approved primary wordmark. The four main logo PNGs, the offer `host-logo.png`, the rebranded `for-logo.png` portrait, and the favicon are also draft derivatives; the PNG/ICO paths and dimensions were preserved so existing theme settings continue to resolve. Each SVG source carries a visible-in-source DRAFT comment, and this register labels the full set as unapproved. If an approved corporate vector is supplied, replace the SVG sources and regenerate the raster derivatives before treating the art as final.

## Integrity of original protected files

The baseline `docs/independent-rebuild/original-file-manifest.sha256` was not changed. Branding-only exceptions to that baseline (legal copy, footer, logo assets, and editable tour labels) are listed in `docs/independent-rebuild/rebrand-overrides.list` and verified by `docs/independent-rebuild/rebrand-overrides.sha256`. The release-candidate checker excludes only those explicitly listed paths from the original-baseline comparison and validates their new hashes separately. No encoded PHP or business logic is exempted.

## Database/deployment status

The existing SQL migration was updated to preserve the Email Hosting technical identifiers and to normalize only recognized legacy WHMCS company-name values. It remains unexecuted. Applying any WHMCS migration requires a current backup, staging verification, and review of the actual `CompanyName` value and installed module versions first. No live service, invoice, payment, authentication, or credential data was modified.