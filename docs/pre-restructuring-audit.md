# CloudHost247 — Full Repository Audit (pre-restructuring)

Repository: https://github.com/subwindels-hash/CloudHost247
Baseline: single squashed commit `32c0685` (all 26 original ZIPs already extracted by a prior pass, archives deleted, INDEX.md written).
Current state: 4,633 files / 782 directories, 9 top-level packages, all content dumped in package-named folders that do NOT match the WHMCS application architecture.

## Technology stack (identified from code)

WHMCS 8.x billing/hosting platform (PHP + Smarty templates), cPanel-style document root.
There is NO WHMCS core in the repo — the repo contains the *site's customizations*:
theme, order form, root pages, addon/server/gateway modules, language overrides, crons.

## Package-by-package inventory & classification

### 1. `Try-this/` — legacy vendor theme client package (WHMCS Global Services)
- 29 root PHP pages (`aboutus.php`, `vps-hosting.php`, `cpanel-hosting.php`, …) → **WHMCS docroot root**
  - Each does `require __DIR__.'/init.php'` + `$ca->setTemplate(...)` (verified all 29 mappings)
  - `refund-and-cancellation-policy.php` and `refund-and-vancellation-policy.php` are the SAME page
    (typo duplicate, both `setTemplate('refund-and-vancellation-policy')`)
