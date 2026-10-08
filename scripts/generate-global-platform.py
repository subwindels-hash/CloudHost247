#!/usr/bin/env python3
"""Generate the CloudHost247 public tools catalogue, missing marketing routes and visuals.

Original CloudHost247 copy and geometry. The DNSChecker catalogue is a scope
reference only — nothing from that site is copied.
"""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "modules/addons/cloudhost247_theme/resources/site.json"
PUBLIC = ROOT / "modules/addons/cloudhost247_theme/resources/tools-public.json"
INDEX = ROOT / "config/tools-index.json"
REQUIRED = ROOT / "config/required-tools.json"

CATEGORIES = {
    "dns": "DNS",
    "ip": "IP",
    "developer": "Developer",
    "designer": "Designer",
    "webmaster": "Webmaster",
    "network": "Network",
    "cybersecurity": "Cybersecurity",
    "productivity": "Productivity",
    "gaming": "Gaming",
}

SERVICES = {
    "dns": [("Domain registration", "domain.php"), ("DNS management", "dns-management.php"), ("Web hosting", "web-hosting.php"), ("VPS", "vps-hosting.php"), ("Cloud hosting", "cloudhost247-hosting.php")],
    "ip": [("VPS", "vps-hosting.php"), ("Dedicated servers", "dedicated-server.php"), ("Server management", "server-management.php"), ("IP management", "ip-management.php")],
    "developer": [("Developer hosting", "developer-friendly.php"), ("PaaS", "paas.php"), ("Node.js", "nodejs-hosting.php"), ("Docker", "docker-hosting.php"), ("VPS", "vps-hosting.php")],
    "designer": [("Website design", "website-design.php"), ("Web hosting", "web-hosting.php"), ("WordPress", "wordpress-hosting.php")],
    "webmaster": [("Web hosting", "web-hosting.php"), ("WordPress", "wordpress-hosting.php"), ("SSL certificates", "ssl-certificate.php"), ("Website design", "website-design.php")],
    "network": [("VPS", "vps-hosting.php"), ("Dedicated servers", "dedicated-server.php"), ("Network", "network.php"), ("Firewall", "firewall.php")],
    "cybersecurity": [("SSL certificates", "ssl-certificate.php"), ("Web hosting", "web-hosting.php"), ("Security", "security.php"), ("VPS", "vps-hosting.php")],
    "productivity": [("Web hosting", "web-hosting.php"), ("Domains", "domain.php"), ("Help center", "help-center.php")],
    "gaming": [("Game servers", "game-servers.php"), ("VPS", "vps-hosting.php"), ("Dedicated servers", "dedicated-server.php")],
}

# code, name, category, mode, handler, summary, keywords, inputs, options, featured
# mode: local | server. inputs: list of (name, label, type, placeholder, required)
RAW = []


def add(slug, name, cat, mode, handler, summary, keywords, inputs=None, options=None, featured=False, aliases=None, sensitive=False, description=None, faq_items=None):
    """`description`/`faq_items` override the generated copy where the scope or privacy wording has
    to be exact (for example the MRZ tool, which is not a network probe and must state plainly that
    nothing is uploaded, logged or stored)."""
    RAW.append({
        "slug": slug, "name": name, "category": cat, "mode": mode, "handler": handler,
        "summary": summary, "keywords": keywords, "inputs": inputs or [],
        "options": options or {}, "featured": featured, "aliases": aliases or [],
        "sensitive": sensitive, "description": description, "faq": faq_items,
    })


D = [("domain", "Domain name", "text", "example.com", True)]
IP = [("target", "IP address", "text", "203.0.113.10", True)]
URL = [("url", "Website URL", "url", "https://example.com", True)]
TXT = lambda label, ph: [("text", label, "textarea", ph, True)]

add("dns-checker", "DNS Checker", "dns", "server", "dns_checker",
    "Check A, AAAA, CNAME, MX, NS, TXT and SOA records for a domain in one view.",
    ["dns", "checker", "records", "a", "ns"], D, featured=True)
add("dns-propagation", "DNS Propagation", "dns", "server", "dns_propagation",
    "Compare one DNS question across the public resolvers CloudHost247 actually queries.",
    ["dns", "propagation", "resolvers"], D + [("type", "Record type", "select", "A", True)], featured=True)
add("domain-dns-validation", "Domain DNS Validation", "dns", "server", "dns_validation",
    "Validate that a domain has working delegation and the records a website usually needs.",
    ["dns", "validation", "domain"], D)
add("reverse-ip-lookup", "Reverse IP Lookup", "dns", "server", "reverse_ip",
    "Resolve the PTR hostname for an address and report when neighbor enumeration is not configured.",
    ["reverse", "ip", "ptr", "dns"], IP)
add("dns-lookup", "DNS Lookup", "dns", "server", "dns_lookup",
    "Look up a single DNS record type, including TTL, value and the resolver that answered.",
    ["dns", "lookup", "a", "aaaa", "cname", "mx", "ns", "txt"], D + [("type", "Record type", "select", "A", True)], featured=True)
add("cname-lookup", "CNAME Lookup", "dns", "server", "dns_lookup",
    "Look up the canonical name record for a hostname.",
    ["cname", "dns", "alias"], D, {"type": "CNAME"})
add("ns-lookup", "NS Lookup", "dns", "server", "dns_lookup",
    "Look up the authoritative name servers published for a domain.",
    ["ns", "nameserver", "dns"], D, {"type": "NS"})
add("mx-lookup", "MX Lookup", "dns", "server", "dns_lookup",
    "Look up mail exchanger hosts, priorities and their addresses.",
    ["mx", "mail", "dns", "email"], D, {"type": "MX"}, featured=True)
add("spf-record-checker", "SPF Record Checker", "dns", "server", "spf",
    "Parse a domain's SPF policy and flag syntax, lookup-count and multiple-record issues.",
    ["spf", "email", "dns", "txt"], D)
add("dmarc-checker", "DMARC Checker", "dns", "server", "dmarc",
    "Retrieve and explain the DMARC policy published at _dmarc.",
    ["dmarc", "email", "dns"], D)
add("domain-dns-health", "Domain DNS Health Checker", "dns", "server", "dns_health",
    "Run delegation, address, mail and authentication checks and label each result separately.",
    ["dns", "health", "domain"], D)
add("dmarc-record-generator", "DMARC Record Generator", "dns", "local", "dmarc_generate",
    "Build a DMARC TXT value from the policy choices you select. Nothing is published for you.",
    ["dmarc", "generator", "email"], [
        ("domain", "Domain", "text", "example.com", True),
        ("policy", "Policy", "select", "none", True),
        ("rua", "Aggregate report address", "text", "dmarc@example.com", False),
    ])
add("dnskey-lookup", "DNSKEY Lookup", "dns", "server", "dns_lookup",
    "Look up DNSKEY records. This inspects published keys; it does not validate the signature chain.",
    ["dnskey", "dnssec", "dns"], D, {"type": "DNSKEY"})
add("ds-lookup", "DS Lookup", "dns", "server", "dns_lookup",
    "Look up DS records at the parent. Presence of a DS is not a full DNSSEC validation.",
    ["ds", "dnssec", "dns"], D, {"type": "DS"})
add("dkim-checker", "DKIM Checker", "dns", "server", "dkim",
    "Look up a DKIM TXT record for the selector you provide. Selectors are never guessed.",
    ["dkim", "email", "dns"], D + [("selector", "Selector", "text", "default", True)])
add("ping-ipv4", "Ping IPv4", "ip", "server", "ping",
    "Measure TCP reachability to a public IPv4 host. This is not an ICMP echo.",
    ["ping", "ipv4", "latency"], [("target", "IPv4 address or hostname", "text", "203.0.113.10", True)], {"family": "ipv4"})
add("ping-ipv6", "Ping IPv6", "ip", "server", "ping",
    "Measure TCP reachability to a public IPv6 host. This is not an ICMP echo.",
    ["ping", "ipv6", "latency"], [("target", "IPv6 address or hostname", "text", "2001:db8::1", True)], {"family": "ipv6"})
add("what-is-my-ip", "What Is My IP", "ip", "server", "my_ip",
    "Show the IP address seen by this CloudHost247 service, without trusting spoofable proxy headers by default.",
    ["ip", "my ip", "address"], [], featured=True)
add("traceroute", "Traceroute", "ip", "server", "traceroute",
    "Report destination reachability. Hop-by-hop ICMP traceroute is shown only when the probe capability is available.",
    ["traceroute", "hops", "network"], [("target", "Hostname or IP", "text", "example.com", True)])
add("ip-location-lookup", "IP Location Lookup", "ip", "server", "ip_location",
    "Show registration information and, separately, estimated geolocation when a provider responds.",
    ["ip", "location", "geo"], IP, featured=True)
add("trace-email", "Trace Email", "ip", "local", "trace_email",
    "Parse Received headers in your browser. Message content is not uploaded or stored.",
    ["email", "trace", "headers"], TXT("Email headers", "Paste Received headers"), sensitive=True)
add("ip-blacklist-checker", "IP Blacklist Checker", "ip", "server", "ip_blacklist",
    "Query a fixed set of public DNS block lists and report each list's actual answer.",
    ["blacklist", "dnsbl", "ip"], IP)
add("email-blacklist-checker", "Email Blacklist Checker", "ip", "server", "email_blacklist",
    "Check a domain against public domain block lists. A listing is not a judgment of a mailbox.",
    ["blacklist", "email", "domain"], D)
add("ip-to-decimal", "IP to Decimal", "ip", "local", "ip_decimal",
    "Convert an IPv4 address to its unsigned decimal form and back.",
    ["ip", "decimal", "convert"], [("target", "IPv4 address or decimal", "text", "203.0.113.10", True)])
add("ip-to-hostname", "IP to Hostname", "ip", "server", "ip_hostname",
    "Resolve the PTR hostname for a public IP address.",
    ["ptr", "hostname", "ip"], IP)
add("ip-whois", "IP WHOIS", "ip", "server", "ip_whois",
    "Look up IPv4 registration data from RDAP. This is network registration, not a person search.",
    ["whois", "rdap", "ip"], IP, featured=True)
add("ipv6-whois", "IPv6 WHOIS", "ip", "server", "ip_whois",
    "Look up IPv6 registration data from RDAP.",
    ["whois", "ipv6", "rdap"], [("target", "IPv6 address", "text", "2001:db8::1", True)], {"family": "ipv6"})
add("ipv4-to-ipv6", "IPv4 to IPv6", "ip", "local", "ipv4_to_ipv6",
    "Show IPv4-mapped and 6to4 encodings. An encoding is not proof the host has IPv6 connectivity.",
    ["ipv4", "ipv6", "convert"], [("target", "IPv4 address", "text", "203.0.113.10", True)])
add("local-ipv6-generator", "Local IPv6 Address Generator", "ip", "local", "ipv6_ula",
    "Generate a Unique Local Address in fd00::/8 for lab use. It is not routable on the public internet.",
    ["ipv6", "ula", "generator"], [])
