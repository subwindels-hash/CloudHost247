# Acceptance criteria

The criteria this rebuild is accepted against, each with the command that decides it and its current
status. Status vocabulary is strict and means exactly what it says:

| Status | Meaning |
|---|---|
| **COMPLETE** | Verified by the named command, on the commit under review. |
| **PARTIAL** | Implemented and verified for part of the surface; the unverified part is named. |
| **BLOCKED** | Cannot be verified in this environment; the missing prerequisite is named. |
| **NOT TESTED** | No evidence exists yet, and none is claimed. |

Last reviewed: 2026-10-12, against the audit report
[`docs/website-rebuild/AUDIT-AND-READINESS-2026-10-12.md`](website-rebuild/AUDIT-AND-READINESS-2026-10-12.md).
A criterion is only **COMPLETE** when its command has been run on the candidate commit; a file
existing, or a page rendering, is not evidence.

## Source and build

| # | Criterion | Decided by | Status |
|---|---|---|---|
| A1 | The repository's own gate passes end to end | `bash scripts/release-candidate-check.sh` | **COMPLETE** — passed on PHP 8.2.33 here and on the hosted runners for PHP **7.4 and 8.2** |
| A2 | Every PHP file we own is lint-clean | `bash scripts/php-lint-targets.sh` + the gate's lint step | **COMPLETE** — 837 targets, 0 errors |
| A3 | The public site's links resolve, with no `#`, empty or dev-only destinations | `node scripts/site/check-links.mjs` (now also a gate step, so CI decides it) | **COMPLETE** — 2 208 surfaces (926 internal, 899 PHP, 5 external, 17 in-page anchors), 0 broken, 0 placeholder, 0 dangling. Enforcement now covers the published tools tree: the exclusion was narrowed from `tools/` to `tools/admin/` + `tools/preview-router.php`, which moved 4 hrefs from recorded-only to enforced (§3.11) |
| A4 | Every registered page has metadata, a template, artwork and a route | `python3 scripts/verify-website.py` | **COMPLETE** — 67 pages, 0 source errors |
| A5 | The reviewed page inventory matches the registry | `python3 scripts/audit-navigation-inventory.py` (gate diffs it) | **COMPLETE** — 89 nav / 68 footer destinations, 0 orphaned, 0 unregistered |
| A6 | The production archive builds and verifies | `python3 scripts/build-production-zip.py --verify` — release-workflow **step 5**, deliberately not a per-commit gate step: it builds a ~132 MiB package, so it runs when a candidate is frozen rather than on every push | **COMPLETE** — re-run at `631ab41`, exit 0: 9 872 members, `secret_skipped=0`, 597 media assets, 49 illustrations and 49 referenced 3D scenes resolved in both libraries, 13 published documents, no secret material. Named by SHA rather than "the tip of this branch", which moves: the commits after it add and remove no file, so the member count is unchanged |
| A7 | Every workflow file GitHub is asked to run can actually start | `node scripts/check-workflow-yaml.mjs` | **COMPLETE** — 3 files; the checker exists because `content-hygiene.yml` could not start at all |
| A8 | The Node platform typechecks, builds and passes its suite | `npm run typecheck`, `tsc --noEmit`, `npm test` | **COMPLETE** locally (163 files / 2 256 tests, both typechecks) and on the hosted matrix — Node 22.12.0 pass 13m34s, Node 24.8.0 pass 9m33s at `5337e94` |

## Design, navigation and content

| # | Criterion | Decided by | Status |
|---|---|---|---|
| B1 | One registry drives PHP nav/footer, the SPA nav/footer, the sitemap and the route audit | `node scripts/site/generate.mjs` + the gate's staleness diff | **COMPLETE** — 7 mega menus, 8 footer columns, 169 validated links |
| B2 | Seven primary categories, eight footer columns, every link route-backed | the gate (which now runs `check-links.mjs` itself) | **COMPLETE** — 7 menus, 8 footer columns, 68 registry footer destinations; the SPA renders 67 of them and PHP renders 67. The one PHP omits is Business Tools, and the reason is narrower than "it cannot serve it": `/tools/business-tools` is answered, by the theme catalogue's signpost page, which hands over to the platform application. That page is not a working tool, so it is linked from the menu and router but not published as a static footer destination (§3.11) |
| B3 | A distinct hero visual on every registered page | `page-inventory.json` → `hero_scenes_exact`, `python3 -m unittest tests.website.test_static` (`test_published_pages_do_not_share_a_hero`) and `bash scripts/verify-rendered-site.sh` (which renders the 229 pages and then runs `scripts/check-hero-render.py` against them, inside the release gate) | **COMPLETE** — 67 of 67 on their own scene, 49 distinct scenes, 0 family fallbacks; and no two pages share one: 48 distinct hero artworks across the 48 pages that render a hero, 19 legal documents text-only by design |
| B4 | The full asset library exists (brand, logos, favicons, social, app icons, OS, panels) | `python3 scripts/generate-raster-formats.py --check` + `python3 -m unittest tests.website.test_media_library_parity` + the archive verifier | **COMPLETE** — 50 scenes × 2 formats, served mirror in sync (597 files); every registry visual resolved in both libraries; and the platform's second copy of the library is now verified against the library it mirrors instead of assumed |
| B5 | No malformed-bullet, replacement-character or orphan-PUA artifact in rendered pages | `node scripts/check-malformed-bullets.mjs`; the PUA scan in the audit report §3.7 | **COMPLETE** — 0 findings in 5 983 text files; 0 in all 229 rendered pages |
| B6 | No retired-brand text anywhere | `python3 scripts/branding-audit.py` | **COMPLETE** — 5 974 text files scanned, 0 matches (1 978 binary and 18 ionCube files checked by name only) |

