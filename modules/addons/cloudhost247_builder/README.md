# CloudHost247 Website Builder

Visual, drag-and-drop page builder for the public CloudHost247 website, built
into the WHMCS admin as **Addons → CloudHost247 Website Builder**.

It is an addition to the site, not a replacement for it. No HostX template file
is read, written or overridden; builder pages render inside the active client
area theme, so the existing branding, navigation, cart, checkout, login and
registration keep working exactly as before. The module ships **inactive**.

## What it does

| Area | Summary |
|---|---|
| Pages | Unlimited pages with title, address, status, visibility, SEO fields, header/footer choice, scheduling and revision history |
| Editor | Full-screen canvas with widget palette, page structure tree, inspector, responsive previews, undo/redo, copy/paste, duplicate, inline text editing and drag-and-drop |
| Widgets | 34 widgets in four groups (layout, content, business, site) plus three layout containers |
| Theme Builder | Global headers, footers and layout parts with display conditions |
| Templates | Reusable sections and pages, exportable and importable as validated JSON |
| Media | Upload, search, categorise and describe images, video and documents |
| Forms | Visual form builder, stored submissions, ticket creation and admin notification through WHMCS |
| Global styles | One palette and type scale exposed to every page as CSS custom properties |
| Custom CSS | Capability-gated, validated stylesheet for builder pages |
| Revisions | Every saved change kept, restorable into the draft without touching the live page |

## Three rules the code keeps

**1. One schema, one renderer.** A page is a versioned JSON document
(`cloudhost247-page/v1`). The editor canvas, the draft preview, the published
page, template export and revision history all read and write that same
document through the same `Renderer`, so a preview cannot drift from what gets
published.

**2. Nothing is invented.** Hosting plans, product cards, order buttons, domain
search and pricing, cart, checkout and service status read WHMCS and the API &
Integrations centre at render time. When a source cannot be read, the editor
tells the administrator exactly what is missing and the published page omits
the block. There is no demo price anywhere in the module.

**3. Content cannot become code.** Rich text passes `HtmlSanitizer`, URLs pass
`UrlPolicy`, styles pass `StyleSchema`, custom CSS passes `CssSanitizer`,
uploads pass an extension, MIME and magic-byte check, and template import is
JSON-only — it executes nothing and writes no file.

## Layout

```
cloudhost247_builder.php      Addon entry: config, activate, deactivate, output
bootstrap.php                 Autoloader for CloudHost247\Builder\
hooks.php                     ClientAreaHeadOutput / FooterOutput (additive only)
migrations/V100.php           Eleven mod_cloudhost247_builder_* tables
lib/Support/                  Exceptions, slugs, ids, URL policy, HTML and CSS sanitisers, paths
lib/Schema/                   Document, Node, SchemaValidator, StyleSchema, DocumentMigrator
lib/Widgets/                  Widget catalogue and field definitions
lib/Render/                   Renderer, WidgetRenderer, StyleCompiler, RenderContext, Icons
lib/Contracts/                LiveDataSource
lib/Catalog/                  WhmcsDataSource, CartLinks, Money
lib/Repositories/             Pages, library, media, forms, event log
lib/Security/                 CapabilityPolicy
lib/Services/                 Page, template, theme, media, form, menu, settings, conditions, starters
lib/Site/                     PageResolver (the public gate)
lib/Admin/                    AdminController, AdminView, EditorContext
assets/                       editor.js, runtime.js, editor.css, runtime.css, admin.css
```

Outside the module: `builder-page.php` (public front controller),
`templates/cloudhost247/cloudhost247-builder-page.tpl`,
`crons/cloudhost247_builder.php`.

## Capabilities

Seeded Super-Admin-only on activation and enforced server-side on every action:

`builder.view`, `builder.pages`, `builder.publish`, `builder.delete`,
`builder.templates`, `builder.theme`, `builder.media`, `builder.forms`,
`builder.settings`, `builder.css`.

Existing policy rows are never overwritten. Adjust them under
**CloudHost247 Foundation**.

## Configuration

| Setting | Default | Notes |
|---|---|---|
| Public page path | `builder-page.php` | Front controller that serves pages |
| Revisions kept | 30 | Published snapshots are always kept |
| Autosave | 45s | Autosaves are flagged and pruned first |
| Preview lifetime | 30 min | Tokens are stored hashed |
| Upload limit | 12 MiB | Clamped to 1–256 MiB |
| Form rate limit | 5 per 5 min | Per hashed address |

Environment variables (optional): `CH247_BUILDER_MEDIA_ROOT`,
`CH247_BUILDER_MEDIA_URL`.

## Tests

```
php tests/builder/run.php                      # 307 behavioural assertions
python3 -m unittest tests.builder.test_static  # 46 structural and policy tests
```

Full reference: `docs/independent-rebuild/WEBSITE-BUILDER.md`.
