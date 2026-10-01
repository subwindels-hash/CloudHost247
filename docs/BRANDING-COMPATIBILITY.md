# CloudHost247 branding and compatibility register

**Reviewed:** 2026-10-01 (third rebrand pass — module identifiers)

**Status:** Source-only rebrand; no production database was accessed or changed.
Every retained identifier below is listed in the machine-readable register
`docs/independent-rebuild/branding-exceptions.list` and is enforced by
`scripts/branding-audit.py`, which fails the release-candidate check if any
*unlisted* HostX string appears anywhere in the repository.

## Approved naming rules

- **Legal/company name:** `CloudHost247 Isc.` (including the final period).
- **Primary customer-facing brand:** `CloudHost247`.
- **Compact identifier:** `CH247`, where a short technical or visual label is appropriate.
- Do not introduce new HostX branding. The legacy strings listed under
  "Retained identifiers" are immutable integration identifiers or historical
  audit data, not current product branding.

Legal policies, legal notices, copyright/footer copy, the 27 WHMCS language
overrides, and the WHMCS company-name migration use `CloudHost247 Isc.`.
General customer-facing copy and the Email Hosting display name use
`CloudHost247`.

## What the third pass changed

The second pass (2026-09-28) rebranded all customer-visible copy, the theme
directories, the language packs, the root pages and the logo artwork, but left
the Email Hosting provisioning module on the vendor's module identifier. That
is what still showed up in the WHMCS module areas. It is now renamed:

| Item | Before | After |
| --- | --- | --- |
| Provisioning module directory | `modules/servers/hostx_email/` | `modules/servers/cloudhost247_email_hosting/` |
| WHMCS module ID (`tblproducts.servertype`, `tblservers.type`) | `hostx_email` | `cloudhost247_email_hosting` |
| Module entry point / callback prefix | `hostx_email.php`, `hostx_email_*()` | `cloudhost247_email_hosting.php`, `cloudhost247_email_hosting_*()` |
| Data tables (8) | `mod_hostx_email_*` | `mod_cloudhost247_email_hosting_*` |
| Signed webhook headers | `X-Hostx-Signature` / `-Timestamp` / `-Event-Id` | `X-CloudHost247-Signature` / `-Timestamp` / `-Event-Id` |
| Client-area CSRF session key | `$_SESSION['hostx_email_token']` | `$_SESSION['ch247_email_token']` |
| Client-area action field | `ch247_email_action` (+ legacy fallback) | `ch247_email_action` only |
| Log correlation-id prefix | `hxe-` | `ch247-email-` |
| Staging test-case IDs | `HXE-01..27` | `CH247E-01..29` |
| Test helpers | `hxe_*()` | `ch247_email_*()` |

The PHP namespace was already `CloudHost247\Email`, the display name was
already **CloudHost247 Email Hosting**, and the `CH247_EMAIL_*` bootstrap
constants were already on the short brand, so those did not move.

Because WHMCS resolves a provisioning module **by directory name**, this rename
is not source-only: `scripts/migrate-legacy-names-to-cloudhost247.sql` now also
renames the eight module tables and repoints every product and server binding.
The *Deploy order and rollback* section at the end of that script records the
exact sequence and the reverse statements. Historical `tblmodulelog` rows keep the identifier they logged
under — an audit trail is never rewritten.

`modules/servers/cloudhost247_email/` is a **different, inactive** module that
owns `mod_cloudhost247_email_accounts`; it was deliberately not touched, and
the new table prefix `mod_cloudhost247_email_hosting_*` was chosen so the two
can never collide.

## Retained identifiers

Everything below is verified, not assumed. `scripts/branding-audit.py`
re-checks the list on every release candidate.

### 1. The ionCube-encoded WHMCS page-builder addon — `modules/addons/hostx/`

**Cannot be renamed.** Verified: all 63 PHP files in the addon start with the
ionCube header `<?php //ICB0 …` and contain encrypted bytecode, including
`hostx.php` (the WHMCS entry point), `index.php`, `languageHostX.php`,
`hooks.php`, `defaultmenu.php`, `topmenu.php`, `HostX_Default_Blocks.php`,
`classes/HostxPage.php`, `classes/HostxBlock.php`, `classes/HostxBanner.php`
and every file under `includes/`.

