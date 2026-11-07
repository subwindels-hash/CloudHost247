# Country, language and display currency

The country picker uses a browser language's explicit region subtag as an **estimate**, not verified physical location. If the existing geo-country endpoint returns a valid supported country it may supply a network hint; the current endpoint deliberately returns no country. No third-party geolocation service or precise location permission is used. A manually selected country is saved locally and takes precedence over both hints. If there is no hint, visitors can select a country themselves.

Country selection suggests a display currency only when the rate feed offers a fresh valid rate. A currency explicitly selected by the visitor or saved to their account takes precedence. Billing is unchanged. To enable more display currencies, enable them in the WHMCS currency addon and configure the FX feed; rates are never fabricated. A failed or stale feed falls back to USD.

The Hindi and Swahili UI catalogues in `frontend/src/i18n/messages/drafts` are unreviewed drafts and intentionally not shown in the language switcher. A fluent reviewer must sign them off before adding them to `LOCALES` and `CATALOGUES`. These catalogues cover only the keys in the existing English catalogue, not every page on the site.
