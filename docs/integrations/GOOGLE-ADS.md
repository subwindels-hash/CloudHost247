# Google Ads integration

CloudHost247 provides an optional browser-side Google Ads tag integration managed from **Admin → Google Ads conversions** (`/admin/integrations/google-ads`). It uses the existing marketing integration store, cookie choice, and browser event API; it does not install GTM or GA4, create Google account objects, or upload server-side conversions.

## Current scope and trust boundaries

- The Ads destination and conversion events are active only if Google Ads is enabled, the configured domain matches the current host, and the visitor has granted marketing/advertising consent. A Google tag library request may separately occur for the pre-existing legacy GA4 or GTM settings after their analytics consent gates.
- The shared consent manager sets Google Consent Mode v2 defaults before inserting `gtag.js`, and then updates `ad_storage`, `analytics_storage`, `ad_user_data`, and `ad_personalization` from the visitor’s saved categories. Withdrawal sends a denied update and expires visible Google Ads linker cookies where possible. HttpOnly or otherwise inaccessible third-party storage cannot be cleared by page script; Google consent signals are the operative control.
- Purchase events are only dispatched from the owner-authenticated verified invoice receipt. Server logic checks successful payment, paid invoice and paid order, and obtains amount, currency, product identifiers, catalog names (when present), quantities, and event identity from stored records. No coupon value is currently available on the authoritative receipt, so none is invented or sent. Creating an order, opening checkout, or returning from a payment modal is not purchase authority. Purchases are emitted when the customer views a paid invoice while consent is present; this browser-side design does not guarantee an event if the user never returns to the site. It covers Node-managed invoices/orders only; the separate WHMCS payment-completion workflow has no verified callback connected here, so WHMCS-paid purchases are not claimed as measured.
- Leads and registration are dispatched only by existing UI flows after successful backend operations. Failed submissions and clicks alone do not call the conversion path. Contact flows may produce distinct Contact and Lead conversions only when both labels are configured; decide whether that is desired to avoid double-counting in Google Ads.
- Product view, add-to-cart, checkout, payment selection and successful purchase events originate in the shared existing event calls. Conversion actions without an existing verified backend event (subscription activation, renewal, upgrade) are configurable but do not fire until their authoritative business workflow emits a corresponding event. No fake events are produced.
- Conversion labels are sent directly to Google Ads. “Primary” is a local configuration note only; the Google Ads action’s category and account-level goal must also be set in Google Ads. No Google account permissions or account linkage are verified by a local config test.
- Enhanced Conversions are deliberately disabled pending privacy/legal review. No email, phone, address or customer matching data is collected or sent. Dynamic remarketing/feed support is not implemented and is not advertised as active.
- The default currency is optional and informational. A purchase always uses the currency stored on the successful payment; the integration never converts currency or substitutes a configured default for a transaction.
- There is no server-side Google Ads API upload, OAuth token, developer token, retry queue, or Google delivery receipt. The current implementation is browser-only and reports this honestly in diagnostics. An Ads account, destination, and external action configuration remain required.

## Setup

1. Create or access the Google Ads account and ensure the operator has permission to manage conversion actions and tags.
2. Find the **Customer ID** in Google Ads (10 digits; omit hyphens when entering it in CloudHost247). This is diagnostic configuration and does not authenticate the CloudHost247 integration.
3. In Google Ads, open **Goals → Conversions → Summary** and create a Website conversion action for each business goal you intend to measure. Select the appropriate category and counting method; for purchases choose a transaction-based counting method and use transaction IDs to deduplicate.
4. In each conversion action’s tag setup, select the Google tag installation instructions. Record the conversion ID and that action’s conversion label. The destination ID is the numeric `AW-…` value; enter just the digits in CloudHost247. Enter the associated action label in the matching row.
5. Select the advertised website hostname (without scheme, path, port, or `www.`) and optionally the default ISO 4217 currency for reference. Save with integration disabled first, review the IDs and labels, then enable it. Do not paste API secrets or customer data into these fields.
6. Configure each action as Primary or Secondary in Google Ads itself. CloudHost247’s Primary checkbox is a local reporting intention and does not call the Google Ads API.
7. Enable remarketing only if your account’s policy, notices, and consent support it. The integration sends limited page/product context under advertising consent. A supported product feed and dynamic remarketing campaign are not included.
8. Run **Local configuration test**. This validates saved settings only and sends no request to Google and no conversion. Test browser loading with the Google Tag Assistant and Google Ads diagnostics on a controlled test visit; do not create a fake production purchase. Google’s tag has no generic “test conversion” mode in this UI.

## Google Ads and GA4 account linking

Google Ads account linking is completed externally. In GA4 use **Admin → Product links → Google Ads links**, select the Ads account, review permissions and personalized advertising settings, then finish the linking flow. In Google Ads, confirm the linked GA4 property and audience-sharing/remarketing settings as applicable. Audience availability depends on consent, account eligibility, property settings, Google policy and sufficient audience size. Linking does not happen because a Google tag is installed.

The legacy WHMCS theme already has Google Analytics and GTM identifiers in its theme settings. Their former head snippets have been retired; the identifiers are now passed as inert attributes to the shared marketing runtime. The existing GA4/gtag destination loads only after Analytics consent and uses the same Consent Mode queue as Google Ads. Existing GTM loads only when both Analytics and Marketing consent are granted because the container’s contents are not inspectable here; configure each GTM tag’s built-in consent requirements as well. The React/Node admin does not manage the GA4 measurement ID or GTM container. This code does not create account links, export audiences, import GA4 conversions, or verify the linked accounts. Keep a single chosen source of truth for each conversion. Explicitly choose whether Ads conversion actions or imported GA4 conversions are primary and avoid counting both as primary goals.

