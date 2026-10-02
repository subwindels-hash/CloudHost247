# CloudHost247 Network & Developer Tools — architecture

The tools platform is a first-party CloudHost247 addon
(`modules/addons/cloudhost247_network_tools/`) with one client front controller
(`tools.php`), one REST surface (`modules/addons/cloudhost247_network_tools/api/index.php`)
and one CLI worker (`crons/cloudhost247_network_tools.php`). It reuses the
existing CloudHost247 foundations instead of duplicating them:

| Concern | Reused component |
| --- | --- |
| Audit log, structured logging, redaction, safe errors | `cloudhost247_core` (`AuditLogger`, `Logger`, `SafeError`, `SecretPolicy`) |
| Capability/RBAC checks | `cloudhost247_core` `AdminGuard` + `mod_cloudhost247_capabilities` |
| Versioned migrations | `cloudhost247_core` `MigrationRunner` pattern |
| Customer/domain/hosting data | WHMCS `tblclients`, `tbldomains`, `tblhosting`, `tblproducts` (read-only, own records only) |
| Encrypted credentials, provider registry, SMTP | `cloudhost247_integrations` (`SecretVault`, `ProviderRegistry`, `Transport`, `SmtpClient`, `SmtpProbe`) |
| Navigation, assets, domain shortcuts | WHMCS `add_hook` client-area hooks in the addon's `hooks.php` |
| Email (monitor alerts, reports) | WHMCS `localAPI('SendEmail', …)` |
| UI | The active CloudHost247 client theme (`templates/cloudhost247/`) with the addon's CSS/JS |

## Layers

```
tools.php                     request intake: identity, CSRF, routing, caching, export, JSON mode
  └─ Core/Controller/ToolController.php     catalogue pages, single tool run, history, favourites, reports
       └─ Core/Runner/ToolRunner.php        the only execution path for every tool
            ├─ Core/Registry/               ToolRegistry + Catalog/*Catalog.php + ToolDefinition/ToolField
            ├─ Core/Security/               TargetValidator, SsrfGuard, RateLimiter, AbuseGuard
            ├─ Core/Repository/             one class per table (degrade quietly when the table is absent)
            └─ Services/<Category>/<Tool>Service.php   one class per tool (or tool family)
```

`ToolRunner::run()` is deliberately the only way a tool executes. It enforces,
in order: tool exists → module enabled → tool not disabled/in maintenance →
audience allowed → required providers configured → capabilities available →
input validated against the tool's own field schema → abuse and rate limits →
cache lookup → service execution → execution log (metadata only) → history.

A failure never carries a data payload: `ToolResult::failure()` has no data
argument, so a service cannot accidentally invent a result to cover an error.

## Data model (15 tables, all owned by the module)

| Table | Purpose |
| --- | --- |
| `mod_cloudhost247_nt_tool_definitions` | Catalogue snapshot, per-tool operator overrides (visibility, timeout, cache) |
| `mod_cloudhost247_nt_tool_categories` | Category metadata (name, icon, description, order) |
| `mod_cloudhost247_nt_tool_provider_configs` | Third-party / DNSBL data sources (endpoint, zone, field mapping, no secrets) |
| `mod_cloudhost247_nt_tool_execution_logs` | Metadata-only execution analytics (never input values) |
| `mod_cloudhost247_nt_tool_favorites` | Per-customer favourites |
| `mod_cloudhost247_nt_tool_history` | Per-customer history (clearable, target labels only, never sensitive input) |
| `mod_cloudhost247_nt_tool_rate_limits` | Rolling counters per IP/client/tool |
| `mod_cloudhost247_nt_tool_health_checks` | Resolver/provider/feature health history |
| `mod_cloudhost247_nt_dns_resolvers` | Resolver registry (provider, IP, protocol, version, location, priority, health) |
| `mod_cloudhost247_nt_dns_check_results` | Per-resolver propagation results (used by reports and monitors) |
| `mod_cloudhost247_nt_tool_cache` | Cached public results (credentials and sensitive inputs are never cached) |
| `mod_cloudhost247_nt_tool_settings` | Operator settings (see `configuration.md`) |
| `mod_cloudhost247_nt_tool_states` | Enable/disable, maintenance mode per tool |
| `mod_cloudhost247_nt_tool_monitors` | Saved-domain monitors and their baselines |
| `mod_cloudhost247_nt_tool_abuse_events` | Abuse signals and temporary blocks |

Tables are created by `migrations/V100.php` (version `1.0.0`), each guarded by
`hasTable()`, never dropping or renaming, and never touching a `tbl*` table.

## Request flows

* **Catalogue / tool page** — `tools.php` (Smarty `cloudhost247-tools`).
  Tool runs are `POST` with a CSRF token; `?format=json` returns the wire
  envelope instead of a page.
* **REST** — `api/index.php?route=dns/propagation` with `X-API-Token` (or
  `Authorization: Bearer`), disabled until an administrator sets the token.
* **Exports** — `export=csv|json|txt` stream a file built from the actual
  result; `export=pdf|png|svg` open the print view
  (`cloudhost247-tools-print.tpl`) which the browser can save as PDF, PNG or SVG.
* **Cron** — resolver/provider health, due monitors, cache flush, retention.
* **Admin** — the addon page (`cloudhost247_network_tools_output()`), rendered by
  `lib/Admin/AdminView.php` and driven by `lib/Admin/AdminController.php`.

## Non-goals and honesty rules

* No separate authentication, database, HTTP client, provider registry or UI
  system is introduced.
* No fabricated result, ever: when a value cannot be obtained the tool returns
  `SERVICE_UNAVAILABLE`, `CONFIGURATION_REQUIRED`, `TIMEOUT`, `TARGET_BLOCKED`
  or `UNKNOWN` with an explanation, never a placeholder that looks like data.
* A tool is never described as "secure" because records exist; DNS health
  reports `PASS`/`WARNING`/`ERROR`/`NOT CHECKED`/`UNKNOWN` per check, produced by
  the documented checks in `HealthService`, with the evidence attached.
* The propagation checker states that its results cover only the resolvers
  CloudHost247 queried, not the whole internet.
