# Public service landing-page visual refresh

## Scope

46 registry-driven landing pages, six standalone service pages, and the domain-services hub. Google Workspace and Microsoft 365 retain their dedicated treatments from the same branch.

Bright hero surfaces, responsive local imagery, layered editorial cards, consistent buttons, and accessible focus styles. Original existing catalogue logos are reused on WordPress, cPanel, Docker, and Laravel pages. Generic editorial tiles are not presented as vendor logos.

No pricing, provider availability, plans, checkout, account or admin logic changed. Domain search still uses the original API and preserves its provider-not-configured state. Informational pages such as About, Help, Docs and Blog do not opt in. Transactional domain tools, catalogue plan-selection screens and app/control-panel directories keep their functional layouts.

Imagery reuses the existing local illustrative photography library (see PHOTOGRAPHY-LICENSES.md). It is not represented as actual facilities or customers.

## Registry routes

- `/cloud`
- `/cloud/public`
- `/cloud/private`
- `/cloud/enterprise-servers`
- `/cloud/game-servers`
- `/cloud/infrastructure`
- `/cloud/data-centers`
- `/cloud/network`
- `/cloud/operating-systems`
- `/cloud/server-management`
- `/cloud/monitoring`
- `/cloud/backups`
- `/cloud/firewall`
- `/cloud/security`
- `/cloud/ip-management`
- `/cloud/managed-services`
- `/developers`
- `/developers/deployment`
- `/developers/environments`
- `/developers/nodejs`
- `/developers/php`
- `/developers/python`
- `/developers/laravel`
- `/developers/docker`
- `/hosting`
- `/hosting/web-hosting`
- `/hosting/business`
- `/hosting/wordpress`
- `/hosting/reseller`
- `/hosting/windows`
- `/hosting/email`
- `/hosting/developer`
- `/hosting/api`
- `/hosting/ssl`
- `/hosting/backups`
- `/hosting/migration`
- `/hosting/security`
- `/platforms`
- `/platforms/applications`
- `/platforms/databases`
- `/platforms/containers`
- `/platforms/paas`
- `/hosting/vps`
- `/hosting/dedicated`
- `/hosting/cpanel`
- `/websites`

## Standalone pages

- Remote desktop
- SMTP hosting
- Social media services
- Virtual numbers
- Proxy services
- Digital products
- Domain-services hub

## Validation

362 tests passed across marketing pages, storefronts, visual assets and domain-search interaction suites. Frontend TypeScript check passed. Responsive source-file existence is tested. Browser screenshot verification remains blocked by missing Chromium system library libnspr4.so; no pixel-perfect certification is claimed.

## Per-page imagery correction

The user rejected reusing one hero image on multiple pages. The previous six-family
photo fallback has been removed. `service-hero-assets.json` now assigns an explicit
image to each of the 53 service landing pages; Google Workspace and Microsoft 365
keep their separate images. The mix includes existing page-specific 3D illustrations,
photography, and service diagrams, rather than presenting all pages as photographs.
No image was merely renamed or recoloured to create a separate assignment.

Regression tests verify 55 unique hero paths and 55 unique file hashes, including
the two productivity pages. They also reject duplicated responsive AVIF variants.
These checks cover the refreshed landing-page heroes, not every image in other
sections or the unchanged informational pages.
