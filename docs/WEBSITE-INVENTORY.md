# CloudHost247 — Website & Repository Inventory (Rebuild Audit)

Source of truth for the global website rebuild. Every public route, module and
theme surface is inventoried with a decision: **keep, redesign, redirect, or
exclude**. Honesty rules: the catalog/database is authoritative; nothing is
shown as available that the backend does not actually provide.

## 1. Backend capability map (what is REAL)

| Capability | Where it lives | Status |
|---|---|---|
| Web hosting catalog | platform catalog products/plans | live (web-hosting seeded; others publish when configured) |
| VPS provisioning | `modules/servers/soyoustart_vps` + platform OS catalog | live when plans configured |
| Dedicated servers | `modules/servers/soyoustart` (+ OVH admin suite) | live when plans configured |
| RDP | `modules/servers/RDP` | module present — publish when plans configured |
| Email hosting (M365 / Google Workspace / Professional) | `modules/servers/cloudhost247_email_hosting` | module present |
| SMTP hosting | `modules/servers/Smtphosting` | module present |
| LTE proxy | `modules/servers/cloudhost247_lteproxy` | module present |
| Phone numbers / eSIM | `modules/servers/phoneservices_*` + addon | module present |
| SMM marketplace | `cloudhost247_smm` addon + server | module present |
| Digital products | `modules/addons/digitalproducts` | module present |
| Application marketplace (52 manifests) | `cloudhost247-node/manifests/*` | real catalog — surfaced on Applications pages |
| Deployment pipeline (queue, worker, agent, env vars, volumes, domains) | docs/PHASE_6_MARKETPLACE_DEPLOYMENTS.md | implemented in the node platform |
| OS catalog (family/version/arch/provider image) | docs/SERVER_PROVISIONING.md | operator-configured — page shows configured entries only |
| Domain services (register/transfer/renew, search, WHOIS) | platform domain layer + `cloudhost247_domain_lookup` | live |
| Domain brokerage | `modules/addons/cloudhost247_broker` + terms page | real — gets a first-class page |
| Website builder | `modules/addons/cloudhost247_builder` | keep; gated pages |
| Email marketing | `modules/addons/cloudhost247_marketing` | keep tracking endpoint |
| 79 online tools | `modules/addons/cloudhost247_tools` | module present |
| DNS checker | `modules/addons/dnschecker` | module present |
| Passkeys / 2FA | platform auth + `cloudhost247_passkey` | live |
| Crypto payments | `modules/gateways/blockonomics` | module present |
| Currency rates | `cloudhost247_currency` + xtreme addon | multi-currency ready |
| Cart recovery | `cloudhost247_cart_recovery` | module present |

**Not configured (must not be claimed):** GPU/compute, specific control panels
(cPanel/Plesk/DirectAdmin/Webmin), OS image list, cloud regions/locations,
uptime numbers, certifications. All are admin-configurable data models — pages
show them only once configured.

## 2. Root PHP pages (58 files) — decisions

All 54 legacy stubs were regenerated as professional standalone pages
(commit history: PHP regeneration phase). Current decisions:

| Page | Decision |
|---|---|
| index.php | redesigned homepage (global experience) |
| web-hosting / wordpress-hosting / cpanel-hosting / plesk-hosting / windows-hosting | redesigned product pages, live catalog pricing |
| vps-hosting / vps-privatecloud / vps-publiccloud | redesigned, live VPS line |
| dedicated-server | redesigned; `dedeicated-server.php` = 301 redirect (typo canonicalized) |
| enterprise-servers / game-servers | redesigned positioning pages |
| email-hosting / ssl-certificate / website-design / developer-friendly | redesigned |
| domain.php | marketplace: live extension pricing + register/transfer/renew |
| domain-brokerage.php | **NEW** — first-class brokerage product page |
| applications.php | **NEW** — real 52-app catalog from manifests |
| control-panels.php | **NEW** — admin-configurable, honest empty state |
| operating-systems.php | **NEW** — shows configured OS catalog only |
| app-deployment.php | **NEW** — deployment/PaaS platform page (implemented features only) |
| server-management.php | **NEW** — available vs coming-soon split |
| offers.php | live catalog offers |
| blog.php | content-API driven (list + article view) |
| help-center.php / faqs.php | support hub + FAQ (JSON-LD) |
| aboutus.php / comingsoon.php / notfound.php | redesigned |
| legal.php + 17 policy pages | preserved authored content, professional shell |
| cloudhost247-hosting/sample/vps-sample/all-element/future-element/tables | 301 redirects to canonical pages |
| cloudhost247-page.php | clean 404 with guidance |
| cloudhost247-sitemap.php | standalone XML sitemap (pages + published articles) |
| cloudhost247-marketing-track.php | functional endpoint preserved (gated) |
| builder-page.php / builder-sitemap.php | gated; original logic in legacy routers |

## 3. Navigation & footer contract

Mega menu groups (one shared definition, used by the static site, the PHP
layer and the WHMCS theme include):

- **Hosting** — Web, WordPress, Business(web), Windows, cPanel, Plesk, Developer, Managed(web)
- **Cloud & Servers** — VPS, Public Cloud, Private Cloud, Dedicated, Enterprise, Game Servers, Server Management
- **Domains** — Search/Register, Transfer, Pricing, Brokerage, Renewal policy
- **Applications** — top categories + featured apps from the real manifest catalog, link to full catalog
- **Developers** — Developer hosting, App deployment/PaaS, OS catalog, Control panels, Docs/KB
- **Resources** — Help Center, FAQs, Blog, Offers, Status
- **Company** — About, Contact, Legal

Footer: PRODUCTS / CLOUD & SERVERS / DOMAINS / DEVELOPERS / RESOURCES /
COMPANY / LEGAL columns — every link resolves to a real route; enforced by
`tests/site-footer-links.test.js` (no `#`, no empty hrefs, no missing files).

## 4. Theme & WHMCS integration

- `templates/cloudhost247/` (independent theme, child of twenty-one) receives
  the shared design system: `includes/ch247-megamenu.tpl`,
  `includes/ch247-footer.tpl`, `css/cloudhost247-global.css` so the client
  area matches the marketing site.
- Legacy theme (`cloudhost247_legacy`, ~130 templates) stays functional; the
  ionCube theme-helper addon is untouched (branding compatibility per
  docs/BRANDING-COMPATIBILITY.md).
- Order forms (`templates/orderforms/*`) untouched — checkout stays WHMCS.

## 5. Branding rules

- Legal name: **CloudHost247 Isc.** — customer-facing brand: **CloudHost247**
  — technical/compact: **CH247**.
- Retired vendor branding never reintroduced in customer-facing content.

## 6. Asset library

```
platform/public/assets/brand/   logo.svg, logo-white.svg, logo-dark.svg, icon.svg,
                                logo-horizontal.svg, logo-compact.svg, favicon.svg, og.svg
platform/public/assets/icons/   icons.svg (unified stroke icon system)
platform/public/assets/img/     generated hero/cloud/deployment artwork (WebP/PNG)
templates/cloudhost247/images/  brand/ icons/ hero/ mirrors for the theme
```

All large images are lazy-loaded with width/height and alt text; logos ship as
SVG (crisp on any background: white, dark, navy infrastructure).
