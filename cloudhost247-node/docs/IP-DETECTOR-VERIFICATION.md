# IP detector (menu bar) — verification and completion

**Verified:** 2026-11-08 on branch `arena/e916d41a-cloudhost247`
**Scope:** the menu-bar IP detector and every surface that names the same visitor address — the header widget (`/api/v1/visitor/ip`), the country indicator beside it (`/api/v1/currency/geo-country`), the Tools → IP Tools → "What Is My IP" tool (`/api/tools/my-ip`), and marketing-consent jurisdiction.
**Method:** real Chromium (npm `@sparticuz/chromium`) driving the real dev stack (Vite → Fastify on embedded PGlite), plus Fastify `app.inject` integration tests through `buildApp`, plus unit tests. No mocked `fetch` for the end-to-end evidence.

## Verdict

The detector's *resolver* was sound and well tested. The detector as a *product feature* was unfinished: it could only ever render a bare "IP: unavailable", the second surface that answers the same question used a different (spoofable) rule and would report the server's own loopback address as the visitor's public IP, and the tool's per-visitor response was cacheable by intermediaries. All of that is now completed and covered, listed below with the reproduction that proved it.

## Findings before the change (all reproduced)

| # | Finding | Reproduction on the branch head |
| --- | --- | --- |
| F1 | Menu bar always read `IP: unavailable` / `Country unavailable`, indistinguishable from a broken request. The endpoint returned no reason, so the widget could not say whether detection was switched off, unverified for this connection, or failed. | Real browser load: `/api/v1/visitor/ip` → `{"ip":null,"privacyStatus":"unknown"}`; DOM `.ch247-visitor-privacy__ip` = `IP: unavailable`. Same with `VISITOR_IP_MODE=direct`, because the sandbox peer is loopback. |
| F2 | `/api/tools/my-ip` reported the **server's own loopback** as the visitor's public IP. It read Fastify's `request.ip` (global `trustProxy: true`) instead of the verified boundary. | `curl /api/tools/my-ip` with `VISITOR_IP_MODE=trusted-proxy`, no forwarding header → `{"ipv4":"127.0.0.1","detectedAddress":"127.0.0.1"}` while the header detector returned `null` for the same request. |
| F3 | `/api/tools/my-ip` accepted a caller-stated address from an untrusted peer. | `curl -H 'X-Forwarded-For: 8.8.8.8' /api/tools/my-ip` from an untrusted socket → `detectedAddress: "8.8.8.8"`. |
| F4 | The two surfaces disagreed for one request, so a visitor was told two different "your IP" answers in one session. | Same request: header `null`, tool `127.0.0.1` (F2). |
| F5 | `GET /api/tools/:slug` — the verb `my-ip` uses — sent **no** `Cache-Control` header at all, while the `POST` sibling sent `no-store`. The response carries the visitor's address *and* their full request headers, so an intermediary was free to store one visitor's result and replay it to the next. | `curl -sI /api/tools/my-ip` → no `cache-control`; `curl -sI -X POST /api/tools/json-tools` → `cache-control: no-store`. The code comment above the POST handler states the no-store intent; the GET handler simply lacked it. |
| F6 | The tool echoed credential headers (`cookie`, `authorization`, …) verbatim into a readable JSON body. | Source: `myIp()` copied every request header. An `HttpOnly` session cookie repeated in JSON is readable by any script on the page, defeating the flag. |
| F7 | `myIp()` had **zero** test coverage, and nothing exercised the header↔endpoint wiring in a browser (the widget test mocks `fetch`). | `grep -rn 'myIp\|detectedAddress' tests/ e2e/` → no matches. |
| F8 | An invalid `VISITOR_IP_TRUSTED_PROXIES` fails closed, i.e. silently disables detection forever with no signal anywhere; `npm run env:check` printed nothing about the feature. | `env:check` source had no mention of `VISITOR_IP_*`. |

## What was completed

1. **One boundary, every surface.** `resolveVisitorIpDetail()` in `src/routes/visitor-ip.ts` is now the single resolver. `/api/v1/visitor/ip`, `/api/v1/currency/geo-country`, `/api/tools/my-ip` and `resolveJurisdiction()` all call it (directly or via `resolveVisitorIpFromRequest`). F2–F4 are structurally impossible now: there is one rule and one answer.
2. **Honest reasons.** The endpoint returns a coarse `reason` (`detected | disabled | unverified | not_public`) that never discloses the allowlist, the peer, or which hop failed. The menu bar renders it (`IP: not enabled` / `IP: unverified` / `IP: not public`), keeps the visible label short so the measured utility line does not move, and puts the full sentence in a visually-hidden live-region span plus the `title`. Unknown reasons fall back to `IP: unavailable` rather than being invented. Fixes F1.
3. **Verified-only answers in the tool.** `myIp()` reports an address only when the boundary verified it; the raw forwarding chain remains in `forwardedFor`, labelled received-not-verified and never promoted to an answer. Non-public addresses (loopback, RFC1918, link-local, CGNAT, reserved incl. RFC 5737) are `not_public`, never a visitor's IP. Fixes F2, F3.
4. **Credential headers withheld.** The echoed header map replaces `cookie`, `set-cookie`, `authorization`, `proxy-authorization`, `x-api-key` values with `«redacted»` (keys still listed). Fixes F6.
5. **No shared caching of per-visitor answers.** `GET /api/tools/:slug` now sends `Cache-Control: no-store`, matching the POST handler and the endpoint's own `private, no-store` + `Vary: X-Forwarded-For`. Fixes F5.
6. **Operator pre-flight.** `npm run env:check` prints the active mode and its implication, and hard-errors on an unparsable or `/0` allowlist. Fixes F8.
7. **Coverage.** `tests/unit/tools-my-ip.test.ts` (8 tests, the first for that service), `tests/integration/visitor-ip-surfaces.test.ts` (5 tests through `buildApp`: both surfaces agree, spoofing refused, loopback never claimed, no-store, credentials withheld), extended `tests/integration/visitor-ip.test.ts` (reasons, `Vary`, allowlist validation), extended `frontend/tests/unit/visitor-privacy.test.tsx` (reason rendering, fallback), and `e2e/visitor-ip.spec.ts` (4 specs: real request ↔ real DOM, detection-on path gated by `CH247_E2E_EDGE_XFF`, no false protection claims, country agreement). Fixes F7.

