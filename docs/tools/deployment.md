# Deployment

The module deploys by copying files into an existing WHMCS installation. There
are no terminal commands, no Composer step and no build.

## Files to deploy

| From the repository | To (WHMCS document root) |
| --- | --- |
| `modules/addons/cloudhost247_network_tools/` | `modules/addons/cloudhost247_network_tools/` |
| `tools.php` | `tools.php` |
| `crons/cloudhost247_network_tools.php` | `crons/cloudhost247_network_tools.php` |
| `templates/cloudhost247/cloudhost247-tools.tpl` | `templates/cloudhost247/cloudhost247-tools.tpl` |
| `templates/cloudhost247/cloudhost247-tools-table.tpl` | `templates/cloudhost247/cloudhost247-tools-table.tpl` |
| `templates/cloudhost247/cloudhost247-tools-print.tpl` | `templates/cloudhost247/cloudhost247-tools-print.tpl` |

`tools.php` must stay beside the `modules/` directory: the addon's asset URLs and
the template links are relative to it so they work in a document-root install and
in a subdirectory install alike. When WHMCS exposes `systemurl` to hooks, the
CSS/JS URLs use it; otherwise the relative path is used.

## Required components

* WHMCS 8.x, PHP 7.4–8.2.
* `cloudhost247_core` (audit, RBAC, migrations) — required.
* `cloudhost247_integrations` (vault, providers, SMTP) — strongly recommended;
  without it, provider-backed tools report `CONFIGURATION_REQUIRED`.
* The CloudHost247 client theme (`templates/cloudhost247/`).

## Installation

1. Upload the files above.
2. **Settings → Addons → CloudHost247 Network Tools → Activate.** Activation runs
   the versioned migration (`V100.php`, version `1.0.0`), then seeds the
   catalogue, the default resolvers, the DNSBL zone rows and the default
   settings. Seeding is additive and idempotent, so activating twice or
   upgrading changes nothing an administrator has edited.
3. Grant the capability `cloudhost247_network_tools:tools.manage` to the admin
   roles that should manage the tools (the guard also accepts the default
   role pass when no capability row exists, matching the rest of the repository).
4. Open **Addons → CloudHost247 Network Tools → Settings** and set the API token
   if the REST surface is wanted.
5. Optionally add the cron entry (below).

## Cron (optional)

```
*/5 * * * * php /path/to/whmcs/crons/cloudhost247_network_tools.php >/dev/null 2>&1
```

The worker is CLI-only (a web request gets HTTP 403) and exits `0` (nothing to
do / all fine), `1` (a check failed) or `2` (a failure that needs attention). It:

* runs resolver health checks on `resolver_health_interval_minutes`;
* runs provider health checks on `provider_health_interval_minutes`;
* runs due saved-domain monitors (DNS/SSL/email change detection, alerting via
  `localAPI('SendEmail')`);
* prunes history, logs, health rows and rate-limit counters, and flushes the cache.

Every one of those jobs can also be triggered from the admin screens, so a
hosting account without cron loses the schedule but not the features.

## Upgrade and rollback

* Update by uploading the new files; the addon's `upgrade()` runs the new
  migrations (idempotent, guard-first, never destructive).
* Deactivation stops hooks and the cron jobs but keeps data; the module never
  drops a table on deactivate, so a rollback is a file rollback.
* The release gate (`scripts/release-candidate-check.sh`) verifies `php -l`, the
  behaviour suites, the static invariants, migration ordering and the branding
  audit before a package is considered releasable.

## Post-deploy verification

1. `Settings → Addons → CloudHost247 Network Tools → Health` — every capability
   and resolver/provider state is listed with its reason.
2. Open `/tools` as a customer and run `dns/lookup` for a known domain.
3. `GET api/index.php?route=list` with the API token.
4. Check **Admin → Tools** shows the catalogue with each tool's state.
