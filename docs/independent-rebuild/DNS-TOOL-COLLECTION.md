# DNS and network tool collection — reference inventory, coverage and honest status

The brief asks for the whole dnschecker.org tool inventory to be audited and completed, and for the
network tools to return **real** results or **honest errors**, never fabricated ones. This document
records the comparison, the coverage conclusion, what was verified and what could not be verified in
the build environment.

## 1. The reference inventory

`https://dnschecker.org/all-tools.php` was fetched (both chunks). Its tabs and entries:

| Tab | Entries | Examples from the page |
|---|---:|---|
| DNS | 14 | DNS propagation, DNS lookup, CNAME, NS, MX, SPF, DMARC, DKIM, DNSKEY, DS, reverse IP, DNS health/validation, DMARC generator |
| IP | 22 | IPv4/IPv6 lookup, my IP, IP location, IP WHOIS, reverse IP, IPv4↔IPv6, CIDR, subnet, IP blacklist |
| Developer | 14 | HTTP headers, redirect checker, URL/JSON/Base64/hash/text tools, email verification |
| Designer | 4 | colour conversions |
| Webmasters | 6 | broken links, robots, SERP preview, PageRank, punycode |
| Network | 4 | port check, MAC lookup/generation, ASN |
| Cyber Security | 4 | password generator and strength, SSL check, QR generate/scan |
| Productivity | 20 | word count, notepad, ROT13, Morse, date and percentage calculators, QR tools |
| Gaming | 1 | Minecraft colour codes |

The brief's own checklist (DNS records, validation, health, reverse IP, DMARC generation, IPv4/IPv6,
CIDR, geolocation, HTTP headers, URL/JSON/Base64/hash/text/email, colour and webmaster utilities,
port check, MAC, ASN, SSL, password, QR, word count, notepad, ROT13, Morse, domain checks) is the
same set, described by function. It is a representative checklist, not a licence to omit entries —
so the comparison was done entry by entry rather than by category.

## 2. Coverage conclusion

**Every reference entry maps to at least one tool in this repository's PHP catalogue.** The catalogue
is a superset: 116 tools, of which 25 are DNS, 23 IP, 4 network, 8 cybersecurity, 22 developer, 6
webmaster, 23 productivity, 4 designer and 1 gaming. The mapping is listed tool-by-tool in
[`docs/TOOL-AUDIT.md`](../TOOL-AUDIT.md) Appendix A, and the app publishes 68 of the same
capabilities at `/tools/<slug>`.

So the remaining work in this group is **not** slug coverage. It is behaviour: does a tool return a
live answer, and does it fail honestly when it cannot.

## 3. What was verified, and how

### 3.1 Structural (verified here)

| Check | Result |
|---|---|
| Every `server`-mode catalogue entry has a case in `Engine::dispatch()` | 50 / 50 — none missing |
| Every `local`-mode entry has an implementation key in `templates/cloudhost247/js/tools-local.js` | 66 / 66 — none missing |
| Rate limiting is applied to every server-mode tool | `Engine::run()` applies `Guard::rateLimit` before dispatch, 30/min default, 8/min for the heavy handlers, HTTP 429 on refusal |
| SSRF protection on every outbound connection | `Guard::resolvePublic()` rejects private, loopback, link-local, CGNAT, multicast, documentation and IPv6 ULA/link-local destinations; `Net::curl()` pins the connection to the resolved address with `CURLOPT_RESOLVE`, disables redirect following, restricts to HTTP/HTTPS and verifies TLS |
| Port probing restricted to authorised targets | One public host and one port per request, public-address rule enforced first; SMTP limited to 25/465/587 and sends no credentials |
| Server refuses browser-only tools | `Engine::run()` returns an error for any `local` slug and logs `local-rejected`, so a secret never reaches the server |

### 3.2 Live DNS (partially verified here)

The shell queries DNS-over-HTTPS with `Accept: application/dns-json` and walks a provider list,
reporting the resolver that answered, the elapsed time and the RCODE:

- **Google Public DNS answered a live query from this environment** —
  `https://dns.google/resolve?name=example.com&type=A` → HTTP 200, RCODE 0,
  `A=172.66.147.243,104.20.23.154`. That confirms the URL shape, the request header and the JSON
  fields `Net::doh()` parses (`Answer[].name`, `.type`, `.TTL`, `.data`, `Status`).
- **Cloudflare, Quad9, OpenDNS and AdGuard resolve publicly** (verified with `dns.lookup` against
  8.8.8.8: `104.16.248.249`, `9.9.9.9`, `146.112.41.2`, `94.140.15.15`) but their HTTPS endpoints are
  **blocked from this build sandbox** — the TLS handshake is reset before it completes. The same is
  true of `ipwho.is` and `rdap.org`, the two APIs behind IP location and WHOIS.

