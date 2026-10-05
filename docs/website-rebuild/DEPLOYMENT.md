# Deployment and acceptance runbook

## Scope and prerequisites

This is a WHMCS **child-theme rebuild**, not a replacement billing application.
Use the existing repository deployment process. Required on staging:

1. Licensed, working WHMCS installation with its own `init.php`, core routes,
   Twenty-One parent theme and `standard_cart` order form. These proprietary
   runtime files are intentionally absent from the repository.
2. Current backup of files, database, theme settings and Builder publications.
3. Existing CloudHost247 Foundation, Theme Manager, Builder/catalog and relevant
   provisioning addons installed and activated using their existing migrations.
4. Accurate WHMCS `SystemURL`, product mappings, currencies and public catalog.
   No migration or production setting was executed by this rebuild.

Select **CloudHost247** (`templates/cloudhost247`) as the client theme and
**CloudHost247 Cart** (`templates/orderforms/cloudhost247`) as the order form on
staging. Clear WHMCS's compiled Smarty cache using the supported admin action.
Do not overwrite the protected legacy theme or change its integrity baseline.

## Content and availability

- Existing published Theme Manager content wins. An existing unpublished entry
  still returns 404: the design must not accidentally republish withdrawn copy.
- When there is **no** CMS entry, the reviewed, neutral product editorial copy in
  `modules/addons/cloudhost247_theme/resources/site.json` provides a landing page.
  A database failure fails closed rather than bypassing publication controls.
- Theme Manager → **Import website drafts** copies missing editorial entries as
  drafts only, with the existing capability/CSRF/audit boundary. The action does
  not overwrite existing rows, invent plan mappings, or import legal terms.
  Importing a draft intentionally suppresses its bundled fallback until you
  review the draft and use **Publish reviewed page** with confirmation.
- Attach the real product group and billing cycle using the existing content
  fields / documented Theme Manager API. Do not substitute product IDs from a
  different deployment. Product rows/prices come from the Builder's existing
  bounded reader; verified infrastructure and email catalogs retain their own
  existing backends. Empty and unavailable states are deliberate.
- `terms-of-service.php`, `legal-notice.php` and
  `data-protection-standards.php` require the operator's published legal content
  in Theme Manager. The rebuild does **not** manufacture legal terms, dates,
  jurisdiction or certifications. Confirm these three routes before release.
- Other existing legal copy is preserved under first-party presentation wrappers.
  Legal/compliance staff should review that pre-existing copy; this work is not a
  legal audit or a certification of the original policies.
- The old misspelled dedicated-server route retains its 301. Known generic CMS
  aliases redirect to their canonical PHP routes. The old refund/cancellation
  page now points visitors to the existing actual Refund Policy, rather than
  displaying its previous dummy text.

## Builder and customized navigation

The Builder's own published `header_html` / `footer_html` take precedence on its
pages, with no second standard header/footer appended. Existing Builder form
processing, visibility rules, preview tokens, live data and compiled styles are
unchanged. All other pages use the shared first-party shell.

The new six mega menus and footer are maintained in `resources/site.json`. Run
`python3 scripts/verify-website.py` after edits. Theme Manager's existing custom
WHMCS navbar entries remain in the authenticated/workspace navbar; reconcile any
site-specific public navigation with the new registry before switching themes.
Builder/database-authored links cannot be certified from the source checkout.

## Optional Node platform connection

The Node application remains the existing application; it was not replaced with
mock controls or given a new authentication bypass.

Only after verifying its deployment, configure **Verified same-origin Node
platform mount** in Theme Manager, e.g. `/platform`. The reverse proxy must serve
that mount with correct application base paths and assets. Configure the Node
frontend's router/base path for that deployment; setting this theme field does
not reconfigure Vite/React Router or create a reverse proxy automatically.

The theme makes **read-only, credential-omitting** browser requests to:

- `{mount}/api/v1/apps?limit=24`: published application catalog only.
- `{mount}/api/v1/operating-systems`: the existing backend's active,
  provider-mapped, verified-image catalog.

Links lead to the platform's actual `/apps/:slug` and `/servers/new` views.
Deployment, operating-system selection and server mutations remain authenticated
in that platform. Until a mount is configured, catalog pages explicitly state
that no live catalog is connected. Do not enable it merely to make a screen look
populated. The PHP site and Node platform do not gain shared sessions from this
setting.

No GPU service, region, OS family, application brand, SLA or customer statistic
is implied by a diagram or menu entry. Availability comes from the backend.

## Logos, errors, search engines

- Global head already references the generated favicon, Apple icon, manifest
  and social image. Header honors the existing validated `logo_url` override.
- Configure the supplied PNG brand asset through existing invoice/email logo
  settings. Those settings were not modified on a production database.
- For a healthy WHMCS bootstrap, use `notfound.php` / `service-error.php` as
  appropriate. For failures before WHMCS can run, deploy `errors/*.html` as
  server error documents. Configure web-server response codes: static HTML
  alone cannot set HTTP 403/404/500/503.
- **Important:** the static error documents use `../` links because their
  canonical location is `/errors/`. If a web server internally serves them at an
  arbitrary request URL, transform those links to the configured installation
  base at deployment or serve error responses from a fixed base-aware handler.
  Do not add an untested global `.htaccess` rule that intercepts WHMCS routes.
- Submit `cloudhost247-sitemap.php` and `builder-sitemap.php` in the search console.
  Insert their absolute URLs into `robots.txt` using your real SystemURL. No
  environment-specific production domain is hard-coded into the new assets.
- Search covers editorial service/policy routes and delegates documentation
  searches to WHMCS's real knowledgebase form. News links lead to published
  announcements. This is not a cross-database full-text index of private records.

## Required staging tests — do not skip

```bash
bash scripts/release-candidate-check.sh
python3 scripts/verify-website.py --base https://YOUR-STAGING-WHMCS/ --output staging-web.json
```

The optional HTTP check performs only public reads. It checks response, title,
branding, shell, fatal-error text, same-origin images/CSS/JS and safe public links.
It does not place orders, renew domains, provision servers or sign in as a user.

Manually test login, registration, password reset, MFA/passkeys, account switching,
admin masquerading, language/currency selection, support, invoices, domain search,
registration, transfer, renewal, cart configuration, tax, checkout and callbacks.
Use test gateways and approved test accounts. Check module-specific server and
email actions in each supported provider's staging environment.

Check the active parent-theme version's head scripts, modal behavior, captcha,
sidebar/navigation hooks and responsive tables. Verify any Builder override,
custom navbar item, database-authored media/URL, and multi-language/RTL content.

The fixture preview is intentionally not a live WHMCS site. It cannot certify
these workflows. The full Node test suite must also complete successfully in CI
before merging; the local all-suite run did not finish cleanly.

## Rollback

Restore the prior theme/orderform selections and their settings from the backup.
The legacy files and all original PHP entry points remain present; no original
vendor integrity hash was re-cut. Roll back the feature commit to remove the new
first-party templates if necessary. Imported CMS drafts are retained data; do
not bulk-delete existing operator content to undo a theme switch.
