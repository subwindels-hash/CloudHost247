# Meta Pixel integration — verification evidence

Date: 2026-11-08 (UTC). Workspace: `/home/user/CloudHost247`, branch `arena/112e352e-cloudhost247`.
Nothing was deployed. No live Meta access token, Pixel Helper session, Test Events receipt or Events Manager evidence exists in this workspace.

## What was verified locally

| Check | Result |
|---|---|
| Backend `npm run typecheck` | passed |
| Frontend `npx tsc -p frontend/tsconfig.json --noEmit` | passed |
| `npm run build:server` | passed |
| `npm run build:frontend` | passed |
| `npm run build:tools` | passed |
| Focused Vitest run: marketing config/consent/conversions, payments, webhooks, commerce, admin billing, contact, shared engine, admin marketing UI, SPA security headers | **11 files, 134 tests passed** (325.82s) |
| Additional commerce/payment authorization regression run | **5 files, 93 tests passed** (171.79s) |
| Journey frontend suites: invoice detail, payment modal, marketing pages | **3 files, 345 tests passed** (9.12s) |
| WHMCS marketing behaviour suite `scripts/php-wasm/php tests/marketing/run.php` | passed, including 2 new Meta bridge tests |
| PHP-WASM lint: marketing AdminController/AdminView, session13, run.php | no syntax errors |
| `python3 tests/marketing/test_static.py` | 21 tests OK |
| `python3 tests/website/test_static.py` | 23 tests OK (after adding `css/marketing.css` to the theme class audit) |
| `node scripts/site/generate.mjs --check` | registry valid, 221 links |
| `node scripts/site/extract-legal.mjs` + generator | 18 legal documents regenerated; cookie/privacy addenda published to SPA + Smarty |
| Real Chromium (`@sparticuz/chromium`) against built SPA preview, Meta hosts intercepted locally | **16/16 checks passed**, `docs/evidence/meta-pixel/browser-report.json` (includes a real checkout → verified-Purchase journey) |
| Service-plans / invoice-detail / payment-modal frontend suites | **3 files, 10 tests passed** (13.94s) |
| Broad frontend unit run | **67 files, 802 tests passed** (139.59s); the seven former clean-HEAD failures are fixed |

### Chromium checks

Script: `cloudhost247-node/scripts/verify-meta-marketing.mjs` (run against `npm run preview -- 3000`).

1. No Meta request before consent.
2. No Pixel SDK element before consent.
3. Reject optional keeps Meta off.
4. Accept/save marketing preferences initializes the configured Pixel.
5. PageView dispatches via `trackSingle`.
6. Meta SDK request attempted only after consent.
7. Catalog product page dispatches ViewContent after consent.
8. Withdrawal reloads without a new Meta SDK request.
9. Withdrawal clears `_fbp`/`_fbc`.
10. Admin console renders.
11. Admin console explains API-accepted is not Events Manager receipt.
12. Verified purchase fires exactly one browser Purchase (real cart → checkout → manual payment → staff confirmation → invoice page).
13. Browser Purchase uses the verified payment event ID (`purchase:<paymentId>`).
14. Browser Purchase carries canonical catalog content IDs (`catalog:web-hosting:starter`).
15. Browser Purchase value/currency come from the paid order, not client input.
16. Server recorded the same verified Purchase event ID (CAPI authority), via the admin activity API.

Screenshots: `docs/evidence/meta-pixel/consent-before-choice.png`, `consent-accepted.png`, `admin-meta-pixel.png`, `verified-purchase.png`.
The four recorded Meta requests are local interceptions of `connect.facebook.net/en_US/fbevents.js` (SDK reloads across the two consented contexts); they are **not** evidence that Meta received or processed anything. The purchase journey uses the preview's seeded demo catalog and demo customer/admin accounts; the browser Purchase is a local `fbq` dispatch from the backend-verified receipt, never a live Meta receipt.

## Behaviour covered by automated tests

