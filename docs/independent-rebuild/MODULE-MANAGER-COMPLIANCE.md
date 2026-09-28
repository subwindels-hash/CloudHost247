# Module Manager — requirement traceability

Every clause of the Super Admin → Module Manager specification, the code that
implements it, and the automated check that proves it. Nothing in this table is
aspirational: each "Proven by" entry is an assertion name you can grep for in
`tests/modules/run.php` (237 assertions) or a method in
`tests/modules/test_static.py` (34 source-policy tests).

Re-verify everything:

```bash
php tests/modules/run.php                       # 237 assertions
python3 -m unittest tests.modules.test_static   # 34 tests
python3 scripts/validate-migrations.py          # 16 migrations, additive
bash scripts/release-candidate-check.sh         # full release gate
```

Source root: `modules/addons/cloudhost247_modules/`. Paths below are relative to
it unless stated otherwise.

---

## 1. The page: Super Admin → Modules

| Feature | Implemented by | Proven by |
| --- | --- | --- |
| Installed Modules | `lib/Services/AdminView.php::dashboard()`, `AdminController::overview()` | `the dashboard shows real status and health labels` |
| Available / Uploaded Modules | `AdminView::packages()`, `ModuleRepository::packages()` | `the upload is recorded in the package ledger` |
| Upload Module | `AdminController::upload()`, `lib/Package/UploadReceiver.php` | `uploading requires the upload capability` |
| Install | `AdminController::install()`, `lib/Install/Installer.php::install()` | `a confirmed installation really installs the module` |
| Update | `Installer::plan()` → `ACTION_UPDATE` | `the update installs the new version and its new files` |
| Enable | `AdminController::toggle()`, `Installer::assertCanEnable()` | `enabling a module through the controller works` |
| Disable | `AdminController::toggle()`, `Installer::assertCanDisable()` | `disabling deletes no files and no data` |
| Uninstall | `AdminController::uninstall()`, `Installer::uninstall()` | `a confirmed uninstall removes the files and says what was kept` |
| Reinstall | `ACTION_REINSTALL`; "Reinstall from stored package" on the details screen | `an identical version is planned as a reinstall`, `the details screen offers a reinstall from the stored package` |
| Module Details | `AdminView::details()` | `module details explain the uninstall impact before confirming` |
| Module Logs | `AdminView::logs()`, `ModuleRepository::events()` | `the module log lists real recorded events` |
| Dependency / Compatibility Check | `lib/Registry/DependencyResolver.php`, `lib/Registry/CompatibilityChecker.php`, live re-check on the details screen | `the details screen re-checks dependencies and compatibility live` |
| No cPanel/SSH extraction | `lib/Package/SecureExtractor.php` writes the module directory; `Installer::destinationWritable()` reports it up front | `installation writes the module inside its own directory only` |

## 2. Upload pipeline (14 steps)

| Step | Implemented by | Proven by |
| --- | --- | --- |
| 1. Receive the package | `UploadReceiver::receive()` (`is_uploaded_file`, PHP upload-error mapping) | `upload rejects php upload errors`, `upload rejects a path that is not a genuine upload` |
| 2. Validate file type | `.zip` extension, double-extension guard, ZIP magic bytes, `finfo` MIME allowlist | `upload rejects a non-zip extension`, `upload rejects a double extension`, `upload rejects a php payload renamed to .zip` |
| 3. Validate file size | `UploadReceiver::maxBytes()` (`CH247_MODULE_MAX_UPLOAD_BYTES`, 64 KiB–256 MiB, default 32 MiB) + minimum size | `upload rejects a file that is too small`, `upload size limit is configurable by deployment` |
| 4. Calculate checksum | `lib/Support/Checksum.php` — SHA-256 of the received bytes | `upload returns a sanitized name, size and checksum`, `checksums are sha-256 of the real bytes` |
| 5. Inspect before extraction | `lib/Package/ArchiveInspector.php` reads the central directory only | `inspection reads the manifest without extracting` |
| 6. Detect name / version | `lib/Manifest/Manifest.php::decode()` | `manifest exposes identity and entry point` |
| 7. Validate structure | wrapper-directory stripping, entry point presence, manifest location | `inspection strips a single wrapper directory`, `a package missing its declared entry point is blocked` |
| 8. Application / PHP compatibility | `CompatibilityChecker::check()` | `compatibility blocks an unsupported php version`, `compatibility blocks an unsupported application version` |
| 9. Dependencies | `DependencyResolver::check()` | `dependency check fails when missing` |
| 10. Module already exists? | `Installer::plan()` → `existingRow()` | `an existing module is detected and planned as an update` |
| 11. Update or fresh install? | `InstallationPlan::ACTION_*` + `actionLabel()` | `a new module plans as a fresh install`, `an older package is detected as a downgrade` |
| 12. Scan for unsafe contents | `ArchiveInspector` rejection rules (§3 below) | 16 `archive rejects …` assertions |
| 13. Installation preview | `AdminView::preview()` | `the preview screen shows every decision field` |
| 14. Require confirmation | `AdminController::install()` refuses without `confirm_install` | `installation without confirmation is refused` |