add("ipv6-cidr-to-range", "IPv6 CIDR to Range", "ip", "local", "ipv6_cidr_range",
    "Expand an IPv6 prefix into its first and last addresses.",
    ["ipv6", "cidr", "range"], [("target", "IPv6 CIDR", "text", "2001:db8::/32", True)])
add("ipv6-range-to-cidr", "IPv6 Range to CIDR", "ip", "local", "ipv6_range_cidr",
    "Summarize an aligned IPv6 range as CIDR prefixes. Unaligned ranges are split, not rounded away.",
    ["ipv6", "cidr", "range"], [("start", "First address", "text", "2001:db8::", True), ("end", "Last address", "text", "2001:db8::ffff", True)])
add("ipv6-compression", "IPv6 Compression", "ip", "local", "ipv6_compress",
    "Compress an IPv6 address using the shortest standards representation.",
    ["ipv6", "compress"], [("target", "IPv6 address", "text", "2001:0db8:0000:0000:0000:0000:0000:0001", True)])
add("ipv6-expand", "IPv6 Expand", "ip", "local", "ipv6_expand",
    "Expand a compressed IPv6 address to eight groups of four hexadecimal digits.",
    ["ipv6", "expand"], [("target", "IPv6 address", "text", "2001:db8::1", True)])
add("ip-subnet-calculator", "IP Subnet Calculator", "ip", "local", "subnet",
    "Calculate network, broadcast, usable range and mask for an IPv4 prefix.",
    ["subnet", "cidr", "ip", "calculator"], [("target", "IPv4 CIDR", "text", "203.0.113.10/24", True)], featured=True)
add("ipv6-to-ipv4", "IPv6 to IPv4", "ip", "local", "ipv6_to_ipv4",
    "Extract an embedded IPv4 address from a mapped, 6to4 or well-known NAT64 address.",
    ["ipv6", "ipv4", "convert"], [("target", "IPv6 address", "text", "::ffff:203.0.113.10", True)])
add("ipv6-compatibility-checker", "IPv6 Compatibility Checker", "ip", "server", "ipv6_compat",
    "Check whether a hostname publishes AAAA records and whether HTTPS responds on IPv6.",
    ["ipv6", "compatibility", "aaaa"], D)
add("what-is-my-isp", "What Is My ISP", "ip", "server", "isp",
    "Identify the network registration seen for your connection, separate from estimated location.",
    ["isp", "ip", "provider"], [])
add("domain-to-ip", "Domain to IP", "ip", "server", "domain_to_ip",
    "Resolve a hostname to its current A and AAAA addresses.",
    ["domain", "ip", "dns"], D)
add("http-headers-checker", "HTTP Headers Checker", "developer", "server", "http_headers",
    "Fetch response headers from a public URL, including a bounded redirect chain.",
    ["http", "headers", "developer"], URL)
add("website-os-checker", "Website Operating System Checker", "developer", "server", "server_os",
    "Infer a server operating system only from headers the site chooses to send.",
    ["os", "server", "headers"], URL)
add("md5-generator", "MD5 Generator", "developer", "local", "md5",
    "Compute an MD5 checksum in your browser. MD5 is not suitable for password storage.",
    ["md5", "hash", "checksum"], TXT("Text", "Text to hash"))
add("base64-generator", "Base64 Encoder / Decoder", "developer", "local", "base64",
    "Encode or decode Base64 with UTF-8 handling, strict validation and a URL-safe variant. Input is not uploaded.",
    ["base64", "encode", "decode", "utf-8", "url-safe", "base64url"],
    [("op", "Operation", "select", "encode", True,
      {"encode": "Encode text → Base64", "decode": "Decode Base64 → text"}),
     ("variant", "Alphabet", "select", "standard", True,
      {"standard": "Standard (+ / with = padding)", "urlsafe": "URL-safe (- _ without padding)"}),
     ("text", "Text or Base64", "textarea", "Text to encode, or Base64 to decode", True)],
    description=(
        "Encodes text to Base64 and decodes Base64 back to text, treating the payload as UTF-8 in "
        "both directions so multi-byte characters survive the round trip. Decoding is strict: "
        "characters outside the chosen alphabet, a bad padding length or a truncated final quantum "
        "are reported as an error with the offending position, instead of being silently skipped the "
        "way a permissive decoder would. A URL-safe alphabet (- and _, no padding) is available for "
        "tokens that travel in a path or query string. Everything happens in your browser tab."
    ))
add("multi-url-opener", "Multi URL Opener", "developer", "local", "multi_url",
    "Open up to eight http(s) URLs in new tabs after you confirm. Other schemes are rejected.",
    ["url", "opener", "tabs"], TXT("URLs", "https://example.com"))
MRZ = [
    ("mode", "Action", "select", "generate", True,
     {"generate": "Generate an MRZ", "validate": "Validate an MRZ", "parse": "Parse an MRZ"}),
    ("format", "Document format", "select", "TD3", True,
     {"TD3": "TD3 — passport / 2 lines × 44 characters",
      "TD2": "TD2 — ID card / 2 lines × 36 characters",
      "TD1": "TD1 — ID card / 3 lines × 30 characters"},
     "Determines the field widths, the check digits and the composite check digit."),
    ("mrz", "Existing MRZ (validate or parse)", "textarea", "Paste the machine-readable lines here", False),
    # Placeholders state the expected shape only. The ready-made ICAO specimen is offered by the
    # page's own "Generate test data" button inside the visitor's browser, so no specimen document
    # number, date of birth or name is ever written into a shipped config, template or page.
    ("documentCode", "Document code", "text", "P", False,
     None, "P for passport. TD1/TD2 accept I, A, C, V and similar codes."),
    ("issuingState", "Issuing state (3 letters)", "text", "UTO", False),
    ("surname", "Surname (as printed)", "text", "SURNAME", False),
    ("givenNames", "Given names (as printed)", "text", "GIVEN NAMES", False),
    ("nationality", "Nationality (3 letters)", "text", "UTO", False),
    ("documentNumber", "Document number", "text", "AB1234567", False),
    ("dateOfBirth", "Date of birth (YYMMDD)", "text", "YYMMDD", False),
    ("sex", "Sex", "select", "F", False, {"F": "F — female", "M": "M — male", "<": "< — unspecified"}),
    ("expiryDate", "Expiry date (YYMMDD)", "text", "YYMMDD", False),
    ("optionalData", "Optional / personal number", "text", "OPTIONAL", False,
     None, "TD3 allows 14 characters, TD2 28, TD1 15 plus a separate 15-character second optional field."),
    ("optionalData2", "Optional data 2 (TD1 only)", "text", "OPTIONAL2", False),
]
add("mrz-generator", "MRZ Generator", "developer", "local", "mrz_generate",
    "Generate, validate and parse ICAO Doc 9303 machine-readable zones for TD1, TD2 and TD3 documents.",
    ["mrz", "machine readable zone", "passport", "icao 9303", "td1", "td2", "td3", "check digit", "composite check digit", "ocr", "identity document", "parser", "validator"],
    MRZ, featured=True, sensitive=True,
    description=(
        "Builds machine-readable zones for the three ICAO Doc 9303 layouts — TD1 (3 lines of 30 "
        "characters), TD2 (2 lines of 36) and TD3 (2 lines of 44) — from the document fields you enter, "
        "validates the structure and the 7-3-1 check digits of an existing zone, and parses a supplied "
        "zone back into labelled fields. Field widths are enforced per format: a value that cannot fit "
        "the layout you selected is rejected with a message that names the field and the limit, never "
        "silently truncated. Names are transliterated to the ICAO Latin character set, and an "
        "unsupported character is reported instead of being removed or guessed. Privacy: the "
        "calculation runs in this browser tab, so the values you type are not uploaded, logged or "
        "stored by CloudHost247. Scope: machine-readable text only — a correct format and check digits "
        "prove the string is internally consistent, they do not prove that a physical or electronic "
        "document is genuine, and this page does not create passport artwork or travel documents."
    ),
    faq_items=[
        {"q": "Which document formats does this generate?",
         "a": "TD1 (ID card, three lines of 30 characters), TD2 (ID card, two lines of 36) and TD3 (passport, two lines of 44). The page states which layout you are building, and the field widths, check digits and composite check digit follow that layout."},
        {"q": "Is my input stored?",
         "a": "No. Everything is calculated in this browser tab. The values are not uploaded, not logged and not written to a database, and no MRZ string, document number or date of birth is sent to analytics or added to any URL."},
        {"q": "Does a valid check digit prove a passport is genuine?",
         "a": "No. This is syntactic validation: structure, field widths, character set and check digits. Authenticity requires the document itself, the issuing authority and cryptographic verification (ICAO PKD / passive authentication), which this tool does not perform."},
        {"q": "What happens if a field is too long?",
         "a": "Generation stops and the error names the field, the layout and the character limit. Fields are never truncated for you, because a truncated name field would produce a syntactically valid zone that misstates the document."},
        {"q": "Can I use a real passport here?",
         "a": "Use synthetic test data. The built-in specimen uses the reserved ICAO test codes UTO and XXA, which belong to no real person or state."},
    ])

# --- Compliance & Document Tools ---------------------------------------------------------------
# Five calculators and twelve generators, collected on one hub page (/tools/compliance-documents).
# Every one of them is a `local` tool: the arithmetic, the random bytes and the digests all happen
# in the visitor's browser tab, so passwords, tokens and document fields never reach a server.
add("age-date-calculator", "Age & Date Calculator", "productivity", "local", "age_date",
    "Exact age in years, months and days between a date of birth and a reference date, with the day-count behind it.",
    ["age", "date of birth", "birthday", "years months days", "document verification", "calculator"],
    [("dateOfBirth", "Date of birth", "text", "1990-04-23", True, None, "ISO 8601 (YYYY-MM-DD) or DD/MM/YYYY."),
     ("referenceDate", "Reference date", "text", "", False, None, "Defaults to today in your browser's time zone.")],
    sensitive=True,
    description=(
        "Computes the exact age between a date of birth and a reference date in completed years, "
        "months and days, plus the total days, weeks, months and the next birthday. Calendar "
        "arithmetic is exact: leap days, month lengths and end-of-month boundaries are handled by "
        "counting whole months first and the remaining days second, so 31 January plus one month is "
        "reported rather than guessed. Useful in identity and document workflows where an age has to "
        "be stated precisely on a given date. The reference date defaults to today in your own time "
        "zone; nothing is sent to CloudHost247."
    ),
    faq_items=[
        {"q": "How is the age calculated?", "a": "Whole years first, then whole months, then the remaining days — the same way a person states an age. Totals in days, weeks and months are computed separately from the day difference, so they are consistent with the calendar result."},
        {"q": "Are leap years handled?", "a": "Yes. February 29 birthdays and 366-day years are counted by real calendar arithmetic, not by a fixed 365-day year."},
        {"q": "Is the date of birth uploaded?", "a": "No. The calculation runs in your browser tab and the date is not stored, logged or sent anywhere."},
    ])
