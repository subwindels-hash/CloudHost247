# CloudHost247 installation guide — staging only

**This is an operator guide for installing CloudHost247 customizations into an existing, licensed WHMCS installation. It is not a WHMCS installer and does not authorize a production change.** Production remains a separate, named-human approval after the staging acceptance record is complete; see [`RELEASE-WORKFLOW.md`](RELEASE-WORKFLOW.md).

> **Current package is blocked.** The most recently generated `CloudHost247-production-1.0.0.zip` was built from `1f18066a6a4b2f839bbed0e3fa18db6ae56c325d`, but it contains the current vendor RDP entry point and provider endpoint. The ZIP's structural/secret checks do not establish that RDP is safe. **Do not install that archive.** Restore and verify the secure RDP implementation (or create a reviewed package that cannot install or activate the unsafe RDP module), update the tests/release checks, and build a new exact-SHA candidate first. Keep RDP disabled until API authorization, licensing and disposable lifecycle tests pass. See [`independent-rebuild/RDP-SECURE-REBUILD-WORK-ITEM.md`](independent-rebuild/RDP-SECURE-REBUILD-WORK-ITEM.md).

No staging installation or production installation was performed when this guide was prepared.

## 1. What gets installed

There are two distinct runtime targets:

1. **WHMCS layer:** CloudHost247 pages, templates, addons, server modules, hooks and cron files are installed as a reviewed overlay into an existing WHMCS document root.
2. **Node platform:** `cloudhost247-node/` is a separate application with its own process, environment variables and PostgreSQL database. It must not be copied into the WHMCS root. Follow [`CPANEL_DEPLOYMENT.md`](CPANEL_DEPLOYMENT.md) only when that platform is in scope.

The repository/ZIP does not include WHMCS core, a WHMCS licence, production credentials, a database, or the target's `configuration.php`. It is not safe to unzip the entire repository or ZIP into `public_html`. For the package build, hash verification, private extraction, file-list review and non-destructive overlay procedure, follow [`DEPLOYMENT-GUIDE.md`](DEPLOYMENT-GUIDE.md).

## 2. Prerequisites

Complete these checks before uploading or activating anything:

- A vendor-supported WHMCS 8.x installation and valid **staging** licence, with `init.php` and `configuration.php` already working.
- A non-production hostname and WHMCS `SystemURL`; a separate staging database whose name contains the approved staging marker; staging-only mail, payment and provider callbacks.
- PHP **8.2.x** for the current staging preflight, with CLI and web/FPM runtimes aligned. Required extensions include `curl`, `json`, `openssl`, `pdo_mysql`, `mbstring`, `dom`, `fileinfo` and `filter`.
- MySQL 5.7+ or MariaDB 10.3+ with InnoDB, `utf8mb4` and transaction support. Record the exact database version and SQL mode.
- The stock WHMCS `twenty-one` client theme and `standard_cart` order form.
- An administrator account able to activate WHMCS modules and set restricted module access; use a separate tester account for client-area checks.
- A tested backup and a successful restore to a separate staging root/database. Do not treat a backup file that has never been restored as rollback evidence.
- A protected evidence directory outside the webroot, least-privilege staging credentials, and disposable test products/services for any provider-backed workflow.

If installing the Node platform too, separately verify the host's Node.js version (at least 20.9), Passenger/Application Manager, PostgreSQL connectivity, app root and environment-variable support. The Node platform has additional staged-migration restrictions documented in `CPANEL_DEPLOYMENT.md`; WHMCS readiness does not certify cPanel readiness.

## 3. Prepare the staging installation

1. **Freeze the candidate.** Record the complete Git SHA. Require a clean worktree, a passing `scripts/release-candidate-check.sh`, and successful GitHub Actions runs whose `headSha` equals that exact SHA. Any source edit creates a new candidate.
2. **Resolve package blockers.** Do not proceed with the currently generated RDP-containing archive. Resolve the RDP issue, update tests so they require the secure entry point to be active, rebuild the ZIP, and verify its SHA-256 and contents.
3. **Identify the target fail-closed.** Follow steps 2–4 of [`DEPLOYMENT-GUIDE.md`](DEPLOYMENT-GUIDE.md): set the confirmed staging URL/allowlist/identity/database marker, run `scripts/staging-preflight.php`, create file/database backups, restore them to an isolated target, and capture the pre-change baseline and financial snapshot.
4. **Enter maintenance.** Enable WHMCS maintenance mode, pause staging cron/jobs, prevent new test orders, and keep payment gateways in test or disabled mode.
5. **Deploy only an approved overlay.** Extract the ZIP in a private directory outside the public webroot. Review a release-specific WHMCS file list against the staging backup. Use the dry-run and itemized review in `DEPLOYMENT-GUIDE.md`; never use `rsync --delete`, overwrite WHMCS core, or copy the full ZIP into the document root.
6. **Run release-candidate preflight.** After the approved files are overlaid, run `staging-preflight.php` with `CH247_PREFLIGHT_MODE=release-candidate` and the exact candidate SHA. Stop on any failure.

Do not install on a production host, and do not copy configuration files, database backups, credentials, evidence, Git metadata, internal docs or tests into the public document root.

## 4. Activate the core WHMCS addons

Validate the migration set from the protected checkout:

```bash
python3 scripts/validate-migrations.py --json-output /secure/evidence/migrations.json
```

This command validates source migration versions, ordering, namespace and static idempotency rules; it does **not** apply a database migration. Apply migrations only by activating the WHMCS modules in the documented UI—never by hand-running ad-hoc SQL.

For the baseline CloudHost247 installation, activate in this order in **WHMCS Admin → System Settings → Addon Modules**:

