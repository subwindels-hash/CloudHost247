# TikTok Pixel integration — CloudHost247

Status: **implemented and locally verified; production sign-off blocked on an
external TikTok account** (see "External account requirements"). No live
TikTok credentials were used in development or tests, and no TikTok account
connection, event receipt, or attribution is claimed without that evidence.

Technical reference: TikTok Business Help Center / TikTok Business API docs —
Pixel installation (`https://analytics.tiktok.com/i18n/pixel/events.js`),
standard web events, and Events API v1.3
(`POST https://business-api.tiktok.com/open_api/v1.3/event/track/`).

---

## 1. Repository audit (performed before implementation)

| Area | Existing implementation found | Reused for TikTok? |
|---|---|---|
| Meta Pixel | Canonical Node implementation: `cloudhost247-node/src/marketing/*` (config, consent, events, CAPI client/worker), migration `0089`, shared runtime `shared/site/marketing.js`, admin page `/admin/marketing-integrations/meta-pixel`, runbook/report in this folder | **Yes — architecture, tables, consent, outbox, audit, crypto all reused** |
| GA4 | Legacy WHMCS-only snippet in `templates/cloudhost247_legacy/cloudhost247_legacy_includes/seo-trackers.tpl` (`google_analytics_code` setting, gtag.js). No Node-side GA4 integration | No (untouched; noted as not consent-gated — pre-existing) |
| Google Ads | No pixel/conversion-tag integration. Only managed-marketing provider names (`google_ads`) in `src/marketing-services/campaign-service.ts` with an env-token placeholder | No (untouched) |
| Cookie consent | Single consent manager: `marketing_consent_sessions/history`, HttpOnly opaque cookie, preferences UI in `shared/site/marketing.js` (Accept all / Reject optional / Customize / Save / Withdraw, reopen via Cookie settings), categories essential/analytics/marketing | **Yes — TikTok uses the same Advertising/Marketing category; no second consent system** |
| Marketing architecture | `marketing_integrations` (provider-keyed config + revision), `marketing_integration_secrets` (AES-GCM encrypted, keyring in `src/lib/crypto.ts`/`keyring.ts`), `marketing_events` (unique `(provider_key,pixel_id,event_name,event_id)`), `marketing_delivery_outbox` (leased, 5 attempts, backoff), `recordAudit` | **Yes — TikTok is provider `tiktok_pixel` in the same tables (migration `0090`)** |
| Commerce | Node cart/checkout (`routes/commerce.ts`, `services/commerce-service.ts`), authoritative payment transitions in `services/payment-service.ts` + `services/webhook-service.ts` calling `recordVerifiedPaymentBestEffort` | **Yes — `recordVerifiedTikTokPaymentBestEffort` added at the same two call sites only** |
| Node architecture | Fastify + PostgreSQL (PGlite in tests), React SPA (Vite), worker `src/worker/main.ts` | Yes |
| CSP | `src/plugins/security.ts` (@fastify/helmet) with Meta origins allowlisted | Extended minimally (below) |
| Admin auth/RBAC | `requireRole(['admin','super_admin'])`, revision-checked saves, audit logs | Yes |
| WHMCS | Legacy theme loads generated copies of the shared runtime via `templates/*/includes/marketing.tpl` / legacy `footer.tpl`; legacy `facebook_pixel_code` is import-only | TikTok runtime added the same way (generated copies) |
| Existing TikTok code | **None found** (no `ttq`, TikTok pixel, or Events API code anywhere) | — |

Missing before this work: any TikTok config, runtime, events, server-side
delivery, diagnostics, CSP origins, tests, and docs. Files created/modified
are listed in the implementation report accompanying this change.

## 2. Create a TikTok Business account and Pixel

1. Sign in at TikTok Ads Manager / Business Center with a business account.
2. Go to **Tools → Events** (Events Manager) → **Web events** → connect a data
   source / create a Pixel for your website domain.
3. Choose **Manual setup** and note the **Pixel ID** (the alphanumeric pixel
   code, commonly starting with `C`, shown in Events Manager and used as
   `event_source_id` in the Events API).
4. Optionally open **Test Events** and copy a **Test Event Code** for staging.
5. For the Events API: in Events Manager, select the Pixel → **Settings** →
   generate an **Access Token** authorized for that Pixel. Treat it as a
   secret; you will paste it once into CloudHost247 (write-only).

## 3. Configure CloudHost247

Admin → **Marketing Integrations → TikTok Pixel**
(`/admin/integrations/tiktok-pixel`, also a tab under
`/admin/marketing-integrations`):