add("date-duration-calculator", "Date & Duration Calculator", "productivity", "local", "date_duration",
    "Add or subtract days, weeks, months and years from a date, or measure the exact duration between two dates.",
    ["date", "duration", "add days", "date difference", "leap year", "calculator"],
    [("action", "Calculation", "select", "difference", True,
      {"difference": "Duration between two dates", "add": "Add to a date", "subtract": "Subtract from a date"}),
     ("startDate", "Start date", "text", "2026-01-31", True, None, "ISO 8601 (YYYY-MM-DD) or DD/MM/YYYY."),
     ("endDate", "End date", "text", "2026-12-31", False, None, "Used for the duration between two dates."),
     ("amount", "Amount", "number", "30", False, None, "Used when adding or subtracting."),
     ("unit", "Unit", "select", "days", True,
      {"days": "Days", "weeks": "Weeks", "months": "Months", "years": "Years"})])
add("percentage-calculator", "Percentage & Rate Calculator", "productivity", "local", "percentage",
    "Percentage increase or decrease, percentage difference, reverse percentage and rate calculations.",
    ["percentage", "percent", "increase", "decrease", "reverse percentage", "rate", "calculator"],
    [("action", "Calculation", "select", "change", True,
      {"change": "Percentage increase / decrease", "of": "What is X% of Y", "isWhat": "X is what % of Y",
       "reverse": "Reverse percentage (find the original)", "difference": "Percentage difference"}),
     ("from", "From / original value", "text", "1200", True),
     ("to", "To / new value", "text", "1500", False),
     ("percent", "Percentage (%)", "text", "15", False),
     ("value", "Value", "text", "250", False)])
DATA_UNIT_CHOICES = {
    "bit": "bit", "B": "B (byte)",
    "kB": "kB (1000 B)", "MB": "MB (1000 kB)", "GB": "GB (1000 MB)", "TB": "TB (1000 GB)", "PB": "PB (1000 TB)",
    "KiB": "KiB (1024 B)", "MiB": "MiB (1024 KiB)", "GiB": "GiB (1024 MiB)",
    "TiB": "TiB (1024 GiB)", "PiB": "PiB (1024 TiB)",
}

add("unit-data-converter", "Unit & Data Conversion Calculator", "developer", "local", "unit_data",
    "Convert storage and data units between binary (KiB, MiB, GiB) and decimal (KB, MB, GB) systems.",
    ["unit", "converter", "bytes", "kibibyte", "mebibyte", "gibibyte", "storage", "data", "binary", "decimal"],
    [("amount", "Amount", "text", "1", True),
     ("fromUnit", "From unit", "select", "GiB", True, DATA_UNIT_CHOICES),
     ("toUnit", "To unit", "select", "GB", True, DATA_UNIT_CHOICES),
     ("precision", "Decimal places", "number", "6", False, None, "0 to 15. Defaults to 6.")],
    description=(
        "Converts data and storage quantities between the binary units a kernel reports (KiB, MiB, "
        "GiB, TiB, PiB — powers of 1024) and the decimal units a vendor labels a drive with (kB, MB, "
        "GB, TB, PB — powers of 1000), plus bits and bytes. Every conversion is done in exact "
        "integer-byte arithmetic where the value allows, so a 4 TiB volume and a 4 TB drive show the "
        "10% difference that is actually there instead of being rounded away. The result names both "
        "systems so an infrastructure figure cannot be misread."
    ))
add("unix-timestamp-calculator", "Timestamp / Unix Time Calculator", "developer", "local", "unix_timestamp",
    "Convert Unix timestamps to and from human-readable dates in seconds or milliseconds, with UTC and ISO 8601.",
    ["unix", "timestamp", "epoch", "iso 8601", "utc", "timezone", "converter", "calculator"],
    [("action", "Direction", "select", "decode", True,
      {"decode": "Timestamp → date/time", "encode": "Date/time → timestamp", "now": "Current timestamp"}),
     ("timestamp", "Unix timestamp", "text", "1767225600", False, None, "Seconds or milliseconds — the tool detects which."),
     ("datetime", "Date and time", "text", "2026-01-01T00:00:00Z", False, None, "ISO 8601, or YYYY-MM-DD HH:MM:SS."),
     ("zone", "Time zone", "select", "utc", True, {"utc": "UTC", "local": "My local time zone"})])

add("api-key-generator", "API Key / Token Generator", "cybersecurity", "local", "api_key_generate",
    "Cryptographically secure API keys and bearer tokens with a prefix, a chosen alphabet and bulk output.",
    ["api key", "token", "bearer", "secret", "random", "generator", "cryptography"],
    [("prefix", "Prefix", "text", "ch247", False, None, "Optional. Separated from the secret with an underscore."),
     ("length", "Secret length", "number", "40", True, None, "16 to 256 characters of secret, excluding the prefix."),
     ("alphabet", "Character set", "select", "base62", True,
      {"base62": "A–Z a–z 0–9 (URL-safe)", "hex": "0–9 a–f (hex)", "base32": "A–Z 2–7 (Crockford-safe)",
       "urlsafe": "A–Z a–z 0–9 - _ (base64url)", "digits": "0–9 only"}),
     ("count", "How many", "number", "1", True, None, "1 to 100.")],
    sensitive=True,
    description=(
        "Generates secrets from the browser's cryptographic random source (window.crypto) — never "
        "Math.random — with rejection sampling so every character in the chosen alphabet is equally "
        "likely and no modulo bias is introduced. Choose a prefix, a length and a character set, and "
        "generate one key or a batch. The estimated entropy in bits is reported so a weak choice is "
        "visible before you deploy it. Privacy: keys are created in your browser tab, are not sent to "
        "CloudHost247, are not written to logs or analytics, are not placed in a URL and are not "
        "persisted — closing the tab discards them. Scope: this generates random material. It does "
        "not register, validate or rotate a key in any service."
    ),
    faq_items=[
        {"q": "Is the randomness suitable for secrets?", "a": "It uses window.crypto.getRandomValues, the browser's CSPRNG, with rejection sampling to avoid modulo bias. If your browser has no CSPRNG the tool refuses to run rather than falling back to Math.random."},
        {"q": "Are the keys stored anywhere?", "a": "No. They exist in this tab only, are not uploaded, not logged, not added to a URL and not written to local storage. Copy them now; refreshing discards them."},
        {"q": "Does this make my API secure?", "a": "No. It produces random material. Transport security, storage at rest, rotation, scoping and revocation are your service's responsibility."},
    ])
add("checksum-hash-generator", "Checksum / Hash Generator", "cybersecurity", "local", "checksum_hash",
    "SHA-256, SHA-384, SHA-512, SHA-1 and MD5 digests of text or a file, computed in your browser.",
    ["hash", "checksum", "sha256", "sha384", "sha512", "sha1", "md5", "digest", "integrity", "generator"],
    [("source", "Input", "select", "text", True, {"text": "Text", "file": "File"}),
     ("text", "Text to hash", "textarea", "Text to hash", False),
     ("file", "File to hash", "file", "", False, None, "Read in this browser tab; never uploaded."),
     ("algorithm", "Algorithm", "select", "sha256", True,
      {"sha256": "SHA-256 (recommended)", "sha384": "SHA-384", "sha512": "SHA-512",
       "sha1": "SHA-1 (compatibility only)", "md5": "MD5 (legacy checksum only)"})],
    description=(
        "Computes cryptographic digests with the Web Crypto API in your browser tab. SHA-256, SHA-384 "
        "and SHA-512 are the recommended choices. SHA-1 is offered only for compatibility with systems "
        "that still publish SHA-1 fingerprints, and is labelled as such. MD5 is offered strictly as a "
        "legacy checksum for file identity against an older manifest: it is broken for collision "
        "resistance and must not be used for signatures, certificates or passwords. Output is hex and "
        "Base64. Files are read locally and are never uploaded."
    ),
    faq_items=[
        {"q": "Where is the file read?", "a": "In your browser tab, through the File API. It is streamed into the Web Crypto digest and never leaves your machine."},
        {"q": "Can I use MD5 for security?", "a": "No. MD5 collisions are practical. Use it only to compare against an older manifest that publishes MD5, and treat a match as weak evidence."},
        {"q": "Does a matching checksum prove a file is safe?", "a": "No. A digest proves the bytes are the same as the bytes that produced the reference digest. It says nothing about whether those bytes are trustworthy — that depends on where the reference digest came from."},
    ])
add("json-formatter", "JSON Formatter / Generator", "developer", "local", "json_format",
    "Format, minify and validate JSON with precise syntax error positions. Nothing is uploaded.",
    ["json", "formatter", "beautify", "minify", "validate", "syntax error", "generator"],
    [("action", "Action", "select", "format", True,
      {"format": "Format (pretty-print)", "minify": "Minify", "validate": "Validate only"}),
     ("text", "JSON", "textarea", '{"service":"example","enabled":true}', True),
     ("indent", "Indent", "select", "2", True, {"2": "2 spaces", "4": "4 spaces", "tab": "Tab"})],
    description=(
        "Parses JSON in your browser tab and re-emits it formatted, minified or simply validated. "
        "Invalid input produces the parser's message together with the line, the column and the "
        "offending fragment, so a syntax error can be found without counting braces by hand. "
        "Formatting preserves key order and value types; numbers that the parser would lose precision "
        "on (beyond 2^53) are reported rather than silently rewritten. The result can be copied or "
        "downloaded, and nothing is sent to CloudHost247."
    ))
