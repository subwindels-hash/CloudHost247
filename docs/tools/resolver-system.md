# Resolver system

DNS answers come from the module's own wire client and a registry of resolvers.
There is no dependency on a PHP DNS extension being able to do what the user
asked for, and no answer is ever invented.

## Components

* `lib/Dns/DnsClient.php` — builds and parses DNS messages (RFC 1035) for the
  record types the platform needs (A, AAAA, CNAME, MX, NS, PTR, SRV, SOA, TXT,
  CAA, DS, DNSKEY, NAPTR), over:
  * **UDP** with an automatic **TCP** retry when the answer is truncated (TC bit);
  * **DoT (DNS over TLS)** on 853 where enabled;
  * **DoH (DNS over HTTPS)** through `HttpFetcher` (so the SSRF policy applies),
    with `application/dns-message` or JSON where the provider requires it.
  The protocol field on a resolver is authoritative: the client only uses a
  protocol the resolver is registered with, and never claims a protocol works
  because it is theoretically possible.
* `lib/Dns/ResolverPool.php` — chooses resolvers for a request: the system
  resolver for "default", a specific resolver by id/name, or the enabled set
  ordered by `priority`. It applies `dns_timeout_seconds`, `dns_retries` and
  `propagation_resolver_limit`.
* `lib/Services/Dns/ReverseName.php` — builds `in-addr.arpa`/`ip6.arpa` names.

## Registry columns (`mod_cloudhost247_nt_dns_resolvers`)

`name`, `provider`, `ip`, `protocol` (`udp`/`tcp`/`dot`/`doh`), `version`
(`v4`/`v6`), `country`, `region`, `city`, `latitude`, `longitude`, `doh_url`,
`enabled`, `priority`, `health_status`, `last_health_at`, `last_health_ms`,
`notes`.

Locations are the resolver operator's published points of presence. They are
labels for grouping results, not a measurement of where a response came from:
anycast means the answering node can be different from the published location,
and the propagation table says so in its notes.

## Seeding

Module activation seeds a default set (public resolvers from several providers
and regions, plus the system resolver). Seeding is additive and idempotent: an
administrator's edits, disabled rows and added resolvers are never overwritten.
Every resolver can be enabled, disabled, edited, prioritised, health-checked or
deleted in **Admin → CloudHost247 Network Tools → Resolvers**.

## Health checks

`lib/Services/Shared/HealthChecker.php` runs a real A query against each enabled
resolver and records `HEALTHY`, `FAILED` or `UNKNOWN` in
`mod_cloudhost247_nt_tool_health_checks`:

* `HEALTHY` — the resolver answered a live query within the timeout;
* `FAILED` — the resolver refused, timed out or returned an invalid message;
* `UNKNOWN` — the check could not run (no network capability, no resolvers).

`UNKNOWN` is never silently upgraded to `HEALTHY`. The cron worker runs resolver
health on `resolver_health_interval_minutes` (default 15) and the admin screen
can run it on demand.

## Propagated / Not propagated / Mismatch

For each queried resolver the propagation checker records the provider, IP,
country/region/city, the value(s) returned, the status, the response time, the
error (when any) and the timestamp. Status is derived by
`PropagationService::classify()`:

| Status | Condition |
| --- | --- |
| `PROPAGATED` | The resolver answered with a value that satisfies the expected-value rule (or no expectation was given) |
| `NOT_PROPAGATED` | The resolver answered with an empty answer section |
| `MISMATCH` | The resolver answered, but nothing matched the expected value |
| `TIMEOUT` | No answer within the timeout |
| `ERROR` | The resolver returned an error (SERVFAIL/REFUSED/format error/network error) |

Match modes are `exact` (default), `contains` and `regex`. Values are compared by
meaning where that matters: IPs are compared as packed addresses (so
`2001:db8::1` equals `2001:0db8:0:0:0:0:0:1`) and TXT values are compared
without their presentation quotes.
