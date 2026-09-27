# CloudHost247 — WHMCS Platform Customizations

This repository contains the **complete set of customizations for the CloudHost247
WHMCS installation** (https://www.cloudhost247.com), organized in the exact
directory layout a WHMCS 8.x document root expects. Deploy by copying the contents
of this repository **into** an existing WHMCS installation root (cPanel
`public_html`), then activating the modules in WHMCS admin.

> WHMCS core itself (init.php, index.php, includes/, assets/, vendor/, …) is **not**
> part of this repository — only the site's theme, pages, modules, language
> overrides and cron scripts. See `docs/RESTRUCTURING.md` for the complete
> history of how this repository was reorganized.

## Directory structure

```
/                                   ← WHMCS document root (cPanel public_html)
├── *.php                           ← 46 client-area pages
│   │                                  (28 HostX theme pages: aboutus, vps-hosting,
│   │                                   cpanel-hosting, blog, ssl-certificate, …
│   │                                   + 18 CloudHost247 legal/policy pages:
│   │                                   refund-policy, privacy-policy, terms-of-service,
│   │                                   faqs, help-center, legal, …)
├── crons/                          ← SoYouStart/OVH automation cron scripts
│   ├── emailSend.php
│   ├── getIpStatus.php
│   ├── getServer.php
│   └── priceSync.php
├── lang/overrides/                 ← 27 language override files
│   └── english.php                    (HostX theme strings + OVH order-form strings)
├── modules/
│   ├── addons/                     ← Addon modules (WHMCS → System Settings → Addon Modules)
│   │   ├── hostx/                     HostX theme helper module (ionCube) — REQUIRED by the theme
│   │   ├── hostx_tools/               HostX Tools Platform v2.2.6 (60+ online tools)
│   │   ├── CloudHost247_tools/        Same platform, CloudHost247-branded build (activate only ONE of the two)
│   │   ├── hostx_domain_lookup/       HostX Domain Lookup (4-tool WHOIS/IP/DNS/availability build,
│   │   │                              renamed from a second "hostx_tools" build — see module README)
│   │   ├── tools_center/              WHMCS Tools Center (UI addon + external-api backend —
│   │   │                              deploy external-api/ separately per its INSTALL.md)
│   │   ├── dnschecker/                DNS Checker client-area tool
│   │   ├── customaffiliate/           Custom affiliate commission engine
│   │   ├── digitalproducts/           Digital products marketplace / secure downloads
│   │   ├── phoneservices/             Phone number platform (Twilio/Telnyx style)
│   │   ├── smmaddon/                  SMM panel integration (admin part)
│   │   ├── soyoustart/                OVH/SoYouStart admin suite (WGS-OVH v8.0.8)
│   │   └── xtreme_currency_rates/     Xtreme Currency Rates (ionCube)
│   ├── gateways/                   ← Payment gateway modules
│   │   ├── blockonomics.php           Bitcoin/USDT gateway (official plugin v1.9.8)
│   │   ├── blockonomics/              Blockonomics library, payment page, templates
│   │   └── callback/blockonomics.php  Payment callback endpoint
│   └── servers/                    ← Provisioning (server) modules
│       ├── cloudhost247_lteproxy/     CloudHost247 LTE Proxy reseller module
│       ├── Smtphosting/               SMTP hosting provisioning (ModulesGarden v3)
│       ├── soyoustart/                SoYouStart dedicated server provisioning
│       ├── soyoustart_vps/            SoYouStart VPS provisioning
│       ├── hostx_email/               Email hosting provisioning (M365/GWorkspace/Pro)
│       └── smmprovisioning/           SMM panel order automation
├── templates/
│   ├── hostx/                      ← HostX theme (WHMCS Global Services)
│   │   ├── *.tpl                      ~130 theme pages (incl. 18 policy pages)
│   │   ├── includes/                  shared partials + blocks (70+ layout blocks)
│   │   ├── hostx_includes/            mega-menu, side-menu, SEO, live-chat partials
│   │   ├── css/ js/ fonts/ webfonts/  theme assets
│   │   ├── images/ img/ flags/        theme graphics, sprites, country flags
│   │   ├── domain_icons/ banners/ caticons/ og_images/ testimonial_images/
│   │   ├── error/                     WHMCS 8.8+ error pages
│   │   ├── store/ oauth/ payment/     MarketConnect store, OAuth, payment partials
│   │   └── marketconnect/             MarketConnect product artwork
│   └── orderforms/                 ← Order form templates (WHMCS → Setup → Order Forms)
│       ├── hostx/                     HostX order form (primary)
│       └── ovh_cart/                  OVH order form (standard_cart child, for SoYouStart)
└── docs/                           ← All documentation
    ├── RESTRUCTURING.md               full old→new mapping of this cleanup
    ├── policies/                      19 legal policy source PDFs + install notes
    ├── announcement-bar/              announcement bar usage docs + CloudHost247 variant
    └── build-notes/                   build/install notes per module
```

## Modules & activation quick reference

| Module | Type | Location |
|---|---|---|
| HostX (theme helper) | addon | `modules/addons/hostx/` |
| HostX Tools Platform v2.2.6 | addon | `modules/addons/hostx_tools/` |
| CloudHost247 Tools Platform (rebrand) | addon | `modules/addons/CloudHost247_tools/` |
| HostX Domain Lookup | addon | `modules/addons/hostx_domain_lookup/` |
| Tools Center (+ external API) | addon | `modules/addons/tools_center/` |
| DNS Checker | addon | `modules/addons/dnschecker/` |
| Custom Affiliate | addon | `modules/addons/customaffiliate/` |
| Digital Products Marketplace | addon | `modules/addons/digitalproducts/` |
| Phone Number Platform | addon | `modules/addons/phoneservices/` |
| SMM Addon | addon | `modules/addons/smmaddon/` |
| SoYouStart admin suite | addon | `modules/addons/soyoustart/` |
| Xtreme Currency Rates 6.0 | addon | `modules/addons/xtreme_currency_rates/` |
| Blockonomics | gateway | `modules/gateways/blockonomics.php` (+ `blockonomics/`, `callback/`) |
| CloudHost247 LTE Proxy | server | `modules/servers/cloudhost247_lteproxy/` |
| Smtphosting v3 | server | `modules/servers/Smtphosting/` |
| SoYouStart (dedicated) | server | `modules/servers/soyoustart/` |
| SoYouStart VPS | server | `modules/servers/soyoustart_vps/` |
| HostX Email Hosting | server | `modules/servers/hostx_email/` |
| SMM Provisioning | server | `modules/servers/smmprovisioning/` |

**Notes**
- `hostx_tools` and `CloudHost247_tools` are two brandings of the same platform —
  activate only one in WHMCS.
- `tools_center/external-api/` is a standalone PHP API backend. For security it
  must be deployed **outside** the WHMCS webroot (its own subdomain/server) —
  follow `modules/addons/tools_center/INSTALL.md`.
- The SoYouStart cron scripts in `crons/` need a `crons/config.php` defining
  `$whmcspath` if WHMCS is not reachable via `../init.php`.

## Runtime requirements (deployment target)

- WHMCS 8.x (order form `templates/orderforms/hostx` requires WHMCS 8.1+,
  error pages `templates/hostx/error/` require WHMCS 8.8+)
- PHP 7.4–8.2 with **ionCube Loader** (the `hostx` addon and
  `xtreme_currency_rates` are encoded), cURL, JSON, PDO, OpenSSL
- `templates/orderforms/ovh_cart/` falls back to WHMCS core `standard_cart`
  templates — a stock WHMCS installation provides them.