1. Enter Pixel name, **TikTok Pixel ID** (validated: 16–32 alphanumeric
   characters; markup/scripts are rejected — no arbitrary JavaScript can be
   entered), and the **website domain** (hostname only; the runtime refuses
   to fire on a different host).
2. Enable TikTok Pixel, choose which standard/lead events are enabled, and
   optionally enable remarketing.
3. Save Changes. The integration can be disabled instantly by unticking
   Enable and saving; Reset Configuration removes the stored token, disables
   tracking and cancels pending deliveries (audit history retained).

No production Pixel ID exists in application source code; the ID comes only
from this database-backed configuration.

## 4. How tracking works

- The official TikTok library is loaded dynamically from
  `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=<Pixel ID>&lib=ttq`
  by `shared/site/tiktok.js` (React, WHMCS `cloudhost247` theme and legacy
  theme share this one runtime; the theme copies are generated by
  `node scripts/site/generate.mjs`).
- It loads **only** when the integration is enabled, the domain matches, and
  the visitor has granted the Advertising/Marketing consent category.
  Withdrawal stops dispatch, clears `_ttp`/`ttclid` cookies, and cancels
  queued server deliveries.
- Duplicate initialization and duplicate page views are prevented (init
  guard, per-path guard, session-scoped dispatched-event set). React
  client-side navigation fires a page view per route change via `Layout`.
- Every event carries a stable `event_id`. The browser records its dispatch
  at `POST /api/v1/marketing/tiktok/browser-events` (CompletePayment is
  refused there) so the server can reuse the **same** `event_id`.

### Standard events

| TikTok event | Trigger in CloudHost247 |
|---|---|
| `PageView` | Initial load + each SPA route change (deduped per path) |
| `ViewContent` | Product/service plan views (existing funnel call sites) |
| `Search` | Domain search / bulk search completed |
| `AddToCart` | Item successfully added to cart |
| `InitiateCheckout` | Checkout successfully initiated (order created) |
| `PlaceAnOrder` | Order successfully placed at checkout |
| `AddPaymentInfo` | Payment step successfully completed |
| `CompletePayment` | **Only** after authoritative payment confirmation (successful payment + paid invoice + paid order); browser copy only from the owner-authenticated verified receipt endpoint |
| `SubmitForm` | Successful contact form submission (fired alongside `Contact` with a `submit:`-prefixed ID) |
| `CompleteRegistration` | Successful account registration (server-recorded, then browser with same ID) |
| `Contact` | Successful contact/enquiry submission (server-recorded after backend processing; failed/spam submissions create nothing) |
| `Subscribe` | New newsletter subscription successfully created (AI-support subscribe flow; already-subscribed duplicates never fire it; server-recorded first, browser copy shares the event ID) |

Events fire only after the corresponding backend operation succeeds.
Product data uses real catalog identifiers (`catalog:<product>:<plan>`,
`platform:<kind>:<code>`, `domain:<id>`), real quantities, and the actual
transaction `value` + `currency` from the payment row — no currency is
hardcoded or converted. No payment details, passwords, or free-text form
content are ever sent (server payloads pass an allowlist schema with PII
screening inherited from the Meta event schema).

### Lead events

Contact, SubmitForm, CompleteRegistration and Subscribe can each be enabled
or disabled in the admin page (`enabledEvents`). Form impressions, clicks,
failed and duplicate submissions are never recorded as leads.

### Remarketing

When enabled by the admin **and** marketing consent is granted, product
interactions (`ViewContent` etc.) feed TikTok audience building. Users who
reject/withdraw advertising consent are excluded, and pending server
deliveries are cancelled on withdrawal. **Dynamic product advertising is not
claimed active**: it additionally requires a verified TikTok product catalog
and campaign configuration in the TikTok account, which is external.

## 5. Events API (server-side, optional)

- Endpoint: TikTok Events API v1.3 `event/track`, token sent only in the
  `Access-Token` header; body uses `event_source: "web"`,
  `event_source_id: <Pixel ID>`, `test_event_code` only in test mode.
- The token is encrypted at rest with the existing keyring
  (`CREDENTIAL_ENCRYPTION_KEY`), stored in `marketing_integration_secrets`
  under `events_api_access_token`, never returned by any API, never logged,
  never in a frontend bundle.
- Delivery runs through the shared leased outbox (max 5 attempts, backoff
  1m/5m/30m/2h/12h, dead-letter + full delivery history in admin activity).
  Consent and configuration are re-checked before sending and atomically at
  completion, so a withdrawal mid-flight cancels delivery — the Events API
  is never used to bypass consent.

