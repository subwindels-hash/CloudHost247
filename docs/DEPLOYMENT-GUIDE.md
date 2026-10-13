# CloudHost247 deployment guide — staging first

**Scope:** controlled deployment of a verified CloudHost247 package to a licensed, isolated WHMCS staging installation. This guide does not deploy to production. For the evidence gates and final human approval, follow [`RELEASE-WORKFLOW.md`](RELEASE-WORKFLOW.md). For a separate cPanel/Passenger deployment of the Node platform, follow [`CPANEL_DEPLOYMENT.md`](CPANEL_DEPLOYMENT.md).

> **Current artifact is blocked.** The package most recently generated in this workspace, `CloudHost247-production-1.0.0.zip`, was built from commit `1f18066a6a4b2f839bbed0e3fa18db6ae56c325d`. Its archive checks passed, but it contains the current vendor RDP server-module entry point and provider endpoint. The generic archive verifier does not prove module safety. **Do not deploy that archive.** Restore/replace the secure RDP implementation, update its tests and release checks to assert the secure implementation is active, then freeze and rebuild a new candidate. Keep RDP disabled until provider authorization and disposable staging lifecycle tests are complete. This status is also recorded in [`independent-rebuild/RDP-SECURE-REBUILD-WORK-ITEM.md`](independent-rebuild/RDP-SECURE-REBUILD-WORK-ITEM.md).

No staging host was accessed and no deployment was performed when this documentation was prepared.

## 1. Understand the package and deployment targets

The repository's production ZIP contains more than WHMCS runtime files. It includes:

- CloudHost247 customizations for an **existing** licensed WHMCS document root (PHP entry points, selected `modules/`, `templates/`, assets and related runtime files);
- the independent Node platform under `cloudhost247-node/`, which runs as a **separate application**;
- documentation, tests and build/deployment scripts used for review and verification.

It does **not** contain WHMCS core, a database, a WHMCS licence, or the target's `configuration.php`. Do not extract the whole ZIP into the public WHMCS document root. Do not copy `cloudhost247-node/` into that root. The Node platform has its own application root and deployment procedure.

The ZIP verifier checks archive integrity, required files, referenced assets and known secret patterns. A pass is not a staging test, a security approval, or permission to deploy every file in the archive.

## 2. Non-negotiable stop conditions

Stop and do not deploy if any of these is true:

- the target host, WHMCS `SystemURL`, or database cannot be positively identified as staging;
- the candidate SHA is not the SHA tested by the release gate and GitHub Actions;
- the worktree is dirty, the source gate fails, or required CI checks are not green on the exact SHA;
- the archive contains a module that has a known unresolved security blocker (currently RDP);
- there is no tested restore of the staging database **and** files;
- the release-specific WHMCS file list has not been reviewed against the target installation;
- payment gateways or provider credentials could reach production services;
- any unexplained financial, client, domain, service, invoice, or transaction difference appears.

Never bypass a failed preflight by editing the host allowlist or staging marker to fit an unconfirmed target. Never use production credentials in staging. Do not provide credentials, configuration files or customer data in chat or commit them.

## 3. Prepare the release candidate and artifact

Run the source checks from a protected checkout outside the public document root. Record the full commit SHA and do not change source after freezing it.

```bash
git fetch origin
CANDIDATE_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$CANDIDATE_SHA"
bash scripts/release-candidate-check.sh
git status --short
```

Confirm the tree is clean. In GitHub Actions, confirm that the release-candidate, Node-platform and content-hygiene workflows completed successfully with `headSha` equal to `CANDIDATE_SHA`—a green run on an ancestor is not evidence for this package.

After all source/security blockers are closed, build from the same checkout and locked Node dependencies:

```bash
(cd cloudhost247-node && npm ci)
VERSION='1.0.0' # set the approved release version
ARTIFACT_DIR='/secure/release'
ZIP="$ARTIFACT_DIR/CloudHost247-production-$VERSION.zip"
install -d -m 700 "$ARTIFACT_DIR"
python3 scripts/build-production-zip.py --version "$VERSION" --out "$ZIP" --verify
(
  cd "$ARTIFACT_DIR"
  sha256sum "$(basename "$ZIP")" > "$(basename "$ZIP").sha256"
  sha256sum -c "$(basename "$ZIP").sha256"
  unzip -t "$(basename "$ZIP")"
)
```

Store the ZIP, `.sha256` sidecar, candidate SHA, exact-SHA CI run links, gate output and build log together in the protected release area. Preserve that immutable artifact; any source change requires a new candidate SHA and a fresh build. The release ZIP contains both PHP and Node surfaces, so separately review which surface is in scope for this staging change.

