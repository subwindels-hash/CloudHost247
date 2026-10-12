# CloudHost247 release workflow — staging only, thirteen steps

**This workflow ends at step 13 with an explicit, recorded production approval. Nothing in this
repository deploys to production, and no step below performs a production action.** Every command is
runnable as written; the ones that need a real WHMCS installation are marked *staging host*.

The rule that shapes the whole document: **a step is finished when its evidence file exists**, not
when the command exited 0. Each step names the artifact it must leave behind, so the next step (and a
reviewer) can tell "done" from "ran".

| Step | Purpose | Evidence produced |
|---|---|---|
| 1 | Freeze the candidate and prove the source is green | gate log, CI run, commit SHA |
| 2 | Prove the target is staging, not production | `preflight.json` |
| 3 | Prove the backup restores | `backup-restore.json` |
| 4 | Capture the pre-change baseline | `baseline.json`, `financial-before.json` |
| 5 | Build and verify the deployable archive | verified `.zip` + digest |
| 6 | Deploy without destroying operator state | rsync itemised diff |
| 7 | Activate addons in order; apply only versioned migrations | `migrations.json`, schema comparison |
| 8 | Configure capabilities, currencies and providers with staging credentials | redacted settings record |
| 9 | Clear caches and confirm runtime health | health-check record |
| 10 | Run the staging test matrix, including the browser sweep | matrix evidence, `browser-verification.json` |
| 11 | Prove financial and data integrity | `financial-comparison.json` |
| 12 | Generate the acceptance artifact — it refuses without runtime evidence | `acceptance.json` / `acceptance.md` |
| 13 | **Explicit production approval** (or stop) | signed approval record |

---

## 1. Freeze the candidate and prove the source is green

Record the exact commit under test; everything after this point must refer to that SHA, and a later
fix means a new candidate and a new run from step 1.

```bash
git fetch origin && git rev-parse HEAD            # record this SHA
bash scripts/release-candidate-check.sh           # source gate (PHP 8.2; CI also runs 7.4)
git status --short                                # must be empty: the gate diffs generated surfaces
gh run list --branch <branch> --limit 5           # CI green on this SHA, not on an ancestor
```

Stop if: the source gate fails, the tree is dirty, or CI is red on this SHA. A green CI on a
different commit is not evidence about this one.

## 2. Prove the target is staging, not production

*staging host.* The preflight refuses to run on an ambiguous environment: a hostname containing
`www`, `prod` or `production`, a URL mismatch, a host absent from the allowlist, or a database
without the staging marker all abort it. It never infers "staging" from a checkbox.

```bash
export CH247_STAGING_CONFIRM=YES
export CH247_STAGING_ID='approved-staging-ticket-or-name'
export CH247_EXPECTED_STAGING_URL='https://exact-staging-host.example'
export CH247_STAGING_HOST_ALLOWLIST='exact-staging-host.example'
export CH247_STAGING_DB_MARKER='staging'
export CH247_PREFLIGHT_MODE=baseline
php scripts/staging-preflight.php /srv/whmcs-staging /secure/evidence/baseline-preflight.json
```

Stop if: preflight fails for any reason. Do not "fix" it by editing the allowlist to match a host
you have not confirmed is non-production.

## 3. Prove the backup restores

*staging host.* A backup that has never been restored is a hope, not a backup. This step is the one
that most often gets skipped and the one that decides whether the rollback in step 13 is real.

```bash
mysqldump --defaults-extra-file=/secure/staging-my.cnf --single-transaction --routines --triggers \
  STAGING_DB | gzip > /secure/backups/database.sql.gz
tar --exclude=templates_c --exclude=configuration.php -czf /secure/backups/application.tgz \
  -C /srv/whmcs-staging .
export CH247_SOURCE_DATABASE_HASH="$(jq -r .environment.database_name_hash /secure/evidence/baseline-preflight.json)"
php scripts/staging-backup-verify.php /srv/whmcs-restore \
  /secure/backups/database.sql.gz /secure/backups/application.tgz \
  /secure/evidence/backup-restore.json
```

