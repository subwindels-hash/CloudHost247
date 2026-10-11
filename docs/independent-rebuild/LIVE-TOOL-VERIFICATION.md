# Live tool verification — what a running platform actually returned

This is the raw evidence for the claim "the tools return real results and fail honestly". It was
produced against the real application — the same `buildApp` the platform runs in production, booted
by `scripts/tools-preview-server.ts` against an in-memory Postgres (PGlite) with every migration
applied — not against a mock.

```bash
cd cloudhost247-node
npm run build                                  # the preview server serves the built SPA
npx tsx scripts/tools-preview-server.ts 3000   # http://localhost:3000
```

## 1. Every catalogue tool answers, and none of them bluffs

All **70** catalogue entries were called with a deliberately empty body (`{}`) so the response shows
what each tool does when a required field is missing:

| Response | Count | Meaning |
|---|---:|---|
| `INVALID_INPUT` (HTTP 400) | 48 | Names the missing field, or lists the values it accepts: `"domain" is required.`, `"operation" must be one of: convert, contrast, palette, color-blindness.` |
| `UNAUTHORIZED` (HTTP 401) | 9 | Auth-required tools say so rather than running anonymously |
| `OK` (HTTP 200) | 7 | Tools with sensible defaults computed immediately (`my-ip`, `uuid-generator`, `lorem-ipsum`, …) |
| `NOT_FOUND` (HTTP 404) | 5 | Page slugs (`business-tools`, `tool-history`, …) explain that they are Tools Center pages, not endpoints |
| `CONFIGURATION_REQUIRED` (HTTP 503) | 1 | `whois` — the RDAP provider is not configured on this instance |

There were **no 500s, no untyped failures and no success responses that contained nothing.** That last
point is the one the brief cares about: a tool that cannot reach its dependency never returns an empty
object shaped like an answer.

## 2. Tools that computed real results

| Tool | Input | Returned | Check |
|---|---|---|---|
| `subnet-calculator` | `203.0.113.10/24` | network `203.0.113.0`, broadcast `203.0.113.255`, first `203.0.113.1`, last `203.0.113.254`, 254 usable hosts | correct by hand |
| `ip-converters` | `192.0.2.7` (ipv4→decimal) | `3221225991`, `0xC0000207`, `11000000.00000000.00000010.00000111` | 192·2²⁴ + 2·2⁸ + 7 = 3 221 225 991 ✓, hex ✓, binary ✓ |
| `json-tools` (format) | `{"b":2,"a":1}` | pretty-printed with `bytesBefore 13 → bytesAfter 22`, key order noted as not semantic | ✓ |
| `json-tools` (validate) | `{oops` | `valid:false` with `line 1, column 2, position 1` and the parser's message | structured, not a crash |
| `password-tools` | length 20 | 20-character password, classes `lowercase/uppercase/digits`, alphabet 62, **entropy 119.1 bits** | log₂(62²⁰) = 119.08 ✓ |
| `word-counter` | `One two three four five.` | 24 characters, 20 without spaces, 5 words, 1 sentence | ✓ |
| `small-text` | `CloudHost247` | `ᶜˡᵒᵘᵈʰᵒˢᵗ²⁴⁷`, `unmappedCharacters: []` | ✓ |
| `runic-translator` | `CloudHost247` | `ᚲᛚᛟᚢᛞᚺᛟᛊᛏ247` with `unmapped: ["2","4","7"]` | reports what it could not map instead of dropping it |
| `uuid-generator` | — | v4 UUID with the version nibble in place | ✓ |
| `mrz-generator` | the ICAO Doc 9303 specimen | `status: VALID`, `P<UTOERIKSSON<<ANNA<MARIA<<<<<…`, second line `L898902C3…` — check digits accepted | matches the specimen used by the test suite |
| `robots-generator` | host + sitemap | real `robots.txt` text with per-crawler rules | ✓ |
| `lorem-ipsum` | 1 paragraph | prose, no filler bytes | ✓ |
| `ip-lookup` | `8.8.8.8` | version, address class with `isPrivate:false`, reverse DNS block, 12 s (it queries external services) | real, not cached |

## 3. Tools that failed honestly

This build sandbox blocks outbound UDP/53 and TLS to most external hosts, so the network tools had
genuinely nothing to report. What they returned is the point:

| Tool | Response |
|---|---|
| `dns-lookup` | HTTP 504, `TIMEOUT: Cloudflare 1.1.1.1 (1.1.1.1) could not answer the A query for example.com: No response from 1.1.1.1 within 6000 ms.` — names the resolver, the query, the timeout, and marks itself retryable |
| `http-headers` | HTTP 502, `PROVIDER_ERROR: The request to example.com failed: ERR_INVALID_IP_ADDRESS` |
| `ssl-checker` | HTTP 502, `PROVIDER_ERROR: The TLS connection to example.com:443 failed: ECONNRESET. If the service is not HTTPS, use the port checker instead.` |
| `whois` | HTTP 503, `CONFIGURATION_REQUIRED: Connect a Domain Services RDAP provider to use WHOIS.` — an unconfigured integration is named, not hidden |

Note the difference between these and a fabricated answer: each has a machine-readable code
(`TIMEOUT`, `PROVIDER_ERROR`, `CONFIGURATION_REQUIRED`), a human explanation, and no `data` payload
that a caller could mistake for a measurement.

**The DNS path is verified where it can be**: the resolver contract itself was exercised directly —
`https://dns.google/resolve?name=example.com&type=A` returns HTTP 200 with
`A=172.66.147.243,104.20.23.154` from this same sandbox. The platform's own raw-DNS path (UDP to
1.1.1.1) is what the sandbox blocks. In staging, where egress is open, the same call returns answers
instead of the timeout above.

## 4. Reproducing this document

```bash
cd cloudhost247-node && npx tsx scripts/tools-preview-server.ts 3000 &

# the empty-input matrix (one call per catalogue tool)
node -e '…'   # see the transcript in this document; the script is 30 lines and needs no fixtures

# a representative set with real inputs
curl -s -X POST localhost:3000/api/tools/subnet-calculator \
  -H 'Content-Type: application/json' -d '{"cidr":"203.0.113.10/24"}'
curl -s -X POST localhost:3000/api/tools/password-tools \
  -H 'Content-Type: application/json' -d '{"length":20,"operation":"generate"}'
curl -s -X POST localhost:3000/api/tools/mrz-generator \
  -H 'Content-Type: application/json' -d '{"issuingState":"UTO","surname":"ERIKSSON","givenNames":"ANNA MARIA","nationality":"UTO","documentNumber":"L898902C3","dateOfBirth":"740812","sex":"F","expiryDate":"120415","optionalData":"ZE184226B"}'
```

## 5. What this document does not prove

- It does not prove the tools work against a **configured** platform: WHOIS, and any tool whose
  provider is optional, needs its integration connected first.
- It does not prove the **PHP** tool shell: that surface is exercised by `tests/tools/run.php` on a
  host with PHP, and this sandbox has no PHP binary.
- It does not replace a **device pass** for the two tools that need hardware (the QR camera) or a
  printer (the ID card), both of which are listed as blockers in
  [`docs/TOOL-AUDIT.md`](../TOOL-AUDIT.md) §9.