- Configuration validation, admin authorization, optimistic revision, audit rollback, encrypted write-only CAPI token, disabled legacy import, fail-closed missing key.
- Consent bootstrap, accept/reject/custom/withdraw history, CSRF/origin rejection, essential opt-out rejection, expiry/policy invalidation, jurisdiction fail-closed, source URL sanitization.
- Browser event allowlist/dedup, Purchase/PII rejection; free-text `content_name`/`content_category` labels screened for email/phone/card digit runs while legitimate catalog labels and invoice numbers (`n00000001`) still pass.
- Verified Purchase only after successful payment + paid invoice + paid order; stable payment event ID; actual amount/currency/contents; duplicate suppression; consent-withdrawal suppression.
- Owner-only purchase receipt bound to the original checkout consent session and paid order; unpaid/foreign/unauthenticated denial.
- Canonical public content IDs shared by cart/checkout and verified Purchase (`catalog:product:plan`, `platform:service:code`, `domain:registration`), not internal cart/order UUIDs.
- Configuration save disables/retargets/token removal cancels pending outbox rows; CAPI completion rechecks consent/config atomically under the delivery row lock.
- Structured Meta `error.is_transient` 4xx retry classification; permanent invalid requests are not retried.
- Expired consent sessions are pruned only after expiry; active consent and retained event/context references remain intact.
- Aged conversion contexts are retained while their order is still awaiting payment (unpaid/pending, not cancelled/failed) so a late verified payment still attributes Purchase; once the order is paid the context ages out normally.
- CAPI bearer delivery, fixed Graph origin, test code, hashed opaque external ID, no token in URL/result.
- Transient retry/backoff to five attempts then dead letter; permanent 4xx no retry; disabled integration no send; in-flight withdrawal cancellation; expired lease recovery; timeout/empty-response not success.
- Marketing retention prune leaves financial rows intact.
- Existing payment/webhook/commerce/billing/contact/migration suites still pass with best-effort marketing savepoints.
- WHMCS bridge is read-only, links to canonical console, fails closed on unsafe mount, never writes theme settings or emits a second Pixel.

## Known failures / limitations observed

- The seven baseline homepage/chrome/link-integrity failures were reproduced against clean HEAD and were not Meta regressions. They are now **fixed** in the frontend repair pass below; the full frontend unit suite passes **802/802**.
- Legacy WHMCS Google Analytics/Baidu/GTM snippets remain separately ungated; this change does not claim site-wide optional-tracking compliance for those providers.
- WHMCS order-form purchase measurement is not implemented; `complete.tpl` is not treated as payment authority.
- Browser test mode is explanatory only; `test_event_code` is applied to CAPI. No undocumented `fbq` test-code parameter was invented.
- PHP evidence uses PHP-WASM 7.4 because native PHP is unavailable. WHMCS runtime/staging was not exercised.
- Local dispatch, HTTP acceptance and configuration tests do not establish live Meta receipt, attribution or deduplication. Production sign-off still requires real credentials plus Pixel Helper/Test Events/Events Manager evidence.

## Reproduce

```bash
cd cloudhost247-node
npm run typecheck
npx tsc -p frontend/tsconfig.json --noEmit
npx vitest run tests/integration/marketing-config-api.test.ts tests/integration/marketing-consent-api.test.ts tests/integration/marketing-conversions.test.ts tests/integration/payments-api.test.ts tests/integration/webhooks-api.test.ts tests/integration/commerce-api.test.ts tests/integration/billing-api.test.ts tests/integration/contact-api.test.ts tests/integration/migrate.test.ts frontend/tests/unit/shared-marketing-engine.test.ts frontend/tests/unit/admin-marketing-integrations.test.tsx frontend/tests/unit/spa-security.test.ts
npm run build:server && npm run build:frontend && npm run build:tools
npm run preview -- 3000   # separate terminal
node scripts/verify-meta-marketing.mjs
# repository root
scripts/php-wasm/php tests/marketing/run.php
python3 tests/marketing/test_static.py
python3 tests/website/test_static.py
node scripts/site/generate.mjs --check
```


