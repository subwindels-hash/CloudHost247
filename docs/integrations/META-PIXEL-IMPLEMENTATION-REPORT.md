# Meta Pixel implementation report

Date: 2026-11-08 (UTC). Branch: `arena/112e352e-cloudhost247`. Status: **implemented and locally verified; production sign-off blocked**. Nothing was deployed and no live Meta credentials were used.

## Delivered scope

The canonical implementation lives in the Node platform (`cloudhost247-node/`) and PostgreSQL migration `0086_create_marketing_integrations.sql`. It provides:

- Admin configuration and encrypted CAPI token storage at `/api/v1/admin/marketing-integrations/meta-pixel`, with revision checks, audit entries, reset confirmation and an activity view. React console: **Admin → Marketing Integrations → Meta Pixel**.
- Public bootstrap/consent/browser-event/receipt APIs under `/api/v1/marketing`, an HttpOnly opaque `ch247_marketing_consent` cookie, persisted preference history, CSRF/origin checks and fail-closed runtime behaviour.
- One shared browser engine (`shared/site/marketing.js`) used by React and both Smarty themes. No Meta SDK or event is dispatched before marketing consent; withdrawal revokes the Pixel, clears known Meta cookies, reloads the current tab and refreshes other open tabs. Stale bootstrap responses cannot re-grant permission.
- Standard funnel events, registration/contact events and **verified Purchase only**. Purchase IDs are `purchase:<payment UUID>`; value/currency come from the successful payment and paid invoice/order. Browser receipts are owner-only and bound to the original checkout consent session.
- A leased CAPI outbox worker with five durable attempts reserved at claim time, crash recovery, backoff, structured transient-error classification, bearer-only Graph calls and atomic consent/configuration rechecks at completion. API acceptance is recorded honestly as HTTP receipt, not Events Manager processing.
- Retention pruning, unpaid-order context preservation, label-PII screening, canonical public content IDs, legacy direct-Pixel retirement, WHMCS read-only bridge/import UX, legal addenda and the operational runbook.

The WHMCS legacy identifier is import-only/disabled; Node PostgreSQL is the authority. Google Ads/Analytics connectors, advanced matching, a separate analytics provider and WHMCS-side purchase measurement are **not** part of this delivery.

## Acceptance and evidence

| Area | Result |
|---|---|
| Server/frontend typechecks; server, frontend and tools builds | passed |
| Focused integration/frontend command (11 files) | **134/134 passed** (325.82s) |
| Marketing conversions / consent API / config API | **17/17**, **9/9**, **7/7** |
| Shared marketing engine / admin marketing UI | **8/8**, **4/4** |
| Service-plans, invoice-detail, payment-modal frontend | **10/10** |
| Broad frontend unit run | **67 files, 802 tests passed**; the seven former clean-HEAD failures are fixed |
| Real Chromium against built preview, Meta hosts intercepted | **16/16 checks**, 4 intercepted Meta requests, including consented checkout → staff-confirmed manual payment → one verified browser Purchase matching the server event ID |
| PHP-WASM marketing suite; marketing/website static suites | passed; **21/21** and **23/23** |
| Generator check; repository bullet scan | **221 links**; **6303 files / 0 findings** |

Evidence: `docs/integrations/META-PIXEL-VERIFICATION.md`, `docs/evidence/meta-pixel/browser-report.json` and the four screenshots in that directory. Harness: `cloudhost247-node/scripts/verify-meta-marketing.mjs` against `npm run preview -- 3000`.

The latest regressions specifically prove: an interleaved token rotation cannot mix credential revisions; five simulated post-claim worker crashes exhaust the attempt budget without a sixth send; stale bootstrap and cross-tab consent changes fail closed; and a browser dispatch can mark a server-recorded event without overwriting server authority or crossing consent sessions.

A follow-up frontend repair pass fixed the seven clean-HEAD unit failures: resilient promotional-video playback, the documented six-control utility line, and a real error-boundary reload action instead of an empty anchor. Eight new regression tests cover playback and the boundary; the full frontend suite passes **802/802**, the complete build passes, and Chromium reports zero header overlap at seven widths.

## Operational semantics

- Token rotation alone keeps queued/retry deliveries for the new credential; an in-flight old-revision completion is cancelled. Pixel change, disable, token removal, reset or consent withdrawal cancels pending work.
- Attempts are consumed before network I/O. Retry backoff after attempts 1–4 is 60s, 5m, 30m, 2h; the fifth failed/crashed attempt is terminal.
- Consent history is retained up to 180 days, events up to 90 days and terminal delivery diagnostics up to 30 days. Unpaid/pending non-cancelled orders keep their conversion context until no longer awaiting payment; expired consent still cascades.
- Legal addenda are stored separately in `shared/site/content/legal/addenda/` and appended by `scripts/site/extract-legal.mjs`; PDF re-extraction cannot erase them. They require legal review and take effect upon publication of the platform implementation.

## Remaining sign-off blockers

1. Configure a real Pixel/CAPI token in the target environment and run Meta Test Events, Pixel Helper and Events Manager checks on the deployed domain.
2. Verify live receipt, deduplication and attribution with provider-side evidence; local interception cannot establish these.
3. Obtain legal approval of the preference-centre/marketing addenda before publication.
4. Authorise any Google connector or advanced-matching work separately.

No live Meta receipt, attribution, deduplication, Test Events, Pixel Helper or deployed-site verification is claimed by this report.