## 3. Secure archive extraction

| Must reject | Implemented by | Proven by |
| --- | --- | --- |
| Path traversal `../` | `Paths::contains()` + per-entry re-check in `SecureExtractor` | `containment rejects parent traversal`, `archive rejects parent traversal entries` |
| Absolute paths | name validation (POSIX, Windows drive, backslash, null byte) | `archive rejects absolute entries`, `containment rejects windows drive paths` |
| Unexpected executable locations | forbidden extensions (`.sh`, `.phar`, `.so`, binaries) and control files | `archive rejects shell scripts`, `archive rejects phar payloads`, `archive rejects shared objects and binaries` |
| Symlink attacks | Unix mode inspection rejects symlinks and non-regular entries | `archive rejects symbolic links` |
| Escaping the module directory | containment re-checked **again** for every entry at write time | `extraction never leaves the destination directory`, `extraction re-checks containment for every entry` |
| Dangerous archive structures | duplicates, encryption, compression bombs, path length, nesting depth | `archive rejects a highly compressed bomb entry`, `archive rejects excessively long paths`, `archive rejects deeply nested structures` |
| Ownership / permission manipulation | setuid, setgid, sticky and any executable bit rejected; files written `0644` | `archive rejects setuid and setgid entries`, `archive rejects entries marked executable`, `archive permission bits never reach the filesystem` |
| Blind extraction | `ZipArchive::extractTo()` is never called — entries are streamed individually with a byte cap and CRC verification | `test_archive_is_never_bulk_extracted`, `test_every_write_is_containment_checked` |

Server-configuration overrides (`.htaccess`), private key material and VCS
metadata are rejected as well: `archive rejects server configuration overrides`,
`archive rejects private key material`, `archive rejects version control metadata`.

## 4. Module manifest (`module.json`)

All fields are parsed as **data**; no packaged PHP is ever included or executed.

| Manifest field | Validation | Proven by |
| --- | --- | --- |
| Module ID | `^[a-z][a-z0-9_]{2,63}$`, platform ids reserved | `manifest rejects a missing id`, `manifest rejects a reserved module id` |
| Name, description, author, license | required text, control characters stripped, length capped | `manifest exposes identity and entry point` |
| Version | strict numeric version | `manifest rejects an invalid version` |
| Module type | closed allowlist of 7 WHMCS types | `manifest rejects an unsupported module type`, `module types are a closed allowlist` |
| Entry point | relative `.php` inside the module directory | `manifest rejects a traversing entry point`, `manifest rejects an absolute entry point` |
| Min / max application version | parsed, max ≥ min | `compatibility blocks an unsupported application version` |
| Min / max PHP version | parsed, max ≥ min | `compatibility blocks an unsupported php version` |
| Dependencies | shorthand, object and list forms; version ranges; optional flag | `manifest parses dependency shorthand`, `manifest accepts a plain list of dependency ids`, `manifest survives a registry round trip without losing constraints` |
| Required permissions | identifier list | `the preview reports every decision field` |
| Database migrations | `mod_`-prefixed tables only; a **declaration**, never an execution hook | `manifest rejects database tables outside the module namespace`, `the preview warns that declared migrations run on activation` |
| Configuration requirements | typed fields; `secret: true` **and** credential-shaped keys rejected | `manifest rejects secret configuration fields`, `manifest rejects every credential-shaped setting key` |
| Unknown keys | recorded and displayed, never trusted | `manifest records unknown keys instead of trusting them` |
| No arbitrary PHP | manifest is `json_decode`d; no `include`/`eval` of package content | `test_uploaded_packages_are_never_executed`, `test_manifests_are_decoded_as_data_only`, `test_no_dynamic_include_of_installed_files` |