add("http-security-headers-generator", "HTTP Security Headers Generator", "cybersecurity", "local", "http_security_headers",
    "Build a reviewed set of HTTP security headers and export it for nginx, Apache, .htaccess or Cloudflare.",
    ["security headers", "csp", "hsts", "x-frame-options", "referrer-policy", "permissions-policy", "nginx", "apache", "generator"],
    [("server", "Output format", "select", "nginx", True,
      {"nginx": "nginx", "apache": "Apache (.htaccess)", "caddy": "Caddy", "cloudflare": "Cloudflare Transform Rules", "raw": "Plain header list"}),
     ("csp", "Content-Security-Policy", "select", "strict", True,
      {"strict": "Strict — self only, no inline", "balanced": "Balanced — self plus inline styles",
       "off": "Omit the header"}),
     ("hsts", "Strict-Transport-Security", "select", "oneyear", True,
      {"oneyear": "1 year + includeSubDomains + preload", "sixmonths": "180 days + includeSubDomains", "off": "Omit"}),
     ("frame", "Frame / embedding protection", "select", "deny", True,
      {"deny": "Deny all framing", "sameorigin": "Same origin only", "off": "Omit"}),
     ("referrerpolicy", "Referrer-Policy", "select", "strict-origin-when-cross-origin", True,
      {"no-referrer": "no-referrer", "strict-origin-when-cross-origin": "strict-origin-when-cross-origin",
       "same-origin": "same-origin"}),
     ("permissions", "Permissions-Policy", "select", "restrictive", True,
      {"restrictive": "Restrict camera, microphone, geolocation, payment, usb", "off": "Omit"}),
     ("cookies", "Assume cookies with SameSite + Secure", "select", "yes", True, {"yes": "Yes", "no": "No"}),
     ("domain", "Site domain", "text", "example.com", False, None, "Optional. Used for the HSTS preload note only.")],
    description=(
        "Assembles a coherent set of response headers — Content-Security-Policy, "
        "Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Permissions-Policy and "
        "frame protection — and emits them in the syntax the chosen server actually accepts. The "
        "choices are deliberately narrow: a strict CSP that will work on a site with no inline script, "
        "a balanced one for a site that still has inline styles, or none. The tool is configuration "
        "assistance. It does not scan your site, does not test the policy and does not tell you "
        "whether your application is secure; deploy the output to a staging host first and watch the "
        "console for violations."
    ),
    faq_items=[
        {"q": "Will a strict CSP break my site?", "a": "It can. A self-only policy with no unsafe-inline blocks inline script and style attributes. Test on staging, or start with Content-Security-Policy-Report-Only and read the violation reports before enforcing."},
        {"q": "Does this verify my headers?", "a": "No. It generates configuration. To verify what a host actually sends, use the HTTP Headers Checker tool in this catalogue."},
        {"q": "Should I enable HSTS preload immediately?", "a": "Only when every host and subdomain serves valid HTTPS and will do so permanently. Preload submission is effectively irreversible for months."},
    ])
add("password-policy-generator", "Password Policy Generator", "cybersecurity", "local", "password_policy",
    "Produce a documented password and authentication policy from the controls you select, ready to publish.",
    ["password policy", "mfa", "lockout", "password history", "session", "compliance", "documentation", "generator"],
    [("minLength", "Minimum length", "number", "14", True, None, "6 to 128."),
     ("mfa", "Multi-factor authentication", "select", "required", True,
      {"required": "Required for every account", "privileged": "Required for privileged accounts only", "optional": "Recommended, not enforced"}),
     ("lockoutThreshold", "Failed attempts before lockout", "number", "5", True, None, "0 disables lockout."),
     ("lockoutMinutes", "Lockout duration (minutes)", "number", "15", True),
     ("history", "Remembered previous passwords", "number", "5", True, None, "0 to 24."),
     ("maxAgeDays", "Maximum password age (days)", "number", "0", True, None, "0 means no scheduled expiry."),
     ("sessionMinutes", "Idle session timeout (minutes)", "number", "30", True),
     ("breachCheck", "Screen new passwords against breached-password lists", "select", "yes", True, {"yes": "Yes", "no": "No"}),
     ("complexity", "Composition rules", "select", "length", True,
      {"length": "Length only — NIST SP 800-63B aligned", "classes": "Require upper, lower, digit and symbol"}),
     ("storage", "Password storage", "select", "argon2", True,
      {"argon2": "Argon2id", "scrypt": "scrypt", "pbkdf2": "PBKDF2-SHA-256 (high iteration count)"})],
    description=(
        "Turns the controls you select into a plain-language policy document you can hand to an "
        "auditor, publish in a wiki or attach to an onboarding pack: minimum length, composition, "
        "multi-factor scope, lockout and rate limiting, password history, maximum age, session "
        "timeout, storage algorithm and the review cadence that follows from those choices. Each "
        "section states what the control does and what it does not do. The guidance is aligned with "
        "NIST SP 800-63B and OWASP ASVS reasoning rather than legacy complexity rules, and the output "
        "says so. This is policy authoring — it does not configure an identity provider and it does "
        "not verify that your systems enforce what the document says."
    ),
    faq_items=[
        {"q": "Does this certify my compliance?", "a": "No. It writes down the controls you chose in a form an auditor can read. Certification requires your systems to enforce them and evidence that they do."},
        {"q": "Why is complexity optional?", "a": "NIST SP 800-63B recommends length and breach screening over forced character classes, which push people towards predictable substitutions. The generator offers both and states the trade-off in the document it produces."},
    ])
add("dns-record-generator", "DNS / Domain Configuration Generator", "dns", "local", "dns_record_generate",
    "Build A, AAAA, CNAME, MX, TXT, SPF, DMARC and DKIM records from the values you supply, with format validation.",
    ["dns", "records", "zone file", "a", "aaaa", "cname", "mx", "txt", "spf", "dmarc", "dkim", "generator"],
    [("domain", "Domain", "text", "example.com", True),
     ("defaultTtl", "Default TTL (seconds)", "number", "3600", True, None, "60 to 86400."),
     ("aRecords", "A records (name = IPv4, one per line)", "textarea", "@ = 203.0.113.10", False),
     ("aaaaRecords", "AAAA records (name = IPv6, one per line)", "textarea", "", False),
     ("cnameRecords", "CNAME records (name = target, one per line)", "textarea", "www = example.com.", False),
     ("mxRecords", "MX records (priority host, one per line)", "textarea", "10 mail.example.com.", False),
     ("txtRecords", "TXT records (name = value, one per line)", "textarea", "", False),
     ("spfIncludes", "SPF include hosts", "text", "_spf.example.net", False, None, "Space or comma separated."),
     ("spfPolicy", "SPF terminal policy", "select", "-all", True, {"-all": "-all (hard fail)", "~all": "~all (soft fail)", "?all": "?all (neutral)"}),
     ("dmarcPolicy", "DMARC policy", "select", "none", True, {"none": "none", "quarantine": "quarantine", "reject": "reject"}),
     ("dmarcRua", "DMARC aggregate report address", "text", "dmarc@example.com", False),
     ("dkimSelector", "DKIM selector", "text", "", False, None, "Only used if you also supply the public key."),
     ("dkimPublicKey", "DKIM public key (base64, p= value)", "textarea", "", False),
     ("format", "Output format", "select", "zone", True,
      {"zone": "BIND zone file", "json": "Structured JSON", "cloudflare": "Cloudflare import CSV"})],
    description=(
        "Assembles a DNS configuration from values you supply and refuses to invent any of them. "
        "Every record is validated before output: IPv4 and IPv6 literals are parsed properly, a "
        "CNAME target must be a hostname and cannot coexist with another record at the same name, an "
        "MX host must not be an address literal, SPF is checked against the 10-DNS-lookup limit for "
        "the mechanisms you list, DMARC is checked for the required v=DMARC1 and p= tags, and a DKIM "
        "record is emitted only when both a selector and a public key are present. Nothing is "
        "published: the output is a BIND zone fragment, structured JSON or a Cloudflare import CSV "
        "for you to review and apply."
    ),
    faq_items=[
        {"q": "Does this change my DNS?", "a": "No. It produces text for you to review and publish. No request is made to any registrar, DNS provider or resolver."},
        {"q": "Will it fill in values I leave out?", "a": "No. An empty field produces no record. DKIM in particular is emitted only when you supply both the selector and the public key, because a guessed key would be worse than none."},
    ])

COLLECTIONS = [
    {
        "slug": "compliance-documents",
        "name": "Compliance & Document Tools",
        "path": "/tools/compliance-documents",
        "summary": "Professional utilities for identity-document formatting, validation, security, developer workflows and infrastructure configuration.",
        "description": (
            "A working set of calculators and generators for identity-document formatting, secret "
            "generation, developer data handling and infrastructure configuration. Every tool runs in "
            "your browser tab: passwords, tokens, hashes and document fields are never uploaded, "
            "logged or stored by CloudHost247. Each tool states what it actually verifies — generation, "
            "validation or configuration assistance — and none of them claim to authenticate a "
            "document, certify a compliance programme or prove that a system is secure."
        ),
        "seoTitle": "Compliance & Document Tools — MRZ, Security & Developer Utilities | CloudHost247",
        "seoDescription": (
            "Professional utilities for identity-document formatting, validation, security, developer "
            "workflows and infrastructure configuration. Five calculators and twelve generators, all "
            "processed in your browser."
        ),
        "keywords": ["compliance tools", "document tools", "mrz", "generators", "calculators", "identity document", "security"],
        "groups": [
            {"slug": "identity", "label": "Identity & Document",
             "blurb": "Machine-readable document formatting and the date arithmetic identity checks depend on.",
             "tools": ["mrz-generator", "age-date-calculator", "date-duration-calculator"]},
            {"slug": "security", "label": "Security & Secrets",
             "blurb": "Random material, digests and written policy — generated locally, never uploaded.",
             "tools": ["random-password-generator", "api-key-generator", "password-policy-generator",
                        "http-security-headers-generator", "checksum-hash-generator"]},
            {"slug": "developer", "label": "Developer",
             "blurb": "Identifiers, encodings and structured data for build and debug workflows.",
             "tools": ["uuid-generator", "base64-generator", "json-formatter", "qr-code-generator"]},
            {"slug": "calculators", "label": "Calculators & Conversion",
             "blurb": "Exact arithmetic for percentages, data units and machine time.",
             "tools": ["percentage-calculator", "unit-data-converter", "unix-timestamp-calculator"]},
            {"slug": "infrastructure", "label": "Infrastructure & Domains",
             "blurb": "Configuration output for DNS zones and crawler directives.",
             "tools": ["dns-record-generator", "robots-txt-generator"]},
        ],
    },
]
COLLECTION_BY_TOOL = {slug: c["slug"] for c in COLLECTIONS for g in c["groups"] for slug in g["tools"]}


add("smtp-test", "SMTP Test", "developer", "server", "smtp",
    "Connect to a public mail server, read the banner and send EHLO. Passwords are not accepted.",
    ["smtp", "email", "banner"], [("host", "Mail host", "text", "mail.example.com", True), ("port", "Port", "select", "25", True)])
add("htaccess-redirect-generator", ".htaccess Redirect Generator", "developer", "local", "htaccess",
    "Generate an Apache redirect snippet for you to review and place yourself.",
    ["htaccess", "redirect", "apache"], [("source", "From path", "text", "/old", True), ("target", "To URL", "text", "https://example.com/new", True), ("code", "Status", "select", "301", True)])
add("url-rewrite-generator", "URL Rewrite Generator", "developer", "local", "rewrite",
    "Generate a RewriteRule from a simple pattern. Review it before publishing.",
    ["rewrite", "apache", "url"], [("pattern", "Pattern", "text", "^blog/([0-9]+)$", True), ("dest", "Substitution", "text", "/post.php?id=$1", True)])
add("broken-link-checker", "Broken Link Checker", "developer", "server", "broken_links",
    "Fetch one public page and check a bounded set of its links. This is not an unlimited crawler.",
    ["broken", "links", "http"], URL)
add("open-graph-checker", "Open Graph Checker", "developer", "server", "open_graph",
    "Read Open Graph and Twitter card tags from a public page. Missing tags are reported as missing.",
    ["opengraph", "og", "social"], URL)
