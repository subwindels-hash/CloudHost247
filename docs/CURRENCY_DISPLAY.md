# Display currency conversion (Node platform)

Status: implemented on branch `arena/b502d9d7-cloudhost247`. Not yet deployed to staging.

## What it does

Visitors can choose a **display currency** in the header (desktop and mobile drawer), the footer, the
catalogue and the cart. Converted amounts appear as an estimate under the USD amount. The choice is
stored in the browser under `ch247.currency`, separate from the language choice.

**Billing does not change.** Every price, cart line, order, charge and invoice remains in USD
(`DEFAULT_CURRENCY` in `cloudhost247-node/src/config/billing.ts`). Conversion only changes how an
amount is displayed.

## Where the rates come from

The only source is the WHMCS currency addon (`modules/addons/cloudhost247_currency`):

1. The addon's cron runs an update. ECB or Frankfurter rates get the addon's margin and rounding.
   Results are stored in `mod_cloudhost247_currency_rates` with a run id and an observation time.
2. `modules/addons/cloudhost247_currency/display-feed.php` publishes the latest **successful** run,
   for the currencies the operator has **enabled** in the addon. It is read-only and needs a bearer token.
3. The Node worker pulls the feed every 30 minutes (`syncDisplayRates`, `src/services/fx-service.ts`) and
   stores each run in `display_fx_rates` (migration `0083_create_display_fx_rates.sql`).
4. `GET /api/v1/currency/rates` (public, cached 5 minutes) reports which currencies may be shown,
   with the rate timestamp.

The rate used is the addon's **effective** rate (provider rate plus margin), the same value the addon
writes to `tblcurrencies.rate`. Display amounts therefore agree with WHMCS.

No rate is ever typed in, guessed, or taken from the browser. The site never shows a symbol without a
valid, current rate.

## Fallback rules

- No successful sync yet, feed unreachable, feed invalid, or newest rate older than `FX_MAX_AGE_HOURS`
  (default 48): only USD is offered. The switcher says other currencies are unavailable.
- A saved choice is honoured only while the current status still offers it. Otherwise USD is used.
- A non-USD amount is never converted.
- Plain-http feeds are refused in production.

## Configuration

Node (`.env` / hosting environment):

| Variable | Purpose |
| --- | --- |
| `FX_FEED_URL` | HTTPS URL of `display-feed.php` on the WHMCS host. |
| `FX_FEED_TOKEN` | Bearer token, at least 16 characters. Must equal the WHMCS setting below. |
| `FX_MAX_AGE_HOURS` | Maximum age of the newest rate before it is withheld. Default 48. |

WHMCS: add a row to `mod_cloudhost247_currency_settings` with `setting_key = 'display_feed_token'` and
`setting_value` equal to `FX_FEED_TOKEN`. An empty value disables the feed (HTTP 503). Rotate the token
in both places together.

The worker process (`npm run worker`) must be running for rates to sync. Without it the site stays on USD.

## Where conversion is shown

- Catalogue plan prices (`ProductPlansSection`).
- Cart subtotal and line totals (`CartPage`).

Not converted yet: invoices, the payment modal, the dashboard, admin screens, and checkout totals on the
payment step. Those keep showing USD only. Extending them uses the same `ApproxAmount` component.

## Limits and open items

- The PHP feed is **not executed by the Node test suite**. PHP is not installed in the build sandbox, so it
  has passed no `php -l` or runtime check here. Verify it on the WHMCS host before relying on it.
- The feed authorises with the `Authorization` header. Some Apache/CGI setups strip that header. The
  endpoint also reads `REDIRECT_HTTP_AUTHORIZATION`. If neither is set, the feed returns 401.
- The rate-disclaimer wording (`currency.switcher.note`) needs legal review before launch. It says the
  charge is in USD, converted amounts are estimates, and the card issuer's rate may differ. It makes no
  other legal claim.
- Currencies are the ones the addon has enabled. Changing that list in WHMCS changes what the site offers.
