# Tools Center security boundaries

This document describes controls in source and the regression coverage, not a
penetration-test certification. See VERIFICATION.md for exactly what ran.

## Input and outbound network

The Node executor and handlers remain the public execution boundary. Existing
PHP compatibility endpoints are preserved, not newly promoted as network proxies.
Domain/IP/URL handlers use strict schemas, bounded inputs, explicit record types
and fixed executables/arguments where the existing ping/traceroute service uses
OS capabilities. No arbitrary shell command or user-supplied executable is added.

`src/tools/core/ssrf.ts` rejects loopback, private, link-local, metadata, multicast,
reserved and documentation ranges, including IPv4-mapped IPv6 and unsafe transition
ranges. URL schemes/credentials/ports and private hostname namespaces are checked.
Every DNS answer must be public. The connection pins the validated address while
preserving hostname/SNI verification, preventing DNS rebinding between validation
and dial. Every redirect is independently revalidated and hop-bounded.

This change repairs compressed-IPv6 parsing/formatting, rejects additional IPv6
reserved ranges, hashes unmodified cache inputs, adds a whole guarded-fetch deadline
(including DNS and redirects), bounds DNS resolution, and caps compressed **and
decompressed** responses. Incomplete/errored HTTP streams fail instead of returning
partial data as a success. TLS verification is not disabled globally: certificate
inspection retains the existing explicit diagnostic mode and its limitations.

Domain WHOIS reuses Domain Services. Its RDAP bootstrap and registry requests now
opt into the same guarded transport (HTTPS, bounded response/redirects/deadline).
The IANA WHOIS referral fallback validates/pins public addresses, uses port 43 only,
a 10-second socket deadline and 256 KiB response cap; interrupted reads fail. Only
public registrar/dates/status/nameserver fields are exposed/persisted. Registrant
privacy protection is not bypassed. Tests may substitute an explicitly registered
transport; those fixtures are not production results.

## Rates, authorization and resource limits

Existing database-backed per-minute limits remain (IP / user / account / tool):

| Class | Limits |
|---|---|
| light | 90 / 180 / 240 / 3000 |
| standard | 30 / 60 / 90 / 1500 |
| heavy | 12 / 24 / 36 / 600 |
| restricted | 5 / 10 / 15 / 200 |

Fastify's global limiter, abuse events/temporary blocks, executor audit/history,
provider timeouts and existing ownership checks remain. Customer/admin visibility
implies authentication regardless of an operator's other settings. An ACTIVE
operator override cannot bypass capability/provider readiness. Private menus are
not a security boundary: authorization is rechecked by the server.

Speed download/upload/config have tighter raw-route limits (10/minute; latency
30/minute), operator disablement/auth checks, fixed maximum payloads and no-store.
The browser transfers at most 2 MiB each way, honors lower server caps and aborts
within the configured budget (30-second client ceiling). It reports actual timing
and transferred bytes, not a fabricated or server-egress “visitor speed”. Protect
uploads at the edge too (body size/read deadline); per-process HTTP limits alone
are not a distributed volumetric-DDoS defense. The existing DB executor rate
limits are shared; raw transfer HTTP rate limits are per-process.

Reverse-proxy trust is operationally critical: isolate Node from the public network
and overwrite forwarding headers at the trusted edge. Do not accept arbitrary
client-supplied forwarding chains. Enforce egress firewall policy as defense in
depth, including blocking infrastructure/metadata ranges independently of Node.

## Caching and privacy

Execution HTTP responses use no-store; database result caching is separate.
Cache keys use SHA-256 over the **entire**, case/whitespace-preserving input key,
with the tool slug; no lowercase/truncation collision. Cache values remain in the
existing TTL-backed `tool_cache` table. Only successful responses are cached;
errors do not become lookup results. Refresh bypasses reads, not rate limits.
Default-zero-cache and ownership-dependent tools cannot be made cacheable by an
admin TTL override. Authenticated/private cache entries are user-scoped. Existing
sensitive-input tools (passwords, text, QR credentials, etc.) retain zero TTL.

Keys are hashes, not encryption: restrict database access and retention as before.
History uses the existing limited result summary; reports are explicit user actions
and ownership-scoped. Recent browser data stores only eight slugs. No submitted
text, password or diagnostic result is added to browser history/localStorage by
this change. Wi-Fi QR output does contain the requested credentials and must be
handled as a secret. QR contents are displayed, not followed as URLs or executed.

## Presentation and PHP integration

React escapes result values; native navigation uses `textContent`/DOM construction,
not `innerHTML`. PHP/Smarty output is escaped. Only generated registry paths are
accepted by the adapter; arbitrary repository/PHP files are not routed as tools.
No localStorage bearer is sent from the WHMCS embedded context. CSRF, WHMCS
sessions, checkout, authorization, provider encryption and release integrity gates
are retained. Public tools do not impersonate a WHMCS client in Node.

Existing CSP/helmet protections remain on production APIs and static/SPA responses.
Only the explicit development harness relaxes frame embedding for preview. No
credential, token, result fixture or fake provider is added as a production default.

## Required staging checks

Run blocked-target/redirect/rebinding, malformed/oversized/compressed-response,
provider outage, auth/ownership, rate/abuse and cache-isolation regressions after
proxy/provider changes. Check IPv4 AND IPv6 egress on the deployment. Confirm
operator-disabled tools disappear from both menus and cannot run via raw endpoints.
Verify that rendered WHMCS forms are public-only, that Node auth handoffs do not
cross identities, and that the edge does not cache user-specific API responses.
Licensed WHMCS/live provider checks are not substituted by local template tests.