add("raid-calculator", "RAID Calculator", "developer", "local", "raid",
    "Estimate usable capacity for RAID 0, 1, 5, 6 and 10 from disk count and size.",
    ["raid", "calculator", "storage"], [("disks", "Number of disks", "number", "4", True), ("size", "Disk size (GB)", "number", "1000", True), ("level", "RAID level", "select", "5", True)])
add("binary-translator", "Binary Translator", "developer", "local", "binary",
    "Decode space-separated binary bytes into text in your browser.",
    ["binary", "decode", "text"], TXT("Binary", "01000011 01001000"))
add("text-to-binary", "Text to Binary", "developer", "local", "text_binary",
    "Encode text as 8-bit binary in your browser.",
    ["binary", "encode", "text"], TXT("Text", "CH247"))
add("json-viewer", "JSON Viewer", "developer", "local", "json_view",
    "Parse JSON and show a readable tree. Invalid JSON is an error, not a guess.",
    ["json", "viewer", "parse"], TXT("JSON", '{"ok":true}'))
add("json-beautifier", "JSON Beautifier", "developer", "local", "json_beautify",
    "Format JSON with indentation. The parser rejects trailing commas and comments.",
    ["json", "beautifier", "format"], TXT("JSON", '{"a":1}'), featured=True)
add("json-minifier", "JSON Minifier", "developer", "local", "json_minify",
    "Minify JSON after a real parse, so broken input is not silently shipped.",
    ["json", "minify"], TXT("JSON", '{\n  "a": 1\n}'))
add("email-verifier", "Email Verifier", "developer", "server", "email_verify",
    "Check address syntax and whether the domain publishes MX records. A mailbox is not confirmed.",
    ["email", "verify", "mx"], [("email", "Email address", "text", "name@example.com", True)])
add("rgb-to-colortone", "RGB to Colortone", "designer", "local", "color_rgb",
    "Match an RGB color to the nearest CloudHost247 Colortone and show converted values.",
    ["rgb", "color", "colortone"], [("r", "Red", "number", "25", True), ("g", "Green", "number", "105", True), ("b", "Blue", "number", "71", True)])
add("hex-to-colortone", "HEX to Colortone", "designer", "local", "color_hex",
    "Match a HEX color to the nearest CloudHost247 Colortone and preview it.",
    ["hex", "color", "colortone"], [("hex", "HEX", "text", "#196947", True)])
add("cmyk-to-colortone", "CMYK to Colortone", "designer", "local", "color_cmyk",
    "Convert CMYK percentages to RGB, then match the nearest CloudHost247 Colortone.",
    ["cmyk", "color", "colortone"], [("c", "Cyan %", "number", "76", True), ("m", "Magenta %", "number", "33", True), ("y", "Yellow %", "number", "32", True), ("k", "Black %", "number", "42", True)])
add("hsv-to-colortone", "HSV to Colortone", "designer", "local", "color_hsv",
    "Convert HSV to RGB and match the nearest CloudHost247 Colortone.",
    ["hsv", "color", "colortone"], [("h", "Hue", "number", "152", True), ("s", "Saturation %", "number", "76", True), ("v", "Value %", "number", "41", True)])
add("website-link-analyzer", "Website Link Analyzer", "webmaster", "server", "link_analyzer",
    "Summarize internal, external and nofollow links on a single public page.",
    ["links", "analyzer", "seo"], URL)
add("user-agent-checker", "User Agent Checker", "webmaster", "local", "user_agent",
    "Show and parse the user agent your browser sends. A declared agent is not proof of identity.",
    ["user agent", "browser"], [])
add("pagerank-checker", "Google Page Rank Checker", "webmaster", "server", "pagerank",
    "Explain that public Google PageRank is retired, and show only observable indexability signals.",
    ["pagerank", "seo", "google"], URL)
add("punycode-converter", "Punycode Converter", "webmaster", "local", "punycode",
    "Convert between Unicode domains and Punycode. Conversion is not a safety endorsement.",
    ["punycode", "idn", "domain"], [("text", "Domain", "text", "münchen.example", True)])
add("serp-simulator", "Google SERP Simulator", "webmaster", "local", "serp",
    "Preview how a title and description may truncate. This is not a ranking prediction.",
    ["serp", "seo", "preview"], [("title", "Title", "text", "Example page title", True), ("url", "URL", "url", "https://example.com/page", True), ("description", "Description", "textarea", "A short description.", True)])
add("robots-txt-generator", "Robots.txt Generator", "webmaster", "local", "robots",
    "Build a valid robots.txt from your user-agent rules, allow and disallow paths, crawl-delay and sitemap URLs.",
    ["robots", "robots.txt", "seo", "crawler", "user-agent", "sitemap", "crawl-delay", "generator"],
    [("agent", "User-agent (one per line)", "textarea", "*", True,
     None, "Use * for every crawler, or one token per line, e.g. Googlebot, Bingbot."),
     ("disallow", "Disallow paths (one per line)", "textarea", "/admin/", False),
     ("allow", "Allow paths (one per line)", "textarea", "", False,
     None, "An Allow inside a Disallowed directory re-opens that path. Most crawlers honour it."),
     ("crawlDelay", "Crawl-delay (seconds)", "number", "", False, None,
      "Optional. Googlebot ignores this directive; Bing and Yandex honour it."),
     ("sitemap", "Sitemap URLs (one per line)", "textarea", "https://example.com/sitemap.xml", False),
     ("noindexNote", "Warn about noindex in robots.txt", "select", "yes", True, {"yes": "Yes", "no": "No"})],
    description=(
        "Assembles a robots.txt file from the rules you enter and validates them as it goes: each "
        "Disallow and Allow path must start with a forward slash, a sitemap must be an absolute "
        "http(s) URL, and a crawl-delay must be a positive number of seconds. Multiple user-agents "
        "share one rule block, which is what the specification expects. The preview is the exact file "
        "text you can download and publish. Scope: this writes crawl guidance for cooperating "
        "crawlers. It is not an access control, it does not hide anything from a client that ignores "
        "it, and it does not verify how a search engine currently treats your site."
    ),
    faq_items=[
        {"q": "Does robots.txt keep a page private?", "a": "No. It is a request that cooperating crawlers honour, and it is public. Anything that must stay private needs authentication. A Disallow can also keep a page out of your own view of the index while other sites still link to it."},
        {"q": "Does every crawler support crawl-delay?", "a": "No. Googlebot ignores it; Bing and Yandex honour it. The generator notes this next to the value."},
    ])
add("port-checker", "Port Checker", "network", "server", "port",
    "Test one TCP port on a public host. Private and metadata addresses are refused.",
    ["port", "tcp", "network"], [("host", "Public host or IP", "text", "example.com", True), ("port", "Port", "number", "443", True)], featured=True)
add("mac-address-lookup", "MAC Address Lookup", "network", "local", "mac_lookup",
    "Match a MAC prefix against CloudHost247's bundled public OUI sample. Unknown means not in that sample.",
    ["mac", "oui", "vendor"], [("mac", "MAC address", "text", "00:1A:11:00:00:00", True)])
add("mac-address-generator", "MAC Address Generator", "network", "local", "mac_generate",
    "Generate a locally administered unicast MAC address for labs. It is not assigned to a manufacturer.",
    ["mac", "generator"], [])
add("asn-whois-lookup", "ASN WHOIS Lookup", "network", "server", "asn",
    "Look up an autonomous system number through RDAP.",
    ["asn", "whois", "bgp"], [("target", "ASN or IP", "text", "AS13335", True)])
add("ssl-certificate-checker", "SSL Certificate Checker", "cybersecurity", "server", "ssl",
    "Inspect the certificate a public host presents, including issuer, dates and names.",
    ["ssl", "tls", "certificate"], [("host", "Hostname", "text", "example.com", True)], featured=True)
add("password-encryption", "Password Encryption", "cybersecurity", "local", "password_hash",
    "Derive a hash in your browser with SHA-256 or PBKDF2. The value is never uploaded or stored.",
    ["password", "hash", "pbkdf2"], [("password", "Password", "password", "", True), ("algo", "Algorithm", "select", "pbkdf2", True)], sensitive=True)
add("random-password-generator", "Random Password Generator", "cybersecurity", "local", "password_generate",
    "Generate a password or passphrase with the Web Crypto random source, with an entropy estimate. It stays in your browser.",
    ["password", "generator", "random", "passphrase", "entropy", "secure"],
    [("kind", "Type", "select", "password", True,
      {"password": "Random password", "passphrase": "Random passphrase (diceware-style words)"}),
     ("length", "Length / words", "number", "20", True, None,
      "Password: 8 to 128 characters. Passphrase: 3 to 12 words."),
     ("uppercase", "Uppercase A–Z", "select", "yes", True, {"yes": "Yes", "no": "No"}),
     ("lowercase", "Lowercase a–z", "select", "yes", True, {"yes": "Yes", "no": "No"}),
     ("numbers", "Digits 0–9", "select", "yes", True, {"yes": "Yes", "no": "No"}),
     ("symbols", "Symbols", "select", "yes", True, {"yes": "Yes", "no": "No"}),
     ("unambiguous", "Exclude look-alike characters (I l 1 O 0)", "select", "no", True, {"yes": "Yes — drop I l 1 O 0", "no": "No — use the full alphabet"}),
     ], sensitive=True,
    description=(
        "Builds passwords and passphrases from window.crypto.getRandomValues with rejection sampling, "
        "so every character in the enabled sets is equally likely and no modulo bias is introduced. "
        "Choose the character classes, optionally drop look-alike characters (I, l, 1, O, 0), or "
        "switch to a passphrase of words from a built-in list. The estimated entropy in bits is "
        "reported against the actual alphabet used, so a weak configuration is visible before you "
        "rely on it. Privacy: values are generated in your browser tab, are not uploaded, logged, "
        "placed in a URL or persisted, and are discarded when you leave the page."
    ),
    faq_items=[
        {"q": "Is the randomness cryptographically secure?", "a": "Yes. It uses the browser CSPRNG with rejection sampling. If the browser exposes no CSPRNG the tool refuses to run instead of falling back to a predictable source."},
        {"q": "Are passwords ever sent to CloudHost247?", "a": "No. There is no network request in this handler. Nothing is written to logs, analytics, local storage or a URL."},
        {"q": "Is a passphrase weaker than a password?", "a": "Not necessarily, and the tool tells you rather than guessing: it reports the entropy of exactly what it produced. Each word is drawn from a built-in 368-word list, which is about 8.5 bits per word, so seven words is roughly 60 bits and five words is about 43. The estimate assumes the list is public, because it is."},
    ])
add("password-strength-checker", "Password Strength Checker", "cybersecurity", "local", "password_strength",
    "Score a password locally for length and character variety. It is not checked against breach lists.",
    ["password", "strength"], [("password", "Password", "password", "", True)], sensitive=True)