## 5. Installation preview

`AdminView::preview()` renders module, version (with the installed version when
updating), author, license, type, PHP range, install path, file count and size,
database changes, configuration required, permissions required, API
integrations, checksum, compatibility table, dependency table, the new /
replaced / unchanged / removed file breakdown, configuration changes, then
**Cancel | Install Module** (label follows the real action: Install, Update,
Downgrade or Reinstall Module).

Proven by `the preview screen shows every decision field`, `the preview reports
every decision field`, `the preview screen requires explicit confirmation`,
`the update preview compares both versions and offers Update Module`.

## 6. Installation transaction and rollback

| Requirement | Implemented by | Proven by |
| --- | --- | --- |
| Snapshot before any change | `lib/Install/InstallationTransaction.php` writes `installation.json` at every stage | `the backup snapshot names the installer, version and checksum` |
| Record replaced files | full directory copy into the backup + per-file manifest with action | `a pre-installation backup is kept`, `installation stores a verifiable file manifest` |
| Record database migrations | `declared_tables` in the snapshot | `the installation snapshot records the configuration state and change` |
| Record configuration changes | `configuration_keys_before` (key names only) + `configuration_changes` (added / removed / changed) | `the installation snapshot records the configuration state and change` |
| Record version, admin, timestamp | `version_from`, `version_to`, `admin_id`, `started_at`, `completed_at` | same assertion |
| Roll back on failure | `InstallationTransaction::rollback()` restores the previous tree | `a failed installation rolls back`, `rollback restores the previous version byte for byte` |
| Never leave a partial module active | registry is written only after extraction and verification; a fresh install leaves no directory | `a failed first install leaves no module directory behind`, `rollback keeps the registry on the working version` |
| Safe error message | `ModuleException` + `SafeError` with a correlation id | `the rollback message is admin-safe and explicit` |
| Admin-only installation log | `mod_cloudhost247_module_events` + `installation.json` stored 0600 outside the web root | `storage keeps packages and backups outside the web root by default` |

## 7. Existing module protection

Never silently overwritten: the plan reports Existing Version vs Uploaded
Version and chooses Update / Downgrade / Reinstall. A downgrade needs a second,
separate confirmation checkbox.

Proven by `an existing module is detected and planned as an update`, `an older
package is detected as a downgrade`, `a downgrade warns before it is allowed`,
`changing the module type of an installed module is blocked`.

## 8. Enable / disable

Disable deletes nothing (`disabling deletes no files and no data`,
`disabling states plainly that nothing was deleted`) and is blocked while an
enabled module depends on it (`disabling a module that others depend on is
blocked`). Enable re-checks manifest, dependencies, compatibility and file
presence (`enabling is blocked while a dependency is disabled`, `enabling is
blocked when the installed files are gone`).

## 9. Uninstall