- `lang/overrides/` — 27 language files (cloudhost247 menu/block strings) → **lang/overrides/**
- `modules/addons/[retired-addon]/` — legacy vendor theme helper addon (ionCube-encoded, complete: classes, includes, json, assets) → **modules/addons/[retired-addon]/**
- `sitemap.html`, `sitemap.xml` — 0-byte junk (the cloudhost247 addon generates sitemaps itself)

### 2. `orderforms/` — the actual cloudhost247 THEME + ORDER FORM mixed together (643 files)
- Root level = **templates/cloudhost247_legacy/** (the theme):
  - ~120 theme .tpl pages (header, footer, homepage, clientarea*, knowledgebase*, store/*, oauth/*, payment/*, upgrade*, 3dsecure, forwardpage, domain-pricing, masspay, usagebillingpricing, aboutus, blog, sslcloudhost247, cloudhost247_legacy, tables, termsofservice, refund-and-vancellation-policy, …)
  - `includes/` — theme partials (head, navbar, blocks/… 70+ block templates) — referenced as `$template/includes/...`
  - `css/`, `js/` — theme assets (referenced as `templates/{$template}/css|js/...`)
  - `banners/`, `caticons/`, `og_images/`, `testimonial_images/`, `webfonts/` — theme assets
  - `index.php` (folder access redirect)
  - OLD ORDER-FORM COPY at root (superseded duplicates): `viewcart.tpl`, `checkout.tpl`, `common.tpl`, `complete.tpl`, `fraudcheck.tpl`, `ordersummary.tpl`, `products.tpl`, `error.tpl`, `linkedaccounts.tpl`, `sidebar-categories*.tpl` (3), `marketconnect-promo.tpl` + root `theme.yaml`
    → all use pre-8.x variables (`$renewals`, `$smarty.server.PHP_SELF`, no `$product.productUrl`) and ALL have newer counterparts in the `cloudhost247/` subfolder
  - Empty unreferenced `all-elements.tpl` (0 bytes) — junk
- `cloudhost247/` subfolder = **templates/orderforms/cloudhost247_legacy/** (the order form):
  - 30 cart .tpl files, its own `css/`, `js/`, `fonts/`, `images/`, `includes/`, `theme.yaml`, `thumbnail.gif`, `index.php`, `configureproduct.tpl_ovh` (OVH variant), `marketconnect-promo.tpl`
  - References resolve as `templates/orderforms/{$carttpl}/...` ✔
- `marketconnect/` — theme MarketConnect images → theme

### 3. `cloudhost247/` — theme ASSET folders (1,170 files)
- `domain_icons/`, `error/` (WHMCS 8.8 error pages), `flags/`, `fonts/`, `cloudhost247_legacy_includes/` (17 layout partials referenced by header.tpl/footer.tpl), `images/`, `img/` (css-referenced sprites)
- All referenced from theme tpls/css as `templates/{$template}/<folder>` → **templates/cloudhost247_legacy/**

### 4. `Refund Policy/` — 19 CloudHost247 legal pages (95 files)
- `All Pages/PHP/` (19 pages) + `All Pages/TPL/` (19 templates) = the production set (Installation.txt: PHP → docroot root, TPL → templates/cloudhost247_legacy/)
- 19 per-policy folders duplicate the same PHP+TPL (byte-identical, verified) + source PDF each
- `Acceptable Use Policy/` nested dir = same duplicate pattern
- DEFECTS found:
  - 4 PHP files (`refund-policy`, `backup-policy`, `cybercrime-policy`, `trademark-policy`) `require 'configadminioncontroller.php'` — file exists nowhere → fatal error on those pages
  - 4 TPLs (same 4 policies) are full-HTML pages referencing `$template/includes/common/{head,navbar,footer}.tpl` — path does not exist in the theme (theme uses `includes/head.tpl` etc.) and full-page markup conflicts with WHMCS's theme header/footer wrapping; the other 15 policy TPLs are correct body fragments
  - 20 PHP files use `$_SERVER['DOCUMENT_ROOT'].'/init.php'` (fragile) vs 18 that use the standard `__DIR__.'/init.php'`
  - `termsofservice.tpl` name-collides with the theme's stock termsofservice.tpl (policy version = real CloudHost247 content, supersedes stock)

### 5. `WGS-OVH-v8.0.8-Sourcecode/whmcs/` — OVH/SoYouStart suite (433 files)
- `modules/addons/soyoustart/` (admin addon) → **modules/addons/soyoustart/**
- `modules/servers/soyoustart/` (provisioning) → **modules/servers/soyoustart/**
- `crons/` (emailSend, getIpStatus, getServer, priceSync — documented cron scripts) → **crons/soyoustart/** (they auto-detect WHMCS path via config.php or ../init.php)
- `lang/overrides/english.php` (48 OVH order-form keys, no key collisions with cloudhost247's 591 keys) → **merge into lang/overrides/english.php**

### 6. `blockonomics/` — Bitcoin payment gateway (25 files)
- `blockonomics.php` (gateway loader) → **modules/gateways/blockonomics.php**
- `callback/blockonomics.php` → **modules/gateways/callback/blockonomics.php**
- `blockonomics/` (lib: Blockonomics class v1.9.8, payment.php, templates, lang, assets; paths `__DIR__.'/../../../init.php'` resolve correctly from modules/gateways/blockonomics/) → **modules/gateways/blockonomics/**

### 7. `cloudhost247_lteproxy/` — LTE Proxy provisioning module + 9 bundled tool packages (240 files)
- Core module (`cloudhost247_lteproxy.php` + lib/ hooks/ ajax/ templates/ assets/ lang/ install.php; README: "Upload the module folder to /modules/servers/cloudhost247_lteproxy/") → **modules/servers/cloudhost247_lteproxy/**
- `All DNS Checker/modules/addons/cloudhost247_tools/` — "CloudHost247 Tools Platform" v2.2.6, 60+ tools → **modules/addons/cloudhost247_tools/** (CONFLICT — see Q1)
- `All DNS Checker/modules/addons/CloudHost247_tools/` — same platform rebranded for CloudHost247 (846-line diff = pure rebrand) (see Q2)
- `All DNS Checker/DNS Checker/` — `dnschecker` addon; two nested copies byte-identical → keep one → **modules/addons/dnschecker/**
- `Announcement Bar/` — Smarty/CSS announcement bar for the theme (Build.txt: install to templates/cloudhost247_legacy/includes/announcementbar.tpl + header integration); contains base (legacy-theme) and `CloudHost247` template variants + a stale nested partial duplicate
- `Use this All DNS Checker/whmcs-tools-center/` — "WHMCS Tools Center" addon (`whmcs-addon/` → modules/addons/tools_center/) + `external-api/` (designed to be deployed OUTSIDE the WHMCS webroot) (see Q3)
- `WHMCS Affiliate Commission Logic/customaffiliate/` → **modules/addons/customaffiliate/** (INSTALL.txt confirmed)
- `WHMCS Digital Product Module/modules/addons/digitalproducts/` → **modules/addons/digitalproducts/** (README confirmed)
- `WHMCS Domain Lookup/cloudhost247_tools/` — "CloudHost247 Tools" v1.0.0, 4 tools (WHOIS/IP/DNS/availability), OOP w/ API fallbacks — SAME module name as the platform above (see Q1)
- `WHMCS Email Hosting Module/cloudhost247_email/` — has MetaData/ConfigOptions/CreateAccount → SERVER module → **modules/servers/cloudhost247_email/**
- `WHMCS Phone Number Platform/phoneservices/` — addon (config/activate/output/sidebar) → **modules/addons/phoneservices/**
- `WHMCS SMM Integration Module/smm_whmcs_module/` — `modules/addons/smmaddon/` + `modules/servers/smmprovisioning/` → **modules/addons/smmaddon/** + **modules/servers/smmprovisioning/**

### 8. `smtphosting-whmcs-v3/` — ModulesGarden SMTP hosting provisioning module (1,680 files)
- `modules/servers/Smtphosting/` (Smtphosting.php + Loader, vendor/, composer.*) → **modules/servers/Smtphosting/**

### 9. `xtreme_currency_rates_6.0/` — Xtreme Currency Rates addon (19 files, ionCube-encoded)
- → **modules/addons/xtreme_currency_rates/**

## Junk/duplicates identified for removal (after verification)
1. Per-policy duplicate PHP/TPL copies in `Refund Policy/<Policy>/` (byte-identical to `All Pages/`)
2. `Try-this/refund-and-vancellation-policy.php` (typo duplicate of refund-and-cancellation-policy.php)
3. `Try-this/sitemap.html`, `sitemap.xml` (0 bytes)
4. `orderforms/all-elements.tpl` (0 bytes, unreferenced)
5. Old order-form TPL copies at `orderforms/` root (14 files + theme.yaml) — every one superseded by newer version in `orderforms/cloudhost247_legacy/`
6. `All DNS Checker/DNS Checker/dnschecker-whmcs-module/` duplicate tree (byte-identical)
7. `Announcement Bar/Announcement Bar/` stale nested partial duplicate (3 files, subset of `Announcement Bar/templates/CloudHost247/`)
8. WHMCS tools "Domain Lookup" build (depending on Q1 answer)
9. Original ZIP archives — already removed in prior pass; none remain ✔
10. desktop.ini / Thumbs.db / .DS_Store — none present ✔

## Target architecture (WHMCS standard)
```
/                                 ← WHMCS document root (cPanel public_html)
├── *.php                         ← 29 theme pages + 19 policy pages
├── crons/soyoustart/             ← OVH cron scripts
├── lang/overrides/               ← 27 languages (english.php = cloudhost247 + OVH merged)
├── modules/
│   ├── addons/  cloudhost247, soyoustart, xtreme_currency_rates, cloudhost247_tools,
│   │            CloudHost247_tools, dnschecker, customaffiliate, digitalproducts,
│   │            phoneservices, smmaddon, tools_center
│   ├── gateways/ blockonomics.php, blockonomics/, callback/
│   └── servers/  cloudhost247_lteproxy, Smtphosting, soyoustart, cloudhost247_email, smmprovisioning
├── templates/
│   ├── cloudhost247/                    ← full theme (tpls, includes, cloudhost247_legacy_includes, css, js,
│   │                               fonts, webfonts, images, img, flags, domain_icons,
│   │                               error, banners, caticons, og_images, testimonial_images,
│   │                               store, oauth, payment, marketconnect, 19 policy tpls)
│   └── orderforms/cloudhost247_legacy/         ← order form template
└── docs/                         ← all README/INSTALL/Build docs + policy PDFs
```
