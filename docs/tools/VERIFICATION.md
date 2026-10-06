# Tools Center verification — 2026-10-06

## Verified in this checkout

| Check | Result |
|---|---|
| Backend TypeScript | PASS — `npm run typecheck` |
| Frontend TypeScript, including tests | PASS — `npx tsc -p frontend/tsconfig.json --noEmit` |
| Complete Node/frontend regression suite | **1,256 tests passed, 131 files** — `npm test -- --maxWorkers=2` |
| Production build | PASS — server, Node frontend, generated registry check and WHMCS React adapter |
| Alternate `/platform/` production build | PASS; actual browser loaded prefixed assets, routed UUID form, called prefixed real API and displayed a generated result |
| Production dependency audit | PASS — `npm audit --omit=dev --audit-level=high`, zero reported vulnerabilities |
| Tools browser, built Node application + real API | **536 responsive cases**, all 64 runnable routes, zero page errors/overflow/axe violations in tested states |
| Tools browser, native Smarty shell + same React adapter + real API | **536 responsive cases**, all 64 runnable routes, zero page errors/overflow/axe violations in tested states |
| Actual Node HTTP routes / aliases / metadata | **155 checks passed**; canonical routes, 301 aliases, category metadata, unknown-tool 404 and retained MRZ URLs |
| Previous website browser regression | **520 cases / 52 pages**, passed; all seven native menus exercised at ten widths |
| Tools PHP metadata/alias/shell tests | **158 assertions passed** |
| Existing website PHP behavior tests | **53 assertions passed** |
| Website Python source tests | **7 tests passed** |
| Source navigation/asset verification | PASS — 55 distinct shared destinations, no source errors |
| Changed/new PHP syntax | PASS |
| Protected vendor runtime integrity | PASS — original-file manifest unchanged |
| Retired-brand audit / Git whitespace check | PASS |

Local PHP execution used PHP **8.5.10 WebAssembly CLI**, not a licensed WHMCS
installation or native production PHP. Native PHP 7.4/8.2 and Node 22.12/24.8
remain the GitHub workflow matrix; check the PR's actual checks for that run's
status rather than treating the local CLI result as that matrix.

## Browser scope and evidence

Tools widths: **320, 375, 390, 414, 768, 1024, 1280, 1440**. The previous-site
regression additionally covers 360 and 1920. Tests check actual rendered pages,
not only source selectors. Real API calls use the existing application against
an ephemeral, fully migrated PGlite database. No DNS/IP/TLS/WHOIS result fixture
is substituted into the production application.

The browser suite checks:

- Every runnable registry page renders at all eight Tools widths, plus landing,
  category and generated-result layouts.
- Search filtering/empty state, category navigation, unavailable visibility,
  WHOIS disabled state and owned-domain auth gate.
- Actual UUID generation, JSON download, clipboard or explicit permission error.
- Actual bounded browser download/upload/latency measurement via speed endpoints.
- Actual QR encoding, image loading and download link.
- Actual DNS execution returning backend data **or an explicit network failure**.
  A failed lookup is not counted as a successful external DNS verification.
- Tools disclosure keyboard open/Escape and valid runtime-filtered links at every
  width, permanent footer links, accessibility scans of landing/result/open-menu
  states. Automated axe checks are not a full manual accessibility certification.

Committed evidence:

- [`verification/node-browser.json`](verification/node-browser.json)
- [`verification/whmcs-template-browser.json`](verification/whmcs-template-browser.json)
- [`verification/website-regression.json`](verification/website-regression.json)
- [`verification/platform-mount.json`](verification/platform-mount.json)
- [`verification/http-routes.json`](verification/http-routes.json)
- [`verification/source-routes.json`](verification/source-routes.json)
- [`verification/tools-desktop.png`](verification/tools-desktop.png)
- [`BUILD-MANIFEST.json`](BUILD-MANIFEST.json)

Run the repeatable Tools browser suite with Playwright/axe installed in disposable
QA tooling, `CH247_QA_URL`, and (for the WHMCS template harness)
`CH247_EMBEDDED=1`. `tests/website/render-fixtures.php` renders actual Smarty
components; `tests/website/preview.py` exposes only fixture/static paths and proxies
the real Tools API locally. Neither is a production web server or WHMCS emulator.

## Not verified / launch prerequisites

**No production deployment or merge was performed.** The following are explicit
remaining acceptance requirements, not passed checks:

1. Licensed WHMCS initialization, sessions, client/admin permission transitions,
   checkout, parent-theme hooks/sidebar behavior and active Builder overrides.
2. Production Apache/nginx rewrites, subdirectory installation, same-origin proxy,
   trusted forwarding headers, TLS, egress firewall, body/time limits and CSP.
3. Real configured RDAP/registrar/GeoIP/OCR/BIN/reverse-IP providers and external
   DNS/TLS/network success. Provider-dependent tools remain unavailable when not
   configured; inaccessible networks return typed errors, never mock answers.
4. Worker-driven production resolver/provider health and scheduled monitoring.
5. Custom Builder header/footer overrides must expose the shared Tools components.
   The integration deliberately does not replace administrator-authored HTML.

The parity matrix records genuine omissions (for example RAID, Morse and
proprietary palette matching). The 68-entry registry is **not** a claim of complete
DNSChecker parity. The original audit, feature matrix, architecture/deployment
instructions and security boundaries are separate documents in this directory.
