# Meta Pixel — repository audit and implementation plan

Audit date: 2026-11-08. Branch: `arena/112e352e-cloudhost247`.

## Audit evidence

- `templates/cloudhost247_legacy/cloudhost247_legacy_includes/seo-trackers.tpl` directly loads `connect.facebook.net/en_US/fbevents.js`, initializes `facebook_pixel_code`, sends PageView and includes a noscript tracking image. There is no consent gate, event ID or central runtime configuration.
- `modules/addons/cloudhost247_theme/lib/ThemeRepository.php` owns the legacy `facebook_pixel_code` key in `mod_cloudhost247_theme_settings`. The current theme admin form does not expose that key. Its `platform_base_path` is a validated, same-origin Node mount, not a browser-facing localhost URL.
- The active `cloudhost247` theme does not include the legacy tracker template; the legacy theme still does. Both must use the same replacement engine, not separate snippets.
- `cloudhost247_marketing` is an email campaign subsystem with an existing Marketing admin menu. Its subscriber consent is **not** browser-cookie consent and must not be repurposed as marketing permission.
- The legacy `cookie-offers.tpl` uses a homepage-only cookieconsent dismissal library. It has no category preferences or marketing gate. The separate offer popup is unrelated and must remain unchanged.
- Cookie/privacy source documents are in `shared/site/content/legal/`; the React legal pages consume the generated registry. Existing policy text describes browser-level cookie control, not this new preference centre.
- `cloudhost247-node` is the canonical backend: Fastify, PostgreSQL, ordered SQL migrations, `requireRole` with fresh DB authorization, `audit_logs`, AES-256-GCM `lib/crypto.ts` / `lib/keyring.ts`, and a bounded cron-compatible worker.
- `src/plugins/security.ts` currently allows only self-hosted scripts and connections. Meta needs narrowly scoped script, connection, and image sources; inline scripts must remain disallowed.
- `payments` has atomic pending→successful transitions shared by staff manual confirmation and verified provider webhooks. Invoice creation is not payment confirmation. Browser payment initiation is not proof of purchase.
- `docs/feature-parity-register.csv` rows G14/H10 describe the broader connector gap. This work addresses Meta only; it does not claim Google/TikTok parity.
- No deployed WHMCS/PHP runtime, production database, public staging URL, Meta access token or Meta Events Manager session is present in the checkout. Local browser verification is possible; live provider verification is a separate external gate.

## Canonical architecture

The Node `marketing_integrations` record is the sole runtime configuration authority. The React admin console owns writes through protected, validated, audited APIs. The legacy WHMCS setting is retained as an import source and explicitly retired as an independent initializer. A WHMCS Marketing Integrations page links to the canonical console and exposes the legacy identifier for an explicit, disabled-by-default import. No cross-database writes or secret sharing are introduced.

A dependency-free shared browser engine is imported by React and loaded by both Smarty themes. It obtains public runtime configuration and the current consent decision from the same-origin Node mount. It never receives a CAPI token. One engine instance owns Meta initialization; `trackSingle` scopes events to the configured Pixel. Consent withdrawal revokes Meta consent and prevents subsequent optional calls. The old noscript Pixel is removed because it cannot respect a choice not yet made.

Consent is an essential, opaque, HttpOnly first-party cookie whose random value is hashed in PostgreSQL. Current preferences and append-only preference history are server persisted. A CSRF token and same-origin checks protect changes. No IP address, user agent, email, name or payment data is stored in marketing logs. Jurisdiction is advisory and resolved using the existing verified-proxy/local GeoIP mechanism; unknown jurisdiction fails closed. The default policy requires explicit opt-in worldwide, which is at least as restrictive as the configured jurisdictional opt-in rules.

CAPI is a separate explicit switch and write-only encrypted credential. A transactional outbox records only eligible conversions; the existing worker delivers with a fixed graph.facebook.com endpoint, request timeout, bounded retries, leases and dead letters. Browser and server purchase use the verified payment ID as their stable event ID. Meta HTTP acceptance is recorded separately from browser SDK dispatch; neither is labelled confirmed receipt in Events Manager.

## Sessions → steps → slices

Each slice requires its own verification before the next starts. Status in the final report distinguishes local verification from deployment/provider verification.

### Session 1 — canonical configuration and consent
1. **Slice 1: schema + configuration API.** Migration `cloudhost247-node/database/migrations/0086_create_marketing_integrations.sql`; `src/marketing/{types,config-service}.ts`; `src/routes/admin-marketing.ts`; registration in `src/app.ts`; integration tests `tests/integration/marketing-config-api.test.ts`. Verify real migrations, RBAC, validation, audit, reset, test mode, secret-free DTOs and encrypted CAPI configuration.
2. **Slice 2: consent persistence/API.** `src/marketing/consent-service.ts`, `src/routes/marketing.ts`, `tests/integration/marketing-consent-api.test.ts`. Verify accept/reject/custom/withdraw, opaque cookie, CSRF, expiry, jurisdiction fallback and no PII.