1. **CloudHost247 Foundation** (`cloudhost247_core`) — shared health, capabilities, audit and migration services.
2. **CloudHost247 Theme Manager** (`cloudhost247_theme`).
3. **CloudHost247 Currency** (`cloudhost247_currency`).
4. **CloudHost247 OVH** (`cloudhost247_ovh`).

After Foundation activates, restrict module/capability access to the approved administrator roles **before** giving other administrators access. Capture activation output and the applied migration versions. Re-open/reactivate once to confirm a repeat activation is a no-op; deactivation must retain data for rollback.

Activate only modules explicitly included in the staging test plan. The repository contains other first-party modules, but their presence is not a requirement to activate them during the baseline install. For example:

| Optional module | Install/activation note |
|---|---|
| API & Integrations | Activate Foundation first. Configure only staging credentials through its encrypted settings; see [`independent-rebuild/API-INTEGRATIONS.md`](independent-rebuild/API-INTEGRATIONS.md). If using central OVH credentials, follow its documented ordering and credential migration. |
| Module Manager | Requires Foundation and the documented PHP extensions/storage outside the webroot. Restrict `modules.*` capabilities to Super Admin; installed packages start disabled. See [`independent-rebuild/MODULE-MANAGER.md`](independent-rebuild/MODULE-MANAGER.md). |
| Website Builder, Brokerage, Marketing, Cart Recovery, Passkey and Tools | Activate only after their prerequisites, capability policy, migration set, external provider needs and test rows are approved. See their individual module docs and the staging matrix. |
| CloudHost247 Email Hosting | This is a WHMCS **server** module, not an addon. Configure an authorized disposable Microsoft/Google/Professional Email tenant; the module does not create products or set prices. Follow the module-specific install sequence and test matrix before assigning a product. |
| RDP | **Do not activate.** The active entry point in the current source is the vendor version; the secure rebuild is not active. Resolve the code, provider authorization and licensing prerequisites before installation or provisioning tests. |

## 5. Configure the staging presentation and providers

Only after the baseline modules activate successfully:

1. In WHMCS General Settings, select the CloudHost247 client theme (`cloudhost247`) and CloudHost247 order form (`cloudhost247`) **on staging only**.
2. Review the Foundation health dashboard and role/capability policy.
3. Configure currency providers and schedules only if they are in the test scope. Verify provider failure/fallback and locking; never let a currency test change invoice, transaction or historical financial data.
4. Configure OVH with least-privilege credentials for disposable resources. Test a read-only identity/catalog call first; map products explicitly and require confirmation before any mutation.
5. Keep payment gateways in test mode or disabled. Use staging callback URLs and test accounts only.
6. Store provider credentials only in encrypted WHMCS server fields or the documented encrypted integrations centre. Do not store secrets in source, shell history, addon tables, screenshots, logs or evidence JSON.
7. Leave unsupported API/product operations unavailable. Do not invent service availability, prices, product identifiers or provisioning results.

## 6. Verify the installation

After activation/configuration:

- Run the release-candidate preflight again and save the JSON result outside the webroot.
- Compare the applied migration set and schema with the pre-install baseline. Confirm protected WHMCS tables and financial snapshots have no unexplained changes.
- Use WHMCS's supported maintenance/cache action. If the filesystem must be touched, verify the actual `templates_c` path and remove only compiled files inside it; never run a recursive delete against an unverified path.
- Verify HTTPS, `SystemURL`, staging banner, theme/order form, health checks, logs, client ownership, role restrictions and that legacy modules remain inactive.
- Run the applicable tests in [`independent-rebuild/STAGING-TEST-MATRIX.md`](independent-rebuild/STAGING-TEST-MATRIX.md) on the real licensed staging installation: login/register/reset, client area, CMS, cart/checkout with test gateways, browser/device behavior, migration idempotency, currency, OVH and rollback.
- Use `scripts/verify-website.py --base https://exact-staging-host.example/ --output /secure/evidence/staging-web.json` for read-only HTTP checks. Fixture tests are source QA only; they do not prove WHMCS database/session/checkout behavior.
- Capture before/after financial evidence and compare it with an explicit reviewed change allowlist. Generate acceptance reports only from real staging evidence.

Every evidence item must name the exact candidate SHA, UTC time, target environment and test result. Redact all secrets and personal/customer data. `PASS` is not permitted for unrun, mocked-only or fixture-only runtime tests.

## 7. Rollback and upgrades

If preflight, migration, health or test validation fails:

1. Keep the staging installation in maintenance mode and pause cron/jobs.
2. Stop new test orders and provider mutations.
3. Restore the **proven** database backup and reviewed file backup into staging; do not reverse-edit customer/financial rows or improvise reverse SQL.
4. Restore the previous approved file overlay and stock WHMCS theme/order form; disable only the CloudHost247 staging modules.
5. Clear only the verified staging `templates_c` cache, re-run environment/financial checks, and retain redacted logs.

For upgrades, repeat the freeze, preflight, backup/restore proof, baseline, reviewed overlay and migration validation steps. Additive migrations must be applied through the module's supported activation path and verified as idempotent. Do not delete module tables or erase operator content during uninstall/deactivation. See [`DEPLOYMENT-GUIDE.md`](DEPLOYMENT-GUIDE.md) for the package overlay and [`RELEASE-WORKFLOW.md`](RELEASE-WORKFLOW.md) for the evidence/approval stages.

**No production installation is covered here.** Production may be considered only after a separate named approval records the approver, exact SHA, passing acceptance report, evidence paths and a tested restore/rollback plan.