That is an environment limitation, not a defect, and it exercises the exact path the code is written
for: the provider loop moves to the next resolver, and when every provider fails the tool returns the
transport failure rather than an invented answer. **Live verification of the other four providers
belongs in staging**, where egress is open.

### 3.3 Failure behaviour (read from the code, asserted where a test exists)

| Situation | What the tool returns |
|---|---|
| Resolver unreachable | The last provider's transport error, with `ok: false` — never an empty success |
| Domain resolves to nothing | `No <TYPE> records in the response.` plus a note that "an empty answer is not the same as a transport failure" |
| Non-public destination | `The destination is not a public address.` (and an `ssrf-block` log line) |
| Private IPv6 range | Refused by `Guard::isPublicIp()` (fc00::/7, fe80::/10, ff00::/8, `::`, v4-mapped re-checked) |
| Rate limit exceeded | HTTP 429, `Rate limit reached. Wait a minute and try again.` |
| Unknown slug or disabled tool | `This tool is not available.` |
| Handler throws | Logged, and `The check could not be completed.` — no partial result is presented as complete |

The health checker is the one that matters most for honesty: each sub-check reports
`PASS`, `WARNING`, `ERROR`, `NOT_CHECKED` or `UNKNOWN` with its own explanation, so a check that
could not run is never rounded up to a pass.

## 4. What the app adds

The Node platform serves 68 slugs over `/api/tools/*`, including `dns-lookup`, `dns-propagation`,
`dns-health`, `mx-lookup`, `spf-checker`, `dmarc-checker`, `dmarc-generator`, `dkim-checker`,
`bimi-checker`, `dnskey-lookup`, `ds-lookup`, `reverse-dns`, `reverse-ip`, `ip-lookup`, `my-ip`,
`ip-whois`, `domain-to-ip`, `ip-to-hostname`, `isp-lookup`, `ip-converters`, `subnet-calculator`,
`ping`, `traceroute`, `port-checker`, `mac-lookup`, `mac-generator`, `asn-whois`, `ssl-checker`,
`ip-blacklist` and `domain-health`. Their guard rails live in `src/tools/core/`: an SSRF policy, a
capability registry, a rate limiter and a run-history store. Coverage of those paths comes from
Vitest (`tests/integration/dns-api.test.ts`, `dns-propagation.test.ts`, `tools-api.test.ts` and the
remaining `tests/integration/**` suites).

## 5. Remaining gaps in this group

1. **Live verification of four of five DoH providers** — blocked by sandbox egress (§3.2). Must be
   run from staging before this collection is called verified.
2. **The PHP behaviour suite has not run against this branch** — no PHP binary here; the suite
   (`tests/tools/run.php`) includes the hand-built DNS wire-packet tests and the cache/rate-limit
   assertions, and runs in CI on PHP 7.4 and 8.2.
3. **Two DNS stacks coexist** (a PHP DoH client in the shell, a TypeScript client in the app). They
   were checked to agree on the tool list and on URL paths, but they are two implementations of the
   same idea; unifying them is part of the catalogue-consolidation blocker recorded in
   [`docs/TOOL-AUDIT.md`](../TOOL-AUDIT.md) §9.
4. **Port scanning is deliberately minimal** — one port, one public host, rate limited. A tool that
   sweeps ranges would be an abuse vector and is not offered.

## 6. Reproducing the checks

```bash
# Coverage: every server-mode tool has a handler, every local-mode tool an implementation
cd /home/user/CloudHost247
python3 - <<'PY'
import re
src = open('config/tools.php').read(); engine = open('tools/lib/Engine.php').read(); js = open('templates/cloudhost247/js/tools-local.js').read()
handled = set(re.findall(r"case '([a-z0-9_]+)':", engine))
slugs = [(m.start(), m.group(1)) for m in re.finditer(r"'slug' => '([a-z0-9\-]+)'", src)]
missing = []
for i, (pos, slug) in enumerate(slugs):
    block = src[pos:(slugs[i+1][0] if i+1 < len(slugs) else len(src))]
    mode = re.search(r"'mode' => '(server|local)'", block); handler = re.search(r"'handler' => '([a-z0-9_]+)'", block)
    if not mode or not handler: continue
    if mode.group(1) == 'server' and handler.group(1) not in handled: missing.append((slug, 'no dispatch case'))
    if mode.group(1) == 'local' and handler.group(1) not in js: missing.append((slug, 'no browser implementation'))
print('gaps:', missing or 'none')
PY

# Live resolver reachability (staging, where egress is open)
curl -s -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=example.com&type=A'
curl -s -H 'accept: application/dns-json' 'https://dns.google/resolve?name=example.com&type=A'
curl -s -H 'accept: application/dns-json' 'https://dns.quad9.net/dns-query?name=example.com&type=A'

# PHP behaviour suite (CI / staging: PHP 7.4 and 8.2)
php tests/tools/run.php
```
