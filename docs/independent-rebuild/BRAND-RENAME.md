> Historical migration record. Legacy terms below quote immutable WHMCS identifiers, encoded-addon paths, and database names; they are not current customer-facing branding. See `docs/BRANDING-COMPATIBILITY.md` for the current exception register.

# The CloudHost247 rebrand — completion record

Two rename passes have now run. The first (2026-09-27) rebranded the
in-house `hostx_tools`, `hostx_domain_lookup` and `hostx_email` modules.
The second (2026-09-28, this document) completed the rebrand across the
legacy theme, the order form, the page templates, the language packs, the
root pages, the tests and the documentation.

The customer-facing brand is **CloudHost247**. A small set of exact WHMCS
module, database, and encoded-addon identifiers remains only for compatibility;
see `docs/BRANDING-COMPATIBILITY.md`. The legacy theme directories carry the
suffix `_legacy` because the independent CloudHost247 theme already occupies
`templates/cloudhost247` and `templates/orderforms/cloudhost247`; both themes
are kept side by side.

## What was renamed in this pass

    templates/hostx               -> templates/cloudhost247_legacy
    templates/orderforms/hostx    -> templates/orderforms/cloudhost247_legacy

    templates/cloudhost247_legacy/hostx.tpl
                                  -> templates/cloudhost247_legacy/cloudhost247_legacy.tpl
    templates/cloudhost247_legacy/all-element-hostx.tpl
                                  -> templates/cloudhost247_legacy/all-element-cloudhost247.tpl
    templates/cloudhost247_legacy/sslhostx.tpl
                                  -> templates/cloudhost247_legacy/sslcloudhost247.tpl
    templates/cloudhost247_legacy/hostx_includes/
                                  -> templates/cloudhost247_legacy/cloudhost247_legacy_includes/
    templates/cloudhost247_legacy/css/cookies_library_style_hostx.css
                                  -> .../cookies_library_style_cloudhost247.css
    templates/cloudhost247_legacy/js/cookies_library_hostx_file.js
                                  -> .../cookies_library_cloudhost247_file.js
    templates/orderforms/ovh_cart/css/hostx.css
                                  -> templates/orderforms/ovh_cart/css/cloudhost247.css
    modules/servers/soyoustart{,_vps}/assets/css/compatible_hostx.css
                                  -> .../compatible_cloudhost247.css

    all-element-hostx.php         -> all-element-cloudhost247.php
    hostx-sample.php              -> cloudhost247-sample.php
    hostx-vps-sample.php          -> cloudhost247-vps-sample.php
    scripts/rename-hostx-to-cloudhost247.sql
                                  -> scripts/migrate-legacy-names-to-cloudhost247.sql
    docs/independent-rebuild/HOSTX-RENAME.md
                                  -> docs/independent-rebuild/BRAND-RENAME.md
    docs/independent-rebuild/PHASE-2-HOSTX-PARITY.md
                                  -> docs/independent-rebuild/PHASE-2-LEGACY-PARITY.md

## What was rebranded inside the files

* **Legacy theme templates, CSS and JS (1,700+ files):** editable CSS class
  prefixes (`hostx-*` → `cloudhost247-*`), partial include paths, and
  cookie-library asset names were rebranded. The `rtl` flag variable
  (`rtlHostx` → `rtlCloudHost247`), Smarty-facing sidebar flag
  (`sidebarHostxRemove` → `sidebarCloudHost247Remove`) and fallback coupon
  code (`HOSTX40` → `CLOUDHOST247-40`) were updated; the runtime-bound
  `inner-box-tool-tip-hostx` selector remains documented in
  `docs/BRANDING-COMPATIBILITY.md`.
* **Root marketing pages (28 files):** `setTemplate('hostx')` →
  `setTemplate('cloudhost247_legacy')`, template-name comparisons in the
  SoYouStart/OVH client templates, the per-page helper function names
  (`wgs_..._hostx` → `wgs_..._cloudhost247`) and the template-path comments.
* **Language packs (27 files):** the keys `homehostxwebhost` /
  `homehostxwebhosttext` became `homecloudhost247webhost` /
  `homecloudhost247webhosttext` on both sides (lang files and templates),
  and the company name was synchronized across all 27 language overrides (the legal suffix has since been standardized as `CloudHost247 Isc.`).
* **Order form:** the internal `orderforms/hostx/...` include paths and the
  ovh_cart stylesheet link now address `cloudhost247_legacy`.
* **Tests and docs:** the two static tests that pin the protected theme
  path now pin `templates/cloudhost247_legacy`; documentation prose was
  rewritten so it stays true after the rename (see the semantic fixes in
  the commit).
* **Integrity manifest:** `docs/independent-rebuild/original-file-manifest.sha256`
  was regenerated — paths moved with the files and the 58 rebranded files
  got new hashes. It verifies clean against the new tree.

## What was deliberately NOT renamed, and why

