# CloudHost247 Repository Restructuring — Complete Record

**Branch:** `arena/01a0e411-cloudhost247` (baseline: merge commit `32c0685`)
**Date:** 2026-09-27
**Scope:** Repository-wide reorganization of 4,633 files into the standard WHMCS
document-root architecture, extraction/registration of every module and plugin,
path/reference repair, and verified cleanup of duplicates and junk.

The pre-restructuring inventory is preserved in
[`docs/pre-restructuring-audit.md`](pre-restructuring-audit.md).

---

## 1. Old → new directory mapping

| Old location | New location | Notes |
|---|---|---|
| `Try-this/*.php` (28 pages) | `/` (docroot) | legacy theme client-area pages; `refund-and-vancellation-policy.php` (typo duplicate) dropped, `terms-of-service.php` superseded by policy-package version |
| `Refund Policy/All Pages/PHP/*.php` (18 pages) | `/` | CloudHost247 legal pages (acceptable-use, backup, cookie, cybercrime, data-deletion, data-privacy-notice, data-protection, domain-agreement, domain-renewal, domainregistrationaddendum, fair-usage, faqs, help-center, legal, legal-notice, privacy, refund, trademark, terms-of-service) |
| `Refund Policy/All Pages/TPL/*.tpl` (19 templates) | `templates/cloudhost247_legacy/` | `termsofservice.tpl` supersedes the stock theme copy |
| `Refund Policy/<Policy>/*.pdf` (19 PDFs) | `docs/policies/` | Source legal documents |
| `Refund Policy/All Pages/Installation.txt` | `docs/policies/INSTALLATION.txt` | |
| `Refund Policy/<Policy>/{*.php,*.tpl}` (38 copies) | *(removed)* | Byte-identical duplicates of the All Pages set (verified; see §4) |
| `Try-this/modules/addons/[retired-addon]/` | `modules/addons/[retired-addon]/` | ionCube-encoded theme helper addon; directory name is the WHMCS addon id and is retained — `docs/BRANDING-COMPATIBILITY.md` §1 |
| `Try-this/lang/overrides/*` (27 files) | `lang/overrides/` | `english.php` merged with the OVH override file |
| `Try-this/sitemap.html`, `sitemap.xml`, `README.md` | *(removed)* | 0-byte / content-free junk |
| `orderforms/*.tpl`, `includes/`, `css/`, `js/`, `banners/`, `caticons/`, `og_images/`, `testimonial_images/`, `webfonts/`, `store/`, `oauth/`, `payment/`, `marketconnect/`, `index.php` | `templates/cloudhost247_legacy/` | The **CloudHost247 legacy theme** (was mixed into a folder misleadingly named `orderforms/`) |
| `orderforms/cloudhost247_legacy/` | `templates/orderforms/cloudhost247_legacy/` | The **CloudHost247 legacy order form** |
| `orderforms/{viewcart,checkout,common,complete,fraudcheck,ordersummary,products,error,linkedaccounts,sidebar-categories,sidebar-categories-collapsed,sidebar-categories-selector,marketconnect-promo}.tpl`, `orderforms/theme.yaml` | *(removed)* | Superseded old copies of the order form (pre-WHMCS-8 variables: `$renewals`, `$smarty.server.PHP_SELF`); every file has a newer counterpart in `templates/orderforms/cloudhost247_legacy/` (verified) |
| `orderforms/thumbnail.gif` | *(removed)* | Byte-identical to `templates/orderforms/cloudhost247_legacy/thumbnail.gif` |
| `orderforms/all-elements.tpl` | *(removed)* | 0-byte, unreferenced |
| `cloudhost247/{domain_icons,error,flags,fonts,cloudhost247_legacy_includes,images,img}` | `templates/cloudhost247_legacy/…` | Theme asset folders (all referenced by theme TPLs/CSS) |
| `WGS-OVH-v8.0.8-Sourcecode/whmcs/modules/addons/soyoustart/` | `modules/addons/soyoustart/` | OVH admin addon |
| `WGS-OVH-v8.0.8-Sourcecode/whmcs/modules/servers/soyoustart/` | `modules/servers/soyoustart/` | Dedicated-server provisioning |
| `WGS-OVH-v8.0.8-Sourcecode/whmcs/modules/servers/soyoustart_vps/` | `modules/servers/soyoustart_vps/` | VPS provisioning |
| `WGS-OVH-v8.0.8-Sourcecode/whmcs/templates/orderforms/ovh_cart/` | `templates/orderforms/ovh_cart/` | OVH order form (standard_cart child) |
| `WGS-OVH-v8.0.8-Sourcecode/whmcs/crons/*.php` (4) | `crons/` | Cron scripts (auto-detect WHMCS via `../init.php` or `crons/config.php`) |
| `WGS-OVH-v8.0.8-Sourcecode/whmcs/lang/overrides/english.php` | merged into `lang/overrides/english.php` | 48 OVH order-form keys, no key collisions |
| `blockonomics/blockonomics.php` | `modules/gateways/blockonomics.php` | Gateway loader |
| `blockonomics/callback/blockonomics.php` | `modules/gateways/callback/blockonomics.php` | Callback endpoint |
| `blockonomics/blockonomics/*` | `modules/gateways/blockonomics/*` | Blockonomics lib v1.9.8 (official plugin layout) |
| `cloudhost247_lteproxy/{*.php,lib,hooks,ajax,templates,assets,lang,README.md}` | `modules/servers/cloudhost247_lteproxy/` | LTE Proxy provisioning module (per its own README) |
| `cloudhost247_lteproxy/All DNS Checker/modules/addons/cloudhost247_tools/` | `modules/addons/cloudhost247_tools/` | CloudHost247 Tools Platform v2.2.6 |
| `cloudhost247_lteproxy/All DNS Checker/modules/addons/CloudHost247_tools/` | `modules/addons/CloudHost247_tools/` | CloudHost247-branded platform build |
| `cloudhost247_lteproxy/WHMCS Domain Lookup/cloudhost247_tools/` | `modules/addons/cloudhost247_domain_lookup/` | **Renamed module** (see §3) |
| `cloudhost247_lteproxy/All DNS Checker/DNS Checker/modules/addons/dnschecker/` | `modules/addons/dnschecker/` | |
| `cloudhost247_lteproxy/All DNS Checker/DNS Checker/dnschecker-whmcs-module/` | *(removed)* | Byte-identical duplicate of the above |
| `cloudhost247_lteproxy/WHMCS Affiliate Commission Logic/customaffiliate/` | `modules/addons/customaffiliate/` | |
| `cloudhost247_lteproxy/WHMCS Digital Product Module/modules/addons/digitalproducts/` | `modules/addons/digitalproducts/` | + package `README.md` moved into the module |
| `cloudhost247_lteproxy/WHMCS Email Hosting Module/cloudhost247_email/` | `modules/servers/cloudhost247_email/` | Has `MetaData`/`ConfigOptions`/`CreateAccount` → provisioning module. Superseded and **inactive**: the live Email Hosting module is the first-party `modules/servers/cloudhost247_email_hosting/`, which is not part of this vendor-archive mapping |
| `cloudhost247_lteproxy/WHMCS Phone Number Platform/phoneservices/` | `modules/addons/phoneservices/` | |
| `cloudhost247_lteproxy/WHMCS SMM Integration Module/smm_whmcs_module/modules/addons/smmaddon/` | `modules/addons/smmaddon/` | + `README.md`, `schema.sql`, `example_api.php` |
| `cloudhost247_lteproxy/WHMCS SMM Integration Module/smm_whmcs_module/modules/servers/smmprovisioning/` | `modules/servers/smmprovisioning/` | |
| `cloudhost247_lteproxy/Use this All DNS Checker/whmcs-tools-center/whmcs-addon/` + `install.sql` + docs | `modules/addons/tools_center/` | Addon + its DB schema + docs |
| `cloudhost247_lteproxy/Use this All DNS Checker/whmcs-tools-center/external-api/` | `modules/addons/tools_center/external-api/` | Kept with the addon as shipped; its INSTALL.md requires deployment **outside** the WHMCS webroot |
| `cloudhost247_lteproxy/Announcement Bar/templates/cloudhost247_legacy/includes/announcementbar.tpl` | `templates/cloudhost247_legacy/includes/announcementbar.tpl` | Integrated into `header.tpl` (renders nothing until announcements are assigned) |
| `cloudhost247_lteproxy/Announcement Bar/templates/cloudhost247_legacy/css/announcementbar.css` | `templates/cloudhost247_legacy/css/announcementbar.css` | Optional external-CSS variant of the TPL's inline styles |
| `cloudhost247_lteproxy/Announcement Bar/…` (docs, examples, CloudHost247 variant, stale nested duplicate) | `docs/announcement-bar/` | The `Announcement Bar/Announcement Bar/` nested copy was a byte-identical partial duplicate (verified, removed) |
| `cloudhost247_lteproxy/**/Build.txt, Installation.txt, INSTALL.txt, *.pdf` | `docs/build-notes/<module>/` | Provenance/build documentation |
| `smtphosting-whmcs-v3/modules/servers/Smtphosting/` | `modules/servers/Smtphosting/` | ModulesGarden module incl. vendor/ |
| `xtreme_currency_rates_6.0/*` | `modules/addons/xtreme_currency_rates/` | ionCube-encoded |

