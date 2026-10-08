# Tools Center — full catalogue

Generated from `src/tools/catalog.ts` (69 tools). This table is the authoritative list: if a tool is not here it does not exist, and if a tool is here it has a page at its route.

Columns:

- **Route** — the SPA page (and therefore the human-readable URL).
- **API** — the endpoint the page calls. Everything is under `/api/tools/...`; `/api/v1/...` mirrors it.
- **Auth** — `no` means the tool runs for a signed-out visitor subject to the anonymous rate limit; `yes` means a session is required.
- **Provider** — the external service the tool needs. When it is not configured the tool answers `CONFIGURATION_REQUIRED` instead of guessing.

## DNS Tools (15)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **BIMI Checker** | `/tools/bimi-checker` | `/api/tools/bimi-checker` | no | — | Inspect the BIMI record, logo URL and VMC certificate URL. |
| **CNAME Lookup** | `/tools/cname-lookup` | `/api/tools/cname-lookup` | no | — | Inspect a hostname’s canonical-name records. |
| **DKIM Checker** | `/tools/dkim-checker` | `/api/tools/dkim-checker` | no | DKIM_VERIFY | Check selector._domainkey records for one or more selectors. |
| **DMARC Checker** | `/tools/dmarc-checker` | `/api/tools/dmarc-checker` | no | — | Inspect and validate a _dmarc policy, tag by tag. |
| **DMARC Record Generator** | `/tools/dmarc-generator` | `/api/tools/dmarc-generator` | no | — | Build a correctly formatted _dmarc record interactively. |
| **DNS Health Checker** | `/tools/dns-health` | `/api/tools/dns-health` | no | — | Run every DNS, delegation, email-authentication and DNSSEC check for a domain. |
| **DNS Lookup** | `/tools/dns-lookup` | `/api/tools/dns-lookup` | no | — | Look up A, AAAA, CNAME, MX, NS, TXT, SOA, SRV, CAA, PTR, DS and DNSKEY records. |
| **DNS Propagation Checker** | `/tools/dns-propagation` | `/api/tools/dns-propagation` | no | — | Query the same record against multiple public resolvers worldwide. |
| **DNSKEY Lookup** | `/tools/dnskey-lookup` | `/api/tools/dnskey-lookup` | no | — | Show the zone's DNSKEY records with key tag, algorithm, flags and public key. |
| **DS Lookup** | `/tools/ds-lookup` | `/api/tools/ds-lookup` | no | — | Show the DS records published by the parent zone and the DNSSEC chain state. |
| **MX Lookup** | `/tools/mx-lookup` | `/api/tools/mx-lookup` | no | — | Resolve MX hosts, their addresses, reverse DNS and mail provider. |
| **Nameserver Lookup** | `/tools/nameserver-lookup` | `/api/tools/nameserver-lookup` | no | — | Inspect the nameservers published for a domain. |
| **Reverse DNS / PTR Lookup** | `/tools/reverse-dns` | `/api/tools/reverse-dns` | no | — | PTR lookup for IPv4/IPv6 with forward-confirmed reverse DNS. |
| **Reverse IP Lookup** | `/tools/reverse-ip` | `/api/tools/reverse-ip` | yes | REVERSE_IP | Find hostnames hosted on an IP address, when a data provider is configured. |
| **SPF Checker** | `/tools/spf-checker` | `/api/tools/spf-checker` | no | — | Parse and validate the domain's SPF policy, including DNS lookup count. |

## IP Tools (7)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **Domain → IP** | `/tools/domain-to-ip` | `/api/tools/domain-to-ip` | no | — | Resolve a hostname to IPv4/IPv6 with the full CNAME chain. |
| **IP → Hostname** | `/tools/ip-to-domain` | `/api/tools/ip-to-hostname` | no | — | Reverse DNS for an address, with FCRDNS confirmation. |
| **IP Address Lookup** | `/tools/ip-lookup` | `/api/tools/ip-lookup` | no | GEOLOCATION | ASN, organisation, country, reverse DNS and network range for an IP. |
| **IP Converters** | `/tools/ip-converters` | `/api/tools/ip-converters` | no | — | Decimal ↔ IP, IPv4 ↔ IPv6, IPv6 compression/expansion, CIDR ↔ range. |
| **IP WHOIS** | `/tools/ip-whois` | `/api/tools/ip-whois` | no | RDAP | Registry data for an IPv4/IPv6 address over RDAP. |
| **ISP Lookup** | `/tools/isp-lookup` | `/api/tools/isp-lookup` | no | GEOLOCATION | Network operator, ASN and country for an IP address. |
| **What Is My IP** | `/tools/what-is-my-ip` | `/api/tools/my-ip` | no | — | Show the public IP this request arrived from, plus connection details. |