## Consent Mode v2 and visitor preferences

The existing **Accept all**, **Reject optional cookies**, **Customize Preferences**, **Save Preferences**, **Withdraw Consent**, and **Cookie settings** controls remain the sole preference UI. “Analytics” maps to `analytics_storage`; the advertising choice maps to `ad_storage`, `ad_user_data` and (only when remarketing is enabled) `ad_personalization`. Consent is denied by default before Google scripts run. Rejecting or withdrawing consent prevents tag loading/conversion dispatch and updates an already-loaded Google tag to denied. Consent Mode is not used to override the user’s choice. The jurisdiction policy and privacy notice must be reviewed by the site operator; configuration is not legal advice.

## Conversion coverage and source of truth

| Objective | Current authority / event |
|---|---|
| Purchase | Successful payment + paid invoice + paid order; receipt is server-authenticated; transaction ID, actual amount/currency and order product identifiers come from the database. |
| Lead / Contact | Successful backend contact/enquiry operation; the current Contact workflow can emit the configured Contact and Lead objectives. |
| Sign-up | Account registration succeeds; stable user-derived event identity; no password or account PII is sent. |
| Add to Cart / Begin Checkout | Existing central cart/order successful actions, not impressions or failed actions. |
| Subscription / Renewal / Upgrade | Labels may be prepared, but no Ads event is emitted until an authoritative workflow is connected. |
| Payment method selection | Existing UI event; it is not mapped to a conversion action by default. |

Duplicate browser dispatch is suppressed with stable event IDs in session state. Purchase events also carry the stable payment event identity as the Google `transaction_id`, allowing Google Ads transaction deduplication. A browser dispatch is not proof of Google receipt; Google Ads diagnostics are authoritative for provider-side delivery.

## Diagnostics and troubleshooting

The admin diagnostics show configured IDs, action count, local test status, linker status, consent mapping, remarketing setting, and the explicit browser-only delivery limitation. They never show credentials or personal customer data.

- **Domain mismatch:** configure the same hostname the browser visits. `www.` is normalized, but staging domains require their own configured hostname.
- **No tag request:** confirm the integration is enabled, the destination ID/actions are valid, and marketing consent is granted. A rejection intentionally prevents script insertion.
- **No conversion:** confirm the configured label exactly matches the action, that the action is enabled, and that a real backend-success event occurred. For purchases confirm the invoice is paid and there is a successful payment. An unpaid order intentionally produces no Purchase.
- **Wrong amount/currency:** inspect the authoritative payment record. The tag never applies an FX rate. `defaultCurrency` is not used to rewrite purchase currency.
- **No remarketing audience:** confirm remarketing is enabled, advertising consent is granted, Google Ads account eligibility and policy requirements are satisfied, and Google has had time to populate an eligible audience. Dynamic remarketing is not present.
- **Tag blocked:** check browser extensions, network policy and the restrictive CSP in `cloudhost247-node/src/plugins/security.ts`; do not add broad wildcards or arbitrary script hosts.
- **Local test passes but Google shows no event:** local test does not contact Google. Use Tag Assistant and the Google Ads conversion diagnostics; ensure the correct account, destination ID and label are installed.

## Optional future server-side delivery design (not implemented)

If browser delivery later proves insufficient, retain the browser tag as the approved path until an independently reviewed server-side slice is delivered. A future server-side worker should enqueue only authoritative successful payment transitions, with a unique `(provider, payment_id, action)` idempotency key; preserve payment transaction ID, native amount/currency and safe catalog line items; and retain a bounded delivery status/history. Store OAuth refresh/client credentials and the Google Ads developer token only in the existing encrypted secret store under `CREDENTIAL_ENCRYPTION_KEY`, never in frontend config, logs or audit metadata. Require explicit admin RBAC, least-privilege Google Ads access, action resource names, and consent checks; retry only explicit transient provider errors with bounded backoff. Treat timeouts/ambiguous provider responses as reconciliation-required, not blindly retryable, because duplicate uploads distort reporting. Any Enhanced Conversions identifier must be separately approved, consented under `ad_user_data`, normalized and SHA-256 hashed server-side according to Google’s current specification; raw identifiers must not enter the generic event ledger. This design is not wired, no credentials are present, and no API delivery is claimed.

## Security and deployment

Migration `0090_add_google_ads_integration.sql` adds the provider row and extends the provider identifier constraint; apply the repository’s standard database migrations during deployment. Admin API endpoints require the existing `admin`/`super_admin` roles, use optimistic revision checks, and audit every save/test. No Google API credential is stored. CSP remains enabled and adds only the Google tag and Google conversion request hosts required by the browser integration.

No additional environment secret is required. Production activation requires an independently managed Google Ads account, an authorized administrator, a website conversion destination and labels, suitable privacy disclosures/consent, and provider-side verification. Account linking, action creation/category, campaign setup, legal review, and Google receipt are external dependencies.

## Official Google references

- Google tag setup: <https://support.google.com/google-ads/answer/7548399>
- Set up website conversion measurement: <https://support.google.com/google-ads/answer/12216226>
- Google tag / gtag.js developer guide: <https://developers.google.com/tag-platform/gtagjs>
- Conversion linker tag fundamentals: <https://support.google.com/tagmanager/answer/7549390>
- Consent Mode overview and implementation: <https://developers.google.com/tag-platform/security/guides/consent>
- Consent Mode reference: <https://developers.google.com/tag-platform/gtagjs/reference#consent>
- Enhanced conversions for web: <https://support.google.com/google-ads/answer/9888656>
- Google Ads and GA4 linking: <https://support.google.com/analytics/answer/9379420>
- Google Ads remarketing: <https://support.google.com/google-ads/answer/2453998>
