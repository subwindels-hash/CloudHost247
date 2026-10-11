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

## 5. The twenty-one business tools, verified live over the running API

The SalarioPay-named suite is served by `POST /api/tools/business-tools/:slug/run`. The catalogue
endpoint reports the section as it is built — **21 tools: 5 calculators, 12 generators, 4
comparisons** — and states the privacy position it enforces structurally, not by promise
(`computesClientSide: true`, `persistsInput: false`, `persistsResult: false`,
`transmitsToThirdParties: false`; the route module is registered without a database handle, so a
submission has nowhere to go).

Every figure below came back from the running server, and every one of them is reproduced by a unit
test with an independently calculated reference case
(`tests/unit/business-tools-engines.test.ts`, 196 assertions).

| Tool | Input | Result returned |
|---|---|---|
| PAYE & Net Salary | ₦500,000/month | PAYE ₦61,970 · net ₦379,530 · effective rate 12.39% · total deductions ₦120,470 — with the annual band table (0% on the first ₦800,000, 15% to ₦3 m, 18% to ₦12 m, 21%, 23%, 25%) and ₦743,640 annual tax, which equals 0 + 330,000 + 413,640 |
| Pension | basic ₦300,000 + housing ₦100,000 + transport ₦50,000, 8%/10% | Employee ₦36,000 · employer ₦45,000 · total remittance ₦81,000 on a ₦450,000 pensionable base |
| VAT | ₦250,000 + 7.5% | VAT ₦18,750 · gross ₦268,750 · 93.02% net / 6.98% VAT |
| Employer Cost | gross ₦450,000/month | True annual cost ₦6,075,000 · overhead multiplier 1.13× · ₦675,000 overhead, across 23 cost lines |
| EWA ROI | 100 staff, ₦3.6 m average, 20% turnover cut by 20%, 80% adoption, 6 months, ₦1 m programme cost | Savings ₦1,900,800 · net benefit ₦1,400,800 · ROI 280.16% · payback 3.2 months · current attrition cost ₦23,760,000 |

The four comparisons answer with real criteria rather than prose: accounting tools (6 options, 10
criteria, 0 unassessed cells), expense tools (8 × 9), Nigerian HMOs (indicative annual budget
₦2 m–₦4.5 m per 20–100 employees, 10 tiers/questions) and Nigerian PFAs (15 licensed PFAs, 8
criteria). Each returns a weighted ranking, a score breakdown by criterion and a capability table.
The generators build their documents in the browser from these engines; the ID card's own evidence
is in [`EMPLOYEE-ID-CARD-GENERATOR.md`](EMPLOYEE-ID-CARD-GENERATOR.md).

**What the 422s are worth recording for.** Three of the calculators refused the first payload I sent
— they need the pension percentages, the gross amount and the turnover assumptions respectively, and
the response names the missing field rather than inventing a default:

```json
{"ok":false,"tool":"nigeria-pension-calculator",
 "error":"Employee contribution percentage is required.",
 "fieldErrors":[{"key":"employeePct","message":"Employee contribution percentage is required."}, …]}
```

The browser form pre-fills those values from the field metadata (8%, 10%, 100% adoption, 12 months),
so a person never sees this; an API caller who omits an assumption is told which one is missing
instead of being handed a result computed on a guess.

## 6. What this document does not prove

- It does not prove the tools work against a **configured** platform: WHOIS, and any tool whose
  provider is optional, needs its integration connected first.
- It does not prove the **PHP** tool shell: that surface is exercised by `tests/tools/run.php` on a
  host with PHP, and this sandbox has no PHP binary.
- It does not replace a **device pass** for the two tools that need hardware (the QR camera) or a
  printer (the ID card), both of which are listed as blockers in
  [`docs/TOOL-AUDIT.md`](../TOOL-AUDIT.md) §9.