## 2. Removed files (verified unnecessary)

1. **38 per-policy duplicate PHP/TPL copies** in `Refund Policy/<Policy>/` — all
   verified byte-identical to the `All Pages` set (modulo the bug fixes in §3,
   verified file-by-file with automated comparison).
2. **13 old order-form templates + `theme.yaml`** at `orderforms/` root — every
   one superseded by a newer version in `templates/orderforms/cloudhost247_legacy/` (older
   WHMCS variable usage; counterparts confirmed present, several byte-identical).
3. **`dnschecker-whmcs-module/`** — byte-identical second copy of `dnschecker`.
4. **`Announcement Bar/Announcement Bar/`** — byte-identical partial duplicate.
5. **`Try-this/refund-and-vancellation-policy.php`** — typo duplicate of
   `refund-and-cancellation-policy.php` (identical output, same template,
   no references anywhere).
6. **`Try-this/terms-of-service.php`** — superseded by the policy-package
   `terms-of-service.php` (same URL, richer production content).
7. **`orderforms/termsofservice.tpl`** (stock) — superseded by the policy
   package's `termsofservice.tpl`.
8. **`orderforms/all-elements.tpl`** — 0 bytes, unreferenced.
9. **`Try-this/sitemap.html`, `Try-this/sitemap.xml`** — 0 bytes.
10. **`Try-this/README.md`** — content-free placeholder ("# Try-this / ai").
11. **`INDEX.md`** — pre-restructuring extraction log, superseded by this file.
12. **Empty wrapper directories** left behind by all moves.

