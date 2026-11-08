# PR #99 — homepage media and support-link follow-up

**Status: BLOCKED — NOT VERIFIED.** Independent review and the outstanding checks below remain required. This is a targeted PR correction, not completion of S0.1a or authorization to start S0.1b. NO-GO and the prohibition on production deployment remain in force.

## Scope

- Requirement: keep the homepage promotional videos and showcase images available while preserving the shared illustration-library mirror; test the support link according to its existing authentication behavior.
- Base: `98a3e8f2a9ee7e94090a539921b3bc1591760b97` on `arena/977f64cc-cloudhost247`. The candidate is the commit containing this evidence file; resolve its SHA with `git log -1 --format=%H -- docs/evidence/remediation/PR99-homepage-media-follow-up.md` and re-run checks against that candidate before signing off.
- Implementer: Arena agent. Independent verifier and owner: **not assigned**. No production, staging, real provider, live authentication or customer data was used.
- Changed files: 17 existing files moved from `cloudhost247-node/frontend/public/media/cloudhost247/{promo,showcase}/` to `cloudhost247-node/frontend/public/media/homepage/{promo,showcase}/`; `PromoVideoHero.tsx`, `CreationShowcase.tsx`, `creation-showcase.css`, the two promo-video generation scripts, `cloudhost247-node/e2e/promo-video.spec.ts`, `tests/website/test_media_library_parity.py`, and this evidence file. The media bytes were not regenerated.
- The shared mirror's check and prune rules are unchanged. The existing `/support` route remains protected; the UI test now expects the signed-out redirect and checks the return destination instead of racing against an intermediate URL.

## Local verification

Environment: local workspace, Node `v22.22.3`, npm `10.9.8`, Python `3.11.2`, Playwright `1.64.0`; browser `/tmp/chromium` with `LD_LIBRARY_PATH=/tmp/ch247-chrome/lib`. These are local checks on the working tree, not an independent review or a CI result.

| Command | Result |
|---|---|
| `python3 -m unittest -v tests.website.test_media_library_parity` | Exit 0; 10 passed, including negative tests for missing, differing and stale mirror files. |
| `python3 scripts/generate-raster-formats.py --check` | Exit 0; raster ladder complete and shared mirror in sync. |
| `npm run build:frontend` in `cloudhost247-node/` | Exit 0. |
| `LD_LIBRARY_PATH=/tmp/ch247-chrome/lib CH247_CHROMIUM_PATH=/tmp/chromium CH247_E2E_PORT=4287 npx playwright test e2e/promo-video.spec.ts --workers=2 --reporter=line` | Exit 0; 13 passed. |
| Same browser environment, port `4288`, `npx playwright test e2e/promo-video.spec.ts -g 'fullscreen controls stay usable\|support link retains' --repeat-each=5 --workers=2 --reporter=line` (the shell argument uses a literal `|` without a backslash) | Exit 0; 15 passed. |
| `npx tsc -p frontend/tsconfig.json --noEmit` in `cloudhost247-node/` | **Exit 2**: `frontend/tests/unit/footer-back-to-top.test.tsx` lines 52 and 62, TS2532, object possibly undefined. Those files were not changed in this repair. |
| `git diff --check HEAD` | Exit 0 before staging. |

An initial Playwright run could not launch Chromium because `libnspr4.so` was not on the library path; with the explicit library path, the original test reproduced a redirect to `/login`. After correcting its expectation, the 13-test run and 15 repeated targeted cases passed. The test's login and ticket endpoints use browser-side fixtures, including rejected and successful login; they validate frontend behavior only, not real authentication, ticket authorization or a running backend.

## Outstanding gates and rollback

- Frontend typecheck is failing as recorded above. Existing Node production-dependency audit, PHP release-candidate failures and other release checks also remain outstanding; no complete release verification was run for this follow-up. GitHub CI must be rerun on the committed candidate.
- S0.1a remains blocked pending the named independent verifier, accountable owners and real integration evidence described in `S0.1a-integration-inventory.md`. This follow-up is not a substitute for those requirements.
- Independent reviewer must inspect the file moves and URL references, verify media is served after a production build, review the test's auth assumptions and record a decision. No reviewer approval is recorded.
- No external resources or data were created. To roll back, revert the follow-up commit as a whole, restoring both the old asset paths and their references; do not run the mirror's pruning command against the old layout without separately protecting the homepage assets.
- No merge or production deployment is authorized by this record. Separate explicit production approval is required even after all gates pass.

## Follow-up: unblock frontend typecheck

The candidate based on `9facc7647d0783a1274cf5b1c9663c09701f073f` adds `cloudhost247-node/frontend/tests/unit/footer-back-to-top.test.tsx`: two explicit missing-element errors replace optional chaining before bitwise document-position assertions. Both existing placement assertions remain in force; missing elements fail rather than becoming a numeric bitwise value. No application or footer markup was changed. The latest commit containing this evidence file identifies the candidate to review.

- `npx tsc -p frontend/tsconfig.json --noEmit` from `cloudhost247-node/`: exit 0 on the follow-up working tree.
- `npx vitest run frontend/tests/unit/footer-back-to-top.test.tsx --maxWorkers=2`: exit 0, six tests passed.
- `git diff --check`: exit 0 before staging.
- The previous media and browser checks remain historical local results, not an independent review or proof of live authentication. CI must rerun on the new candidate. The Node dependency audit and PHP release-candidate failures are not addressed by this change.

**Decision remains BLOCKED — NOT VERIFIED:** no independent reviewer or approval recorded; S0.1a and production authorization remain unchanged. Roll back the follow-up commit to restore the previous test file; roll back the preceding media commit separately if needed.