## End-to-end evidence after the change

Real Chromium against the running stack (API in `trusted-proxy` mode trusting the local proxy; a correctly-configured edge simulated by injecting `X-Forwarded-For`, which browsers themselves refuse to set):

* Edge supplies `102.89.234.5` → menu bar renders `IP: 102.89.234.5`, GeoLite resolves it to `NG`, the indicator shows the Nigerian flag and "Country is estimated from your IP address", ticker still says "Privacy status cannot be verified · Your public IP is visible to this website".
* No verifiable boundary → menu bar renders `IP: unverified` with the explanation; country falls back to the browser locale, labelled "estimated from your browser settings"; ticker says "…may be visible to websites you visit".
* `scripts/check-header-layout.mjs`: no overlap at 1920/1600/1440/1280/1024/834/390. `scripts/check-chrome-benchmark.mjs`: every utility-line assertion passes ("Pricing, Help, English, USD, Sign In and Create Account share one straight line", row 45px tall, at all widths). The benchmark's 5 remaining failures are pre-existing footer/brand findings also listed in `docs/FEATURE-REVIEW-2026-11-08.md`, unrelated to this feature.
* `e2e/visitor-ip.spec.ts`: 4/4 with detection configured, 3 passed + 1 skipped without.
* Targeted suites: 76 server tests and 58 frontend tests pass; `npm run tools:catalog:check` verifies the projection unchanged.

## Deliberately not changed, and why

* **Detection stays off by default.** `VISITOR_IP_MODE=off` is a security posture, not a bug: behind cPanel/Apache/CDN the socket is not the visitor. Enabling it is an operator decision about real topology; the docs and `env:check` now make that decision discoverable instead of invisible.
* **Global `trustProxy: true`.** Related finding, out of this feature's scope but worth an operator's attention: because Fastify trusts proxy headers globally, `request.ip` — used by the rate-limiter `keyGenerator` (`src/plugins/security.ts`) and by tool caller identity — is settable by any client via `X-Forwarded-For`, so per-IP rate limits can be rotated around. The visitor-address surfaces no longer depend on it, but fixing it means choosing the deployment's real trust boundary app-wide, which must not be guessed here.
* **`Vary: CF-Connecting-IP` on `/api/v1/currency/geo-country`.** Nothing reads `CF-Connecting-IP`, but an existing test pins the header as a defensive cache key, so it was left alone rather than churned; the visitor endpoint's `Vary` lists only what it actually consults.
* **Other authenticated portal `GET` routes** (`/api/tools/history`, `/favorites`, `/reports`, `/monitors`) also lack an explicit `no-store`. Same class as F5 but outside the IP detector; noted for a follow-up.
* **GeoLite currency/attribution** remains as flagged in `docs/FEATURE-REVIEW-2026-11-08.md` (MaxMind licence, data age).

## Follow-up after the preview still showed no IP

The original end-to-end run intentionally left detection off in the live API process, matching the production-safe default. That made the fresh preview say `IP: not enabled`; additionally, the resolver only understood `X-Forwarded-For`, while common edges may provide a single authoritative `CF-Connecting-IP` / `X-Real-IP` or the RFC 7239 `Forwarded` header. The browser cannot fix either issue itself.

The preview is now corrected at both ends: `scripts/dev-server.ts` enables trusted-proxy mode only when the development/preview API has no explicit mode (and trusts only local/private proxy hops), and Vite appends its observed proxy hop to `X-Forwarded-For`. The production server keeps `VISITOR_IP_MODE=off` unless its operator explicitly configures the real proxy boundary. The shared resolver now reads authoritative edge headers only behind an allowlisted peer, safely parses `Forwarded`, and updates `Vary` on both IP-dependent endpoints. A malformed preferred chain fails closed rather than falling through to another header.

Local smoke check through the Vite proxy:

- No edge address header: `{"ip":null,"reason":"unverified","privacyStatus":"unknown"}` — local direct curl has no real public visitor address, which is the honest result.
- Simulated trusted edge header `CF-Connecting-IP: 8.8.8.8`: `{"ip":"8.8.8.8","reason":"detected","privacyStatus":"unknown"}`.

Added tests cover Cloudflare, X-Real-IP, RFC 7239 Forwarded, precedence, malformed chains, and untrusted peers. The end-user preview will display the real visitor address only if its outer proxy supplies a trustworthy client-IP header; without that, it continues to say unverified rather than inventing or spoofing an address.