add("qr-code-generator", "QR Code Generator", "productivity", "local", "qr_generate",
    "Encode text or a URL into a QR code in your browser, with an error-correction level and a PNG or SVG download.",
    ["qr", "generator", "barcode", "error correction", "png", "svg"],
    TXT("Content", "https://example.com") + [
        ("ecl", "Error correction", "select", "M", True,
         {"L": "L — about 7% recovery", "M": "M — about 15% recovery",
          "Q": "Q — about 25% recovery", "H": "H — about 30% recovery"},
         "Higher levels survive more damage and leave room for a centre logo, at the cost of density."),
        ("size", "Image size (px)", "number", "320", False, None, "128 to 1024. Defaults to 320."),
        ("output", "Output", "select", "png", True, {"png": "PNG image", "svg": "SVG vector"}),
    ], featured=True,
    description=(
        "Encodes the text or URL you enter into a QR symbol with a real Reed\u2013Solomon encoder in "
        "your browser tab \u2014 no image is requested from a third party and the content is never "
        "uploaded. Choose the error-correction level (L, M, Q or H) to trade density against damage "
        "resistance, choose a pixel size, and download the result as PNG or SVG. The symbol version "
        "and module count reported come from the encoder itself, so you can see whether the payload "
        "actually fits."
    ))
add("qr-scanner", "QR Scanner", "productivity", "local", "qr_scan",
    "Decode a QR image locally. Decoded links are shown as text and are not opened automatically.",
    ["qr", "scanner"], [("file", "QR image", "file", "", True, None, "Read and decoded in this browser; the image is not uploaded.", "image/*")])
add("lorem-ipsum-generator", "Lorem Ipsum Generator", "productivity", "local", "lorem",
    "Generate placeholder paragraphs. The text is filler, not product copy.",
    ["lorem", "placeholder"], [("paragraphs", "Paragraphs", "number", "3", True)])
add("time-card-calculator", "Time Card Calculator", "productivity", "local", "timecard",
    "Add clock-in and clock-out pairs. This is arithmetic, not payroll or legal advice.",
    ["time", "timesheet", "calculator"], TXT("Entries", "09:00-17:00\n09:30-17:15"))
add("bin-checker", "BIN Checker", "productivity", "local", "bin",
    "Identify a card brand from the IIN prefix. The full number is not required and is not stored.",
    ["bin", "iin", "card"], [("bin", "First 6–8 digits", "text", "424242", True)], sensitive=True)
add("credit-card-checker", "Credit Card Checker", "productivity", "local", "card",
    "Validate length and the Luhn checksum locally. This does not charge a card or contact a bank.",
    ["credit", "card", "luhn"], [("number", "Card number", "text", "", True)], sensitive=True)
add("reverse-image-search", "Reverse Image Search", "productivity", "local", "reverse_image",
    "Build links to public image-search engines. CloudHost247 does not keep an image index.",
    ["image", "search", "reverse"], [("url", "Image URL", "url", "https://example.com/photo.jpg", False)])
add("name-checker", "Name Checker", "productivity", "server", "name_check",
    "Check a name for format issues and whether matching domains resolve. Social accounts are not scraped.",
    ["name", "username", "domain"], [("name", "Name", "text", "cloudhost", True)])
add("online-notepad", "Online Notepad", "productivity", "local", "notepad",
    "A private notepad that stays in this tab unless you choose to keep it in this browser.",
    ["notepad", "notes"], TXT("Notes", ""))
add("small-text-generator", "Small Text Generator", "productivity", "local", "small_text",
    "Convert letters to small Unicode forms for display. Not every font renders them.",
    ["small", "unicode", "text"], TXT("Text", "CloudHost247"))
add("word-counter", "Word Counter", "productivity", "local", "word_count",
    "Count words, characters, sentences and reading time in your browser.",
    ["word", "counter", "characters"], TXT("Text", "Paste text"))
add("domain-name-search", "Domain Name Search", "productivity", "server", "domain_search",
    "See whether a name resolves and what RDAP says. This is not a checkout price or a guarantee.",
    ["domain", "search", "availability"], [("name", "Domain name", "text", "example.com", True)])
add("rot13", "ROT13 Encoder/Decoder", "productivity", "local", "rot13",
    "Rotate letters by 13 places. ROT13 is not encryption.",
    ["rot13", "cipher"], TXT("Text", "CloudHost247"))
add("morse-code-translator", "Morse Code Translator", "productivity", "local", "morse",
    "Translate between text and Morse. Unsupported characters are reported, not dropped silently.",
    ["morse", "translator"], TXT("Text or Morse", "SOS"))
add("bimi-checker-generator", "BIMI Checker & Generator", "productivity", "server", "bimi",
    "Look up a BIMI record or draft one. A logo URL is evidence of a record, not brand verification.",
    ["bimi", "email", "logo"], D + [("selector", "Selector", "text", "default", False), ("logo", "Logo URL for a draft", "url", "https://example.com/logo.svg", False)])
add("image-to-text", "Image to Text", "productivity", "local", "image_text",
    "Extract text with the browser text detector when it exists. No text is invented if it does not.",
    ["ocr", "image", "text"], [("file", "Image", "file", "", True)])
add("runic-translator", "Runic Translator", "productivity", "local", "runic",
    "Map Latin letters to a runic-style alphabet for display. This is not a historical transcription.",
    ["runic", "translator"], TXT("Text", "Cloud"))
add("invisible-character-generator", "Invisible Character Generator", "productivity", "local", "invisible",
    "Copy a specific Unicode invisible character, with its code point named.",
    ["invisible", "unicode"], [("kind", "Character", "select", "zwsp", True)])
add("internet-speed-test", "Internet Speed Test", "productivity", "server", "speed",
    "Measure latency, download and upload between this browser and this CloudHost247 service only.",
    ["speed", "bandwidth", "latency"], [], featured=True)
add("wifi-qr-scanner", "WiFi QR Scanner", "productivity", "local", "wifi_qr",
    "Decode a Wi-Fi QR code locally. The network is not joined and the passphrase is not stored.",
    ["wifi", "qr", "scanner"], [("file", "QR image", "file", "", True)], sensitive=True)
add("minecraft-color-codes", "Minecraft Color Codes", "gaming", "local", "minecraft",
    "Reference and preview Minecraft formatting codes. Minecraft is a trademark of its owner; this is an unofficial aid.",
    ["minecraft", "color", "codes"], [("text", "Preview text", "text", "Hello", False)])

# Extra real tools so the platform clears 100 implemented utilities.
add("soa-lookup", "SOA Lookup", "dns", "server", "dns_lookup", "Look up the start of authority record for a domain.", ["soa", "dns"], D, {"type": "SOA"})
add("txt-lookup", "TXT Lookup", "dns", "server", "dns_lookup", "Look up TXT records, including SPF and verification tokens.", ["txt", "dns"], D, {"type": "TXT"})
add("caa-lookup", "CAA Lookup", "dns", "server", "dns_lookup", "Look up CAA records that name which certificate authorities may issue.", ["caa", "dns", "ssl"], D, {"type": "CAA"})
add("srv-lookup", "SRV Lookup", "dns", "server", "dns_lookup", "Look up SRV service records, including priority and weight.", ["srv", "dns"], D, {"type": "SRV"})
add("ptr-lookup", "PTR Lookup", "dns", "server", "ip_hostname", "Look up the reverse DNS pointer for an IP address.", ["ptr", "dns", "reverse"], IP)
add("a-record-lookup", "A Record Lookup", "dns", "server", "dns_lookup", "Look up IPv4 address records for a hostname.", ["a", "dns", "ipv4"], D, {"type": "A"})
add("aaaa-lookup", "AAAA Lookup", "dns", "server", "dns_lookup", "Look up IPv6 address records for a hostname.", ["aaaa", "dns", "ipv6"], D, {"type": "AAAA"})
add("uuid-generator", "UUID Generator", "developer", "local", "uuid",
    "Generate UUIDv4, time-ordered UUIDv7 or nil UUIDs in bulk from the browser's cryptographic random source.",
    ["uuid", "generator", "uuidv4", "uuidv7", "guid", "bulk"],
    [("version", "Version", "select", "v4", True,
      {"v4": "v4 — random", "v7": "v7 — time-ordered (sortable)", "nil": "Nil UUID (all zeros)"},
      "v7 embeds a 48-bit Unix millisecond timestamp, so identifiers sort by creation time."),
     ("count", "How many", "number", "1", True, None, "1 to 1000."),
     ("format", "Format", "select", "standard", True,
      {"standard": "8-4-4-4-12 hyphenated", "hex": "Hex, no hyphens", "braces": "{8-4-4-4-12}",
       "urn": "urn:uuid:8-4-4-4-12", "upper": "Uppercase hyphenated"})],
    description=(
        "Generates UUIDs from window.crypto \u2014 never Math.random \u2014 with the version and variant "
        "bits set correctly for the layout you choose. v4 carries 122 bits of randomness. v7 places a "
        "48-bit Unix millisecond timestamp in the high bits so identifiers sort by creation time, "
        "which matters for database primary keys and log correlation. Generate one or a thousand, "
        "then copy or download the list. Nothing is uploaded and nothing is stored."
    ))
add("domain-whois", "Domain WHOIS", "dns", "server", "domain_whois", "Look up domain registration data through RDAP and label the source.", ["whois", "rdap", "domain"], D, featured=True)
add("spf-record-generator", "SPF Record Generator", "dns", "local", "spf_generate", "Draft an SPF TXT value from the mechanisms you choose. It is not published automatically.", ["spf", "generator"], [("includes", "Include hosts", "text", "_spf.example.com", False), ("policy", "Terminal policy", "select", "-all", True)])

REQUIRED_SLUGS = [t["slug"] for t in RAW if t["slug"] not in {
    "soa-lookup", "txt-lookup", "caa-lookup", "srv-lookup", "ptr-lookup", "a-record-lookup",
    "aaaa-lookup", "uuid-generator", "domain-whois", "spf-record-generator",
}]


def faq(tool):
    name = tool["name"]
    local = tool["mode"] == "local"
    where = "in your browser and is not uploaded" if local else "on the CloudHost247 service after the input is validated"
    return [
        {"q": f"What does {name} actually check?", "a": tool["summary"] + " Each result names its source."},
        {"q": "Is my input stored?", "a": f"Processing happens {where}. Sensitive values are not written to logs."},
        {"q": "Does a result guarantee the rest of the internet sees the same thing?", "a": "No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider."},
    ]


def build_input(spec):
    """(name, label, type, placeholder, required[, choices[, hint]]) → catalogue input.

    `choices` makes a select self-describing: the options live with the field that uses them
    instead of in a name-keyed table in the view, so two tools can both have a `mode` select
    without one inheriting the other's options. `hint` is rendered next to the control.
    """
    name, label, kind, placeholder, required = spec[:5]
    choices = spec[5] if len(spec) > 5 else None
    hint = spec[6] if len(spec) > 6 else None
    accept = spec[7] if len(spec) > 7 else None
    field = {"name": name, "label": label, "type": kind, "placeholder": placeholder, "required": required}
    if choices:
        field["choices"] = dict(choices)
    if hint:
        field["hint"] = hint
    if accept:
        field["accept"] = accept
    return field


