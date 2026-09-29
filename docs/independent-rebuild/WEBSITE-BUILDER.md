# CloudHost247 Website Builder

**Module:** `modules/addons/cloudhost247_builder`
**Admin location:** Addons → CloudHost247 Website Builder
**Status:** ships inactive; activation creates its own tables and seeds
Super-Admin-only capabilities.

A visual page builder for the public website: pages, templates, theme parts,
navigation menus, global styles, a media library, forms, SEO settings, custom
CSS and revision history — all driven by one versioned page schema.

---

## 1. Design in one paragraph

A page is a JSON document. The editor edits that document in the browser, and
asks the server to render it after every change; the server renders it with the
same `Renderer` that serves published pages. Saving writes the document to a
draft column. Publishing copies the draft into a separate published column.
The public front controller reads only the published column. That is the whole
architecture, and it is what makes "the preview matches the published page" a
structural property rather than a promise.

```
            ┌──────────────── document (cloudhost247-page/v1) ───────────────┐
            │                                                                │
  editor.js ──POST──▶ AdminController ──▶ SchemaValidator ──▶ Renderer ──▶ canvas HTML
                            │                                     ▲
                            ├── saveDraft ──▶ pages.document_json  │
                            ├── publish  ──▶ pages.published_json ─┘
                            └── revision ──▶ revisions.document_json

  visitor ──▶ builder-page.php ──▶ PageResolver ──▶ Renderer ──▶ published HTML
```

---

## 2. Page schema

`Document` (`lib/Schema/Document.php`) is the only way content enters the
system, and it can only be constructed through `SchemaValidator`.

```json
{
  "schema": "cloudhost247-page/v1",
  "version": 1,
  "children": [ { "id": "a1b2c3d4e5f6", "type": "section", "widget": "",
                  "props": {...}, "style": {"desktop": {...}, "tablet": {...}, "mobile": {...}},
                  "settings": {"css_class": "", "anchor": "", "hidden": {...}},
                  "children": [...] } ],
  "meta": { "generator": "cloudhost247-builder", "schema_version": 1 }
}
```

**Structure rules** (`lib/Schema/Node.php`)

| Parent | May contain |
|---|---|
| document root | `section` |
| `section` | `container` |
| `container` | `container`, `column`, `widget` |
| `column` | `container`, `widget` |
| `widget` | nothing |

**Limits:** 600 elements, 12 levels of nesting, 2 MiB of JSON, JSON depth 64.

**Validation** (`lib/Schema/SchemaValidator.php`) enforces the structure, mints
a server-side id for anything whose id is missing, malformed or duplicated,
sanitises props against the widget catalogue, sanitises styles against
`StyleSchema`, filters class names and anchors, and reports every rejection.
Editor saves and template imports run in strict mode, so a document either
validates completely or is refused with an explanation.

**Versioning** (`lib/Schema/DocumentMigrator.php`) upgrades older documents in
memory before validation and refuses a document written by a newer release
rather than rendering it incorrectly.

---

## 3. Widget library

43 catalogue entries: 3 layout containers plus 40 widgets.

| Group | Widgets |
|---|---|
| Layout | section, container, column, spacer, divider, tabs, accordion, carousel |
| Content | heading, text editor, image, gallery, video, icon, button, list, testimonial, pricing table, counter, progress bar, call to action |
| Business | hosting plans, product card, order button, server specifications, domain search, domain pricing, cart, checkout link, customer reviews, form, FAQ, service status, **Broker This Domain, Domain Brokerage CTA, Brokerage Status, Customer Brokerage Cases, Brokerage Pricing, Brokerage FAQ** |
| Site | logo, navigation menu, account links, copyright |