## Network Tools (8)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **ASN WHOIS** | `/tools/asn-lookup` | `/api/tools/asn-whois` | no | RDAP | Autonomous system details, announced prefixes and registry. |
| **Internet Speed Test** | `/tools/speed-test` | `/api/tools/speed-test` | no | — | Browser-based download, upload and latency measurement with hard limits. |
| **MAC Address Generator** | `/tools/mac-generator` | `/api/tools/mac-generator` | no | — | Generate valid random, locally-administered or globally-administered MACs. |
| **MAC Address Lookup** | `/tools/mac-lookup` | `/api/tools/mac-lookup` | no | — | Inspect MAC address bits and query a configured IEEE OUI reference. |
| **Ping Tool** | `/tools/ping` | `/api/tools/ping` | yes | — | Measure reachability and latency from the CloudHost247 server. |
| **Port Checker** | `/tools/port-checker` | `/api/tools/port-checker` | yes | — | Check whether a TCP port on a public host accepts connections. |
| **Subnet Calculator** | `/tools/subnet-calculator` | `/api/tools/subnet-calculator` | no | — | IPv4/IPv6 network, broadcast, host range, masks and splitting. |
| **Traceroute** | `/tools/traceroute` | `/api/tools/traceroute` | yes | — | Hop-by-hop path to a target, where the environment permits. |

## Developer Tools (10)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **Email Header Analyzer** | `/tools/email-header` | `/api/tools/email-header` | no | — | Parse a raw message header: Received chain, auth results, sending IP. |
| **Encoding Tools** | `/tools/encoding-tools` | `/api/tools/encoding-tools` | no | — | Base64, MD5, binary ↔ text, ROT13 and Morse code. |
| **HTTP Headers Checker** | `/tools/http-headers` | `/api/tools/http-headers` | no | — | Status, headers, redirect chain, cache and security-header analysis. |
| **JSON Tools** | `/tools/json-tools` | `/api/tools/json-tools` | no | — | Viewer, formatter, beautifier, minifier and validator. |
| **MRZ Generator** | `/tools/mrz-generator` | `/api/tools/mrz-generator` | no | — | Generate, validate and parse ICAO Doc 9303 machine-readable zones, with per-layout field-width and check-digit validation. |
| **SMTP Tester** | `/tools/smtp-tester` | `/api/tools/smtp-tester` | yes | — | Test an SMTP server's reachability, TLS and (optionally) authentication. |
| **URL Tools** | `/tools/url-tools` | `/api/tools/url-tools` | no | — | Multi-URL opener, rewrite-rule and .htaccess generators. |
| **User Agent Tool** | `/tools/user-agent` | `/api/tools/user-agent` | no | — | Show the user-agent and headers your browser actually sent. |
| **UUID Generator** | `/tools/uuid-generator` | `/api/tools/uuid-generator` | no | — | Generate cryptographically random version 4 identifiers. |
| **Website OS Checker** | `/tools/server-os` | `/api/tools/server-os` | no | — | Infer server software with an explicit confidence level. |

## Webmaster & SEO Tools (4)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **Broken Link Checker** | `/tools/broken-links` | `/api/tools/broken-links` | yes | — | Crawl a site within strict limits and report failing links. |
| **Open Graph Checker** | `/tools/open-graph` | `/api/tools/open-graph` | no | — | Inspect og: and Twitter card metadata and preview the link. |
| **robots.txt Generator** | `/tools/robots-generator` | `/api/tools/robots-generator` | no | — | Build a valid robots.txt with sitemaps and crawl delay. |
| **SERP Simulator** | `/tools/serp-simulator` | `/api/tools/serp-simulator` | no | — | Preview a search result snippet for title, URL and description length. |

