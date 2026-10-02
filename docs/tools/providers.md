# Providers and integrations

The module never hard-codes a third-party endpoint, key or credential. Anything
that needs one uses the existing CloudHost247 integrations centre
(`cloudhost247_integrations`), which owns the encrypted vault, the provider
registry and the connection tester.

## Two kinds of provider

1. **Integration providers** — keys managed in *Settings → APIs & Integrations*
   (`modules/addons/cloudhost247_integrations/`). Credentials live in the
   AES-256-GCM `SecretVault`; this module only stores the provider key.
2. **Tool providers** — rows in `mod_cloudhost247_nt_tool_provider_configs`,
   registered in **Admin → CloudHost247 Network Tools → Providers**. These are
   data sources that carry an endpoint, a DNSBL zone or a JSON field mapping and
   therefore no secret (for example a blacklist zone, a company-data endpoint).

A tool declares which keys it may use (`providers` in the catalogue). If it
cannot work without one (`requires_provider => true`), the runner reports
`CONFIGURATION_REQUIRED` with a link to the admin screen instead of failing
obscurely — and never returns a made-up answer.

## Seeded DNSBL zones

The IP blacklist tool queries zones that are registered as tool providers; none
are enabled by default, because "is this IP listed?" must come from a real
lookup against a real zone:

| Key | Zone | Purpose |
| --- | --- | --- |
| `dnsbl.spamhaus_zen` | `zen.spamhaus.org` | Spamhaus combined (SBL/XBL/PBL) |
| `dnsbl.spamcop` | `bl.spamcop.net` | SpamCop |
| `dnsbl.barracuda` | `b.barracudacentral.org` | Barracuda |
| `dnsbl.dronebl` | `dnsbl.dronebl.org` | DroneBL |
| `dnsbl.sorbs` | `dnsbl.sorbs.net` | SORBS |
| `dnsbl.uceprotect` | `dnsbl-1.uceprotect.net` | UCEPROTECT L1 |
| `dnsbl.abuseat` | `abuseat.org` | abuseat.org |
| `dnsbl.spfbl` | `spfbl.net` | SPFBL |

An administrator can add, edit, disable or delete zones. A listed result keeps
the zone's own reply text and its meaning is documented in the tool, because
every list has different criteria and removal procedures.

## Integration providers used

| Provider key | Used for | Notes |
| --- | --- | --- |
| `ipinfo`, `ipwhoapi` | IP geolocation / ASN enrichment | Optional. The `ip/lookup` tool works without them and says which facts came from where. |
| `whois` (TCP 43) | WHOIS lookups | No key; a capability (`whois_tcp43`) that is reported honestly when a host blocks port 43. |
| `godaddy`, `sedo` | Domain availability & marketplace search | Optional; `domain/search` reports `CONFIGURATION_REQUIRED` when neither is configured. |
| `openai`, `anthropic` | AI explanations | Optional and strictly derived from the structured result; see `security-model.md`. |
| `smtp`, `cpanel_smtp` | Platform mail relay | Used by the SMTP tester in its "CloudHost247 configured SMTP" mode so no customer credential is needed. |
| `tool.bin_lookup` | Card BIN issuer data | Administrator-registered endpoint plus a field mapping; no card number is ever stored. |

## Using a provider from a service

```php
$bridge = $this->provider();                       // Core\Integration\ProviderBridge
if (!$bridge->available('ipinfo')) {
    return ToolResult::configurationRequired('No IP intelligence provider is configured.');
}
$response = $bridge->call('ipinfo', 'GET', '/lookup/' . rawurlencode($ip), array('settings' => $this->context['settings']));
```

`ProviderBridge` resolves credentials from the vault, applies the hardened
transport (TLS verified, bounded timeout, bounded response size), records
failures for the health screen and returns provider errors as
`PROVIDER_ERROR`/`SERVICE_UNAVAILABLE` — never as fabricated data.

## Testing a provider

Each row has **Test connection** (`ConnectionTester`) and a health history
(`tool_health_checks`). A provider that fails is reported as `FAILED`, never as
`UNKNOWN`-but-working. Resolver- and provider-health runs happen on the cron
worker and on demand from the admin screen.