def build_tools():
    tools = []
    for tool in RAW:
        cat = tool["category"]
        item = {
            "slug": tool["slug"],
            "name": tool["name"],
            "category": cat,
            "categoryLabel": CATEGORIES[cat],
            "icon": cat,
            "summary": tool["summary"],
            "description": tool["description"] or (tool["summary"] + " CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in."),
            "seoTitle": f"{tool['name']} — Free {CATEGORIES[cat]} Tool | CloudHost247",
            "seoDescription": tool["summary"] + " Free CloudHost247 tool for administrators, developers and website owners.",
            "keywords": tool["keywords"] + [tool["slug"], cat, tool["name"].lower()],
            "aliases": tool["aliases"],
            "path": f"/tools/{tool['slug']}",
            "legacyPaths": [],
            "mode": tool["mode"],
            "handler": tool["handler"],
            "options": tool["options"],
            "inputs": [build_input(spec) for spec in tool["inputs"]],
            "relatedTools": [],
            "services": [{"label": label, "url": url} for label, url in SERVICES[cat]],
            "faq": tool["faq"] or faq(tool),
            "badge": "Browser-only" if tool["mode"] == "local" else "Live check",
            "featured": tool["featured"],
            "sensitive": tool["sensitive"],
            "collection": COLLECTION_BY_TOOL.get(tool["slug"], ""),
            "enabled": True,
        }
        tools.append(item)
    by_cat = {}
    for item in tools:
        by_cat.setdefault(item["category"], []).append(item["slug"])
    for item in tools:
        siblings = [s for s in by_cat[item["category"]] if s != item["slug"]]
        item["relatedTools"] = siblings[:4]
    return tools


NEW_PAGES = [
    ("business-hosting.php", "business-hosting", "Business Hosting", "Hosting", "hosting/business-hosting", "A calmer home for a business website.", "Compare hosting for a company site, with room for email and a domain you already own.", ["web-hosting.php", "email-hosting.php", "domain.php"]),
    ("reseller-hosting.php", "reseller-hosting", "Reseller Hosting", "Hosting", "hosting/reseller-hosting", "Infrastructure for teams who host more than one site.", "Review reseller-style hosting only against the plans currently published in the catalog.", ["web-hosting.php", "cpanel-hosting.php", "cloudhost247-hosting.php"]),
    ("nodejs-hosting.php", "nodejs-hosting", "Node.js Hosting", "Developers", "deployment/nodejs", "A place to run the Node.js version your app requires.", "Confirm the runtime, process manager and resources on the plan before you deploy.", ["developer-friendly.php", "paas.php", "vps-hosting.php"]),
    ("php-hosting.php", "php-hosting", "PHP Hosting", "Developers", "deployment/php", "PHP hosting with the version your application documents.", "Match the PHP version, extensions and database to the application you are moving.", ["web-hosting.php", "cpanel-hosting.php", "developer-friendly.php"]),
    ("python-hosting.php", "python-hosting", "Python Hosting", "Developers", "deployment/python", "Python workloads on a plan that states its runtime.", "Check the interpreter version and process model in the published plan, not in a slogan.", ["developer-friendly.php", "vps-hosting.php", "paas.php"]),
    ("docker-hosting.php", "docker-hosting", "Docker Hosting", "Developers", "deployment/docker", "Containers when the selected platform actually offers them.", "Deployment availability comes from the connected catalog. This page does not invent images.", ["paas.php", "deployments.php", "vps-hosting.php"]),
    ("laravel-hosting.php", "laravel-hosting", "Laravel Hosting", "Developers", "deployment/laravel", "Hosting considerations for a Laravel application.", "Confirm PHP, queue, scheduler and database requirements against the plan you select.", ["php-hosting.php", "developer-friendly.php", "web-hosting.php"]),
    ("api-hosting.php", "api-hosting", "API Hosting", "Developers", "deployment/api", "A foundation for HTTP APIs you operate.", "Choose compute and a hostname, then confirm TLS and rate limits for your own API.", ["developer-friendly.php", "vps-hosting.php", "ssl-certificate.php"]),
    ("paas.php", "paas", "PaaS", "Developers", "deployment/paas", "Application deployment when the platform catalog is connected.", "The deployment pipeline is described honestly: queue, worker, domains and environment variables where implemented.", ["deployments.php", "developer-friendly.php", "applications.php"]),
    ("data-centers.php", "data-centers", "Data Centers", "Infrastructure", "cloud/data-centers", "Locations only when a product configuration names them.", "This page does not publish a city list. Available locations are the ones attached to a plan.", ["infrastructure.php", "vps-hosting.php", "dedicated-server.php"]),
    ("network.php", "network", "Network", "Infrastructure", "cloud/network", "How to read the network details a plan actually publishes.", "Transit, bandwidth and addresses are plan fields, not a global claim on this page.", ["infrastructure.php", "vps-hosting.php", "firewall.php"]),
    ("security.php", "security", "Security", "Infrastructure", "security/platform-security", "Security controls you can verify from your account and our policies.", "TLS, access and abuse handling are documented. Certifications are listed only when published.", ["ssl-certificate.php", "web-hosting.php", "help-center.php"]),
    ("monitoring.php", "monitoring", "Monitoring", "Infrastructure", "management/monitoring", "Service status and the checks your plan exposes.", "Public status is the status page. Per-server graphs appear in the client area when the product provides them.", ["server-management.php", "vps-hosting.php", "help-center.php"]),
    ("backups.php", "backups", "Backups", "Infrastructure", "management/backups", "Backup options depend on the product you buy.", "Read the backup policy and the plan description. This page does not promise a retention period the catalog does not state.", ["backup-policy.php", "server-management.php", "web-hosting.php"]),
    ("firewall.php", "firewall", "Firewall", "Infrastructure", "management/firewall", "Firewall controls when the server product includes them.", "Open the service in your account to see which rules you can change. Marketing pages do not toggle live firewalls.", ["server-management.php", "security.php", "vps-hosting.php"]),
    ("dns-management.php", "dns-management", "DNS Management", "Domains", "domains/dns-management", "Manage DNS for domains in your account, and diagnose any name with the tools.", "Authoritative edits happen in the client area. The tools are read-only diagnostics.", ["domain.php", "domain-dns.php", "web-hosting.php"]),
    ("domain-dns.php", "domain-dns", "Domain DNS", "Domains", "domains/domain-dns", "DNS for the domains you register or transfer to CloudHost247.", "Nameserver and record changes are available from the domain management screen after registration.", ["domain.php", "dns-management.php", "web-hosting.php"]),
    ("ip-management.php", "ip-management", "IP Management", "Infrastructure", "management/ip-management", "Addresses assigned to a service are listed on that service.", "Additional addresses, if offered, are part of the product configuration rather than a public claim.", ["server-management.php", "vps-hosting.php", "dedicated-server.php"]),
    ("migration.php", "migration", "Migration", "Infrastructure", "management/migration", "Plan a move with the team before you change nameservers.", "Migrations are scoped per project. Contact the team with the source panel and the target plan.", ["web-hosting.php", "help-center.php", "aboutus.php"]),
    ("managed-services.php", "managed-services", "Managed Services", "Infrastructure", "management/managed-services", "Ask for management only where a plan offers it.", "Managed options are confirmed in a proposal or plan feature, not assumed for every server.", ["enterprise-servers.php", "server-management.php", "help-center.php"]),
    ("documentation.php", "documentation", "Documentation", "Resources", "blog/documentation", "Product guidance lives in the knowledgebase and the help center.", "Search published articles, then open a ticket if the article does not cover your service.", ["help-center.php", "faqs.php", "blog.php"]),
]


def svg(title, caption):
    safe = (caption or title).upper().replace("&", "&amp;")[:42]
    label = title.replace("&", "&amp;")
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 660 560" width="660" height="560" role="img"><title>{label}</title><defs><radialGradient id="glow"><stop stop-color="#266758" stop-opacity=".35"/><stop offset="1" stop-color="#101e2c" stop-opacity="0"/></radialGradient></defs><rect width="660" height="560" fill="#101e2c"/><ellipse cx="330" cy="280" rx="280" ry="210" fill="url(#glow)"/><g fill="none" stroke="#365264" stroke-width=".7" opacity=".45"><path d="M40 80 620 480M40 480 620 80M120 60 540 500M120 500 540 60"/></g><g transform="translate(330 250)"><ellipse cx="0" cy="78" rx="120" ry="36" fill="#08121a" opacity=".55"/><path d="m-110-10 110-62 110 62v52L0 104l-110-62Z" fill="#132b37" stroke="#68b996"/><path d="m-110-10 110 62 110-62" fill="none" stroke="#68b996"/><path d="m-110-10 110-62 110 62L0 52Z" fill="#1d3b34" stroke="#b4f2cd"/><circle cx="0" cy="8" r="16" fill="none" stroke="#b4f2cd" stroke-width="3"/><path d="M-6 8h12M0 2v12" stroke="#b4f2cd" stroke-width="3"/></g><text x="48" y="510" fill="#b4f2cd" font-size="13" font-family="DejaVu Sans,Arial,sans-serif" letter-spacing="2">{safe}</text></svg>'''


def icon_svg(slug):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img"><title>{slug}</title><rect width="64" height="64" rx="14" fill="#132b37"/><path d="M16 40V24l16-9 16 9v16L32 49 16 40Z" fill="none" stroke="#b4f2cd" stroke-width="2.4"/></svg>'''


def write_pages(site):
    for path, slug, title, category, visual, headline, summary, related in NEW_PAGES:
        php = ROOT / path
        if not php.exists():
            php.write_text(
                "<?php\n"
                f"/**\n * {title} — public route.\n *\n"
                " * Renders the published theme entry. Editorial fallback covers the route\n"
                " * until an administrator publishes a replacement. Prices and availability\n"
                " * still come only from the product catalog.\n */\n"
                "define('CLIENTAREA', true);\n"
                "require __DIR__ . '/init.php';\n"
                "require_once __DIR__ . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';\n\n"
                f"\\CloudHost247\\Theme\\PublicPage::route(new \\WHMCS\\ClientArea(), {slug!r}, {title!r});\n"
            )
        asset = ROOT / "assets/images/cloudhost247" / f"{visual}.svg"
        asset.parent.mkdir(parents=True, exist_ok=True)
        if not asset.exists():
            asset.write_text(svg(title, title))
        site["pages"][path] = {
            "title": title,
            "category": category,
            "headline": headline,
            "summary": summary,
            "visual": visual,
            "features": [
                ["Confirm the plan", "Published specifications are the source of truth for resources and software."],
                ["Keep ownership", "Bring a domain you already control, or register one in the same account."],
                ["Ask before you migrate", "The team can scope a move when you share the source and the target plan."],
            ],
            "uses": ["New projects", "Migrations", "Teams standardizing on one provider"],
            "related": related,
            "slug": slug,
        }


