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
| A3 | The public site's links resolve, with no `#`, empty or dev-only destinations | `node scripts/site/check-links.mjs` | **COMPLETE** — 2 208 surfaces, 0 broken, 0 placeholder |
| A4 | Every registered page has metadata, a template, artwork and a route | `python3 scripts/verify-website.py` | **COMPLETE** — 67 pages, 0 source errors |
| A5 | The reviewed page inventory matches the registry | `python3 scripts/audit-navigation-inventory.py` (gate diffs it) | **COMPLETE** — 89 nav / 68 footer destinations, 0 orphaned, 0 unregistered |
| A6 | The production archive builds and verifies | `python3 scripts/build-production-zip.py --verify` | **COMPLETE** — 9 801 members, 581 media assets, no secret material |
| A7 | Every workflow file GitHub is asked to run can actually start | `node scripts/check-workflow-yaml.mjs` | **COMPLETE** — 3 files; the checker exists because `content-hygiene.yml` could not start at all |
| A8 | The Node platform typechecks, builds and passes its suite | `npm run typecheck`, `tsc --noEmit`, `npm test` | **COMPLETE** locally (161 files / 2 242 tests, both typechecks); hosted Node 22.12/24.8 matrix outstanding at the time of writing |

## Design, navigation and content

| # | Criterion | Decided by | Status |
|---|---|---|---|
| B1 | One registry drives PHP nav/footer, the SPA nav/footer, the sitemap and the route audit | `node scripts/site/generate.mjs` + the gate's staleness diff | **COMPLETE** — 7 mega menus, 8 footer columns, 169 validated links |
| B2 | Seven primary categories, eight footer columns, every link route-backed | the gate + `check-links.mjs` | **COMPLETE** |
| B3 | A distinct hero visual on every registered page | `page-inventory.json` → `hero_scenes_exact` | **COMPLETE** — 67 of 67 on their own 3D scene; 47 distinct scenes; 0 family fallbacks |
| B4 | The full asset library exists (brand, logos, favicons, social, app icons, OS, panels) | `python3 scripts/generate-raster-formats.py --check` + the archive verifier | **COMPLETE** — 48 scenes × 2 formats; every registry visual resolved in both libraries |
| B5 | No malformed-bullet, replacement-character or orphan-PUA artifact in rendered pages | `node scripts/check-malformed-bullets.mjs`; the PUA scan in the audit report §3.7 | **COMPLETE** — 0 findings in 6 657 text files; 0 in all 229 rendered pages |
| B6 | No retired-brand text anywhere | `python3 scripts/branding-audit.py` | **COMPLETE** — 5 956 files scanned, 0 matches |

## Accessibility and responsiveness

| # | Criterion | Decided by | Status |
|---|---|---|---|
| C1 | Viewport, document language, skip link, menu state, control names, image alternatives | `python3 scripts/check-accessibility-contract.py` | **COMPLETE** — 63 files, 15 controls, 0 problems |
| C2 | Touch targets meet WCAG 2.2 SC 2.5.8 (24 px; 44 px for the primary mobile control) | `python3 scripts/check-accessibility-contract.py` | **COMPLETE** |
| C3 | Every viewport the browser matrix tests is covered by at least one media query | `python3 scripts/check-accessibility-contract.py` | **COMPLETE** — 320/360/375/390/414/768/1024/1280/1440/1920 |
| C4 | Real-browser behaviour: no horizontal overflow, no broken images, no page errors, menu open/Escape/focus, axe WCAG A/AA | `node tests/website/browser.cjs` (needs Chromium) | **PARTIAL** — a 520-case sweep is recorded in `docs/website-rebuild/browser-verification.json`, but it predates this pass; it could not be re-run because no browser binary exists in this environment |
| C5 | The recorded a11y result is proven to fail when it should | `python3 -m unittest tests.website.test_accessibility_contract` | **COMPLETE** — 14 negative cases |
| C6 | A catalogue entry never implies deployability the backend has not verified | `python3 -m unittest tests.website.test_catalogue_honesty` | **COMPLETE** — 21 cases across template source, a repository-wide promise sweep and the rendered pages; every rule has a negative case, and the rules hold with or without a fixture tree |
| D7 | The domain platform's extensions, prices and availability come from the connected provider, never from the repository | `npx vitest run tests/integration/domain-services-api.test.ts` plus `grep -rn "INSERT INTO domain_extensions" cloudhost247-node/` | **COMPLETE** — no migration or seed inserts an extension or a price, no first-party source carries a TLD price literal, the directory joins on an *enabled offering from a connected provider*, and the 16 integration cases pin the honest unconfigured outcome (`Service Provider Not Configured`, zero fabricated results). Live registrar calls are not this criterion: they need provider credentials and are E2 |

## Behaviour and integration

| # | Criterion | Decided by | Status |
|---|---|---|---|
| D1 | WHMCS billing, auth, provisioning and tools behaviour is preserved | the 18 PHP behaviour suites + `tests/security/*` | **COMPLETE** — gate green; no core file modified |
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