| Must show | Implemented by | Proven by |
| --- | --- | --- |
| Files that will be removed | `Installer::uninstallImpact()['files']` | `uninstall impact lists the files that will be removed` |
| Database tables / data | declared tables listed and **retained** | `uninstall impact lists database tables without dropping them`, `uninstall never drops database tables` |
| Dependencies | dependents block the uninstall | `uninstalling a module that others depend on is blocked` |
| Active services / configuration | live/enabled state, declared integrations, retained settings | `uninstall impact reports whether the module is live`, `uninstall impact lists declared api integrations` |
| Existing customers / services | `lib/Registry/UsageCensus.php` counts servers, products, live services, distinct customers, addon activation, gateway usage, unpaid invoices, registrar domains | `usage census asks about servers, products, services and customers`, `usage census covers gateways and registrars too`, `the details screen shows real usage before offering an uninstall` |
| Explicit confirmation | type the module id + impact checkbox + a live-usage acknowledgement enforced server-side | `uninstall requires the module id to be typed exactly`, `uninstall stops when live customer usage was not acknowledged` |
| No silent data deletion | only recorded files are removed; tables, customers, services and stored settings are retained | `uninstall removes only the files it installed`, `test_nothing_drops_tables_or_customer_data` |

An unreadable table is reported as **unknown**, never zero
(`usage census reports unknown rather than zero when whmcs is unreachable`).

## 10. Module permissions

Seven capabilities — `modules.view`, `modules.upload`, `modules.install`,
`modules.update`, `modules.toggle`, `modules.uninstall`, `modules.configure` —
in `lib/Security/CapabilityPolicy.php`, seeded **Super-Admin-only** at
activation and editable in CloudHost247 Foundation.

Proven by `capability set covers every privileged action`, `installation is
refused without the install capability`, `configuring is refused without the
configure capability`, `test_privileged_capabilities_default_to_super_admin`,
`the dashboard states that installation rights are restricted`.

## 11. Security / trust

| Control | Implemented by | Proven by |
| --- | --- | --- |
| Authentication | `AdminGuard::requireAdmin()` first in `handle()` | `the dashboard authenticates the administrator first` |
| Authorization | per-operation `requireCapability()` | `uploading requires the upload capability` |
| CSRF | `AdminGuard::requirePostToken()` before any dispatch | `a forged request without a valid token changes nothing` |
| Secure upload handling | `UploadReceiver` (see §2) | `upload rejects a path that is not a genuine upload` |
| Archive validation / traversal / type / size | see §2 and §3 | 16 `archive rejects …` assertions |
| Checksum verification | SHA-256 at upload, storage, install and health check | `installation records the real version and checksum` |
| Audit logging | `AuditLogger` (platform) + `mod_cloudhost247_module_events` | `the upload is written to the administrator audit trail` |
| Installation logs | `installation.json` per transaction, 0600, outside the web root | `storage denies web access to its directories` |
| Safe rollback | §6 | `a failed installation rolls back` |
| Dependency + compatibility validation | §2 steps 8–9 | `dependency check fails on a version that is too old` |
| No bypass of platform controls | no `eval`/`exec`/`shell_exec`/`unserialize` anywhere, including tests; no dynamic include of installed files | `tests/security/test_security.py`, `test_no_dynamic_include_of_installed_files` |
| No secrets in output | escaping on every field, no JavaScript emitted | `module metadata is escaped on output`, `no screen emits javascript`, `the module log never contains a secret-looking value` |

## 12. Module configuration

`Modules → Installed → Configure` is generated from the manifest:

- Form types text / number (with `min`/`max`) / select (declared `options`) /
  boolean, stored in `mod_cloudhost247_module_settings` (migration 1.1.0).
- Only manifest-declared keys are stored; anything else posted is discarded.
- Credentials cannot reach it: `secret: true` **and** credential-shaped keys are
  rejected at manifest validation, so API keys, passwords and tokens go to the
  central API & Integrations vault, deep-linked per provider from the same panel.
- **Connection test** calls the central `IntegrationManager::test()`; only a
  sanitized classification is displayed.
- Runtime access for modules: `ModuleManager::setting($moduleId, $key, $default)`.

