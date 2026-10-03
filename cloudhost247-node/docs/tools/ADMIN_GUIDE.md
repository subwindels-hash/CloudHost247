# Tools Center — administrator guide

Everything here is reachable from **Admin → Tools Center** (`/admin/tools`) for `admin` and
`super_admin` roles, and every mutation is written to the platform audit log
(`audit_logs`) via `auditRequest` with a `TOOL_*` action.

## 1. Master switches

Stored in `platform_settings` (Admin → Settings, or SQL):

| Key | Default | Effect |
| --- | --- | --- |
| `tools.enabled` | `true` | Master switch. When `false`, tools report `SERVICE_UNAVAILABLE`; catalogue, history, favorites and saved reports stay readable. |
| `tools.anonymous_access` | `true` | Whether signed-out visitors may run public tools. Non-public tools always require a session. |
| `tools.abuse_block_threshold` | `25` | Rate-limit/abuse rejections from one IP within an hour before that IP is temporarily blocked from diagnostic tools. |
| `tools.abuse_block_minutes` | `60` | How long a temporary block lasts. |
| `tools.speed_test_max_bytes` | `20971520` (20 MB) | Cap on a single speed-test transfer. Lowered automatically to the 32 MB hard ceiling; the download/upload endpoints and the published browser configuration all read this value. |
| `tools.speed_test_max_ms` | `15000` | Time budget the browser-side speed test is given (published as `limits.totalBudgetMs`, capped at 60 s). |
| `tools.monitor_sweep_batch` | `25` | Monitors evaluated per worker cycle. |
| `tools.resolver_health_batch` | `6` | Resolvers health-checked per worker cycle. |

These are read at request/cycle time — changing a value takes effect on the next call, no restart.

## 2. Tool overrides

The catalogue lives in code (`src/tools/catalog.ts`) and defines what a tool *is*. The
`tool_definitions` table holds only deployment overrides, so an upgrade can never lose a tool's
identity and an operator can never invent one that has no implementation.

`GET /api/admin/tools/tools` lists every tool with its effective values. `PATCH
/api/admin/tools/tools/:slug` accepts:

| Field | Use |
| --- | --- |
| `statusOverride` | `ACTIVE` / `DISABLED` / `MAINTENANCE` / `CONFIGURATION_REQUIRED` / `SERVICE_UNAVAILABLE` |
| `maintenanceMessage` | Shown to customers in place of running the tool |
| `enabled` | `false` behaves as `DISABLED` |
| `visibility` | `public` / `customer` / `admin` — who may see and run it |
| `rateLimitProfile` | `light` / `standard` / `heavy` / `restricted` |
| `timeoutMs` | Per-tool upstream budget (500 ms – 60 s) |
| `cacheSeconds` | Result cache TTL (0 disables caching for that tool) |
| `loggingEnabled` | Whether executions are written to `tool_execution_logs` |
| `providerSlug` | Pin the tool to one specific provider instead of any usable one |
| `name`, `description` | Override the customer-facing wording |
| `featureFlags` | Free-form JSON bag for future flags |

`DELETE /api/admin/tools/tools/:slug/override` removes the override, returning the tool to its
catalogue defaults. The Tools tab in the UI exposes status, rate-limit profile, cache TTL and reset
directly.

### Maintenance and disablement in practice

Setting a tool to `MAINTENANCE` with a message is the right way to pause one tool without touching
`tools.enabled` (which stops everything). Customers see the message on the card and get a
deterministic `503` from the API instead of a timeout.

## 3. Providers

External services are rows in `tool_provider_configs`, seeded by migration 0067:

| Provider slug | Kind | Used by |
| --- | --- | --- |
| `spamhaus-zen`, `spamcop`, `sorbs`, `uceprotect-level1`, `spfbl`, `blocklist-de`, `barracuda` | DNSBL | IP blacklist checker |
| `ip-geolocation` | GEOLOCATION | IP lookup enrichment (city/coordinates/ISP) |
| `reverse-ip` | REVERSE_IP | Reverse IP domain listing |
| `bin-lookup` | BIN | BIN/IIN checker |
| `scan-ocr` | OCR | Image OCR |
| `dkim-verify` | DKIM_VERIFY | Full DKIM signature verification |
| `availability` | AVAILABILITY | Registry-backed domain availability where an operator supplies one |

For each provider the admin page shows whether it is *usable* right now and, when it is not, the
exact reason (`Disabled by an administrator.`, `No API credential has been stored for this
provider.`, `No endpoint has been configured for this provider.`).

Saving a provider (`PUT /api/admin/tools/providers/:slug`):

* `apiKey` / `apiSecret` are encrypted with AES-256-GCM using the deployment key ring
  (`CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY_KEYS`) and are **never** returned by any
  endpoint or written to a log.