## 4. Identify and preflight the staging target

Run from a trusted terminal on the staging operator's side. Set the real values locally; the examples below are placeholders, not approved hostnames or credentials. Create evidence storage outside the web root and restrict it to the operator:

```bash
umask 077
CANDIDATE_SHA='paste-the-full-SHA-from-the-release-record'
EVIDENCE='/secure/evidence/cloudhost247'
BACKUPS='/secure/backups/cloudhost247'
WHMCS_ROOT='/srv/whmcs-staging'
STAGING_DB='confirmed-staging-database-name'
RELEASE_CHECKOUT='/srv/cloudhost247-release-checkout' # protected checkout of CANDIDATE_SHA
ZIP='/secure/release/CloudHost247-production-1.0.0.zip' # transferred candidate package
test "$(git -C "$RELEASE_CHECKOUT" rev-parse HEAD)" = "$CANDIDATE_SHA"
mkdir -p "$EVIDENCE" "$BACKUPS"
chmod 700 "$EVIDENCE" "$BACKUPS"

export CH247_STAGING_CONFIRM=YES
export CH247_STAGING_ID='approved-staging-ticket-or-name'
export CH247_EXPECTED_STAGING_URL='https://exact-staging-host.example'
export CH247_STAGING_HOST_ALLOWLIST='exact-staging-host.example'
export CH247_STAGING_DB_MARKER='staging'
export CH247_BUILD_COMMIT="$CANDIDATE_SHA"
export CH247_PREFLIGHT_MODE=baseline
php "$RELEASE_CHECKOUT/scripts/staging-preflight.php" \
  "$WHMCS_ROOT" "$EVIDENCE/baseline-preflight.json"
```

The preflight checks the WHMCS URL against the independently supplied staging URL and exact host allowlist, rejects production-looking hosts/identities, and requires the connected database name to contain the staging marker. It also checks the WHMCS/PHP runtime, required extensions and directories. Review the JSON; do not proceed on a warning that makes environment identity ambiguous or on any `FAIL`.

## 5. Back up and prove restoration before changing files

Use a database client defaults file readable only by the staging operator. Never put database passwords in command arguments or shell history.

```bash
mysqldump --defaults-extra-file=/secure/staging-my.cnf \
  --single-transaction --routines --triggers "$STAGING_DB" \
  | gzip -c > "$BACKUPS/database-before.sql.gz"
tar --exclude=templates_c --exclude=configuration.php \
  -czf "$BACKUPS/application-before.tgz" -C "$WHMCS_ROOT" .
chmod 600 "$BACKUPS/database-before.sql.gz" "$BACKUPS/application-before.tgz"
```

Keep a separate mode-0600 copy of the staging `configuration.php` in the protected backup area; never put it in the archive or evidence output. Restore the database and application archive into a **separate** disposable database and document root, never over the live staging source and never into production. Configure the restored copy with its own protected `configuration.php` that points only to the isolated restore database. The verification script does not perform the restore; it checks that the supplied backup artifacts are readable and that the separately restored WHMCS root connects to a distinct, marked database.

```bash
export CH247_SOURCE_DATABASE_HASH="$(jq -r .environment.database_name_hash \
  "$EVIDENCE/baseline-preflight.json")"
php "$RELEASE_CHECKOUT/scripts/staging-backup-verify.php" \
  /srv/whmcs-restore "$BACKUPS/database-before.sql.gz" \
  "$BACKUPS/application-before.tgz" "$EVIDENCE/backup-restore.json"
```

Proceed only when the restored WHMCS runtime is healthy, the restore evidence is `PASS`, and both backup files are readable and non-empty. Keep backup/configuration material private; never put it in the ZIP or evidence JSON.

## 6. Capture the before-state and enter maintenance

Capture the baseline before activation or file replacement. Put staging into maintenance mode and pause its scheduled jobs for the maintenance window. Prevent test users from placing orders until the change is complete.

```bash
php "$RELEASE_CHECKOUT/scripts/staging-baseline-evidence.php" \
  "$WHMCS_ROOT" "$EVIDENCE/baseline.json"
php "$RELEASE_CHECKOUT/scripts/staging-financial-snapshot.php" \
  "$WHMCS_ROOT" "$EVIDENCE/financial-before.json"
```

Check that the artifacts say `CAPTURED_NOT_ACCEPTED`, contain the exact candidate SHA and verified staging identity, and include the expected tables and totals. These are metadata-only snapshots; they must not contain customer rows or credentials.

