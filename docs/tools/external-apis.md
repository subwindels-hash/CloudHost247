# External services and third-party APIs

Every external dependency is optional, registered by an administrator, and
reported honestly when it is missing. Nothing in this module ships a hard-coded
API key, and no result is invented to fill a gap.

## DNS

| Service | Protocol | Notes |
| --- | --- | --- |
| Registered resolvers | UDP 53, TCP 53, DoT 853, DoH 443 | Registry in `dns_resolvers`; each row states its real protocol and version. DoH goes through `HttpFetcher`, so the SSRF policy applies. |
| System resolver | `dns_get_record`/socket | Used when no resolver is chosen; `dns_get_record` capability is detected. |

## IP intelligence, WHOIS and ASN

| Provider | Key | Data | Failure mode |
| --- | --- | --- | --- |
| ipinfo | `ipinfo` | Geo, ASN, hostname | `CONFIGURATION_REQUIRED` when unset; `PROVIDER_ERROR` on HTTP failure |
| IPWhois / ipwhoapi | `ipwhoapi` | Geo, ASN | same |
| WHOIS | none (TCP 43) | Registration data | `SERVICE_UNAVAILABLE` when port 43 is blocked; registry referral chains are followed within a bounded depth |
| Team Cymru-style ASN text services | none | ASN/prefix data | Only via the registered endpoint pattern; nothing is assumed |

## Email authentication

| Data | Source | Notes |
| --- | --- | --- |
| SPF/DKIM/DMARC/BIMI/MTA-STS records | DNS TXT | Parsed locally; DKIM keys are extracted from the published TXT record and the key size is reported |
| SMTP | `smtp` / `cpanel_smtp` integrations | STARTTLS or implicit TLS, EHLO, AUTH LOGIN; the probe never sends a message. Submitted credentials are discarded with the request |

## Domain availability and marketplace

| Provider | Key | Notes |
| --- | --- | --- |
| GoDaddy | `godaddy` | Availability and marketplace data |
| Sedo | `sedo` | Domain search/marketplace |
| Gandi | `gandi` | Domain availability where the account supports it |

When none is configured, `domain/search` returns `CONFIGURATION_REQUIRED` and
explains how to configure one. `domain/punycode` works offline.

## SSL / TLS

| Source | Notes |
| --- | --- |
| Direct TLS probe | The certificate chain is fetched from the target with `openssl`/stream sockets; issuer, validity, SANs, chain and protocol are reported from the actual handshake. No certificate transparency API is required. |

## DNS blocklists (IP reputation)

Zones are administrator-registered rows (`dnsbl.*` keys, see `providers.md`).
Each lookup is a real DNS query against the zone; the zone's own reply code is
reported with its documented meaning. No list is hard-coded and no verdict is
guessed.

## AI explanations

| Provider | Key | Constraint |
| --- | --- | --- |
| OpenAI | `openai` | Explanations are generated **only** from the structured result the service produced. If the provider is not configured the explanation is omitted and the UI says so, rather than writing prose that implies data. |
| Anthropic | `anthropic` | same |

Prompts contain result fields, never credentials, never full submitted bodies
and never personal data beyond what the result itself already displays.

## Rate limits, retries and terms

* Third-party calls are made through `HttpFetcher`/`ProviderBridge` with the same
  timeouts, size caps and TLS policy as every other request, and failures are
  retried within a bounded budget only.
* The tool page states which provider answered and links to its own documentation
  for terms and quota when the tool depends on it.
* Provider quotas and terms are the operator's responsibility: the module names
  the provider rather than hiding it, so a deployment can be audited.
