# Trust-layer release-gate repair

## Outcome

**IMPLEMENTED / LOCALLY VERIFIED.** The release-candidate source gate now passes without disabled checks, palette exemptions, removed assertions or increased timeouts. Phase 1 and Phase 2 trust behavior is retained. This is not staging or production certification.

Branch: `arena/f2942a04-cloudhost247`. All work remains on that branch. No push, deployment, production migration, provider activation or payment was performed. Analytics and weekly reporting were not started.

## Root causes and fixes

1. **Ten existing Python suites were not executed by the gate.** Wired the digital-products, domain-navigation, Google Workspace, number-services, Office 365, proxy, RDP, service-motion, SMM and SMTP suites into the executable website test command. No skip/exemption was added. The workflow already invokes this gate. Whitespace validation now checks both staged and unstaged changes.
2. **Eight custom storefronts omitted required illustration metadata.** Added dedicated, distinct conceptual SVG diagrams for RDP, campaign planning, numbers, collaboration, productivity, digital products, proxy routing and SMTP. The existing PHP templates and React components actually render those same assets. No prices, plan limits, activity statistics or service-success claims are depicted. Motion opt-ins, alternative text and existing catalogue/order boundaries remain. Proxy's Node surface remains coming-soon, not orderable.
3. **Raster fallback could duplicate unrelated heroes.** Explicit `visualFormat: svg` metadata uses flat artwork without inheriting a previous raster scene. Other pages retain existing raster resolution. Tests require distinct asset bytes, correct metadata, matching PHP/SPA references and exact served/source parity; they do not merely accept different filenames.
4. **Retired green storefront finishes remained on both runtimes.** Replaced green accents and green-tinted neutrals with existing canonical gold/silver/ink role tokens in the eight storefront stylesheets and WHMCS site stylesheet. No palette gate or logo allowlist was relaxed. Shared hero image geometry is in canonical `shared/site/metals.css`, with the generated PHP copy refreshed.
5. **Asset stamps and digest records disagreed.** Bumped the changed site/metals stylesheet cache counters and updated their SHA-256 pins. Motion's digest pin now matches its already-bumped served stamp. Cache-stamp enforcement remains intact.
6. **The final website report described an earlier tree.** Recomputed its verified figures from the real inventory and route report: 365 inventory rows, 75 published pages, 92 root PHP routes, 8 platform entry points and 255 registry links (244 SPA / 243 PHP). Regenerated inventory, navigation-derived outputs, asset mirrors and AI knowledge projection rather than editing generated values independently. Historical environment evidence was not recertified.

The original Phase 2 failures are preserved in `AI-TRUST-PHASE-2.md` as historical results, with a pointer here for current status.

## Changed repair files

- `scripts/release-candidate-check.sh` — missing test wiring and staged whitespace guard.
- `scripts/site/generate.mjs` — explicit flat-artwork mode with stale raster metadata removed.
- `assets/images/cloudhost247/storefronts/*.svg` and generated `cloudhost247-node/frontend/public/media/cloudhost247/storefronts/*.svg` — eight distinct artwork assets per surface.
- `modules/addons/cloudhost247_theme/resources/site.json` — actual per-page artwork metadata.
- Eight matching `templates/cloudhost247/*.tpl` storefronts and eight `cloudhost247-node/frontend/src/pages/*Page.tsx` components — render their declared artwork while retaining substantive service text, safe empty states and ordering boundaries.
- Eight `cloudhost247-node/frontend/src/pages/*.css` storefront stylesheets and `templates/cloudhost247/css/site.css` — canonical palette roles.
- `shared/site/metals.css`, its generated PHP copy and `templates/cloudhost247/includes/site-head.tpl` — shared image geometry and cache versions.
- `tests/website/test_manifest_visuals.py` — rendered-reference/source/served/digest parity regression.
- `tests/website/test_visual_regressions.py` — refreshed cache digest pins, no guard removal.
- `cloudhost247-node/frontend/tests/unit/storefront-artwork.test.tsx` — eight direct component-render tests, including non-orderable proxy behavior.
- Generated AI knowledge projection, route report, inventory JSON/CSV and `docs/website-rebuild/FINAL-REPORT-2026-10-16.md` — source-derived freshness and report reconciliation.
- `docs/AI-TRUST-PHASE-2.md` and this report — current status with historical failures retained.

