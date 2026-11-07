# Internationalization and currency implementation report

**Status: incomplete; not production-ready for the requested website-wide acceptance criteria.**

## Audit findings

- The frontend has 13 UI catalogues: English, French, German, Spanish, Portuguese, Italian, Dutch, Polish, Russian, Arabic, Simplified Chinese, Japanese and Korean. They cover the small catalogue in `frontend/src/i18n/messages/en.ts`, not the whole site. The presence of a locale in the switcher does not mean complete site translation. Hindi and Swahili drafts are not enabled or reviewed.
- `node scripts/audit-localization.cjs` identifies potential untranslated static JSX text and selected attributes. At this audit it reported 3,979 potential literals across 167 files. This is a heuristic, not a count of confirmed translation defects; it excludes dynamic strings, server templates, emails and database content and may flag brand names or other non-translatable text. `--details` lists locations; `--check` fails while findings remain. Existing catalogue tests check only registered translation keys.
- Locale and currency preferences are stored in the browser, not yet saved to authenticated accounts. A country selection can now suggest a supported UI language unless a language was explicitly selected; manual currency preferences are retained. A selected country hint persists locally. No account preference synchronisation was added.
- `/api/v1/currency/geo-country` deliberately returns null. Country is estimated from a browser locale or selected manually; this is **not** reliable IP-based location.
- The existing WHMCS addon has ECB and Frankfurter provider implementations and an authenticated feed into the Node worker and database. No new provider was integrated or activated for this request, and no live connection was verified. Availability depends on the deployed addon, configured providers, enabled currencies, credentials/configuration and worker; a provider may not cover every requested currency, including NGN. No static production rates were added.
- The current FX system is display-only: current validated snapshots are required, estimates are labelled, and USD remains the default billing currency. Frontend display estimates currently use JavaScript floating point; the separate exact BigInt money/snapshot core is not wired into checkout. Existing commerce, store, gateway, billing, subscription and refund paths were not converted to a new settlement model. Other financial flows also require an independent decimal-safety audit. Historical orders and invoices must not be silently revalued.
- Only some catalogue/cart/homepage surfaces use the display estimate component. Many other surfaces, notifications and emails do not. This does not meet website-wide conversion or no-mixed-currency acceptance criteria.

## Changes in this work

- Added country-to-language suggestions for supported UI catalogues, respecting an explicit local language choice, and local persistence of a manually selected country hint.
- Corrected currency mappings for Guinea-Bissau, Croatia, Bulgaria and Venezuela; mapped currencies still require current rates before use.
- Added a repeatable static JSX coverage inventory and a partial browser simulation spec using mocked exchange rates. These do not claim full translation coverage or a live provider.
- No production gateway, financial database migration, settlement currency, product base price or live provider was changed.

## Verification

- Full project build and TypeScript lint passed.
- 128 targeted unit/frontend/integration tests passed, including isolated exact-money and snapshot tests, in-memory database feed tests, locale and currency UI tests. These tests do not establish end-to-end settlement or full localization.
- Four new browser simulation tests were attempted using the bundled Chromium executable; all failed before browser launch because `libnspr4.so` is missing. The tests use fixture rates and do not test a real provider. Country/IP simulation and real browser acceptance remain unverified.

## Remaining production blockers

1. Extract and translate site-wide UI, dynamic product/content records, errors, notifications, checkout and emails into reviewed catalogues; preserve originals and technical/legal terms, implement content fallback and meaningful coverage gates. The current localization selection does not satisfy full translation.
2. Configure a trustworthy country signal at a verified proxy boundary or an approved IP lookup provider; document privacy, failure and cache behaviour. Do not trust arbitrary forwarded headers.
3. Select and configure a live provider that actually covers required currencies, including NGN, and verify provider source, precision, refresh, staleness and failure handling in staging. Complete WHMCS and Node deployment configuration; never invent rates.
4. Design and implement authenticated account preferences with validation, precedence and cross-device synchronization.
5. Complete server-authoritative decimal-safe quote, checkout confirmation and gateway settlement with immutable rate provenance, explicit settlement disclosure, order/invoice/refund/subscription invariants and migrations; test every payment gateway with provider sandboxes. Do not silently re-price or convert historical financial records.
6. Apply appropriately labelled conversions throughout public and private surfaces without changing invoice or payment history. Test pricing, discounts, shipping, taxes, mixed currencies and checkout against the server.
7. Install browser dependencies, configure staging services, then run real browser locale/country tests and full backend/payment/invoice/provider acceptance tests. None of the requested end-to-end production acceptance criteria is claimed complete by this report.
