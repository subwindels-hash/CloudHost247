# Configuration

Two surfaces: **Admin → Addons → CloudHost247 Network Tools** (operator
settings, tools, resolvers, providers, health, analytics, abuse) and the
per-tool states. Settings are stored in `mod_cloudhost247_nt_tool_settings` and
applied through `SettingsRepository`.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `enabled` | `1` | Master switch. Off = every tool answers `SERVICE_UNAVAILABLE`. |
| `public_access` | `1` | Whether `visibility: public` tools run for guests. `0` = sign-in required. |
| `trust_proxy_headers` | `0` | Use `X-Forwarded-For` for the caller IP. Enable only behind a trusted proxy, otherwise the limit is trivially spoofed. |
| `history_enabled` | `1` | Per-customer history. |
| `history_retention_days` | `90` | History retention enforced by the cron worker. |
| `monitoring_enabled` | `1` | Saved-domain monitors and alerts. |
| `ai_explanations_enabled` | `1` | Allow AI explanations (only from real structured results). |
| `analytics_retention_days` | `180` | Execution-log retention. |
| `default_timeout_seconds` | `10` | Fallback tool timeout. |
| `dns_timeout_seconds` | `5` | Per-resolver DNS timeout. |
| `dns_retries` | `2` | DNS retries per query. |
| `propagation_resolver_limit` | `40` | Maximum resolvers queried per propagation run. |
| `propagation_timeout_seconds` | `20` | Wall-clock budget for a propagation run. |
| `crawl_max_pages` | `10` | Broken-link crawler page budget (same site only). |
| `crawl_max_links` | `250` | Links checked per crawl. |
| `crawl_max_runtime_seconds` | `25` | Crawler wall-clock budget. |
| `crawl_max_response_bytes` | `524288` | Per-response byte cap for the crawler. |
| `http_max_response_bytes` | `262144` | Per-response byte cap for other HTTP tools. |
| `speedtest_max_megabytes` | `8` | Download cap for the speed test. |
| `speedtest_max_seconds` | `20` | Speed-test budget. |
| `abuse_block_threshold` | `5` | Failures before a temporary block. |
| `resolver_health_interval_minutes` | `15` | Cron resolver health interval. |
| `provider_health_interval_minutes` | `30` | Cron provider health interval. |
| `geoip_provider` | (empty) | Preferred IP-intelligence provider (`ipinfo`/`ipwhoapi`). |
| `ssl_monitor_intervals` | `30,14,7,3,1` | Days before expiry at which monitors notify. |
| `default_history_scope` | `metadata` | Default history detail level. |

The module also stores an **API token** (module setting, not the settings
table). An empty token disables the REST surface with
`CONFIGURATION_REQUIRED`.

## Per-tool state

For every tool the admin can set: enabled/disabled, maintenance mode,
visibility (`public` / `customer` / `admin`), timeout, cache duration, rate-limit
overrides and feature flags. Disabled and maintenance tools explain themselves in
the UI and answer `TOOL_DISABLED` / `MAINTENANCE` over the API rather than
silently disappearing.

## Environment variables

| Variable | Effect |
| --- | --- |
| `CH247_NT_ALLOW_PRIVATE_HOSTS` | `1`/`true`/`yes` lifts the private-address block. For an operator-run internal deployment only; the health screen shows it is on. |
| `CH247_NT_ALLOWED_HOSTS` | Comma-separated allowlist of target hosts. When set, all other hosts are `TARGET_BLOCKED`. |
| `CH247_INTEGRATIONS_KEY` | `cloudhost247_integrations` vault key (required to store provider credentials). |
| `CH247_INTEGRATION_ALLOW_PRIVATE_HOSTS` | Same escape hatch for integration provider endpoints. |

Environment variables are the *only* way to relax the SSRF policy; no customer
or API caller can do it.

## Caching

Each tool declares `cache_seconds` (0 = never). Only successful results are
cached, and never for tools with sensitive input, client-only tools, or
admin-scoped tools. The cache key is the slug plus the validated input; the
cache table stores the result payload and its timestamp, never credentials.

## Retention

The cron worker prunes history, execution logs, health rows and rate-limit
counters according to the retention settings, and flushes expired cache rows.