Proven by `a valid configuration is really stored`, `undeclared fields posted to
the configure form are discarded`, `the configuration change is logged without
any value`, `the configuration change is audited by key, never by value`,
`the configure form renders the stored value and no secret field`,
`installed modules expose their settings through the platform facade`,
`a connection test reports honestly when the integrations centre is absent`,
`test_module_settings_can_never_hold_credentials`,
`test_connection_testing_is_delegated_to_the_integrations_centre`.

## 13. Module updates

The update preview shows current version, new version, the version change,
files changed (new / replaced / unchanged / removed with file lists), declared
database migrations, dependencies, compatibility, configuration changes and the
package checksum, and requires confirmation.

Proven by `the update preview compares both versions and offers Update Module`,
`the update preview lists new, replaced and unchanged files`, `the update
preview lists the configuration changes it brings`, `version change is described
for the preview`, `files removed from the package are removed from disk`.

## 14. Module audit log

Every lifecycle event records module id, event type, result, `version_from`,
`version_to`, package checksum, sanitized detail, admin id, admin IP (direct
peer address only — forwarded headers are not trusted), correlation id and
timestamp. Event vocabulary is closed: upload, reject, install, update,
reinstall, enable, disable, uninstall, rollback, health_check, configure.

Proven by `the module log shows who acted, from where, and on what checksum`,
`the update is logged as an update carrying both versions`, `the update is
audited as an update, not as a fresh install`, `module event types are a closed
vocabulary`, `the module log never contains a secret-looking value`,
`test_client_ip_is_not_taken_from_untrusted_headers`, `test_logs_never_record_secrets`.

## 15. Not a fake UI

- A module is recorded as installed only after extraction **and** verification
  of every file hash; the registry row is written last.
- Health (`healthy | modified | missing_files | not_installed`) is computed by
  re-hashing files on disk, not stored optimism.
- A new install is never auto-enabled; an update keeps the state it found and
  the message says which of the two actually happened.
- "Enabled" requires both a registry row and the files on disk.

Proven by `an installed module is not reported healthy until it is verified`,
`health verification detects tampering`, `health verification detects deleted
files`, `an installed module is never enabled automatically`, `an update of an
enabled module keeps it enabled and says so honestly`, `the platform reports a
module as enabled only when its files exist`, `module details report unverified
state honestly`, `module details never invent a configured integration`,
`test_status_is_read_from_real_state`.

## 16. Reusable platform service

`lib/Services/ModuleManager.php` is the platform-facing facade used by any
future module — `isEnabled()`, `assertEnabled()`, `manifest()`, `settings()`,
`setting()`, `platformComponents()`, `verify()`, `integrationStatus()`,
`testIntegration()`, `registerIntegrations()`.

Pipeline order (`Installer`, `AdminController`): Upload → Validate → Inspect →
Compatibility → Dependency → Security → Preview → Confirm → Backup → Install →
Register → Configure → Enable → Health Check.

Integration with the central API & Integrations centre: a manifest declares
providers and optional provider definitions; enabled modules register them as
real providers, so credentials are entered once, encrypted in the central vault,
connection-tested server-side and surfaced on the module's own page.

Proven by `the platform exposes installed components for dependency checks`,
`module code can assert it is enabled before running`, `integration deep links
target the central credential vault`, `integration registration is skipped when
the integrations centre is absent`, `module details route credentials to the
central integrations centre`, `test_documentation_describes_the_workflow`.

## Platform constraints

| Constraint | Evidence |
| --- | --- |
| PHP 7.4 and 8.2 | `php -l` sweep plus the whole suite run under both runtimes; CI matrix in `.github/workflows/independent-foundation.yml` |
| Complete existing gates | `scripts/release-candidate-check.sh` passes on both runtimes (4 PHP runners, 9 Python suites, migration validator, integrity manifest) |
| Proprietary integrity baseline | `docs/independent-rebuild/original-file-manifest.sha256` unchanged; verified by the gate's SHA-256 check |
| Additive migrations only | `scripts/validate-migrations.py` — 16 migrations, `cloudhost247_modules` 1.0.0 and 1.1.0, all `hasTable`-guarded, `mod_cloudhost247_`-namespaced |