**The ionCube-encoded page-builder helper — `modules/addons/hostx/`
(266 files, 63 encoded PHP).** WHMCS loads an addon as
`modules/addons/<name>/<name>.php` and calls `<name>_config()`,
`<name>_activate()`, `<name>_output()` and friends. Those function names
are baked into the encoded vendor bytecode and cannot be changed without
the vendor's source. Renaming the directory would deactivate the addon,
kill the page-builder admin, and break the `defaultmenu.php` include that
every root marketing page depends on.

**The four data tables the encoded helper owns and queries:**
`mod_hostx_pages`, `mod_hostx_page_products`, `mod_hostx_setting`,
`mod_hostx_dynmic_translation`. The root pages query them in plain PHP and
were kept pointed at the same names: renaming the tables would break every
query the encoded helper issues.

**Smarty variables the encoded hooks assign at runtime:**
`$hostx_theme_settings`, `$hostx_blocks`, `$hostxcurrentpagelink`.
The legacy templates still read these names; renaming only the template
side would blank the settings and every block.

**Block template names under `templates/cloudhost247_legacy/includes/blocks/`:**
`hostx_web_hosting.tpl`, `hostx_web_hosting_2.tpl`, `why_hostx.tpl`. Blocks
are rendered by slug — `$seodata->page_blocks` / `$block_layouts` — and the
slugs are stored in the database by the encoded page builder. Renaming the
files would 404 those blocks until every stored slug is edited.

**Default banner images:** `banners/enterprise-servers-hostx.{png,webp}`,
`game-servers-hostx.{png,webp}`, `hosting-servers-hostx.{png,webp}`. Banner
records store the image filename in the database (written by the encoded
banner manager), so renaming the files would break live banners.

**The migration SQL's `FROM` names.** `scripts/migrate-legacy-names-to-cloudhost247.sql`
must reference the old identifiers to rename them. It also checks exact
legacy company-name values. The Email Hosting module type and table names are
retained as compatibility identifiers and are not rewritten by this script.

Removing any of these requires replacing the encoded helper outright —
which is exactly what the independent rebuild
(`modules/addons/cloudhost247_builder` + `templates/cloudhost247`) is for.

## Required database migration

The code rename does not take effect on its own. WHMCS resolves modules,
themes and order forms by name from the database. Deploy the code and the
migration together, inside one maintenance window, after a full backup:

    mysql -u USER -p DATABASE < scripts/migrate-legacy-names-to-cloudhost247.sql

It renames the five owned `hostx_tools` data tables, repoints the renamed
addon registrations, and updates the legacy theme, order-form, and exact
legacy company-name values. It deliberately does **not** change the Email
Hosting server type or `mod_hostx_email_*` tables because the current module
continues to use them for WHMCS compatibility:

| Setting | Old | New |
| --- | --- | --- |
| `tblconfiguration.Template` | `hostx` | `cloudhost247_legacy` |
| `tblconfiguration.OrderFormTemplate` | `hostx` | `cloudhost247_legacy` |
| `tblproductgroups.orderfrmtpl` | `hostx` | `cloudhost247_legacy` |
| `mod_hostx_setting` row `template_name_custom` | `hostx` | `cloudhost247_legacy` |
| `tblconfiguration.CompanyName` (exact known legacy values only) | `HostX`, the no-period `CloudHost247 Isc` spelling, `CloudHost247 Inc.`, and `CloudHost247 Pvt Ltd.` variants | `CloudHost247 Isc.` |

Every statement is guarded and the script is safe to re-run. The
verification block at the end must report all MUST-BE-ZERO counts as 0; the
informational counts list page-builder tables and Email Hosting bindings
that intentionally keep their technical names.

Skipping it leaves the renamed addon registrations and legacy theme
settings on their old values, so the addon menu or client-area theme may not
resolve. Email Hosting products remain functional because their module type
and tables are intentionally unchanged by this migration.

## Licensing note

The legacy theme and the encoded helper are licensed third-party code.
Renaming and rebranding them is a licensing matter between the operator and
the vendor; this repository records the rebrand for inventory and
deployment purposes. The independent rebuild exists precisely to retire the
vendor stack.

## Staging verification checklist (run before cutover)

1. Run the migration; confirm all MUST-BE-ZERO verification counts are 0.
2. Clear `templates_c/`; load the homepage, one marketing page per family
   (web-hosting, ssl-certificate, all-element-cloudhost247) and the cart.
3. Confirm the announcement/cookie bar, mega menu and footer render (they
   exercise `cloudhost247_legacy_includes/` and the renamed cookie-library
   assets).
4. Confirm blocks still render on rebuilt pages — in particular the
   `hostx_web_hosting`, `hostx_web_hosting_2` and `why_hostx` blocks, whose
   retained names are listed above.
5. Confirm banners display (retained `*-hostx` image names).
6. Switch a test product group to the `cloudhost247` order form and back to
   `cloudhost247_legacy`; both must render.
7. Verify the SoYouStart/OVH client area pages load
   `compatible_cloudhost247.css` when the legacy theme is active.