WHMCS loads an addon as `modules/addons/<name>/<name>.php` and calls
`<name>_config()`, `<name>_activate()`, `<name>_output()` and the
`<name>_<page>()` admin routes. Those function names, the addon directory name,
the `tbladdonmodules.module` value and the vendor licence check are all baked
into the encrypted bytecode. Renaming the directory would:

- deactivate the addon and delete the page-builder admin UI;
- break the `require_once … /modules/addons/hostx/defaultmenu.php` include that
  all 11 root marketing pages depend on;
- break every asset URL the encoded code emits.

**Consequence for the WHMCS admin:** the addon's entry in *System Settings →
Addon Modules* is titled by the encoded `config()` return value, so the vendor
title cannot be changed from this repository. Clearing it requires one of:

1. a rebranded build of the addon from the vendor (same licence, new bytecode), or
2. retiring the legacy theme in favour of the independent rebuild
   (`modules/addons/cloudhost247_builder` + `templates/cloudhost247`), which is
   the stated purpose of that work stream.

This is the only HostX string a logged-in administrator can still see in a
module list, and it is a vendor-artefact constraint, not an oversight.

Two editable asset files inside the addon also retain a legacy token, because
both sides of the contract are the encoded code:

- `modules/addons/hostx/assets/js/script.js` posts `'class': 'HostxPage'` to the
  encoded `includes/ajax.php`, which instantiates the encoded class of that
  name (SEO language switcher). Renaming the string breaks the AJAX call.
- `modules/addons/hostx/assets/css/style.css` defines
  `.tooltip-inner.inner-box-tool-tip-hostx`; the encoded admin pages emit that
  class on Bootstrap tooltips. Renaming the selector removes the styling.

### 2. Data tables the encoded addon owns

`mod_hostx_pages`, `mod_hostx_page_products`, `mod_hostx_setting`,
`mod_hostx_dynmic_translation` (the misspelling is the vendor's and is part of
the identifier).

They are queried by the encrypted addon at runtime **and** by 11 editable root
marketing pages (`web-hosting.php`, `vps-hosting.php`, `vps-privatecloud.php`,
`cpanel-hosting.php`, `plesk-hosting.php`, `wordpress-hosting.php`,
`windows-hosting.php`, `website-design.php`, `ssl-certificate.php`,
`tables.php`, `cloudhost247-vps-sample.php`), each of which reads the page
record, the per-page product copy, the dynamic translation row and the currency
setting, and includes `modules/addons/hostx/defaultmenu.php`. Renaming only the
PHP side breaks the addon; renaming only the tables breaks the PHP side;
renaming both still breaks the encrypted SQL. A `RENAME TABLE` plus an old-name
compatibility `VIEW` was considered and rejected: the addon issues
schema-introspection and `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE` statements
that views do not satisfy.

### 3. Smarty bindings assigned by the encoded hooks

`$hostx_theme_settings` (28 templates), `$hostx_blocks` (143 reads) and
`$hostxcurrentpagelink` (3 reads) are assigned by the encrypted `hooks.php`.
The legacy templates only *read* them. Renaming the read side blanks the theme
settings, every content block and the social-share URLs on the live site.
Smarty `{assign scope=global}` aliasing was considered and rejected: it depends
on include order between `header.tpl` and 70+ block partials and would put the
primary customer-facing theme at risk for zero customer-visible gain — none of
these names is ever rendered.

### 4. Database-stored block slugs and banner filenames

- `templates/cloudhost247_legacy/includes/blocks/hostx_web_hosting.tpl`,
  `hostx_web_hosting_2.tpl`, `why_hostx.tpl`
- `templates/cloudhost247_legacy/banners/enterprise-servers-hostx.{png,webp}`,
  `game-servers-hostx.{png,webp}`, `hosting-servers-hostx.{png,webp}`

Blocks are rendered by slug and banners by filename; both values are stored in
the encoded addon's tables by the encoded page builder and banner manager. No
editable source references these names, so the only thing that decides whether
they can be renamed is the content of the live database.

Run `scripts/audit-legacy-branding-in-database.sql` against staging (read-only;
`mysql --force` so the one optional table does not abort the run) to enumerate
every stored HostX value. If it reports zero rows for block slugs
and banner images, the nine files can be renamed in a follow-up; if it reports
rows, the rename must ship together with an `UPDATE` of those rows in the same
maintenance window. Until that evidence exists, renaming them would 404 live
blocks and banners.

