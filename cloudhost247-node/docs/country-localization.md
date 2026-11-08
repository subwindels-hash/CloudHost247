# Country localization

The Node site's `/api/v1/currency/geo-country` uses the local `geoip-lite` GeoLite2
IP database. It does not send visitor addresses to a geolocation service, return an
address in the response, or cache a country in shared caches. IP location is an
estimate (VPNs and mobile networks can affect it), not proof of residence.

Detection is deliberately **off by default** until the deployment's network boundary
is configured. Set `VISITOR_IP_MODE=direct` only when the application accepts direct
public visitor connections with no reverse proxy. Behind a reverse proxy set
`VISITOR_IP_MODE=trusted-proxy` and `VISITOR_IP_TRUSTED_PROXIES` to the verified
proxy IP addresses/CIDRs (comma-separated). Configure each proxy to sanitize and
append `X-Forwarded-For`; never trust all sources. Restart the application after
changing configuration. With an unknown client IP, missing database, or invalid
proxy chain, the site falls back immediately to a valid region in the visitor's browser
language settings, when available. Browser settings are only an estimate and may not
match the visitor's physical location. If neither signal provides a country, the
read-only indicator says Country unavailable. The Arena preview has its own
proxy and does not automatically establish that trust boundary, so it uses the browser
fallback unless IP detection is explicitly configured.

The npm package's bundled GeoLite data can be old. Before enabling detection and
regularly thereafter, update it as described in `node_modules/geoip-lite/README.md`
using your own MaxMind GeoLite account and license key; restart the app after an
update. Ensure this step runs for each deployment/install. GeoLite2 data is subject
to MaxMind's license and attribution requirements.

A country selects a default language where the site has a supported catalogue and
suggests a display currency only where a current verified exchange rate is available.
Explicit language/currency choices still win over automatic detection, and billing
continues in USD. The country indicator is read-only and ignores any previously saved
manual country. Language and display-currency choices remain independent, and saved
account currency preferences remain honored.