The six Domain Brokerage widgets read live data from the `cloudhost247_broker`
module through the same `LiveDataSource` contract as every other business
widget: `brokerageAvailability()`, `brokerageFees()` and `brokerageCases()`.
If that module is not installed, or the Super Admin has not turned brokerage
on, each widget says so plainly ("Domain Brokerage is not installed" /
"Domain brokerage requests are not currently being accepted") instead of
rendering a form nobody can submit. "Brokerage Status" and "Customer
Brokerage Cases" only ever show the signed-in visitor's own cases — an
anonymous visitor is asked to sign in, never shown a sample case — and both
link into the real, fully-featured brokerage client area
(`index.php?m=cloudhost247_broker`) for full case detail, negotiation history
and payment status rather than re-implementing that UI inside a page. "Broker
This Domain" submits straight to the brokerage module's own request form,
exactly as the existing "domain search" widget posts to the WHMCS domain
checker rather than re-implementing availability checking.

There is deliberately **no raw HTML, shortcode or custom-script widget**. The
only executable code on a published builder page is the module's own
`runtime.js`.

### Live data, and what happens when it is missing

`LiveDataSource` (`lib/Contracts/LiveDataSource.php`) returns `null` whenever a
source cannot be read. That "unknown" travels to the renderer, which then:

* **in the editor** shows a dashed notice naming exactly what is missing
  ("WHMCS products could not be read: the product catalogue table is not
  present"), and collects it into the toolbar notice list;
* **on a published page** omits the block entirely.

| Widget | Real source |
|---|---|
| hosting plans, product card, order button, server specs | `tblproducts`, `tblproductgroups`, `tblpricing` (default currency; `-1` means "not offered", never rendered as 0) |
| domain search | posts to `domainchecker.php`; availability is decided by WHMCS |
| domain pricing | `tbldomainpricing` + `tblpricing`, WHMCS year columns (`msetupfee` = 1 year), client-group override rows excluded |
| cart, checkout link | the visitor's real WHMCS cart session; links to `cart.php?a=view` / `cart.php?a=checkout` |
| account links | real session state: a signed-in visitor is offered the client area, not a login link |
| customer reviews | published testimonials in the legacy theme content store |
| service status | `IntegrationManager::installed()` — measured health only |
| Broker This Domain, Domain Brokerage CTA | `cloudhost247_broker`'s `SettingsRepository::isBrokerageEnabled()`; the CTA is hidden unless brokerage is actually turned on, and the form posts to the module's real new-case endpoint |
| Brokerage Status, Customer Brokerage Cases | the signed-in visitor's own rows from `cloudhost247_broker`'s `CaseRepository::forClient()`, never another customer's cases and never a sample case |
| Brokerage Pricing | `cloudhost247_broker`'s `FeeRepository::enabled()` — the admin-configured fee rules, or an honest "not configured" notice |

The builder never re-implements a cart, a checkout, an authentication form, or
the brokerage negotiation/payment/transfer workflow itself.

---

## 4. Responsive styling

`StyleSchema` (`lib/Schema/StyleSchema.php`) is an allowlist of roughly fifty
properties, each with a declared kind (length, colour, keyword, number, font,
shadow, media). Values that are not valid for their kind are dropped and
reported — a style value can never reach the page verbatim.

* Three device buckets: `desktop`, `tablet`, `mobile`.
* Breakpoints: tablet `max-width: 1024px`, mobile `max-width: 767px`.
* `StyleCompiler` emits one rule per element (`.ch247-n-<id>`), groups tablet
  and mobile rules into the two media queries, and scopes desktop-only hiding
  to `min-width: 1025px`.
* Colours and fonts may reference global tokens (`primary`, `heading`, …),
  which compile to `var(--ch247-color-primary)` and friends.
* `runtime.css` gives every page border-box sizing, `max-width` on media,
  wrapping flex rows and single-column stacking below 768px, so a published
  page adapts without horizontal overflow.

---

## 5. Publishing

| State | Stored | Publicly reachable |
|---|---|---|
| draft | `document_json` | no |
| scheduled | `document_json` + `published_json`, `publish_at` in the future | no, until the moment arrives |
| published | `document_json` + `published_json` | yes |
| archived | `document_json` | no |

* `saveDraft()` never writes `published_json`. There is no code path where
  editing changes the live page.
* `unpublish()` clears `published_json` outright rather than hiding it, so an
  unpublished URL returns 404 with nothing left to leak.
* Scheduling snapshots the draft immediately but leaves the status
  `scheduled`; `PageResolver` checks the time itself, so a page never goes live
  early and never goes live late because a cron did not run.
  `crons/cloudhost247_builder.php` only keeps the stored status honest and
  purges expired preview tokens.
* Draft previews use a random token; only its SHA-256 is stored, it expires
  (30 minutes by default), and a preview is always `noindex,nofollow`.
* Visibility `clients` and `admins` are checked against the real WHMCS session.

**Revisions.** Every content change writes a revision; autosaves are flagged
and pruned first; published snapshots are never pruned. Restoring loads a
revision into the draft and keeps the replaced draft as a revision of its own,
so a restore is itself reversible — and the live page does not change until the
administrator publishes.

---

## 6. Theme Builder

Theme parts are additive layers: global header, global footer, homepage,
landing, blog, archive, service, error and login/registration banner layouts.
Each has draft and published copies, a priority and display conditions
(`all`, `front page`, a specific page, a slug prefix, a page type) with
exclusions that always win.

No CloudHost247 or WHMCS template file is read or modified. A site with no published
parts behaves exactly as it did before the module was installed, and login and
registration remain WHMCS's own pages — the builder can only decorate around
them, never replace the authentication flow.

---

## 7. Templates and portability

A template package is JSON:

```json
{ "format": "cloudhost247-template/v1", "exported_at": "...",
  "template": { "key": "...", "name": "...", "category": "...", "description": "..." },
  "document": { ...page document... },
  "checksum": "sha256 of the document" }
```

Import is a two-step operation: **inspect** reports the template name, element
count, widget list, checksum verification and any warnings without saving
anything; only an explicit second action imports it. The document is validated
in strict mode, so an imported template cannot introduce an unknown widget, an
unvalidated style, a script tag or a rejected URL. Nothing in a package is
executed and no file is written by an import.

Nine built-in templates are seeded on activation (hero, feature trio, live
plans, domain band, FAQ, contact, header, footer, full landing page). They
contain layout and copy only; every price in them is read live at render time.

---

## 8. Media library

Accepted: `jpg`, `jpeg`, `png`, `gif`, `webp`, `ico`, `mp4`, `webm`, `pdf`.

Refused with an explanation: SVG (can carry script), HTML, JavaScript, PHP and
anything else not on the list.

Pipeline: PHP upload error → size limit → extension allowlist → double-extension
check → `finfo` MIME match → magic-byte check → image decode check → SHA-256
de-duplication → server-generated file name (`slug-<checksum10>.ext`) → write
inside the resolved media root → `chmod 0644`.

The media directory gets a hardened `.htaccess` (`php_flag engine off`,
`Options -Indexes -ExecCGI`, deny for executable extensions) and every path is
re-checked with `Paths::containedPath()`, which refuses absolute paths,
traversal and symlinked destinations. Deleting an item first reports which
pages reference it.

---

## 9. Forms

Fields: text, email, tel, number, url, date, textarea, select, checkbox — with
required flags, placeholders, help text and choices. Up to 30 per form.

Public pages are anonymous, so a submission is protected by a signed
time-limited token bound to the form (HMAC over form id and issue time with a
key generated once and never displayed), a honeypot field, a minimum fill time
and a per-address rate limit. The address is only ever stored as a salted hash.

A submission is **always stored first**, then notified: a support ticket via
`localAPI('OpenTicket')` and/or an admin notification via
`localAPI('SendAdminEmail')`. Either can fail without losing the submission,
and the outcome string records exactly what happened. Mail transport stays with
WHMCS — **the builder stores no SMTP credentials**; anything an integration
needs belongs in the API & Integrations vault.

---

## 10. Security

| Concern | Control |
|---|---|
| Authentication | `AdminGuard::requireAdmin()` on every request |
| CSRF | `AdminGuard::requirePostToken()` on every write, including the editor's JSON API |
| Authorisation | Ten capabilities; publish, delete, settings and custom CSS are Super-Admin-only by default and never overwritten once set |
| Rich text | `HtmlSanitizer`: DOM-based tag/attribute allowlist, script/style/iframe/object/form/svg removed with their contents, event handlers and inline styles stripped, `href`/`src` through `UrlPolicy`, `target="_blank"` forced to `rel="noopener noreferrer"` |
| URLs | `UrlPolicy`: https/http/mailto/tel for links, https/http for media; rejects `javascript:`, `data:`, protocol-relative, backslash and control-character tricks |
| Custom CSS | `CssSanitizer`: rejects `expression()`, `behavior:`, `-moz-binding`, `@import`, `javascript:`/`vbscript:` URLs, remote `url()`, unicode escapes, unbalanced braces and anything that could close the `<style>` element |
| Uploads | Extension + MIME + magic byte + decode checks, server-generated names, no-execute directory |
| Template import | JSON only, strict validation, checksum reported, nothing executed, nothing written to disk |
| Output | Everything escaped at the point of output; the only unescaped strings are sanitiser output and the module's own markup |
| Structured data | The one `<script>` element the renderer emits is FAQ JSON-LD, encoded with `JSON_HEX_TAG/AMP/APOS/QUOT` |
| Logging | Builder event log drops credential-shaped keys at any depth and stores addresses only as a salted hash |
| Audit | Page create/update/publish/unpublish/delete and CSS changes also go to the foundation audit trail |

An ordinary administrator without `builder.css` cannot introduce CSS; nobody,
at any capability level, can introduce JavaScript through page content.

---

## 11. Database

Eleven additive, `hasTable`-guarded tables, all prefixed
`mod_cloudhost247_builder_`: `pages`, `revisions`, `templates`, `parts`,
`menus`, `media`, `forms`, `submissions`, `settings`, `preview_tokens`,
`events`. No WHMCS core table is created, altered or dropped, and deactivating
the module deletes nothing.

---

## 12. Testing

```
php tests/builder/run.php                      # 307 behavioural assertions (7.4 and 8.2)
python3 -m unittest tests.builder.test_static  # 46 structural and policy tests
```

`tests/builder/fakes.php` backs the WHMCS Capsule facade with real SQLite
through PDO, so the module's own migration creates the tables and the
repositories run their real queries. Simulated: the admin session, the CSRF
check, the audit trail and `localAPI`. Not simulated: validation, sanitisation,
rendering, publishing, permissions, uploads or form handling.

What the behavioural suite proves, in its own words:

* a page can be created, edited, saved and published without writing code;
* an unpublished page is not publicly reachable, and unpublishing removes the
  live copy;
* a scheduled page is not served early and is served once its time arrives;
* a preview token shows the draft, expires, and never affects the public page;
* preview and published output are byte-identical, and the editor canvas
  differs only by its editing attributes;
* hosting widgets show live prices and say "price not published" rather than
  inventing one; an unreadable catalogue publishes nothing;
* script in a heading, in rich text, in an imported template and in a menu link
  is neutralised;
* a PHP payload renamed to `.png`, an SVG, a `.php` file and a traversal file
  name are all refused by the media pipeline;
* forms reject forged tokens, honeypot hits, too-fast submissions, missing
  required fields, invalid addresses and floods;
* revisions restore into the draft without touching the live page;
* the admin controller refuses a missing CSRF token and a missing capability.

---

## 13. Operations

**Activation** creates the tables, seeds nine built-in templates, prepares and
hardens the media directory, reports whether the WHMCS catalogue and the
integrations centre are readable, and restricts the capabilities.

**Deactivation** keeps every page, revision, template, part, menu, media
record, form and submission. While deactivated, `builder-page.php` stops
serving builder URLs.

**Cron** (optional): `php crons/cloudhost247_builder.php` — publishes due
scheduled pages and purges expired preview tokens. `--dry-run` reports without
changing anything.

**Front controller:** `builder-page.php?slug=<slug>`; pretty URLs can be mapped
to it with a rewrite rule.

**Environment:** `CH247_BUILDER_MEDIA_ROOT`, `CH247_BUILDER_MEDIA_URL`
(optional). No credentials, endpoints or secrets are stored by this module.