ZIP archives: none remained at the start of this pass (the previous merge had
extracted and removed all 26). Verified: zero archives in the final tree.

## 3. Code fixes applied during the move (all verified)

| # | Problem | Fix |
|---|---|---|
| 1 | 4 policy PHP files (`refund-policy`, `backup-policy`, `cybercrime-policy`, `trademark-policy`) contained `require 'configadminioncontroller.php';` — **the file exists nowhere**, so those pages fatally errored | Bogus `require` removed |
| 2 | 20 policy PHP files used `require $_SERVER['DOCUMENT_ROOT'] . '/init.php';` (breaks under CLI / non-standard docroots) | Normalized to the WHMCS-standard `require __DIR__ . '/init.php';` |
| 3 | 4 policy TPLs were full HTML pages referencing `$template/includes/common/{head,navbar,footer}.tpl` — paths that don't exist in the legacy theme, and full-page markup conflicts with WHMCS's theme header/footer wrapper | Converted to body fragments (wrapper stripped), consistent with the 15 working policy templates |
| 4 | `datadeletion.tpl`, `dataprivacynoticeandconsentform.tpl` — same full-page-wrapper defect, referencing non-existent `$template/head.tpl`, `$template/includes/header.tpl`, `$template/includes/footer.tpl` | Wrapper stripped to body fragments |
| 5 | `domainrenewalpolicy.tpl` referenced six-theme-only `pageheader.tpl` / `pagefooter.tpl` (absent from the legacy theme) | Removed (the legacy theme wrapper provides header/footer) |
| 6 | `data-privacy-notice-and-consent-form.php` called `setTemplate('privacypolicy')` — would render the **Privacy Policy** content instead of the Data Privacy Notice (two different templates shared one name in the source package) | Retargeted to its own template `dataprivacynoticeandconsentform` |
| 7 | `datadeletion.tpl` referenced non-existent `assets/images/banner-bg.jpg` | Repointed to the theme's `images/term_bg_1.jpg` (same banner used by sibling policy pages) |
| 8 | `cookiepolicy.tpl` referenced non-existent `assets/img/inner-bg.png` | Repointed to `images/term_bg_1.jpg` |
| 9 | `blog.tpl` no-image fallback pointed at missing `images/blog-3.jpg` | Repointed to the theme's own `og_images/default-image.png` |
| 10 | `css/overrides/override.css` / `js/overrides/override.js` referenced by `includes/head.tpl` but only the `.new` starter files shipped | Created from the shipped `.new` starters (0-byte, no behavior change; the CloudHost247 addon manages their content) |
| 11 | `templates/orderforms/index.php` redirected to `../../../../index.php` (wrong depth — one level above docroot) | Corrected to `../../index.php` |
| 12 | `dedeicated-server.php` breadcrumb linked to non-existent `dedeicatedserver.php` | Corrected to its own filename |
| 13 | **`cloudhost247_tools` module-name collision** — two different builds (CloudHost247 Tools Platform v2.2.6 and CloudHost247 Tools v1.0.0) both install to `modules/addons/cloudhost247_tools/`; WHMCS requires folder name == file name == function prefix | Per decision: the 4-tool Domain Lookup build was **renamed to `cloudhost247_domain_lookup`** (functions, table names, client-area URLs, asset paths — 83 references across 15 files) so both builds coexist. `cloudhost247_tools` (platform) and `CloudHost247_tools` (rebrand) also coexist; activate only one of those two |
| 14 | Announcement Bar existed as loose files | `announcementbar.tpl` installed into the theme and included from `header.tpl` directly after `<body>` (renders nothing unless an `$announcements` array is assigned; usage examples in `docs/announcement-bar/`) |
| 15 | OVH `lang/overrides/english.php` would have been lost (same filename as the CloudHost247 override) | Merged into a single `lang/overrides/english.php` (639 keys, no collisions — verified by key intersection) |
| 16 | Production WHMCS `configuration.php` (DB credentials) was committable | Added to `.gitignore` together with WHMCS runtime dirs (`templates_c/`, `attachments/`, `downloads/`) |

