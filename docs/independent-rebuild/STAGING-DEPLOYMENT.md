# Secure staging deployment package

This procedure is for a confirmed non-production WHMCS 8.x/PHP 8.2 environment only. Production deployment is prohibited.

## Requirements

* Exact WHMCS 8.x release supported by its vendor and a valid staging WHMCS licence.
* PHP 8.2 CLI/FPM with cURL, JSON, OpenSSL, PDO MySQL, mbstring, DOM/XML, fileinfo, filter and ionCube only if unrelated licensed WHMCS components require it. CloudHost247 replacements do not require ionCube.
* MySQL 5.7+/MariaDB 10.3+ with InnoDB, utf8mb4 and transaction support. Record the exact server version before migration.
* Stock WHMCS `twenty-one` and `standard_cart` themes.
* HTTPS staging URL, isolated mail/payment gateways, no production callbacks, and disposable test records.
* Least-privilege OVH application key/secret/consumer key for a disposable account or resources.
* Web user read access to deployed PHP/templates/assets; write access only to normal WHMCS writable paths (`templates_c`, attachments/downloads as configured). Module source should be 0644 and directories 0755; never make source world-writable.

## Pre-deployment proof and backup

1. Verify hostname, WHMCS System URL, database name and OVH account are explicitly labelled staging. Stop if any points to production.
2. Record `git rev-parse HEAD`, WHMCS/PHP/database versions and maintenance window.
3. Put staging in maintenance mode and pause staging cron.
4. Create a database backup using a credentials file or secure environment—not a password on the command line:
   `mysqldump --defaults-extra-file=/secure/staging-my.cnf --single-transaction --routines --triggers DATABASE | gzip > /secure/backups/whmcs-before-cloudhost247.sql.gz`
5. Archive the staging document root while excluding volatile caches and secrets from exported evidence:
   `tar --exclude=templates_c --exclude='configuration.php' -czf /secure/backups/whmcs-files-before-cloudhost247.tgz -C /path/to/staging .`
6. Restore both backups into a separate throwaway location/database and execute a WHMCS health check. A backup is not accepted until restore is demonstrated.
7. Capture schema and row counts for WHMCS financial/customer tables and all legacy vendor tables.

## Deployment and migration

1. Fetch branch `arena/01a0e4c2-cloudhost247` and verify the approved commit hash. Initial staging comparison starts from frozen `3a9fbb9`; later fixes must record their exact hash.
2. Use `rsync --archive --checksum --itemize-changes` with an explicit include list for repository customizations. Never use `--delete` against the WHMCS root.
3. Do not copy `.git`, tests, docs, backups, credentials or CI files into the public document root unless operational policy requires documentation outside web access.
4. In WHMCS Addon Modules activate in order: Foundation, Theme Manager, Currency, OVH. Activation applies only versioned `mod_cloudhost247_*` migrations.
5. Configure addon-role access before other administrators enter the modules. Add optional CloudHost247 capability restrictions in Foundation.
6. Select CloudHost247 client and cart themes only on staging. Keep payment gateways in test/disabled mode.
7. Configure OVH credentials in encrypted WHMCS server fields. Never store them in addon tables, source, shell history or evidence.
8. Capture post-migration schema and compare protected-table row counts.

## Cache clearing

Use the WHMCS admin maintenance/system cleanup function for compiled templates when available. If filesystem clearing is necessary, remove only compiled files inside the configured staging `templates_c` directory while preserving its directory/index protection. Never recursively delete an unverified path. Record the resolved path and file count before/after.

## Cron

Prefer normal WHMCS cron for the Currency `AfterCronJob` hook. Optional isolated entries:

```cron
17 * * * * /usr/bin/php /path/to/staging/crons/cloudhost247_currency.php >> /secure/logs/ch247-currency.log 2>&1
23 */2 * * * /usr/bin/php /path/to/staging/crons/cloudhost247_ovh.php >> /secure/logs/ch247-ovh.log 2>&1
```

Run them under the staging account, use absolute paths, protect logs, and do not schedule until manual runs pass. Test simultaneous invocations to prove leases.

## Post-deployment health checks

* HTTPS/System URL/staging banner and maintenance state are correct.
* Foundation checks report WHMCS, Capsule, cURL, JSON, OpenSSL and randomness.
* All migration versions are present once; activation repeated is a no-op.
* Original checksum manifest verifies and legacy modules remain inactive.
* CloudHost247 theme/cart resolve with no HostX include or licence request.
* Currency manual dry observation succeeds/fails atomically and protected tables are unchanged.
* OVH `/me` succeeds with redacted logs; catalog reads work before any order mutation.
* Test mail/payment callbacks cannot reach production.
* Run the full `STAGING-TEST-MATRIX.md` and store evidence outside the public webroot.

## Rollback

1. Stop staging cron and prevent new test orders.
2. Select stock `twenty-one` and `standard_cart`; disable CloudHost247 addons/server module.
3. Restore files and database from the proven pre-deployment backups. Do not attempt ad-hoc reverse migrations on financial/customer tables.
4. Clear only staging compiled templates, re-run health checks, compare protected row counts and record rollback evidence.
5. Preserve failed-run logs with secrets redacted for diagnosis.

## Release-candidate freeze procedure (2026-09-27)

Status: **SOURCE FOUNDATION COMPLETE → RELEASE CANDIDATE → STAGING PENDING**.

The mandatory staging comparison sequence is:

