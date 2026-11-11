# PR #114 — remediation of the nine regression failures

## Scope

Starting tree: local integration candidate `234b773f6e1b9275056ebc98e4fca56372626409`, combining review branch `165caf9` with main `251f78d`. This task addresses the nine reported Node regression failures. It does not certify the independently failing PHP/source gate, staging, external providers, or production. Historical Phase 31 evidence remains unchanged.

## Failure analysis and changes

### Six AI knowledge test/hook timeouts

The original combined run failed four tests and two beforeEach hooks at the existing 30,000ms limits while a separate source gate was running four CPU-intensive PHP-WASM lint workers on the same sandbox.

Re-execution of the entire `tests/integration/ai-website-knowledge.test.ts` file without the concurrent PHP load completed **exit 0, 25 tests passed, 185.73 seconds total**, with the existing test/hook timeouts, assertions, real PGlite migrations, full knowledge sync, retrieval, escalation and isolation checks unchanged. The two endpoint fixtures took about seven seconds each in isolation.

This supports resource contention as the explanation for the earlier timeout failures; it is not evidence of an application-data fix or a provider certification. No timeout was raised and no test/hook was skipped. Run database-heavy regression tests and PHP-WASM lint sequentially on this constrained host. Do not run them as parallel verification jobs and then mistake starvation for a functional regression.

### GA4 public-route coverage failure

The newer main storefronts added eight fixed public PHP paths to the reviewed registry but not to the canonical runtime's explicit `GA_PUBLIC_PATHS`. The first failing path was `/rdp-hosting.php`.

Changed `shared/site/marketing.js` to add only these reviewed public paths:

- `/rdp-hosting.php`
- `/smm-services.php`
- `/number-services.php`
- `/google-workspace.php`
- `/office-365.php`
- `/digital-products.php`
- `/proxy-services.php`
- `/smtp-hosting.php`

No wildcard, dynamic identifier, user-supplied path, account route or runtime-derived allowlist was introduced. Consent, query-string and fragment suppression remain mandatory. Regenerated both shipped Smarty runtime copies with `node scripts/site/generate.mjs`, rather than hand-editing generated files.

Added eight parameterized privacy tests in `frontend/tests/unit/ga4-marketing-engine.test.ts`: each new path can emit a consented plain page view but does not emit additional events or private values with a query string or fragment. The original registry-wide coverage assertions remain intact.

### Two Tools Center interaction failures

Incoming navigation now includes a `DNS Lookup` link. The tests' old wait condition found that header immediately, before the lazy Tools Center and its catalogue controls were ready. The page implementation already provides the labelled search, unavailable-tools toggle, setup warnings and clear/focus behavior.

Changed `frontend/tests/unit/tools-center-page.test.tsx` to await the actual catalogue card's `Open tool … DNS Lookup` link rather than any occurrence of the tool name anywhere in the shell. All assertions for warnings, availability, search, clear button and focus are retained. No production UI or auth changes were necessary.

## Verification performed before final combined run

| Command | Actual result |
|---|---|
| `npx vitest run tests/integration/ai-website-knowledge.test.ts` (application cwd; no concurrent PHP gate) | exit 0; 25 tests passed |
| `npx vitest run frontend/tests/unit/tools-center-page.test.tsx frontend/tests/unit/ga4-marketing-engine.test.ts` | exit 0; initially 98 passed, then **106 passed** after adding 8 privacy regressions |
| `node scripts/site/generate.mjs` | exit 0; canonical runtime copies regenerated |
| `git diff --check` | exit 0 |

One initial command for adding the extra privacy tests used an incorrect duplicated application prefix and raised FileNotFoundError without changing a file. The corrected command applied the tests and the 106-test run passed. This error did not lead to skipped checks or fabricated results.

The final combined regression selection is the same as the previously failing run:

```sh
cd cloudhost247-node
npx vitest run tests/unit tests/integration/ai-website-publish.test.ts tests/integration/ai-website-knowledge.test.ts
```

It must finish before running the source gate. Final commit verification outputs are recorded after execution without modifying the tested tree. The complete source gate must still be attempted on the final commit; its known independent metadata/palette/cache/wiring defects must not be misreported as repaired by this scoped Node fix.

## Remaining boundaries

The independently failing source gate still needs separate repair of incoming storefront metadata, palette violations, cache stamps, current report figures and missing test-suite wiring. This task does not weaken those checks or make speculative design changes to obtain a merge. A green Node regression selection alone is not a green source release gate and does not authorize production deployment.

PR #114 remains unmerged. No production configuration, live payments, external provider credentials or staging certification status changed.