## Accessibility and responsiveness

| # | Criterion | Decided by | Status |
|---|---|---|---|
| C1 | Viewport, document language, skip link, menu state, control names, image alternatives | `python3 scripts/check-accessibility-contract.py` | **COMPLETE** — 63 markup files, 15 visible controls, 16 images, 1 020 CSS rules, 15 media widths, 0 problems |
| C2 | Touch targets meet WCAG 2.2 SC 2.5.8 (24 px; 44 px for the primary mobile control) | `python3 scripts/check-accessibility-contract.py` | **COMPLETE** |
| C3 | Every viewport the browser matrix tests is covered by at least one media query | `python3 scripts/check-accessibility-contract.py` | **COMPLETE** — 320/360/375/390/414/768/1024/1280/1440/1920 |
| C4 | Real-browser behaviour: no horizontal overflow, no broken images, no page errors, menu open/Escape/focus, axe WCAG A/AA | `node tests/website/browser.cjs` (needs Chromium) | **PARTIAL** — a 520-case sweep is recorded in `docs/website-rebuild/browser-verification.json`, but it predates this pass. Re-run attempted 2026-10-16: no browser binary exists on the host and `npx playwright install chromium` fails at the download (`ECONNRESET` to `cdn.playwright.dev`, which this environment cannot reach). The static half of C4 — the accessibility contract — does run in the gate |
| C5 | The recorded a11y result is proven to fail when it should | `python3 -m unittest tests.website.test_accessibility_contract` | **COMPLETE** — 14 negative cases |
| C6 | A catalogue entry never implies deployability the backend has not verified | `python3 -m unittest tests.website.test_catalogue_honesty` | **COMPLETE** — 21 cases across template source, a repository-wide promise sweep and the rendered pages; every rule has a negative case, and the rules hold with or without a fixture tree |
| D7 | The domain platform's extensions, prices and availability come from the connected provider, never from the repository | `python3 -m unittest tests.security.test_domain_data_provenance` (14 cases, in the release gate) and `npx vitest run tests/integration/domain-services-api.test.ts` | **COMPLETE** — no migration or seed inserts an extension or a price, no first-party source carries a TLD price literal, the directory joins on an *enabled offering from a connected provider*, and the 16 integration cases pin the honest unconfigured outcome (`Service Provider Not Configured`, zero fabricated results). Live registrar calls are not this criterion: they need provider credentials and are E2 |

## Behaviour and integration

| # | Criterion | Decided by | Status |
|---|---|---|---|
| D1 | WHMCS billing, auth, provisioning and tools behaviour is preserved | the 18 PHP behaviour suites + `tests/security/*` | **COMPLETE** — gate green on PHP 8.2.33 here and on the hosted 7.4/8.2 legs; 0 deprecation notices on either; no core file modified |
| D2 | Vendor-derived files are byte-identical to the recorded baseline | `sha256sum --check --strict` in the gate | **COMPLETE** |
| D3 | Catalogue pages distinguish catalogue / configured / provisionable / coming-soon and never imply unverified infrastructure | `python3 -m unittest tests.website.test_catalogue_honesty` (negative cases prove each rule), `tests/website/test_manifest_visuals.py`, `php tests/ovh/...` | **PARTIAL** — the source claim is verified complete: the pages label themselves a catalogue, say the list is not stock, name the platform as the source of availability, carry no price and promise no provisioning workflow, all enforced with negative cases. Rendering the live *provisionable* state still needs the staging install |
| D4 | Tool results are real, with SSRF protection, validation and rate limits | `php tests/tools/run.php`, `node tests/tools/*.mjs` | **COMPLETE** |
| D5 | A visitor's address may suggest, never decide, a display currency; billing currency is untouched | `node/vitest` — `tests/integration/currency-geo-hint.test.ts`, `frontend/tests/unit/currency-geo-fallback.test.tsx` | **COMPLETE** |
| D6 | The currency hint is never publicly cacheable and never echoes an address | `cloudhost247-node/tests/integration/currency-geo-hint.test.ts` | **COMPLETE** |

## Release

| # | Criterion | Decided by | Status |
|---|---|---|---|
| E1 | A single staging-only release workflow ending at explicit production approval | [`docs/RELEASE-WORKFLOW.md`](RELEASE-WORKFLOW.md) + `python3 -m unittest tests.security.test_release_workflow_docs` | **COMPLETE** — 13 steps; the document may not claim a production deployment |
| E2 | Staging functional QA: registration, cart/checkout, payments (test mode), provisioning, domains, tickets | `docs/independent-rebuild/STAGING-TEST-MATRIX.md` on a licensed install | **BLOCKED** — needs the licensed WHMCS staging installation; nothing here is claimed about those flows |
| E3 | Migrations applied and verified on staging, protected tables unchanged | `validate-migrations.py` + `compare-financial-evidence.py` on staging | **BLOCKED** — same prerequisite |
| E4 | The acceptance artifact is generated from real runtime evidence | `scripts/generate-staging-report.py` | **BLOCKED** — its runtime input starts at `NOT RUN — STAGING REQUIRED` and is not hand-editable |
| E5 | Explicit production approval, recorded with approver, commit SHA, evidence paths and a tested rollback | step 13 of `docs/RELEASE-WORKFLOW.md` — the signed record | **NOT TESTED** — no approval has been requested or given; nothing was deployed to production |

## What "done" means for this branch

Everything in **A**, **B**, **C1–C3, C5** and **D1, D2, D4–D6** is verified. **C4** depends on a
browser binary, **D3**'s live state depends on staging, and **E2–E5** depend on the licensed staging
installation and on a human decision to promote. The branch is therefore **verified on source and
ready for staging**, and the correct next action is step 1 of the release workflow on the staging
host — not a production deployment.