Stop if: the artifacts were not restored into a separate root and database, or the restore proof
does not match the source. Never pass a database password as a command argument.

## 4. Capture the pre-change baseline

*staging host.* This is the "before" that step 11 compares against.

```bash
php scripts/staging-baseline-evidence.php /srv/whmcs-staging /secure/evidence/baseline.json
php scripts/staging-financial-snapshot.php /srv/whmcs-staging /secure/evidence/financial-before.json
```

Stop if: either snapshot is incomplete. Record WHMCS, PHP, database and web-server versions, and put
staging into maintenance mode with cron paused for the duration of the change.

## 5. Build and verify the deployable archive

```bash
python3 scripts/build-production-zip.py --verify
```

The verifier checks the entry points, the configuration templates, that every illustration the theme
registry names exists in **both** the PHP and the built SPA library (including every 3D encoding),
that the published documentation is present, and that no secret material is in the archive. It also
builds the Node platform (`npm run build:server`, `npm run build:frontend`).

Stop if: verification fails. The archive is an input to step 6, and a bad input is not fixed later.

## 6. Deploy without destroying operator state

*staging host.* Use an explicit include list. **Never** `--delete` against a WHMCS root: operator
content, uploads, attachments and the installed application are not ours to remove.

```bash
rsync --archive --checksum --itemize-changes --dry-run \
  --include-from=deploy/include-list.txt --exclude='*' \
  /path/to/checkout/ /srv/whmcs-staging/
# review the itemised list, then repeat without --dry-run
```

Do not copy `.git`, `tests/`, `docs/`, backups, credentials or CI files into the public document
root. Do not overwrite the protected legacy theme or re-cut its integrity baseline.

Stop if: the itemised list contains a deletion, a file outside the include list, or anything under
the operator's content directories.

## 7. Activate addons in order and apply only versioned migrations

*staging host.* Activation is what applies migrations; there is no separate migrate command in
production, and no ad-hoc SQL.

```bash
python3 scripts/validate-migrations.py --json-output /secure/evidence/migrations.json
# Then, in WHMCS admin → Addon Modules, activate in this order:
#   CloudHost247 Foundation → Theme Manager → Currency → OVH
```

Set capability/role access **before** other administrators enter the modules. Capture the
post-migration schema and compare the protected WHMCS tables against step 4 row counts. Re-running
activation must be a no-op: prove it once.

Stop if: a migration runs that is not in the versioned set, a protected-table row count changes
without an approved reason, or activation is not idempotent.

## 8. Configure capabilities, currencies and providers with staging credentials

*staging host.* Select the CloudHost247 client theme and cart theme on staging only. Keep payment
gateways in test or disabled mode. Store provider credentials in encrypted WHMCS server fields —
never in addon tables, source, shell history or evidence. Confirm the public catalog maps to real
products with real prices and that a missing price renders as **NOT VERIFIED** rather than a guess.

Stop if: any gateway is live, any credential is visible in a log or evidence file, or any product
needs a price that WHMCS does not return.

## 9. Clear caches and confirm runtime health

*staging host.* Prefer WHMCS's own maintenance/cleanup action. If the filesystem must be touched,
remove only compiled files inside the configured `templates_c` directory, record the resolved path
and the file count before and after, and never recursively delete an unverified path.

Then confirm: HTTPS/System URL correct, staging banner and maintenance state correct, Foundation
checks green, migration versions each present once, original checksum manifest verifying, legacy
vendor modules inactive, and the CloudHost247 theme and cart resolving with no legacy-vendor include
or licence request.

## 10. Run the staging test matrix, including the browser sweep

*staging host.* Run every row of `docs/independent-rebuild/STAGING-TEST-MATRIX.md` and store the evidence outside the
web root. The functional half needs a real session and is *not* satisfied by the fixture harness:
login, registration, password reset, MFA/passkeys, account switching, language and currency
selection, support, invoices, domain search/registration/transfer/renewal, cart configuration, tax,
checkout and callbacks — with test gateways and approved test accounts.