## 7. Unpack privately and prepare a reviewed deployment file list

Verify the ZIP digest on the staging transfer, then extract it into a private release directory—not into the WHMCS document root:

```bash
(cd "$(dirname "$ZIP")" && sha256sum -c "$(basename "$ZIP").sha256")
RELEASE_DIR="/srv/cloudhost247-releases/$CANDIDATE_SHA"
install -d -m 700 "$RELEASE_DIR"
unzip -q "$ZIP" -d "$RELEASE_DIR"
```

Prepare a release-specific list of **only** the files approved to overlay onto this WHMCS installation. Compare each candidate file with the deployed/backup version and account for operator customizations. The repository does not supply a universal `deploy/include-list.txt`: WHMCS roots differ, and blindly copying every packaged file would also copy internal docs/tests/scripts and the separate Node app. Store the reviewed list and the resulting dry-run output under `$EVIDENCE`.

Exclude at minimum: `cloudhost247-node/`, `docs/`, `tests/`, `.git/`, credentials/backups, `configuration.php`, WHMCS core (`init.php`, `includes/`, `vendor/`), `templates_c/`, attachments, downloads, uploads and any operator-managed content. Do not overwrite protected legacy theme/vendor files or copy the RDP module until the RDP blocker is fixed and verified. Treat `.htaccess` and existing root PHP files as sensitive changes: include them only after reviewing the target-specific diff.

Run an itemized dry-run using a line-separated, reviewed file list of archive-relative paths (no leading slash or `..`):

```bash
rsync --archive --checksum --itemize-changes --dry-run \
  --files-from="$EVIDENCE/whmcs-deploy-files.txt" \
  "$RELEASE_DIR/" "$WHMCS_ROOT/" \
  | tee "$EVIDENCE/rsync-dry-run.txt"
```

Review every proposed addition and update with the staging owner. **Never add `--delete`.** Stop if the dry-run proposes an unapproved overwrite, a deletion, a file outside the reviewed list, or a change under operator-managed content. Only after the dry-run is approved, repeat the same command without `--dry-run` and preserve the itemized result.

## 8. Re-check the installed release and activate only the approved modules

After the overlay, run the release-candidate preflight against the staging root:

```bash
export CH247_PREFLIGHT_MODE=release-candidate
php "$RELEASE_CHECKOUT/scripts/staging-preflight.php" \
  "$WHMCS_ROOT" "$EVIDENCE/rc-preflight.json"
python3 "$RELEASE_CHECKOUT/scripts/validate-migrations.py" \
  --json-output "$EVIDENCE/migrations.json"
```

The source migration validator checks the repository's required versions/order and additive/idempotent policy; it does not apply migrations to the staging database. Apply migrations only through the documented WHMCS module activation flow. In **WHMCS Admin → Addon Modules**, activate the approved modules in this order:

1. CloudHost247 Foundation
2. CloudHost247 Theme Manager
3. CloudHost247 Currency
4. CloudHost247 OVH

Set capability/role access before granting other administrators access. Do not activate RDP or any other module outside the approved test scope. Capture the post-migration schema/version list and compare protected WHMCS table counts against the baseline. Repeating activation must be a no-op.

## 9. Configure staging-only settings and providers

- Select the CloudHost247 client theme and CloudHost247 order form on staging only.
- Keep payment gateways in test mode or disabled; verify callback URLs cannot reach production.
- Use disposable, least-privilege provider accounts. Store secrets only in encrypted WHMCS server/configuration fields intended for credentials; never in source, shell history, evidence files or logs.
- Configure only provider capabilities supported by the authenticated API. Do not invent products, prices, stock or lifecycle operations. Missing live price/availability must remain visibly unverified.
- Record a redacted settings summary, never the secret values.

## 10. Clear caches and perform the health checks

Prefer WHMCS's supported maintenance/cache action. If filesystem cleanup is necessary, resolve and verify the actual staging `templates_c` path first; remove only compiled files within that verified directory. Record the resolved path and counts before/after. Never run a recursive delete against a variable or unverified path.

Confirm all of the following before reopening staging traffic:

- HTTPS and WHMCS `SystemURL` resolve to the allowlisted staging host;
- staging banner and maintenance controls are correct;
- Foundation health checks pass and each expected migration appears exactly once;
- original-file integrity checks pass and legacy vendor addons remain inactive;
- CloudHost247 theme/order form render without fatal errors or legacy-vendor licence requests;
- logs contain no credentials, tokens, payment data or customer rows;
- all test gateways/providers are still isolated from production.

## 11. Run functional, security and browser tests

