# REST API

`modules/addons/cloudhost247_network_tools/api/index.php` is the only REST
surface. It follows the repository's existing convention of a single entry point
with an explicit `route` parameter.

```
GET  api/index.php?route=dns/lookup&domain=example.com&type=A
POST api/index.php?route=dns/propagation           (fields in the JSON body)
GET  api/index.php?route=network/port-checker&host=example.com&ports=80,443
GET  api/index.php?route=list
```

`PATH_INFO` (`/api/index.php/dns/lookup`) and `?action=` are also accepted, and
`?route=ip/blacklist` resolves through the registry alias to
`security/ip-blacklist`.

## Authentication

* Set the token in **Admin → Addons → CloudHost247 Network Tools → Settings →
  API token**. An empty token disables the API entirely
  (`503 CONFIGURATION_REQUIRED`) rather than falling back to something insecure.
* Send it as `X-API-Token: <token>` or `Authorization: Bearer <token>`; the
  comparison uses `hash_equals()` and the token is never logged.
* The API never runs with a customer's session. Customer-scoped routes
  (`tools/history`, `tools/favorites`) require an explicit `client_id`, which is
  the caller's responsibility because the token *is* the authorisation.

## Response envelope

Every response — success or failure — uses the same envelope as the UI and the
service classes:

```json
{
  "success": true,
  "code": "OK",
  "message": "The tool completed successfully.",
  "retryable": false,
  "warnings": [],
  "data": { "…tool payload…" },
  "meta": { "tool": "dns/lookup", "timestamp": "2026-01-01T00:00:00+00:00", "duration_ms": 42 },
  "tool": "dns/lookup",
  "generated_at": "2026-01-01T00:00:00+00:00"
}
```

A failure carries `"data": {}` — always. Codes are the platform's vocabulary:

| Code | HTTP | Retryable | Meaning |
| --- | --- | --- | --- |
| `OK` | 200 | no | Completed |
| `PARTIAL` | 200 | no | Completed, some checks could not run (real data, stated gaps) |
| `INVALID_INPUT` | 400 | no | Validation failed |
| `AUTH_REQUIRED` | 401 | no | Sign-in required for this tool |
| `ACCESS_DENIED` | 403 | no | Token or role does not allow this |
| `TARGET_BLOCKED` | 403 | no | SSRF policy refused the target |
| `CSRF_FAILED` | 403 | no | Missing/incorrect token (UI only) |
| `NOT_FOUND` | 404 | no | No such tool or record |
| `DOMAIN_NOT_FOUND` | 404 | no | The name does not resolve |
| `TOOL_DISABLED` | 409 | no | Administrator disabled the tool |
| `MAINTENANCE` | 409 | no | Tool is in maintenance mode |
| `CONFIGURATION_REQUIRED` | 409 | no | A provider or setting must be configured first |
| `DNS_LOOKUP_FAILED` | 502 | yes | Resolver returned an error |
| `PROVIDER_ERROR` | 502 | yes | Upstream provider failed |
| `SERVICE_UNAVAILABLE` | 503 | yes | Capability or service unavailable here |
| `CAPABILITY_UNAVAILABLE` | 503 | no | The hosting environment lacks a required feature |
| `TIMEOUT` | 504 | yes | Deadline exceeded |
| `RATE_LIMITED` | 429 | yes | Slow down (limits in `rate-limiting.md`) |
| `UNKNOWN` | 500 | yes | Unexpected failure (an id is logged, internals are not returned) |

## Route map

| Area | Routes |
| --- | --- |
| `dns` | `dns/lookup`, `dns/propagation`, `dns/health`, `dns/mx`, `dns/spf`, `dns/dmarc`, `dns/dkim`, `dns/dnskey`, `dns/ds`, `dns/reverse`, `dns/reverse-ip` |
| `ip` | `ip/lookup`, `ip/whois`, `ip/my-ip`, `ip/domain-to-ip`, `ip/ip-to-hostname`, `ip/blacklist` (= `security/ip-blacklist`) |
| `network` | `network/ping`, `network/traceroute`, `network/port-checker`, `network/asn`, `network/subnet-calculator`, `network/mac-lookup` |
| `security` | `security/ssl`, `security/password`, `security/bin-checker` |
| `developer` | `developer/http-headers`, `developer/email-header`, `developer/json`, `developer/smtp-test` |
| `webmaster` | `webmaster/broken-links`, `webmaster/open-graph`, `webmaster/robots-generator` |
| `tools` | `tools/history`, `tools/favorites` (both take `client_id`), `list` |

Any registered slug is addressable; the table above lists the ones the spec
names explicitly. `GET ?route=list` returns the catalogue with each tool's
slug, name, category, fields, exports, visibility, status and rate tier.