The retained trust implementation and SQL migration are listed separately in `AI-TRUST-PHASE-2.md`. No extra database migration was needed for this repair.

## Actual checks

| Check | Actual result |
| --- | --- |
| All Python suites, including the gate's recursive static-suite regression | 720 tests, pass, 10 existing skips before the additional hero parity test; no skips introduced |
| Website artwork/visual/static focused check | 33 tests passed |
| `npx vitest run tests/unit frontend/tests/unit tests/integration/ai-*.test.ts` | **2,474 tests passed across 176 files**, exit 0; 756.36 seconds |
| Server `npm run typecheck` | exit 0 |
| Frontend `npx tsc -p frontend/tsconfig.json --noEmit` | exit 0 |
| Full `npm run build` | exit 0, including script typecheck, catalogue check, server, frontend and tools |
| `PATH="$PWD/scripts/php-wasm:$PATH" PHP_LINT_JOBS=4 bash scripts/release-candidate-check.sh` | **exit 0**, full source verification passed |
| `PATH="$PWD/scripts/php-wasm:$PATH" bash scripts/verify-rendered-site.sh --fetch` | **exit 0**; pinned/digest-verified Smarty 4.5.6 used locally |
| Staged and unstaged whitespace checks | pass |

The green source gate includes its PHP module behavior/syntax suites, agent tests, vendor integrity checks, migration/security checks, palette checks, link/accessibility checks, raster/source parity and generated-output consistency. Its reported Python groups were 468 tests (2 existing skips), 6 staging-tool tests, and 247 website tests (8 existing skips). Its nested static suite execution is not an independent environment certification.

Local Smarty rendering actually produced **243 page fixtures**, auditing 959 images, 4,587 asset references and 202 canonical addresses. Hero verification found 47 raster heroes plus 9 flat illustrations (including all eight repaired storefronts), 19 text-only legal pages and **56 distinct hero artworks**. Every published page's rendered artwork matched its inventory. This renders local templates with fixture inputs; it does not start WHMCS or simulate database, checkout or provisioning behavior.

### Development failures, not hidden

- The first broad Node run passed 2,466 tests across 175 files, but did not import every lazy storefront component. A subsequent frontend typecheck found a missing closing wrapper introduced while replacing number-services artwork. It was fixed; direct component tests were added for all eight pages.
- The first run with those new tests had 2,473 passes and one test-fixture failure: the test incorrectly assumed proxy rendered a catalogue. The fixture now asserts its real coming-soon/contact boundary and absence of the catalogue instead. Product behavior was not changed to make the test pass. The final combined run above passed all 2,474 tests.
- Local Smarty reports a pre-existing deprecation for the unregistered `get_flash_message` modifier. Rendering and its audits pass; this warning was not suppressed.

## Evidence and remaining boundaries

Session logs: `/tmp/trust-repair-final-node.log`, `/tmp/trust-repair-server-typecheck.log`, `/tmp/trust-repair-frontend-typecheck.log`, `/tmp/trust-repair-build.log`, `/tmp/trust-repair-final-release.log`, `/tmp/trust-repair-rendered.log`. A final acceptance-gate rerun is recorded in `/tmp/trust-repair-acceptance-release.log`. Logs and `.cache` fixtures are not committed artifacts; this report preserves results without committing generated runtime dependencies or sensitive test logs.

Generated artifacts were staged as the proposed snapshot before running the gate. Its regeneration/diff checks compare outputs against that snapshot, so generated changes must reproduce exactly rather than merely differ from the branch base. Both staged and unstaged whitespace checks remain enabled. No temporary commit, branch switch, false baseline or ignored failure was used to pass the gate.

All backend/frontend **unit** suites plus AI integration suites ran. Other non-AI integration suites and deployed browser/provisioning E2E were not run. The local source gate and fixture renderer do not establish licensed WHMCS/cPanel/provider/scheduler availability. Existing trust limits remain: normalized-claim conflict coverage only, unknown author timestamps stay unknown, sync recency is not proof of upstream truth, and unreviewed published content remains lowest-tier eligible. No staging/production certification or production approval is claimed.