Execute every applicable row in [`independent-rebuild/STAGING-TEST-MATRIX.md`](independent-rebuild/STAGING-TEST-MATRIX.md) on the real licensed staging installation. At minimum cover login/registration/password reset, client ownership, support, invoices, cart/checkout with test gateways, theme/CMS routes, responsive keyboard/browser behavior, migrations/idempotency, currency provider failures/locks, and OVH operations on disposable resources. Keep RDP disabled until its separate provider authorization and lifecycle acceptance is complete.

Run source-independent public HTTP checks against the actual staging URL, from an approved QA runner:

```bash
python3 "$RELEASE_CHECKOUT/scripts/verify-website.py" \
  --base 'https://exact-staging-host.example/' \
  --output "$EVIDENCE/staging-web.json"
```

Perform the real browser/device checks manually in a supported browser against the actual staging URL and save screenshots/axe results under `$EVIDENCE`, labelled with the exact URL and candidate SHA. `tests/website/browser.cjs` is a fixture-only harness: it requires `CH247_FIXTURE_DIR` and explicitly does not exercise WHMCS core, sessions, database, checkout or authentication. Its output is supplemental source QA, not real staging-browser evidence.

Every test record must include a test ID, UTC timestamp, exact SHA, environment versions, expected and actual result, redacted evidence path, database impact, cleanup/rollback result and tester. A skipped or blocked row stays explicitly `PARTIAL`/`BLOCKED`; do not convert it to PASS.

## 12. Compare financial state and generate acceptance evidence

Capture the after-snapshot and compare it with step 6. List only intentionally predicted changes in a reviewed `approved-changes.json`; unexplained changes stop release.

```bash
php "$RELEASE_CHECKOUT/scripts/staging-financial-snapshot.php" \
  "$WHMCS_ROOT" "$EVIDENCE/financial-after.json"
python3 "$RELEASE_CHECKOUT/scripts/compare-financial-evidence.py" \
  "$EVIDENCE/financial-before.json" "$EVIDENCE/financial-after.json" \
  --expected "$EVIDENCE/approved-changes.json" \
  --output "$EVIDENCE/financial-comparison.json"
```

Build `automated-tests.json` from the exact-SHA CI/source test records and complete `runtime-results.json` only with actual staging results. Do not mark an unrun or fixture-only test as PASS. Then run:

```bash
python3 "$RELEASE_CHECKOUT/scripts/generate-staging-report.py" \
  --preflight "$EVIDENCE/rc-preflight.json" \
  --backup "$EVIDENCE/backup-restore.json" \
  --baseline "$EVIDENCE/baseline.json" \
  --financial "$EVIDENCE/financial-comparison.json" \
  --migration "$EVIDENCE/migrations.json" \
  --automated "$EVIDENCE/automated-tests.json" \
  --runtime "$EVIDENCE/runtime-results.json" \
  --commit "$CANDIDATE_SHA" \
  --json-output "$EVIDENCE/acceptance.json" \
  --markdown-output "$EVIDENCE/acceptance.md"
```

Keep its acceptance files unchanged; the generator, not manual editing, decides whether mandatory evidence is complete. Static CI alone cannot produce staging acceptance.

## 13. Roll back or stop; do not promote automatically

If any step fails:

1. Keep staging in maintenance mode and pause its cron/jobs.
2. Stop new test orders and provider mutations.
3. Restore the reviewed application files and database from the **proven** step 5 backup into staging; do not improvise reverse SQL or edit financial/customer records.
4. Restore the stock WHMCS theme/order-form selections, disable only the CloudHost247 staging modules, and clear only the verified staging template cache.
5. Re-run the preflight and financial comparison, record the outcome, and preserve redacted logs.

If all staging evidence is complete, step 13 of [`RELEASE-WORKFLOW.md`](RELEASE-WORKFLOW.md) remains a human approval gate. This guide has no production command and does not authorize promotion. A named approver must review the exact candidate SHA, acceptance artifacts, evidence paths and tested rollback before any separate production change is planned.

## Optional: deploy the Node platform separately

The full repository ZIP's `cloudhost247-node/` subtree is not an instruction to put Node files under the WHMCS root. If the Node platform is in scope, build its dedicated package from `cloudhost247-node/` with `bash scripts/package-cpanel.sh` and follow [`CPANEL_DEPLOYMENT.md`](CPANEL_DEPLOYMENT.md) for cPanel/Passenger prerequisites, environment variables, PostgreSQL, migrations, health checks, updates and rollback. The cPanel document explicitly marks real-host verification as pending; do not describe the platform as cPanel- or production-ready until its staging checklist passes.