* If the deployment has no key ring, the save fails with `CONFIGURATION_REQUIRED` telling you to set
  the key — it does not fall back to storing plaintext.
* `Test connection` performs a real probe (DNS query or HTTP fetch, chosen by provider kind) and
  records the outcome in `tool_health_checks` plus the provider's health columns.

Providers with no usable configuration make their tools answer `CONFIGURATION_REQUIRED`. That is
intended: the alternative — silently returning "no results" — is what makes customers distrust a
tools site.

## 4. Resolvers

The `tool_resolvers` registry is seeded with 26 public resolvers (Cloudflare, Google, Quad9,
OpenDNS, AdGuard, DNS.WATCH, CleanBrowsing, Comodo, Level3, Yandex, Verisign) across UDP, TCP and
DNS-over-HTTPS. The registry powers:

* DNS Lookup, DNS Propagation (one row per resolver), Reverse DNS, DNS Health, Domain Health;
* the health sweeps that mark resolvers `HEALTHY` / `DEGRADED` / `DOWN`.

`POST /api/admin/tools/resolvers` adds one; `PATCH` changes it; `POST /api/admin/tools/resolvers/:id/test`
probes it with a real query and updates its health. Resolvers can be disabled individually, and the
propagation tool simply omits disabled ones rather than pretending they answered.

## 5. Health, sweeps and cache

The Tools Center reuses the platform worker (`src/worker/main.ts`, also runnable by cron via
`npm run worker:once`):

* every **15 minutes** — provider health sweep and resolver health sweep;
* every **5 minutes** — monitor sweep (SSL expiry, DNS record, e-mail configuration).

Batch sizes come from the settings in §1. The admin page can trigger any of these immediately
(`POST /api/admin/tools/sweep`, `POST /api/admin/tools/run-tools-sweep`) and shows the most recent
rows from `tool_health_checks`.

`POST /api/admin/tools/cache/clear` (optionally with `{"toolSlug":"dns-lookup"}`) empties
`tool_cache`. Use it after changing a resolver's answers or when you have fixed an upstream problem
and want fresh results immediately.

`GET /api/admin/tools/overview` returns the dashboard metrics: executions, executions today,
non-success count, rate-limit and abuse-block counts, per-tool volume with failure counts and
average duration, per-category totals, override count, provider health and resolver health.

## 6. Capabilities — what this server can actually do

`src/tools/core/capabilities.ts` detects, at boot and on demand, whether the deployment has:
`dns-udp`, `dns-doh`, `tcp-connect`, `icmp-ping`, `traceroute`, `tls-client`, `smtp-client`,
`http-fetch`, `raw-socket`. On typical cPanel shared hosting, `icmp-ping`, `traceroute` and
`raw-socket` are unavailable.

Unavailable capabilities do **not** silently degrade the answer:

* Ping reports TCP timing and labels it as such when ICMP is unavailable.
* Traceroute reports `CAPABILITY_UNAVAILABLE` with the reason, rather than printing a made-up route.
* Admin → Tools shows the capability report so the hosting limitation is visible before a customer
  asks about it.

`POST /api/admin/tools/capabilities/refresh` re-runs detection after an environment change.

## 7. Domain context and cPanel

* IP Lookup, Reverse IP, SSL Checker, DNS Lookup, Domain Health and friends annotate results with
  whether the domain/server belongs to this account (`hostingContext` in the Domain Health Center),
  and link straight to the matching zone, site or SSL page.
* When a domain is hosted here, the Domain Health Center reports the site, zone and server the
  platform has on record, and offers actions such as opening the DNS zone editor.
* cPanel operations continue to go through the existing adapter; the Tools Center does not add a
  second control-panel integration path.

## 8. Support workflow

* Any tool result can be turned into a support ticket in one click
  (`POST /api/tools/:slug/ticket`). The ticket body contains the tool, target, timestamp and the
  verbatim JSON result, so support sees exactly what the customer saw.
* Results can be saved as reports (`/tools/reports`) and exported as JSON, CSV or Markdown, which is
  what most customers actually attach to an escalation.
* Monitors raise platform notifications (the existing notification bell) when a certificate crosses
  the warning threshold, a watched DNS record changes, or e-mail authentication stops passing.

## 9. Routine checks

1. **Admin → Tools → Overview**: any provider `DOWN`? any tool with a high failure count?
2. **Providers tab**: every provider used by customer-facing tools should read *usable*. "Needs
   setup" next to a tool in the catalogue is a configuration task, not a bug.
3. **Resolvers tab**: all six resolvers the propagation tool relies on should be `HEALTHY`; a
   `DEGRADED` resolver degrades propagation quality even though it does not fail it.
4. **Capabilities**: on shared hosting, confirm ICMP/traceroute are marked unavailable so nobody
   expects them.
5. After changing provider credentials: re-run **Test connection**, then clear the tool cache.