The presentation half can be run against the real staging URL as well:

```bash
python3 tests/website/preview.py &                       # fixture server (optional, 0.0.0.0:8080)
CH247_QA_URL=http://127.0.0.1:8080 CH247_FIXTURE_DIR=/tmp/ch247-fixtures \
  node tests/website/browser.cjs                          # Chromium + axe, 10 widths
python3 scripts/verify-website.py --base https://YOUR-STAGING-WHMCS/ --output staging-web.json
```

`browser.cjs` needs a Chromium binary (`CH247_CHROMIUM` may point at one). The recorded artifact is
`docs/website-rebuild/browser-verification.json`: 52 routes × 10 widths, zero horizontal overflow,
zero broken images, zero page errors, menu open/Escape/focus and axe WCAG A/AA checks.

Stop if: any row fails, any check is skipped without a recorded reason, or the sweep runs against the
fixtures and is reported as if it had run against WHMCS.

## 11. Prove financial and data integrity

*staging host.* Compare the "after" snapshot with step 4 and require an explicit list of approved
changes. Anything unexplained stops the release.

```bash
php scripts/staging-financial-snapshot.php /srv/whmcs-staging /secure/evidence/financial-after.json
python3 scripts/compare-financial-evidence.py \
  /secure/evidence/financial-before.json /secure/evidence/financial-after.json \
  --expected /secure/evidence/approved-changes.json \
  --output /secure/evidence/financial-comparison.json
```

Stop if: a client, invoice, transaction, domain, service or product row changed without being on the
approved list.

## 12. Generate the acceptance artifact — it refuses without runtime evidence

*staging host.* The generator will not declare acceptance from source evidence alone. Its runtime
input starts at `NOT RUN — STAGING REQUIRED`; every mandatory section must carry real evidence.

```bash
cp docs/independent-rebuild/staging-runtime-evidence.template.json /secure/evidence/runtime-results.json
# fill it from steps 2-11, then:
python3 scripts/generate-staging-report.py \
  --preflight /secure/evidence/rc-preflight.json \
  --backup /secure/evidence/backup-restore.json \
  --baseline /secure/evidence/baseline.json \
  --financial /secure/evidence/financial-comparison.json \
  --migration /secure/evidence/migrations.json \
  --automated /secure/evidence/automated-tests.json \
  --runtime /secure/evidence/runtime-results.json \
  --commit "$CH247_BUILD_COMMIT" \
  --json-output /secure/evidence/acceptance.json \
  --markdown-output /secure/evidence/acceptance.md
```

Stop if: the generator reports any incomplete section. Do not hand-edit the acceptance artifact.

## 13. Explicit production approval — or stop

**This is the end of the automated workflow.** Nothing above deploys to production, and no script in
this repository does.

Production promotion happens **only** when a named human has:

1. read `acceptance.json` / `acceptance.md` from step 12 and confirmed every section is `PASS`, with
   no `blocked`, `not tested` or unexplained item remaining;
2. recorded the approval — approver name, UTC timestamp, the candidate commit SHA from step 1, the
   evidence paths, and the rollback plan (step 3's proven restore plus the rollback sequence in
   `docs/independent-rebuild/STAGING-DEPLOYMENT.md`);
3. confirmed the rollback was *tested*, not merely written down.

Until that record exists, the correct state of this branch is **"verified on staging, awaiting
approval"**, and the correct action is to stop here.

If any step failed: do not proceed. Restore the step 3 backups, return to stock themes, disable only
the CloudHost247 staging modules, clear only the verified staging template cache, and preserve
redacted logs for diagnosis. Never reverse-edit customer, invoice, transaction, domain, service or
product data, and never attempt improvised reverse SQL for a failed migration — restore the proven
database backup instead.
