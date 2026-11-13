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
* The Barcode Scanner reports that no barcode was read rather than a text it cannot vouch for: a
  symbol that fails its own check, one in a character set the runtime cannot convert, and one whose
  character set the basic decoder's library would mis-parse are all "not read", never a guess.
* Result explanations in `core/explain.ts` are generated from the result that was actually returned.

## 8. WebAssembly in the browser

The Content-Security-Policy that `src/plugins/security.ts` sends with every page has one word in
`script-src` that exists for a single tool:

```
script-src 'self' 'wasm-unsafe-eval' https://connect.facebook.net https://www.googletagmanager.com https://analytics.tiktok.com
```

**What it is for.** The Barcode Scanner page decodes in the visitor's browser. Its full decoder is
zxing-cpp compiled to WebAssembly (`zxing-wasm`, pinned to an exact version in `package.json`). It
reads twenty-one barcode types where the JavaScript decoder reads thirteen, and searches a picture
many times faster (measurements in [DESIGN-STUDIO-PLAN.md](./DESIGN-STUDIO-PLAN.md), §13). A browser
compiles WebAssembly only if the policy says it may.

**What it allows, and what it does not.** `'wasm-unsafe-eval'` lets script that is already running
on the page compile and start a WebAssembly module. It does not allow `eval()`, `new Function()` or a
string handed to `setTimeout`: those need `'unsafe-eval'`, which is not granted.
`tests/unit/spa-security-headers.test.ts` holds both halves (the word is present, `'unsafe-eval'` is
not), and `e2e/barcode-scanner.spec.ts` runs the page in Chromium under the policy the application
really sends and checks that the decoder runs, that nothing is refused, and that `new Function`
still throws. Only Chromium was used; Firefox and Safari were not tried.

**It covers every page, not only the scanner.** The site is one document that changes its own
address, so there is one policy. Any page's script may therefore compile WebAssembly. What that
costs: a WebAssembly module can do nothing the script that loaded it could not do. It has no access
to the page of its own, and where it may fetch from is still `connect-src`. Someone who cannot run
script on the page gains nothing from the word. Someone who already can (which `script-src` without
`'unsafe-inline'` and `script-src-attr 'none'` are there to prevent) gains a faster way to compute,
and no new reach.

**Where the binary comes from.** This origin, and nowhere else. The library's default is to fetch
its `.wasm` file from a public CDN; `frontend/src/lib/scan-engine.ts` overrides that with the copy
Vite puts in `/assets/` under a content-hashed name, fetched under `connect-src 'self'`. The e2e
spec fails if the page asks any other host for anything. For `zxing-wasm` 3.1.6 the file is 946,860
bytes, SHA-256 `5003fb4b88c4fbd1fd518a2fd8c8ad365c519e183a08c03a322dddfea3cea84e`; the built file in
`public/assets/` is byte-identical to the one in the package. The server never loads the library:
the API decodes with the JavaScript decoder, and a test
(`tests/unit/design-studio-barcodes.test.ts`) fails if any module other than the scanner page's two
imports it.

**Without it.** A browser that will not run WebAssembly (switched off, blocked by a proxy that
will not pass `.wasm` files, or too old to know the word) gets the JavaScript decoder instead. The page says so in a notice, marks the eight types it cannot
read there, and reads the other thirteen with the same results. Nothing else on the site uses
WebAssembly.

**To withdraw it.** Delete the word from `scriptSrc` in `src/plugins/security.ts`. The scanner page
itself needs no change: it finds out whether WebAssembly is allowed and uses the JavaScript decoder
when it is not, which is how the e2e test "where WebAssembly is refused" runs it. What must follow,
because it checks or states that the word is there:

- `tests/unit/spa-security-headers.test.ts` expects the word. CI runs this test, so it fails first.
- `e2e/barcode-scanner.spec.ts`, two tests: "runs the full decoder under the security policy the
  application sends" expects the word and the full decoder, and "where WebAssembly is refused"
  expects that taking the word out changes the policy. CI does not run the browser tests, so
  nothing reports these until someone runs them.
- The `barcode-scanner` entry in `src/tools/catalog.ts`. Its description and first two notes say
  the page reads twenty-one types; on this site it would then read thirteen. Two tests hold those
  sentences word for word (`tests/unit/barcode-scanner.test.ts`,
  `frontend/tests/unit/barcode-scanner-page.test.tsx`), and the files derived from the catalogue
  are regenerated as in [OPERATIONS.md](./OPERATIONS.md), "Adding a tool".
- This section, the scanner's paragraph in [README.md](./README.md) and §14 of
  [DESIGN-STUDIO-PLAN.md](./DESIGN-STUDIO-PLAN.md).

**What is not covered.** The WHMCS side of the site sets its own headers
(`platform/src/core/security.js`) and is unchanged. The tools bundle embedded there
(`assets/cloudhost247-tools/`) does not contain the scanner page or either decoder.

## 9. Reporting a problem

If you find a bypass (an SSRF vector, an unauthenticated admin action, a credential leak), treat it as
a platform incident: the central chokepoints to check first are `core/ssrf.ts`, `core/rate-limit.ts`,
the `sendToolFailure` error path in `src/tools/routes.ts`, and anything that logs a provider row.