## 4. Verification performed

1. **Content-loss check** — git blob-hash comparison between baseline and result:
   every removed/changed blob accounted for as an intentional fix, merge, rename
   or verified duplicate (list in §2/§3). No unintended deletions.
2. **PHP syntax** — all 1,217 PHP files parsed; zero syntax errors (one
   false-positive in untouched ModulesGarden vendor code: valid `clone(…)` syntax
   not supported by the JS parser used).
3. **Smarty include graph** — 348 `{include}` references across 308 templates all
   resolve (dynamic `$var` paths verified by pattern; `six/…` and
   `orderforms/standard_cart/…` references intentionally fall back to WHMCS
   core files present in any installation).
4. **Page→template bindings** — every `setTemplate()` in the 46 root pages
   resolves to an existing `templates/cloudhost247_legacy/*.tpl`.
5. **Asset references** — all 250 `templates/{$template}/…` references from
   theme TPLs and all 65 order-form asset references resolve to existing files.
6. **Module self-consistency** — Blockonomics gateway/loader/callback relative
   requires verified against the official plugin layout; LTE Proxy `lib/`
   requires verified; `cloudhost247_domain_lookup` contains zero stale `cloudhost247_tools`
   references; no stale references to any old path anywhere in code.
7. **ionCube-encoded files** (cloudhost247 addon, xtreme_currency_rates) moved
   unmodified (blob-identical).
8. **No ZIP archives, no `desktop.ini`/`Thumbs.db`/`.DS_Store`, no empty
   directories remain.**

## 5. Known limitations / notes for deployment

- WHMCS core is not in this repository. Root pages `require __DIR__ . '/init.php'`
  and the order forms fall back to core `standard_cart`/`six` templates — all
  present in a stock WHMCS install.
- Runtime integration testing against a live WHMCS + MySQL instance was not
  possible in this environment (no PHP/MySQL runtime). Verification was static:
  syntax, reference resolution, and structural checks above. Recommend a staging
  pass: activate modules in WHMCS admin, load each root page, place a test order.
- `modules/servers/Smtphosting/` ships with a few 0-byte placeholder files
  (`App/Config/di/services.yml`, `Core/Database/data.sql`, two `home.tpl`) —
  byte-identical to the vendor package as delivered; left untouched.
- The legacy `modules/addons/[retired-addon]` addon (name retained — its entry point is ionCube-encoded
  and defines the `the-retired-brand_*()` functions WHMCS calls) and `xtreme_currency_rates` are ionCube-encoded and require
  the ionCube Loader; their license status must be valid on the production host.
