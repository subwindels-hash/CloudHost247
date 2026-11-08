# Meta Pixel + Conversions API runbook

Status: implemented in the Node/React platform and shared Smarty engine; WHMCS has a read-only bridge.
No live Meta credential or production Events Manager receipt is part of this repository.

## Authority and surfaces

- Canonical configuration, consent, conversion activity and CAPI delivery live in the Node PostgreSQL database (`0089_create_marketing_integrations.sql`).
- React admin: **Admin → Marketing Integrations → Meta Pixel** (`/admin/marketing-integrations/meta-pixel`). Activity and audit tabs are adjacent.
- WHMCS: **CloudHost247 Marketing → Marketing Integrations** is a read-only bridge. It shows the legacy `facebook_pixel_code` and links to the canonical console using the theme's verified same-origin `platform_base_path`. It never writes the Node database and never installs a second Pixel.
- Both Smarty themes load the generated copy of `shared/site/marketing.js`. The legacy direct Pixel/noscript initializer is retired. The old theme setting remains only for explicit import.

## Initial setup

1. Deploy the Node migration: `npm run migrate` (production requires the repository's explicit migration confirmation flow).
2. Set `CREDENTIAL_ENCRYPTION_KEY` (64 hex chars) or the platform keyring before storing a CAPI token. Without a key, token save/enable fails closed.
3. In the canonical console, enter the numeric Pixel ID and the exact website domain (no scheme/path). The runtime disables itself on a domain mismatch.
4. Optional: enable CAPI, choose the Graph API version, and paste a Meta access token with the required ads/event permissions. The token is encrypted at rest, write-only in the API, and sent only as an `Authorization: Bearer` header to `https://graph.facebook.com/...`.
5. Use **Test configuration** to validate format/domain/credential presence. This is not a Meta delivery test.
6. Save, then explicitly enable the integration. New installations default to disabled.
7. Run the Node worker (`npm run worker` or the cPanel `worker:once` cron). The CAPI outbox drains on the same 60-second cadence as the notification outbox.

### Legacy WHMCS import

Use **Import legacy WHMCS Pixel**, paste the identifier shown in the WHMCS bridge, review the domain, and save. Import never enables tracking and never mutates the WHMCS theme setting. There is no automatic cross-database sync.

## Consent behaviour

- The public bootstrap issues only an essential, opaque, HttpOnly `ch247_marketing_consent` cookie (180 days). Optional categories start off.
- Accept all / reject optional / custom preferences / withdraw are persisted server-side with history and CSRF/origin checks.
- No Meta SDK, Pixel init, PageView or CAPI event is emitted before marketing consent.
- Withdrawal revokes the browser Pixel, clears known `_fbp`/`_fbc` cookies, reloads the current page, refreshes other open tabs, and cancels queued/retry/in-flight CAPI deliveries for that session. Saving a disabled/retargeted integration or removing its token also cancels pending deliveries.
- Jurisdiction rules are conservative: EEA/UK/CH require opt-in; US states with opt-out frameworks use global opt-in here; unknown jurisdictions fail closed to opt-in. This is an engineering default, not legal advice.
- Policy version changes invalidate older consent decisions.

## Conversion journeys

| Event | Trigger | Authority |
|---|---|---|
| PageView | SPA route change / Smarty page load after consent | shared engine |
| ViewContent | published product/platform plans render | catalog API data |
| Search | completed domain/bulk-domain search | server search ID + result count, no raw query |
| AddToCart | successful cart mutation | public content ID (`catalog:product:plan` / `platform:service:code`) + quantity |
| InitiateCheckout | successful order creation | order total/currency + server-resolved cart content IDs |
| AddPaymentInfo | payment initiation response | payment ID, invoice amount; not a purchase |
| CompleteRegistration | successful registration | server + browser success path |
| Contact / Lead | successful contact submission | server + browser success path |
| Purchase | successful payment + paid invoice + paid order | `recordVerifiedPayment` in the payment transaction; browser only via owner-authenticated receipt endpoint |

Purchase event ID is `purchase:<payment UUID>`. Value/currency come from the payment row; contents come from order items. Browser and server use the same ID for Meta deduplication. A sandbox initiation callback, invoice creation, or client-supplied amount never produces a Purchase.

Marketing writes are best-effort savepoints inside financial transactions: a marketing failure cannot roll back a valid order or payment.

## CAPI delivery and diagnostics

- Outbox states: `queued → processing → delivered | retry | dead_letter | cancelled`.
- Claims use `FOR UPDATE SKIP LOCKED` and a 60-second lease. Each claim durably reserves one attempt before network I/O; expired processing rows are recoverable until the budget is exhausted, then become dead-letter without another send. Completion is guarded by the claim token.
- Attempts are capped at 5. Retry backoff after attempts 1–4 is 60s, 5m, 30m, 2h; the fifth failed/crashed attempt is terminal. 429/5xx/network/timeout and Meta structured transient errors are retryable; other 4xx are permanent. HTTP 200 without `events_received > 0` is not success.
- Credentials are loaded from one joined SQL snapshot per drain. Configuration/consent are rechecked before send and atomically at completion. Token rotation alone keeps queued/retry work for the new credential (an in-flight old-revision completion is cancelled); pixel change, disable, token removal, reset or withdrawal cancels pending work.
- Activity records browser and server origin timestamps separately and shows CAPI delivery status; a later browser dispatch marks the same server event without overwriting its authoritative payload/time. **API-accepted means Meta's HTTP response reported events received; it is not proof of Events Manager processing, attribution or deduplication.**
- Test mode adds `test_event_code` to CAPI payloads only. Meta's browser Pixel has no documented `fbq` test-code parameter; use the Test Events browser tab for browser verification. The admin UI states this limitation.
- Retention worker: consent history 180 days, events/contexts 90 days, terminal deliveries 30 days. Financial/auth audit records are untouched.

## Reset

Reset requires an explicit confirmation dialog (API confirmation value `RESET`). It disables the integration, clears the public configuration and encrypted CAPI token, cancels pending deliveries, and writes an audit entry. Consent history and financial records are retained.

## Known limitations

- The legacy WHMCS theme still contains separate Google Analytics, Baidu and GTM snippets that are not governed by this Meta consent engine. They must be reviewed/retired or consent-gated separately before claiming site-wide optional-tracking compliance.
- No advanced matching (email/phone/name) is sent by default. A helper exists for a future separately reviewed integration.
- WHMCS order-form `complete.tpl` is not a Node payment authority; this change does not fabricate a WHMCS Purchase from an unpaid order confirmation. WHMCS-side purchase measurement would need a verified WHMCS payment hook/bridge and is not implemented here.
- Local tests and browser interception cannot establish live Meta receipt. Production verification requires real credentials, Pixel Helper/Test Events and Events Manager evidence.

## Retention and receipt binding

- Consent history: 180 days. Marketing events: 90 days. Terminal delivery diagnostics: 30 days. Expired consent sessions are removed by the daily prune; active sessions are never pruned early.
- Legal wording: PDF base text remains in `shared/site/content/legal/*.txt`; reviewed platform addenda live in `shared/site/content/legal/addenda/` and are appended by `extract-legal.mjs`, so PDF re-extraction cannot erase them.
- Conversion contexts age out at 90 days **only once their order is no longer awaiting payment**. An unpaid/pending order (not cancelled/failed) keeps its context so a late verified payment — e.g. a bank transfer settling after 90 days — still attributes Purchase. Once the order is paid the context ages out normally. Expired consent sessions cascade-delete their contexts, which is correct: expired consent must not produce a Purchase.
- `content_name`/`content_category` are catalog-label fields (plan/product names, invoice numbers, static labels). The API rejects obvious PII in them (email addresses, ≥10-digit phone/card runs); the frontend only ever sends catalog labels.
- The browser purchase receipt is owner-only and bound to the original checkout consent session. A different browser session, unpaid order, unpaid invoice or foreign invoice cannot mint a browser Purchase.
- CAPI completion atomically rechecks current consent and configuration revision under the outbox row lock; a withdrawal/disable that wins the race cancels the delivery rather than recording it as delivered.

## Verification commands

```bash
cd cloudhost247-node
npm run typecheck
npx tsc -p frontend/tsconfig.json --noEmit
npx vitest run tests/integration/marketing-config-api.test.ts tests/integration/marketing-consent-api.test.ts tests/integration/marketing-conversions.test.ts
npx vitest run frontend/tests/unit/shared-marketing-engine.test.ts frontend/tests/unit/admin-marketing-integrations.test.tsx
npm run build:server && npm run build:frontend
# WHMCS bridge behaviour (PHP-WASM in this sandbox)
scripts/php-wasm/php tests/marketing/run.php
```

See `META-PIXEL-VERIFICATION.md` for the exact evidence collected in this workspace.