### Session 2 — public experience
3. **Slice 3: shared browser engine + preference centre.** `shared/site/marketing.js`, `shared/site/marketing.css`, React adapter/components and both theme shells; replace legacy tracker/cookie block; narrow `src/plugins/security.ts`; frontend unit tests for consent, one initialization, route changes, standard events, deduplication and CSP. Verify tests and build.
4. **Slice 4: administration UI.** `frontend/src/pages/AdminMarketingIntegrationsPage.tsx`, `frontend/src/lib/marketing-api.ts`, route/admin navigation, responsive existing design-system styles; `frontend/tests/unit/admin-marketing-integrations.test.tsx`. Verify configuration controls, activity, diagnostics, explicit confirmations and token secrecy.

### Session 3 — trustworthy conversions
5. **Slice 5: customer-journey instrumentation.** Product/search/cart/checkout/payment/registration/contact components; authoritative purchase receipt endpoint; WHMCS success-only hooks where runtime hooks exist. Tests cover actual IDs/currency, failed operations and refresh deduplication. No gateway or billing state logic changes.
6. **Slice 6: CAPI outbox + worker.** `src/marketing/{conversion-service,capi-client,delivery-service}.ts`, worker scheduling, verified payment/registration/lead emission; tests for atomic payment gating, consent recheck, deduplication, transient/permanent failures, bounded retries, timeout and dead letters.

### Session 4 — deployment handoff and evidence
7. **Slice 7: policies and runbook.** Update shared/generated legal content and create `docs/integrations/META-PIXEL.md`; document legacy import, mount/proxy/cookie requirements, worker, Meta setup, test procedure and privacy review.
8. **Slice 8: verification.** Focused and broad automated tests, typechecks, builds, PHP syntax/static checks where tooling exists, real Chromium against the actual built public app with intercepted Meta traffic. Run the real app/database locally; do not substitute a mock landing page. Record screenshots/logs outside Git or under an explicit small evidence directory. Meta Test Events/Pixel Helper on the deployed site remain blocked until access is supplied.
9. **Slice 9: final report.** `docs/integrations/META-PIXEL-IMPLEMENTATION-REPORT.md` with exact files, commands/results, limitations and accurate acceptance labels. Update only the Meta-specific portion/notes of parity evidence, not unrelated provider claims.

## Non-goals and safety boundaries

No payment gateway setting, price, invoice, authentication policy or unrelated production behaviour changes. No automatic production migration or provider activation. No Google/TikTok implementation. No claimed legal compliance certification. No advanced matching by default; any future eligible customer-information matching must use normalization + SHA-256, consent and documented lawful basis. No fabricated Meta delivery success.


---

## Implementation status (2026-11-08)

Slices 1–7 are implemented and locally verified; slice 8 policies/runbook/evidence/final report is complete; slice 9 production sign-off remains **blocked on real Meta credentials and deployed-site access**.

- Canonical Node config/consent/events/outbox, encrypted CAPI token, admin console/API, shared React/Smarty engine, legacy direct-Pixel retirement, conversion journeys, verified-payment Purchase, leased CAPI worker + retention, WHMCS read-only bridge/import UX, legal addenda and runbook are in place.
- Exact local results and limitations: `docs/integrations/META-PIXEL-VERIFICATION.md`. Chromium evidence: `docs/evidence/meta-pixel/`.
- 2026-11-08 correctness audit closed CAPI revision/atomic-completion races, save-disable outbox cancellation, receipt session/order binding, canonical content IDs, browser-event consent recheck, expired-session retention and cookie-policy naming. Focused suite **131/131**; conversions **14/14**; Chromium **11/11**. Broad frontend failures were reproduced against clean HEAD and verified pre-existing (fixed in the later frontend repair pass).
- 2026-11-08 latest audit pass closed late-payment context retention (unpaid orders keep their conversion context past 90 days), added a schema-level PII guard on `content_name`/`content_category`, made platform ViewContent use canonical public group IDs, and extended the Chromium harness with a real consented checkout → staff-confirmed payment → verified browser Purchase journey (matching server event ID). Focused suite **133/133**; conversions **15/15**; consent API **8/8**; Chromium **16/16**. No live Meta receipt is claimed.
- 2026-11-08 delivery/consent hardening reserved outbox attempts at claim time, made credential loading one SQL snapshot, blocked stale/cross-tab consent re-grants, separated browser/server activity origins, and preserved legal addenda outside PDF re-extraction targets. Current focused command **134/134**; conversions **17/17**; consent API **9/9**; shared engine **8/8**; Chromium **16/16**. Final handoff: `docs/integrations/META-PIXEL-IMPLEMENTATION-REPORT.md`.
- 2026-11-08 frontend repair pass fixed the seven clean-HEAD unit failures at source: normalized promotional-video playback, restored the six-control utility line, and replaced the error-boundary empty anchor with a reload action. Full frontend **802/802** (67 files); complete build passed; Chromium header layout had zero overlap at seven widths; Meta harness remained **16/16**.
- No live Meta receipt or production verification is claimed. Legacy GA/Baidu/GTM consent gating and WHMCS-side purchase measurement remain explicit follow-ups.