### 5. Migration inputs and historical verification data

- `scripts/migrate-legacy-names-to-cloudhost247.sql` must spell the old values
  it is migrating away from (`hostx`, `hostx_tools`, `hostx_domain_lookup`,
  `hostx_email`, `mod_hostx_*`, and the exact legacy `CompanyName` variants).
  These are migration inputs, not branding. The script only changes recognised
  legacy values in `tblconfiguration.CompanyName` to `CloudHost247 Isc.`; it
  never touches customer records, product names, invoice items or credentials.
- `scripts/audit-legacy-branding-in-database.sql` is a read-only detector and
  must name what it looks for.
- `docs/independent-rebuild/original-file-manifest.sha256` is the SHA-256
  integrity baseline of the vendor-derived tree. Its paths and hashes record
  the historical state by design and are verified byte-for-byte by
  `scripts/release-candidate-check.sh`.
- `docs/independent-rebuild/rebrand-overrides.list` / `.sha256` list the
  branding-only exceptions to that baseline, which include four real paths
  under `modules/addons/hostx/assets/`.
- `docs/independent-rebuild/BRAND-RENAME.md`, `docs/pre-restructuring-audit.md`
  and `docs/RESTRUCTURING.md` are rename/audit records: they describe what the
  old names were. Their current-state statements were updated in this pass.
- `tests/security/test_security.py` and `tests/cloudhost247_email/run.php`
  assert that the legacy identifiers are **gone**; a negative assertion has to
  name the thing it forbids.

The same script also settles the footer question in §2 of the previous pass:
`templates/cloudhost247_legacy/includes/blocks/copyright.tpl` renders a stored
`copyright` block when one exists and falls back to the static
`© {year} CloudHost247 Isc.` line only when it does not. The static fallback is
rebranded; a stored block is customer-visible legal copy and must be corrected
through the theme admin before cutover.

### 6. Third-party and partner artwork

Unrelated vendor artwork (for example WHMCS MarketConnect provider logos) was
not altered. `templates/cloudhost247_legacy/images/logo_old.png` is unreferenced
and renders an `ae server` wordmark rather than HostX or CloudHost247 branding,
so it was left alone.

## Logo assets

No approved full corporate wordmark was supplied in the repository. The three
SVG lockups (`cloudhost247-wordmark.svg`, `cloudhost247-wordmark-white.svg`,
`cloudhost247-banner-wordmark.svg`) are **draft artwork** pairing the existing
CloudHost247 favicon mark with the approved primary wordmark. The four main logo
PNGs, the offer `host-logo.png`, the rebranded `for-logo.png` portrait and the
favicon are draft derivatives; PNG/ICO paths and dimensions were preserved so
existing theme settings keep resolving. Each SVG source carries a
visible-in-source DRAFT comment. If an approved corporate vector is supplied,
replace the SVG sources and regenerate the raster derivatives.

**Still required from the brand owner:** nothing inside `modules/addons/hostx/`
can be re-supplied from this repository — the vendor must provide a rebranded
addon build (see §1) before the admin Addon Modules entry can change.

## Integrity of original protected files

The baseline `docs/independent-rebuild/original-file-manifest.sha256` was not
changed in this pass — no manifest-listed file was edited. Branding-only
exceptions to that baseline (legal copy, footer, logo assets, editable tour
labels) are listed in `docs/independent-rebuild/rebrand-overrides.list` and
verified by `docs/independent-rebuild/rebrand-overrides.sha256`. The
release-candidate checker excludes only those explicitly listed paths from the
original-baseline comparison and validates their new hashes separately. No
encoded PHP or business logic is exempted.

## Database / deployment status

`scripts/migrate-legacy-names-to-cloudhost247.sql` now covers the addon
registrations, the tools tables, the legacy theme/order-form directories, the
exact company-name values **and** the Email Hosting module rename. It remains
**unexecuted** — no database was available in this environment. Applying it
requires a current backup, maintenance mode, and staging verification
(`STAGING-TEST-MATRIX.md` rows CH247E-28 and CH247E-29). No live service,
invoice, payment, authentication or credential data was modified.