def collection_nav_links():
    """Tools-menu entries for the curated collections: the hub page, then its flagship tool."""
    pairs = []
    for collection in COLLECTIONS:
        pairs.append((collection["name"], collection["path"].lstrip("/")))
        for group in collection["groups"]:
            for slug in group["tools"]:
                if slug == "mrz-generator":
                    pairs.append(("MRZ Generator", "tools/mrz-generator"))
                    break
            else:
                continue
            break
    return pairs


def navigation(tools):
    def links(pairs):
        return [{"label": label, "url": url} for label, url in pairs]

    featured = [(t["name"], "tools/" + t["slug"]) for t in tools if t["featured"]]
    groups = []
    for slug, label in CATEGORIES.items():
        items = [(t["name"], "tools/" + t["slug"]) for t in tools if t["category"] == slug and t["slug"] in REQUIRED_SLUGS]
        groups.append({"title": label, "links": links(items)})
    return [
        {"title": "Hosting", "description": "Give your website a place to grow.", "groups": [
            {"title": "Web hosting", "links": links([
                ("Web Hosting", "web-hosting.php"), ("WordPress", "wordpress-hosting.php"), ("Business", "business-hosting.php"),
                ("cPanel", "cpanel-hosting.php"), ("Plesk", "plesk-hosting.php"), ("Windows", "windows-hosting.php"),
                ("Email", "email-hosting.php"), ("Reseller", "reseller-hosting.php"),
            ])},
            {"title": "Cloud", "links": links([
                ("Cloud Hosting", "cloudhost247-hosting.php"), ("Public Cloud", "vps-publiccloud.php"), ("Private Cloud", "vps-privatecloud.php"),
                ("VPS", "vps-hosting.php"), ("Dedicated", "dedicated-server.php"), ("Enterprise", "enterprise-servers.php"),
            ])},
            {"title": "Developer", "links": links([
                ("Node.js", "nodejs-hosting.php"), ("PHP", "php-hosting.php"), ("Python", "python-hosting.php"),
                ("Docker", "docker-hosting.php"), ("Laravel", "laravel-hosting.php"), ("APIs", "api-hosting.php"),
                ("PaaS", "paas.php"), ("Deployment", "deployments.php"),
            ])},
        ]},
        {"title": "Cloud & Servers", "description": "Build on the right foundation.", "groups": [
            {"title": "Servers", "links": links([
                ("VPS", "vps-hosting.php"), ("Public Cloud", "vps-publiccloud.php"), ("Private Cloud", "vps-privatecloud.php"),
                ("Dedicated", "dedicated-server.php"), ("Enterprise", "enterprise-servers.php"), ("Game Servers", "game-servers.php"),
            ])},
            {"title": "Operating systems", "links": links([
                ("OS catalog", "operating-systems.php"), ("Ubuntu", "operating-systems.php#ubuntu"), ("Debian", "operating-systems.php#debian"),
                ("AlmaLinux", "operating-systems.php#almalinux"), ("Rocky Linux", "operating-systems.php#rocky"), ("Windows Server", "operating-systems.php#windows"),
            ])},
            {"title": "Images", "links": links([
                ("WordPress", "operating-systems.php#wordpress"), ("Docker", "operating-systems.php#docker"), ("LAMP", "operating-systems.php#lamp"),
                ("LEMP", "operating-systems.php#lemp"), ("cPanel", "operating-systems.php#cpanel"), ("Plesk", "operating-systems.php#plesk"),
            ])},
            {"title": "Management", "links": links([
                ("Monitoring", "monitoring.php"), ("Backups", "backups.php"), ("Security", "security.php"),
                ("Firewall", "firewall.php"), ("DNS", "dns-management.php"), ("SSL", "ssl-certificate.php"),
                ("IP Management", "ip-management.php"), ("Server control", "clientarea.php?action=services"),
                ("Status", "serverstatus.php"), ("Migration", "migration.php"), ("Managed Services", "managed-services.php"),
            ])},
        ]},
        {"title": "Domains", "description": "Make a name for your next idea.", "groups": [
            {"title": "Find a domain", "links": links([
                ("Domain Search", "domain.php"), ("Registration", "cart.php?a=add&domain=register"),
                ("Transfer", "cart.php?a=add&domain=transfer"), ("Pricing", "index.php?rp=/domain/pricing"),
            ])},
            {"title": "Management", "links": links([
                ("Domain Management", "clientarea.php?action=domains"), ("DNS", "domain-dns.php"),
                ("Renewal Policy", "domain-renewal-policy.php"), ("Brokerage Terms", "domain-brokerage-terms.php"),
            ])},
            {"title": "Diagnostics", "links": links([
                ("DNS Checker", "tools/dns-checker"), ("DNS Lookup", "tools/dns-lookup"), ("Domain WHOIS", "tools/domain-whois"),
            ])},
        ]},
        {"title": "Applications", "description": "Software the catalog can actually deploy.", "groups": [
            {"title": "CMS", "links": links([
                ("Application catalog", "applications.php"), ("WordPress", "wordpress-hosting.php"), ("Ghost", "applications.php#ghost"),
            ])},
            {"title": "Ecommerce", "links": links([
                ("PrestaShop", "applications.php#prestashop"), ("All applications", "applications.php"),
            ])},
            {"title": "Developer", "links": links([
                ("Node.js", "nodejs-hosting.php"), ("PHP", "php-hosting.php"), ("Python", "python-hosting.php"),
                ("Laravel", "laravel-hosting.php"), ("Docker", "docker-hosting.php"),
            ])},
        ]},
        {"title": "Developers", "description": "A foundation for whatever you build next.", "groups": [
            {"title": "Runtimes", "links": links([
                ("Node.js", "nodejs-hosting.php"), ("PHP", "php-hosting.php"), ("Python", "python-hosting.php"),
                ("Docker", "docker-hosting.php"), ("Laravel", "laravel-hosting.php"), ("APIs", "api-hosting.php"),
                ("PaaS", "paas.php"), ("Deployment", "deployments.php"),
            ])},
            {"title": "Operate", "links": links([
                ("Server Management", "server-management.php"), ("Operating Systems", "operating-systems.php"), ("VPS", "vps-hosting.php"),
            ])},
            {"title": "Reference", "links": links([
                ("Documentation", "documentation.php"), ("Knowledgebase", "knowledgebase.php"), ("Tools", "tools"),
            ])},
        ]},
        {"title": "Tools", "description": "Free professional tools for DNS, networking, developers, security and webmasters.", "groups": [
            {"title": "Compliance & Document", "links": links(collection_nav_links())},
            {"title": "Featured", "links": links(featured)},
            *groups,
        ]},
        {"title": "Resources", "description": "Find answers. Keep moving forward.", "groups": [
            {"title": "Learn", "links": links([
                ("Knowledgebase", "knowledgebase.php"), ("Blog", "blog.php"), ("FAQs", "faqs.php"), ("Documentation", "documentation.php"),
            ])},
            {"title": "Support", "links": links([
                ("Help Center", "help-center.php"), ("Submit Ticket", "submitticket.php"), ("System Status", "serverstatus.php"), ("Offers", "offers.php"),
            ])},
            {"title": "Company", "links": links([
                ("About", "aboutus.php"), ("Contact", "contact.php"), ("Infrastructure", "infrastructure.php"), ("Legal", "legal.php"),
            ])},
        ]},
    ]


def footer(existing, tools):
    featured = [("Compliance & Document Tools", "tools/compliance-documents"),
                ("MRZ Generator", "tools/mrz-generator"),
                ("DNS Checker", "tools/dns-checker"), ("DNS Lookup", "tools/dns-lookup"), ("IP WHOIS", "tools/ip-whois"),
                ("SSL Checker", "tools/ssl-certificate-checker"), ("Port Checker", "tools/port-checker"),
                ("JSON Beautifier", "tools/json-beautifier"), ("QR Generator", "tools/qr-code-generator"),
                ("Speed Test", "tools/internet-speed-test")]
    tool_links = [{"label": "All Tools", "url": "tools"}]
    for slug, label in CATEGORIES.items():
        tool_links.append({"label": label + " Tools", "url": "tools/category/" + slug})
    tool_links += [{"label": label, "url": url} for label, url in featured]
    replaced = False
    out = []
    for group in existing:
        if group.get("title") == "Tools":
            out.append({"title": "Tools", "links": tool_links})
            replaced = True
        else:
            out.append(group)
    if not replaced:
        out.append({"title": "Tools", "links": tool_links})
    return out


def main():
    tools = build_tools()
    public = {"generatedFrom": "scripts/generate-global-platform.py", "categories": CATEGORIES,
              "collections": COLLECTIONS, "tools": tools}
    PUBLIC.write_text(json.dumps(public, indent=2) + "\n")
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    INDEX.write_text(json.dumps({"count": len(tools), "required": REQUIRED_SLUGS, "slugs": [t["slug"] for t in tools]}, indent=2) + "\n")
    REQUIRED.write_text(json.dumps(REQUIRED_SLUGS, indent=2) + "\n")
    php = ROOT / "config/tools.php"
    php.write_text("<?php\n/** Authoritative public tools catalogue. Generated. Do not edit by hand. */\nreturn " + php_export(public) + ";\n")
    site = json.loads(SITE.read_text())
    write_pages(site)
    site["navigation"] = navigation(tools)
    site["footer"] = footer(site["footer"], tools)
    SITE.write_text(json.dumps(site, indent=2) + "\n")
    tools_dir = ROOT / "assets/images/cloudhost247/tools"
    tools_dir.mkdir(parents=True, exist_ok=True)
    for slug in list(CATEGORIES) + ["hero"]:
        dest = tools_dir / f"{slug}.svg"
        if not dest.exists():
            dest.write_text(svg(slug.title() + " tools", "CH247 / " + slug.upper()))
    apps = ROOT / "assets/images/cloudhost247/applications"
    apps.mkdir(parents=True, exist_ok=True)
    for name in ("wordpress", "ghost", "prestashop", "node", "php", "python", "laravel", "docker"):
        dest = apps / f"{name}.svg"
        if not dest.exists():
            dest.write_text(icon_svg(name))
    print(f"tools={len(tools)} required={len(REQUIRED_SLUGS)} pages={len(site['pages'])}")


def php_export(value, indent=0):
    pad = "    " * indent
    if isinstance(value, dict):
        rows = []
        for key, item in value.items():
            rows.append(f"{pad}    {php_str(key)} => {php_export(item, indent + 1)}")
        return "array(\n" + ",\n".join(rows) + f"\n{pad})"
    if isinstance(value, list):
        if not value:
            return "array()"
        rows = [f"{pad}    {php_export(item, indent + 1)}" for item in value]
        return "array(\n" + ",\n".join(rows) + f"\n{pad})"
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return str(value)
    return php_str(value)


def php_str(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


if __name__ == "__main__":
    main()
