# CloudHost247 Tools Platform (v2.2.7)

DNSChecker-style online tools platform for the WHMCS 8.9 client area — 79 tools
across 9 categories, with an admin manager, activity logs, response caching,
rate limiting and a token-authenticated REST API.

Compatible with WHMCS 8.9+ / PHP 7.4+ and both CloudHost247 themes (native and
legacy). No WHMCS core files are modified.

## Structure

```
modules/addons/cloudhost247_tools/
├── cloudhost247_tools.php     # WHMCS entry (config, activate via MigrationRunner, admin/client output)
├── bootstrap.php              # wires the module into the shared CloudHost247 foundation
├── hooks.php                  # client-area asset injection for module pages
├── migrations/V227.php        # guarded, namespaced initial schema (safe over 2.2.6 installs)
├── includes/
│   ├── functions.php          # sanitizers, validators, CSRF, rate limit, cache, cURL, logging
│   ├── classes.php            # admin + client controllers
│   ├── api.php                # shared tool executor, cache policy, REST support layer
│   ├── dns_client.php         # pure-PHP RFC 1035 UDP resolver (no `dig`, no shell)
│   └── tools/                 # one file per category, ~65 tool handlers
├── api/index.php              # REST API endpoint (token-authenticated JSON)
├── templates/client/          # dashboard / category / tool pages (all output escaped)
└── assets/                    # platform CSS + JS (AJAX, renderers, search)
```

## Client area

- `index.php?m=cloudhost247_tools` — dashboard with all categories and a live search bar
- `…&action=category&cat=dns` — category page
- `…&action=tool&tool=mx_lookup` — tool page; results load via AJAX
  (`…&action=ajax`, POST, CSRF-protected, rate-limited, no page reload)

Tools are usable by guests (`requirelogin => false`); every request passes
validation, the enable-check, the rate limiter and the logger.

## Admin area

Addon Modules → CloudHost247 Tools Platform:

- **Dashboard** — usage stats, top tools, recent activity
- **Tools Manager** — enable/disable each of the 79 tools (POST + CSRF token)
- **Activity Logs** — tool usage log with input truncation
- **Settings** — cache management (clear cache is POST + token, not a GET link)

Module configuration (Configure button): WHOIS/GeoIP/OCR API keys, REST API
token, proxy-header trust, rate limit, cache duration (5–30 min), log toggle.

## Security model (v2.2.7 hardening)

| Area | Guarantee |
|---|---|
| Outbound HTTP | TLS certificate verification **enforced** (`VERIFYPEER true`, `VERIFYHOST 2`), max 4 redirects, non-HTTP(S) schemes refused |
| DNS propagation | Pure-PHP RFC 1035 UDP client — no `dig`, no `shell_exec` anywhere in the module |
| Rate limiting | Per-IP (AJAX) / per-token-hash (REST) over a 60 s window; forwarded headers (`X-Forwarded-For`, `CF-Connecting-IP`) are **ignored unless** `trust_proxy_headers` is enabled for sites behind a trusted proxy |
| CSRF | Client AJAX requires the session token; all admin mutations require WHMCS admin + POST token (`AdminGuard::requirePostToken`) |
| REST API | Disabled by default (empty token); token compared with `hash_equals`; rate-limit keys store only a token hash; client-stateful tools excluded |
| Output | Every Smarty variable in client templates is `\|escape`; JS renderers use `escapeHtml()`; admin HTML built with `htmlspecialchars` |
| Logging | Inputs truncated to 500 chars, `csrf_token`/`token` values stripped, results to 10 KB, errors to 1 KB |
| Sessions | Notepad content capped at 256 KB |
| GeoIP | HTTPS-only provider (ipwho.is); the HTTP-only ip-api.com endpoint was removed |

## Response caching

Dispatcher-level cache (5–30 min, admin-configured) applies to deterministic
lookups (DNS, WHOIS, SSL, headers, blacklist…). Requester-reflective tools
(What is my IP, User Agent), random tools (password generator) and live
probes (ping, traceroute, port checker, availability, SMTP) are never cached;
errors are never cached.

## REST API

```
GET  modules/addons/cloudhost247_tools/api/index.php?action=list
POST modules/addons/cloudhost247_tools/api/index.php?action=run   (tool=<id> + params)
```

Authenticate with the admin-configured `api_token` module setting, sent as
`X-API-Token`, `Authorization: Bearer …`, or a POST `token` field. Responses
are JSON with HTTP status codes (401/404/429/200…). Server-to-server use;
same-origin by default (no CORS headers).

## Upgrading from 2.2.6

Activation now runs the guarded `V227` migration through the shared foundation
MigrationRunner. On an existing 2.2.6 install the tables already exist, so the
migration is recorded as applied and **all data is preserved**. Deactivation
never drops tables.

## Testing

`php tests/tools/run.php` — behavior suite (registry, sanitizers, CSRF, rate
limit, cache, executor, RFC 1035 wire client, REST layer, 30+ tool handlers,
admin/client controllers, migration) against an in-memory database fake.
`python3 -m unittest tests.tools.test_static` — structural/security invariants.

Both run in CI (Release candidate workflow) and in
`scripts/release-candidate-check.sh`; the module is in the repo's security
OWNED scan.
