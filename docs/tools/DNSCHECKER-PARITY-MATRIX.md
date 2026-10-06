# DNSChecker feature-reference matrix

Reference: <https://dnschecker.org/all-tools.php>, audited 2026-10-06. The complete
reference listing was inspected; it is a **feature reference only**. No branding,
page text, proprietary datasets, layout or source was copied. “Existing” refers
to the audited baseline; “new” refers to adapters/UI added here. This is not a
claim of identical services, full parity or worldwide measurement coverage.

Availability must come from the effective registry. Configuration-dependent
features are never represented by invented lookup results.

| Reference feature family | CloudHost247 implementation / canonical tool | Assessment / limitation |
|---|---|---|
| DNS record lookup | `/tools/dns-lookup` | Existing; explicit record type and resolver; live network verification required |
| DNS propagation | `/tools/dns-propagation` | Existing resolver-by-resolver results; not proof of worldwide propagation |
| DNS validation / health | `/tools/dns-health`, `/tools/domain-health` | Existing diagnostic checks, not a complete cryptographic DNSSEC validator |
| NS lookup | `/tools/nameserver-lookup` | New thin adapter over existing DNS implementation |
| CNAME lookup | `/tools/cname-lookup` | New thin adapter over existing DNS implementation |
| MX lookup | `/tools/mx-lookup` | Existing |
| SPF checking | `/tools/spf-checker` | Existing |
| DMARC checking / generation | `/tools/dmarc-checker`, `/tools/dmarc-generator` | Existing |
| DKIM lookup | `/tools/dkim-checker` | Existing; selector required, not guessed |
| DNSKEY / DS lookup | `/tools/dnskey-lookup`, `/tools/ds-lookup` | Existing record inspection; do not imply signature-chain validation |
| PTR / reverse DNS | `/tools/reverse-dns`, `/tools/ip-to-domain` | Existing; canonical aliases preserved |
| BIMI | `/tools/bimi-checker` | Existing; reports retrieved record/evidence, not brand verification |
| WHOIS domain information | `/tools/whois` | New adapter reusing existing Domain Services; connected RDAP required |
| Domain availability | `/tools/domain-availability` | Existing; registry/registrar evidence, not a checkout price or guarantee |
| Domain-to-IP | `/tools/domain-to-ip` | Existing DNS engine |
| IPv4/IPv6 ping | `/tools/ping` | Existing; sign-in, public targets, installed OS capability required |
| Traceroute | `/tools/traceroute` | Existing; sign-in and installed OS capability required |
| What is my IP | `/tools/what-is-my-ip` | Existing; depends on correct trusted-edge IP configuration |
| IP location / ISP | `/tools/ip-lookup`, `/tools/isp-lookup` | Existing provider/RDAP evidence; not precise personal location |
| IPv4 / IPv6 WHOIS | `/tools/ip-whois` | Existing RDAP; outbound access required |
| ASN | `/tools/asn-lookup` | Existing; old API slug `asn-whois` retained |
| Reverse IP hosting neighbors | `/tools/reverse-ip` | Existing configurable external adapter; unavailable without provider |
| Email header analysis | `/tools/email-header` | Existing parser, no fabricated route/ISP data |
| IP blacklist | `/tools/ip-blacklist` | Existing configured DNSBL checks; not an exhaustive reputation guarantee |
| IP decimal / IPv4↔IPv6 | `/tools/ip-converters` | Existing; compressed IPv6 defect repaired |
| IPv6 compression / expansion | `/tools/ip-converters` | Existing operations; labels distinguish conversion from connectivity |
| IPv6 ULA generation | None | Missing; not promoted |
| CIDR / subnet / ranges | `/tools/subnet-calculator` | Existing IPv4/IPv6 arithmetic; repaired address parsing |
| IPv6 website compatibility | DNS/AAAA and HTTP tools | Partial; no dedicated end-to-end dual-stack compatibility page |
| Open port test | `/tools/port-checker` | Existing bounded public-target TCP check; sign-in required |
| MAC vendor lookup / generation | `/tools/mac-lookup`, `/tools/mac-generator` | Existing MAC-bit inspection; vendor data needs a reachable configured IEEE OUI source, cached with its load timestamp |
| HTTP response / headers / redirects | `/tools/http-headers` | Existing guarded transport; redirect aliases point to this engine |
| Server OS fingerprint | `/tools/server-os` | Existing inference from evidence, not authoritative OS discovery |
| SMTP / email verification | `/tools/smtp-tester` | Existing bounded diagnostic; no guarantee a mailbox exists or accepts mail |
| SSL / certificate information | `/tools/ssl-checker` | Existing TLS inspection; certificate-info alias uses same engine |
| Password generator / strength / hashes | `/tools/password-tools` | Existing crypto, no-cache; not a password breach database |
| JSON formatting / conversion | `/tools/json-tools` | Existing real parser/formatter and operation schemas |
| Base64 / binary / hex / HTML encoding | `/tools/encoding-tools` | Existing; no shared text cache |
| ROT13 / ROT47 | `/tools/encoding-tools` | Existing operation modes |
| URL parsing / encoding / parameters | `/tools/url-tools`, `/tools/encoding-tools` | Existing; not the reference's full multi-URL feature set |
| User agent | `/tools/user-agent` | Existing parser; a declared user agent is not proof of client identity |
| Broken link / link analysis | `/tools/broken-links` | Existing bounded fetches; not an unlimited crawler |
| Open Graph / social metadata | `/tools/open-graph` | Existing fetched metadata, not fabricated previews |
| Robots generator / analysis | `/tools/robots-generator` | Existing |
| Punycode | `/tools/punycode` | Existing IDN conversion, not a safety endorsement |
| SERP preview | `/tools/serp-simulator` | Existing illustrative snippet; not a Google ranking prediction |
| Public PageRank | None | Not applicable: no current authoritative public Google PageRank API; no fake score |
| htaccess / rewrite generator | None | Missing; not promoted in menus |
| RAID calculator | None | Missing; not promoted |
| Morse converter | None | Missing; not promoted |
| QR generation / scanning | `/tools/qr-generator`, `/tools/qr-scanner` | Existing encoder/decoder; new image view/download; scanning does not open decoded links |
| Wi-Fi QR | `/tools/wifi-qr` | Existing; credentials processed on server, never cached |
| Lorem Ipsum | `/tools/lorem-ipsum` | Existing generated text, not network data |
| Word / character counting | `/tools/word-counter` | Existing |
| Online notepad | `/tools/notepad` | Existing bounded text operations, not a collaborative/persistent editor |
| Small text / invisible characters / runic | `/tools/small-text`, `/tools/invisible-character`, `/tools/runic-translator` | Existing transformations with stated limitations |
| Time-card calculator | `/tools/time-card` | Existing calculation; not payroll/legal advice |
| BIN / card validation | `/tools/bin-checker` | Existing BIN provider adapter; card-number/Luhn checker missing, no issuer data invented |
| Reverse image | `/tools/reverse-image-search` | Existing third-party launch links, not a CloudHost247 image-search index |
| Social handle availability | None | Missing; no invented availability |
| OCR | `/tools/image-ocr` | Existing configured provider adapter; unavailable without provider |
| RGB / HEX / CMYK / HSV tools | `/tools/color-tools` | Existing mathematical conversions / contrast; proprietary palette matching not applicable |
| Proprietary color-name matching | None | Not applicable without licensed dataset; no copied palette |
| Minecraft formatting | None | Missing; not promoted |
| Speed measurement | `/tools/speed-test` | Existing backend; new bounded real browser download/upload/latency/jitter; only browser↔CloudHost247 |
| UUID | `/tools/uuid-generator` | New cryptographic v4 generator; useful extension, not a reference-parity claim |

CloudHost247 additionally retains its existing tenant-owned reports, history,
favorites, scheduled monitoring, domain-health account integration and separate
MRZ tools. Those are platform features, not public execution bypasses.