### Browser/server deduplication

Both copies of an event use the identical `event_id` (e.g.
`purchase:<payment UUID>` for CompletePayment) and event name. The local
ledger enforces uniqueness on `(provider_key, pixel_id, event_name,
event_id)`, the browser runtime refuses to re-dispatch a seen ID, and TikTok
deduplicates matching browser + server events. WHMCS themes and the Node
frontend share the same runtime and event IDs, so a purchase cannot be
reported twice across surfaces.

## 6. Test mode and verification

1. Enable the integration on staging with test mode on and the Test Event
   Code from TikTok Events Manager **Test Events**.
2. Test traffic carries `test_event_code` (browser + server), so it does not
   generate production conversions or distort campaign reporting.
3. Use TikTok's **Test Events** view and the Pixel Helper to confirm receipt
   and browser/server deduplication. The admin "Test configuration" button
   only validates the saved configuration locally — it honestly reports
   `providerContacted: false`.
4. Turn test mode off before production use.

## 7. Cookie consent behaviour

TikTok is covered by the existing **Advertising / Marketing** category in the
single CloudHost247 consent manager (banner text updated to name Meta and
TikTok). Accept all / Reject optional / Customize / Save / Withdraw and
reopening preferences work exactly as for Meta, persisted server-side for
180 days with a full history. Changes take effect without clearing the
browser (runtime refresh + cross-tab signal + reload-on-withdrawal from the
consent owner). TikTok enable/disable is independent of Meta Pixel and of
any Google settings.

## 8. CSP changes

`cloudhost247-node/src/plugins/security.ts` (only these additions):

| Directive | Added origin | Purpose |
|---|---|---|
| `script-src` | `https://analytics.tiktok.com` | Official TikTok Pixel library (`events.js`) |
| `connect-src` | `https://analytics.tiktok.com` | Pixel event beacons |
| `img-src` | `https://analytics.tiktok.com` | Pixel fallback/beacon images |

CSP stays enabled; no wildcards, no `unsafe-inline`/`unsafe-eval` additions,
no unrelated directive weakened.

## 9. Diagnostics and troubleshooting

Admin → TikTok Pixel → **Diagnostics** shows Pixel ID, enabled state,
installation status, consent status, Events API connection status, enabled
events, last successful test, last server delivery status, events recorded,
and duplicate-event warnings (derived from the dedup ledger).

| Symptom | Check |
|---|---|
| No events in TikTok | Integration enabled? Domain matches? Consent granted (marketing category)? CSP not overridden by a proxy? Test in Test Events |
| Events API not delivering | Events API enabled + token stored? Worker running? Activity tab shows attempts/`last_error`; token authorized for this Pixel in TikTok? |
| Duplicates in TikTok | Check duplicate warnings in Diagnostics; confirm browser and server share `event_id` in Test Events |
| CompletePayment missing | Payment must be *successful* with paid invoice/order; pending payments intentionally never fire it |
| Wrong amounts | Values come from the payment row (actual currency); verify the payment record, not the cart |

## 10. External account requirements (blocked / unverified)

1. A real TikTok Business/Ads account, a created Pixel, and its Pixel ID.
2. An Events API access token authorized for that Pixel (optional feature).
3. Live verification in TikTok Events Manager / Test Events / Pixel Helper
   on the deployed domain, including browser/server deduplication evidence.
4. For dynamic product advertising: a verified TikTok catalog + campaign
   setup (not provided by this integration).
5. Legal review of the updated consent copy before publication, as with Meta.

Until (1)–(3) are done, the Events API status must be read as
**pending external account configuration**, exactly as the admin UI states.

## 11. Verification record (continuation pass, 2026-11-08)

- Full backend unit suite: **1,915/1,915 passed** (133 files).
- Full backend integration suite (all 83 files, run in chunks):
  189 + 213 + 132 + 180 passed in the chunked runs, plus the previously run
  marketing/TikTok/consent/conversions/migrate/commerce/payments/contact/auth
  files (33 + 17 + 51) — **no failures**.
- Full frontend suite: **809/809 passed** (69 files), including the TikTok
  admin page regression tests added after a wiring bug (missing TikTok admin
  imports / route fallback) was found by the frontend typecheck and fixed.
- Server + frontend typechecks and `npm run build`: pass.
- `Subscribe` now fires for genuinely new newsletter subscriptions and
  `SubmitForm` for successful contact submissions (see §4 table).
