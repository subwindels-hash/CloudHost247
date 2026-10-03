# Tools Center — security model

A tools suite is, by nature, a set of endpoints that fetch URLs, open connections and resolve names
on behalf of whoever asks. That makes it the most SSRF-prone part of any hosting platform, so the
rules below are enforced centrally rather than per tool.

## 1. SSRF protection (`src/tools/core/ssrf.ts`)

Every outbound action — HTTP fetch, TCP connect, DNS query for a URL-derived host, TLS handshake —
resolves the target first and refuses it unless it is a normal, globally routable address.

**Hostnames rejected outright:** `localhost`, `localhost.localdomain`, `ip6-localhost`, `ip6-loopback`,
`metadata`, `metadata.google.internal` and the other entries in `BLOCKED_HOSTNAMES`; bare names with
no dot; anything that is not a valid DNS label sequence.

**IPv4 ranges blocked** (`IPV4_BLOCKED_RANGES`): `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`,
`127.0.0.0/8`, `169.254.0.0/16` (link-local / cloud metadata), `172.16.0.0/12`, `192.0.0.0/24`,
`192.0.2.0/24`, `192.88.99.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`,
`203.0.113.0/24`, `224.0.0.0/4`, `240.0.0.0/4`, plus `255.255.255.255`.

**IPv6 forms blocked:** `::`, `::1`, `64:ff9b::/96` (NAT64), `100::/64`, `2001::/32` (Teredo),
`2002::/16` (6to4), `2001:db8::/32`, `fc00::/7`, `fe80::/10`, `ff00::/8`, and any IPv4-mapped or
IPv4-embedded address whose embedded IPv4 falls in a blocked range (so `::ffff:127.0.0.1` and
`64:ff9b::a00:1` are both refused).

The guard applies to the *resolved* address, not just the literal in the URL, and again after
redirects: a public hostname that resolves to a private address is refused with `TARGET_BLOCKED` and
the reason text is shown to the caller. `fetchWithGuard` also enforces a timeout, a maximum response
size and a redirect limit, and rewrites the `User-Agent` so a hosted server is never mistaken for a
browser.

## 2. Rate limiting and abuse blocking (`src/tools/core/rate-limit.ts`)

Four independent scopes are checked before a tool runs, sliding one-minute windows:

| Profile | IP | Account | User | Global (per tool) |
| --- | --- | --- | --- | --- |
| `light` — pure computation (parsers, converters, counters) | 90 | 240 | 180 | 3000 |
| `standard` — a few DNS/registry queries | 30 | 90 | 60 | 1500 |
| `heavy` — fan-out to many resolvers, multiple outbound requests | 12 | 36 | 24 | 600 |
| `restricted` — expensive/abusable (blacklists, OCR, speed test) | 5 | 15 | 10 | 200 |

Counters live in `tool_rate_limits`; rejections are recorded in `tool_abuse_events`. When an IP
exceeds `tools.abuse_block_threshold` rejections within an hour it is blocked from diagnostic tools
for `tools.abuse_block_minutes` (`abuseBlockState`), and the block is itself recorded. Rate-limit
rejections return `429 RATE_LIMITED` with retry guidance, never a silent success.

Anonymous callers are limited by IP and by a coarse account bucket; signed-in callers additionally by
user id, so one noisy customer cannot exhaust a shared pool for everyone else.

## 3. Credential handling

* Provider secrets are stored as AES-256-GCM envelopes in `tool_provider_configs` using the
  deployment key ring (`src/lib/keyring.ts`, `src/lib/crypto.ts`). The plaintext never leaves the
  service layer.
* No endpoint returns a credential. `toProviderView` exposes only booleans
  (`needsCredentials`, `hasCredentials`) and non-secret configuration.
* Without a key ring, saving a credential fails with `CONFIGURATION_REQUIRED` telling the operator to
  set `CREDENTIAL_ENCRYPTION_KEY`. There is deliberately no plaintext fallback.
* `src/tools/core/redact.ts` scrubs secrets from anything that is logged or echoed in an error.

## 4. Input handling

* All tool input passes the shared validation helpers in `src/tools/core/validation.ts`
  (`inspectDomain`, `parseUrlInput`, `parseCidrInput`, `parsePortInput`, `parseBoundedInteger`,
  `sanitizeUntrustedText`, `asDataBlock`) rather than ad-hoc parsing.
* Untrusted text that came from a remote server (page titles, headers, DNS TXT data, OCR output) is
  sanitized before it is stored or rendered, and the SPA never injects it as HTML.
* Payload caps are explicit: e-mail header analysis accepts 512 KB, port lists are bounded,
  propagation/blacklist fan-out is bounded by the resolver/provider tables, the speed test is capped
  by settings, and outbound fetches have a byte ceiling.
* Any tool that could be used to probe a third party (SMTP recipient check, port scan, blacklist
  lookup) requires an explicit acknowledgement field and states the restriction in its notes.

## 5. Authorization

* Public tools run without a session only while `tools.anonymous_access` is true.
* `authRequired` tools, and every portal route (history, favorites, reports, monitors), require a
  valid token — enforced by `authenticate()`, not by the UI.
* Admin routes call `requireRole(['admin', 'super_admin'])` on every handler.
* Ownership is enforced in SQL (`WHERE user_id = $1`); another account's report or monitor yields
  `404`, not `403`, so the API does not confirm that an object exists.
* Tool overrides can raise a tool's visibility (`public` → `customer` → `admin`), and the change is
  enforced on the next request without a deploy.

## 6. Audit logging

`auditRequest` / `recordAudit` write to the platform's `audit_logs`: tool overrides, provider saves,
resolver changes, cache clears, sweeps, report saves and ticket creation. In addition,
`tool_execution_logs` is append-only and records the tool, caller, target, status and duration for
every execution (subject to the tool's `loggingEnabled`), which is the source of the admin metrics
and of any "what did this customer actually run" investigation.

## 7. No fabrication (integrity as a security property)

Several rules exist because a plausible-but-wrong answer is a security problem on a hosting platform:

* A blocked or refused DNSBL lookup reports `ERROR`/`UNKNOWN`, never "listed" or "clean".
* A `403`/`429` from a link checker is reported as *refused*, never as a broken link.
* Header analysis reports evidence and *never* declares a message spam or not-spam.
* Domain availability is never asserted without an authoritative registry answer.
* The SMTP tester has no `DATA`/send mode at all — it can never deliver mail.
* ICMP-only tools degrade to a labelled TCP fallback or refuse outright; they never invent a route.
* Result explanations in `core/explain.ts` are generated from the result that was actually returned.

## 8. Reporting a problem

If you find a bypass (an SSRF vector, an unauthenticated admin action, a credential leak), treat it as
a platform incident: the central chokepoints to check first are `core/ssrf.ts`, `core/rate-limit.ts`,
the `sendToolFailure` error path in `src/tools/routes.ts`, and anything that logs a provider row.