1. Deploy frozen baseline `3a9fbb9` to a positively identified non-production environment.
2. Prove backup restoration and record exact WHMCS, PHP, database, web-server, and extension versions.
3. Clear caches and execute the complete baseline matrix before configuring disposable OVH access.
4. Capture database, browser, cron, financial, client-area, and operation evidence.
5. Upgrade to the final release-candidate commit reported with this batch; do not substitute an unreviewed branch tip.
6. Execute ordered CloudHost247 migrations, repeat affected tests, and compare evidence to baseline.
7. Use only disposable least-privilege OVH resources. Never submit credentials through chat or commit them.

The CI-level `scripts/release-candidate-check.sh` verifies syntax, behavior tests, static/security tests, migration ordering/additive policy, preserved proprietary checksums, embedded-secret patterns, core-schema policy, and diff cleanliness on PHP 7.4 and 8.2. This is source evidence only. Real migrations, WHMCS integration, browser behavior, cron, provider updates, and OVH lifecycle operations remain **BLOCKED — STAGING REQUIRED**.

## Hardened staging tooling (post-RC preparation)

Run tooling from a protected checkout outside the public document root. Evidence and backups must be mode `0600` in a non-web-accessible directory. Required operator-supplied values are: exact allowlisted staging URL/host, a non-production identity, a database-name staging marker, WHMCS document root, deployment user, secure database defaults file, backup directory, and isolated restore document root/database. Credentials are never command arguments or evidence fields.

Fail-closed environment variables:

```bash
export CH247_STAGING_CONFIRM=YES
export CH247_STAGING_ID='approved-staging-ticket-or-name'
export CH247_EXPECTED_STAGING_URL='https://exact-staging-host.example'
export CH247_STAGING_HOST_ALLOWLIST='exact-staging-host.example'
export CH247_STAGING_DB_MARKER='staging'
export CH247_BUILD_COMMIT='3a9fbb9' # change only after verified upgrade
```

A hostname containing `www`, `prod`, or `production`, a URL mismatch, a host absent from the explicit allowlist, a database without the required marker, or missing identity causes immediate failure. The tooling never infers staging from a checkbox alone.

### Exact execution sequence

```bash
# 1. From the tooling checkout, validate source-only controls.
bash scripts/release-candidate-check.sh

# 2. Deploy baseline 3a9fbb9 to staging by the approved non-destructive process.
export CH247_PREFLIGHT_MODE=baseline
php scripts/staging-preflight.php /srv/whmcs-staging /secure/evidence/baseline-preflight.json
php scripts/staging-baseline-evidence.php /srv/whmcs-staging /secure/evidence/baseline.json
php scripts/staging-financial-snapshot.php /srv/whmcs-staging /secure/evidence/financial-before.json

# 3. Create backups using an approved defaults file (never a CLI password), archive files,
# restore into a separate staging database/root, then verify the restored runtime.
mysqldump --defaults-extra-file=/secure/staging-my.cnf --single-transaction --routines --triggers STAGING_DB | gzip > /secure/backups/database.sql.gz
tar --exclude=templates_c --exclude=configuration.php -czf /secure/backups/application.tgz -C /srv/whmcs-staging .
export CH247_SOURCE_DATABASE_HASH="$(jq -r .environment.database_name_hash /secure/evidence/baseline-preflight.json)"
# Approved operators now restore both artifacts to /srv/whmcs-restore and an isolated DB.
php scripts/staging-backup-verify.php /srv/whmcs-restore /secure/backups/database.sql.gz /secure/backups/application.tgz /secure/evidence/backup-restore.json

# 4. Complete baseline matrix and preserve evidence. Only then upgrade to the exact RC.
export CH247_BUILD_COMMIT=83de4e15d513c56128889d429350da83d46ad1fc
export CH247_PREFLIGHT_MODE=release-candidate
php scripts/staging-preflight.php /srv/whmcs-staging /secure/evidence/rc-preflight.json
# Activate/upgrade modules in documented order and execute the full runtime matrix.
php scripts/staging-financial-snapshot.php /srv/whmcs-staging /secure/evidence/financial-after.json
python3 scripts/compare-financial-evidence.py /secure/evidence/financial-before.json /secure/evidence/financial-after.json --expected /secure/evidence/approved-changes.json --output /secure/evidence/financial-comparison.json
python3 scripts/validate-migrations.py --json-output /secure/evidence/migrations.json

# 5. Generate acceptance only after real runtime evidence is recorded.
python3 scripts/generate-staging-report.py \
 --preflight /secure/evidence/rc-preflight.json --backup /secure/evidence/backup-restore.json \
 --baseline /secure/evidence/baseline.json --financial /secure/evidence/financial-comparison.json \
 --migration /secure/evidence/migrations.json --automated /secure/evidence/automated-tests.json \
 --runtime /secure/evidence/runtime-results.json --commit "$CH247_BUILD_COMMIT" \
 --json-output /secure/evidence/acceptance.json --markdown-output /secure/evidence/acceptance.md
```

`staging-runtime-evidence.template.json` intentionally starts at `NOT RUN — STAGING REQUIRED`; it cannot yield acceptance until every mandatory real-runtime section has evidence.

## Failure and rollback decision tree

Any environment-identification, backup/restore, migration, unexplained financial, authentication, browser, security, currency, OVH, reconciliation, or lifecycle failure stops acceptance. Pause cron and test ordering; preserve redacted evidence; switch to stock themes; disable only CloudHost247 staging modules; restore application files and the proven database backup into staging; clear only the verified staging template cache; rerun preflight and financial comparison. Never delete or reverse-edit WHMCS customer, invoice, transaction, domain, service, or product data. A migration failure is handled by full proven database restoration, not improvised reverse SQL. Currency/OVH failures also require disabling their staging schedules and credentials before restoration.