## Security Tools (4)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **BIN Checker** | `/tools/bin-checker` | `/api/tools/bin-checker` | yes | BIN | Issuer information for a card BIN/IIN from a configured provider. |
| **IP Blacklist Checker** | `/tools/ip-blacklist` | `/api/tools/ip-blacklist` | no | DNSBL | Check an IP against the DNS blocklists the operator has enabled. |
| **Password Tools** | `/tools/password-tools` | `/api/tools/password-tools` | no | — | Generate strong passwords and evaluate strength locally. |
| **SSL Certificate Checker** | `/tools/ssl-checker` | `/api/tools/ssl-checker` | no | — | Certificate chain, validity, SANs, protocol and expiry for a host. |

## Domain Tools (3)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **Domain Availability** | `/tools/domain-availability` | `/api/tools/domain-availability` | no | AVAILABILITY | Check whether a domain is available, using CloudHost247's registrar integration. |
| **Domain WHOIS** | `/tools/whois` | `/api/tools/whois` | no | — | Inspect public domain registration information through the connected RDAP provider. |
| **Punycode / IDN Converter** | `/tools/punycode` | `/api/tools/punycode` | no | — | Convert between Unicode domain names and their ASCII (punycode) form. |

## Productivity Tools (13)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **Designer Colour Tools** | `/tools/color-tools` | `/api/tools/color-tools` | no | — | Convert between HEX, RGB, HSL, HSV/HSB and CMYK. |
| **Image → Text (OCR)** | `/tools/image-ocr` | `/api/tools/image-ocr` | yes | OCR | Extract text from an image using a configured OCR provider. |
| **Invisible Character Generator** | `/tools/invisible-character` | `/api/tools/invisible-character` | no | — | Copy zero-width and invisible Unicode characters. |
| **Lorem Ipsum Generator** | `/tools/lorem-ipsum` | `/api/tools/lorem-ipsum` | no | — | Generate placeholder text by words, sentences or paragraphs. |
| **Online Notepad** | `/tools/notepad` | `/api/tools/notepad` | no | — | A scratch pad that stays in your browser. |
| **QR Code Generator** | `/tools/qr-generator` | `/api/tools/qr-generator` | no | — | Create QR codes for URLs, text, email, phone, WiFi and vCards. |
| **QR Scanner** | `/tools/qr-scanner` | `/api/tools/qr-scanner` | no | — | Scan a QR code from your camera or an image file. |
| **Reverse Image Search** | `/tools/reverse-image-search` | `/api/tools/reverse-image-search` | no | — | Launch an image search with the engines you choose. |
| **Runic Translator** | `/tools/runic-translator` | `/api/tools/runic-translator` | no | — | Transliterate Latin text to Elder Futhark runes and back. |
| **Small Text Generator** | `/tools/small-text` | `/api/tools/small-text` | no | — | Convert text to small caps, superscript and subscript Unicode. |
| **Time Card Calculator** | `/tools/time-card` | `/api/tools/time-card` | no | — | Clock-in/clock-out totals with breaks and overtime. |
| **WiFi QR Tool** | `/tools/wifi-qr` | `/api/tools/wifi-qr` | no | — | Share a WiFi network as a QR code, without storing the password. |
| **Word & Text Counter** | `/tools/word-counter` | `/api/tools/word-counter` | no | — | Words, characters, sentences, paragraphs and reading time. |

## Diagnostics & Monitoring (5)

| Tool | Route | API | Auth | Provider | What it does |
| --- | --- | --- | --- | --- | --- |
| **Domain Health Center** | `/tools/domain-health` | `/api/tools/domain-health` | yes | — | Unified DNS, email, web, network and security view for a domain you own. |
| **Favorites** | `/tools/favorites` | `/api/tools/tool-favorites` | yes | — | The tools you have starred. |
| **Monitoring** | `/tools/monitors` | `/api/tools/tool-monitors` | yes | — | Scheduled SSL-expiry, DNS-record and email-configuration monitoring. |
| **Saved Reports** | `/tools/reports` | `/api/tools/tool-reports` | yes | — | Diagnostic results you chose to save, downloadable and deletable. |
| **Tool History** | `/tools/history` | `/api/tools/tool-history` | yes | — | Your recent tool runs, with the metadata that was stored. |

## Non-runnable pages

These are Tools Center pages rather than executable endpoints. Calling them through the API returns `404` with an explanation, which is deliberate: they are user-interface routes over data the API exposes at other endpoints.

- `tool-history`
- `tool-favorites`
- `tool-reports`
- `tool-monitors`

## Coverage check

Every runnable tool in the catalogue has a registered server-side handler (asserted by `tests/integration/tools-api.test.ts`).

