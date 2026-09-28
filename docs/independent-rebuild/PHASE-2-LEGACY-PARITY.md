# Phase 2 — legacy-theme-to-CloudHost247 parity report

Date: 2026-09-27

## Architecture and vendor independence

CloudHost247 is implemented as a WHMCS 8.1+ child theme of the WHMCS-supplied `twenty-one` theme. This is intentionally independent of the legacy vendor theme while inheriting the maintained WHMCS templates for authentication, account, service, domain, invoice, quote, ticket and MarketConnect workflows. The cart is an independent child of WHMCS `standard_cart`. Neither child has a path, include, hook, setting or network call to the legacy vendor stack.

The `cloudhost247_theme` addon owns branding/content configuration and supplies published content through WHMCS hooks. Original legacy vendor files remain unchanged and are not needed when CloudHost247 is selected.

## Feature matrix

| Original legacy-theme capability | CloudHost247 replacement/evidence | Status | Runtime evidence needed |
|---|---|---|---|
| Responsive theme shell | `templates/cloudhost247/theme.yaml`, responsive `css/custom.css`; inherits maintained Twenty-One core templates | Implemented, staging-blocked | WHMCS browser matrix |
| Header/core navigation | Twenty-One accessible header plus `ClientAreaPrimaryNavbar` database navigation hook with nesting/order | Implemented, staging-blocked | Menu API rendering |
| Mobile navigation | Parent Twenty-One mobile navigation; minimum touch sizing and mobile CSS | Implemented via parent, staging-blocked | Mobile screenshots |
| Footer management | Branding settings and published footer blocks rendered by `ClientAreaFooterOutput` | Implemented, staging-blocked | Footer hook placement |
| Branding | Brand, colors, typography, width, support email, logo field; CSS variables affect client UI | Implemented; logo rendering partial | Logo currently follows WHMCS core header configuration; custom field retained for next header enhancement |
| Theme admin | Real validated settings/content forms, inventory, publish/draft/delete | Implemented, staging-blocked | Admin role/CSRF test |
| Homepage | Hero, CTA, announcement, banners, ordered sections and testimonials from database | Implemented, staging-blocked | Homepage render |
| Hosting landing pages | `landing` records exposed to templates; `page` custom route supports rich landing content | Partially implemented | Dedicated product-query components and staging routes remain |
| CMS pages | Published page lookup and `cloudhost247-page.php?slug=` route; true 404 response | Implemented, staging-blocked | Route rewrite/browser test |
| Section/page builder | Safe ordered section records with body, summary, image/link and publish state | Practical equivalent implemented | Drag-and-drop UI/preview not implemented; numeric ordering is functional |
| Banners | Ordered published banner cards with images, copy and links | Implemented, staging-blocked | Image/CSP tests |
| Testimonials | Ordered, escaped customer-story cards | Implemented, staging-blocked | Visual test |
| Navigation management | Nested parent slug, ordering, target and safe URL validation | Implemented, staging-blocked | WHMCS menu API test |
| SEO title | Per-page SEO title drives ClientArea page title | Implemented, staging-blocked | Browser title test |
| SEO description/OG/canonical | Stored safely in page payload | Partially implemented | Head injection scoped to custom page and sitemap remain |
| Legal/policy pages | Existing legal routes/content preserved; new CMS route can publish replacements without changing records | Partial/preserved | Content-rights review and route regression |
| Custom routes | Generic WHMCS ClientArea route with slug validation and published-only lookup | Implemented, staging-blocked | Friendly rewrite optional |
| Client dashboard | Inherited from supported WHMCS Twenty-One parent and consumes native WHMCS session/data | Implemented via parent, staging-blocked | Supported-version test |
| Login/register/password reset | Inherited unchanged from WHMCS parent; no auth replacement | Implemented via parent, staging-blocked | Auth-flow test |
| Services/domains | Inherited native WHMCS templates/data | Implemented via parent, staging-blocked | Account test data |
| Invoices/transactions/quotes | Inherited native WHMCS templates/data | Implemented via parent, staging-blocked | Billing-flow test |
| Tickets/knowledgebase | Inherited native WHMCS templates/data | Implemented via parent, staging-blocked | Ticket-flow test |
| Profile/contacts/payment methods | Inherited native WHMCS templates and authorization | Implemented via parent, staging-blocked | Account test |
| Cart/checkout | `templates/orderforms/cloudhost247`, child of maintained `standard_cart`; scoped visual overrides | Implemented via parent, staging-blocked | Product/configure/checkout/3DS test |
| Language management | WHMCS parent language system remains active; CMS content currently single-language | Partial | Localized CMS records remain |
| TLD/category/dedicated special settings | Native WHMCS product/domain data is used; no duplicate subsystem | Partial/not separately reproduced | Product landing components remain |
| Live chat | No provider-neutral requirement/configuration identified | Not practically reproduced yet | Select a properly licensed chat provider |
| Sitemap generation | Not implemented | Incomplete | Phase 2 follow-up after route inventory |
| Drag/drop visual builder | Numeric ordering and safe section editor implemented instead | Practical equivalent, partial | Visual drag/drop and preview remain |

## Implemented files and behavior

* Independent WHMCS child theme and standard-cart child.
* Responsive CloudHost247 visual system with accessible skip link, semantic regions, responsive cards and reduced-motion handling.
* Working database-backed settings and CMS repository.
* Published/draft pages, landing records, sections, navigation, banners, testimonials and footer blocks.
* Real homepage rendering and custom client-area route.
* WHMCS navbar/footer/head/page hooks; settings affect CSS and rendered content.
* Admin authentication and CSRF enforcement inherited from Phase 1 guard; validation for colors, email, URLs, lengths, types and ordering.
* Allowlist HTML sanitizer, escaped ordinary output, safe external target behavior and 404 handling.
* No new customer, service, product, invoice, domain or ticket stores.

## Remaining and known limitations

Runtime compatibility is not claimed without the supported WHMCS staging installation. SEO description/OG/canonical output, sitemap, localized CMS variants, dedicated product-query landing components, logo override, visual preview and drag/drop ordering remain incomplete. Parent-theme behavior requires WHMCS 8.1+ and the stock `twenty-one` and `standard_cart` directories. No screenshots are available because this repository has no WHMCS runtime or PHP executable.

## Installation, upgrade and rollback

See `INSTALLATION-AND-UPGRADE.md`. Upgrades are additive through versioned migrations; this phase needs no destructive schema migration. Rollback selects the stock parent themes and disables Theme Manager while retaining its records.

## Test results

* Python static suite: **7 passed, 0 failed**.
* Original preservation manifest: **2,535 passed, 0 changed**.
* `git diff --check`: passed.
* PHP lint/unit suite: committed to CI but locally blocked because PHP is unavailable.
* WHMCS/staging/browser screenshots: blocked because no WHMCS core/database/runtime was supplied.
* Vendor independence: replacement source has no legacy-vendor include, activation or licence-key field; child parents are stock WHMCS themes only.
