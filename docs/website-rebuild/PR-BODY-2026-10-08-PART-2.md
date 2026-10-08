# Public website, continued: the widget stylesheet, and the menu link only one of two surfaces served

Branch `arena/4c00ccfe-cloudhost247` · Base `main` · **not deployed** — production release stays gated on WHMCS staging verification.

Report: `docs/website-rebuild/PASS-2026-10-08.md` (§1.8, §1.9) · Archive: `CloudHost247-production-2.1.0.zip` (8,601 members, 99.0 MB, extracted and re-tested)

Follow-up to #68, which merged at the raster-encoder commit. Everything below was committed after that
merge and is not in `main` yet. Presentation layer only — no WHMCS core, provisioning, billing,
authentication, server-module, API, Builder or integration code changed.

## What this PR adds

**A published menu link that only one of two surfaces could serve.** The Domain menu's DNS column
pointed "DNS Health" at `/tools/dns-health`. The registry publishes one destination; two catalogues
answer it: the SPA resolves `cloudhost247-node/src/tools/catalog.ts`, the PHP tools front controller
resolves `config/tools.php`. The capability exists in both, but the app slugs it `dns-health` and the
native catalogue `domain-dns-health`, so the menu worked in the SPA and 404'd in the tools shell. That
is the same shape `whois` → `domain-whois` already handles in that file, so it now publishes
`/tools/domain-dns-health` on both surfaces and keeps the short slug as a forwarding alias.
`DomainHealthPage.tsx` — the only other link to the alias — now points at the published path.

**The gate that should have caught it read the wrong catalogue.** `phpTargetExists()` in
`scripts/site/generate.mjs` built its PHP route set from `tools.json`, the projection of the *app*
catalogue, while the PHP surface resolves `tools-public.json`. It now takes tool paths from the native
export and only categories and collections from the app projection. With the dead link restored it
fails, by name:

```
✖ registry validation failed (1): menu:domains/DNS: "DNS Health" → tools/dns-health does not exist and is not a WHMCS entry point.
```

**A second dead end in the same column, found by reading rather than by the gate.** "DNS Security"
pointed at the Security category described as DNS tools; that category holds
`api-key-generator`, `checksum-hash-generator`, `http-security-headers-generator` and
`password-policy-generator` — no DNS tool at all. The column now ends on the item that does serve the
DNS family: "All DNS Tools" → `/tools/category/dns-domains`.

**Builder widgets that had no stylesheet.** 149 classes are emitted by
`modules/addons/cloudhost247_builder/lib/Render/WidgetRenderer.php`; 20 had no rule anywhere, so cards,
brokerage, cart and status widgets rendered unstyled. `runtime.css` gained the cards cluster
(`.ch247-cart`, `.ch247-broker-cta`, `.ch247-broker-status`, `.ch247-broker-cases`,
`.ch247-broker-pricing`), the `__*` children those need, `.ch247-form__description`, `.ch247-image__img`,
`.ch247-cta__text`, `.ch247-status__label` and a muted-text cluster. The undefined tokens that remain
are documented element-level hooks, not gaps: `ch247-star` is an `Icons::svg()` modifier,
`ch247-autoplay` a `data-` attribute, `ch247-nav`/`ch247-status`/`ch247-video` child-laid-out wrappers.

**Eight `{include}` statements pointed at files that do not exist, and that was correct.** The theme
is a child of `twenty-one`, so the platform's own `head.tpl`, `navbar.tpl`, `sidebar.tpl`,
`breadcrumb.tpl`, password modal and network notice arrive from the parent at render time and are
absent from this repository by design — but nothing said so, which made a deliberate absence
indistinguishable from a partial the rebuild deleted. `PARENT_TEMPLATES` in
`scripts/verify-website.py` now declares each one with its parent, and the `orderforms/ovh_cart`
child theme's `standard_cart` references alongside them.

## Gates added

- **`tests/tools/site-integration.php`** walks every `tools*` destination the *published* navigation
  carries (`Site::catalog()` → `navigation` + `footer`, recursive) and requires the **native**
  catalogue to resolve it, strictly. `ToolsSite::resolve()` — the theme runtime's app-aware fallback,
  which also accepts `legacyPaths` — is deliberately not consulted: with the fallback in the
  expression the assertion cannot fail, which is how the dead link survived a green suite. The same
  file now pins `tools-public.json`'s tool paths to `config/tools.php`, so the export the generator
  reads cannot go stale. 1,154 assertions.
- **`scripts/verify-website.py`** (`include_errors`) fails on an include no theme ships and no
  `parent:` declaration covers, a first-party include that no longer exists, and an exemption that
  has gone stale — the theme now ships the template, or nothing includes it any more. Dynamic
  includes are skipped rather than guessed. Mutation-proofed: a bogus partial, a shadowed parent
  template and a dropped include each fail it, by name.
- **`scripts/audit-builder-widget-classes.py`** compares what the renderer emits against what
  `runtime.css` defines, per widget, with 20 named exemptions that fail the audit if they go stale.
  Wired into `scripts/release-candidate-check.sh` after the raster check.

Both were mutation-tested: the dead link restored → generator exit 1 with the message above; the export
drifted → `FAIL: the native catalogue export lists the same tool paths as config/tools.php:
/tools/dns-checker, /tools/dns-health`.

## How it was verified

On the fixed tree: theme 60/0 · website 310/0 · tools 85/0 · builder 353 · modules 237/0 ·
tools site-integration 1,154 · `verify-website.py passed: true` (469 classes, 79 includes) · `check-links.mjs` ✓ (2,183 surfaces) ·
navigation inventory 0 defects · 97 Python unit tests OK · `npx tsc --noEmit` clean ·
`scripts/release-candidate-check.sh` → 0.

Then the archive was rebuilt at this head and **extracted into a clean directory and re-tested there**:
`verify-website.py passed: true`, no broken links, raster ladder complete (20 scenes × 2 formats),
149 widget classes with 0 undefined, 60/310/85/1,154/237 PHP assertions, every wired Python suite green,
and the DNS column read out of the package resolving natively.

## Deliberate decisions

- The short `/tools/dns-health` slug stays as a forwarding alias for deep links and for SPA `legacyPaths`;
  it is simply not published in navigation.
- The generator's PHP route set is not widened to accept app paths. Two sources for one destination is
  what hid the defect; the native export is the one the PHP surface reads.
- `GLOBAL-AUDIT.md` and `FINAL-REPORT.md` keep their own pass's link figures and carry a dated note with
  the current scope (2,183 surfaces / 899 PHP, still 0 broken) rather than being rewritten.