## Correctness audit pass (2026-11-08, later)

A read-only audit followed by targeted fixes closed these gaps:

- CAPI credentials are read once per drain (now a single joined SQL snapshot) so pixel/version/test code/token cannot mix revisions; completion is a single guarded UPDATE that cancels if consent/config changed while the HTTP request was in flight.
- Saving a disabled/retargeted integration or removing its token cancels queued/retry/processing deliveries instead of stranding them.
- Browser purchase receipts require the original checkout consent session, successful payment, paid invoice and paid order; server/browser Purchase content IDs now use the same public catalog identifiers.
- Browser event recording rechecks the active domain/runtime and current consent session internally; the route uses one consent context for CSRF and the event write.
- Retention removes expired consent sessions; the cookie policy/runbook now name the actual `ch247_marketing_consent` cookie.
- Meta structured transient 4xx errors retry; permanent 4xx errors do not. Malformed 200 remains ambiguous/retryable, malformed non-2xx is not automatically transient.

Regression evidence: `marketing-conversions.test.ts` now has **14 tests**, including in-flight withdrawal cancellation, save-disable cancellation, receipt session/order binding and transient-vs-permanent 4xx classification. The focused suite is **131/131**; Chromium harness rerun is **11/11** with 2 locally intercepted Meta requests.

## Correctness audit pass (2026-11-08, purchase-journey pass)

A further audit closed the remaining confirmed gaps and added end-to-end browser purchase evidence:

- **Late-payment retention:** `pruneMarketingRetention` no longer ages out a conversion context while its order is still awaiting money (`payment_status` unpaid/pending and order not cancelled/failed). A bank transfer settling after 90 days still attributes Purchase; once paid, the context ages out normally. Expired consent sessions still cascade-delete their contexts (expired consent must not produce a Purchase). The worker retention log now also reports expired consent sessions pruned.
- **Label PII guard:** `content_name`/`content_category` are screened for email addresses and long digit runs (≥10 digits, catching phone/card numbers) so a client cannot smuggle PII to Meta under a catalog label. Legitimate plan/product names, static labels and invoice numbers (`n` + 8 digits) still pass. This makes the allowlist's no-PII claim true at the schema level rather than relying on frontend discipline.
- **Canonical platform ViewContent:** `PlatformServicePlansPage` now emits a stable public product-group ID (`platform:<kind>`) instead of internal plan UUIDs, consistent with the canonical platform product namespace (`platform:<kind>:<code>`) used by AddToCart/Purchase.
- **Real-browser purchase journey:** the Chromium harness now drives a consented customer through cart → checkout → manual payment → staff confirmation → invoice page, and asserts exactly one browser Purchase from the backend-verified receipt with canonical content IDs, order-derived value/currency and the verified `purchase:<paymentId>` event ID — and that the server recorded the same event ID. Meta hosts remain intercepted; this is local dispatch evidence, not a Meta receipt.

Regression evidence: `marketing-conversions.test.ts` **15/15** (adds the unpaid-order context-retention test); `marketing-consent-api.test.ts` **8/8** (adds label-PII rejection and legitimate-label acceptance). Focused suite **133/133** (248.06s); service-plans/invoice-detail/payment-modal frontend **10/10**; all three builds pass; broad frontend at that pass was **785/792** (the same 7 clean-HEAD failures, since fixed below). Chromium harness **16/16** with 4 locally intercepted Meta requests and a `verified-purchase.png` screenshot.

## Delivery and consent hardening pass (2026-11-08, latest)

The next audit reproduced and closed four concrete gaps before handoff:

- **Crash-safe attempt budget:** the outbox claim now increments `attempts` before network I/O. Five simulated worker crashes after claim/send exhaust the budget; recovery terminalizes the row as `dead_letter` without a sixth HTTP attempt. A regression failed on the old completion-time accounting and passes now.
- **Atomic credential snapshot:** `loadCapiCredentials` uses one joined SELECT for configuration, revision, test code and ciphertext. An interleaved committed rotation can no longer pair an old test code/revision with a new token.
- **Consent response ordering:** stale bootstrap responses cannot re-grant tracking after withdrawal; same-tab preference mutations are serialized; a localStorage signal makes other open tabs fail closed immediately and refresh server consent. Two new shared-engine regressions failed before the fix and pass now.
- **Dual-channel activity:** `marketing_events` records browser and server origin timestamps separately. A browser dispatch following a server conversion marks the browser side without replacing server payload/time, and cannot attach across consent sessions. Admin channel reporting uses those origins rather than outbox presence alone.
- **Legal-source preservation:** Meta/preference-centre addenda moved to `shared/site/content/legal/addenda/` and are appended by the legal extractor. PDF re-extraction now only replaces base PDF text. Addenda say they take effect upon platform publication, not that an undeployed implementation is already published.

Current evidence: focused command **11 files / 134 tests passed** (325.82s), including conversions **17/17**, consent API **9/9**, config API **7/7**, shared engine **8/8**, admin marketing UI **4/4**. Targeted commerce frontend **10/10**; both typechecks and all three builds passed. Broad frontend at that pass was **787/794**; those seven clean-HEAD failures were fixed in the follow-up below. Chromium harness rerun after the engine change: **16/16**, four locally intercepted Meta requests, regenerated screenshots/report. PHP marketing suite passed; static suites **21/21** and **23/23**; generator check **221 links**; bullet scan **6303 files / 0 findings**.

These are local dispatch, durability and consent results. Live Meta receipt, Test Events, Pixel Helper, attribution and deployed-site verification remain unclaimed.

## Frontend baseline failure repair (2026-11-08, latest)

The seven remaining broad-frontend failures were fixed at their source, without relaxing the chrome or link-integrity assertions:

- **Five homepage failures:** `PromoVideoHero` assumed `HTMLMediaElement.play()` always returned a Promise. Playback is now normalized for Promise rejection, legacy `undefined` returns and synchronous throws; blocked autoplay cannot crash the page, explicit play failures show status, and stale manual-play completions cannot mark a newer slide failed. Homepage composition tests use an explicit JSDOM media double because JSDOM has no decoder; six new playback tests cover the real control flow.
- **One utility-line failure:** the header had an extra `Service plans` quick link in addition to the documented six controls. The utility line is restored to Pricing, Help, English, USD, Sign In and Create Account; Browse Plans remains in account navigation and My Services. The exact-order unit assertion is unchanged, and real Chromium measured zero header overlap at 1920/1600/1440/1280/1024/834/390px.
- **One dead-anchor failure:** `AppErrorBoundary` used an empty refresh href. Refresh is now a real button action calling `window.location.reload()`, with two new boundary tests. The repository-wide placeholder-anchor scan is unchanged and passes.

Verification: the three original failing suites now pass **20/20**, the two new regression suites pass **8/8**, and the full frontend unit run passes **67 files / 802 tests** (139.59s). Frontend typecheck and the complete `npm run build` pass. The Meta Chromium harness was rerun after the frontend changes: **16/16**, four locally intercepted Meta requests. No live Meta receipt is claimed.

## Merge readiness with `main` (2026-11-08)

- Merged `origin/main` after PR #102 landed. WHMCS now occupies migrations `0086`–`0088`, so the Meta migration was renumbered to `0089_create_marketing_integrations.sql`; the real migration runner suite passes **10/10**.
- The Node CI production audit initially failed on pre-existing advisories. Fastify/@fastify/static and transitive URI/glob dependencies were refreshed, and `geoip-lite` was kept on the Node-22-compatible `1.4.10` line with a scoped override to patched `ip-address@^10.7.6`. `npm audit --omit=dev` reports **0 vulnerabilities**; IPv4/IPv6 country lookup, currency geo-hint, marketing consent/config/conversions and migration tests pass.
- After the merge: server/frontend typechecks, complete build, generator check and the full frontend unit suite (**802/802**) pass. No live Meta receipt or deployment is claimed.
